// Deploys LivePerformanceAssetsEscrow. Dry-run by default; Base broadcast requires CONFIRM_DEPLOY=yes.
// Load the authorized dotenv file with:
// DOTENV_CONFIG_PATH=/absolute/path/to/.env node -r dotenv/config node_modules/hardhat/internal/cli/cli.js run scripts/deploy_live_performance_assets_escrow.js --network base
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ADMIN = "0x807061DF657A7697c04045dA7d16D941861cAABc";
// Unperformed gifts return to the administrator wallet stash, not the Market contract.
const GIFT_TREASURY = ADMIN;
const MAX_DEPLOYMENT_COST = hre.ethers.parseEther("0.005");

async function main() {
  const { ethers, network } = hre;
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== 8453 || network.name !== "base") {
    throw new Error(`Base mainnet deployment required; got ${network.name} (${chainId})`);
  }
  if ((await ethers.provider.getCode(USDC)) === "0x") throw new Error("Base USDC has no code");
  const usdc = new ethers.Contract(USDC, ["function decimals() view returns (uint8)"], ethers.provider);
  if (Number(await usdc.decimals()) !== 6) throw new Error("Configured Base USDC does not report six decimals");

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployment signer; load the authorized dotenv file");
  if (deployer.address.toLowerCase() !== ADMIN.toLowerCase()) {
    throw new Error(`Deployer ${deployer.address} is not the approved administrator`);
  }

  const factory = await ethers.getContractFactory("LivePerformanceAssetsEscrow", deployer);
  const request = await factory.getDeployTransaction(ADMIN, USDC);
  const gas = await ethers.provider.estimateGas({ ...request, from: deployer.address });
  const gasLimit = gas * 120n / 100n;
  if (gasLimit > 8_000_000n) throw new Error(`Estimated gas limit ${gasLimit} exceeds the deployment cap`);
  const fee = await ethers.provider.getFeeData();
  const unitPrice = fee.maxFeePerGas ?? fee.gasPrice;
  if (unitPrice == null) throw new Error("Base gas price unavailable");
  const cost = gasLimit * unitPrice;
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(JSON.stringify({
    network: network.name,
    mode: process.env.CONFIRM_DEPLOY === "yes" ? "deploy" : "dry-run",
    deployer: deployer.address,
    admin: ADMIN,
    usdc: USDC,
    giftTreasury: GIFT_TREASURY,
    estimatedGas: String(gas),
    gasLimit: String(gasLimit),
    maxFeePerGas: String(unitPrice),
    estimatedCostEth: ethers.formatEther(cost),
    balanceEth: ethers.formatEther(balance)
  }, null, 2));
  if (balance < cost) throw new Error("Insufficient ETH for deployment gas");
  if (cost > MAX_DEPLOYMENT_COST) throw new Error("Estimated deployment cost exceeds the 0.005 ETH safety cap");
  if (process.env.CONFIRM_DEPLOY !== "yes") {
    return console.log("Dry run only. Re-run with CONFIRM_DEPLOY=yes to broadcast.");
  }

  const escrow = await factory.deploy(ADMIN, USDC, { gasLimit });
  const tx = escrow.deploymentTransaction();
  if (!tx) throw new Error("Deployment transaction was not created");
  const receipt = await tx.wait(2);
  if (!receipt || receipt.status !== 1) throw new Error(`Deployment failed: ${tx.hash}`);

  const address = await escrow.getAddress();
  const runtimeCode = await ethers.provider.getCode(address);
  if (runtimeCode === "0x") throw new Error("Deployed contract has no runtime code");
  const defaultAdminRole = await escrow.DEFAULT_ADMIN_ROLE();
  const adminRole = await escrow.ADMIN_ROLE();
  if (
    !(await escrow.hasRole(defaultAdminRole, ADMIN)) ||
    !(await escrow.hasRole(adminRole, ADMIN)) ||
    !(await escrow.approvedTokens(USDC))
  ) {
    throw new Error("Post-deployment role or USDC allowlist check failed");
  }

  const record = {
    contract: "LivePerformanceAssetsEscrow",
    chainId,
    address,
    transactionHash: tx.hash,
    startBlock: receipt.blockNumber,
    usdc: USDC,
    admin: ADMIN,
    giftTreasury: GIFT_TREASURY,
    deployer: deployer.address,
    runtimeCodeHash: ethers.keccak256(runtimeCode),
    deployedAt: new Date().toISOString()
  };
  fs.writeFileSync(
    path.join(__dirname, "../deployments/live-performance-assets-escrow-base.json"),
    JSON.stringify(record, null, 2) + "\n"
  );
  fs.writeFileSync(
    path.join(__dirname, "../abis/LivePerformanceAssetsEscrow.json"),
    JSON.stringify(JSON.parse(factory.interface.formatJson()), null, 2) + "\n"
  );
  console.log(JSON.stringify(record, null, 2));
  console.log(`Worker env: LIVE_PERFORMANCE_ASSET_ESCROW_ADDRESS=${address} LIVE_PERFORMANCE_ASSET_ESCROW_START_BLOCK=${receipt.blockNumber}`);
  console.log(`Gift treasury env: LIVE_PERFORMANCE_GIFT_TREASURY_ADDRESS=${GIFT_TREASURY}`);
}

if (require.main === module) main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});

module.exports = { main, USDC, ADMIN, GIFT_TREASURY };
