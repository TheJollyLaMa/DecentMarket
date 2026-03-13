# DecentMarket — Deployment Log

This file tracks on-chain deployments of DecentMarket smart contracts.

---

## DecentNFT_v0.2 — ERC-1155 Editionable NFT

**Contract:** `DecentNFT_v0_2`  
**Solidity file:** `contracts/DecentNFT_v0.2.sol`  
**ABI:** `abis/DecentNFT_v0.2.json`  
**Compiler:** Solidity 0.8.26, optimizer enabled (200 runs), EVM target: Cancun  
**Dependencies:** OpenZeppelin Contracts 5.x (`ERC1155`, `Ownable`, `ERC2981`)

### Features
- ERC-1155 multi-token standard for editioned NFTs
- Per-token or collection-wide IPFS metadata URIs
- Per-token supply caps (0 = unlimited)
- ERC-2981 royalty support (default + per-token overrides)
- `onlyOwner` product minting (`mintEdition`) and open user-minting (`mintUser`)
- Creator/origin address tracked on-chain per token ID
- Events: `TokenRegistered`, `EditionMinted`, standard ERC-1155 transfer events

### Deployments

| Network | Address | Deployer | Date | Notes |
|---------|---------|----------|------|-------|
| Localhost (Hardhat) | — | — | — | Use `npm run deploy:local` |
| Polygon Amoy (testnet) | _TBD_ | _TBD_ | _TBD_ | Deploy with `npm run deploy:amoy` |
| Polygon Mainnet | _TBD_ | _TBD_ | _TBD_ | Deploy with `npm run deploy:polygon` |

> **To record a deployment:** After running the deploy script, update the table above with the
> contract address, deployer account, date, and any relevant notes (base URI, royalty %, etc.).

### Deploy Instructions

1. Copy `.env.example` to `.env` and fill in your credentials:
   ```
   PRIVATE_KEY=0x...
   POLYGON_RPC_URL=https://polygon-rpc.com
   MUMBAI_RPC_URL=https://rpc-mumbai.maticvigil.com
   POLYGONSCAN_API_KEY=...
   ```

2. Compile:
   ```bash
   npm run compile
   ```

3. Deploy to testnet (Amoy):
   ```bash
   npm run deploy:amoy
   ```

4. (Optional) Verify on Polygonscan:
   ```bash
   npx hardhat verify --network amoy <CONTRACT_ADDRESS> "<BASE_URI>" "<ROYALTY_RECEIVER>" <ROYALTY_BPS>
   ```

5. Export ABI (after compile):
   ```bash
   npm run export:abi
   ```

### Example: Mint an Editioned Product NFT

After deploying and registering a product (e.g., `DecentHead_v1.0` as tokenId 0):

```javascript
// Using ethers.js v6
const provider = new ethers.BrowserProvider(window.ethereum);
const signer = await provider.getSigner();

const decentNFT = new ethers.Contract(
  "0x<DEPLOYED_ADDRESS>",
  // ABI from abis/DecentNFT_v0.2.json
  decentNFTABI,
  signer
);

// Register a product NFT (owner only)
// tokenId 0 = DecentHead_v1.0, max 1000 editions, 5% royalty
const tx = await decentNFT.registerToken(
  1000,                       // maxSupply_
  "",                         // tokenURI_ (use base URI pattern: ipfs://<root>/0.json)
  ethers.ZeroAddress,         // royaltyReceiver (use contract default)
  0                           // royaltyFeeBps (use contract default)
);
await tx.wait();

// Mint 1 edition to a buyer (owner only for product NFTs)
await decentNFT.mintEdition(buyerAddress, 0, 1);

// Or let users self-mint (open mint path)
await decentNFT.mintUser(0, 1);

// Check metadata URI
const tokenURI = await decentNFT.uri(0);
// → "ipfs://<rootCID>/0.json"

// Check royalty for a 1 ETH sale
const [receiver, amount] = await decentNFT.royaltyInfo(0, ethers.parseEther("1"));
// → receiver = royaltyReceiver address
// → amount   = 0.05 ETH (5%)
```

### Integration

Once deployed, update the frontend (`js/components/`) to reference the new contract address and
import the ABI from `abis/DecentNFT_v0.2.json`. Related follow-on issues should reference this
deployment for marketplace integration.
