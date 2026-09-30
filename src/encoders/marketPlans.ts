import type { Address } from 'viem'

import { listingsAbi } from '../abi/listings'
import { lockerAbi } from '../abi/locker'
import { getAddressFor } from '../addresses/resolve'
import { ONE_VTOKEN_WEI } from '../constants/pool'
import { InvalidInputError } from '../errors'
import { parseListingTerms, parseUintNumber } from '../lib/listing'
import {
  parseAddress,
  parseNonNegativeAmount,
  parsePositiveAmount,
  parseTokenIds,
} from '../lib/validate'
import type { BigIntish } from '../math/amount'
import { maxSpendWithSlippage, minOutWithSlippage } from '../math/slippage'
import type { PlanStep } from '../plan/types'
import { approveErc20 } from './approvals'
import { authoriseNftsSteps, type NftApproval } from './nftApproval'
import {
  buyNft,
  buyTokens,
  redeemFloor,
  sellNft,
  sellTokens,
  type TradeEncoderContext,
} from './zap'

const plural = (count: number) => (count === 1 ? '' : 's')

function requireAccount(steps: PlanStep[], account: Address): PlanStep[] {
  return steps.map((step) => ({ ...step, requiredAccount: account }))
}

export interface ListedTarget {
  tokenId: BigIntish
  /** Hundredths of floor: 126 means 1.26 collection tokens. */
  floorMultiple: number
}

function parseCount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvalidInputError(`${label} must be a non-negative safe integer.`)
  }
  return value
}

function listedTokenSpendWei(items: readonly Pick<ListedTarget, 'floorMultiple'>[]): bigint {
  return items.reduce((total, item, index) => {
    const multiple = parseUintNumber(
      item.floorMultiple,
      16,
      `listedItems[${index}].floorMultiple`,
      true,
    )
    return total + (BigInt(multiple) * ONE_VTOKEN_WEI) / 100n
  }, 0n)
}

export interface TokenRequirementInput {
  floorCount: number
  listedItems?: readonly Pick<ListedTarget, 'floorMultiple'>[]
  depositCount?: number
  tokenContributionWei?: BigIntish
}

export interface TokenRequirement {
  listedSpendWei: bigint
  requiredWei: bigint
  stagedWei: bigint
  shortfallWei: bigint
}

/** Calculate the collection-token funding shared by direct and mixed basket plans. */
export function tokenRequirement(input: TokenRequirementInput): TokenRequirement {
  const floorCount = parseCount(input.floorCount, 'floorCount')
  const depositCount = parseCount(input.depositCount ?? 0, 'depositCount')
  const listedItems = input.listedItems ?? []
  if (floorCount === 0 && listedItems.length === 0) {
    throw new InvalidInputError('Nothing selected to swap.')
  }
  const tokenContributionWei = parseNonNegativeAmount(
    input.tokenContributionWei ?? 0n,
    'tokenContributionWei',
  )
  const listedSpendWei = listedTokenSpendWei(listedItems)
  const requiredWei = BigInt(floorCount) * ONE_VTOKEN_WEI + listedSpendWei
  const stagedWei = BigInt(depositCount) * ONE_VTOKEN_WEI + tokenContributionWei
  return {
    listedSpendWei,
    requiredWei,
    stagedWei,
    shortfallWei: requiredWei > stagedWei ? requiredWei - stagedWei : 0n,
  }
}

export interface BuyFromPoolPlanInput {
  collection: Address
  tokenIds: readonly BigIntish[]
  quotedCostWei: BigIntish
  slippageBps: number
  listed?: boolean
}

/**
 * Build a quoted ETH-funded floor or listed NFT purchase. The listed route
 * commits the full slippage-adjusted value as exact input.
 */
export function buildBuyFromPoolPlan(
  ctx: TradeEncoderContext,
  input: BuyFromPoolPlanInput,
): PlanStep[] {
  const maxSpend = maxSpendWithSlippage(
    parsePositiveAmount(input.quotedCostWei, 'quotedCostWei'),
    input.slippageBps,
  )
  const params = {
    collection: parseAddress(input.collection, 'collection'),
    tokenIds: input.tokenIds,
    maxSpend,
  }
  return [input.listed ? buyNft(ctx, params) : redeemFloor(ctx, params)]
}

