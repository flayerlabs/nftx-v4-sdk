import {
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  maxUint160,
  maxUint256,
  zeroAddress,
  type Address,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { universalRouterAbi } from '../abi/universalRouter'
import { createCallGuard } from '../client/guards'
import { runBatch } from '../execution/batch'
import type { EncodedCall } from '../execution/encodeCalls'
import { runStagedPlan } from '../execution/stagedPlan'
import type { RoutedSwapPermitTypedData } from './permit'
import { prepareRoutedSwap, resolveRoutedSwap, routedSwapQuoteRequest } from './routedSwap'
import type {
  RoutedSwapApproval,
  RoutedSwapIntent,
  RoutedSwapQuote,
  RoutedSwapTransaction,
  TrustedRoutedSwapProvider,
} from './types'

const account: Address = '0x1111111111111111111111111111111111111111'
const tokenIn: Address = '0x2222222222222222222222222222222222222222'
const tokenOut: Address = '0x3333333333333333333333333333333333333333'
const contracts = {
  permit2: '0x4444444444444444444444444444444444444444' as Address,
  universalRouter: '0x5555555555555555555555555555555555555555' as Address,
}
const nowMs = 1_800_000_000_000
const intent: RoutedSwapIntent = {
  chainId: 1,
  account,
  tokenIn,
  tokenOut,
  amountIn: 100n,
  slippageBps: 100,
}
const fullIntent: RoutedSwapIntent = { ...intent, permitAmount: 'FULL' }

function permit(amount = 100n) {
  return {
    domain: { name: 'Permit2', chainId: 1, verifyingContract: contracts.permit2 },
    types: {
      PermitSingle: [
        { name: 'details', type: 'PermitDetails' },
        { name: 'spender', type: 'address' },
        { name: 'sigDeadline', type: 'uint256' },
      ],
      PermitDetails: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint160' },
        { name: 'expiration', type: 'uint48' },
        { name: 'nonce', type: 'uint48' },
      ],
    },
    values: {
      details: {
        token: tokenIn,
        amount: amount.toString(),
        expiration: nowMs / 1000 + 900,
        nonce: '0',
      },
      spender: contracts.universalRouter,
      sigDeadline: String(nowMs / 1000 + 900),
    },
  }
}

function quote(overrides: Partial<RoutedSwapQuote> = {}): RoutedSwapQuote {
  return {
    chainId: 1,
    requestId: 'request',
    routing: 'CLASSIC',
    quoteId: 'quote',
    type: 'EXACT_INPUT',
    amount: '100',
    tokenIn,
    tokenOut,
    taker: account,
    recipient: account,
    slippageBps: 100,
    input: { token: tokenIn, amount: '100' },
    output: { token: tokenOut, amount: '200', minimumAmount: '198', recipient: account },
    expiresAt: new Date(nowMs + 30_000).toISOString(),
    permitData: null,
    permitTransaction: null,
    quote: { opaque: true },
    ...overrides,
  }
}

function approval(amount: bigint): RoutedSwapTransaction {
  return {
    chainId: 1,
    from: account,
    to: tokenIn,
    value: '0',
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [contracts.permit2, amount],
    }),
  }
}

function swap(overrides: Partial<RoutedSwapTransaction> = {}): RoutedSwapTransaction {
  return {
    chainId: 1,
    from: account,
    to: contracts.universalRouter,
    value: '0',
    data: encodeFunctionData({
      abi: universalRouterAbi,
      functionName: 'execute',
      args: ['0x08', ['0x12'], BigInt(nowMs / 1000 + 900)],
    }),
    ...overrides,
  }
}

function provider(tx = swap()): TrustedRoutedSwapProvider {
  return {
    requestQuote: vi.fn(async () => quote()),
    requestCalldata: vi.fn(async () => ({ chainId: 1, swap: tx })),
  }
}

function resolve(q = quote(), p = provider(), i = intent) {
  return resolveRoutedSwap({ intent: i, contracts, quote: q, provider: p, now: () => nowMs })
}

