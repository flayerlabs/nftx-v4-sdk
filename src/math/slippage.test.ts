import { describe, expect, it } from 'vitest'

import { InvalidInputError } from '../errors'
import {
  assertSafeSlippageForFloor,
  bpsToPercent,
  grossUpForSlippage,
  maxSpendWithSlippage,
  minOutWithSlippage,
  percentToBps,
} from './slippage'

describe('math/slippage', () => {
  it('grosses up to the smallest quote that covers the typed minimum', () => {
    for (const minimum of [0n, 1n, 7n, 1001n]) {
      for (const bps of [0, 1, 50, 9999]) {
        const gross = grossUpForSlippage(minimum, bps)
        expect(minOutWithSlippage(gross, bps)).toBeGreaterThanOrEqual(minimum)
        if (gross > 0n) expect(minOutWithSlippage(gross - 1n, bps)).toBeLessThan(minimum)
      }
    }
    expect(() => grossUpForSlippage(1n, 10000)).toThrow(InvalidInputError)
    expect(() => grossUpForSlippage(-1n, 50)).toThrow(InvalidInputError)
  })
  it('floors minOut and ceils maxSpend (the rounding contract)', () => {
    // 1000 wei, 50 bps (0.5%)
    expect(minOutWithSlippage(1000n, 50)).toBe(995n)
    // ceil: 1000 * 10050 / 10000 = 1005
    expect(maxSpendWithSlippage(1000n, 50)).toBe(1005n)
    // rounding: minOut of 7 wei @ 1bps floors to 6; maxSpend ceils to 8
    expect(minOutWithSlippage(7n, 1)).toBe(6n)
    expect(maxSpendWithSlippage(7n, 1)).toBe(8n)
  })

  it('round-trips percent and bps', () => {
    expect(percentToBps(0.5)).toBe(50)
    expect(bpsToPercent(50)).toBe(0.5)
  })

  it('rejects out-of-range or non-integer bps', () => {
    expect(() => minOutWithSlippage(100n, -1)).toThrow(InvalidInputError)
    expect(() => minOutWithSlippage(100n, 10_001)).toThrow(InvalidInputError)
    expect(() => maxSpendWithSlippage(100n, 1.5)).toThrow(InvalidInputError)
    expect(() => minOutWithSlippage(-1n, 50)).toThrow(InvalidInputError)
  })

  it('guards a slippage-floor output against disabling MEV protection', () => {
    expect(() => assertSafeSlippageForFloor(10_000)).toThrow(InvalidInputError) // minOut=0
    expect(() => assertSafeSlippageForFloor(6_000)).toThrow(InvalidInputError) // > MAX_SAFE
    expect(() => assertSafeSlippageForFloor(50)).not.toThrow()
    expect(() => assertSafeSlippageForFloor(10_000, true)).not.toThrow() // explicit opt-in
  })
})
