import {
  BaseError,
  ContractFunctionRevertedError,
  type Address,
  getAddress,
  type PublicClient,
  type WalletClient,
} from 'viem'

import { type ContractOverrides, getContracts } from '../addresses/resolve'
import {
  AccountMismatchError,
  ChainMismatchError,
  classifyError,
  InvalidInputError,
  OperatorNotContractError,
  TxRevertedError,
  WalletError,
} from '../errors'
import type { PlanStep } from '../plan/types'

/**
 * The facade guard layer (R9). A pure encoder's `{to,data,value}` is unsafe to
 * broadcast until this has run for the step:
 *   - chain match across the wallet + the target (re-asserted per call)
 *   - account pinned + matched to the account the skip/allowance reads used
 *   - `getCode(target)` non-empty (T1 — a value/approval call to a codeless
 *     address does NOT revert; it burns funds)
 *   - approvals: the operator/spender has code AND is a resolved live operator
 *     (T2/T8 — never approve to a wrong/no-code address)
 *   - (sequential only) a JIT pre-submit `simulateContract` to observe the spend
 *
 * `getCode` proves existence, not identity — a per-chain codehash or
 * view-invariant identity probe is a follow-up hardening (T1).
 */
export interface CallGuardConfig {
  chainId: number
  publicClient: PublicClient
  walletClient: WalletClient
  expectedAccount: Address
  contracts?: ContractOverrides
  /** Sequential JIT simulate before submit. False for the atomic batch (can't
   *  simulate a post-approval action mid-bundle) and for calldata mode (TOCTOU). */
  simulate: boolean
}

const APPROVAL_FNS = new Set(['setApprovalForAll', 'approve'])

export function createCallGuard(cfg: CallGuardConfig): (step: PlanStep) => Promise<void> {
  const liveAddresses = new Set(
    Object.values(getContracts(cfg.chainId, cfg.contracts))
      .filter((e) => e?.status === 'live')
      .map((e) => e!.address.toLowerCase()),
  )

  const hasCode = async (address: Address): Promise<boolean> => {
    const code = await cfg.publicClient.getCode({ address })
    return Boolean(code) && code !== '0x'
  }

  return async (step: PlanStep) => {
    const publicChainId = cfg.publicClient.chain?.id
    if (publicChainId !== cfg.chainId) throw new ChainMismatchError(cfg.chainId, publicChainId)

    const walletChainId = cfg.walletClient.chain?.id
    if (walletChainId !== cfg.chainId) throw new ChainMismatchError(cfg.chainId, walletChainId)
    const account = cfg.walletClient.account?.address
    if (!account) throw new WalletError('No signing account on the wallet client.')
    if (getAddress(account) !== getAddress(cfg.expectedAccount)) {
      throw new AccountMismatchError(cfg.expectedAccount, account)
    }
    if (
      step.requiredAccount &&
      getAddress(step.requiredAccount) !== getAddress(cfg.expectedAccount)
    ) {
      throw new AccountMismatchError(step.requiredAccount, cfg.expectedAccount)
    }

    // T1: the called contract must have code.
    if (!(await hasCode(step.address))) throw new OperatorNotContractError(step.address)

    // T2/T8: an approval's operator/spender must be a resolved live operator with code.
    if (APPROVAL_FNS.has(step.functionName)) {
      const operator = step.approvalTarget
      if (!operator)
        throw new InvalidInputError(`Approval step "${step.id}" is missing approvalTarget.`)
      if (!liveAddresses.has(operator.toLowerCase())) throw new OperatorNotContractError(operator)
      if (!(await hasCode(operator))) throw new OperatorNotContractError(operator)
    }

    // Sequential JIT simulate — observe the real spend before broadcast.
    if (cfg.simulate) {
      try {
        await cfg.publicClient.simulateContract({
          address: step.address,
          abi: step.abi,
          functionName: step.functionName,
          args: step.args,
          account: cfg.expectedAccount,
          ...(step.value !== undefined ? { value: step.value } : {}),
        } as unknown as Parameters<PublicClient['simulateContract']>[0])
      } catch (cause) {
        if (!(cause instanceof BaseError)) throw classifyError(cause)
        const reverted = cause.walk((error) => error instanceof ContractFunctionRevertedError)
        if (!reverted) throw classifyError(cause)
        throw new TxRevertedError('Pre-submit simulation reverted.', { cause })
      }
    }
  }
}
