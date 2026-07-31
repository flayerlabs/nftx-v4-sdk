import { classifyError, TxRevertedError, WalletError } from '../errors'
import { INITIAL_PLAN_STATE, type PlanState, type PlanStep, type PlanStepView } from '../plan/types'
import { assertUniquePlanStepIds } from '../plan/validate'
import { type EncodedCall, encodeBatchCalls, executableSteps } from './encodeCalls'
import type { PlanWalletSnapshot } from './stagedPlan'

/**
 * The ERC-5792 atomic-batch executor (one wallet prompt, all-or-nothing). PURE +
 * dependency-injected — the facade wires viem's stable `sendCalls`
 * (returns `{ id }`) and `waitForCallsStatus`. Stamps `execution: 'atomic'`. The
 * batch-vs-sequential decision (probe-then-choose via `getCapabilities`) and
 * `requireAtomic` live at the facade; this just runs the batch.
 */
export interface CallsStatusResult {
  status: 'success' | 'failure' | 'pending'
  /** EIP-5792 numeric status code (100/200/400/500/600). */
  statusCode?: number
  /** Whether the wallet reports this bundle executed atomically. */
  atomic?: boolean
  receipts?: { transactionHash: string; status?: 'success' | 'reverted' }[]
}

export interface BatchDeps {
  wallet: PlanWalletSnapshot
  chainId: number
  switchChain: (chainId: number) => Promise<void>
  assertCallSafe?: (step: PlanStep) => Promise<void> | void
  /** ERC-5792 `sendCalls` → `{ id }` (viem-stable return shape). */
  sendCalls: (calls: EncodedCall[]) => Promise<{ id: string }>
  /** `waitForCallsStatus(id)` → terminal status + receipts. */
  waitForCallsStatus: (id: string) => Promise<CallsStatusResult>
}

export async function runBatch(
  steps: readonly PlanStep[],
  deps: BatchDeps,
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
    execution: 'atomic',
  }

  const emit = (patch: Partial<PlanState> = {}): PlanState => {
    state = { ...state, ...patch, steps: views.map((view) => ({ ...view })) }
    onState(state)
    return state
  }

  const setExecutable = (status: PlanStepView['status'], txHash?: string) => {
    steps.forEach((step, i) => {
      if (!step.skip) views[i] = { ...views[i]!, status, ...(txHash ? { txHash } : {}) }
    })
  }

  let callsId: string | undefined
  let txHash: string | undefined
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

    const exec = executableSteps(steps)
    for (const step of exec) await deps.assertCallSafe?.(step)

    setExecutable('signing')
    emit()
    const { id } = await deps.sendCalls(encodeBatchCalls(steps))
    callsId = id

    setExecutable('mining')
    emit({ callsId })
    let result: CallsStatusResult
    try {
      result = await deps.waitForCallsStatus(id)
    } catch (cause) {
      throw new WalletError(
        'The wallet could not confirm the batch status; reconcile callsId before retrying.',
        { cause },
      )
    }
    txHash = result.receipts?.[result.receipts.length - 1]?.transactionHash
    if (result.status !== 'success') {
      setExecutable('error', txHash)
      if (result.status === 'failure' && result.statusCode === 500) {
        throw new TxRevertedError('The batch reverted on-chain.', { cause: result })
      }
      throw new WalletError(
        `The wallet returned an ambiguous batch status (${result.statusCode ?? result.status}); reconcile callsId before retrying.`,
        { cause: result },
      )
    }
    if (exec.length > 1 && result.atomic !== true) {
      setExecutable('error', txHash)
      throw new WalletError('Wallet did not confirm atomic execution for the call bundle.', {
        cause: result,
      })
    }

    setExecutable('done', txHash)
    return emit({
      status: 'success',
      current: steps.length,
      callsId,
      ...(txHash ? { txHash } : {}),
    })
  } catch (error) {
    if (callsId) setExecutable('error', txHash)
    const classified = classifyError(error)
    return emit({
      status: 'error',
      error,
      errorCode: classified.code,
      ...(callsId ? { callsId } : {}),
      ...(txHash ? { txHash } : {}),
    })
  }
}
