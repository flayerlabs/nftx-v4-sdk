import type { Abi } from 'viem'

/**
 * Minimal ERC721 ABI — the approval read/write the sell and list flows need.
 * Sell/list require the operator (NFTXZap for sells, Listings for lists) to be
 * approved before it can move the user's NFTs; `isApprovedForAll` lets the plan
 * builder skip a redundant approval step. `ownerOf` supports ownership checks.
 */
export const erc721Abi = [
  {
    type: 'function',
    name: 'isApprovedForAll',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'operator', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'setApprovalForAll',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'approved', type: 'bool' },
    ],
    outputs: [],
  },
] as const satisfies Abi
