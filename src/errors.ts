import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from 'viem'

/**
 * The SDK's typed error surface. Built on viem's error chain (`BaseError.walk`)
 * rather than message-string matching, and preserving the original error via
 * `cause` for diagnostics.
 *
 * Public/stable surface: `code` + `shortMessage` (+ the typed subclass). The raw
 * `cause` chain is kept for opt-in verbose diagnostics but is NOT folded into the
 * top-level message, so raw revert bytes / RPC node strings / pool state don't
 * leak into consumer logs (threat T12).
 */
export type NftxErrorCode =
  | 'UNSUPPORTED_CHAIN'
  | 'CONTRACT_NOT_DEPLOYED'
  | 'OPERATOR_NOT_CONTRACT'
  | 'CHAIN_MISMATCH'
  | 'ACCOUNT_MISMATCH'
  | 'INVALID_INPUT'
  | 'WALLET'
  | 'USER_REJECTED'
  | 'TX_REVERTED'
  | 'UNKNOWN'

export class NftxSdkError extends Error {
  readonly code: NftxErrorCode
  /** Stable, safe-to-display message (no raw revert/RPC data). */
  readonly shortMessage: string

  constructor(code: NftxErrorCode, shortMessage: string, options?: { cause?: unknown }) {
    super(shortMessage, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'NftxSdkError'
    this.code = code
    this.shortMessage = shortMessage
  }
}

export class UnsupportedChainError extends NftxSdkError {
  constructor(readonly chainId: number, options?: { cause?: unknown }) {
    super('UNSUPPORTED_CHAIN', `NFTX v4 is not supported on chain ${chainId}.`, options)
    this.name = 'UnsupportedChainError'
  }
}

export class ContractNotDeployedError extends NftxSdkError {
  constructor(
    readonly contract: string,
    readonly chainId: number,
    readonly status?: string,
    options?: { cause?: unknown },
  ) {
    super(
      'CONTRACT_NOT_DEPLOYED',
      `Contract "${contract}" is not available on chain ${chainId}${
        status ? ` (status: ${status})` : ''
      }.`,
      options,
    )
    this.name = 'ContractNotDeployedError'
  }
}

export class OperatorNotContractError extends NftxSdkError {
  constructor(readonly address: string, options?: { cause?: unknown }) {
    super(
      'OPERATOR_NOT_CONTRACT',
      `Refusing to interact with ${address}: target has no code or failed identity verification.`,
      options,
    )
    this.name = 'OperatorNotContractError'
  }
}

export class ChainMismatchError extends NftxSdkError {
  constructor(
    readonly expected: number,
    readonly actual: number | undefined,
    options?: { cause?: unknown },
  ) {
    super(
      'CHAIN_MISMATCH',
      `Wallet is on chain ${actual ?? 'unknown'} but this action targets chain ${expected}.`,
      options,
    )
    this.name = 'ChainMismatchError'
  }
}

export class AccountMismatchError extends NftxSdkError {
  constructor(
    readonly expected: string,
    readonly actual: string | undefined,
    options?: { cause?: unknown },
  ) {
    super(
      'ACCOUNT_MISMATCH',
      `Signing account ${actual ?? 'unknown'} does not match the expected account ${expected}.`,
      options,
    )
    this.name = 'AccountMismatchError'
  }
}

export class InvalidInputError extends NftxSdkError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('INVALID_INPUT', message, options)
    this.name = 'InvalidInputError'
  }
}

export class WalletError extends NftxSdkError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('WALLET', message, options)
    this.name = 'WalletError'
  }
}

export class UserRejectedError extends NftxSdkError {
  constructor(options?: { cause?: unknown }) {
    super('USER_REJECTED', 'Request rejected in your wallet.', options)
    this.name = 'UserRejectedError'
  }
}

export class TxRevertedError extends NftxSdkError {
  constructor(message = 'The transaction reverted on-chain.', options?: { cause?: unknown }) {
    super('TX_REVERTED', message, options)
    this.name = 'TxRevertedError'
  }
}

/** True when `error` is the connected wallet declining a prompt (EIP-1193 4001). */
export function isUserRejection(error: unknown): boolean {
  if (error instanceof BaseError) {
    return Boolean(error.walk((e) => e instanceof UserRejectedRequestError))
  }
  const code = (error as { code?: unknown } | null)?.code
  return code === 4001 || code === 'ACTION_REJECTED'
}

/**
 * Map any thrown value to a typed `NftxSdkError`, preserving the original as
 * `cause`. SDK-thrown errors pass through unchanged; viem errors are classified
 * via the error chain; everything else becomes `UNKNOWN`.
 */
export function classifyError(error: unknown): NftxSdkError {
  if (error instanceof NftxSdkError) return error
  if (isUserRejection(error)) return new UserRejectedError({ cause: error })
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError)
    if (reverted) return new TxRevertedError(undefined, { cause: error })
    return new NftxSdkError('WALLET', 'A wallet or RPC error occurred.', { cause: error })
  }
  return new NftxSdkError('UNKNOWN', 'Something went wrong.', { cause: error })
}
