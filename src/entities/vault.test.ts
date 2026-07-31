import { describe, expect, it } from 'vitest'
import type { Address } from 'viem'

import { nftxV4PoolKey } from '../pool/poolKey'
import { Vault } from './vault'

const COLLECTION = '0x97df1a364c1f1f6bb1f5b6e6f6b6f6b6f6b6aeaa' as Address
const VTOKEN = '0x06c203495b3090f5a8a73ecda79bac54f60e7220' as Address
const FLETH = '0x000000000bb1f9944965c64066d10038a84f9af2' as Address
const HOOK = '0xaa49adadd33c5e953b645567afb10cbbba63afc4' as Address

const make = (collection: Address = COLLECTION) =>
  Vault.create({
    chainId: 1,
    collection,
    collectionToken: VTOKEN,
    poolKey: nftxV4PoolKey(VTOKEN, FLETH, HOOK),
  })

describe('entities/Vault', () => {
  it('is frozen, including the pool key', () => {
    const v = make()
    expect(Object.isFrozen(v)).toBe(true)
    expect(Object.isFrozen(v.poolKey)).toBe(true)
  })

  it('compares structurally (case-insensitive), including the pool key', () => {
    expect(make().equals(make())).toBe(true)
    expect(make().equals(make(COLLECTION.toUpperCase() as Address))).toBe(true)
    expect(make().equals(make('0x1111111111111111111111111111111111111111'))).toBe(false)
  })
})
