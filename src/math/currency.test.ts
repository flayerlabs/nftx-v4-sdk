import { describe, expect, it } from 'vitest'

import { InvalidInputError, UnsupportedChainError } from '../errors'
import {
  ARC_CHAIN_ID,
  nativeCurrency,
  nativeWeiToPoolUnits,
  poolUnitsToNativeWei,
} from './currency'

describe('native and pool currency units', () => {
  it.each([1, 8453, 84532, 4663, 46630, 57073, 42161, 11155111])(
    'leaves ETH amounts unchanged on chain %i',
    (chainId) => {
      expect(nativeCurrency(chainId)).toMatchObject({
        symbol: 'ETH',
        nativeDecimals: 18,
        poolDecimals: 18,
        poolScale: 1n,
        wrapped: true,
      })
      expect(poolUnitsToNativeWei(chainId, 123n)).toBe(123n)
      expect(nativeWeiToPoolUnits(chainId, 123n)).toBe(123n)
    },
  )

  it('scales Arc quotes by 1e12 and floors native inputs to 6-decimal USDC', () => {
    expect(nativeCurrency(ARC_CHAIN_ID)).toMatchObject({
      symbol: 'USDC',
      nativeDecimals: 18,
      poolDecimals: 6,
      poolScale: 10n ** 12n,
      wrapped: false,
    })
    expect(poolUnitsToNativeWei(ARC_CHAIN_ID, 1_234_567n)).toBe(1_234_567_000_000_000_000n)
    expect(nativeWeiToPoolUnits(ARC_CHAIN_ID, 1_234_567_999_999_999_999n)).toBe(1_234_567n)
    expect(nativeWeiToPoolUnits(ARC_CHAIN_ID, 999_999_999_999n)).toBe(0n)
    expect(nativeWeiToPoolUnits(ARC_CHAIN_ID, 1_000_000_000_000n)).toBe(1n)
  })

  it('accepts zero, preserves large bigint amounts and returns immutable metadata', () => {
    expect(poolUnitsToNativeWei(ARC_CHAIN_ID, 0n)).toBe(0n)
    expect(nativeWeiToPoolUnits(ARC_CHAIN_ID, 0n)).toBe(0n)
    const amount = 10n ** 30n + 1n
    expect(nativeWeiToPoolUnits(ARC_CHAIN_ID, poolUnitsToNativeWei(ARC_CHAIN_ID, amount))).toBe(
      amount,
    )
    expect(Object.isFrozen(nativeCurrency(ARC_CHAIN_ID))).toBe(true)
    expect(Object.isFrozen(nativeCurrency(1))).toBe(true)
  })

  it('rejects unsupported chains and invalid amounts', () => {
    expect(() => nativeCurrency(999)).toThrow(UnsupportedChainError)
    for (const convert of [nativeWeiToPoolUnits, poolUnitsToNativeWei]) {
      expect(() => convert(999, 1n)).toThrow(UnsupportedChainError)
      expect(() => convert(ARC_CHAIN_ID, -1n)).toThrow(InvalidInputError)
      expect(() => convert(1, -1n)).toThrow(InvalidInputError)
      expect(() => convert(1, 1 as unknown as bigint)).toThrow(InvalidInputError)
    }
  })
})
