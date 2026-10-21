/**
 * Contract configuration for DecentMarket.
 * Each key is a chain identifier; add new chains here as support expands.
 */
export const CONTRACTS = {
  base: {
    chainId: '0x2105',        // 8453 in decimal
    chainName: 'Base Mainnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://mainnet.base.org'],
    blockExplorerUrls: ['https://basescan.org'],
    addresses: {
      DNFT: '0xe63EC9f8228720bAAC2fD528C0A6d06B3Dc5439B',
      ESCROW: '0x31b07b83e99A9bdF379bf40225b8A80d3804C89d',
      BNUT: '0x25ACb773159Af5a5c672DEfe31C7Fff6a9A93736',
      USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    },
  },
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
  // Legacy networks remain available as address records; MetaMask controls switching.
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
 * PayPal configuration for DNFT purchases.
 * Replace clientId with your live PayPal app client ID.
 * adminEmail receives mailto: fallback notifications when no webhook is set.
 * adminWebhookUrl (optional) — POST endpoint that receives purchase details as JSON.
 */
export const PAYPAL_CONFIG = {
  clientId:        'YOUR_PAYPAL_CLIENT_ID',   // Replace with live PayPal client ID
  adminEmail:      'admin@decentmarket.io',    // Admin email for purchase notifications
  adminWebhookUrl: '',                         // Optional: POST webhook URL for admin alerts
  dnftPriceUSD:    '100.00',                   // Fixed price in USD for PayPal purchases
};

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
    description: 'archived deployment (sunset)',
    href: '/v0.2/',
    available: false,
    current: false,
  },
];
