import type { Address } from 'viem'

import { nftxZapAbi } from '../abi/nftxZap'
import { type ContractOverrides, getContract } from '../addresses/resolve'
import { InvalidInputError } from '../errors'
import {
  MAX_UINT256,
  parseAddress,
  parseNonNegativeAmount,
  parsePositiveAmount,
  parseTokenIds,
} from '../lib/validate'
import type { BigIntish } from '../math/amount'
import type { PlanStep } from '../plan/types'
import { approveErc20, approveErc721ForAll } from './approvals'

/**
 * Pure NFTXZap trade encoders → `PlanStep[]` (calldata is projected later via
 * execution/encodeCalls). Every entry takes the ERC721 `_collection`; the zap
 * resolves the vToken/pool internally. The zap address is resolved through the
 * static guard (`getContract`), which throws `ContractNotDeployedError` for the
 * no-code mainnet zap — the facade adds the runtime `getCode`+identity check.
 *
 * `value` invariants: `redeemFloorWithETH` treats `value == maxSpend` as a cap
 * and refunds unused ETH. `buyNFTWithETH` and `buyTokensWithETH` are exact-input
 * over the WHOLE `value`; a listed buy returns unused purchasing power as
 * collection tokens, not ETH.
 */
export interface TradeEncoderContext {
  chainId: number
  contracts?: ContractOverrides
}

const plural = (n: number) => (n === 1 ? '' : 's')

function zapAddress(ctx: TradeEncoderContext): Address {
  return getContract(ctx.chainId, 'nftxZap', ctx.contracts).address
}

export interface RedeemFloorParams {
  collection: Address
  tokenIds: readonly BigIntish[]
  /** Cap from the v4 Quoter exact-output (zap refunds overage). */
  maxSpend: BigIntish
}

/** Cheapest buy: redeem `tokenIds.length` floor NFTs, capped at `maxSpend`. */
export function redeemFloor(ctx: TradeEncoderContext, params: RedeemFloorParams): PlanStep {
  const zap = zapAddress(ctx)
  const collection = parseAddress(params.collection, 'collection')
  const ids = parseTokenIds(params.tokenIds)
  const maxSpend = parsePositiveAmount(params.maxSpend, 'maxSpend')
  return {
    id: 'buy',
    label: `Buy ${ids.length} NFT${plural(ids.length)}`,
    address: zap,
    abi: nftxZapAbi,
    functionName: 'redeemFloorWithETH',
    args: [collection, ids, maxSpend],
    value: maxSpend,
  }
}

export interface BuyNftParams {
  collection: Address
  tokenIds: readonly BigIntish[]
  /**
   * Exact ETH input and the on-chain `_maxETHSpent` listing bound. The zap
   * converts the full value; any excess comes back as collection tokens.
   */
  maxSpend: BigIntish
  /**
   * `_minTokensReceived`. Legitimately 0 for a listed buy: `_maxETHSpent`
   * bounds the listing fill and unused collection tokens return to the caller.
   */
  minTokensReceived?: BigIntish
}

/** Buy specific (e.g. above-floor listed) NFTs via `buyNFTWithETH` (2-D ids). */
export function buyNft(ctx: TradeEncoderContext, params: BuyNftParams): PlanStep {
  const zap = zapAddress(ctx)
  const collection = parseAddress(params.collection, 'collection')
  const ids = parseTokenIds(params.tokenIds)
  const maxSpend = parsePositiveAmount(params.maxSpend, 'maxSpend')
  const minTokensReceived = parseNonNegativeAmount(
    params.minTokensReceived ?? 0n,
    'minTokensReceived',
  )
  return {
    id: 'buy',
    label: `Buy ${ids.length} NFT${plural(ids.length)}`,
    address: zap,
    abi: nftxZapAbi,
    functionName: 'buyNFTWithETH',
    // Each inner group must share one listing owner. Without owner metadata,
    // singleton groups are the only universally safe representation.
    args: [collection, ids.map((id) => [id]), minTokensReceived, maxSpend],
    value: maxSpend,
  }
}

export interface SellNftParams {
  collection: Address
  tokenIds: readonly BigIntish[]
  /** Min ETH out after slippage (the facade ensures this is non-zero). */
  minOut: BigIntish
  /** Fresh `isApprovedForAll(owner, zap)` — skips the approval step when true. */
  isApprovedForAll: boolean
}

/** Sell NFTs to the pool: `[approve721?]` + `sellNFTForETH`. */
export function sellNft(ctx: TradeEncoderContext, params: SellNftParams): PlanStep[] {
  const zap = zapAddress(ctx)
  const collection = parseAddress(params.collection, 'collection')
  const ids = parseTokenIds(params.tokenIds)
  const minOut = parsePositiveAmount(params.minOut, 'minOut')
  return [
    approveErc721ForAll({ collection, operator: zap, skip: params.isApprovedForAll }),
    {
      id: 'sell',
      label: `Sell ${ids.length} NFT${plural(ids.length)}`,
      address: zap,
      abi: nftxZapAbi,
      functionName: 'sellNFTForETH',
      args: [collection, ids, minOut],
    },
  ]
}

export interface BuyTokensParams {
  collection: Address
  /** Exact ETH to spend (wei) — the WHOLE value is spent, no refund. */
  amountInWei: BigIntish
  /** Min vToken out after slippage. */
  minOut: BigIntish
}

/** Exact-input token buy via `buyTokensWithETH` — `value == amountIn` (never padded). */
export function buyTokens(ctx: TradeEncoderContext, params: BuyTokensParams): PlanStep {
  const zap = zapAddress(ctx)
  const collection = parseAddress(params.collection, 'collection')
  const amountIn = parsePositiveAmount(params.amountInWei, 'amountInWei')
  const minOut = parsePositiveAmount(params.minOut, 'minOut')
  return {
    id: 'buy',
    label: 'Buy token',
    address: zap,
    abi: nftxZapAbi,
    functionName: 'buyTokensWithETH',
    args: [collection, minOut],
    value: amountIn,
  }
}

export interface SellTokensParams {
  collection: Address
  /** The collection token (vToken) approved to the zap. */
  vToken: Address
  amountInWei: BigIntish
  minOut: BigIntish
  /** vToken→zap allowance already covers `amountIn` — skips the approval step. */
  vTokenApprovedToZap?: boolean
  /** Approve `MAX_UINT256` instead of the exact amount (opt-in; default exact). */
  maxApproval?: boolean
}

/** Exact-input token sell: `[approveErc20(exact)?]` + `sellTokensForETH`. */
export function sellTokens(ctx: TradeEncoderContext, params: SellTokensParams): PlanStep[] {
  const zap = zapAddress(ctx)
  const collection = parseAddress(params.collection, 'collection')
  const vToken = parseAddress(params.vToken, 'vToken')
  const amountIn = parsePositiveAmount(params.amountInWei, 'amountInWei')
  const minOut = parsePositiveAmount(params.minOut, 'minOut')
  return [
    approveErc20({
      token: vToken,
      spender: zap,
      amount: params.maxApproval ? MAX_UINT256 : amountIn,
      ...(params.vTokenApprovedToZap !== undefined
        ? { skip: params.vTokenApprovedToZap }
        : {}),
    }),
    {
      id: 'sell',
      label: 'Sell token',
      address: zap,
      abi: nftxZapAbi,
      functionName: 'sellTokensForETH',
      args: [collection, amountIn, minOut],
    },
  ]
}
