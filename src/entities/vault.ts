import type { Address } from 'viem'

import { poolKeysEqual, type V4PoolKey } from '../pool/poolKey'

/**
 * An immutable, resolved NFTX collection vault: the collection, its vToken, and
 * the canonical v4 pool key. A PURE value object — resolution (which needs RPC)
 * lives on `ReadNftxSdk.resolveVault`, never here, so the dependency arrow points
 * down (entities never import the client).
 */
export interface VaultParams {
  chainId: number
  collection: Address
  collectionToken: Address
  poolKey: V4PoolKey
}

export class Vault {
  readonly chainId: number
  readonly collection: Address
  readonly collectionToken: Address
  readonly poolKey: V4PoolKey

  private constructor(params: VaultParams) {
    this.chainId = params.chainId
    this.collection = params.collection
    this.collectionToken = params.collectionToken
    this.poolKey = Object.freeze({ ...params.poolKey })
    Object.freeze(this)
  }

  static create(params: VaultParams): Vault {
    return new Vault(params)
  }

  equals(other: Vault): boolean {
    return (
      this.chainId === other.chainId &&
      this.collection.toLowerCase() === other.collection.toLowerCase() &&
      this.collectionToken.toLowerCase() === other.collectionToken.toLowerCase() &&
      poolKeysEqual(this.poolKey, other.poolKey)
    )
  }
}
