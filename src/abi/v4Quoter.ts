import type { Abi } from 'viem'

/**
 * Uniswap v4 Quoter ABI. `quoteExactOutputSingle` prices an NFT floor redeem
 * (buying a *whole* collection token out of the pool — used to cap the NFTXZap's
 * `_maxETHSpent`). `quoteExactInputSingle` prices arbitrary-amount ETH↔fToken /
 * NFT-sell legs, returning the pool's true output (price impact + dynamic fee +
 * flETH) which the indexer's marginal floor cannot give.
 *
 * These are the contract's CANONICAL `nonpayable` signatures: on-chain the v4
 * Quoter unlocks the PoolManager and bubbles the result, so it is not a `view`.
 * Read it via `simulateContract(...).result` (an `eth_call` that discards the
 * state change and returns the decoded tuple — verified to the wei on Base
 * Sepolia). We deliberately ship the honest mutability on the public `./abi`
 * surface rather than a `view` lie that would mislead a consumer's codegen.
 */
const QUOTE_EXACT_SINGLE_PARAMS = {
  name: 'params',
  type: 'tuple',
  components: [
    {
      name: 'poolKey',
      type: 'tuple',
      components: [
        { name: 'currency0', type: 'address' },
        { name: 'currency1', type: 'address' },
        { name: 'fee', type: 'uint24' },
        { name: 'tickSpacing', type: 'int24' },
        { name: 'hooks', type: 'address' },
      ],
    },
    { name: 'zeroForOne', type: 'bool' },
    { name: 'exactAmount', type: 'uint128' },
    { name: 'hookData', type: 'bytes' },
  ],
} as const

export const v4QuoterAbi = [
  {
    type: 'function',
    name: 'quoteExactOutputSingle',
    stateMutability: 'nonpayable',
    inputs: [QUOTE_EXACT_SINGLE_PARAMS],
    outputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'nonpayable',
    inputs: [QUOTE_EXACT_SINGLE_PARAMS],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const satisfies Abi
