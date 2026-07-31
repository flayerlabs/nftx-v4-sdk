import { describe, expect, it } from 'vitest'

import { erc721Abi } from '../abi/erc721'
import { nftxZapAbi } from '../abi/nftxZap'
import type { PlanStep } from '../plan/types'
import { encodedCallValueToBigInt as rootEncodedCallValueToBigInt } from '../index'
import {
  encodeBatchCalls,
  encodedCallValueToBigInt,
  executableSteps,
  planStepToCall,
} from './encodeCalls'

const ZAP = '0x41ff66f1242b664e18a3da25ae135cb303294393'
const COLLECTION = '0x97df1a364c1f1f6bb1f5b6e6f6b6f6b6f6b6aeaa'

const approve: PlanStep = {
  id: 'approve',
  label: 'Approve NFTs',
  address: COLLECTION,
  abi: erc721Abi,
  functionName: 'setApprovalForAll',
  args: [ZAP, true],
  approvalTarget: ZAP,
  skip: true,
}
const buy: PlanStep = {
  id: 'buy',
  label: 'Buy',
  address: ZAP,
  abi: nftxZapAbi,
  functionName: 'redeemFloorWithETH',
  args: [COLLECTION, [1n], 1000n],
  value: 1000n,
}

describe('execution/encodeCalls', () => {
  it('projects a step to JSON-safe { to, data, value } (value defaults to 0x0)', () => {
    const call = planStepToCall(approve)
    expect(call.to).toBe(COLLECTION)
    expect(call.value).toBe('0x0')
    expect(call.data.startsWith('0x')).toBe(true)
    expect(planStepToCall(buy).value).toBe('0x3e8')
    expect(JSON.parse(JSON.stringify(planStepToCall(buy))).value).toBe('0x3e8')
    expect(encodedCallValueToBigInt(planStepToCall(buy))).toBe(1000n)
    expect(rootEncodedCallValueToBigInt(planStepToCall(buy))).toBe(1000n)
  })

  it('filters skipped steps and encodes the rest in order', () => {
    expect(executableSteps([approve, buy])).toEqual([buy])
    const calls = encodeBatchCalls([approve, buy])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.to).toBe(ZAP)
  })

  it('refuses duplicate plan ids because recovery state would be ambiguous', () => {
    expect(() => encodeBatchCalls([buy, { ...buy, label: 'Second buy' }])).toThrow(
      'Plan step ids must be unique',
    )
  })
})
