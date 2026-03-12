// scripts/deploy_DecentNFT_v02.js
// Deployment script for DecentNFT_v0.2 (ERC-1155 editionable NFT contract)
//
// Usage:
//   npx hardhat run scripts/deploy_DecentNFT_v02.js --network <network>
//
// Required environment variables (set in .env):
//   PRIVATE_KEY           – Deployer private key (receives DEFAULT_ADMIN_ROLE)
//   POLYGON_RPC_URL       – Polygon mainnet RPC endpoint
//   AMOY_RPC_URL          – Polygon Amoy testnet RPC endpoint
//   POLYGONSCAN_API_KEY   – For contract verification (optional)

const { ethers } = require("hardhat");

// TokenKind enum values (must mirror the contract)
const TokenKind = { Product: 0, Achievement: 1 };

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying DecentNFT_v0.2 with account:", deployer.address);
  console.log("  → deployer receives DEFAULT_ADMIN_ROLE automatically");

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "MATIC");

  // ── Constructor arguments ────────────────────────────────────────────────────
  //  baseURI_        Base IPFS URI for all token metadata.
  //                  Each token's URI becomes: <baseURI><tokenId>.json
  //  royaltyReceiver Address receiving ERC-2981 secondary-sale royalties.
  //  royaltyFeeBps   Royalty in basis points (500 = 5%).
  const BASE_URI = "ipfs://bafybeiabc123placeholder456def789/"; // replace with real CID after metadata upload
  const ROYALTY_RECEIVER = deployer.address;                    // replace with treasury address if needed
  const ROYALTY_FEE_BPS = 500;                                  // 5%

  const DecentNFT = await ethers.getContractFactory("DecentNFT_v0_2");
  const decentNFT = await DecentNFT.deploy(BASE_URI, ROYALTY_RECEIVER, ROYALTY_FEE_BPS);
  await decentNFT.waitForDeployment();

  const contractAddress = await decentNFT.getAddress();
  console.log("DecentNFT_v0.2 deployed to:", contractAddress);
  console.log("Network:", (await ethers.provider.getNetwork()).name);

  // ── Register a Product NFT (example: DecentHead_v1.0 as tokenId 0) ──────────
  console.log("\nRegistering DecentHead_v1.0 as Product tokenId 0 …");
  const tx = await decentNFT.registerToken(
    1000,              // maxSupply_: up to 1000 editions
    "",                // tokenURI_: empty → use base URI pattern (ipfs://<root>/0.json)
    TokenKind.Product, // kind_: Product
    ethers.ZeroAddress, // royaltyReceiver: use contract default
    0                  // royaltyFeeBps: use contract default
  );
  const receipt = await tx.wait();
  console.log("  registerToken tx:", receipt.hash);
  console.log("  tokenId 0 registered as Product. Max supply: 1000");

  // ── Register an Achievement NFT (example: BigNuten "7-day streak" = tokenId 1)
  console.log("\nRegistering BigNuten 7-day streak as Achievement tokenId 1 …");
  const tx2 = await decentNFT.registerToken(
    0,                      // maxSupply_: unlimited
    "",                     // tokenURI_: use base URI pattern
    TokenKind.Achievement,  // kind_: Achievement
    ethers.ZeroAddress,     // royaltyReceiver: use contract default
    0                       // royaltyFeeBps: use contract default
  );
  const receipt2 = await tx2.wait();
  console.log("  registerToken tx:", receipt2.hash);
  console.log("  tokenId 1 registered as Achievement (unlimited)");

  // ── Example: mint 5 Product editions to the deployer ─────────────────────────
  console.log("\nMinting 5 Product editions of tokenId 0 to deployer …");
  const mintTx = await decentNFT.mintProduct(deployer.address, 0, 5);
  const mintReceipt = await mintTx.wait();
  console.log("  mintProduct tx:", mintReceipt.hash);
  console.log("  Total minted for tokenId 0:", await decentNFT.totalMinted(0));

  // ── Grant MINTER_ROLE to an example issuer wallet ─────────────────────────────
  // Uncomment and replace with real issuer address before deploying:
  // const ISSUER_WALLET = "0xBigNutenIssuerWalletAddress";
  // const MINTER_ROLE = await decentNFT.MINTER_ROLE();
  // await decentNFT.grantRole(MINTER_ROLE, ISSUER_WALLET);
  // console.log(`\nGranted MINTER_ROLE to ${ISSUER_WALLET}`);
  console.log("\nNote: Grant MINTER_ROLE to issuer wallets with:");
  console.log("  await decentNFT.grantRole(await decentNFT.MINTER_ROLE(), issuerAddress)");

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log("\n─────────────────────────────────────────────────────────────────");
  console.log("Deployment Summary");
  console.log("─────────────────────────────────────────────────────────────────");
  console.log("Contract :  DecentNFT_v0.2 (DecentNFT_v0_2)");
  console.log("Address  : ", contractAddress);
  console.log("Network  : ", (await ethers.provider.getNetwork()).name);
  console.log("Base URI : ", BASE_URI);
  console.log("Royalty  : ", ROYALTY_FEE_BPS / 100, "% →", ROYALTY_RECEIVER);
  console.log("Admin    : ", deployer.address, "(DEFAULT_ADMIN_ROLE)");
  console.log("─────────────────────────────────────────────────────────────────");
  console.log("Update DEPLOYMENTS.md and abis/DecentNFT_v0.2.json accordingly.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