export interface SellToPoolPlanInput {
  collection: Address
  tokenIds: readonly BigIntish[]
  quotedProceedsWei: BigIntish
  slippageBps: number
  isApprovedForAll?: boolean
  approval?: NftApproval
}

/** Build an NFT approval plus an exact-input zap sale with a quoted ETH floor. */
export function buildSellToPoolPlan(
  ctx: TradeEncoderContext,
  input: SellToPoolPlanInput,
): PlanStep[] {
  const minOut = minOutWithSlippage(
    parsePositiveAmount(input.quotedProceedsWei, 'quotedProceedsWei'),
    input.slippageBps,
  )
  return sellNft(ctx, {
    collection: parseAddress(input.collection, 'collection'),
    tokenIds: input.tokenIds,
    minOut,
    ...(input.approval ? { approval: input.approval } : {}),
    ...(input.isApprovedForAll !== undefined ? { isApprovedForAll: input.isApprovedForAll } : {}),
  })
}

export interface DepositForTokenPlanInput {
  collection: Address
  tokenIds: readonly BigIntish[]
  recipient: Address
  isApprovedForAll?: boolean
  approval?: NftApproval
}

interface DepositNftsStepsInput {
  locker: Address
  collection: Address
  tokenIds: bigint[]
  recipient: Address
  isApprovedForAll?: boolean
  approval?: NftApproval
}

function depositNftsSteps(input: DepositNftsStepsInput): PlanStep[] {
  return [
    ...authoriseNftsSteps({
      collection: input.collection,
      operator: input.locker,
      tokenIds: input.tokenIds,
      ...(input.approval ? { approval: input.approval } : {}),
      ...(input.isApprovedForAll !== undefined ? { isApprovedForAll: input.isApprovedForAll } : {}),
    }),
    {
      id: 'deposit',
      label: `Deposit ${input.tokenIds.length} NFT${plural(input.tokenIds.length)}`,
      address: input.locker,
      abi: lockerAbi,
      functionName: 'deposit',
      args: [input.collection, input.tokenIds, input.recipient],
    },
  ]
}

/** Deposit NFTs directly into the Locker and mint one collection token per NFT. */
export function buildDepositForTokenPlan(
  ctx: TradeEncoderContext,
  input: DepositForTokenPlanInput,
): PlanStep[] {
  const locker = getAddressFor(ctx.chainId, 'locker', ctx.contracts)
  const collection = parseAddress(input.collection, 'collection')
  const tokenIds = parseTokenIds(input.tokenIds)
  const recipient = parseAddress(input.recipient, 'recipient')
  return depositNftsSteps({
    locker,
    collection,
    tokenIds,
    recipient,
    ...(input.approval ? { approval: input.approval } : {}),
    ...(input.isApprovedForAll !== undefined ? { isApprovedForAll: input.isApprovedForAll } : {}),
  })
}

export interface SwapNftsPlanInput {
  /** Signing account that supplies NFTs/tokens and receives deposited collection tokens. */
  account: Address
  collection: Address
  /** Floor NFT targets. */
  tokenIds: readonly BigIntish[]
  /** Above-floor listing targets. */
  listedItems?: readonly ListedTarget[]
  /** NFTs supplied to mint one collection token each. */
  depositTokenIds: readonly BigIntish[]
  /** Required whenever a fill or redeem pulls collection tokens. */
  collectionToken?: Address
  recipient: Address
  isApprovedForAll?: boolean
  approval?: NftApproval
}

interface SwapNftsPlanOptions {
  fundingStep?: PlanStep
}

