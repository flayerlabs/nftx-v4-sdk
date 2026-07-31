import { formatUnits as viemFormatUnits, parseUnits as viemParseUnits } from 'viem'

import { InvalidInputError } from '../errors'

/** Anything the SDK accepts where a `bigint` amount is meant. */
export type BigIntish = bigint | string | number

/**
 * Coerce a {@link BigIntish} to `bigint`, rejecting non-integers and malformed
 * strings with a typed `InvalidInputError`. `number` inputs must be safe
 * integers (use a `bigint` or decimal string for large values).
 */
export function toBigInt(value: BigIntish, label = 'amount'): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new InvalidInputError(`${label} must be an integer, got ${value}.`)
    }
    if (!Number.isSafeInteger(value)) {
      throw new InvalidInputError(`${label} exceeds the safe integer range — pass a bigint or string.`)
    }
    return BigInt(value)
  }
  if (!/^-?\d+$/.test(value.trim())) {
    throw new InvalidInputError(`${label} must be an integer string, got "${value}".`)
  }
  return BigInt(value.trim())
}

/** viem `parseUnits` re-exported (string decimal → bigint base units). */
export const parseUnits = viemParseUnits

/** viem `formatUnits` re-exported (bigint base units → string decimal). */
export const formatUnits = viemFormatUnits
