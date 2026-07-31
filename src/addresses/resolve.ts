import type { Address } from 'viem'

import { ContractNotDeployedError, UnsupportedChainError } from '../errors'
import { parseAddress } from '../lib/validate'
import {
  ADDRESS_TABLES,
  type ChainContracts,
  type ContractEntry,
  type ContractKey,
  live,
} from './tables'

/**
 * Consumer-supplied per-contract address overrides. Lets a caller re-point a
 * contract (for example, a fork or staging deployment)
 * without waiting for an SDK release. An override is a TRUST ESCALATION: the
 * facade still runs the runtime `getCode`+identity guard against it before any
 * value/approval (see threat T1).
 */
export type ContractOverrides = Readonly<Partial<Record<ContractKey, Address>>>

/** True when the SDK knows this chain at all (has any address table). */
export function isSupportedChain(chainId: number): boolean {
  return chainId in ADDRESS_TABLES
}

/**
 * The resolved address table for a chain, with overrides applied (each override
 * becomes a `live` entry). Throws `UnsupportedChainError` for an unknown chain.
 */
export function getContracts(chainId: number, overrides?: ContractOverrides): ChainContracts {
  const table = ADDRESS_TABLES[chainId]
  if (!table) throw new UnsupportedChainError(chainId)
  const merged: Partial<Record<ContractKey, ContractEntry>> = { ...table }
  if (!overrides) return merged
  for (const [key, address] of Object.entries(overrides) as [ContractKey, Address][]) {
    if (address) merged[key] = live(parseAddress(address, `contracts.${key}`))
  }
  return merged
}

/**
 * True when `key` is usably deployed on `chainId` (status `live`). A `nocode` or
 * `planned` entry, an absent entry, or an unknown chain all return false.
 */
export function hasContract(
  chainId: number,
  key: ContractKey,
  overrides?: ContractOverrides,
): boolean {
  if (overrides?.[key]) {
    parseAddress(overrides[key], `contracts.${key}`)
    return true
  }
  return ADDRESS_TABLES[chainId]?.[key]?.status === 'live'
}

/**
 * Resolve a single contract's `live` entry. Throws `UnsupportedChainError` for an
 * unknown chain and `ContractNotDeployedError` when the contract is absent or not
 * `live`. This is the STATIC guard — the facade
 * additionally runs a runtime `getCode`+identity check before any broadcast.
 */
export function getContract(
  chainId: number,
  key: ContractKey,
  overrides?: ContractOverrides,
): ContractEntry {
  const table = getContracts(chainId, overrides)
  const entry = table[key]
  if (!entry) throw new ContractNotDeployedError(key, chainId)
  if (entry.status !== 'live') throw new ContractNotDeployedError(key, chainId, entry.status)
  return entry
}

/** Convenience: the resolved `live` address for a contract (throws as above). */
export function getAddressFor(
  chainId: number,
  key: ContractKey,
  overrides?: ContractOverrides,
): Address {
  return getContract(chainId, key, overrides).address
}
