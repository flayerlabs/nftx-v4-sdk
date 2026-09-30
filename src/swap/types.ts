import type { Address, Hex } from 'viem'

export interface RoutedSwapIntent {
  chainId: number
  account: Address
  /** The zero address represents the chain's native currency. */
  tokenIn: Address
  tokenOut: Address
  amountIn: bigint
  slippageBps: number
}

export interface RoutedSwapContracts {
  permit2: Address
  universalRouter: Address
}

export interface RoutedSwapTransaction {
  chainId: number
  from: Address
  to: Address
  data: Hex
  value: string
}

export interface RoutedSwapApproval {
  chainId: number
  cancel: RoutedSwapTransaction | null
  approval: RoutedSwapTransaction | null
}

export interface RoutedSwapQuoteRequest {
  type: 'EXACT_INPUT'
  amount: string
  tokenIn: Address
  tokenOut: Address
  taker: Address
  recipient: Address
  slippageBps: number
  generatePermitAsTransaction: false
  permitAmount: 'EXACT'
}

export interface RoutedSwapQuote {
  chainId: number
  requestId: string
  routing: string
  quoteId: string | null
  type: 'EXACT_INPUT' | 'EXACT_OUTPUT'
  amount: string
  tokenIn: Address
  tokenOut: Address
  taker: Address
  recipient?: Address | null
  slippageBps: number
  input: { token: Address; amount: string }
  output: {
    token: Address
    amount: string
    minimumAmount?: string | null
    recipient?: Address | null
  }
  expiresAt: string
  permitData: unknown | null
  permitTransaction: RoutedSwapTransaction | null
  /** Opaque payload; forwarded unchanged to the provider. */
  quote: unknown
}

export interface RoutedSwapCalldataRequest {
  quote: unknown
  permitData?: unknown
  signature?: Hex
  expected: Pick<
    RoutedSwapQuote,
    | 'requestId'
    | 'routing'
    | 'quoteId'
    | 'type'
    | 'amount'
    | 'tokenIn'
    | 'tokenOut'
    | 'taker'
    | 'slippageBps'
    | 'expiresAt'
  > & { recipient: Address }
  refreshGasPrice: true
  simulateTransaction: true
}

/**
 * Explicit trust boundary: this provider must validate router command economics,
 * including spend, recipient, token pair and the supplied minimum output.
 * The SDK validates the outer transaction, not Uniswap's nested command language.
 * Use an audited provider; a raw third-party calldata proxy is insufficient.
 */
export interface TrustedRoutedSwapProvider {
  requestQuote(request: RoutedSwapQuoteRequest, chainId: number): Promise<RoutedSwapQuote>
  requestCalldata(
    request: RoutedSwapCalldataRequest,
    chainId: number,
    minimumAmountOut: bigint,
  ): Promise<{ chainId: number; swap: RoutedSwapTransaction }>
}
