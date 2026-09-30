import type { Address } from 'viem'

/**
 * Capability-aware per-chain address tables.
 *
 * Each entry is a typed record `{ address, status, version? }` — not a bare
 * `Address` — so resolution can refuse a contract that is absent or has no code
 * with a typed error instead of returning a zero address. `status`:
 *   - `live`   — deployed and usable
 *   - `nocode` — the address has NO deployed code (a value/approval CALL would
 *                silently burn funds — the facade `getCode`+identity guard refuses it)
 *   - `planned`— reserved for a future deployment
 *
 * Protocol addresses follow the frontend contracts snapshot at commit
 * 8676fb6d49c8cbe0f06b6ce86f9ac4dd8e470741 (2026-09-30), checked for
 * bytecode and Locker / hook / zap wiring through each chain RPC. Initial local
 * deployment books were stale; protocol commit 1dea3f1 was also inspected.
 * Base Sepolia uses the token returned by hook.nativeToken(), correcting the
 * frontend book.
 * Missing contracts are omitted, never represented as live zero addresses.
 *
 * Universal Router addresses follow frontend commit
 * 3c32c6652419b09df817320e794ce268b41d2d9e (2.1.2). Robinhood testnet retains
 * 2.1.1: the mainnet 2.1.2 address has no code there. Other Uniswap addresses
 * follow the original snapshot and https://github.com/Uniswap/contracts/tree/main/deployments.
 * Zap targets follow the original frontend snapshot, which
 * still uses the v3.0.0 zap on Ethereum; this is not the latest periphery zap.
 */
export type ChainId = number

export type ContractStatus = 'live' | 'nocode' | 'planned'

export interface ContractEntry {
  readonly address: Address
  readonly status: ContractStatus
  /** Optional deployment version tag, for a future redeploy with changed signatures. */
  readonly version?: string
}

export type ContractKey =
  // NFTX v4
  | 'locker'
  | 'launchGate'
  | 'listings'
  | 'collectionShutdown'
  | 'taxCalculator'
  | 'nftxV4Hook'
  | 'nftxFlexHook'
  | 'lockerManager'
  | 'flEth'
  | 'collectionToken'
  | 'linearRangeCurve'
  | 'notifier'
  | 'protocolFeeReceiver'
  | 'nftxZap'
  // Uniswap v4
  | 'poolManager'
  | 'positionManager'
  | 'quoter'
  | 'universalRouter'
  | 'permit2'
  | 'stateView'

export type ChainContracts = Readonly<Partial<Record<ContractKey, ContractEntry>>>

const PERMIT2: Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3'

export const live = (address: Address, version?: string): ContractEntry =>
  Object.freeze({
    address,
    status: 'live' as const,
    ...(version ? { version } : {}),
  })

function freezeTables(
  tables: Record<ChainId, ChainContracts>,
): Readonly<Record<ChainId, ChainContracts>> {
  for (const contracts of Object.values(tables)) Object.freeze(contracts)
  return Object.freeze(tables)
}

// These chains share the nftx.v3 CREATE3 namespace, not deployment versions.
const CREATE3_PROTOCOL: ChainContracts = {
  locker: live('0xb4C5b5235b98114E9DC227b54e088C11680b2385'),
  listings: live('0x11F09e7eeD242FAd875D3565B3D9CA8AADE445ae'),
  taxCalculator: live('0x7592380231c49CA44b6340327D0c4a03C0380459'),
  nftxV4Hook: live('0xaa49ADaDD33c5E953b645567AFb10CBbba63afC4'),
  lockerManager: live('0xFadAC7b454971420b90091AB5807Eb8542b77886'),
  collectionToken: live('0x901124cb73e1E996280f9d763C7EC8bB3D764ba6'),
  nftxZap: live('0xDf288b66a77f25197544877eaF4626d7E64cb5A8'),
}

