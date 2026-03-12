/**
 * Contract configuration for DecentMarket.
 * Each key is a chain identifier; add new chains here as support expands.
 */
export const CONTRACTS = {
  polygon: {
    chainId: '0x89',        // 137 in decimal
    chainName: 'Polygon Mainnet',
    nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
    rpcUrls: ['https://polygon-rpc.com'],
    blockExplorerUrls: ['https://polygonscan.com'],
    addresses: {
      DNFT: '0x4cE20F0bbF7eA38488F9c9555EfD2b502E86A53E',
    },
  },
  // Future chains — uncomment and fill in when support is added:
  // ethereum: {
  //   chainId: '0x1',
  //   chainName: 'Ethereum Mainnet',
  //   nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  //   rpcUrls: ['https://mainnet.infura.io/v3/YOUR_KEY'],
  //   blockExplorerUrls: ['https://etherscan.io'],
  //   addresses: {
  //     DNFT: '',
  //   },
  // },
  // arbitrum: {
  //   chainId: '0xa4b1',
  //   chainName: 'Arbitrum One',
  //   nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  //   rpcUrls: ['https://arb1.arbitrum.io/rpc'],
  //   blockExplorerUrls: ['https://arbiscan.io'],
  //   addresses: {
  //     DNFT: '',
  //   },
  // },
};

/** Chain IDs for all currently supported networks. */
export const SUPPORTED_CHAIN_IDS = Object.values(CONTRACTS).map(c => c.chainId);

/**
 * Look up chain config by EIP-1193 chain ID hex string (e.g. '0x89').
 * Returns undefined if the chain is not in CONTRACTS.
 */
export function getChainConfig(chainIdHex) {
  return Object.values(CONTRACTS).find(c => c.chainId === chainIdHex);
}

/**
 * Application version registry.
 * Each entry describes a released (or upcoming) version of the app.
 * Set `available: false` for versions not yet deployed.
 * Update `href` to the real deployment URL when a version goes live.
 */
export const VERSIONS = [
  {
    label: 'v0.1',
    description: 'current',
    href: '/',
    available: true,
    current: true,
  },
  {
    label: 'v0.2',
    description: 'coming soon',
    href: '/v0.2/',
    available: false,
    current: false,
  },
];