describe('routed swap preparation', () => {
  it('requests exact-input with exact Permit2 authorization and explicit recipient', () => {
    expect(routedSwapQuoteRequest(intent)).toMatchObject({
      type: 'EXACT_INPUT',
      amount: '100',
      permitAmount: 'EXACT',
      recipient: account,
    })
  })

  it('explicitly requests frontend FULL permits without changing exact input or recipient', () => {
    expect(routedSwapQuoteRequest(fullIntent)).toEqual({
      ...routedSwapQuoteRequest(intent),
      permitAmount: 'FULL',
    })
    expect(routedSwapQuoteRequest({ ...intent, permitAmount: 'EXACT' }).permitAmount).toBe('EXACT')
    expect(() =>
      routedSwapQuoteRequest({ ...intent, permitAmount: 'UNKNOWN' as 'FULL' }),
    ).toThrow('parameters')
  })

  it.each([100n, 101n, maxUint160])('accepts a sufficient FULL PermitSingle amount %s', (amount) => {
    const result = prepareRoutedSwap(
      fullIntent,
      quote({ permitData: permit(amount) }),
      null,
      contracts,
      nowMs,
    )
    expect(result.permitTypedData?.message.details.amount).toBe(amount)
  })

  it.each([99n, maxUint160 + 1n])('rejects an invalid FULL permit amount %s', (amount) => {
    expect(() =>
      prepareRoutedSwap(fullIntent, quote({ permitData: permit(amount) }), null, contracts, nowMs),
    ).toThrow()
  })

  it('refuses a FULL permit unless the intent explicitly allows it', () => {
    expect(() =>
      prepareRoutedSwap(intent, quote({ permitData: permit(maxUint160) }), null, contracts, nowMs),
    ).toThrow('authorization')
  })

  it.each([101n, maxUint256])('preserves the upstream ERC20 approval %s in FULL mode', (amount) => {
    const result = prepareRoutedSwap(
      fullIntent,
      quote({ permitData: permit(maxUint160) }),
      { chainId: 1, cancel: approval(0n), approval: approval(amount) },
      contracts,
      nowMs,
    )
    expect(result.approvalSteps.map((step) => step.args)).toEqual([
      [contracts.permit2, 0n],
      [contracts.permit2, amount],
    ])
  })

  it('builds an allowance reset followed by exact approval, reducing backend unlimited approvals', () => {
    const approvals: RoutedSwapApproval = {
      chainId: 1,
      cancel: approval(0n),
      approval: approval(maxUint256),
    }
    const result = prepareRoutedSwap(intent, quote(), approvals, contracts, nowMs)
    expect(result.approvalSteps.map((step) => step.args)).toEqual([
      [contracts.permit2, 0n],
      [contracts.permit2, 100n],
    ])
    expect(
      result.approvalSteps.every((step) => step.requiredAccount === account && step.replaySafe),
    ).toBe(true)
  })

  it.each([
    { chainId: 10 },
    { from: tokenOut },
    { to: tokenOut },
    { value: '1' },
    {
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [tokenOut, 100n] }),
    },
  ])('rejects unsafe approval %j', (change) => {
    expect(() =>
      prepareRoutedSwap(
        intent,
        quote(),
        { chainId: 1, cancel: null, approval: { ...approval(100n), ...change } },
        contracts,
        nowMs,
      ),
    ).toThrow()
  })

  it('rejects underapproval and a nonzero reset', () => {
    expect(() =>
      prepareRoutedSwap(
        intent,
        quote(),
        { chainId: 1, cancel: null, approval: approval(99n) },
        contracts,
        nowMs,
      ),
    ).toThrow()
    expect(() =>
      prepareRoutedSwap(
        intent,
        quote(),
        { chainId: 1, cancel: approval(1n), approval: null },
        contracts,
        nowMs,
      ),
    ).toThrow()
  })

  it('rejects reset-only approvals and non-router wrap routes before any write', () => {
    expect(() =>
      prepareRoutedSwap(
        intent,
        quote(),
        { chainId: 1, cancel: approval(0n), approval: null },
        contracts,
        nowMs,
      ),
    ).toThrow('replacement')
    for (const routing of ['WRAP', 'UNWRAP', 'BRIDGE']) {
      expect(() => prepareRoutedSwap(intent, quote({ routing }), null, contracts, nowMs)).toThrow()
    }
  })

  it('normalizes only canonical PermitSingle typed data', () => {
    const result = prepareRoutedSwap(
      intent,
      quote({ permitData: permit() }),
      null,
      contracts,
      nowMs,
    )
    expect(result.permitTypedData?.message.details).toMatchObject({ amount: 100n, nonce: 0n })
  })

  it.each(['chain', 'domain', 'spender', 'token', 'amount', 'expiry', 'types', 'width'])(
    'rejects mismatched permit %s before signing',
    (field) => {
      const raw = permit()
      if (field === 'chain') raw.domain.chainId = 10
      if (field === 'domain') raw.domain.verifyingContract = tokenOut
      if (field === 'spender') raw.values.spender = tokenOut
      if (field === 'token') raw.values.details.token = tokenOut
      if (field === 'amount') raw.values.details.amount = '101'
      if (field === 'expiry') raw.values.sigDeadline = String(nowMs / 1000 + 20)
      if (field === 'types') raw.types.PermitSingle[0]!.type = 'bytes'
      if (field === 'width') raw.values.details.nonce = (1n << 48n).toString()
      expect(() =>
        prepareRoutedSwap(intent, quote({ permitData: raw }), null, contracts, nowMs),
      ).toThrow()
      if (field !== 'amount') {
        raw.values.details.amount = maxUint160.toString()
        expect(() =>
          prepareRoutedSwap(fullIntent, quote({ permitData: raw }), null, contracts, nowMs),
        ).toThrow()
      }
    },
  )

  it('rejects minimum outputs that bypass the selected slippage', () => {
    expect(() =>
      prepareRoutedSwap(
        intent,
        quote({ output: { token: tokenOut, amount: '200', minimumAmount: '1' } }),
        null,
        contracts,
        nowMs,
      ),
    ).toThrow()
  })
})

