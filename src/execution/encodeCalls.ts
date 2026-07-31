import { encodeFunctionData, hexToBigInt, numberToHex, type Address, type Hex } from 'viem'

import type { PlanStep } from '../plan/types'
import { assertUniquePlanStepIds } from '../plan/validate'

/**
 * The single projector from the rich in-process `PlanStep` to a raw call
 * `{ to, data, value }` — the JSON-safe wire shape the SDK's `mode: 'calldata'`
 * returns. Encoders emit `PlanStep[]` only; this is the one place calldata is
 * derived, so the two representations can't drift.
 */
export interface EncodedCall {
  to: Address
  data: Hex
  /** JSON-safe EIP-1193 quantity hex. Convert to bigint only at wallet send. */
  value: Hex
}

export function planStepToCall(step: PlanStep): EncodedCall {
  return {
    to: step.address,
    data: encodeFunctionData({
      abi: step.abi,
      functionName: step.functionName,
      args: step.args,
    } as Parameters<typeof encodeFunctionData>[0]),
    value: numberToHex(step.value ?? 0n),
  }
}

/** Internal adapter for viem's `sendCalls`, which accepts bigint call values. */
export function encodedCallValueToBigInt(call: EncodedCall): bigint {
  return hexToBigInt(call.value)
}

/** Steps that actually run — skipped steps never reach the wallet, batched or not. */
export function executableSteps(steps: readonly PlanStep[]): PlanStep[] {
  return steps.filter((step) => !step.skip)
}

/** Encode every executable step to a batch call, in order. */
export function encodeBatchCalls(steps: readonly PlanStep[]): EncodedCall[] {
  assertUniquePlanStepIds(steps)
  return executableSteps(steps).map(planStepToCall)
}
