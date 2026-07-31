import { describe, expect, it } from 'vitest'
import { type Abi, encodeFunctionData } from 'viem'

import { collectionTokenAbi } from './collectionToken'
import { erc721Abi } from './erc721'
import { flEthAbi } from './flEth'
import { listingsAbi } from './listings'
import { lockerAbi } from './locker'
import { nftxV4HookAbi } from './nftxV4Hook'
import { nftxZapAbi } from './nftxZap'
import { tokenEscrowAbi } from './tokenEscrow'
import { v4QuoterAbi } from './v4Quoter'

// All-lowercase fixtures — valid addresses with no EIP-55 checksum to satisfy.
const COLLECTION = '0x97df1a364c1f1f6bb1f5b6e6f6b6f6b6f6b6aeaa'
const OPERATOR = '0x41ff66f1242b664e18a3da25ae135cb303294393'
const ACCOUNT = '0x1111111111111111111111111111111111111111'

const isHexCalldata = (data: string) => /^0x[0-9a-f]{8,}$/i.test(data)

describe('abi: as-const ABIs encode', () => {
  it('encodes every NFTXZap trade entrypoint', () => {
    const calls = [
      { functionName: 'redeemFloorWithETH', args: [COLLECTION, [1n, 2n], 1000n] },
      { functionName: 'buyNFTWithETH', args: [COLLECTION, [[1n]], 0n, 1000n] },
      { functionName: 'sellNFTForETH', args: [COLLECTION, [1n], 900n] },
      { functionName: 'buyTokensWithETH', args: [COLLECTION, 900n] },
      { functionName: 'sellTokensForETH', args: [COLLECTION, 10n ** 18n, 900n] },
    ] as const
    for (const call of calls) {
      const data = encodeFunctionData({
        abi: nftxZapAbi,
        functionName: call.functionName,
        args: call.args as never,
      })
      expect(isHexCalldata(data)).toBe(true)
    }
  })

  it('encodes the v4 Quoter exact-single calls', () => {
    const params = {
      poolKey: {
        currency0: COLLECTION,
        currency1: OPERATOR,
        fee: 0x800000,
        tickSpacing: 60,
        hooks: ACCOUNT,
      },
      zeroForOne: true,
      exactAmount: 10n ** 18n,
      hookData: '0x',
    } as const
    for (const functionName of ['quoteExactOutputSingle', 'quoteExactInputSingle'] as const) {
      const data = encodeFunctionData({ abi: v4QuoterAbi, functionName, args: [params] as never })
      expect(isHexCalldata(data)).toBe(true)
    }
  })

  it('encodes locker / listings / hook / token / erc721 surfaces', () => {
    expect(
      isHexCalldata(
        encodeFunctionData({ abi: lockerAbi, functionName: 'collectionToken', args: [COLLECTION] }),
      ),
    ).toBe(true)
    expect(
      isHexCalldata(
        encodeFunctionData({
          abi: lockerAbi,
          functionName: 'swapBatch',
          args: [COLLECTION, [1n], [2n]],
        }),
      ),
    ).toBe(true)
    expect(
      isHexCalldata(
        encodeFunctionData({
          abi: nftxV4HookAbi,
          functionName: 'getCollectionPoolKey',
          args: [COLLECTION],
        }),
      ),
    ).toBe(true)
    expect(
      isHexCalldata(
        encodeFunctionData({
          abi: erc721Abi,
          functionName: 'setApprovalForAll',
          args: [OPERATOR, true],
        }),
      ),
    ).toBe(true)
    expect(
      isHexCalldata(
        encodeFunctionData({
          abi: collectionTokenAbi,
          functionName: 'approve',
          args: [OPERATOR, 10n ** 18n],
        }),
      ),
    ).toBe(true)
    expect(
      isHexCalldata(encodeFunctionData({ abi: flEthAbi, functionName: 'deposit', args: [0n] })),
    ).toBe(true)
    expect(
      isHexCalldata(
        encodeFunctionData({
          abi: listingsAbi,
          functionName: 'createListings',
          args: [
            [
              {
                collection: COLLECTION,
                tokenIds: [1n],
                listing: { owner: ACCOUNT, created: 1, duration: 604_800, floorMultiple: 110 },
              },
            ],
          ],
        }),
      ),
    ).toBe(true)
    expect(
      isHexCalldata(
        encodeFunctionData({
          abi: listingsAbi,
          functionName: 'getListingTaxRequired',
          args: [
            { owner: ACCOUNT, created: 0, duration: 604_800, floorMultiple: 150 },
            COLLECTION,
          ],
        }),
      ),
    ).toBe(true)
    const withdraw = encodeFunctionData({
      abi: tokenEscrowAbi,
      functionName: 'withdraw',
      args: [ACCOUNT, COLLECTION, 123n],
    })
    expect(withdraw.slice(0, 10)).toBe('0xd9caed12')
  })

  it('exposes ABIs that structurally satisfy viem Abi', () => {
    const all: Abi[] = [
      nftxZapAbi,
      v4QuoterAbi,
      lockerAbi,
      listingsAbi,
      collectionTokenAbi,
      flEthAbi,
      erc721Abi,
      nftxV4HookAbi,
      tokenEscrowAbi,
    ]
    for (const abi of all) expect(abi.length).toBeGreaterThan(0)
  })
})
