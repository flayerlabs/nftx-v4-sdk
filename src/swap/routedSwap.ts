import { decodeFunctionData, encodeFunctionData, erc20Abi, zeroAddress, type Hex } from 'viem'

import { universalRouterAbi } from '../abi/universalRouter'
import { AccountMismatchError, ChainMismatchError, InvalidInputError } from '../errors'
import {
  MAX_UINT256,
  parseAddress,
  parseAddressAllowZero,
  parsePositiveAmount,
  parseTokenId,
} from '../lib/validate'
import type { PlanStep } from '../plan/types'
import { routedSwapPermitTypedData } from './permit'
import type {
  RoutedSwapApproval,
  RoutedSwapContracts,
  RoutedSwapIntent,
  RoutedSwapQuote,
  RoutedSwapQuoteRequest,
  RoutedSwapTransaction,
  TrustedRoutedSwapProvider,
} from './types'

export function routedSwapQuoteRequest(intent: RoutedSwapIntent): RoutedSwapQuoteRequest {
  if (
    !Number.isSafeInteger(intent.chainId) ||
    intent.chainId <= 0 ||
    !Number.isInteger(intent.slippageBps) ||
    intent.slippageBps < 0 ||
    intent.slippageBps >= 10_000 ||
    intent.amountIn > MAX_UINT256 ||
    (intent.permitAmount !== undefined &&
      intent.permitAmount !== 'EXACT' &&
      intent.permitAmount !== 'FULL')
  )
    throw new InvalidInputError('Invalid routed swap parameters.')
  const tokenIn = parseAddressAllowZero(intent.tokenIn)
  const tokenOut = parseAddressAllowZero(intent.tokenOut)
  if (tokenIn === tokenOut) throw new InvalidInputError('Swap tokens must differ.')
  return {
    type: 'EXACT_INPUT',
    amount: parsePositiveAmount(intent.amountIn).toString(),
    tokenIn,
    tokenOut,
    taker: parseAddress(intent.account),
    recipient: parseAddress(intent.account),
    slippageBps: intent.slippageBps,
    generatePermitAsTransaction: false,
    permitAmount: intent.permitAmount ?? 'EXACT',
  }
}

function assertTransaction(tx: RoutedSwapTransaction, intent: RoutedSwapIntent) {
  if (tx.chainId !== intent.chainId) throw new ChainMismatchError(intent.chainId, tx.chainId)
  if (parseAddress(tx.from) !== parseAddress(intent.account))
    throw new AccountMismatchError(intent.account, tx.from)
}

function assertQuote(
  quote: RoutedSwapQuote,
  intent: RoutedSwapIntent,
  nowMs: number,
  fresh: boolean,
): bigint {
  routedSwapQuoteRequest(intent)
  if (quote.chainId !== intent.chainId) throw new ChainMismatchError(intent.chainId, quote.chainId)
  if (
    quote.type !== 'EXACT_INPUT' ||
    quote.slippageBps !== intent.slippageBps ||
    quote.routing !== 'CLASSIC' ||
    quote.permitTransaction != null ||
    parseAddressAllowZero(quote.tokenIn) !== parseAddressAllowZero(intent.tokenIn) ||
    parseAddressAllowZero(quote.input.token) !== parseAddressAllowZero(intent.tokenIn) ||
    parseAddressAllowZero(quote.tokenOut) !== parseAddressAllowZero(intent.tokenOut) ||
    parseAddressAllowZero(quote.output.token) !== parseAddressAllowZero(intent.tokenOut) ||
    parseAddress(quote.taker) !== parseAddress(intent.account) ||
    (quote.recipient != null && parseAddress(quote.recipient) !== parseAddress(intent.account)) ||
    (quote.output.recipient != null &&
      parseAddress(quote.output.recipient) !== parseAddress(intent.account)) ||
    parseTokenId(quote.amount) !== intent.amountIn ||
    parseTokenId(quote.input.amount) !== intent.amountIn
  ) {
    throw new InvalidInputError('Quote does not match the routed swap intent.')
  }
  const expiry = Date.parse(quote.expiresAt)
  if (!Number.isFinite(expiry) || (fresh && expiry <= nowMs + 5_000)) {
    throw new InvalidInputError('Swap quote is expired or about to expire.')
  }
  if (quote.output.minimumAmount == null)
    throw new InvalidInputError('Quote must include a minimum output.')
  const minimum = parsePositiveAmount(quote.output.minimumAmount)
  const output = parsePositiveAmount(quote.output.amount)
  if (minimum > output || minimum < (output * BigInt(10_000 - intent.slippageBps)) / 10_000n) {
    throw new InvalidInputError('Invalid quote minimum output.')
  }
  return minimum
}