describe('routed swap resolution', () => {
  it('preserves the signed permit while resolving a fresh compatible quote', async () => {
    const raw = permit()
    const p = provider()
    p.requestQuote = vi.fn(async () => quote({ permitData: permit() }))
    await resolveRoutedSwap({
      intent,
      contracts,
      provider: p,
      quote: quote({ permitData: raw, expiresAt: new Date(nowMs).toISOString() }),
      signature: '0x1234',
      now: () => nowMs,
    })
    expect(p.requestCalldata).toHaveBeenCalledWith(
      expect.objectContaining({ permitData: raw, signature: '0x1234' }),
      1,
      198n,
    )
  })

  it.each(['expiration', 'sigDeadline'])(
    'keeps the original live signature when refreshed permit %s changes',
    async (field) => {
      const fresh = permit()
      if (field === 'expiration') fresh.values.details.expiration += 1
      else fresh.values.sigDeadline = String(BigInt(fresh.values.sigDeadline) + 1n)
      const p = provider()
      p.requestQuote = vi.fn(async () => quote({ permitData: fresh }))
      const raw = permit()
      await resolveRoutedSwap({
          intent,
          contracts,
          provider: p,
          quote: quote({ permitData: raw, expiresAt: new Date(nowMs).toISOString() }),
          signature: '0x1234',
          now: () => nowMs,
        })
      expect(p.requestCalldata).toHaveBeenCalledWith(
        expect.objectContaining({ permitData: raw, signature: '0x1234' }), 1, 198n,
      )
    },
  )

  it('requires preparation again if a refreshed quote introduces a permit', async () => {
    const p = provider()
    p.requestQuote = vi.fn(async () => quote({ permitData: permit() }))
    await expect(resolve(quote({ expiresAt: new Date(nowMs).toISOString() }), p)).rejects.toThrow(
      'Permit changed',
    )
    expect(p.requestCalldata).not.toHaveBeenCalled()
  })

  it('refuses missing signatures and expired allowance windows', async () => {
    const p = provider()
    await expect(resolve(quote({ permitData: permit() }), p)).rejects.toThrow('signature')
    const raw = permit()
    raw.values.details.expiration = nowMs / 1000 + 59
    expect(() =>
      prepareRoutedSwap(intent, quote({ permitData: raw }), null, contracts, nowMs),
    ).toThrow('expire')
    expect(p.requestCalldata).not.toHaveBeenCalled()
  })
  it('returns an economic PlanStep and passes the confirmed floor to the trusted provider', async () => {
    const p = provider()
    const step = await resolve(quote(), p)
    expect(step).toMatchObject({
      id: 'swap',
      functionName: 'execute',
      requiredAccount: account,
      value: 0n,
    })
    expect(step.replaySafe).toBeUndefined()
    expect(p.requestCalldata).toHaveBeenCalledWith(
      expect.objectContaining({
        simulateTransaction: true,
        expected: expect.objectContaining({ recipient: account }),
      }),
      1,
      198n,
    )
  })

  it('re-quotes expired quotes without lowering the confirmed floor', async () => {
    const p = provider()
    await resolve(quote({ expiresAt: new Date(nowMs - 1).toISOString() }), p)
    expect(p.requestQuote).toHaveBeenCalledTimes(1)
    p.requestQuote = vi.fn(async () =>
      quote({ output: { token: tokenOut, amount: '199', minimumAmount: '197' } }),
    )
    await expect(
      resolve(quote({ expiresAt: new Date(nowMs - 1).toISOString() }), p),
    ).rejects.toThrow('Price moved')
  })

  it('rejects mismatched refreshed quotes', async () => {
    const p = provider()
    p.requestQuote = vi.fn(async () => quote({ tokenOut: tokenIn }))
    await expect(resolve(quote({ expiresAt: new Date(nowMs).toISOString() }), p)).rejects.toThrow()
    expect(p.requestCalldata).not.toHaveBeenCalled()
  })

  it.each(['new permit', 'permit transaction', 'weaker floor', 'underfunded permit'])(
    'refuses an unsafe FULL quote refresh: %s',
    async (change) => {
      const original = quote({
        permitData: change === 'new permit' ? null : permit(maxUint160),
        expiresAt: new Date(nowMs + 5_000).toISOString(),
      })
      const fresh = quote({ permitData: permit(maxUint160) })
      if (change === 'permit transaction') fresh.permitTransaction = approval(100n)
      if (change === 'weaker floor') {
        fresh.output = { token: tokenOut, amount: '199', minimumAmount: '197' }
      }
      if (change === 'underfunded permit') fresh.permitData = permit(99n)
      const p = provider()
      p.requestQuote = vi.fn(async () => fresh)
      await expect(
        resolveRoutedSwap({
          intent: fullIntent,
          contracts,
          quote: original,
          provider: p,
          ...(original.permitData ? { signature: '0x1234' as const } : {}),
          approvalsPending: true,
          now: () => nowMs,
        }),
      ).rejects.toThrow()
      expect(p.requestCalldata).not.toHaveBeenCalled()
    },
  )

  it('rejects a changed permit nonce after an approval delay', async () => {
    const raw = permit()
    const fresh = permit()
    fresh.values.details.nonce = '1'
    const p = provider()
    p.requestQuote = vi.fn(async () => quote({ permitData: fresh }))
    await expect(
      resolveRoutedSwap({
        intent,
        contracts,
        provider: p,
        quote: quote({ permitData: raw, expiresAt: new Date(nowMs).toISOString() }),
        signature: '0x1234',
        now: () => nowMs,
      }),
    ).rejects.toThrow('Permit changed')
  })

  it('checks quote expiry again after the asynchronous calldata request', async () => {
    let time = nowMs
    const p = provider()
    p.requestCalldata = vi.fn(async () => {
      time += 40_000
      return { chainId: 1, swap: swap() }
    })
    await expect(
      resolveRoutedSwap({ intent, contracts, quote: quote(), provider: p, now: () => time }),
    ).rejects.toThrow('expired')
  })

  it.each([{ chainId: 10 }, { from: tokenOut }, { to: tokenOut }, { value: '100' }])(
    'rejects unsafe swap %j',
    async (change) => {
      await expect(resolve(quote(), provider(swap(change)))).rejects.toThrow()
      await expect(
        resolveRoutedSwap({
          intent: fullIntent,
          contracts,
          quote: quote({ permitData: permit(maxUint160) }),
          provider: provider(swap(change)),
          signature: '0x1234',
          approvalsPending: true,
          now: () => nowMs,
        }),
      ).rejects.toThrow()
    },
  )

  it('supports native input and native output while checking attached value', async () => {
    const nativeInput = { ...intent, tokenIn: zeroAddress }
    const nativeQuote = quote({
      tokenIn: zeroAddress,
      input: { token: zeroAddress, amount: '100' },
    })
    expect((await resolve(nativeQuote, provider(swap({ value: '100' })), nativeInput)).value).toBe(
      100n,
    )
    await expect(resolve(nativeQuote, provider(swap()), nativeInput)).rejects.toThrow()
    const nativeOutput = { ...intent, tokenOut: zeroAddress }
    await expect(
      resolve(
        quote({
          tokenOut: zeroAddress,
          output: { token: zeroAddress, amount: '200', minimumAmount: '198' },
        }),
        provider(),
        nativeOutput,
      ),
    ).resolves.toMatchObject({ value: 0n })
  })

  it('rejects router calls without a sufficiently live deadline', async () => {
    const data = encodeFunctionData({
      abi: universalRouterAbi,
      functionName: 'execute',
      args: ['0x08', ['0x12'], BigInt(nowMs / 1000 + 59)],
    })
    await expect(resolve(quote(), provider(swap({ data })))).rejects.toThrow('deadline')
  })

  it('uses existing executor outcome safety for routed economic calls', async () => {
    const step = await resolve()
    const state = await runStagedPlan([step], {
      wallet: { isConnected: true, address: account, chainId: 1 },
      chainId: 1,
      switchChain: vi.fn(),
      writeContract: vi.fn(async () => '0xsubmitted'),
      waitForReceipt: vi.fn(async () => ({
        status: 'reverted' as const,
        transactionHash: '0xsubmitted',
      })),
    })
    expect(state).toMatchObject({ status: 'error', errorCode: 'TX_REVERTED' })
    expect(state.steps[0]?.txHash).toBe('0xsubmitted')
  })
})

