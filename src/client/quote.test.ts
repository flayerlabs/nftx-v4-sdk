import { describe, expect, it, vi } from 'vitest'
import { BaseError, ContractFunctionRevertedError, type Address, type PublicClient } from 'viem'

import { BUY_QUOTE_BUFFER_BPS } from '../constants/pool'
import { Vault } from '../entities/vault'
import { InvalidInputError } from '../errors'
import { nftxV4PoolKey } from '../pool/poolKey'
import { ReadNftxSdk } from './read'

const CHAIN = 1
const FLETH = '0x000000000bB1f9944965c64066D10038a84F9af2'
const HOOK = '0xaa49ADaDD33c5E953b645567AFb10CBbba63afC4'
const COLLECTION = '0x97df1a364c1f1f6bb1f5b6e6f6b6f6b6f6b6aeaa'
const VTOKEN = '0x06c203495b3090f5a8a73ecda79bac54f60e7220'

// Pre-resolved vault so the quote tests exercise only the simulate path.
const vault = Vault.create({
  chainId: CHAIN,
  collection: COLLECTION,
  collectionToken: VTOKEN,
  poolKey: nftxV4PoolKey(VTOKEN, FLETH, HOOK),
})

function quoteClient(result: bigint | (() => never)): PublicClient {
  return {
    simulateContract: async () => {
      if (typeof result === 'function') result()
      return { result: [result, 21_000n] as const, request: {} }
    },
  } as unknown as PublicClient
}

function listingQuoteClient(tax: bigint, amountOut: bigint): PublicClient {
  return {
    simulateContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === 'getListingTaxRequired') {
        return { result: tax, request: {} }
      }
      if (functionName === 'quoteExactInputSingle') {
        return { result: [amountOut, 21_000n] as const, request: {} }
      }
      throw new Error(`unexpected simulation: ${functionName}`)
    },
  } as unknown as PublicClient
}

