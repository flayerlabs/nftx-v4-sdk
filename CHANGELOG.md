# @flayerlabs/nftx-v4-sdk

## 0.3.0

### Minor Changes

- Align Universal Router addresses with the frontend's 2.1.2 deployments. Robinhood
  testnet retains its deployed 2.1.1 router because its mainnet 2.1.2 address has no
  code there.

  Add explicit `RoutedSwapIntent.permitAmount: 'FULL'` support for frontend parity:
  accept sufficient Permit2 authorizations and preserve upstream ERC20 approval
  amounts, including unlimited approvals. The default remains `EXACT`, which caps
  both authorizations to the swap input. Full authorizations can remain usable after
  the swap and should be shown to the user before signing.

  Allow `resolveRoutedSwap({ approvalsPending: true })` to skip provider simulation
  when approvals and the swap will execute in the same atomic batch. Sequential
  callers should resolve after successful approval receipts and retain default
  simulation. Document signing before approvals and both existing executor paths.

  Provider implementations must handle `permitAmount: 'EXACT' | 'FULL'` and boolean
  `simulateTransaction` requests; integrations relying on the previous literal types
  may need adjustment. Router command economics and the supplied minimum output
  must still be verified, including when simulation is skipped.

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
