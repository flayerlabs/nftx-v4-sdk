import { decodeFunctionData, encodeFunctionData, zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'

import { InvalidInputError } from '../errors'
import {
  buildDepositForTokenPlan,
  buildListAboveFloorPlan,
  buildMixedBuyPlan,
  buildSellToPoolPlan,
  buildSwapNftsPlan,
} from './marketPlans'
import {
  authoriseNftsSteps,
  isPunkOfferedToOperator,
  nftStandard,
  punkListingsAtRisk,
  readKittyApprovals,
  readPunkOffers,
  standingSalePriceWei,
  type NftApproval,
  type PunkOffer,
} from './nftApproval'
import { sellNft } from './zap'

const PUNKS = '0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB'
const KITTIES = '0x06012c8cf97BEaD5deAe237070F9587f8E7A266d'
const ERC721 = '0x1111111111111111111111111111111111111111'
const OWNER = '0x2222222222222222222222222222222222222222'
const OPERATOR = '0x3333333333333333333333333333333333333333'
const TOKEN = '0x4444444444444444444444444444444444444444'
const ctx = { chainId: 1 }

describe('NFT approvals', () => {
  it('classifies canonical legacy addresses case-insensitively, without a chain condition', () => {
    expect(nftStandard(PUNKS.toLowerCase())).toBe('punks')
    expect(nftStandard(KITTIES.toUpperCase().replace('0X', '0x'))).toBe('kitties')
    expect(nftStandard(ERC721)).toBe('erc721')
  })

  it('rejects approval kinds that disagree with the on-chain classifier', () => {
    for (const collection of [PUNKS, KITTIES] as const) {
      expect(() =>
        authoriseNftsSteps({
          collection,
          operator: OPERATOR,
          tokenIds: [1],
          approval: { kind: 'erc721', isApprovedForAll: true },
        }),
      ).toThrow(InvalidInputError)
    }
    expect(() =>
      authoriseNftsSteps({
        collection: ERC721,
        operator: OPERATOR,
        tokenIds: [1],
        approval: { kind: 'punks', verdicts: [] },
      }),
    ).toThrow(InvalidInputError)
  })

  it('normalizes ids and only skips a matching, successfully read legacy token', () => {
    const steps = authoriseNftsSteps({
      collection: KITTIES,
      operator: OPERATOR,
      tokenIds: [7, '8', 9n],
      approval: {
        kind: 'kitties',
        verdicts: [
          { tokenId: '07', authorised: true, readFailed: false },
          { tokenId: '8', authorised: true, readFailed: true },
          { tokenId: '10', authorised: true, readFailed: false },
        ],
      },
    })
    expect(steps.map(({ skip }) => skip)).toEqual([true, false, false])
    expect(steps.map(({ args }) => args)).toEqual([
      [OPERATOR, 7n],
      [OPERATOR, 8n],
      [OPERATOR, 9n],
    ])
    expect(() =>
      authoriseNftsSteps({
        collection: PUNKS,
        operator: OPERATOR,
        tokenIds: [7, '07'],
      }),
    ).toThrow(InvalidInputError)
  })

  it('requires all punk pull conditions, including seller and zero price', async () => {
    const offer: PunkOffer = [true, 7n, OWNER, 0n, OPERATOR]
    expect(isPunkOfferedToOperator(offer, OWNER, OPERATOR)).toBe(true)
    expect(isPunkOfferedToOperator([false, 7n, OWNER, 0n, OPERATOR], OWNER, OPERATOR)).toBe(false)
    expect(isPunkOfferedToOperator([true, 7n, ERC721, 0n, OPERATOR], OWNER, OPERATOR)).toBe(false)
    expect(isPunkOfferedToOperator([true, 7n, OWNER, 1n, OPERATOR], OWNER, OPERATOR)).toBe(false)
    expect(isPunkOfferedToOperator([true, 7n, OWNER, 0n, zeroAddress], OWNER, OPERATOR)).toBe(false)
    expect(standingSalePriceWei([true, 7n, OWNER, 5n, zeroAddress], OWNER)).toBe(5n)
    expect(standingSalePriceWei([true, 7n, ERC721, 5n, zeroAddress], OWNER)).toBe(0n)
    const verdicts = await readPunkOffers({
      tokenIds: [7, 8, 9, 10],
      owner: OWNER,
      operator: OPERATOR,
      readOffer: async (id) => {
        if (id === 8n) return [true, id, OWNER, 5n, zeroAddress]
        if (id === 9n) throw new Error('RPC failed')
        if (id === 10n) return offer // incorrect tuple cannot skip token 10
        return offer
      },
    })
    expect(verdicts.map(({ authorised }) => authorised)).toEqual([true, false, false, false])
    expect(verdicts[2]?.readFailed).toBe(true)
    expect(punkListingsAtRisk({ kind: 'punks', verdicts })).toEqual([{ tokenId: 8n, priceWei: 5n }])
  })

  it('reads kitty approvals independently and safely records RPC failures', async () => {
    const verdicts = await readKittyApprovals({
      tokenIds: ['7', 8, 9n],
      operator: OPERATOR,
      readApproved: async (id) => {
        if (id === 9n) throw new Error('RPC failed')
        return id === 7n ? OPERATOR : zeroAddress
      },
    })
    expect(verdicts).toEqual([
      { tokenId: 7n, authorised: true, readFailed: false },
      { tokenId: 8n, authorised: false, readFailed: false },
      { tokenId: 9n, authorised: false, readFailed: true },
    ])
  })

  it('encodes zero-price punk offers and per-kitty approve calldata with guard metadata', () => {
    for (const collection of [PUNKS, KITTIES] as const) {
      const [step] = authoriseNftsSteps({
        collection,
        operator: OPERATOR,
        tokenIds: [7],
        isApprovedForAll: true,
      })
      expect(step).toBeDefined()
      const data = encodeFunctionData({
        abi: step!.abi,
        functionName: step!.functionName,
        args: step!.args,
      })
      expect(decodeFunctionData({ abi: step!.abi, data })).toEqual({
        functionName: collection === PUNKS ? 'offerPunkForSaleToAddress' : 'approve',
        args: collection === PUNKS ? [7n, 0n, OPERATOR] : [OPERATOR, 7n],
      })
      expect(step).toMatchObject({ approvalTarget: OPERATOR, replaySafe: true, skip: false })
    }
  })

  it.each([PUNKS, KITTIES] as const)(
    'uses legacy approval in every NFT-pull builder for %s',
    (collection) => {
      const expected = collection === PUNKS ? 'offerPunkForSaleToAddress' : 'approve'
      const plans = [
        sellNft(ctx, { collection, tokenIds: [7], minOut: 1n, isApprovedForAll: true }),
        buildSellToPoolPlan(ctx, {
          collection,
          tokenIds: [7],
          quotedProceedsWei: 10n,
          slippageBps: 0,
          isApprovedForAll: true,
        }),
        buildDepositForTokenPlan(ctx, {
          collection,
          tokenIds: [7],
          recipient: OWNER,
          isApprovedForAll: true,
        }),
        buildSwapNftsPlan(ctx, {
          account: OWNER,
          collection,
          tokenIds: [8],
          depositTokenIds: [7],
          recipient: OWNER,
          isApprovedForAll: true,
        }),
        buildSwapNftsPlan(ctx, {
          account: OWNER,
          collection,
          tokenIds: [8, 9],
          depositTokenIds: [7],
          collectionToken: TOKEN,
          recipient: OWNER,
          isApprovedForAll: true,
        }),
        buildMixedBuyPlan(ctx, {
          account: OWNER,
          collection,
          tokenIds: [8, 9],
          depositTokenIds: [7],
          collectionToken: TOKEN,
          recipient: OWNER,
          isApprovedForAll: true,
          tokenContributionWei: 0n,
          quotedEthCostWei: 10n,
          slippageBps: 0,
        }),
        buildListAboveFloorPlan(ctx, {
          account: OWNER,
          owner: OWNER,
          collection,
          items: [{ tokenId: 7, floorMultiple: 110 }],
          duration: 604_800,
          created: 1_750_000_000,
          isApprovedForAll: true,
        }),
      ]
      for (const plan of plans) {
        expect(plan[0]).toMatchObject({ functionName: expected, skip: false })
        expect(plan.some(({ functionName }) => functionName === 'setApprovalForAll')).toBe(false)
      }
      for (const plan of plans.slice(3)) {
        expect(plan.every(({ requiredAccount }) => requiredAccount === OWNER)).toBe(true)
      }
    },
  )

  it('accepts the approval union in swap plans and leaves token-only routes without NFT approvals', () => {
    const approval: NftApproval = {
      kind: 'punks',
      verdicts: [{ tokenId: '7', authorised: true, readFailed: false, standingSalePriceWei: 0n }],
    }
    const swap = buildSwapNftsPlan(ctx, {
      account: OWNER,
      collection: PUNKS,
      tokenIds: [8],
      depositTokenIds: [7],
      recipient: OWNER,
      approval,
    })
    expect(swap[0]?.skip).toBe(true)
    const tokenOnly = buildSwapNftsPlan(ctx, {
      account: OWNER,
      collection: PUNKS,
      tokenIds: [8],
      depositTokenIds: [],
      recipient: OWNER,
      collectionToken: TOKEN,
    })
    expect(tokenOnly.map(({ functionName }) => functionName)).toEqual(['approve', 'redeem'])
  })
})
