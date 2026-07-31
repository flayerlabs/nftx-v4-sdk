import type { Abi, Address } from 'viem'

import type { NftxErrorCode } from '../errors'

/**
 * Plan types — DEPENDENCY-FREE. Both `encoders/` and `execution/` sit above this
 * module; `execution/` owns the runners, not the shape.
 *
 * A `PlanStep` is the rich, in-process executor/UI artifact (carries `abi`,
 * `label`, `skip`, native-`bigint` `value`/`args`). It is NOT the wire boundary —
 * `JSON.stringify` throws on its bigints and it embeds whole ABIs. The
 * serializable cross-process boundary is the encoded call `{ to, data, value }`
 * (see execution/encodeCalls); a lossless `serialize`/`deserialize` codec for a
 * full `PlanStep[]` is a fast-follow.
 */
export interface PlanStep {
  /** Stable id for view tracking (`approve`, `buy`, `sell`, `redeem`, `list`). */
  id: string
  /** Human label for the step list, e.g. "Approve NFTs". */
  label: string
  address: Address
  abi: Abi
  functionName: string
  args: readonly unknown[]
  /** Native ETH to attach (wei) — set for the ETH-funded buy steps. */
  value?: bigint
  /** Approval operator/spender, carried explicitly so guards don't depend on ABI arg positions. */
  approvalTarget?: Address
  /**
   * Account whose balances/ownership assumptions were used to build this step.
   * The execution guard refuses to submit it from another signer.
   */
  requiredAccount?: Address
  /**
   * Safe to resubmit after an interrupted queue without first proving the
   * original call's outcome. Approval setters qualify; economic calls do not.
   */
  replaySafe?: boolean
  /** Pre-resolved skip (e.g. allowance already granted): shown skipped, never submitted. */
  skip?: boolean
}

export type PlanStepStatus = 'pending' | 'signing' | 'mining' | 'done' | 'skipped' | 'error'

/** The view the UI renders per step — derived from the engine, never the source. */
export interface PlanStepView {
  id: string
  label: string
  status: PlanStepStatus
  /** Per-step tx hash (sequential path); the batch path shares one hash across steps. */
  txHash?: string
}

export type PlanStatus = 'idle' | 'switchingChain' | 'running' | 'success' | 'error'

/** Which execution strategy actually ran — the consumer must distinguish these. */
export type ExecutionPath = 'atomic' | 'sequential'

export interface PlanState {
  status: PlanStatus
  steps: PlanStepView[]
  /** Index of the step currently being processed. */
  current: number
  /**
   * The path actually taken (set once execution begins). `atomic` (ERC-5792
   * batch) commits all-or-nothing with no per-step attribution; `sequential` can
   * leave an approval committed after a later step fails and supports retry-from-failed.
   */
  execution?: ExecutionPath
  /** The final/surfaced tx hash (the last action for sequential; the bundle for atomic). */
  txHash?: string
  /** ERC-5792 call-bundle id retained to reconcile ambiguous atomic outcomes. */
  callsId?: string
  error?: unknown
  errorCode?: NftxErrorCode
}

export const INITIAL_PLAN_STATE: PlanState = { status: 'idle', steps: [], current: 0 }
