import { describe, expect, it } from 'vitest'
import { encodeFunctionData } from 'viem'

import { buyNft, buyTokens, redeemFloor, sellNft, sellTokens } from '../../src/encoders/zap'
import type { PlanStep } from '../../src/plan/types'

/**
 * App-independent golden snapshots of the encoded trade calldata. These pin the
 * exact bytes each encoder emits so any change to an ABI, arg order, or encoder
 * is a loud, reviewable diff — a tamper tripwire that outlives the app's builders
 * (unlike the cross-package parity check). Inline snapshots are filled on first
 * run, then locked.
 */
const ctx = { chainId: 1 } as const
const COLLECTION = '0x97df1a364c1f1f6bb1f5b6e6f6b6f6b6f6b6aeaa'
const VTOKEN = '0x06c203495b3090f5a8a73ecda79bac54f60e7220'

function calldata(step: PlanStep): string {
  return encodeFunctionData({
    abi: step.abi,
    functionName: step.functionName,
    args: step.args,
  } as Parameters<typeof encodeFunctionData>[0])
}

describe('golden: trade calldata', () => {
  it('redeemFloorWithETH', () => {
    const step = redeemFloor(ctx, { collection: COLLECTION, tokenIds: [1n, 2n], maxSpend: 1000n })
    expect(calldata(step)).toMatchInlineSnapshot(`"0x3fafebf800000000000000000000000097df1a364c1f1f6bb1f5b6e6f6b6f6b6f6b6aeaa000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000003e8000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002"`)
    expect(step.value).toBe(1000n)
  })

  it('buyNFTWithETH', () => {
    const step = buyNft(ctx, { collection: COLLECTION, tokenIds: [7n, 8n], maxSpend: 500n })
    expect(calldata(step)).toMatchInlineSnapshot(`"0x7f81947c00000000000000000000000097df1a364c1f1f6bb1f5b6e6f6b6f6b6f6b6aeaa0000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001f40000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000700000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000008"`)
    expect(step.value).toBe(500n)
  })

  it('sellNFTForETH (action step)', () => {
    const plan = sellNft(ctx, {
      collection: COLLECTION,
      tokenIds: [1n],
      minOut: 900n,
      isApprovedForAll: true,
    })
    expect(calldata(plan[1] as PlanStep)).toMatchInlineSnapshot(`"0xddf2ff4e00000000000000000000000097df1a364c1f1f6bb1f5b6e6f6b6f6b6f6b6aeaa0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000038400000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000001"`)
  })

  it('buyTokensWithETH', () => {
    const step = buyTokens(ctx, { collection: COLLECTION, amountInWei: 1234n, minOut: 1000n })
    expect(calldata(step)).toMatchInlineSnapshot(`"0xa7e0c16300000000000000000000000097df1a364c1f1f6bb1f5b6e6f6b6f6b6f6b6aeaa00000000000000000000000000000000000000000000000000000000000003e8"`)
    expect(step.value).toBe(1234n)
  })

  it('sellTokensForETH + exact approval', () => {
    const plan = sellTokens(ctx, {
      collection: COLLECTION,
      vToken: VTOKEN,
      amountInWei: 1234n,
      minOut: 900n,
      vTokenApprovedToZap: false,
    })
    expect(calldata(plan[0] as PlanStep)).toMatchInlineSnapshot(`"0x095ea7b3000000000000000000000000df288b66a77f25197544877eaf4626d7e64cb5a800000000000000000000000000000000000000000000000000000000000004d2"`) // approve(zap, 1234)
    expect(calldata(plan[1] as PlanStep)).toMatchInlineSnapshot(`"0x02d0d9ea00000000000000000000000097df1a364c1f1f6bb1f5b6e6f6b6f6b6f6b6aeaa00000000000000000000000000000000000000000000000000000000000004d20000000000000000000000000000000000000000000000000000000000000384"`) // sellTokensForETH
  })
})
