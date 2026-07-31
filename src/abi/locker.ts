import type { Abi } from 'viem'

/**
 * Locker ABI — the vault entry points. `collectionToken` resolves a collection
 * to its ERC20 vToken (the v4 pool currency; returns the zero address when the
 * collection is not yet initialized, which the SDK uses to derive
 * `collectionInitialized`). `deposit`/`redeem` mint/burn vTokens against NFTs
 * (1 NFT ↔ 1e18 CT) for direct paths; most trade flows go through NFTXZap.
 *
 * Signatures are pinned to `ILocker.sol` at the NFTX v3.0.0 release.
 */
export const lockerAbi = [
  {
    type: 'function',
    name: 'collectionToken',
    stateMutability: 'view',
    inputs: [{ name: '_collection', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_collection', type: 'address' },
      { name: '_tokenIds', type: 'uint256[]' },
      { name: '_recipient', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'redeem',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_collection', type: 'address' },
      { name: '_tokenIds', type: 'uint256[]' },
      { name: '_recipient', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'swapBatch',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_collection', type: 'address' },
      { name: '_tokenIdsIn', type: 'uint256[]' },
      { name: '_tokenIdsOut', type: 'uint256[]' },
    ],
    outputs: [],
  },
] as const satisfies Abi
