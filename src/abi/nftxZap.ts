import type { Abi } from 'viem'

/**
 * NFTXZap ABI — the periphery zap that bundles the common compound flows
 * (wrap+swap+redeem, deposit+swap+unwrap) into a single atomic transaction.
 * Every entry takes the ERC721 `_collection` address; the zap resolves the
 * vToken / Uniswap-v4 pool from it internally.
 *
 * Signatures are pinned to `INFTXZap.sol` at the NFTX v3.0.0 release and used
 * by the canonical Ethereum/Base deployments in the address table.
 *
 * `buyNFTWithETH._tokenIdsOut` is a 2-D array (`uint256[][]`) because the
 * underlying `Listings.fillListings` expects a list-of-lists. Every inner group
 * must share a listing owner; singleton groups are the universally safe default.
 */
export const nftxZapAbi = [
  // Buys specific NFTs from an exact msg.value input. Any collection tokens
  // left after filling the listings are returned to the caller; ETH is not.
  {
    type: 'function',
    name: 'buyNFTWithETH',
    stateMutability: 'payable',
    inputs: [
      { name: '_collection', type: 'address' },
      { name: '_tokenIdsOut', type: 'uint256[][]' },
      { name: '_minTokensReceived', type: 'uint256' },
      { name: '_maxETHSpent', type: 'uint256' },
    ],
    outputs: [{ name: 'ethSpent_', type: 'uint256' }],
  },
  // Cheapest buy: redeems the floor (any NFTs from the vault) for the token ids
  // specified, then unwraps to ETH. Refunds ETH dust.
  {
    type: 'function',
    name: 'redeemFloorWithETH',
    stateMutability: 'payable',
    inputs: [
      { name: '_collection', type: 'address' },
      { name: '_tokenIds', type: 'uint256[]' },
      { name: '_maxETHSpent', type: 'uint256' },
    ],
    outputs: [{ name: 'ethSpent_', type: 'uint256' }],
  },
  // Atomic deposit-then-swap-to-ETH. Requires `setApprovalForAll(zap, true)` on
  // the ERC721 first. No ETH attached; returns ETH to the caller.
  {
    type: 'function',
    name: 'sellNFTForETH',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_collection', type: 'address' },
      { name: '_tokenIds', type: 'uint256[]' },
      { name: '_minETHReceived', type: 'uint256' },
    ],
    outputs: [{ name: 'ethReceived_', type: 'uint256' }],
  },
  // Exact-input fToken buy: wraps all attached ETH to flETH, swaps through the
  // pool to the collection token, returns tokens to the caller. The WHOLE
  // `value` is spent (no target/refund); reverts if out < `_minTokensReceived`.
  {
    type: 'function',
    name: 'buyTokensWithETH',
    stateMutability: 'payable',
    inputs: [
      { name: '_collection', type: 'address' },
      { name: '_minTokensReceived', type: 'uint256' },
    ],
    outputs: [{ name: 'tokensReceived_', type: 'uint256' }],
  },
  // Exact-input fToken sell: pulls `_tokenAmount` collection tokens, swaps to
  // flETH, unwraps to ETH and sends it to the caller. Requires
  // `approve(zap, _tokenAmount)` on the collection token first. No ETH attached;
  // reverts if out < `_minETHReceived`.
  {
    type: 'function',
    name: 'sellTokensForETH',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_collection', type: 'address' },
      { name: '_tokenAmount', type: 'uint256' },
      { name: '_minETHReceived', type: 'uint256' },
    ],
    outputs: [{ name: 'ethReceived_', type: 'uint256' }],
  },
] as const satisfies Abi
