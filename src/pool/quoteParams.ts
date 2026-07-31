import { maxUint128, type Address, type Hex } from 'viem'

import { ONE_VTOKEN_WEI } from '../constants/pool'
import { InvalidInputError } from '../errors'
import { parsePositiveAmount } from '../lib/validate'
import { isInputCurrency0, type V4PoolKey } from './poolKey'

/**
 * Builders that shape a Uniswap v4 Quoter `quoteExactInput/OutputSingle` call.
 * An NFTX floor redeem buys a *whole* vToken out of the pool, so its cost is the
 * pool's exact-output quote (price impact + dynamic fee + flETH) — not the
 * indexer's marginal floor, which understates it (often badly on thin pools).
 */
export interface QuoteExactSingleParams {
  poolKey: V4PoolKey
  zeroForOne: boolean
  exactAmount: bigint
  hookData: Hex
}

/** The two token-swap directions in the user's terms. */
export type TokenSwapSide = 'buy' | 'sell'

function assertQuoteAmount(amount: bigint, label: string): void {
  parsePositiveAmount(amount, label)
  if (amount > maxUint128) {
    throw new InvalidInputError(`${label} exceeds the Quoter uint128 limit.`)
  }
}

/** The input currency of an exact-input token swap: flETH for a buy, vToken for a sell. */
export function tokenSwapInputCurrency(
  side: TokenSwapSide,
  vToken: Address,
  flEth: Address,
): Address {
  return side === 'buy' ? flEth : vToken
}

/**
 * Quoter params for buying `count` whole vTokens out of the pool (exact-output),
 * paying flETH. `zeroForOne` (currency0→currency1) is true when the vToken is the
 * pool's `currency1`, so flETH (= currency0) is the swap input.
 */
export function floorBuyQuoteParams(
  poolKey: V4PoolKey,
  vToken: Address,
  count: bigint,
): QuoteExactSingleParams {
  if (count <= 0n) throw new InvalidInputError('Nothing selected to buy.')
  return tokenBuyCostQuoteParams(poolKey, vToken, count * ONE_VTOKEN_WEI)
}

/**
 * Quoter params for buying an arbitrary exact output of collection tokens,
 * paying flETH. Mixed NFT/token baskets use this to price only their uncovered
 * token shortfall rather than rounding it to whole NFTs.
 */
export function tokenBuyCostQuoteParams(
  poolKey: V4PoolKey,
  vToken: Address,
  tokensOutWei: bigint,
): QuoteExactSingleParams {
  assertQuoteAmount(tokensOutWei, 'tokensOutWei')
  return {
    poolKey,
    zeroForOne: poolKey.currency1.toLowerCase() === vToken.toLowerCase(),
    exactAmount: tokensOutWei,
    hookData: '0x',
  }
}

/** Exact-input quote params for selling `count` whole NFTs through the pool. */
export function floorSellQuoteParams(
  poolKey: V4PoolKey,
  vToken: Address,
  flEth: Address,
  count: bigint,
): QuoteExactSingleParams {
  if (count <= 0n) throw new InvalidInputError('Nothing selected to sell.')
  return tokenSwapQuoteParams('sell', poolKey, vToken, flEth, count * ONE_VTOKEN_WEI)
}

/**
 * Quoter params for an exact-input single swap: spend `exactAmountWei` of the
 * side's input currency (flETH for a buy, the vToken for a sell) for the other.
 * `zeroForOne` follows whichever slot the input currency occupies.
 */
export function tokenSwapQuoteParams(
  side: TokenSwapSide,
  poolKey: V4PoolKey,
  vToken: Address,
  flEth: Address,
  exactAmountWei: bigint,
): QuoteExactSingleParams {
  assertQuoteAmount(exactAmountWei, 'exactAmountWei')
  const input = tokenSwapInputCurrency(side, vToken, flEth)
  return {
    poolKey,
    zeroForOne: isInputCurrency0(poolKey, input),
    exactAmount: exactAmountWei,
    hookData: '0x',
  }
}

/**
 * How far an execution quote falls below a reference value, in basis points.
 * Quotes at or above the reference have zero adverse impact.
 */
export function priceImpactBps(referenceWei: bigint, quotedOutWei: bigint): number {
  if (referenceWei <= 0n) {
    throw new InvalidInputError('referenceWei must be greater than zero.')
  }
  if (quotedOutWei < 0n) {
    throw new InvalidInputError('quotedOutWei must not be negative.')
  }
  if (quotedOutWei >= referenceWei) return 0
  return Number(((referenceWei - quotedOutWei) * 10_000n) / referenceWei)
}
