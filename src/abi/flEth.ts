import type { Abi } from 'viem'

/**
 * flETH ABI — Flayer's WETH-style wrapper, the native pair token inside every
 * NFTX-v4 collection pool.
 *
 * NOTE: flETH is NOT a WETH9 clone — it has no zero-arg `deposit()`. Its wrap
 * entrypoint is `deposit(uint256 wethAmount)` (payable): native ETH is wrapped
 * via `msg.value`, while `wethAmount` is an optional WETH portion pulled by
 * `transferFrom`. To wrap pure ETH, pass `wethAmount = 0` and send `value`.
 * Verified on-chain on Base mainnet (0x0000…7Cf8) and the Base Sepolia mock —
 * both expose 0xb6b55f25, neither exposes WETH's 0xd0e30db0.
 */
export const flEthAbi = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'payable',
    inputs: [{ name: 'wethAmount', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const satisfies Abi
