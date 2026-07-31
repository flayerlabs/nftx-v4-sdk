import type { Address } from 'viem'

/**
 * Capability-aware per-chain address tables.
 *
 * Each entry is a typed record `{ address, status, version? }` — not a bare
 * `Address` — so resolution can refuse a contract that is absent or has no code
 * with a typed error instead of returning a zero address. `status`:
 *   - `live`   — deployed and usable
 *   - `nocode` — the address has NO deployed code (a value/approval CALL would
 *                silently burn funds — the facade `getCode`+identity guard refuses it)
 *   - `planned`— reserved for a future deployment
 *
 * The SDK ships Ethereum mainnet only, pinned to release v3.0.0. Its addresses
 * are verified against the live deployment (not the `flayerlabs/flayer`
 * deployment book, which still records a superseded mainnet Locker). Uniswap and
 * Permit2 addresses are their canonical per-chain deployments.
 *
 * Base returns as an additional entry in {@link ADDRESS_TABLES} once its new
 * contracts are deployed — the per-chain shape is kept for exactly that.
 */
export type ChainId = number

export type ContractStatus = 'live' | 'nocode' | 'planned'

export interface ContractEntry {
  readonly address: Address
  readonly status: ContractStatus
  /** Optional deployment version tag, for a future redeploy with changed signatures. */
  readonly version?: string
}

export type ContractKey =
  // NFTX v4
  | 'locker'
  | 'launchGate'
  | 'listings'
  | 'collectionShutdown'
  | 'taxCalculator'
  | 'nftxV4Hook'
  | 'lockerManager'
  | 'flEth'
  | 'collectionToken'
  | 'linearRangeCurve'
  | 'notifier'
  | 'protocolFeeReceiver'
  | 'nftxZap'
  // Uniswap v4
  | 'poolManager'
  | 'positionManager'
  | 'quoter'
  | 'universalRouter'
  | 'permit2'

export type ChainContracts = Readonly<Partial<Record<ContractKey, ContractEntry>>>

const PERMIT2: Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3'

export const live = (address: Address, version?: string): ContractEntry =>
  Object.freeze({
    address,
    status: 'live' as const,
    ...(version ? { version } : {}),
  })

function freezeTables(tables: Record<ChainId, ChainContracts>): Readonly<Record<ChainId, ChainContracts>> {
  for (const contracts of Object.values(tables)) Object.freeze(contracts)
  return Object.freeze(tables)
}

export const ADDRESS_TABLES: Readonly<Record<ChainId, ChainContracts>> = freezeTables({
  // Ethereum mainnet (1) — NFTX v3.0.0 (`nftx.v3` CREATE3 namespace).
  1: {
    locker: live('0xb4C5b5235b98114E9DC227b54e088C11680b2385', '3.0.0'),
    launchGate: live('0xDB25A2324D2243B9624b620a33C80EfF12EC7A89', '3.0.0'),
    listings: live('0x11F09e7eeD242FAd875D3565B3D9CA8AADE445ae', '3.0.0'),
    collectionShutdown: live('0x28bA2f2A1E38B4547b39675D8E1d96A016e626fF', '3.0.0'),
    taxCalculator: live('0x7592380231c49CA44b6340327D0c4a03C0380459', '3.0.0'),
    nftxV4Hook: live('0xaa49ADaDD33c5E953b645567AFb10CBbba63afC4', '3.0.0'),
    lockerManager: live('0xFadAC7b454971420b90091AB5807Eb8542b77886', '3.0.0'),
    flEth: live('0x000000000bB1f9944965c64066D10038a84F9af2', '3.0.0'),
    collectionToken: live('0x901124cb73e1E996280f9d763C7EC8bB3D764ba6', '3.0.0'),
    linearRangeCurve: live('0x0aBBeFaB8904cd3Cd478d376AD282f796056d95d', '3.0.0'),
    notifier: live('0x925e3415E35C0e8a4665691B89c1564b94fEDD1b', '3.0.0'),
    protocolFeeReceiver: live('0x1a18ab9c51CBb1EbB60a6f0D13d594F78a351559', '3.0.0'),
    nftxZap: live('0xDf288b66a77f25197544877eaF4626d7E64cb5A8', '3.0.0'),
    poolManager: live('0x000000000004444c5dc75cB358380D2e3dE08A90'),
    positionManager: live('0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e'),
    quoter: live('0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203'),
    universalRouter: live('0x66a9893cc07d91d95644aedd05d03f95e1dba8af'),
    permit2: live(PERMIT2),
  },
})
