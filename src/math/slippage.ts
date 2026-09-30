import { MAX_SAFE_SLIPPAGE_BPS } from '../constants/pool'
import { InvalidInputError } from '../errors'

/**
 * Slippage / bound math. The rounding DIRECTION is the financial contract:
 *   - `minOutWithSlippage` rounds DOWN (floor) so the on-chain minimum is never
 *     above what was quoted.
 *   - `maxSpendWithSlippage` rounds UP (ceil) so a rounding loss can't push the
 *     cap below the real cost.
 * Keep this logic here, not in the `Percent` carrier.
 */
const BPS_DENOMINATOR = 10_000n

/** Percent (e.g. `0.5`) → basis points (`50`). */
export const percentToBps = (percent: number): number => Math.round(percent * 100)

/** Basis points (`50`) → percent (`0.5`). */
export const bpsToPercent = (bps: number): number => bps / 100

function assertBps(slippageBps: number): void {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
    throw new InvalidInputError('Slippage must be an integer between 0 and 10000 bps (0–100%).')
  }
}

/**
 * Floor `amountOut` by the slippage tolerance — the `amountOutMinimum` the swap
 * will accept (rounded DOWN).
 */
export function minOutWithSlippage(amountOut: bigint, slippageBps: number): bigint {
  assertBps(slippageBps)
  if (amountOut < 0n) throw new InvalidInputError('Quote output cannot be negative.')
  return (amountOut * (BPS_DENOMINATOR - BigInt(slippageBps))) / BPS_DENOMINATOR
}

/** Expected output whose slippage floor covers an explicitly requested minimum. */
export function grossUpForSlippage(minOut: bigint, slippageBps: number): bigint {
  assertBps(slippageBps)
  if (minOut < 0n) throw new InvalidInputError('Minimum output cannot be negative.')
  if (slippageBps === 10_000) throw new InvalidInputError('Cannot gross up at 100% slippage.')
  const kept = BPS_DENOMINATOR - BigInt(slippageBps)
  return (minOut * BPS_DENOMINATOR + kept - 1n) / kept
}

/**
 * Cap `amount` by the slippage tolerance — a max the wallet won't exceed
 * (rounded UP via ceil-division).
 */
export function maxSpendWithSlippage(amount: bigint, slippageBps: number): bigint {
  assertBps(slippageBps)
  if (amount < 0n) throw new InvalidInputError('Quote amount cannot be negative.')
  const numerator = amount * (BPS_DENOMINATOR + BigInt(slippageBps))
  return (numerator + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR
}

/**
 * Guard a caller-supplied slippage for a true slippage-FLOOR output (sell /
 * buy-tokens `minOut`): reject a value that would zero out the floor (turning off
 * MEV protection) or exceed the safe ceiling, unless `allowUnsafe` is set. Does
 * not apply to listed buys (`buyNFTWithETH` legitimately passes
 * `_minTokensReceived = 0`; `_maxETHSpent` bounds the fill and unused
 * exact-input value returns as collection tokens).
 */
export function assertSafeSlippageForFloor(slippageBps: number, allowUnsafe = false): void {
  assertBps(slippageBps)
  if (allowUnsafe) return
  if (slippageBps >= 10_000) {
    throw new InvalidInputError('Slippage of 100% would disable MEV protection (minOut=0).')
  }
  if (slippageBps > MAX_SAFE_SLIPPAGE_BPS) {
    throw new InvalidInputError(
      `Slippage ${slippageBps} bps exceeds the safe maximum of ${MAX_SAFE_SLIPPAGE_BPS} bps; pass allowUnsafe to override.`,
    )
  }
}
