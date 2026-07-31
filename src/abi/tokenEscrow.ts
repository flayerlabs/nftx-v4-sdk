import type { Abi } from 'viem'

/**
 * Shared escrow surface inherited independently by Listings and NFTXV4Hook.
 * Native ETH is represented by the zero-address token sentinel.
 *
 * Signatures are pinned to `ITokenEscrow.sol` at the NFTX v3.0.0 release.
 */
export const tokenEscrowAbi = [
  {
    type: 'function',
    name: 'NATIVE_TOKEN',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'balances',
    stateMutability: 'view',
    inputs: [
      { name: '_recipient', type: 'address' },
      { name: '_token', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_recipient', type: 'address' },
      { name: '_token', type: 'address' },
      { name: '_amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const satisfies Abi
