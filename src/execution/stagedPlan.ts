import type { Address } from 'viem'

import { classifyError, TxRevertedError, WalletError } from '../errors'
import { INITIAL_PLAN_STATE, type PlanState, type PlanStep, type PlanStepView } from '../plan/types'
import { assertUniquePlanStepIds } from '../plan/validate'

/**
 * The multi-step plan executor as a PURE, dependency-injected runner. It submits
 * an ordered `PlanStep[]` through the wallet, awaiting each receipt before
 * advancing, and drives `onState` with per-step views. All side effects (chain
 * switch, the safety guard, writes, receipt waits) are injected so the queue's
 * ordering/guards are unit-tested with fakes.
 *
 * It NEVER rejects — the terminal `error` state carries the classified error.
 * Resume safety: skipped steps are never submitted, so a re-run after a partial
 * failure won't duplicate an approval (the builder recomputes `skip` from a fresh
 * allowance read). Stamps `execution: 'sequential'`.
 */
export interface PlanWalletSnapshot {
  isConnected: boolean
  address?: Address
  chainId?: number
}

export interface PlanReceipt {
  status: 'success' | 'reverted'
  transactionHash: string
}

export interface StagedPlanDeps {
  wallet: PlanWalletSnapshot
  /** The chain every step runs on. */
  chainId: number
  /** Switch the wallet to the target chain; resolves once active. */
  switchChain: (chainId: number) => Promise<void>
  /**
   * Pre-submit safety guard run before EACH executable step: re-assert chain +
   * account, `getCode`(target) non-empty, and (sequentially) simulate.
   * Throws a typed error to abort. Optional so the pure engine can be tested
   * without RPC; the facade always supplies it.
   */
  assertCallSafe?: (step: PlanStep) => Promise<void> | void
  /** Submit a contract-write step; resolves to the tx hash. */
  writeContract: (step: PlanStep) => Promise<string>
  /** Wait for a tx receipt; resolves with its on-chain status. */
  waitForReceipt: (hash: string) => Promise<PlanReceipt>
}

export async function runStagedPlan(
  steps: readonly PlanStep[],
  deps: StagedPlanDeps,
  onState: (state: PlanState) => void = () => {},
): Promise<PlanState> {
  const views: PlanStepView[] = steps.map((step) => ({
    id: step.id,
    label: step.label,
    status: step.skip ? 'skipped' : 'pending',
  }))
  let state: PlanState = {
    ...INITIAL_PLAN_STATE,
    status: 'running',
    steps: views,
    current: 0,
    execution: 'sequential',
  }

  const emit = (patch: Partial<PlanState> = {}): PlanState => {
    state = { ...state, ...patch, steps: views.map((view) => ({ ...view })) }
    onState(state)
    return state
  }

  try {
    assertUniquePlanStepIds(steps)
    if (!deps.wallet.isConnected || !deps.wallet.address) {
      throw new WalletError('Connect your wallet to continue.')
    }

    if (deps.wallet.chainId !== deps.chainId) {
      emit({ status: 'switchingChain' })
      await deps.switchChain(deps.chainId)
    }
    emit({ status: 'running' })

    let lastHash: string | undefined
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!
      state = { ...state, current: i }

      if (step.skip) {
        views[i] = { ...views[i]!, status: 'skipped' }
        emit()
        continue
      }

      // Guard immediately before submit (chain/account/getCode/identity/simulate).
      await deps.assertCallSafe?.(step)

      views[i] = { ...views[i]!, status: 'signing' }
      emit()
      const hash = await deps.writeContract(step)

      views[i] = { ...views[i]!, status: 'mining', txHash: hash }
      emit()
      const receipt = await deps.waitForReceipt(hash)
      if (receipt.status !== 'success') {
        views[i] = { ...views[i]!, status: 'error', txHash: hash }
        throw new TxRevertedError(undefined, { cause: receipt })
      }

      views[i] = { ...views[i]!, status: 'done', txHash: hash }
      emit()
      lastHash = hash
    }

    return emit({ status: 'success', current: steps.length, ...(lastHash ? { txHash: lastHash } : {}) })
  } catch (error) {
    const i = state.current
    const active = views[i]
    if (active && active.status !== 'skipped' && active.status !== 'done') {
      views[i] = { ...active, status: 'error' }
    }
    const classified = classifyError(error)
    return emit({ status: 'error', error, errorCode: classified.code })
  }
}
