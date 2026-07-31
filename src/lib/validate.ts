import { type Address, getAddress, isAddress, zeroAddress } from 'viem'

import { type BigIntish, toBigInt } from '../math/amount'
import { InvalidInputError } from '../errors'

/**
 * Boundary validators reused by every encoder. Addresses are checksum-validated
 * (viem `getAddress`) and the zero address is rejected — a TypeScript `as Address`
 * cast is not a runtime check (Uniswap's `validateAndParseAddress` discipline,
 * threat T5).
 */

const MAX_UINT256 = (1n << 256n) - 1n

/** Checksum + format validate an address; reject the zero address. */
export function parseAddress(value: string, label = 'address'): Address {
  const checksummed = parseAddressAllowZero(value, label)
  if (checksummed === zeroAddress) {
    throw new InvalidInputError(`${label} cannot be the zero address.`)
  }
  return checksummed
}

/** Checksum + format validate an address while allowing a deliberate zero sentinel. */
export function parseAddressAllowZero(value: string, label = 'address'): Address {
  if (!isAddress(value, { strict: false })) {
    throw new InvalidInputError(`Invalid ${label}: "${value}".`)
  }
  return getAddress(value)
}

/** Validate a single token id is an integer in `[0, 2^256)`. */
export function parseTokenId(value: BigIntish, label = 'token id'): bigint {
  const id = toBigInt(value, label)
  if (id < 0n) throw new InvalidInputError(`${label} cannot be negative.`)
  if (id > MAX_UINT256) throw new InvalidInputError(`${label} exceeds uint256.`)
  return id
}

export interface TokenIdsOptions {
  /** Reject more than this many ids (gas-grief guard). */
  maxLength?: number
  /** Reject duplicate ids (default true — duplicates are unsafe for redeem/sell). */
  allowDuplicates?: boolean
}

/** Validate a non-empty list of token ids; reject duplicates and over-length. */
export function parseTokenIds(
  values: readonly BigIntish[],
  { maxLength = 100, allowDuplicates = false }: TokenIdsOptions = {},
  label = 'token ids',
): bigint[] {
  if (values.length === 0) throw new InvalidInputError(`${label}: nothing selected.`)
  if (values.length > maxLength) {
    throw new InvalidInputError(`${label}: too many (${values.length} > ${maxLength}).`)
  }
  const ids = values.map((v) => parseTokenId(v))
  if (!allowDuplicates) {
    const seen = new Set<bigint>()
    for (const id of ids) {
      if (seen.has(id)) throw new InvalidInputError(`${label}: duplicate id ${id}.`)
      seen.add(id)
    }
  }
  return ids
}

/** Require a strictly-positive amount; returns it as `bigint`. */
export function parsePositiveAmount(value: BigIntish, label = 'amount'): bigint {
  const amount = toBigInt(value, label)
  if (amount <= 0n) throw new InvalidInputError(`${label} must be greater than zero.`)
  return amount
}

/** Require a non-negative amount; returns it as `bigint`. */
export function parseNonNegativeAmount(value: BigIntish, label = 'amount'): bigint {
  const amount = toBigInt(value, label)
  if (amount < 0n) throw new InvalidInputError(`${label} cannot be negative.`)
  return amount
}

export { MAX_UINT256 }