describe('ReadNftxSdk: quoting', () => {
  it('quotes exact output in both directions without changing swap direction', async () => {
    const simulateContract = vi.fn(async () => ({ result: [123n, 0n] as const }))
    const sdk = new ReadNftxSdk({
      chainId: CHAIN,
      publicClient: { simulateContract } as unknown as PublicClient,
    })
    expect(await sdk.quoteTokenSwapExactOut('buy', COLLECTION, 999n, { vault })).toBe(123n)
    expect(simulateContract).toHaveBeenLastCalledWith(
      expect.objectContaining({
        functionName: 'quoteExactOutputSingle',
        args: [expect.objectContaining({ exactAmount: 999n, zeroForOne: true })],
      }),
    )
    expect(await sdk.quoteTokenSwapExactOut('sell', COLLECTION, 888n, { vault })).toBe(123n)
    expect(simulateContract).toHaveBeenLastCalledWith(
      expect.objectContaining({
        args: [expect.objectContaining({ exactAmount: 888n, zeroForOne: false })],
      }),
    )
  })

  it('converts Arc quote amounts between pool units and native wei', async () => {
    const pair = '0x3600000000000000000000000000000000000000'
    const arcVault = Vault.create({
      chainId: 5042,
      collection: COLLECTION,
      collectionToken: VTOKEN,
      poolKey: nftxV4PoolKey(VTOKEN, pair, HOOK),
    })
    const simulateContract = vi.fn(async () => ({ result: [2n, 0n] as const }))
    const sdk = new ReadNftxSdk({
      chainId: 5042,
      publicClient: { simulateContract } as unknown as PublicClient,
    })
    expect(await sdk.quoteTokenSwap('buy', COLLECTION, 3n * 10n ** 12n, { vault: arcVault })).toBe(
      2n,
    )
    expect(simulateContract).toHaveBeenLastCalledWith(
      expect.objectContaining({
        args: [expect.objectContaining({ exactAmount: 3n })],
      }),
    )
    expect(await sdk.quoteTokenSwapExactOut('buy', COLLECTION, 999n, { vault: arcVault })).toBe(
      2n * 10n ** 12n,
    )
    expect(simulateContract).toHaveBeenLastCalledWith(
      expect.objectContaining({ args: [expect.objectContaining({ exactAmount: 999n })] }),
    )
    expect(await sdk.quoteTokenSwap('sell', COLLECTION, 3n, { vault: arcVault })).toBe(
      2n * 10n ** 12n,
    )
    expect(await sdk.quoteFloorBuy(COLLECTION, 1n, { vault: arcVault })).toBe(2n * 10n ** 12n)
    expect(await sdk.quoteSellNfts(COLLECTION, 1n, { vault: arcVault })).toBe(2n * 10n ** 12n)
    expect(await sdk.quoteTokenBuyCost(COLLECTION, 3n, { vault: arcVault })).toBe(2n * 10n ** 12n)
    expect(
      await sdk.quoteTokenSwapExactOut('sell', COLLECTION, 10n ** 12n + 1n, { vault: arcVault }),
    ).toBe(2n)
    expect(simulateContract).toHaveBeenLastCalledWith(
      expect.objectContaining({
        args: [expect.objectContaining({ exactAmount: 2n })],
      }),
    )
    await expect(
      sdk.quoteTokenSwap('buy', COLLECTION, 1n, { vault: arcVault }),
    ).rejects.toBeInstanceOf(InvalidInputError)
  })
  it('quotes a floor buy (exact-output amountIn) and caps with the buffer', async () => {
    const sdk = new ReadNftxSdk({ chainId: CHAIN, publicClient: quoteClient(1000n) })
    expect(await sdk.quoteFloorBuy(COLLECTION, 2, { vault })).toBe(1000n)
    const { amountIn, maxSpend } = await sdk.quoteFloorBuyWithSlippage(COLLECTION, 2, { vault })
    expect(amountIn).toBe(1000n)
    // ceil(1000 * (10000 + 300) / 10000) = 1030
    expect(maxSpend).toBe(1030n)
    expect(BUY_QUOTE_BUFFER_BPS).toBe(300)
  })

  it('quotes an NFT sell and floors minOut', async () => {
    const sdk = new ReadNftxSdk({ chainId: CHAIN, publicClient: quoteClient(1000n) })
    expect(await sdk.quoteSellNfts(COLLECTION, 1, { vault })).toBe(1000n)
    const { amountOut, minOut } = await sdk.quoteSellNftsWithSlippage(COLLECTION, 1, {
      slippageBps: 50,
      vault,
    })
    expect(amountOut).toBe(1000n)
    expect(minOut).toBe(995n) // floor(1000 * 9950 / 10000)
  })

  it('quotes a token swap in both directions', async () => {
    const sdk = new ReadNftxSdk({ chainId: CHAIN, publicClient: quoteClient(900n) })
    expect(await sdk.quoteTokenSwap('buy', COLLECTION, 10n ** 18n, { vault })).toBe(900n)
    const { minOut } = await sdk.quoteTokenSwapWithSlippage('sell', COLLECTION, 10n ** 18n, {
      slippageBps: 100,
      vault,
    })
    expect(minOut).toBe(891n) // floor(900 * 9900 / 10000)
  })

  it('quotes an arbitrary exact-output token shortfall', async () => {
    const sdk = new ReadNftxSdk({ chainId: CHAIN, publicClient: quoteClient(777n) })
    expect(await sdk.quoteTokenBuyCost(COLLECTION, 123n, { vault })).toBe(777n)
    await expect(sdk.quoteTokenBuyCost(COLLECTION, 0n, { vault })).rejects.toBeInstanceOf(
      InvalidInputError,
    )
  })

  it('quotes listing tax and the net token-to-ETH payout', async () => {
    const sdk = new ReadNftxSdk({
      chainId: CHAIN,
      publicClient: listingQuoteClient(100n, 1_000n),
    })
    const owner = '0x1111111111111111111111111111111111111111' as Address
    const listing = { owner, created: 0, duration: 604_800, floorMultiple: 150 }

    expect(await sdk.quoteListingTax(COLLECTION, listing)).toBe(100n)
    await expect(
      sdk.quoteListingPayout(COLLECTION, [listing, listing], {
        vault,
        slippageBps: 50,
      }),
    ).resolves.toEqual({
      tax: 200n,
      netTokens: 2n * 10n ** 18n - 200n,
      amountOut: 1_000n,
      minOut: 995n,
    })
  })

  it('bounds concurrent listing-tax simulations while preserving all distinct terms', async () => {
    let inFlight = 0
    let maxInFlight = 0
    let taxCalls = 0
    const publicClient = {
      simulateContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === 'getListingTaxRequired') {
          taxCalls += 1
          inFlight += 1
          maxInFlight = Math.max(maxInFlight, inFlight)
          await Promise.resolve()
          inFlight -= 1
          return { result: 1n, request: {} }
        }
        if (functionName === 'quoteExactInputSingle') {
          return { result: [1_000n, 21_000n] as const, request: {} }
        }
        throw new Error(`unexpected simulation: ${functionName}`)
      },
    } as unknown as PublicClient
    const sdk = new ReadNftxSdk({ chainId: CHAIN, publicClient })
    const owner = '0x1111111111111111111111111111111111111111' as Address
    const listings = Array.from({ length: 12 }, (_, index) => ({
      owner,
      created: 0,
      duration: 604_800,
      floorMultiple: 101 + index,
    }))

    await expect(sdk.quoteListingPayout(COLLECTION, listings, { vault })).resolves.toMatchObject({
      tax: 12n,
    })
    expect(taxCalls).toBe(12)
    expect(maxInFlight).toBe(6)
  })

  it('rejects tax that exhausts the released tokens before quoting the swap', async () => {
    let quoterCalls = 0
    const publicClient = {
      simulateContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === 'getListingTaxRequired') {
          return { result: 10n ** 18n, request: {} }
        }
        if (functionName === 'quoteExactInputSingle') {
          quoterCalls += 1
          return { result: [1_000n, 21_000n] as const, request: {} }
        }
        throw new Error(`unexpected simulation: ${functionName}`)
      },
    } as unknown as PublicClient
    const sdk = new ReadNftxSdk({ chainId: CHAIN, publicClient })
    const owner = '0x1111111111111111111111111111111111111111' as Address

    await expect(
      sdk.quoteListingPayout(
        COLLECTION,
        [{ owner, created: 0, duration: 604_800, floorMultiple: 150 }],
        { vault },
      ),
    ).rejects.toBeInstanceOf(InvalidInputError)
    expect(quoterCalls).toBe(0)
  })

  it('rejects invalid listing terms before RPC', async () => {
    const sdk = new ReadNftxSdk({
      chainId: CHAIN,
      publicClient: listingQuoteClient(100n, 1_000n),
    })
    const owner = '0x1111111111111111111111111111111111111111' as Address
    await expect(
      sdk.quoteListingTax(COLLECTION, {
        owner,
        created: 0,
        duration: 0,
        floorMultiple: 150,
      }),
    ).rejects.toBeInstanceOf(InvalidInputError)
    await expect(sdk.quoteListingPayout(COLLECTION, [], { vault })).rejects.toBeInstanceOf(
      InvalidInputError,
    )
  })

  it('rejects non-positive amounts before any RPC', async () => {
    const sdk = new ReadNftxSdk({ chainId: CHAIN, publicClient: quoteClient(1n) })
    await expect(sdk.quoteFloorBuy(COLLECTION, 0, { vault })).rejects.toBeInstanceOf(
      InvalidInputError,
    )
    await expect(sdk.quoteTokenSwap('buy', COLLECTION, 0, { vault })).rejects.toBeInstanceOf(
      InvalidInputError,
    )
  })

  it('rejects unsafe slippage on a floored output', async () => {
    const sdk = new ReadNftxSdk({ chainId: CHAIN, publicClient: quoteClient(1000n) })
    await expect(
      sdk.quoteSellNftsWithSlippage(COLLECTION, 1, { slippageBps: 10_000, vault }),
    ).rejects.toBeInstanceOf(InvalidInputError)
  })

  it('maps a Quoter revert to a typed error', async () => {
    const sdk = new ReadNftxSdk({
      chainId: CHAIN,
      publicClient: quoteClient(() => {
        throw new BaseError('reverted', {
          cause: new ContractFunctionRevertedError({
            abi: [],
            functionName: 'quoteExactOutputSingle',
            message: 'PoolNotInitialized',
          }),
        })
      }),
    })
    await expect(sdk.quoteFloorBuy(COLLECTION, 1, { vault })).rejects.toBeInstanceOf(
      InvalidInputError,
    )
  })

  it('keeps Quoter transport failures distinct from bad pool input', async () => {
    const sdk = new ReadNftxSdk({
      chainId: CHAIN,
      publicClient: quoteClient(() => {
        throw new BaseError('rate limited')
      }),
    })
    await expect(sdk.quoteFloorBuy(COLLECTION, 1, { vault })).rejects.toMatchObject({
      code: 'WALLET',
    })
  })
})
