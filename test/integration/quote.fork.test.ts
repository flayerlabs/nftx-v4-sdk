import { describe, expect, it } from 'vitest'
import { createPublicClient, http } from 'viem'
import { baseSepolia } from 'viem/chains'

import { createNftxSdk } from '../../src/client/factory'

/**
 * On-chain integration — reproduces the team's validations against a REAL chain:
 * `resolveVault` cross-checks the locally-derived pool key against the on-chain
 * hook key, and `quoteFloorBuy` returns a positive exact-output cost.
 *
 * Skips unless `BASE_FORK_RPC_URL` + `NFTX_TEST_COLLECTION` are set. The URL may
 * point at a local pinned Base Sepolia fork or a live RPC. CI does not currently
 * provide a committed fork state, so this is a manual release validation rather
 * than a deterministic default-suite gate.
 */
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
const RPC = env?.BASE_FORK_RPC_URL
const COLLECTION = env?.NFTX_TEST_COLLECTION as `0x${string}` | undefined

describe.skipIf(!RPC || !COLLECTION)('integration: quote on a real chain', () => {
  it('resolves a vault (local == hook pool key) and quotes a floor buy', async () => {
    const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC) })
    const sdk = createNftxSdk({ publicClient })
    const vault = await sdk.resolveVault(COLLECTION!)
    expect(vault.collectionToken).toMatch(/^0x[0-9a-fA-F]{40}$/)
    const amountIn = await sdk.quoteFloorBuy(COLLECTION!, 1, { vault })
    expect(amountIn).toBeGreaterThan(0n)
  })
})
