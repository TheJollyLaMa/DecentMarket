// scripts/deployEscrow.js
// Deployment script for DecentEscrow — Community Treasury v1
//
// Usage:
//   npx hardhat run scripts/deployEscrow.js --network optimism
//
// Required environment variables (set in .env):
//   PRIVATE_KEY              – Deployer private key (becomes initial owner)
//   OPTIMISM_RPC_URL         – Optimism Mainnet RPC endpoint (or use the default)
//   OPTIMISM_ETHERSCAN_KEY   – For contract verification on Optimistic Etherscan (optional)
//
// After deployment:
//   1. Copy the printed contract address into js/config/contracts.js (addresses.ESCROW)
//   2. Copy the address into docs/ESCROW.md and README.md
//   3. Add a row to DEPLOYMENTS.md
//   4. Verify on Etherscan:
//        npx hardhat verify --network optimism <address> <initialOwner>

const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying DecentEscrow with account:", deployer.address);
  console.log("  → deployer becomes initial owner");

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");

  // ── Constructor argument ─────────────────────────────────────────────────────
  //  initialOwner  Wallet that controls the escrow on deployment.
  //                Phase 2: transfer to a Gnosis Safe via transferOwnership().
  const INITIAL_OWNER = deployer.address; // replace with a safe address if deploying from a hot wallet

  const DecentEscrow = await ethers.getContractFactory("DecentEscrow");
  const escrow = await DecentEscrow.deploy(INITIAL_OWNER);
  await escrow.waitForDeployment();

  const contractAddress = await escrow.getAddress();
  const network = await ethers.provider.getNetwork();

  console.log("\nDecentEscrow deployed to:", contractAddress);
  console.log("Network:", network.name, `(chainId ${network.chainId})`);
  console.log("Owner:", await escrow.owner());

  // ── Post-deployment checklist ─────────────────────────────────────────────────
  console.log("\n─────────────────────────────────────────────────────────────────");
  console.log("Deployment Summary");
  console.log("─────────────────────────────────────────────────────────────────");
  console.log("Contract :  DecentEscrow (Community Treasury v1)");
  console.log("Address  : ", contractAddress);
  console.log("Network  : ", network.name, `(chainId ${network.chainId})`);
  console.log("Owner    : ", INITIAL_OWNER);
  console.log("─────────────────────────────────────────────────────────────────");
  console.log("Next steps:");
  console.log("  1. Update js/config/contracts.js → addresses.ESCROW:", contractAddress);
  console.log("  2. Update docs/ESCROW.md with the deployed address");
  console.log("  3. Update DEPLOYMENTS.md with the new row");
  console.log("  4. Verify on Etherscan:");
  console.log(`       npx hardhat verify --network optimism ${contractAddress} ${INITIAL_OWNER}`);
  console.log("─────────────────────────────────────────────────────────────────");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
