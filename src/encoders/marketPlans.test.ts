import { describe, expect, it } from 'vitest'

import { InvalidInputError } from '../errors'
import {
  buildBuyFromPoolPlan,
  buildDepositForTokenPlan,
  buildListAboveFloorPlan,
  buildMixedBuyPlan,
  buildSellToPoolPlan,
  buildSwapNftsPlan,
  tokenRequirement,
} from './marketPlans'

const ctx = { chainId: 1 }
const COLLECTION = '0xAAaA000000000000000000000000000000000001'
const RECIPIENT = '0x1111111111111111111111111111111111111111'
const OTHER_RECIPIENT = '0x2222222222222222222222222222222222222222'
const COLLECTION_TOKEN = '0xCCCC000000000000000000000000000000000001'
const ZAP = '0xDf288b66a77f25197544877eaF4626d7E64cb5A8'
const LOCKER = '0xb4C5b5235b98114E9DC227b54e088C11680b2385'
const LISTINGS = '0x11F09e7eeD242FAd875D3565B3D9CA8AADE445ae'

describe('encoders/marketPlans', () => {
  it('computes the token requirement for floor, listing, NFT, and token legs', () => {
    expect(
      tokenRequirement({
        floorCount: 1,
        listedItems: [{ floorMultiple: 126 }],
        depositCount: 1,
        tokenContributionWei: 400_000_000_000_000_000n,
      }),
    ).toEqual({
      listedSpendWei: 1_260_000_000_000_000_000n,
      requiredWei: 2_260_000_000_000_000_000n,
      stagedWei: 1_400_000_000_000_000_000n,
      shortfallWei: 860_000_000_000_000_000n,
    })
    expect(() => tokenRequirement({ floorCount: 0 })).toThrow(InvalidInputError)
    expect(() =>
      tokenRequirement({ floorCount: 1, tokenContributionWei: -1n }),
    ).toThrow(InvalidInputError)
  })

  it('builds quoted ETH buys and keeps every listed token in an owner-safe group', () => {
    const floor = buildBuyFromPoolPlan(ctx, {
      collection: COLLECTION,
      tokenIds: [200, 201],
      quotedCostWei: 2_000_000n,
      slippageBps: 50,
    })
    expect(floor).toHaveLength(1)
    expect(floor[0]).toMatchObject({
      address: ZAP,
      functionName: 'redeemFloorWithETH',
      args: [COLLECTION, [200n, 201n], 2_010_000n],
      value: 2_010_000n,
    })

    const listed = buildBuyFromPoolPlan(ctx, {
      collection: COLLECTION,
      tokenIds: [200, 201],
      quotedCostWei: 2_000_000n,
      slippageBps: 50,
      listed: true,
    })
    expect(listed[0]?.args).toEqual([
      COLLECTION,
      [[200n], [201n]],
      0n,
      2_010_000n,
    ])
    expect(listed[0]?.value).toBe(2_010_000n)
  })

  it('builds a slippage-floored sell with a replay-safe zap approval', () => {
    const steps = buildSellToPoolPlan(ctx, {
      collection: COLLECTION,
      tokenIds: [200],
      quotedProceedsWei: 1_000_000n,
      slippageBps: 50,
      isApprovedForAll: false,
    })

    expect(steps.map(({ id }) => id)).toEqual(['approve', 'sell'])
    expect(steps[0]).toMatchObject({
      args: [ZAP, true],
      approvalTarget: ZAP,
      replaySafe: true,
      skip: false,
    })
    expect(steps[1]?.args).toEqual([COLLECTION, [200n], 995_000n])
  })

  it('deposits NFTs through the Locker for a token payout', () => {
    const steps = buildDepositForTokenPlan(ctx, {
      collection: COLLECTION,
      tokenIds: [200, 201],
      recipient: RECIPIENT,
      isApprovedForAll: true,
    })

    expect(steps.map(({ id }) => id)).toEqual(['approve', 'deposit'])
    expect(steps[0]).toMatchObject({
      args: [LOCKER, true],
      approvalTarget: LOCKER,
      replaySafe: true,
      skip: true,
    })
    expect(steps[1]).toMatchObject({
      address: LOCKER,
      functionName: 'deposit',
      args: [COLLECTION, [200n, 201n], RECIPIENT],
    })
  })

  it('uses Locker.swapBatch for a pure one-for-one floor exchange', () => {
    const steps = buildSwapNftsPlan(ctx, {
      account: RECIPIENT,
      collection: COLLECTION,
      tokenIds: [2140, 2141],
      depositTokenIds: [900, 901],
      recipient: RECIPIENT,
      isApprovedForAll: false,
    })

    expect(steps.map(({ id }) => id)).toEqual(['approve', 'swap'])
    expect(steps.every(({ requiredAccount }) => requiredAccount === RECIPIENT)).toBe(true)
    expect(steps[1]).toMatchObject({
      address: LOCKER,
      functionName: 'swapBatch',
      args: [COLLECTION, [900n, 901n], [2140n, 2141n]],
    })
  })

  it('deposits to the signer and redeems to a distinct NFT recipient instead of using swapBatch', () => {
    const steps = buildSwapNftsPlan(ctx, {
      account: RECIPIENT,
      collection: COLLECTION,
      tokenIds: [2140, 2141],
      depositTokenIds: [900, 901],
      collectionToken: COLLECTION_TOKEN,
      recipient: OTHER_RECIPIENT,
      isApprovedForAll: false,
    })

    expect(steps.map(({ id }) => id)).toEqual([
      'approve',
      'deposit',
      'approve-redeem',
      'redeem',
    ])
    expect(steps.every(({ requiredAccount }) => requiredAccount === RECIPIENT)).toBe(true)
    expect(steps[1]?.args).toEqual([COLLECTION, [900n, 901n], RECIPIENT])
    expect(steps[3]?.args).toEqual([COLLECTION, [2140n, 2141n], OTHER_RECIPIENT])
  })

  it('requires a collection token when a distinct recipient makes one-for-one swapBatch unsafe', () => {
    expect(() =>
      buildSwapNftsPlan(ctx, {
        account: RECIPIENT,
        collection: COLLECTION,
        tokenIds: [2140],
        depositTokenIds: [900],
        recipient: OTHER_RECIPIENT,
        isApprovedForAll: false,
      }),
    ).toThrow(/collectionToken is required/)
  })

  it('deposits, approves exact redeem tokens, then redeems an under-covered floor order', () => {
    const steps = buildSwapNftsPlan(ctx, {
      account: RECIPIENT,
      collection: COLLECTION,
      tokenIds: [2140, 2141],
      depositTokenIds: [900],
      collectionToken: COLLECTION_TOKEN,
      recipient: RECIPIENT,
      isApprovedForAll: false,
    })

    expect(steps.map(({ id }) => id)).toEqual([
      'approve',
      'deposit',
      'approve-redeem',
      'redeem',
    ])
    expect(steps[2]).toMatchObject({
      address: COLLECTION_TOKEN,
      args: [LOCKER, 2_000_000_000_000_000_000n],
      approvalTarget: LOCKER,
      replaySafe: true,
    })
    expect(steps[3]?.args).toEqual([COLLECTION, [2140n, 2141n], RECIPIENT])
  })

  it('fills listings in owner-safe groups behind an exact Listings approval', () => {
    const steps = buildSwapNftsPlan(ctx, {
      account: RECIPIENT,
      collection: COLLECTION,
      tokenIds: [],
      listedItems: [
        { tokenId: 2140, floorMultiple: 126 },
        { tokenId: 2142, floorMultiple: 140 },
      ],
      depositTokenIds: [900],
      collectionToken: COLLECTION_TOKEN,
      recipient: RECIPIENT,
      isApprovedForAll: false,
    })
    const spend = 2_660_000_000_000_000_000n

    expect(steps.map(({ id }) => id)).toEqual(['approve', 'deposit', 'approve-token', 'fill'])
    expect(steps.every(({ requiredAccount }) => requiredAccount === RECIPIENT)).toBe(true)
    expect(steps[2]).toMatchObject({
      args: [LISTINGS, spend],
      approvalTarget: LISTINGS,
      replaySafe: true,
    })
    expect(steps[3]?.args).toEqual([
      {
        collection: COLLECTION,
        tokenIdsOut: [[2140n], [2142n]],
        recipient: RECIPIENT,
        maxSpend: spend,
      },
    ])
  })

  it('requires the collection token for every fill or redeem token pull', () => {
    expect(() =>
      buildSwapNftsPlan(ctx, {
        account: RECIPIENT,
        collection: COLLECTION,
        tokenIds: [2140],
        depositTokenIds: [],
        recipient: RECIPIENT,
        isApprovedForAll: true,
      }),
    ).toThrow(InvalidInputError)
  })

  it('inserts an exact-shortfall ETH funding leg before token pulls', () => {
    const steps = buildMixedBuyPlan(ctx, {
      account: RECIPIENT,
      collection: COLLECTION,
      tokenIds: [2140],
      depositTokenIds: [],
      collectionToken: COLLECTION_TOKEN,
      recipient: RECIPIENT,
      isApprovedForAll: true,
      tokenContributionWei: 400_000_000_000_000_000n,
      quotedEthCostWei: 10_000_000_000_000_000n,
      slippageBps: 50,
    })

    expect(steps.map(({ id }) => id)).toEqual(['buy-tokens', 'approve-redeem', 'redeem'])
    expect(steps.every(({ requiredAccount }) => requiredAccount === RECIPIENT)).toBe(true)
    expect(steps[0]).toMatchObject({
      address: ZAP,
      functionName: 'buyTokensWithETH',
      args: [COLLECTION, 600_000_000_000_000_000n],
      value: 10_050_000_000_000_000n,
    })
  })

  it('does not add an ETH leg to an already-covered order', () => {
    expect(() =>
      buildMixedBuyPlan(ctx, {
        account: RECIPIENT,
        collection: COLLECTION,
        tokenIds: [2140],
        depositTokenIds: [900],
        collectionToken: COLLECTION_TOKEN,
        recipient: RECIPIENT,
        isApprovedForAll: false,
        tokenContributionWei: 0n,
        quotedEthCostWei: 1n,
        slippageBps: 50,
      }),
    ).toThrow(InvalidInputError)
  })

  it('creates per-item listings with the supplied owner and timing', () => {
    const steps = buildListAboveFloorPlan(ctx, {
      account: RECIPIENT,
      owner: RECIPIENT,
      collection: COLLECTION,
      items: [
        { tokenId: 200, floorMultiple: 110 },
        { tokenId: 201, floorMultiple: 150 },
      ],
      duration: 604_800,
      created: 1_750_000_000,
      isApprovedForAll: false,
    })

    expect(steps.map(({ id }) => id)).toEqual(['approve', 'list'])
    expect(steps.every(({ requiredAccount }) => requiredAccount === RECIPIENT)).toBe(true)
    expect(steps[0]).toMatchObject({
      args: [LISTINGS, true],
      approvalTarget: LISTINGS,
      replaySafe: true,
    })
    expect(steps[1]?.args[0]).toEqual([
      {
        collection: COLLECTION,
        tokenIds: [200n],
        listing: {
          owner: RECIPIENT,
          created: 1_750_000_000,
          duration: 604_800,
          floorMultiple: 110,
        },
      },
      {
        collection: COLLECTION,
        tokenIds: [201n],
        listing: {
          owner: RECIPIENT,
          created: 1_750_000_000,
          duration: 604_800,
          floorMultiple: 150,
        },
      },
    ])
  })

  it('appends an exact token approval and zap sell for an ETH listing payout', () => {
    const steps = buildListAboveFloorPlan(ctx, {
      account: RECIPIENT,
      owner: RECIPIENT,
      collection: COLLECTION,
      items: [{ tokenId: 200, floorMultiple: 200 }],
      duration: 604_800,
      created: 1_750_000_000,
      isApprovedForAll: true,
      ethPayout: {
        collectionToken: COLLECTION_TOKEN,
        proceedsWei: 960_000_000_000_000_000n,
        minEthOutWei: 15_000_000_000_000_000n,
      },
    })

    expect(steps.map(({ id }) => id)).toEqual(['approve', 'list', 'approve-token', 'swap'])
    expect(steps.every(({ requiredAccount }) => requiredAccount === RECIPIENT)).toBe(true)
    expect(steps[2]).toMatchObject({
      args: [ZAP, 960_000_000_000_000_000n],
      approvalTarget: ZAP,
      replaySafe: true,
    })
    expect(steps[3]?.args).toEqual([
      COLLECTION,
      960_000_000_000_000_000n,
      15_000_000_000_000_000n,
    ])
  })

  it('rejects invalid listing terms and unusable ETH payouts', () => {
    expect(() =>
      buildListAboveFloorPlan(ctx, {
        account: RECIPIENT,
        owner: RECIPIENT,
        collection: COLLECTION,
        items: [{ tokenId: 200, floorMultiple: 100 }],
        duration: 604_800,
        created: 1_750_000_000,
        isApprovedForAll: true,
      }),
    ).toThrow(InvalidInputError)
    expect(() =>
      buildListAboveFloorPlan(ctx, {
        account: RECIPIENT,
        owner: RECIPIENT,
        collection: COLLECTION,
        items: [{ tokenId: 200, floorMultiple: 200 }],
        duration: 604_800,
        created: 1_750_000_000,
        isApprovedForAll: true,
        ethPayout: {
          collectionToken: COLLECTION_TOKEN,
          proceedsWei: 1n,
          minEthOutWei: 0n,
        },
      }),
    ).toThrow(InvalidInputError)
  })

  it('rejects an ETH payout when the listing owner differs from the signing account', () => {
    expect(() =>
      buildListAboveFloorPlan(ctx, {
        account: OTHER_RECIPIENT,
        owner: RECIPIENT,
        collection: COLLECTION,
        items: [{ tokenId: 200, floorMultiple: 200 }],
        duration: 604_800,
        created: 0,
        isApprovedForAll: false,
        ethPayout: {
          collectionToken: COLLECTION_TOKEN,
          proceedsWei: 960_000_000_000_000_000n,
          minEthOutWei: 1n,
        },
      }),
    ).toThrow(/owner must match account/)
  })
})
