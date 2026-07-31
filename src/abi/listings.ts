import type { Abi } from 'viem'

/**
 * Listings ABI — `createListings` powers "list above floor" (Harberger
 * listings); `fillListings` fills above-floor listings by burning collection
 * tokens; `getListingTaxRequired` quotes the prepaid tax deducted from the
 * collection tokens released by a new listing. Signatures are pinned to
 * `IListings.sol` at the NFTX v3.0.0 release.
 */
export const listingsAbi = [
  {
    type: 'function',
    name: 'createListings',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: '_createListings',
        type: 'tuple[]',
        components: [
          { name: 'collection', type: 'address' },
          { name: 'tokenIds', type: 'uint256[]' },
          {
            name: 'listing',
            type: 'tuple',
            components: [
              { name: 'owner', type: 'address' },
              { name: 'created', type: 'uint40' },
              { name: 'duration', type: 'uint32' },
              { name: 'floorMultiple', type: 'uint16' },
            ],
          },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'fillListings',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'collection', type: 'address' },
          { name: 'tokenIdsOut', type: 'uint256[][]' },
          { name: 'recipient', type: 'address' },
          { name: 'maxSpend', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: 'totalBurn_', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getListingTaxRequired',
    // The deployed interface is nonpayable even though callers use eth_call.
    // ReadNftxSdk therefore invokes it through simulateContract.
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: '_listing',
        type: 'tuple',
        components: [
          { name: 'owner', type: 'address' },
          { name: 'created', type: 'uint40' },
          { name: 'duration', type: 'uint32' },
          { name: 'floorMultiple', type: 'uint16' },
        ],
      },
      { name: '_collection', type: 'address' },
    ],
    outputs: [{ name: 'taxRequired_', type: 'uint256' }],
  },
] as const satisfies Abi
