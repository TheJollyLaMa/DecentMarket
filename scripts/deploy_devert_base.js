const fs = require("node:fs");
const path = require("node:path");
const { ethers, network } = require("hardhat");
const { assertManifestAvailable, deploymentConfirmed, validateSchedulerAddress } = require("./devert_deploy_policy");

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const SETTLEMENT_ROUTER = "0x8ecca903e2a6Daa8CCbB933700e4F2C58C44A4B5";
const DJUKE_V02 = "0x333Aa353d6fc70aE79Cf91CE090645CD740FEf59";
const OWNER = "0x807061DF657A7697c04045dA7d16D941861cAABc";
const ROUTER_ABI = [
  "function funds(bytes32) view returns (string metadataUri, bool active, bool exists)",
  "function approvedAssets(address) view returns (bool)",
  "function paused() view returns (bool)",
];

async function main() {
  if (network.name !== "base") throw new Error("DeVert deployment is Base-mainnet-only");
  const output = path.join(__dirname, "../deployments/devert-v01-base.json");
  assertManifestAvailable(output, fs.existsSync);

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("Set MINT_OWNER_PRIVATE_KEY (or PRIVATE_KEY) in the ignored local environment");
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== 8453) throw new Error(`Expected Base (8453), connected to ${chainId}`);
  if (deployer.address.toLowerCase() !== OWNER.toLowerCase()) throw new Error("DeVert deployer must be the configured project owner");
  const scheduler = validateSchedulerAddress({ ethers, deployerAddress: deployer.address,
    scheduler: process.env.DEVERT_SCHEDULER_ADDRESS });

  const fundIds = ["dbusk-playback", "dbusk-top10", "dbusk-pinners", "dbusk-repo-dev"].map(ethers.id);
  const router = new ethers.Contract(SETTLEMENT_ROUTER, ROUTER_ABI, ethers.provider);
  if (await ethers.provider.getCode(DJUKE_V02) === "0x") throw new Error("Deployed DJuke v0.2 is unavailable at the configured address");
  if (await ethers.provider.getCode(SETTLEMENT_ROUTER) === "0x") throw new Error("Settlement router is not deployed");
  if (await router.paused()) throw new Error("Settlement router is paused");
  if (!await router.approvedAssets(BASE_USDC)) throw new Error("Base USDC is not approved on the settlement router");
  for (const slug of ["dbusk-playback", "dbusk-top10", "dbusk-pinners", "dbusk-repo-dev"]) {
    const fund = await router.funds(ethers.id(slug));
    if (!fund.exists || !fund.active) throw new Error(`Router fund ${slug} must exist and be active`);
  }

  const factory = await ethers.getContractFactory("DeVert_v0_1");
  const args = [BASE_USDC, SETTLEMENT_ROUTER, DJUKE_V02, ...fundIds, deployer.address, scheduler];
  const request = await factory.getDeployTransaction(...args);
  const gas = await ethers.provider.estimateGas({ ...request, from: deployer.address });
  const estimatedGas = gas * 130n / 100n;
  const nonce = await ethers.provider.getTransactionCount(deployer.address, "pending");
  if (nonce !== await ethers.provider.getTransactionCount(deployer.address, "latest")) throw new Error("Deployer has pending transactions");
  const predictedAddress = ethers.getCreateAddress({ from: deployer.address, nonce });
  const fees = await ethers.provider.getFeeData();
  const balance = await ethers.provider.getBalance(deployer.address);
  const estimate = estimatedGas * (fees.maxFeePerGas || fees.gasPrice);
  console.log(JSON.stringify({ mode: deploymentConfirmed(process.env.CONFIRM_DEPLOY) ? "live" : "dry-run",
    network: network.name, chainId, admin: deployer.address, scheduler,
    predictedAddress, djuke: DJUKE_V02,
    router: SETTLEMENT_ROUTER, usdc: BASE_USDC, fundSlugs: ["dbusk-playback", "dbusk-top10", "dbusk-pinners", "dbusk-repo-dev"],
    estimatedGas: estimatedGas.toString(), estimatedCostEth: ethers.formatEther(estimate), ownerBalanceEth: ethers.formatEther(balance) }, null, 2));
  if (balance < estimate) throw new Error("Owner wallet has insufficient Base ETH for the estimated deployment");
  if (!deploymentConfirmed(process.env.CONFIRM_DEPLOY)) {
    console.log("Dry run complete. Set CONFIRM_DEPLOY=yes only after contract review and all purchase/playback tests pass.");
    return;
  }

  const manifest = { network: network.name, chainId, preparedAt: new Date().toISOString(), predictedAddress,
    admin: deployer.address, scheduler, djuke: DJUKE_V02,
    router: SETTLEMENT_ROUTER, usdc: BASE_USDC,
    fundSlugs: ["dbusk-playback", "dbusk-top10", "dbusk-pinners", "dbusk-repo-dev"], phase: "deployment-prepared" };
  fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  const contract = await factory.deploy(...args, { nonce, gasLimit: gas * 130n / 100n });
  const transaction = contract.deploymentTransaction();
  manifest.deploymentTx = transaction.hash;
  fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n");
  const receipt = await transaction.wait(2);
  if (receipt?.status !== 1) throw new Error(`DeVert deployment failed: ${transaction.hash}`);
  const address = await contract.getAddress();
  if (address.toLowerCase() !== predictedAddress.toLowerCase()) throw new Error("DeVert address differs from prepared deployment manifest");
  manifest.address = address;
  manifest.deployedAt = new Date().toISOString();
  manifest.deploymentBlock = receipt.blockNumber;
  manifest.paused = await contract.paused();
  if (!manifest.paused) throw new Error("DeVert must remain paused after deployment");
  manifest.schedulerRoleConfirmed = await contract.hasRole(await contract.SCHEDULER_ROLE(), scheduler);
  if (!manifest.schedulerRoleConfirmed) throw new Error("Primary scheduler role is not confirmed");
  manifest.phase = "deployed-paused-not-live";
  fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });