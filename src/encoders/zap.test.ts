import { describe, expect, it } from 'vitest'
import type { Address } from 'viem'

import { InvalidInputError } from '../errors'
import { MAX_UINT256 } from '../lib/validate'
import {
  buyNft,
  buyTokens,
  redeemFloor,
  sellNft,
  sellTokens,
  type TradeEncoderContext,
} from './zap'

const ctx: TradeEncoderContext = { chainId: 1 }
const COLLECTION = '0x97df1a364c1f1f6bb1f5b6e6f6b6f6b6f6b6aeaa'
const VTOKEN = '0x06c203495b3090f5a8a73ecda79bac54f60e7220'

describe('encoders/zap', () => {
  it('redeemFloor encodes one redeemFloorWithETH with value == maxSpend', () => {
    const step = redeemFloor(ctx, { collection: COLLECTION, tokenIds: [1, 2], maxSpend: 1000n })
    expect(step.functionName).toBe('redeemFloorWithETH')
    expect(step.value).toBe(1000n)
    expect(step.args[2]).toBe(1000n) // _maxETHSpent
    expect(step.args[1]).toEqual([1n, 2n])
  })

  it('buyNft sends the full exact ETH input with owner-safe listing groups', () => {
    const step = buyNft(ctx, { collection: COLLECTION, tokenIds: [7, 8], maxSpend: 500n })
    expect(step.functionName).toBe('buyNFTWithETH')
    expect(step.args[1]).toEqual([[7n], [8n]])
    expect(step.args[2]).toBe(0n)
    expect(step.args[3]).toBe(500n) // _maxETHSpent listing bound
    expect(step.value).toBe(500n) // the whole msg.value is converted
  })

  it('sellNft prepends an ERC721 approval (skipped when already approved)', () => {
    const plan = sellNft(ctx, {
      collection: COLLECTION,
      tokenIds: [1],
      minOut: 900n,
      isApprovedForAll: false,
    })
    expect(plan).toHaveLength(2)
    expect(plan[0]?.functionName).toBe('setApprovalForAll')
    expect(plan[0]?.approvalTarget).toBe('0xDf288b66a77f25197544877eaF4626d7E64cb5A8')
    expect(plan[0]?.replaySafe).toBe(true)
    expect(plan[0]?.skip).toBe(false)
    expect(plan[1]?.functionName).toBe('sellNFTForETH')
    expect(plan[1]?.args[2]).toBe(900n) // minOut

    const approved = sellNft(ctx, {
      collection: COLLECTION,
      tokenIds: [1],
      minOut: 900n,
      isApprovedForAll: true,
    })
    expect(approved[0]?.skip).toBe(true)
  })

  it('buyTokens spends the exact value (never padded)', () => {
    const step = buyTokens(ctx, { collection: COLLECTION, amountInWei: 1234n, minOut: 1000n })
    expect(step.functionName).toBe('buyTokensWithETH')
    expect(step.value).toBe(1234n) // == amountIn, not padded
    expect(step.args[1]).toBe(1000n) // minOut
  })

  it('sellTokens approves the EXACT amount by default, MAX only on opt-in', () => {
    const exact = sellTokens(ctx, {
      collection: COLLECTION,
      vToken: VTOKEN,
      amountInWei: 1234n,
      minOut: 900n,
      vTokenApprovedToZap: false,
    })
    expect(exact[0]?.functionName).toBe('approve')
    expect(exact[0]?.approvalTarget).toBe('0xDf288b66a77f25197544877eaF4626d7E64cb5A8')
    expect(exact[0]?.replaySafe).toBe(true)
    expect(exact[0]?.args[1]).toBe(1234n) // exact-amount approval
    expect(exact[1]?.functionName).toBe('sellTokensForETH')

    const max = sellTokens(ctx, {
      collection: COLLECTION,
      vToken: VTOKEN,
      amountInWei: 1234n,
      minOut: 900n,
      vTokenApprovedToZap: false,
      maxApproval: true,
    })
    expect(max[0]?.args[1]).toBe(MAX_UINT256)
  })

  it('guards bad inputs before producing calldata', () => {
    expect(() => redeemFloor(ctx, { collection: COLLECTION, tokenIds: [1], maxSpend: 0n })).toThrow(
      InvalidInputError,
    )
    expect(() => redeemFloor(ctx, { collection: COLLECTION, tokenIds: [], maxSpend: 1n })).toThrow(
      InvalidInputError,
    )
    expect(() =>
      redeemFloor(ctx, { collection: COLLECTION, tokenIds: [1, 1], maxSpend: 1n }),
    ).toThrow(InvalidInputError)
    expect(() =>
      sellNft(ctx, { collection: COLLECTION, tokenIds: [1], minOut: 0n, isApprovedForAll: true }),
    ).toThrow(InvalidInputError)
    expect(() => buyTokens(ctx, { collection: COLLECTION, amountInWei: 1n, minOut: 0n })).toThrow(
      InvalidInputError,
    )
    expect(() =>
      sellTokens(ctx, {
        collection: COLLECTION,
        vToken: VTOKEN,
        amountInWei: 1n,
        minOut: 0n,
        vTokenApprovedToZap: true,
      }),
    ).toThrow(InvalidInputError)
    expect(() =>
      buyTokens(ctx, { collection: 'nope' as Address, amountInWei: 1n, minOut: 0n }),
    ).toThrow(InvalidInputError)
  })

  it('encodes against the canonical v3 Ethereum mainnet zap', () => {
    const mainnet: TradeEncoderContext = { chainId: 1 }
    const step = redeemFloor(mainnet, {
      collection: COLLECTION,
      tokenIds: [1],
      maxSpend: 1n,
    })
    expect(step.address).toBe('0xDf288b66a77f25197544877eaF4626d7E64cb5A8')
  })
})
