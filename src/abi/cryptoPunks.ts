import type { Abi } from 'viem'

/** Minimal CryptoPunksMarket approval surface, matching ICryptoPunksMarket. */
export const cryptoPunksAbi = [
  {
    type: 'function',
    name: 'punksOfferedForSale',
    stateMutability: 'view',
    inputs: [{ name: 'punkIndex', type: 'uint256' }],
    outputs: [
      { name: 'isForSale', type: 'bool' },
      { name: 'punkIndex', type: 'uint256' },
      { name: 'seller', type: 'address' },
      { name: 'minValue', type: 'uint256' },
      { name: 'onlySellTo', type: 'address' },
    ],
  },
  {
    type: 'function',
    name: 'offerPunkForSaleToAddress',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'punkIndex', type: 'uint256' },
      { name: 'minSalePriceInWei', type: 'uint256' },
      { name: 'toAddress', type: 'address' },
    ],
    outputs: [],
  },
] as const satisfies Abi
