import type { Abi } from 'viem'

/** KittyCore uses draft ERC721 per-token approvals, without blanket approvals. */
export const cryptoKittiesAbi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_to', type: 'address' },
      { name: '_tokenId', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'kittyIndexToApproved',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const satisfies Abi
