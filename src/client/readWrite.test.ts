import { describe, expect, it, vi } from 'vitest'
import { encodeAbiParameters, type PublicClient, type WalletClient } from 'viem'

import { ChainMismatchError, InvalidInputError, ReadNftxSdk, WalletError } from '../index'
import { Vault } from '../entities/vault'
import { nftxV4PoolKey, poolKeyAbiParameter } from '../pool/poolKey'
import { createNftxSdk } from './factory'
import { ReadWriteNftxSdk } from './readWrite'

const CHAIN = 1
const ACCOUNT = '0x1111111111111111111111111111111111111111'
const COLLECTION = '0x97df1a364c1f1f6bb1f5b6e6f6b6f6b6f6b6aeaa'
const VTOKEN = '0x06c203495b3090f5a8a73ecda79bac54f60e7220'
const FLETH = '0x000000000bB1f9944965c64066D10038a84F9af2'
const HOOK = '0xaa49ADaDD33c5E953b645567AFb10CBbba63afC4'

const vault = Vault.create({
  chainId: CHAIN,
  collection: COLLECTION,
  collectionToken: VTOKEN,
  poolKey: nftxV4PoolKey(VTOKEN, FLETH, HOOK),
})

interface FakeOpts {
  code?: string
  capabilities?: unknown
  reads?: Record<string, unknown>
  receiptStatus?: 'success' | 'reverted'
  callsStatus?: 'success' | 'failure'
  callsAtomic?: boolean
  callsReceipts?: { transactionHash: string; status?: 'success' | 'reverted' }[]
}

function fakes(opts: FakeOpts = {}) {
  const writeContract = vi.fn(async () => '0xhash')
  const sendCalls = vi.fn(async () => ({ id: '0xbatch' }))
  const publicClient = {
    chain: { id: CHAIN },
    getCode: vi.fn(async () => opts.code ?? '0x6000'),
    simulateContract: vi.fn(async () => ({ result: [1000n, 0n], request: {} })),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      const defaults: Record<string, unknown> = {
        collectionToken: VTOKEN,
        collectionInitialized: true,
        getCollectionPoolKey: encodeAbiParameters([poolKeyAbiParameter], [vault.poolKey]),
        isApprovedForAll: false,
        allowance: 0n,
      }
      return functionName in (opts.reads ?? {})
        ? opts.reads?.[functionName]
        : defaults[functionName]
    }),
    waitForTransactionReceipt: vi.fn(async () => ({
      status: opts.receiptStatus ?? 'success',
      transactionHash: '0xrcpt',
    })),
  } as unknown as PublicClient
  const walletClient = {
    account: { address: ACCOUNT },
    chain: { id: CHAIN },
    getCapabilities: vi.fn(async () => opts.capabilities ?? {}),
    switchChain: vi.fn(async () => {}),
    writeContract,
    sendCalls,
    waitForCallsStatus: vi.fn(async () => ({
      status: opts.callsStatus ?? 'success',
      statusCode: 200,
      atomic: opts.callsAtomic ?? true,
      receipts: opts.callsReceipts ?? [{ transactionHash: '0xrcpt' }],
    })),
  } as unknown as WalletClient
  return { publicClient, walletClient, writeContract, sendCalls }
}

describe('createNftxSdk', () => {
  it('returns Read vs ReadWrite per the injected clients', () => {
    const { publicClient, walletClient } = fakes()
    expect(createNftxSdk({ publicClient })).toBeInstanceOf(ReadNftxSdk)
    expect(createNftxSdk({ publicClient, walletClient })).toBeInstanceOf(ReadWriteNftxSdk)
  })

  it('throws when the public client has no chain', () => {
    const publicClient = {} as unknown as PublicClient
    expect(() => createNftxSdk({ publicClient })).toThrow(InvalidInputError)
  })

  it('throws when the wallet chain disagrees with the public chain', () => {
    const { publicClient } = fakes()
    const walletClient = {
      account: { address: ACCOUNT },
      chain: { id: 8453 },
    } as unknown as WalletClient
    expect(() => createNftxSdk({ publicClient, walletClient })).toThrow(ChainMismatchError)
  })
})

