import { describe, expect, it } from 'vitest'

import { ONE_VTOKEN_WEI } from '../constants/pool'
import { InvalidInputError } from '../errors'
import { nftxV4PoolKey } from './poolKey'
import {
  floorBuyQuoteParams,
  floorSellQuoteParams,
  priceImpactBps,
  tokenBuyCostQuoteParams,
  tokenSwapInputCurrency,
  tokenSwapQuoteParams,
} from './quoteParams'

const VTOKEN = '0x0000000000000000000000000000000000000aaa' as const
const FLETH = '0x0000000000000000000000000000000000000bbb' as const
const HOOK = '0x0000000000000000000000000000000000000ccc' as const

// vToken < flETH → currency0 = vToken, currency1 = flETH
const key = nftxV4PoolKey(VTOKEN, FLETH, HOOK)

describe('pool/quoteParams', () => {
  it('builds an exact-output floor-buy (count whole vTokens)', () => {
    const params = floorBuyQuoteParams(key, VTOKEN, 3n)
    expect(params.exactAmount).toBe(3n * ONE_VTOKEN_WEI)
    // vToken is currency0 here, so zeroForOne (currency0->currency1) is false
    expect(params.zeroForOne).toBe(false)
    expect(params.hookData).toBe('0x')
  })

  it('builds arbitrary exact-output token costs and whole-token floor sells', () => {
    const exactOutput = tokenBuyCostQuoteParams(key, VTOKEN, 123n)
    expect(exactOutput.exactAmount).toBe(123n)
    expect(exactOutput.zeroForOne).toBe(false)

    const floorSell = floorSellQuoteParams(key, VTOKEN, FLETH, 3n)
    expect(floorSell.exactAmount).toBe(3n * ONE_VTOKEN_WEI)
    expect(floorSell.zeroForOne).toBe(true)
  })

  it('resolves the token-swap input currency by side', () => {
    expect(tokenSwapInputCurrency('buy', VTOKEN, FLETH)).toBe(FLETH)
    expect(tokenSwapInputCurrency('sell', VTOKEN, FLETH)).toBe(VTOKEN)
  })

  it('builds exact-input token swaps with the right direction', () => {
    // sell: input = vToken = currency0 → zeroForOne true
    const sell = tokenSwapQuoteParams('sell', key, VTOKEN, FLETH, 10n)
    expect(sell.zeroForOne).toBe(true)
    expect(sell.exactAmount).toBe(10n)
    // buy: input = flETH = currency1 → zeroForOne false
    const buy = tokenSwapQuoteParams('buy', key, VTOKEN, FLETH, 10n)
    expect(buy.zeroForOne).toBe(false)
  })

  it('rejects non-positive amounts', () => {
    expect(() => floorBuyQuoteParams(key, VTOKEN, 0n)).toThrow(InvalidInputError)
    expect(() => tokenBuyCostQuoteParams(key, VTOKEN, 0n)).toThrow(InvalidInputError)
    expect(() => floorSellQuoteParams(key, VTOKEN, FLETH, 0n)).toThrow(InvalidInputError)
    expect(() => tokenSwapQuoteParams('buy', key, VTOKEN, FLETH, 0n)).toThrow(InvalidInputError)
  })

  it('rejects exact amounts that exceed the Quoter uint128 field', () => {
    const tooLarge = 1n << 128n
    expect(() => tokenBuyCostQuoteParams(key, VTOKEN, tooLarge)).toThrow(InvalidInputError)
    expect(() => tokenSwapQuoteParams('sell', key, VTOKEN, FLETH, tooLarge)).toThrow(
      InvalidInputError,
    )
  })

  it('measures adverse price impact in basis points', () => {
    expect(priceImpactBps(15_000n, 13_200n)).toBe(1_200)
    expect(priceImpactBps(1_000n, 1_500n)).toBe(0)
    expect(() => priceImpactBps(0n, 1n)).toThrow(InvalidInputError)
  })
})
