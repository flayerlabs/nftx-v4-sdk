import { describe, expect, it, vi } from 'vitest'

import { erc721Abi } from '../abi/erc721'
import { nftxZapAbi } from '../abi/nftxZap'
import type { PlanStep } from '../plan/types'
import { runStagedPlan, type StagedPlanDeps } from './stagedPlan'

const ZAP = '0x41ff66f1242b664e18a3da25ae135cb303294393'
const COLLECTION = '0x97df1a364c1f1f6bb1f5b6e6f6b6f6b6f6b6aeaa'
const ACCOUNT = '0x1111111111111111111111111111111111111111'

const approve = (skip: boolean): PlanStep => ({
  id: 'approve',
  label: 'Approve',
  address: COLLECTION,
  abi: erc721Abi,
  functionName: 'setApprovalForAll',
  args: [ZAP, true],
  skip,
})
const sell: PlanStep = {
  id: 'sell',
  label: 'Sell',
  address: ZAP,
  abi: nftxZapAbi,
  functionName: 'sellNFTForETH',
  args: [COLLECTION, [1n], 900n],
}

function deps(over: Partial<StagedPlanDeps> = {}): StagedPlanDeps {
  return {
    wallet: { isConnected: true, address: ACCOUNT, chainId: 1 },
    chainId: 1,
    switchChain: vi.fn(async () => {}),
    writeContract: vi.fn(async () => '0xhash'),
    waitForReceipt: vi.fn(async (hash: string) => ({ status: 'success' as const, transactionHash: hash })),
    ...over,
  }
}

describe('execution/runStagedPlan', () => {
  it('runs steps in order, awaits receipts, stamps sequential + success', async () => {
    const d = deps()
    const state = await runStagedPlan([approve(false), sell], d)
    expect(state.status).toBe('success')
    expect(state.execution).toBe('sequential')
    expect(state.txHash).toBe('0xhash')
    expect(d.writeContract).toHaveBeenCalledTimes(2)
  })

  it('never submits a skipped step', async () => {
    const d = deps()
    const state = await runStagedPlan([approve(true), sell], d)
    expect(state.status).toBe('success')
    expect(d.writeContract).toHaveBeenCalledTimes(1)
    expect(state.steps[0]?.status).toBe('skipped')
  })

  it('runs assertCallSafe before each executable write and aborts on its throw', async () => {
    const assertCallSafe = vi.fn(async () => {
      throw new Error('unsafe call')
    })
    const writeContract = vi.fn(async () => '0xhash')
    const state = await runStagedPlan([sell], deps({ assertCallSafe, writeContract }))
    expect(state.status).toBe('error')
    expect(writeContract).not.toHaveBeenCalled()
  })

  it('folds a reverted receipt into a terminal error (no reject)', async () => {
    const waitForReceipt = vi.fn(async (hash: string) => ({
      status: 'reverted' as const,
      transactionHash: hash,
    }))
    const state = await runStagedPlan([sell], deps({ waitForReceipt }))
    expect(state.status).toBe('error')
    expect(state.errorCode).toBe('TX_REVERTED')
  })

  it('errors when the wallet is not connected', async () => {
    const state = await runStagedPlan(
      [sell],
      deps({ wallet: { isConnected: false } }),
    )
    expect(state.status).toBe('error')
    expect(state.errorCode).toBe('WALLET')
  })

  it('switches chain when the wallet is on the wrong network', async () => {
    const switchChain = vi.fn(async () => {})
    await runStagedPlan(
      [sell],
      deps({ wallet: { isConnected: true, address: ACCOUNT, chainId: 8453 }, switchChain }),
    )
    expect(switchChain).toHaveBeenCalledWith(1)
  })

  it('rejects duplicate plan ids before writing', async () => {
    const writeContract = vi.fn(async () => '0xhash')
    const state = await runStagedPlan(
      [sell, { ...sell, label: 'Second sell' }],
      deps({ writeContract }),
    )

    expect(state.errorCode).toBe('INVALID_INPUT')
    expect(writeContract).not.toHaveBeenCalled()
  })
})