describe('ReadWriteNftxSdk: trade writes', () => {
  it('requires owner consent before overwriting paid or unreadable Punk offers', async () => {
    for (const readFailed of [false, true]) {
      const f = fakes()
      const sdk = createNftxSdk({ publicClient: f.publicClient, walletClient: f.walletClient })
      vi.spyOn(sdk, 'nftApproval').mockResolvedValue({
        kind: 'punks',
        verdicts: [
          {
            tokenId: 1n,
            authorised: false,
            readFailed,
            standingSalePriceWei: readFailed ? 0n : 10n,
          },
        ],
      })
      const input = {
        collection: '0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB' as const,
        tokenIds: [1n],
        minOut: 1000n,
      }
      await expect(sdk.sellNfts(input)).rejects.toBeInstanceOf(InvalidInputError)
      expect(f.writeContract).not.toHaveBeenCalled()
      expect(f.sendCalls).not.toHaveBeenCalled()
      const result = await sdk.sellNfts({ ...input, allowPunkOfferOverwrite: true })
      expect(result.mode === 'submit' && result.state.status).toBe('success')
      expect(f.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'offerPunkForSaleToAddress',
          args: [1n, 0n, expect.any(String)],
        }),
      )
    }
  })

  it('never writes a Punk offer when its configured operator has no code', async () => {
    const f = fakes({ reads: { punksOfferedForSale: [false, 1n, ACCOUNT, 0n, ACCOUNT] } })
    const operator = '0x0000000000000000000000000000000000001234'
    vi.mocked(f.publicClient.getCode).mockImplementation(async ({ address }) =>
      address.toLowerCase() === operator.toLowerCase() ? '0x' : '0x6000',
    )
    const sdk = createNftxSdk({
      publicClient: f.publicClient,
      walletClient: f.walletClient,
      contracts: { nftxZap: operator },
    })
    const result = await sdk.sellNfts({
      collection: '0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB',
      tokenIds: [1n],
      minOut: 1000n,
    })
    expect(result.mode === 'submit' && result.state.errorCode).toBe('OPERATOR_NOT_CONTRACT')
    expect(f.writeContract).not.toHaveBeenCalled()
  })
  it('buyNfts (floor, submit) quotes-skipped, guards, executes sequentially', async () => {
    const f = fakes()
    const sdk = createNftxSdk({ publicClient: f.publicClient, walletClient: f.walletClient })
    const result = await sdk.buyNfts({ collection: COLLECTION, tokenIds: [1n], maxSpend: 1000n })
    expect(result.mode).toBe('submit')
    if (result.mode !== 'submit') throw new Error('unreachable')
    expect(result.state.status).toBe('success')
    expect(result.state.execution).toBe('sequential')
    expect(f.writeContract).toHaveBeenCalledTimes(1)
  })

  it('buyNfts keeps multiple listed NFTs in owner-safe singleton groups', async () => {
    const f = fakes()
    const sdk = createNftxSdk({ publicClient: f.publicClient, walletClient: f.walletClient })

    await sdk.buyNfts({
      collection: COLLECTION,
      tokenIds: [1n, 2n],
      maxSpend: 1000n,
      listed: true,
    })

    expect(f.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'buyNFTWithETH',
        args: [expect.any(String), [[1n], [2n]], 0n, 1000n],
        value: 1000n,
      }),
    )
  })

  it('calldata mode returns guarded calls and sends nothing', async () => {
    const f = fakes()
    const sdk = createNftxSdk({ publicClient: f.publicClient, walletClient: f.walletClient })
    const result = await sdk.buyNfts(
      { collection: COLLECTION, tokenIds: [1n], maxSpend: 1000n },
      { mode: 'calldata' },
    )
    expect(result.mode).toBe('calldata')
    if (result.mode !== 'calldata') throw new Error('unreachable')
    expect(result.chainId).toBe(CHAIN)
    expect(result.account).toBe(ACCOUNT)
    expect(result.calls).toHaveLength(1)
    expect(result.calls[0]?.value).toBe('0x3e8')
    expect(JSON.parse(JSON.stringify(result.calls[0])).value).toBe('0x3e8')
    expect(f.writeContract).not.toHaveBeenCalled()
    expect(f.sendCalls).not.toHaveBeenCalled()
  })

  it('calldata mode rejects unsafe calls before returning bytes', async () => {
    const f = fakes({ code: '0x' })
    const sdk = createNftxSdk({ publicClient: f.publicClient, walletClient: f.walletClient })
    await expect(
      sdk.buyNfts(
        { collection: COLLECTION, tokenIds: [1n], maxSpend: 1000n },
        { mode: 'calldata' },
      ),
    ).rejects.toMatchObject({ code: 'OPERATOR_NOT_CONTRACT' })
    expect(f.writeContract).not.toHaveBeenCalled()
    expect(f.sendCalls).not.toHaveBeenCalled()
  })

  it('calldata mode reasserts the wallet chain before returning account-derived calls', async () => {
    const f = fakes()
    const sdk = createNftxSdk({ publicClient: f.publicClient, walletClient: f.walletClient })
    ;(f.walletClient as unknown as { chain: { id: number } }).chain.id = 8453
    await expect(
      sdk.buyNfts(
        { collection: COLLECTION, tokenIds: [1n], maxSpend: 1000n },
        { mode: 'calldata' },
      ),
    ).rejects.toBeInstanceOf(ChainMismatchError)
  })

  it('rejects caller-supplied zero minOut before value-bearing plans are built', async () => {
    const f = fakes()
    const sdk = createNftxSdk({ publicClient: f.publicClient, walletClient: f.walletClient })
    await expect(
      sdk.sellNfts({ collection: COLLECTION, tokenIds: [1n], minOut: 0n }),
    ).rejects.toBeInstanceOf(InvalidInputError)
    await expect(
      sdk.buyTokens({ collection: COLLECTION, amountInWei: 1n, minOut: 0n }),
    ).rejects.toBeInstanceOf(InvalidInputError)
    await expect(
      sdk.sellTokens({ collection: COLLECTION, amountInWei: 1n, minOut: 0n }),
    ).rejects.toBeInstanceOf(InvalidInputError)
    expect(f.writeContract).not.toHaveBeenCalled()
    expect(f.sendCalls).not.toHaveBeenCalled()
  })

  it('rejects positive caller-supplied bounds outside the fresh quote sanity envelope', async () => {
    const f = fakes()
    const sdk = createNftxSdk({ publicClient: f.publicClient, walletClient: f.walletClient })
    vi.spyOn(sdk, 'quoteFloorBuy').mockResolvedValue(1000n)
    vi.spyOn(sdk, 'quoteSellNfts').mockResolvedValue(1000n)
    vi.spyOn(sdk, 'quoteTokenSwap').mockResolvedValue(1000n)
    vi.spyOn(sdk, 'resolveVault').mockResolvedValue(vault)

    await expect(
      sdk.buyNfts({ collection: COLLECTION, tokenIds: [1n], maxSpend: 1501n }),
    ).rejects.toBeInstanceOf(InvalidInputError)
    await expect(
      sdk.sellNfts({ collection: COLLECTION, tokenIds: [1n], minOut: 499n }),
    ).rejects.toBeInstanceOf(InvalidInputError)
    await expect(
      sdk.buyTokens({ collection: COLLECTION, amountInWei: 1n, minOut: 499n }),
    ).rejects.toBeInstanceOf(InvalidInputError)
    await expect(
      sdk.sellTokens({ collection: COLLECTION, amountInWei: 1n, minOut: 499n }),
    ).rejects.toBeInstanceOf(InvalidInputError)
    expect(f.writeContract).not.toHaveBeenCalled()
    expect(f.sendCalls).not.toHaveBeenCalled()
  })

  it('uses quoted bounds when a write omits precomputed slippage limits', async () => {
    const f = fakes({ reads: { isApprovedForAll: true } })
    const sdk = createNftxSdk({ publicClient: f.publicClient, walletClient: f.walletClient })
    vi.spyOn(sdk, 'quoteFloorBuy').mockResolvedValue(1000n)
    vi.spyOn(sdk, 'quoteSellNftsWithSlippage').mockResolvedValue({ amountOut: 1000n, minOut: 950n })

    await sdk.buyNfts({ collection: COLLECTION, tokenIds: [1n] })
    expect(f.writeContract).toHaveBeenLastCalledWith(
      expect.objectContaining({ args: [expect.any(String), [1n], 1030n], value: 1030n }),
    )

    await sdk.sellNfts({ collection: COLLECTION, tokenIds: [1n] })
    expect(f.writeContract).toHaveBeenLastCalledWith(
      expect.objectContaining({ args: [expect.any(String), [1n], 950n] }),
    )
  })

  it('reuses the resolved vault token on the default sellTokens quote path', async () => {
    const f = fakes({ reads: { allowance: 0n } })
    const sdk = createNftxSdk({ publicClient: f.publicClient, walletClient: f.walletClient })
    const resolveVault = vi.spyOn(sdk, 'resolveVault').mockResolvedValue(vault)
    const quote = vi
      .spyOn(sdk, 'quoteTokenSwapWithSlippage')
      .mockResolvedValue({ amountOut: 1000n, minOut: 950n })

    await sdk.sellTokens({ collection: COLLECTION, amountInWei: 1n })

    expect(resolveVault).toHaveBeenCalledTimes(1)
    expect(quote).toHaveBeenCalledWith(
      'sell',
      expect.any(String),
      1n,
      expect.objectContaining({ vault }),
    )
    expect(f.publicClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'allowance' }),
    )
    expect(f.publicClient.readContract).not.toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'collectionToken' }),
    )
  })

  it('folds a no-code target into a terminal OPERATOR_NOT_CONTRACT error (T1)', async () => {
    const f = fakes({ code: '0x' })
    const sdk = createNftxSdk({ publicClient: f.publicClient, walletClient: f.walletClient })
    const result = await sdk.buyNfts({ collection: COLLECTION, tokenIds: [1n], maxSpend: 1000n })
    if (result.mode !== 'submit') throw new Error('unreachable')
    expect(result.state.status).toBe('error')
    expect(result.state.errorCode).toBe('OPERATOR_NOT_CONTRACT')
    expect(f.writeContract).not.toHaveBeenCalled()
  })

  it('requireAtomic rejects when the wallet has no ERC-5792 support', async () => {
    const f = fakes() // getCapabilities → {}
    const sdk = createNftxSdk({ publicClient: f.publicClient, walletClient: f.walletClient })
    await expect(
      sdk.buyNfts(
        { collection: COLLECTION, tokenIds: [1n], maxSpend: 1000n },
        { requireAtomic: true },
      ),
    ).rejects.toBeInstanceOf(WalletError)
  })

  it('sellNfts runs an atomic batch when the wallet advertises it', async () => {
    const f = fakes({
      capabilities: { [CHAIN]: { atomic: { status: 'supported' } } },
      reads: { isApprovedForAll: false },
    })
    const sdk = createNftxSdk({ publicClient: f.publicClient, walletClient: f.walletClient })
    const result = await sdk.sellNfts({ collection: COLLECTION, tokenIds: [1n], minOut: 900n })
    if (result.mode !== 'submit') throw new Error('unreachable')
    expect(result.state.status).toBe('success')
    expect(result.state.execution).toBe('atomic')
    expect(f.sendCalls).toHaveBeenCalledTimes(1)
    expect(f.sendCalls).toHaveBeenCalledWith(expect.objectContaining({ forceAtomic: true }))
    expect(f.writeContract).not.toHaveBeenCalled()
  })

  it('preserves batch receipt statuses when atomic execution is not confirmed', async () => {
    const f = fakes({
      capabilities: { [CHAIN]: { atomic: { status: 'supported' } } },
      callsAtomic: false,
      callsReceipts: [
        { transactionHash: '0xapprove', status: 'success' },
        { transactionHash: '0xsell', status: 'reverted' },
      ],
    })
    const sdk = createNftxSdk({ publicClient: f.publicClient, walletClient: f.walletClient })
    vi.spyOn(sdk, 'quoteSellNfts').mockResolvedValue(1000n)

    const result = await sdk.sellNfts({ collection: COLLECTION, tokenIds: [1n], minOut: 900n })

    if (result.mode !== 'submit') throw new Error('unreachable')
    expect(result.state.status).toBe('error')
    expect(result.state.errorCode).toBe('WALLET')
    expect(result.state.error).toMatchObject({
      cause: {
        receipts: [
          { transactionHash: '0xapprove', status: 'success' },
          { transactionHash: '0xsell', status: 'reverted' },
        ],
      },
    })
  })
})