/**
 * Returns existing write PlanSteps and optional typed data to sign separately.
 * Sign first, then execute approvals sequentially or batch them with the swap.
 * EXACT caps ERC20 approvals to the input; FULL preserves the provider's amount.
 */
export function prepareRoutedSwap(
  intent: RoutedSwapIntent,
  quote: RoutedSwapQuote,
  approvals: RoutedSwapApproval | null,
  contracts: RoutedSwapContracts,
  nowMs = Date.now(),
) {
  assertQuote(quote, intent, nowMs, true)
  parseAddress(contracts.universalRouter)
  const permit2 = parseAddress(contracts.permit2)
  const native = parseAddressAllowZero(intent.tokenIn) === zeroAddress
  if (approvals && approvals.chainId !== intent.chainId)
    throw new ChainMismatchError(intent.chainId, approvals.chainId)
  if (approvals?.cancel && !approvals.approval) {
    throw new InvalidInputError('An allowance reset requires a replacement approval.')
  }
  if (native && (quote.permitData != null || approvals?.cancel || approvals?.approval)) {
    throw new InvalidInputError('Native currency swaps do not need approvals or permits.')
  }
  const approvalSteps: PlanStep[] = []
  for (const [id, tx] of [
    ['cancel', approvals?.cancel],
    ['approve', approvals?.approval],
  ] as const) {
    if (!tx) continue
    assertTransaction(tx, intent)
    if (parseAddress(tx.to) !== parseAddress(intent.tokenIn) || parseTokenId(tx.value) !== 0n) {
      throw new InvalidInputError('Approval transaction does not match the input token.')
    }
    const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data })
    if (
      decoded.functionName !== 'approve' ||
      parseAddress(decoded.args[0]) !== permit2 ||
      (id === 'cancel' ? decoded.args[1] !== 0n : decoded.args[1] < intent.amountIn)
    ) {
      throw new InvalidInputError(
        'Approval does not authorize the expected Permit2 spender and amount.',
      )
    }
    approvalSteps.push({
      id,
      label: id === 'cancel' ? 'Reset token allowance' : 'Approve swap input',
      address: parseAddress(intent.tokenIn),
      abi: erc20Abi,
      functionName: 'approve',
      args: [
        permit2,
        id === 'cancel' || intent.permitAmount === 'FULL' ? decoded.args[1] : intent.amountIn,
      ],
      requiredAccount: intent.account,
      approvalTarget: permit2,
      replaySafe: true,
    })
  }
  return {
    approvalSteps,
    permitTypedData:
      quote.permitData == null
        ? undefined
        : routedSwapPermitTypedData(quote.permitData, intent, contracts, nowMs),
  }
}

export interface ResolveRoutedSwapInput {
  intent: RoutedSwapIntent
  quote: RoutedSwapQuote
  contracts: RoutedSwapContracts
  provider: TrustedRoutedSwapProvider
  signature?: Hex
  /**
   * Set only when resolving before approvals execute in the same atomic batch.
   * Skips the provider's current-state simulation, which cannot see those approvals.
   * Omit after sequential approval receipts, or when no approval is required.
   */
  approvalsPending?: boolean
  now?: () => number
}

