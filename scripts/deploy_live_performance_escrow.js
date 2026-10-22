// Deploys LivePerformanceEscrow. Dry-run by default; Base broadcast requires CONFIRM_DEPLOY=yes.
//   Local Base-fork rehearsal (no keys):  BASE_FORK_RPC=https://mainnet.base.org npx hardhat run scripts/deploy_live_performance_escrow.js
//   Base mainnet:                         CONFIRM_DEPLOY=yes npx hardhat run scripts/deploy_live_performance_escrow.js --network base
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const OWNER = "0x807061DF657A7697c04045dA7d16D941861cAABc";

async function main() {
  const { ethers, network } = hre;
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== 8453) throw new Error(`Base (8453) or a Base fork required; got ${chainId}`);
  const live = network.name === "base";
  if ((await ethers.provider.getCode(USDC)) === "0x") throw new Error("USDC has no code; set BASE_FORK_RPC for local rehearsal");

  let deployer;
  if (live) {
    [deployer] = await ethers.getSigners();
    if (!deployer) throw new Error("Set PRIVATE_KEY (or MINT_OWNER_PRIVATE_KEY) in DecentMarket/.env");
    if (deployer.address.toLowerCase() !== OWNER.toLowerCase()) throw new Error(`Deployer ${deployer.address} is not the reviewed owner ${OWNER}`);
  } else {
    await network.provider.request({ method: "hardhat_impersonateAccount", params: [OWNER] });
    await network.provider.send("hardhat_setBalance", [OWNER, "0x8AC7230489E80000"]);
    deployer = await ethers.getSigner(OWNER);
  }

  const factory = await ethers.getContractFactory("LivePerformanceEscrow", deployer);
  const request = await factory.getDeployTransaction(USDC, OWNER);
  const gas = await ethers.provider.estimateGas({ ...request, from: deployer.address });
  const fee = await ethers.provider.getFeeData();
  const cost = gas * 120n / 100n * (fee.maxFeePerGas ?? fee.gasPrice);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(JSON.stringify({ network: network.name, mode: live && process.env.CONFIRM_DEPLOY !== "yes" ? "dry-run" : "deploy",
    deployer: deployer.address, token: USDC, admin: OWNER, deployGas: String(gas),
    estimatedCostEth: ethers.formatEther(cost), balanceEth: ethers.formatEther(balance) }, null, 2));
  if (balance < cost) throw new Error("Insufficient ETH for deployment gas");
  if (live && process.env.CONFIRM_DEPLOY !== "yes") return console.log("Dry run only. Re-run with CONFIRM_DEPLOY=yes to broadcast.");

  const escrow = await factory.deploy(USDC, OWNER);
  const tx = escrow.deploymentTransaction();
  const receipt = await tx.wait(live ? 2 : 1);
  if (receipt.status !== 1) throw new Error(`Deployment failed: ${tx.hash}`);
  const address = await escrow.getAddress();
  const adminRole = await escrow.ADMIN_ROLE();
  if (await escrow.usdc() !== USDC || !await escrow.hasRole(adminRole, OWNER) || !await escrow.hasRole(ethers.ZeroHash, OWNER))
    throw new Error("Post-deploy role/token check failed");
  const record = { contract: "LivePerformanceEscrow", chainId, address, transactionHash: tx.hash, startBlock: receipt.blockNumber,
    token: USDC, admin: OWNER, deployer: deployer.address, deployedAt: new Date().toISOString() };
  console.log(JSON.stringify(record, null, 2));
  if (live) {
    const output = path.join(__dirname, "../deployments/live-performance-escrow-base.json");
    fs.writeFileSync(output, JSON.stringify(record, null, 2) + "\n");
    console.log(`Wrote ${output}\nWorker env: LIVE_PERFORMANCE_ESCROW_ADDRESS=${address} LIVE_PERFORMANCE_ESCROW_START_BLOCK=${receipt.blockNumber}`);
  }
  return { escrow, deployer };
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main, USDC, OWNER };