export const ADDRESS_TABLES: Readonly<Record<ChainId, ChainContracts>> = freezeTables({
  // Ethereum mainnet (1) — NFTX v3.0.0 (`nftx.v3` CREATE3 namespace).
  1: {
    locker: live('0xb4C5b5235b98114E9DC227b54e088C11680b2385', '3.0.0'),
    launchGate: live('0xD8F7C0Bd089A8F42728a7CfC95B18B3636f37d75'),
    listings: live('0x11F09e7eeD242FAd875D3565B3D9CA8AADE445ae', '3.0.0'),
    collectionShutdown: live('0x28bA2f2A1E38B4547b39675D8E1d96A016e626fF', '3.0.0'),
    taxCalculator: live('0x7592380231c49CA44b6340327D0c4a03C0380459', '3.0.0'),
    nftxV4Hook: live('0xaa49ADaDD33c5E953b645567AFb10CBbba63afC4', '3.0.0'),
    lockerManager: live('0xFadAC7b454971420b90091AB5807Eb8542b77886', '3.0.0'),
    flEth: live('0x000000000bB1f9944965c64066D10038a84F9af2', '3.0.0'),
    collectionToken: live('0x901124cb73e1E996280f9d763C7EC8bB3D764ba6', '3.0.0'),
    linearRangeCurve: live('0x0aBBeFaB8904cd3Cd478d376AD282f796056d95d', '3.0.0'),
    notifier: live('0x925e3415E35C0e8a4665691B89c1564b94fEDD1b', '3.0.0'),
    protocolFeeReceiver: live('0x1a18ab9c51CBb1EbB60a6f0D13d594F78a351559', '3.0.0'),
    nftxZap: live('0xDf288b66a77f25197544877eaF4626d7E64cb5A8', '3.0.0'),
    poolManager: live('0x000000000004444c5dc75cB358380D2e3dE08A90'),
    positionManager: live('0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e'),
    quoter: live('0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203'),
    universalRouter: live('0x23617e59A5925b2A4Bf75d73ff6711cD0b29De85', '2.1.2'),
    permit2: live(PERMIT2),
    stateView: live('0x7ffe42c4a5deea5b0fec41c94c136cf115597227'),
    nftxFlexHook: live('0xC26A5Cb51b1818F62a4C6693a9a1feDB3340efc4'),
  },
  // Base mainnet — protocol release v3.5.0 (2026-09-18).
  8453: {
    ...CREATE3_PROTOCOL,
    collectionShutdown: live('0x28bA2f2A1E38B4547b39675D8E1d96A016e626fF'),
    flEth: live('0x000000000D564D5be76f7f0d28fE52605afC7Cf8'),
    linearRangeCurve: live('0x0aBBeFaB8904cd3Cd478d376AD282f796056d95d'),
    poolManager: live('0x498581ff718922c3f8e6a244956af099b2652b2b'),
    positionManager: live('0x7C5f5A4bBd8fD63184577525326123B519429bDc'),
    quoter: live('0x0d5e0F971ED27FBfF6c2837bf31316121532048D'),
    universalRouter: live('0xd6145b2D3F379919E8CdEda7B97e37c4b2Ca9c40', '2.1.2'),
    stateView: live('0xa3c0c9b65bad0b08107aa264b0f3db444b867a71'),
    permit2: live(PERMIT2),
    launchGate: live('0xdb25a2324d2243b9624b620a33c80eff12ec7a89'),
  },
  // Arc mainnet — protocol release v3.4.0; native USDC, no wrapper.
  5042: {
    ...CREATE3_PROTOCOL,
    flEth: live('0x3600000000000000000000000000000000000000'),
    poolManager: live('0x8366a39cc670b4001a1121b8f6a443a643e40951'),
    positionManager: live('0x6049c9a0e26405c0985f9e3685c87d0ae917f82b'),
    quoter: live('0x8dc178efb8111bb0973dd9d722ebeff267c98f94'),
    universalRouter: live('0x8702463e73f74d0b6765aBceb314Ef07aCb92650', '2.1.2'),
    stateView: live('0xf3334192d15450cdd385c8b70e03f9a6bd9e673b'),
    permit2: live(PERMIT2),
    launchGate: live('0x8b97df0d72482f073d9efb3ad5b534fcd55d735b'),
  },
  // Robinhood mainnet.
  4663: {
    ...CREATE3_PROTOCOL,
    flEth: live('0x00000000043C1117DAFA3A3D0C7148Eb48B30130'),
    poolManager: live('0x8366a39CC670B4001A1121B8F6A443A643e40951'),
    positionManager: live('0x58daec3116aae6D93017bAAea7749052E8a04fA7'),
    quoter: live('0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94'),
    universalRouter: live('0x204FAca1764B154221e35c0d20aBb3c525710498', '2.1.2'),
    stateView: live('0xf3334192d15450cdd385c8b70e03f9a6bd9e673b'),
    permit2: live(PERMIT2),
    launchGate: live('0xd8f7c0bd089a8f42728a7cfc95b18b3636f37d75'),
  },
  // Arbitrum One.
  42161: {
    ...CREATE3_PROTOCOL,
    flEth: live('0x0000000006E53afede11caeB440B6FFf4398337D'),
    poolManager: live('0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32'),
    positionManager: live('0xd88F38F930b7952f2DB2432Cb002E7abbF3dD869'),
    quoter: live('0x3972C00f7ed4885e145823eb7C655375d275A1C5'),
    universalRouter: live('0x2d01411773c8C24805306E89A41F7855C3c4Fe65', '2.1.2'),
    stateView: live('0x76fd297e2d437cd7f76d50f01afe6160f86e9990'),
    permit2: live(PERMIT2),
    launchGate: live('0x8b97df0d72482f073d9efb3ad5b534fcd55d735b'),
  },
  // Robinhood testnet — FlETHMock.
  46630: {
    ...CREATE3_PROTOCOL,
    flEth: live('0xB8A21A638e2199D0f6f45273EB0CD286F14a9b73'),
    poolManager: live('0x8366a39CC670B4001A1121B8F6A443A643e40951'),
    positionManager: live('0x58daec3116aae6D93017bAAea7749052E8a04fA7'),
    quoter: live('0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94'),
    universalRouter: live('0x8876789976dEcBfCbBbe364623C63652db8C0904', '2.1.1'),
    permit2: live(PERMIT2),
    launchGate: live('0xdb25a2324d2243b9624b620a33c80eff12ec7a89'),
  },
  // Ink.
  57073: {
    ...CREATE3_PROTOCOL,
    flEth: live('0x000000000DD39073Cfc60e7102288ccBd7Bf23fE'),
    poolManager: live('0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32'),
    positionManager: live('0x1b35d13a2E2528f192637F14B05f0Dc0e7dEB566'),
    quoter: live('0x3972C00f7ed4885e145823eb7C655375d275A1C5'),
    universalRouter: live('0x661E93cca42AfacB172121EF892830cA3b70F08d', '2.1.2'),
    stateView: live('0x76fd297e2d437cd7f76d50f01afe6160f86e9990'),
    permit2: live(PERMIT2),
    launchGate: live('0x8b97df0d72482f073d9efb3ad5b534fcd55d735b'),
  },
  // Base Sepolia — legacy deployment, no v3 version claim.
  84532: {
    locker: live('0xdf40DdFc68f608E52794ae617534478125c63C84'),
    listings: live('0x6F7B74B518456C5edeE88AC9D19aBC25A8284c7a'),
    taxCalculator: live('0x28a1124E607032A00f393a6c1d7e59AFBFd34319'),
    nftxV4Hook: live('0x32D550542268d22Ee1fD35d392780f4C729A2fCC'),
    lockerManager: live('0xE8C6B807d4d036828d92923eb31162d51430909E'),
    flEth: live('0xD2AeC1992b576762726a4e0a201df18D28BF06A6'),
    collectionToken: live('0x06c203495b3090f5A8a73eCDA79Bac54f60E7220'),
    nftxZap: live('0xf827bd28f5CA9DD6c2262eDaF7E3F2481c437C7C'),
    poolManager: live('0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408'),
    positionManager: live('0x4B2C77d209D3405F41a037Ec6c77F7F5b8e2ca80'),
    quoter: live('0x4A6513c898fe1B2d0E78d3b0e0A4a151589B1cBa'),
    universalRouter: live('0x8702463e73f74d0b6765aBceb314Ef07aCb92650', '2.1.2'),
    permit2: live(PERMIT2),
    launchGate: live('0xfa57662c286385c4946751ac0be8a5bd6f55852b'),
  },
  // Ethereum Sepolia — FlETHMock.
  11155111: {
    ...CREATE3_PROTOCOL,
    flEth: live('0xB8A21A638e2199D0f6f45273EB0CD286F14a9b73'),
    poolManager: live('0xE03A1074c86CFeDd5C142C4F04F1a1536e203543'),
    positionManager: live('0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4'),
    quoter: live('0x61b3f2011a92d183c7dbadbda940a7555ccf9227'),
    universalRouter: live('0x7E4f6c5e954Da5c61B3423D81E2277431Ac043f3', '2.1.2'),
    stateView: live('0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c'),
    permit2: live(PERMIT2),
    launchGate: live('0xe49443ae5ea31fb17b96f2fc7a63b672ab7517e0'),
  },
})
