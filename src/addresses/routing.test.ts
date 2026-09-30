import { describe, expect, it } from 'vitest'

import { getAddressFor, getContract } from './resolve'

// Hermetic routing snapshot: nftx-v4-frontend 3c32c6652419b09df817320e794ce268b41d2d9e,
// src/constants/contracts.ts. Other protocol deployments are intentionally independent.
const routers = [
  [1, '0x23617e59A5925b2A4Bf75d73ff6711cD0b29De85', '2.1.2'],
  [8453, '0xd6145b2D3F379919E8CdEda7B97e37c4b2Ca9c40', '2.1.2'],
  [5042, '0x8702463e73f74d0b6765aBceb314Ef07aCb92650', '2.1.2'],
  [4663, '0x204FAca1764B154221e35c0d20aBb3c525710498', '2.1.2'],
  [42161, '0x2d01411773c8C24805306E89A41F7855C3c4Fe65', '2.1.2'],
  [57073, '0x661E93cca42AfacB172121EF892830cA3b70F08d', '2.1.2'],
  [84532, '0x8702463e73f74d0b6765aBceb314Ef07aCb92650', '2.1.2'],
  [11155111, '0x7E4f6c5e954Da5c61B3423D81E2277431Ac043f3', '2.1.2'],
  [46630, '0x8876789976dEcBfCbBbe364623C63652db8C0904', '2.1.1'],
] as const

describe('frontend routing deployment parity', () => {
  it.each(routers)('uses the frontend router and Permit2 on chain %i', (chainId, address, version) => {
    expect(getContract(chainId, 'universalRouter')).toEqual({ address, version, status: 'live' })
    expect(getAddressFor(chainId, 'permit2')).toBe('0x000000000022D473030F116dDEE9F6B43aC78BA3')
  })

  it('keeps Robinhood testnet on its deployed router', () => {
    expect(getAddressFor(46630, 'universalRouter')).not.toBe(getAddressFor(4663, 'universalRouter'))
  })
})
