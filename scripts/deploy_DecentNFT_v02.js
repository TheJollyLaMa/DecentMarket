// scripts/deploy_DecentNFT_v02.js
// Deployment script for DecentNFT_v0.2 (ERC-1155 editionable NFT contract)
//
// Usage:
//   npx hardhat run scripts/deploy_DecentNFT_v02.js --network <network>
//
// Required environment variables (set in .env):
//   PRIVATE_KEY           – Deployer private key
//   POLYGON_RPC_URL       – Polygon mainnet RPC endpoint
//   AMOY_RPC_URL          – Polygon Amoy testnet RPC endpoint
//   POLYGONSCAN_API_KEY   – For contract verification (optional)

const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying DecentNFT_v0.2 with account:", deployer.address);

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

  // ── Register a product NFT (example: DecentHead_v1.0 as tokenId 0) ─────────
  console.log("\nRegistering DecentHead_v1.0 as tokenId 0 …");
  const tx = await decentNFT.registerToken(
    1000,         // maxSupply_: up to 1000 editions
    "",           // tokenURI_: empty → use base URI pattern (ipfs://<root>/0.json)
    ethers.ZeroAddress, // royaltyReceiver: use contract default
    0             // royaltyFeeBps: use contract default
  );
  const receipt = await tx.wait();
  console.log("  registerToken tx:", receipt.hash);
  console.log("  tokenId 0 registered. Max supply: 1000");

  // ── Example: mint 5 editions to the deployer ─────────────────────────────────
  console.log("\nMinting 5 editions of tokenId 0 to deployer …");
  const mintTx = await decentNFT.mintEdition(deployer.address, 0, 5);
  const mintReceipt = await mintTx.wait();
  console.log("  mintEdition tx:", mintReceipt.hash);
  console.log("  Total minted for tokenId 0:", await decentNFT.totalMinted(0));

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log("\n─────────────────────────────────────────────────────────────────");
  console.log("Deployment Summary");
  console.log("─────────────────────────────────────────────────────────────────");
  console.log("Contract :  DecentNFT_v0.2 (DecentNFT_v0_2)");
  console.log("Address  : ", contractAddress);
  console.log("Network  : ", (await ethers.provider.getNetwork()).name);
  console.log("Base URI : ", BASE_URI);
  console.log("Royalty  : ", ROYALTY_FEE_BPS / 100, "% →", ROYALTY_RECEIVER);
  console.log("─────────────────────────────────────────────────────────────────");
  console.log("Update DEPLOYMENTS.md and abis/DecentNFT_v0.2.json accordingly.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
