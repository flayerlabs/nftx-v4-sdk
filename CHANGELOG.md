# @flayerlabs/nftx-v4-sdk

## 0.2.0

### Minor Changes

- Add frontend trading parity across Base, Robinhood Chain, Ink, Arbitrum One,
  Arc and testnets, including Arc's native/pool currency conversions.

  Add CryptoPunks and CryptoKitties authorization ABIs and builders, exact-output
  token quotes, slippage gross-up and lightweight Uniswap-routed swap helpers
  with an explicit trusted quote/calldata provider boundary and exact Permit2
  authorization. Existing direct swaps and write-only plan execution remain supported.

  Extend the Locker ABI with its canonical collectionInitialized read and use it
  to distinguish registered collections from initialized pools. Correct Base
  Sepolia's native-token address using live hook wiring. ABI signatures were
  verified against protocol and Uniswap sources, and the hash manifest is updated.

## 0.1.0

Initial release.

Strict TypeScript SDK for NFTX v4 on Ethereum. Provides canonical deployment
addresses, focused contract ABIs, pool-key derivation, quotes, slippage math,
pure transaction plans, guarded calldata encoders, and viem-backed read and
write execution behind an ESM-only package.
