import { describe, expect, it } from 'vitest'

import { InvalidInputError } from '../errors'
import { Percent } from './percent'

describe('entities/Percent', () => {
  it('constructs from bps and percent and is immutable', () => {
    expect(Percent.fromBps(50).toBps()).toBe(50)
    expect(Percent.fromBps(50).toPercent()).toBe(0.5)
    expect(Percent.fromPercent(0.5).toBps()).toBe(50)
    const p = Percent.fromBps(100)
    expect(Object.isFrozen(p)).toBe(true)
  })

  it('rejects out-of-range values', () => {
    expect(() => Percent.fromBps(-1)).toThrow(InvalidInputError)
    expect(() => Percent.fromBps(10_001)).toThrow(InvalidInputError)
    expect(() => Percent.fromBps(1.5)).toThrow(InvalidInputError)
  })
})
