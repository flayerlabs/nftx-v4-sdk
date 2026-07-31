// `@flayerlabs/nftx-v4-sdk/addresses` — per-chain address tables + resolution.
export {
  ADDRESS_TABLES,
  type ChainContracts,
  type ChainId,
  type ContractEntry,
  type ContractKey,
  type ContractStatus,
} from './tables'
export {
  type ContractOverrides,
  getAddressFor,
  getContract,
  getContracts,
  hasContract,
  isSupportedChain,
} from './resolve'
