import { describe, expect, it } from 'vitest'
import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from 'viem'

import {
  ChainMismatchError,
  classifyError,
  ContractNotDeployedError,
  InvalidInputError,
  isUserRejection,
  NftxSdkError,
  TxRevertedError,
  UserRejectedError,
} from './errors'

describe('errors', () => {
  it('detects a wallet rejection via the viem error chain', () => {
    const rejection = new BaseError('User rejected', {
      cause: new UserRejectedRequestError(new Error('denied')),
    })
    expect(isUserRejection(rejection)).toBe(true)
    expect(isUserRejection({ code: 4001 })).toBe(true)
    expect(isUserRejection(new Error('nope'))).toBe(false)
  })

  it('classifies rejection, revert, and unknown distinctly, preserving cause', () => {
    const rejection = new BaseError('rejected', {
      cause: new UserRejectedRequestError(new Error('x')),
    })
    const classifiedRejection = classifyError(rejection)
    expect(classifiedRejection).toBeInstanceOf(UserRejectedError)
    expect(classifiedRejection.code).toBe('USER_REJECTED')
    expect(classifiedRejection.cause).toBe(rejection)

    const revert = new BaseError('reverted', {
      cause: new ContractFunctionRevertedError({
        abi: [],
        functionName: 'x',
        message: 'execution reverted',
      }),
    })
    expect(classifyError(revert)).toBeInstanceOf(TxRevertedError)

    const unknown = classifyError(new Error('boom'))
    expect(unknown.code).toBe('UNKNOWN')
    expect(unknown).toBeInstanceOf(NftxSdkError)
  })

  it('passes SDK errors through unchanged', () => {
    const original = new InvalidInputError('bad')
    expect(classifyError(original)).toBe(original)
  })

  it('keeps distinct typed security categories', () => {
    const chain = new ChainMismatchError(8453, 84532)
    const notDeployed = new ContractNotDeployedError('nftxZap', 8453, 'nocode')
    expect(chain.code).toBe('CHAIN_MISMATCH')
    expect(notDeployed.code).toBe('CONTRACT_NOT_DEPLOYED')
    expect(chain).not.toBeInstanceOf(ContractNotDeployedError)
    // shortMessage is the safe, stable surface (no raw revert/RPC data)
    expect(notDeployed.shortMessage).toContain('nftxZap')
  })
})
