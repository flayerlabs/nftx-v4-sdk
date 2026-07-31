import type { Account, Chain, PublicClient, Transport, WalletClient } from 'viem'

import type { ContractOverrides } from '../addresses/resolve'
import { ChainMismatchError, InvalidInputError } from '../errors'
import { ReadNftxSdk } from './read'
import { ReadWriteNftxSdk } from './readWrite'

export interface CreateNftxSdkConfig {
  publicClient: PublicClient
  walletClient?: WalletClient
  /** Override resolved contract addresses for a fork or staging deployment. */
  contracts?: ContractOverrides
}

/**
 * Create the SDK from injected viem clients. With a `walletClient` you get the
 * full `ReadWriteNftxSdk`; with only a `publicClient`, a read-only `ReadNftxSdk`.
 *
 * `chainId` is derived SOLELY from `publicClient.chain` (never a caller param);
 * if a `walletClient` is supplied its chain must match (else `ChainMismatchError`).
 *
 * The overloads are generic over the clients' transport/chain/account so a
 * chain-specialized client (`createPublicClient({ chain })`) binds exactly and
 * avoids viem's block-type generic variance — no consumer cast needed.
 */
export function createNftxSdk<
  transport extends Transport,
  chain extends Chain | undefined,
  account extends Account | undefined,
>(config: {
  publicClient: PublicClient<transport, chain>
  walletClient: WalletClient<transport, chain, account>
  contracts?: ContractOverrides
}): ReadWriteNftxSdk
export function createNftxSdk<transport extends Transport, chain extends Chain | undefined>(config: {
  publicClient: PublicClient<transport, chain>
  contracts?: ContractOverrides
}): ReadNftxSdk
export function createNftxSdk(config: {
  // Loose impl signature — the generic overloads above are the public surface;
  // a specialized client isn't assignable to the base type in invariant position,
  // so the impl accepts `unknown` and narrows once below.
  publicClient: unknown
  walletClient?: unknown
  contracts?: ContractOverrides
}): ReadNftxSdk | ReadWriteNftxSdk {
  const publicClient = config.publicClient as PublicClient
  const walletClient = config.walletClient as WalletClient | undefined
  const chainId = publicClient.chain?.id
  if (chainId === undefined) {
    throw new InvalidInputError('publicClient has no chain — provide a chain-bound client.')
  }
  const overrides = config.contracts ? { contracts: config.contracts } : {}

  if (walletClient) {
    const walletChainId = walletClient.chain?.id
    if (walletChainId !== undefined && walletChainId !== chainId) {
      throw new ChainMismatchError(chainId, walletChainId)
    }
    return new ReadWriteNftxSdk({ chainId, publicClient, walletClient, ...overrides })
  }
  return new ReadNftxSdk({ chainId, publicClient, ...overrides })
}
