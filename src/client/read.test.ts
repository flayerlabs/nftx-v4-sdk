import { describe, expect, it } from 'vitest'
import { encodeAbiParameters, type PublicClient, zeroAddress } from 'viem'

import { UnsupportedChainError } from '../errors'
import { InvalidInputError } from '../errors'
import { nftxV4PoolKey, poolKeyAbiParameter, type V4PoolKey } from '../pool/poolKey'
import { ReadNftxSdk } from './read'

// The hook returns abi.encode(PoolKey) as bytes; mock the on-chain return in kind.
const encodePoolKey = (key: V4PoolKey) => encodeAbiParameters([poolKeyAbiParameter], [key])

const CHAIN = 1
// Base Sepolia addresses from the SDK tables.
const FLETH = '0x000000000bB1f9944965c64066D10038a84F9af2'
const HOOK = '0xaa49ADaDD33c5E953b645567AFb10CBbba63afC4'
const COLLECTION = '0x97df1a364c1f1f6bb1f5b6e6f6b6f6b6f6b6aeaa'
const VTOKEN = '0x06c203495b3090f5a8a73ecda79bac54f60e7220'
const OWNER = '0x1111111111111111111111111111111111111111'
const OPERATOR = '0x2222222222222222222222222222222222222222'

type Handlers = Record<string, unknown | (() => unknown)>

function makeClient(handlers: Handlers): PublicClient {
  return {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (!(functionName in handlers)) throw new Error(`unexpected read: ${functionName}`)
      const h = handlers[functionName]
      return typeof h === 'function' ? (h as () => unknown)() : h
    },
  } as unknown as PublicClient
}

const canonicalKey = nftxV4PoolKey(VTOKEN, FLETH, HOOK)

describe('client/ReadNftxSdk', () => {
  it('reads the collection token and initialization state', async () => {
    const sdk = new ReadNftxSdk({
      chainId: CHAIN,
      publicClient: makeClient({ collectionToken: VTOKEN, collectionInitialized: true }),
    })
    expect(await sdk.collectionToken(COLLECTION)).toBe(VTOKEN)
    expect(await sdk.collectionInitialized(COLLECTION)).toBe(true)

    const empty = new ReadNftxSdk({
      chainId: CHAIN,
      publicClient: makeClient({ collectionToken: zeroAddress, collectionInitialized: false }),
    })
    expect(await empty.collectionInitialized(COLLECTION)).toBe(false)
  })

  it('resolves a frozen Vault and cross-checks the canonical pool key', async () => {
    const sdk = new ReadNftxSdk({
      chainId: CHAIN,
      publicClient: makeClient({
        collectionToken: VTOKEN,
        collectionInitialized: true,
        getCollectionPoolKey: encodePoolKey(canonicalKey),
      }),
    })
    const vault = await sdk.resolveVault(COLLECTION)
    expect(vault.collectionToken).toBe(VTOKEN)
    expect(vault.chainId).toBe(CHAIN)
    expect(Object.isFrozen(vault)).toBe(true)
    expect(vault.poolKey.hooks).toBe(HOOK)
  })

  it('hard-fails when the local key disagrees with the on-chain hook key', async () => {
    const sdk = new ReadNftxSdk({
      chainId: CHAIN,
      publicClient: makeClient({
        collectionToken: VTOKEN,
        collectionInitialized: true,
        getCollectionPoolKey: encodePoolKey({ ...canonicalKey, tickSpacing: 30 }),
      }),
    })
    await expect(sdk.resolveVault(COLLECTION)).rejects.toBeInstanceOf(InvalidInputError)
  })

  it('skips the cross-check when verifyPoolKey is false', async () => {
    const sdk = new ReadNftxSdk({
      chainId: CHAIN,
      // getCollectionPoolKey handler intentionally absent — must not be called.
      publicClient: makeClient({ collectionToken: VTOKEN, collectionInitialized: true }),
    })
    const vault = await sdk.resolveVault(COLLECTION, { verifyPoolKey: false })
    expect(vault.collectionToken).toBe(VTOKEN)
  })

  it('rejects an uninitialized collection', async () => {
    const sdk = new ReadNftxSdk({
      chainId: CHAIN,
      publicClient: makeClient({ collectionToken: zeroAddress, collectionInitialized: false }),
    })
    await expect(sdk.resolveVault(COLLECTION)).rejects.toBeInstanceOf(InvalidInputError)
  })

  it('rejects a registered collection whose pool is not initialized', async () => {
    const sdk = new ReadNftxSdk({
      chainId: CHAIN,
      publicClient: makeClient({ collectionToken: VTOKEN, collectionInitialized: false }),
    })
    expect(await sdk.collectionToken(COLLECTION)).toBe(VTOKEN)
    expect(await sdk.collectionInitialized(COLLECTION)).toBe(false)
    await expect(sdk.resolveVault(COLLECTION)).rejects.toBeInstanceOf(InvalidInputError)
  })

  it('passes allowance / approval / balance reads through', async () => {
    const sdk = new ReadNftxSdk({
      chainId: CHAIN,
      publicClient: makeClient({
        isApprovedForAll: true,
        allowance: 5n,
        balanceOf: 100n,
      }),
    })
    expect(await sdk.isApprovedForAll(COLLECTION, OWNER, OPERATOR)).toBe(true)
    expect(await sdk.allowance(VTOKEN, OWNER, OPERATOR)).toBe(5n)
    expect(await sdk.balanceOf(VTOKEN, OWNER)).toBe(100n)
  })

  it('reads escrow balances from either protocol escrow ledger', async () => {
    const calls: unknown[] = []
    const sdk = new ReadNftxSdk({
      chainId: CHAIN,
      publicClient: {
        readContract: async (call: unknown) => {
          calls.push(call)
          return 42n
        },
      } as unknown as PublicClient,
    })

    expect(await sdk.escrowBalance('listings', OWNER, zeroAddress)).toBe(42n)
    expect(await sdk.escrowBalance('nftxV4Hook', OWNER, VTOKEN)).toBe(42n)
    expect(calls).toMatchObject([
      {
        address: '0x11F09e7eeD242FAd875D3565B3D9CA8AADE445ae',
        functionName: 'balances',
        args: [OWNER, zeroAddress],
      },
      {
        address: HOOK,
        functionName: 'balances',
        args: [OWNER, '0x06c203495b3090f5A8a73eCDA79Bac54f60E7220'],
      },
    ])
  })

  it('throws UnsupportedChainError before any RPC on an unknown chain', async () => {
    const sdk = new ReadNftxSdk({
      chainId: 999,
      publicClient: makeClient({}),
    })
    await expect(sdk.collectionToken(COLLECTION)).rejects.toBeInstanceOf(UnsupportedChainError)
  })
})