function buildSwapNftsSteps(
  ctx: TradeEncoderContext,
  input: SwapNftsPlanInput,
  options: SwapNftsPlanOptions = {},
): PlanStep[] {
  const locker = getAddressFor(ctx.chainId, 'locker', ctx.contracts)
  const listings = getAddressFor(ctx.chainId, 'listings', ctx.contracts)
  const account = parseAddress(input.account, 'account')
  const collection = parseAddress(input.collection, 'collection')
  const recipient = parseAddress(input.recipient, 'recipient')
  const floorIds =
    input.tokenIds.length === 0 ? [] : parseTokenIds(input.tokenIds, {}, 'floor token ids')
  const listedItems = input.listedItems ?? []
  const listedIds =
    listedItems.length === 0
      ? []
      : parseTokenIds(
          listedItems.map(({ tokenId }) => tokenId),
          {},
          'listed token ids',
        )
  const depositIds =
    input.depositTokenIds.length === 0
      ? []
      : parseTokenIds(input.depositTokenIds, {}, 'deposit token ids')
  if (floorIds.length === 0 && listedIds.length === 0) {
    throw new InvalidInputError('Nothing selected to swap.')
  }
  const approveNfts = () =>
    authoriseNftsSteps({
      collection,
      operator: locker,
      tokenIds: depositIds,
      ...(input.approval ? { approval: input.approval } : {}),
      ...(input.isApprovedForAll !== undefined ? { isApprovedForAll: input.isApprovedForAll } : {}),
    })

  if (
    listedIds.length === 0 &&
    depositIds.length > 0 &&
    depositIds.length === floorIds.length &&
    account === recipient
  ) {
    return requireAccount(
      [
        ...approveNfts(),
        ...(options.fundingStep ? [options.fundingStep] : []),
        {
          id: 'swap',
          label: `Swap ${floorIds.length} NFT${plural(floorIds.length)}`,
          address: locker,
          abi: lockerAbi,
          functionName: 'swapBatch',
          args: [collection, depositIds, floorIds],
        },
      ],
      account,
    )
  }

  const steps: PlanStep[] = []
  if (depositIds.length > 0) {
    steps.push(
      ...depositNftsSteps({
        locker,
        collection,
        tokenIds: depositIds,
        recipient: account,
        ...(input.approval ? { approval: input.approval } : {}),
        ...(input.isApprovedForAll !== undefined
          ? { isApprovedForAll: input.isApprovedForAll }
          : {}),
      }),
    )
  }
  if (options.fundingStep) steps.push(options.fundingStep)

  let collectionToken: Address | undefined
  if (listedIds.length > 0 || floorIds.length > 0) {
    if (!input.collectionToken) {
      throw new InvalidInputError('collectionToken is required for listing fills and redeems.')
    }
    collectionToken = parseAddress(input.collectionToken, 'collectionToken')
  }

  if (listedIds.length > 0 && collectionToken) {
    const maxSpend = listedTokenSpendWei(listedItems)
    steps.push(
      approveErc20({
        id: 'approve-token',
        label: 'Approve tokens',
        token: collectionToken,
        spender: listings,
        amount: maxSpend,
      }),
      {
        id: 'fill',
        label: `Buy ${listedIds.length} NFT${plural(listedIds.length)}`,
        address: listings,
        abi: listingsAbi,
        functionName: 'fillListings',
        args: [
          {
            collection,
            tokenIdsOut: listedIds.map((id) => [id]),
            recipient,
            maxSpend,
          },
        ],
      },
    )
  }

  if (floorIds.length > 0 && collectionToken) {
    steps.push(
      approveErc20({
        id: 'approve-redeem',
        label: 'Approve tokens',
        token: collectionToken,
        spender: locker,
        amount: BigInt(floorIds.length) * ONE_VTOKEN_WEI,
      }),
      {
        id: 'redeem',
        label: `Redeem ${floorIds.length} NFT${plural(floorIds.length)}`,
        address: locker,
        abi: lockerAbi,
        functionName: 'redeem',
        args: [collection, floorIds, recipient],
      },
    )
  }
  return requireAccount(steps, account)
}

/** Build direct Locker/Listings settlement using NFTs and/or collection tokens. */
export function buildSwapNftsPlan(ctx: TradeEncoderContext, input: SwapNftsPlanInput): PlanStep[] {
  return buildSwapNftsSteps(ctx, input)
}

export interface MixedBuyPlanInput extends SwapNftsPlanInput {
  tokenContributionWei: BigIntish
  /** Exact-output quote for the uncovered collection-token shortfall. */
  quotedEthCostWei: BigIntish
  slippageBps: number
}

