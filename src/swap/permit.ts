import type { Address } from 'viem'

import { InvalidInputError } from '../errors'
import { parseAddress, parseTokenId } from '../lib/validate'
import type { RoutedSwapContracts, RoutedSwapIntent } from './types'

// Verified against Uniswap/permit2 src/interfaces/IAllowanceTransfer.sol.
const types = {
  PermitSingle: [
    { name: 'details', type: 'PermitDetails' },
    { name: 'spender', type: 'address' },
    { name: 'sigDeadline', type: 'uint256' },
  ],
  PermitDetails: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint160' },
    { name: 'expiration', type: 'uint48' },
    { name: 'nonce', type: 'uint48' },
  ],
} as const

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidInputError('Malformed Permit2 typed data.')
  }
  return value as Record<string, unknown>
}

function address(value: unknown): Address {
  if (typeof value !== 'string') throw new InvalidInputError('Malformed permit address.')
  return parseAddress(value, 'permit address')
}

function uint(value: unknown, bits: number): bigint {
  if (
    !(typeof value === 'string' && /^\d+$/.test(value)) &&
    !(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
  ) {
    throw new InvalidInputError('Malformed permit integer.')
  }
  const result = parseTokenId(value as string | number)
  if (result >= 1n << BigInt(bits))
    throw new InvalidInputError(`Permit integer exceeds uint${bits}.`)
  return result
}

/** Checks every signed field and reconstructs the canonical PermitSingle type. */
export function routedSwapPermitTypedData(
  raw: unknown,
  intent: RoutedSwapIntent,
  contracts: RoutedSwapContracts,
  nowMs = Date.now(),
) {
  const envelope = record(raw)
  const domain = record(envelope.domain)
  const suppliedTypes = record(envelope.types)
  for (const [name, fields] of Object.entries(types)) {
    const provided = suppliedTypes[name]
    const list = Array.isArray(provided) ? provided : record(provided).fields
    if (
      !Array.isArray(list) ||
      list.length !== fields.length ||
      fields.some((field, i) => {
        const supplied = record(list[i])
        return supplied.name !== field.name || supplied.type !== field.type
      })
    )
      throw new InvalidInputError('Unsupported Permit2 typed data types.')
  }
  const values = record(envelope.values)
  const details = record(values.details)
  const message = {
    details: {
      token: address(details.token),
      amount: uint(details.amount, 160),
      expiration: uint(details.expiration, 48),
      nonce: uint(details.nonce, 48),
    },
    spender: address(values.spender),
    sigDeadline: uint(values.sigDeadline, 256),
  }
  if (
    domain.name !== 'Permit2' ||
    domain.version !== undefined ||
    domain.salt !== undefined ||
    uint(domain.chainId, 256) !== BigInt(intent.chainId) ||
    address(domain.verifyingContract) !== parseAddress(contracts.permit2) ||
    message.spender !== parseAddress(contracts.universalRouter) ||
    message.details.token !== parseAddress(intent.tokenIn) ||
    (intent.permitAmount === 'FULL'
      ? message.details.amount < intent.amountIn
      : message.details.amount !== intent.amountIn)
  ) {
    throw new InvalidInputError('Permit2 authorization does not match the swap intent.')
  }
  const horizon = BigInt(Math.floor(nowMs / 1000) + 60)
  if (message.details.expiration < horizon || message.sigDeadline < horizon) {
    throw new InvalidInputError('Permit2 authorization is about to expire.')
  }
  return {
    domain: {
      name: 'Permit2',
      chainId: intent.chainId,
      verifyingContract: parseAddress(contracts.permit2),
    },
    types,
    primaryType: 'PermitSingle' as const,
    message,
  }
}

export type RoutedSwapPermitTypedData = ReturnType<typeof routedSwapPermitTypedData>
