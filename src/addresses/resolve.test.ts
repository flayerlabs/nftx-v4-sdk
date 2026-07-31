import { describe, expect, it } from 'vitest'

import { ContractNotDeployedError, InvalidInputError, UnsupportedChainError } from '../errors'
import { ADDRESS_TABLES, type ContractKey } from './tables'
import { getAddressFor, getContract, getContracts, hasContract, isSupportedChain } from './resolve'

describe('addresses: resolution guards', () => {
  it('supports Ethereum mainnet only', () => {
    expect(isSupportedChain(1)).toBe(true)
    expect(isSupportedChain(8453)).toBe(false)
    expect(isSupportedChain(84532)).toBe(false)
    expect(isSupportedChain(999)).toBe(false)
    expect(Object.keys(ADDRESS_TABLES)).toEqual(['1'])
  })

  it('includes the canonical Ethereum mainnet v3.0.0 deployment', () => {
    expect(hasContract(1, 'locker')).toBe(true)
    expect(getAddressFor(1, 'locker')).toBe('0xb4C5b5235b98114E9DC227b54e088C11680b2385')
    expect(getAddressFor(1, 'launchGate')).toBe('0xDB25A2324D2243B9624b620a33C80EfF12EC7A89')
    expect(getAddressFor(1, 'listings')).toBe('0x11F09e7eeD242FAd875D3565B3D9CA8AADE445ae')
    expect(getAddressFor(1, 'collectionShutdown')).toBe(
      '0x28bA2f2A1E38B4547b39675D8E1d96A016e626fF',
    )
    expect(getAddressFor(1, 'taxCalculator')).toBe(
      '0x7592380231c49CA44b6340327D0c4a03C0380459',
    )
    expect(getAddressFor(1, 'nftxV4Hook')).toBe(
      '0xaa49ADaDD33c5E953b645567AFb10CBbba63afC4',
    )
    expect(getAddressFor(1, 'lockerManager')).toBe(
      '0xFadAC7b454971420b90091AB5807Eb8542b77886',
    )
    expect(getAddressFor(1, 'collectionToken')).toBe(
      '0x901124cb73e1E996280f9d763C7EC8bB3D764ba6',
    )
    expect(getAddressFor(1, 'flEth')).toBe('0x000000000bB1f9944965c64066D10038a84F9af2')
    expect(getAddressFor(1, 'linearRangeCurve')).toBe(
      '0x0aBBeFaB8904cd3Cd478d376AD282f796056d95d',
    )
    expect(getAddressFor(1, 'nftxZap')).toBe('0xDf288b66a77f25197544877eaF4626d7E64cb5A8')
    expect(getAddressFor(1, 'notifier')).toBe('0x925e3415E35C0e8a4665691B89c1564b94fEDD1b')
    expect(getAddressFor(1, 'protocolFeeReceiver')).toBe(
      '0x1a18ab9c51CBb1EbB60a6f0D13d594F78a351559',
    )
    expect(getAddressFor(1, 'poolManager')).toBe(
      '0x000000000004444c5dc75cB358380D2e3dE08A90',
    )
    expect(getAddressFor(1, 'positionManager')).toBe(
      '0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e',
    )
    expect(getAddressFor(1, 'universalRouter')).toBe(
      '0x66a9893cc07d91d95644aedd05d03f95e1dba8af',
    )
    expect(hasContract(1, 'quoter')).toBe(true)
  })

  it('applies a contracts override as a live entry', () => {
    const override = '0x0000000000000000000000000000000000001234' as const
    expect(hasContract(1, 'nftxZap', { nftxZap: override })).toBe(true)
    expect(getAddressFor(1, 'nftxZap', { nftxZap: override })).toBe(override)
    expect(getContracts(1, { nftxZap: override }).nftxZap?.status).toBe('live')
  })

  it('validates overrides and does not expose mutable canonical tables', () => {
    expect(() =>
      getAddressFor(1, 'nftxZap', {
        nftxZap: 'not-an-address' as `0x${string}`,
      }),
    ).toThrow(InvalidInputError)

    const contracts = getContracts(1)
    delete (contracts as Record<string, unknown>).nftxZap
    expect(getAddressFor(1, 'nftxZap')).toBe('0xDf288b66a77f25197544877eaF4626d7E64cb5A8')
    expect(Object.isFrozen(ADDRESS_TABLES)).toBe(true)
    expect(Object.isFrozen(ADDRESS_TABLES[1])).toBe(true)
    expect(Object.isFrozen(ADDRESS_TABLES[1]?.nftxZap)).toBe(true)
  })

  it('throws typed errors for unsupported chains and undeployed contracts', () => {
    expect(() => getContracts(8453)).toThrow(UnsupportedChainError)
    expect(() => getContracts(999)).toThrow(UnsupportedChainError)
    const absent = 'notDeployedHere' as ContractKey
    expect(hasContract(1, absent)).toBe(false)
    expect(() => getContract(1, absent)).toThrow(ContractNotDeployedError)
  })
})
