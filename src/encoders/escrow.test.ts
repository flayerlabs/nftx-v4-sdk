import { describe, expect, it } from 'vitest'
import { zeroAddress } from 'viem'

import { InvalidInputError } from '../errors'
import { withdrawEscrow } from './escrow'

const ctx = { chainId: 1 }
const RECIPIENT = '0x1111111111111111111111111111111111111111'
const TOKEN = '0x2222222222222222222222222222222222222222'

describe('encoders/escrow', () => {
  it('builds the exact three-argument Listings withdrawal step', () => {
    const step = withdrawEscrow(ctx, {
      source: 'listings',
      recipient: RECIPIENT,
      token: TOKEN,
      amount: 123n,
      label: 'Claim Example',
    })

    expect(step).toMatchObject({
      id: 'claim-0x11F09e7eeD242FAd875D3565B3D9CA8AADE445ae-0x2222222222222222222222222222222222222222',
      label: 'Claim Example',
      address: '0x11F09e7eeD242FAd875D3565B3D9CA8AADE445ae',
      functionName: 'withdraw',
      args: [RECIPIENT, TOKEN, 123n],
    })
    expect(step.replaySafe).toBeUndefined()
  })

  it('supports the hook escrow and native ETH sentinel', () => {
    const step = withdrawEscrow(ctx, {
      source: 'nftxV4Hook',
      recipient: RECIPIENT,
      token: zeroAddress,
      amount: 1n,
    })

    expect(step.address).toBe('0xaa49ADaDD33c5E953b645567AFb10CBbba63afC4')
    expect(step.args).toEqual([RECIPIENT, zeroAddress, 1n])
  })

  it('supports partial amounts and caller-supplied identity text', () => {
    const step = withdrawEscrow(ctx, {
      source: 'listings',
      recipient: RECIPIENT,
      token: TOKEN,
      amount: '42',
      id: 'claim-one',
      label: 'Claim one',
    })

    expect(step.id).toBe('claim-one')
    expect(step.label).toBe('Claim one')
    expect(step.args[2]).toBe(42n)
  })

  it('rejects zero amounts and a zero recipient', () => {
    expect(() =>
      withdrawEscrow(ctx, {
        source: 'listings',
        recipient: RECIPIENT,
        token: TOKEN,
        amount: 0n,
      }),
    ).toThrow(InvalidInputError)
    expect(() =>
      withdrawEscrow(ctx, {
        source: 'listings',
        recipient: zeroAddress,
        token: TOKEN,
        amount: 1n,
      }),
    ).toThrow(InvalidInputError)
  })
})