describe('routed swaps with existing executors', () => {
  const wallet = { isConnected: true, address: account, chainId: 1 }
  const approvals = { chainId: 1, cancel: approval(0n), approval: approval(maxUint256) }

  function guard(
    simulate: boolean,
    simulateContract: (call: { functionName: string }) => Promise<unknown> = vi.fn(async () => ({})),
  ) {
    return createCallGuard({
      chainId: 1,
      contracts,
      expectedAccount: account,
      publicClient: {
        chain: { id: 1 },
        getCode: vi.fn(async () => '0x1234'),
        simulateContract,
      } as unknown as PublicClient,
      walletClient: { chain: { id: 1 }, account: { address: account } } as unknown as WalletClient,
      simulate,
    })
  }

  it('signs first and submits reset, FULL approval and swap in one atomic batch', async () => {
    const raw = permit(maxUint160)
    const q = quote({ permitData: raw })
    const prepared = prepareRoutedSwap(fullIntent, q, approvals, contracts, nowMs)
    const sign = vi.fn(async (_typedData: RoutedSwapPermitTypedData) => '0x1234' as const)
    const signature = await sign(prepared.permitTypedData!)
    const p = provider()
    const step = await resolveRoutedSwap({
      intent: fullIntent,
      quote: q,
      contracts,
      provider: p,
      signature,
      approvalsPending: prepared.approvalSteps.length > 0,
      now: () => nowMs,
    })
    const simulateContract = vi.fn(async () => ({}))
    const sendCalls = vi.fn(async (_calls: EncodedCall[]) => ({ id: '0xbatch' }))
    const state = await runBatch([...prepared.approvalSteps, step], {
      wallet,
      chainId: 1,
      switchChain: vi.fn(),
      assertCallSafe: guard(false, simulateContract),
      sendCalls,
      waitForCallsStatus: vi.fn(async () => ({
        status: 'success' as const,
        atomic: true,
        receipts: [{ transactionHash: '0xreceipt', status: 'success' as const }],
      })),
    })
    expect(sign).toHaveBeenCalledWith(prepared.permitTypedData)
    expect(sign.mock.invocationCallOrder[0]).toBeLessThan(sendCalls.mock.invocationCallOrder[0]!)
    expect(p.requestCalldata).toHaveBeenCalledWith(
      expect.objectContaining({ simulateTransaction: false, permitData: raw, signature }),
      1,
      198n,
    )
    expect(simulateContract).not.toHaveBeenCalled()
    const calls = sendCalls.mock.calls[0]![0]
    expect(calls.map((call) => call.to)).toEqual([tokenIn, tokenIn, contracts.universalRouter])
    expect(decodeFunctionData({ abi: erc20Abi, data: calls[1]!.data }).args).toEqual([
      contracts.permit2,
      maxUint256,
    ])
    expect(state).toMatchObject({ status: 'success', execution: 'atomic', callsId: '0xbatch' })
    expect(state.steps.map((view) => view.status)).toEqual(['done', 'done', 'done'])
  })

  it('signs before sequential approvals, then refreshes and simulates after successful receipts', async () => {
    let time = nowMs
    let mined = false
    const events: string[] = []
    const raw = permit(maxUint160)
    const q = quote({ permitData: raw })
    const prepared = prepareRoutedSwap(fullIntent, q, approvals, contracts, time)
    const sign = async () => {
      events.push('sign')
      return '0x1234' as const
    }
    const signature = await sign()
    const simulateContract = vi.fn(async (call: { functionName: string }) => {
      if (call.functionName === 'execute') expect(mined).toBe(true)
      events.push(`simulate:${call.functionName}`)
      return {}
    })
    const deps = {
      wallet,
      chainId: 1,
      switchChain: vi.fn(),
      assertCallSafe: guard(true, simulateContract),
      writeContract: vi.fn(async () => '0xsubmitted'),
      waitForReceipt: vi.fn(async () => {
        mined = true
        time = nowMs + 31_000
        events.push('receipt')
        return { status: 'success' as const, transactionHash: '0xsubmitted' }
      }),
    }
    const approvalState = await runStagedPlan(prepared.approvalSteps, deps)
    expect(approvalState.status).toBe('success')
    const p = provider()
    p.requestQuote = vi.fn(async () => {
      expect(mined).toBe(true)
      events.push('quote')
      return quote({
        permitData: permit(maxUint160),
        expiresAt: new Date(time + 30_000).toISOString(),
      })
    })
    p.requestCalldata = vi.fn(async (request) => {
      expect(mined).toBe(true)
      expect(request.simulateTransaction).toBe(true)
      events.push('calldata')
      return { chainId: 1, swap: swap() }
    })
    const step = await resolveRoutedSwap({
      intent: fullIntent,
      quote: q,
      contracts,
      provider: p,
      signature,
      approvalsPending: false,
      now: () => time,
    })
    const state = await runStagedPlan([step], deps)
    expect(state).toMatchObject({ status: 'success', execution: 'sequential' })
    expect(p.requestQuote).toHaveBeenCalledWith(routedSwapQuoteRequest(fullIntent), 1)
    expect(p.requestCalldata).toHaveBeenCalledWith(
      expect.objectContaining({ permitData: raw, signature }),
      1,
      198n,
    )
    expect(events).toEqual([
      'sign',
      'simulate:approve',
      'receipt',
      'simulate:approve',
      'receipt',
      'quote',
      'calldata',
      'simulate:execute',
      'receipt',
    ])
  })
})
