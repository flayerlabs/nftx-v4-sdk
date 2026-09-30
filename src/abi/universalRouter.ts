import type { Abi } from 'viem'

// Verified against Uniswap/universal-router contracts/interfaces/IUniversalRouter.sol.
// Only the deadline-bearing entrypoint is supported by the routed swap helpers.
export const universalRouterAbi = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'payable',
    inputs: [
      { name: 'commands', type: 'bytes' },
      { name: 'inputs', type: 'bytes[]' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
  },
] as const satisfies Abi
