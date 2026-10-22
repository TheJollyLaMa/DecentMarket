window.DECENT_CONFIG = {
  appName: 'Decent Market',
  musicSubmissionOwner: '0x807061DF657A7697c04045dA7d16D941861cAABc',
  subtitle: '(Another Decent Frankenstein)',
  theme: { 'bg-1': '#050b20', 'bg-2': '#182140', 'bg-3': '#10352d', accent: '#7af0c6', 'accent-2': '#a78cff', title: '#edfff8' },
  chain: { chainId: 8453, chainName: 'Base', rpcUrls: ['https://mainnet.base.org'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, blockExplorerUrls: ['https://basescan.org'] },
  providers: { default: 'pinata', gateway: 'https://gateway.pinata.cloud/ipfs/',
    pinata: { uploadUrl: 'https://api.pinata.cloud/pinning/pinFileToIPFS' },
    local: { apiUrl: 'http://127.0.0.1:5001' } },
  about: {
    title: 'About DecentMarket',
    summary: 'The Decent marketplace for versioned creative work, Supporter editions and their release provenance.',
    sections: [
      { title: 'Support a release', body: 'Supporter editions archive the code and mark the product, version, creator, date and original $10 price. They are keepsakes, not a promise of financial return. Royalties depend on marketplace support.' },
      { title: 'Your wallet and storage', body: 'The shared DecentHead provides click-only wallet access and Pinata or local IPFS uploads. Credentials stay in this page session. No upload, mint, transfer or purchase happens without an explicit action.' },
      { title: 'Steward workflow', body: 'The Supporter Release Studio preserves prepared metadata and verifies each registration, mint, escrow transfer and listing. Keep progress backups. A listed release is not the same as a completed purchase or Discord announcement.' },
    ],
  },
  links: [
    { label: 'Source and license', url: 'https://github.com/TheJollyLaMa/DecentMarket' },
    { label: 'Supporter Release Studio', url: './supporter.html' },
    { label: 'Agency marathon', url: 'https://a-decent-agency.github.io/' },
  ],
  relatedDapps: [
    { label: 'DecentHead v2.0.0', url: 'https://thejollylama.github.io/DecentHead/' },
    { label: 'DecentCanopy', url: 'https://thejollylama.github.io/DecentCanopy/' },
    { label: 'DecentBusking', url: 'https://thejollylama.github.io/DecentBusking/' },
  ],
};
