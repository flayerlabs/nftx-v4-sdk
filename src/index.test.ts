import { describe, expect, it } from 'vitest'

import * as sdk from './index'

describe('public package surface', () => {
  it('exposes the package identity', () => {
    expect(sdk.SDK_NAME).toBe('@flayerlabs/nftx-v4-sdk')
  })

  it('keeps the root entry point focused on runtime SDK primitives', () => {
    expect(sdk).toEqual(
      expect.objectContaining({
        createNftxSdk: expect.any(Function),
        ReadNftxSdk: expect.any(Function),
        ReadWriteNftxSdk: expect.any(Function),
        createCallGuard: expect.any(Function),
        getAddressFor: expect.any(Function),
        nftxV4PoolKey: expect.any(Function),
        buyNft: expect.any(Function),
        sellNft: expect.any(Function),
        encodeBatchCalls: expect.any(Function),
        runStagedPlan: expect.any(Function),
      }),
    )
  })
})
