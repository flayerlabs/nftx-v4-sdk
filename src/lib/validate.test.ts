import { describe, expect, it } from 'vitest'
import { getAddress } from 'viem'

import { InvalidInputError } from '../errors'
import { MAX_UINT256, parseAddress, parsePositiveAmount, parseTokenId, parseTokenIds } from './validate'

const LOWER = '0x97df1a364c1f1f6bb1f5b6e6f6b6f6b6f6b6aeaa'

describe('lib/validate', () => {
  it('checksums a valid address and rejects zero / malformed', () => {
    // Matches viem's canonical EIP-55 checksum, and is not the raw lowercase input.
    expect(parseAddress(LOWER)).toBe(getAddress(LOWER))
    expect(parseAddress(LOWER)).not.toBe(LOWER)
    expect(() => parseAddress('0x0000000000000000000000000000000000000000')).toThrow(
      InvalidInputError,
    )
    expect(() => parseAddress('not-an-address')).toThrow(InvalidInputError)
    expect(() => parseAddress('0x1234')).toThrow(InvalidInputError)
  })

  it('validates token ids in [0, 2^256)', () => {
    expect(parseTokenId(0)).toBe(0n)
    expect(parseTokenId('42')).toBe(42n)
    expect(parseTokenId(MAX_UINT256)).toBe(MAX_UINT256)
    expect(() => parseTokenId(-1)).toThrow(InvalidInputError)
    expect(() => parseTokenId(MAX_UINT256 + 1n)).toThrow(InvalidInputError)
    expect(() => parseTokenId(1.5)).toThrow(InvalidInputError)
  })

  it('validates token-id lists: empty, duplicates, over-length', () => {
    expect(parseTokenIds([1, 2, 3])).toEqual([1n, 2n, 3n])
    expect(() => parseTokenIds([])).toThrow(InvalidInputError)
    expect(() => parseTokenIds([1, 1])).toThrow(InvalidInputError)
    expect(() => parseTokenIds([1, 1], { allowDuplicates: true })).not.toThrow()
    expect(() => parseTokenIds([1, 2, 3], { maxLength: 2 })).toThrow(InvalidInputError)
  })

  it('requires a strictly-positive amount', () => {
    expect(parsePositiveAmount('100')).toBe(100n)
    expect(() => parsePositiveAmount(0)).toThrow(InvalidInputError)
    expect(() => parsePositiveAmount(-5)).toThrow(InvalidInputError)
  })
})
