import { describe, expect, it, vi } from 'vitest'

import { collectionTokenAbi } from '../abi/collectionToken'
import { nftxZapAbi } from '../abi/nftxZap'
import type { PlanStep } from '../plan/types'
import { type BatchDeps, runBatch } from './batch'

const ZAP = '0x41ff66f1242b664e18a3da25ae135cb303294393'
const VTOKEN = '0x06c203495b3090f5a8a73ecda79bac54f60e7220'
const COLLECTION = '0x97df1a364c1f1f6bb1f5b6e6f6b6f6b6f6b6aeaa'
const ACCOUNT = '0x1111111111111111111111111111111111111111'

const approve = (skip: boolean): PlanStep => ({
  id: 'approve',
  label: 'Approve',
  address: VTOKEN,
  abi: collectionTokenAbi,
  functionName: 'approve',
  args: [ZAP, 1000n],
  skip,
})
const sell: PlanStep = {
  id: 'sell',
  label: 'Sell',
  address: ZAP,
  abi: nftxZapAbi,
  functionName: 'sellTokensForETH',
  args: [COLLECTION, 1000n, 900n],
}

function deps(over: Partial<BatchDeps> = {}): BatchDeps {
  return {
    wallet: { isConnected: true, address: ACCOUNT, chainId: 1 },
    chainId: 1,
    switchChain: vi.fn(async () => {}),
    sendCalls: vi.fn(async () => ({ id: '0xbatch' })),
    waitForCallsStatus: vi.fn(async () => ({
      status: 'success' as const,
      statusCode: 200,
      atomic: true,
      receipts: [{ transactionHash: '0xreceipt' }],
    })),
    ...over,
  }
}

describe('execution/runBatch', () => {
  it('sends one batch, awaits status, stamps atomic + success', async () => {
    const d = deps()
    const state = await runBatch([approve(false), sell], d)
    expect(state.status).toBe('success')
    expect(state.execution).toBe('atomic')
    expect(state.callsId).toBe('0xbatch')
    expect(state.txHash).toBe('0xreceipt')
    expect(d.sendCalls).toHaveBeenCalledTimes(1)
    // only the 2 executable steps are in the batch
    expect(vi.mocked(d.sendCalls).mock.calls[0]?.[0]).toHaveLength(2)
  })

  it('excludes skipped steps from the batch', async () => {
    const d = deps()
    await runBatch([approve(true), sell], d)
    expect(vi.mocked(d.sendCalls).mock.calls[0]?.[0]).toHaveLength(1)
  })

  it('folds a failed batch into a terminal error', async () => {
    const waitForCallsStatus = vi.fn(async () => ({ status: 'failure' as const, statusCode: 500 }))
    const state = await runBatch([sell], deps({ waitForCallsStatus }))
    expect(state.status).toBe('error')
    expect(state.errorCode).toBe('TX_REVERTED')
    expect(state.callsId).toBe('0xbatch')
  })

  it('publishes and preserves the calls id immediately after submission', async () => {
    const states: { callsId?: string; status: string }[] = []
    const state = await runBatch([sell], deps(), (next) => {
      states.push({ status: next.status, ...(next.callsId ? { callsId: next.callsId } : {}) })
    })

    expect(states).toContainEqual({ status: 'running', callsId: '0xbatch' })
    expect(state.callsId).toBe('0xbatch')
  })

  it('treats partial or ambiguous status as a wallet error and preserves reconciliation data', async () => {
    const waitForCallsStatus = vi.fn(async () => ({
      status: 'failure' as const,
      statusCode: 600,
      receipts: [{ transactionHash: '0xpartial', status: 'success' as const }],
    }))
    const state = await runBatch([sell], deps({ waitForCallsStatus }))

    expect(state).toMatchObject({
      status: 'error',
      errorCode: 'WALLET',
      callsId: '0xbatch',
      txHash: '0xpartial',
    })
    expect(state.steps[0]).toMatchObject({ status: 'error', txHash: '0xpartial' })
  })

  it('treats a status lookup failure as ambiguous and keeps the calls id', async () => {
    const waitForCallsStatus = vi.fn(async () => {
      throw new Error('status endpoint unavailable')
    })
    const state = await runBatch([sell], deps({ waitForCallsStatus }))

    expect(state).toMatchObject({
      status: 'error',
      errorCode: 'WALLET',
      callsId: '0xbatch',
    })
  })

  it('rejects a multi-step batch reported as non-atomic', async () => {
    const waitForCallsStatus = vi.fn(async () => ({
      status: 'success' as const,
      statusCode: 200,
      atomic: false,
      receipts: [{ transactionHash: '0xreceipt' }],
    }))
    const state = await runBatch([approve(false), sell], deps({ waitForCallsStatus }))
    expect(state.status).toBe('error')
    expect(state.errorCode).toBe('WALLET')
  })

  it('guards each step and never sends when a guard throws', async () => {
    const assertCallSafe = vi.fn(async () => {
      throw new Error('unsafe')
    })
    const sendCalls = vi.fn(async () => ({ id: '0xbatch' }))
    const state = await runBatch([sell], deps({ assertCallSafe, sendCalls }))
    expect(state.status).toBe('error')
    expect(sendCalls).not.toHaveBeenCalled()
    expect(state.callsId).toBeUndefined()
  })

  it('rejects duplicate plan ids before sending', async () => {
    const sendCalls = vi.fn(async () => ({ id: '0xbatch' }))
    const state = await runBatch(
      [sell, { ...sell, label: 'Second sell' }],
      deps({ sendCalls }),
    )

    expect(state.errorCode).toBe('INVALID_INPUT')
    expect(sendCalls).not.toHaveBeenCalled()
  })

  it('errors when the wallet is not connected', async () => {
    const state = await runBatch([sell], deps({ wallet: { isConnected: false } }))
    expect(state.status).toBe('error')
    expect(state.errorCode).toBe('WALLET')
  })
})