/** Add a zap token-buy funding leg before a direct Locker/Listings settlement. */
export function buildMixedBuyPlan(ctx: TradeEncoderContext, input: MixedBuyPlanInput): PlanStep[] {
  const { shortfallWei } = tokenRequirement({
    floorCount: input.tokenIds.length,
    ...(input.listedItems ? { listedItems: input.listedItems } : {}),
    depositCount: input.depositTokenIds.length,
    tokenContributionWei: input.tokenContributionWei,
  })
  if (shortfallWei === 0n) {
    throw new InvalidInputError('The staged assets already cover this order; no ETH is needed.')
  }
  const maxSpend = maxSpendWithSlippage(
    parsePositiveAmount(input.quotedEthCostWei, 'quotedEthCostWei'),
    input.slippageBps,
  )
  const fundingStep: PlanStep = {
    ...buyTokens(ctx, {
      collection: input.collection,
      amountInWei: maxSpend,
      minOut: shortfallWei,
    }),
    id: 'buy-tokens',
    label: 'Buy tokens',
  }
  return buildSwapNftsSteps(ctx, input, { fundingStep })
}

export type ListingPlanItem = ListedTarget

export interface ListingEthPayout {
  collectionToken: Address
  proceedsWei: BigIntish
  minEthOutWei: BigIntish
}

export interface ListAboveFloorPlanInput {
  /** Signing account whose ownership/allowance state was used to build the plan. */
  account: Address
  owner: Address
  collection: Address
  items: readonly ListingPlanItem[]
  duration: number
  created: number
  isApprovedForAll?: boolean
  approval?: NftApproval
  ethPayout?: ListingEthPayout
}

/** Create above-floor listings, optionally swapping their released tokens to ETH. */
export function buildListAboveFloorPlan(
  ctx: TradeEncoderContext,
  input: ListAboveFloorPlanInput,
): PlanStep[] {
  if (input.items.length === 0) throw new InvalidInputError('Nothing selected to list.')
  const listings = getAddressFor(ctx.chainId, 'listings', ctx.contracts)
  const account = parseAddress(input.account, 'account')
  const collection = parseAddress(input.collection, 'collection')
  const owner = parseAddress(input.owner, 'owner')
  if (input.ethPayout && owner !== account) {
    throw new InvalidInputError(
      'owner must match account when an ETH payout is included in the listing plan.',
    )
  }
  const tokenIds = parseTokenIds(input.items.map(({ tokenId }) => tokenId))
  const createListings = input.items.map((item, index) => ({
    collection,
    tokenIds: [tokenIds[index]!],
    listing: parseListingTerms({
      owner,
      created: input.created,
      duration: input.duration,
      floorMultiple: item.floorMultiple,
    }),
  }))
  const steps: PlanStep[] = [
    ...authoriseNftsSteps({
      collection,
      operator: listings,
      tokenIds,
      ...(input.approval ? { approval: input.approval } : {}),
      ...(input.isApprovedForAll !== undefined ? { isApprovedForAll: input.isApprovedForAll } : {}),
    }),
    {
      id: 'list',
      label: `List ${tokenIds.length} NFT${plural(tokenIds.length)}`,
      address: listings,
      abi: listingsAbi,
      functionName: 'createListings',
      args: [createListings],
    },
  ]

  if (input.ethPayout) {
    const proceedsWei = parsePositiveAmount(input.ethPayout.proceedsWei, 'proceedsWei')
    const minEthOutWei = parsePositiveAmount(input.ethPayout.minEthOutWei, 'minEthOutWei')
    const payoutSteps = sellTokens(ctx, {
      collection,
      vToken: parseAddress(input.ethPayout.collectionToken, 'collectionToken'),
      amountInWei: proceedsWei,
      minOut: minEthOutWei,
    })
    steps.push(
      { ...payoutSteps[0]!, id: 'approve-token', label: 'Approve tokens' },
      { ...payoutSteps[1]!, id: 'swap', label: 'Swap to ETH' },
    )
  }
  return requireAccount(steps, account)
}
