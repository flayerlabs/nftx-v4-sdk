import type { Address } from 'viem'

import { cryptoKittiesAbi } from '../abi/cryptoKitties'
import { cryptoPunksAbi } from '../abi/cryptoPunks'
import { InvalidInputError } from '../errors'
import { parseAddress, parseTokenId, parseTokenIds } from '../lib/validate'
import type { BigIntish } from '../math/amount'
import type { PlanStep } from '../plan/types'
import { approveErc721ForAll } from './approvals'

export type NftStandard = 'erc721' | 'punks' | 'kitties'

/** Address allowlist mirrors NFTTransferLib.flavor(), on every chain. */
export function nftStandard(collection: string): NftStandard {
  const address = parseAddress(collection, 'collection').toLowerCase()
  if (address === '0xb47e3cd837ddf8e4c57f05d70ab865de6e193bbb') return 'punks'
  if (address === '0x06012c8cf97bead5deae237070f9587f8e7a266d') return 'kitties'
  return 'erc721'
}

export interface TokenAuthorisation {
  tokenId: BigIntish
  authorised: boolean
  readFailed: boolean
}

export interface PunkOfferVerdict extends TokenAuthorisation {
  /** Authorising the operator overwrites this standing paid offer. */
  standingSalePriceWei: bigint
}

export type NftApproval =
  | { kind: 'erc721'; isApprovedForAll: boolean }
  | { kind: 'punks'; verdicts: readonly PunkOfferVerdict[] }
  | { kind: 'kitties'; verdicts: readonly TokenAuthorisation[] }

export type PunkOffer = readonly [boolean, bigint, Address, bigint, Address]

export function isPunkOfferedToOperator(
  offer: PunkOffer,
  owner: Address,
  operator: Address,
): boolean {
  const [isForSale, , seller, minValue, onlySellTo] = offer
  return (
    isForSale &&
    minValue === 0n &&
    seller.toLowerCase() === owner.toLowerCase() &&
    onlySellTo.toLowerCase() === operator.toLowerCase()
  )
}

export function standingSalePriceWei(offer: PunkOffer, owner: Address): bigint {
  const [isForSale, , seller, minValue] = offer
  return isForSale && seller.toLowerCase() === owner.toLowerCase() && minValue > 0n ? minValue : 0n
}

export interface ReadPunkOffersInput {
  tokenIds: readonly BigIntish[]
  owner: Address
  operator: Address
  readOffer: (tokenId: bigint) => Promise<PunkOffer>
}

/** Independent read failures remain visible and never authorise a token. */
export async function readPunkOffers(input: ReadPunkOffersInput): Promise<PunkOfferVerdict[]> {
  const ids = input.tokenIds.map((id) => parseTokenId(id))
  const owner = parseAddress(input.owner, 'owner')
  const operator = parseAddress(input.operator, 'operator')
  return Promise.all(
    ids.map(async (tokenId) => {
      try {
        const offer = await input.readOffer(tokenId)
        return {
          tokenId,
          authorised: offer[1] === tokenId && isPunkOfferedToOperator(offer, owner, operator),
          readFailed: false,
          standingSalePriceWei: standingSalePriceWei(offer, owner),
        }
      } catch {
        return { tokenId, authorised: false, readFailed: true, standingSalePriceWei: 0n }
      }
    }),
  )
}

export interface ReadKittyApprovalsInput {
  tokenIds: readonly BigIntish[]
  operator: Address
  readApproved: (tokenId: bigint) => Promise<Address>
}

export async function readKittyApprovals(
  input: ReadKittyApprovalsInput,
): Promise<TokenAuthorisation[]> {
  const ids = input.tokenIds.map((id) => parseTokenId(id))
  const operator = parseAddress(input.operator, 'operator')
  return Promise.all(
    ids.map(async (tokenId) => {
      try {
        const approved = await input.readApproved(tokenId)
        return {
          tokenId,
          authorised: approved.toLowerCase() === operator.toLowerCase(),
          readFailed: false,
        }
      } catch {
        return { tokenId, authorised: false, readFailed: true }
      }
    }),
  )
}

export function punkListingsAtRisk(approval: NftApproval): { tokenId: bigint; priceWei: bigint }[] {
  if (approval.kind !== 'punks') return []
  return approval.verdicts.flatMap((verdict) =>
    verdict.standingSalePriceWei > 0n
      ? [{ tokenId: parseTokenId(verdict.tokenId), priceWei: verdict.standingSalePriceWei }]
      : [],
  )
}

export interface NftApprovalParams {
  collection: Address
  operator: Address
  tokenIds: readonly BigIntish[]
  approval?: NftApproval
  /** Backwards-compatible blanket state; ignored for legacy collections. */
  isApprovedForAll?: boolean
}

/** Emit the correct authorisation for NFTs pulled by Zap, Locker or Listings. */
export function authoriseNftsSteps(params: NftApprovalParams): PlanStep[] {
  if (params.tokenIds.length === 0) return []
  const collection = parseAddress(params.collection, 'collection')
  const operator = parseAddress(params.operator, 'operator')
  const ids = parseTokenIds(params.tokenIds)
  const kind = nftStandard(collection)
  if (params.approval && params.approval.kind !== kind) {
    throw new InvalidInputError(`NFT approval kind must be ${kind} for this collection.`)
  }
  if (kind === 'erc721') {
    return [
      approveErc721ForAll({
        collection,
        operator,
        skip:
          params.approval?.kind === 'erc721'
            ? params.approval.isApprovedForAll
            : (params.isApprovedForAll ?? false),
      }),
    ]
  }
  const authorised = new Set(
    params.approval && params.approval.kind !== 'erc721'
      ? params.approval.verdicts
          .filter((verdict) => verdict.authorised && !verdict.readFailed)
          .map((verdict) => parseTokenId(verdict.tokenId))
      : [],
  )
  return ids.map((tokenId) => ({
    id: `approve-${tokenId}`,
    label: `Approve NFT #${tokenId}`,
    address: collection,
    abi: kind === 'punks' ? cryptoPunksAbi : cryptoKittiesAbi,
    functionName: kind === 'punks' ? 'offerPunkForSaleToAddress' : 'approve',
    args: kind === 'punks' ? [tokenId, 0n, operator] : [operator, tokenId],
    approvalTarget: operator,
    replaySafe: true,
    skip: authorised.has(tokenId),
  }))
}
