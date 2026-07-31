import { InvalidInputError } from '../errors'
import type { PlanStep } from './types'

/** Recovery and UI state address steps by id, so duplicates are never safe. */
export function assertUniquePlanStepIds(steps: readonly PlanStep[]): void {
  const ids = new Set<string>()
  for (const step of steps) {
    if (ids.has(step.id)) {
      throw new InvalidInputError(`Plan step ids must be unique; duplicate "${step.id}".`)
    }
    ids.add(step.id)
  }
}
