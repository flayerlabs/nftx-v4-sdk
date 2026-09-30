import { describe, expect, it } from 'vitest'
import { createPublicClient, createTestClient, createWalletClient, http, type Address } from 'viem'
import { mainnet } from 'viem/chains'

import { createNftxSdk } from '../../src/client/factory'
import { getAddressFor } from '../../src/addresses/resolve'
import { authoriseNftsSteps } from '../../src/encoders/nftApproval'
import { createCallGuard } from '../../src/client/guards'
import { runStagedPlan } from '../../src/execution/stagedPlan'

// Local anvil only: never allow these impersonated writes onto a public RPC.
// Pin Ethereum at block 25731800, the frontend's verified legacy-NFT fixture block.
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
const rpc = env?.SDK_TRADE_FORK_RPC_URL
const local = rpc && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(rpc).hostname)
if (rpc && !local) throw new Error('SDK_TRADE_FORK_RPC_URL must point to a local anvil fork.')

describe.skipIf(!rpc)('integration: SDK trade settlement on an Ethereum fork', () => {
  const publicClient = createPublicClient({ chain: mainnet, transport: http(rpc) })
  const testClient = createTestClient({ chain: mainnet, mode: 'anvil', transport: http(rpc) })

  async function withAccount(
    account: Address,
    action: (wallet: ReturnType<typeof walletFor>) => Promise<void>,
  ) {
    const snapshot = await testClient.snapshot()
    await testClient.impersonateAccount({ address: account })
    await testClient.setBalance({ address: account, value: 100n * 10n ** 18n })
    try {
      await action(walletFor(account))
    } finally {
      await testClient.revert({ id: snapshot })
      await testClient.stopImpersonatingAccount({ address: account })
    }
  }

  function walletFor(account: Address) {
    return createWalletClient({ account, chain: mainnet, transport: http(rpc) })
  }

  it('buys and sells collection tokens through the guarded facade', async () => {
    const account = '0x1111111111111111111111111111111111111111'
    const collection = '0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB'
    await withAccount(account, async (walletClient) => {
      const sdk = createNftxSdk({ publicClient, walletClient })
      const vault = await sdk.resolveVault(collection)
      const before = await sdk.balanceOf(vault.collectionToken, account)
      const buy = await sdk.buyTokens({ collection, amountInWei: 10n ** 16n })
      expect(buy.mode === 'submit' && buy.state.status).toBe('success')
      const bought = (await sdk.balanceOf(vault.collectionToken, account)) - before
      expect(bought).toBeGreaterThan(0n)
      const quote = await sdk.quoteTokenSwapWithSlippage('sell', collection, bought)
      const sell = await sdk.sellTokens({ collection, amountInWei: bought, minOut: quote.minOut })
      expect(sell.mode === 'submit' && sell.state.status).toBe('success')
      expect(await sdk.balanceOf(vault.collectionToken, account)).toBe(before)
      expect(await sdk.allowance(vault.collectionToken, account, getAddressFor(1, 'nftxZap'))).toBe(
        0n,
      )
    })
  }, 60_000)

  it('authorizes and sells a CryptoPunk without an ERC721 blanket approval', async () => {
    const account = '0x830C47362766804dc43fb07215c3c50a09Cc572C'
    const collection = '0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB'
    await withAccount(account, async (walletClient) => {
      const sdk = createNftxSdk({ publicClient, walletClient })
      const before = await publicClient.getBalance({ address: account })
      const result = await sdk.sellNfts({
        collection,
        tokenIds: [2n],
        allowPunkOfferOverwrite: true,
      })
      expect(result.mode === 'submit' && result.state.status).toBe('success')
      expect(await publicClient.getBalance({ address: account })).toBeGreaterThan(before)
      const approval = await sdk.nftApproval(collection, account, getAddressFor(1, 'nftxZap'), [2n])
      expect(approval.kind === 'punks' && approval.verdicts[0]?.authorised).toBe(false)
    })
  }, 60_000)

  it('authorizes a CryptoKitty through the guarded plan runner', async () => {
    const account = '0xf93e7069d6A5A241Ec379D21701f2e20E1923c13'
    const collection = '0x06012c8cf97BEaD5deAe237070F9587f8E7A266d'
    await withAccount(account, async (walletClient) => {
      const sdk = createNftxSdk({ publicClient, walletClient })
      const approval = await sdk.nftApproval(collection, account, getAddressFor(1, 'locker'), [
        755511n,
      ])
      const steps = authoriseNftsSteps({
        collection,
        tokenIds: [755511n],
        operator: getAddressFor(1, 'locker'),
        approval,
      })
      const state = await runStagedPlan(steps, {
        wallet: { isConnected: true, address: account, chainId: 1 },
        chainId: 1,
        switchChain: async () => {},
        assertCallSafe: createCallGuard({
          publicClient,
          walletClient,
          chainId: 1,
          expectedAccount: account,
          simulate: true,
        }),
        writeContract: (step) =>
          walletClient.writeContract({
            address: step.address,
            abi: step.abi,
            functionName: step.functionName,
            args: step.args,
          }),
        waitForReceipt: async (hash) => {
          const receipt = await publicClient.waitForTransactionReceipt({
            hash: hash as `0x${string}`,
          })
          return { status: receipt.status, transactionHash: receipt.transactionHash }
        },
      })
      expect(state.status).toBe('success')
      const fresh = await sdk.nftApproval(collection, account, getAddressFor(1, 'locker'), [
        755511n,
      ])
      expect(fresh.kind === 'kitties' && fresh.verdicts[0]?.authorised).toBe(true)
    })
  }, 60_000)
})
