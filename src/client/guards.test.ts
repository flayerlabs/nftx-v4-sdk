import { describe, expect, it, vi } from 'vitest'
import {
  BaseError,
  ContractFunctionRevertedError,
  type Abi,
  type Address,
  type PublicClient,
  type WalletClient,
} from 'viem'

import {
  AccountMismatchError,
  ChainMismatchError,
  TxRevertedError,
  InvalidInputError,
  OperatorNotContractError,
} from '../errors'
import { getAddressFor } from '../addresses/resolve'
import type { PlanStep } from '../plan/types'
import { createCallGuard } from './guards'

const CHAIN = 1
const ADDRESS = '0x41FF66F1242b664e18a3da25AE135CB303294393' as Address

const step: PlanStep = {
  id: 'buy',
  label: 'Buy NFT',
  address: ADDRESS,
  abi: [] as unknown as Abi,
  functionName: 'redeemFloorWithETH',
  args: [],
}

function guardWithSimulation(simulateContract: () => Promise<unknown>) {
  return createCallGuard({
    chainId: CHAIN,
    publicClient: {
      chain: { id: CHAIN },
      getCode: vi.fn(async () => '0x6000'),
      simulateContract,
    } as unknown as PublicClient,
    walletClient: {
      account: { address: '0x1111111111111111111111111111111111111111' },
      chain: { id: CHAIN },
    } as unknown as WalletClient,
    expectedAccount: '0x1111111111111111111111111111111111111111',
    simulate: true,
  })
}

describe('client/guards', () => {
  it('checks Punk offer operators before simulation, including code and metadata', async () => {
    const simulateContract = vi.fn(async () => ({}))
    const guard = guardWithSimulation(simulateContract)
    const offer = { ...step, functionName: 'offerPunkForSaleToAddress' }
    await expect(guard(offer)).rejects.toBeInstanceOf(InvalidInputError)
    await expect(guard({ ...offer, approvalTarget: ADDRESS })).rejects.toBeInstanceOf(
      OperatorNotContractError,
    )
    expect(simulateContract).not.toHaveBeenCalled()
    await guard({ ...offer, approvalTarget: getAddressFor(CHAIN, 'nftxZap') })
    expect(simulateContract).toHaveBeenCalledOnce()
  })
  it('refuses to inspect or simulate calls with a mismatched public client chain', async () => {
    const getCode = vi.fn(async () => '0x6000')
    const simulateContract = vi.fn()
    const guard = createCallGuard({
      chainId: CHAIN,
      publicClient: {
        chain: { id: 8453 },
        getCode,
        simulateContract,
      } as unknown as PublicClient,
      walletClient: {
        account: { address: '0x1111111111111111111111111111111111111111' },
        chain: { id: CHAIN },
      } as unknown as WalletClient,
      expectedAccount: '0x1111111111111111111111111111111111111111',
      simulate: true,
    })

    await expect(guard(step)).rejects.toBeInstanceOf(ChainMismatchError)
    expect(getCode).not.toHaveBeenCalled()
    expect(simulateContract).not.toHaveBeenCalled()
  })

  it('classifies true simulation reverts as transaction reverts', async () => {
    const guard = guardWithSimulation(async () => {
      throw new BaseError('reverted', {
        cause: new ContractFunctionRevertedError({
          abi: [],
          functionName: 'redeemFloorWithETH',
          message: 'execution reverted',
        }),
      })
    })

    await expect(guard(step)).rejects.toBeInstanceOf(TxRevertedError)
  })

  it('rejects a step built for a different signing account before inspecting the target', async () => {
    const getCode = vi.fn(async () => '0x6000')
    const guard = createCallGuard({
      chainId: CHAIN,
      publicClient: {
        chain: { id: CHAIN },
        getCode,
        simulateContract: vi.fn(),
      } as unknown as PublicClient,
      walletClient: {
        account: { address: '0x1111111111111111111111111111111111111111' },
        chain: { id: CHAIN },
      } as unknown as WalletClient,
      expectedAccount: '0x1111111111111111111111111111111111111111',
      simulate: true,
    })

    await expect(
      guard({
        ...step,
        requiredAccount: '0x2222222222222222222222222222222222222222',
      }),
    ).rejects.toBeInstanceOf(AccountMismatchError)
    expect(getCode).not.toHaveBeenCalled()
  })

  it('keeps simulation transport failures distinct from contract reverts', async () => {
    const guard = guardWithSimulation(async () => {
      throw new BaseError('rpc timeout')
    })

    await expect(guard(step)).rejects.toMatchObject({ code: 'WALLET' })
  })
})
