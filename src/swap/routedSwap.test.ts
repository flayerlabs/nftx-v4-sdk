import { encodeFunctionData, erc20Abi, maxUint256, zeroAddress, type Address } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { universalRouterAbi } from '../abi/universalRouter'
import { runStagedPlan } from '../execution/stagedPlan'
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

function permit() {
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
      details: { token: tokenIn, amount: '100', expiration: nowMs / 1000 + 900, nonce: '0' },
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
