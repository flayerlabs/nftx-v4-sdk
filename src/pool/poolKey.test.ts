import { describe, expect, it } from 'vitest'

import { NFTX_V4_DYNAMIC_FEE, NFTX_V4_TICK_SPACING } from '../constants/pool'
import { isInputCurrency0, nftxV4PoolKey, poolKeysEqual, sortCurrencies } from './poolKey'

const LOW = '0x0000000000000000000000000000000000000aaa' as const
const HIGH = '0x0000000000000000000000000000000000000bbb' as const
const HOOK = '0x0000000000000000000000000000000000000ccc' as const

describe('pool/poolKey', () => {
  it('orders currencies ascending and applies default params', () => {
    const key = nftxV4PoolKey(HIGH, LOW, HOOK)
    expect(key.currency0).toBe(LOW)
    expect(key.currency1).toBe(HIGH)
    expect(key.fee).toBe(NFTX_V4_DYNAMIC_FEE)
    expect(key.tickSpacing).toBe(NFTX_V4_TICK_SPACING)
    expect(key.hooks).toBe(HOOK)
  })

  it('flips currency0/1 when the vToken sorts above flETH', () => {
    // vToken HIGH, flETH LOW → flETH is currency0
    const a = nftxV4PoolKey(HIGH, LOW, HOOK)
    // vToken LOW, flETH HIGH → vToken is currency0
    const b = nftxV4PoolKey(LOW, HIGH, HOOK)
    expect(a.currency0).toBe(LOW)
    expect(b.currency0).toBe(LOW)
    expect(sortCurrencies(HIGH, LOW)).toEqual([LOW, HIGH])
  })

  it('compares pool keys case-insensitively', () => {
    const a = nftxV4PoolKey(HIGH, LOW, HOOK)
    const b = nftxV4PoolKey(HIGH.toUpperCase() as typeof HIGH, LOW, HOOK)
    expect(poolKeysEqual(a, b)).toBe(true)
    const c = nftxV4PoolKey(HIGH, LOW, HOOK, { tickSpacing: 30 })
    expect(poolKeysEqual(a, c)).toBe(false)
  })

  it('identifies the input currency slot', () => {
    const key = nftxV4PoolKey(HIGH, LOW, HOOK) // currency0 = LOW
    expect(isInputCurrency0(key, LOW)).toBe(true)
    expect(isInputCurrency0(key, HIGH)).toBe(false)
  })
})
