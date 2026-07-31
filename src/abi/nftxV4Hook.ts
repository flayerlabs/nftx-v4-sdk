import type { Abi } from 'viem'

/**
 * NFTXV4Hook ABI — the Uniswap-v4 hook every NFTX collection pool is created
 * with. `getCollectionPoolKey` returns the canonical pool key ABI-ENCODED as
 * `bytes` (`abi.encode(PoolKey)`), NOT a decoded tuple — confirmed against the
 * deployed contract source, NFTXV4Hook.sol:
 *   `function getCollectionPoolKey(address) returns (bytes memory) { return abi.encode(_poolKeys[_collection]); }`
 * Callers decode the returned bytes with `poolKeyAbiParameter` (see
 * ReadNftxSdk.getCanonicalPoolKey). `nativeToken` returns the pool's native
 * pair token (flETH).
 */
export const nftxV4HookAbi = [
  {
    type: 'function',
    name: 'getCollectionPoolKey',
    stateMutability: 'view',
    inputs: [{ name: '_collection', type: 'address' }],
    outputs: [{ name: 'poolKey', type: 'bytes' }],
  },
  {
    type: 'function',
    name: 'nativeToken',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const satisfies Abi
