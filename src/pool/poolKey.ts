import type { Address } from 'viem'

import { NFTX_V4_DYNAMIC_FEE, NFTX_V4_TICK_SPACING } from '../constants/pool'

/**
 * Uniswap-v4 pool-key derivation for an NFTX collection pool: its vToken paired
 * with flETH, with the dynamic-fee flag + tick spacing + hook. Currencies are
 * ordered by ascending address (the v4 convention).
 *
 * Pool params are PER-DEPLOYMENT defaults — for a value-bearing path the
 * canonical key is read on-chain via `NFTXV4Hook.getCollectionPoolKey` and this
 * local derivation is only a cross-checked fast path (see ReadNftxSdk.resolveVault).
 */
export interface V4PoolKey {
  currency0: Address
  currency1: Address
  fee: number
  tickSpacing: number
  hooks: Address
}

/**
 * viem ABI parameter for a Uniswap-v4 `PoolKey` tuple. `NFTXV4Hook.getCollectionPoolKey`
 * returns `abi.encode(PoolKey)` as `bytes` (confirmed against NFTXV4Hook.sol:
 * `getCollectionPoolKey(address) returns (bytes memory)`), so callers encode/decode
 * the returned bytes with this parameter.
 */
export const poolKeyAbiParameter = {
  type: 'tuple',
  components: [
    { name: 'currency0', type: 'address' },
    { name: 'currency1', type: 'address' },
    { name: 'fee', type: 'uint24' },
    { name: 'tickSpacing', type: 'int24' },
    { name: 'hooks', type: 'address' },
  ],
} as const

/** Uniswap v4 orders a pool's currencies by ascending address. */
export function sortCurrencies(a: Address, b: Address): [Address, Address] {
  return a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a]
}

export interface PoolKeyParams {
  fee?: number
  tickSpacing?: number
}

/** The v4 pool key for an NFTX collection: its vToken paired with flETH. */
export function nftxV4PoolKey(
  vToken: Address,
  flEth: Address,
  hooks: Address,
  { fee = NFTX_V4_DYNAMIC_FEE, tickSpacing = NFTX_V4_TICK_SPACING }: PoolKeyParams = {},
): V4PoolKey {
  const [currency0, currency1] = sortCurrencies(vToken, flEth)
  return { currency0, currency1, fee, tickSpacing, hooks }
}

const sameAddress = (a: Address, b: Address) => a.toLowerCase() === b.toLowerCase()

/** Structural equality of two pool keys (addresses compared case-insensitively). */
export function poolKeysEqual(a: V4PoolKey, b: V4PoolKey): boolean {
  return (
    sameAddress(a.currency0, b.currency0) &&
    sameAddress(a.currency1, b.currency1) &&
    a.fee === b.fee &&
    a.tickSpacing === b.tickSpacing &&
    sameAddress(a.hooks, b.hooks)
  )
}

/**
 * `zeroForOne` for a swap whose INPUT currency is `input`: true when `input` is
 * the pool's `currency0`. (A floor buy inputs flETH; a token/NFT sell inputs the
 * vToken.)
 */
export function isInputCurrency0(poolKey: V4PoolKey, input: Address): boolean {
  return sameAddress(poolKey.currency0, input)
}
