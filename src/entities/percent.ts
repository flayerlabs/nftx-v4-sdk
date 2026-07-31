import { InvalidInputError } from '../errors'

/**
 * A minimal, immutable slippage carrier — self-documenting at call sites where a
 * bare `slippageBps: number` is ambiguous. It holds basis points and nothing
 * else; the rounding math lives in `math/slippage` (a `Percent` never rounds).
 */
export class Percent {
  readonly bps: number

  private constructor(bps: number) {
    if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
      throw new InvalidInputError('Percent must be an integer 0–10000 bps (0–100%).')
    }
    this.bps = bps
    Object.freeze(this)
  }

  /** From basis points (e.g. `50` → 0.50%). */
  static fromBps(bps: number): Percent {
    return new Percent(bps)
  }

  /** From a percent value (e.g. `0.5` → 50 bps). */
  static fromPercent(percent: number): Percent {
    return new Percent(Math.round(percent * 100))
  }

  toBps(): number {
    return this.bps
  }

  toPercent(): number {
    return this.bps / 100
  }
}