/** Resolves a guarded write; caller uses the existing executor and receipt handling. */
export async function resolveRoutedSwap(input: ResolveRoutedSwapInput): Promise<PlanStep> {
  const { intent, contracts, provider } = input
  const now = input.now ?? Date.now
  let quote = input.quote
  const floor = assertQuote(quote, intent, now(), false)
  const originalPermit =
    quote.permitData == null
      ? undefined
      : routedSwapPermitTypedData(quote.permitData, intent, contracts, now())
  if ((originalPermit !== undefined) !== (input.signature !== undefined))
    throw new InvalidInputError('Swap permit signature is missing or unexpected.')
  if (now() >= Date.parse(quote.expiresAt) - 5_000) {
    quote = await provider.requestQuote(routedSwapQuoteRequest(intent), intent.chainId)
    if (assertQuote(quote, intent, now(), true) < floor)
      throw new InvalidInputError(
        'Price moved below the confirmed minimum output; request a new quote.',
      )
    const freshPermit =
      quote.permitData == null
        ? undefined
        : routedSwapPermitTypedData(quote.permitData, intent, contracts, now())
    // An unexpired signature is independent of the price quote. Reuse it when
    // the refreshed allowance nonce agrees; no second signature prompt needed.
    if (
      (!originalPermit && freshPermit) ||
      (originalPermit &&
        freshPermit &&
        freshPermit.message.details.nonce !== originalPermit.message.details.nonce)
    ) {
      throw new InvalidInputError('Permit changed; prepare and sign the swap again.')
    }
  }
  const {
    requestId,
    routing,
    quoteId,
    type,
    amount,
    tokenIn,
    tokenOut,
    taker,
    slippageBps,
    expiresAt,
  } = quote
  const response = await provider.requestCalldata(
    {
      quote: quote.quote,
      ...(originalPermit
        ? { permitData: input.quote.permitData, signature: input.signature! }
        : {}),
      expected: {
        requestId,
        routing,
        quoteId,
        type,
        amount,
        tokenIn,
        tokenOut,
        taker,
        recipient: intent.account,
        slippageBps,
        expiresAt,
      },
      refreshGasPrice: true,
      simulateTransaction: !input.approvalsPending,
    },
    intent.chainId,
    floor,
  )
  assertQuote(quote, intent, now(), true)
  if (originalPermit) routedSwapPermitTypedData(input.quote.permitData, intent, contracts, now())
  if (response.chainId !== intent.chainId)
    throw new ChainMismatchError(intent.chainId, response.chainId)
  const tx = response.swap
  assertTransaction(tx, intent)
  const native = parseAddressAllowZero(intent.tokenIn) === zeroAddress
  if (
    parseAddress(tx.to) !== parseAddress(contracts.universalRouter) ||
    parseTokenId(tx.value) !== (native ? intent.amountIn : 0n)
  ) {
    throw new InvalidInputError('Swap transaction target or native value does not match.')
  }
  const decoded = decodeFunctionData({ abi: universalRouterAbi, data: tx.data })
  const [commands, inputs, deadline] = decoded.args
  if (
    commands.length <= 2 ||
    (commands.length - 2) / 2 !== inputs.length ||
    deadline < BigInt(Math.floor(now() / 1000) + 60)
  )
    throw new InvalidInputError('Unsupported commands or expiring router deadline.')
  const canonical = encodeFunctionData({
    abi: universalRouterAbi,
    functionName: 'execute',
    args: decoded.args,
  })
  // The Trading API may append attribution bytes. Submit only the canonical ABI prefix.
  if (!tx.data.toLowerCase().startsWith(canonical.toLowerCase()))
    throw new InvalidInputError('Router calldata did not decode losslessly.')
  return {
    id: 'swap',
    label: 'Swap tokens',
    requiredAccount: intent.account,
    address: parseAddress(tx.to),
    abi: universalRouterAbi,
    functionName: 'execute',
    args: decoded.args,
    value: native ? intent.amountIn : 0n,
  }
}
