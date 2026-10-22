// Deploys DecentNFT_v0_3 and DecentJukeBox_v0_1 to Base for DecentBusking.
// Dry-run by default; set CONFIRM_DEPLOY=yes to broadcast.
//   npx hardhat run scripts/deploy_dbusk_base.js --network base
// Required env: PRIVATE_KEY (deployer = admin), DBUSK_FULFILLER (worker wallet: fulfills plays and registers new songs).
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const SETTLEMENT_ROUTER = "0x8ecca903e2a6Daa8CCbB933700e4F2C58C44A4B5";
const REPO_FUND_SLUG = "dbusk-repo-dev";
const PINNER_FUND_SLUG = "dbusk-pinners";
const ROUTER_ABI = [
  "function funds(bytes32) view returns (string metadataUri, bool active, bool exists)",
  "function approvedAssets(address) view returns (bool)",
  "function paused() view returns (bool)",
];

async function main() {
  const live = network.name === "base";
  const confirm = process.env.CONFIRM_DEPLOY === "yes";
  const output = path.join(__dirname, `../deployments/dbusk-${network.name}.json`);
  if (live && fs.existsSync(output)) {
    throw new Error(`Deployment manifest already exists at ${output}; refusing to deploy duplicate contracts`);
  }
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("Set PRIVATE_KEY in your local environment");
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== 8453) throw new Error(`Expected Base (8453), connected to ${chainId}`);
  const fulfiller = process.env.DBUSK_FULFILLER;
  if (!ethers.isAddress(fulfiller || "")) throw new Error("Set DBUSK_FULFILLER to the worker's dedicated fulfillment wallet address");
  if (fulfiller.toLowerCase() === deployer.address.toLowerCase()) throw new Error("Use a separate fulfillment wallet, not the admin wallet");

  const fundId = ethers.id(REPO_FUND_SLUG);
  const pinnerFundId = ethers.id(PINNER_FUND_SLUG);
  const router = new ethers.Contract(SETTLEMENT_ROUTER, ROUTER_ABI, ethers.provider);
  const fund = await router.funds(fundId);
  if (!fund.exists || !fund.active) throw new Error(`Router fund ${REPO_FUND_SLUG} must exist and be active`);
  const pinnerFund = await router.funds(pinnerFundId);
  if (!pinnerFund.exists || !pinnerFund.active) throw new Error(`Router fund ${PINNER_FUND_SLUG} must exist and be active`);
  if (!(await router.approvedAssets(BASE_USDC))) throw new Error("USDC is not approved on the settlement router");
  if (await router.paused()) throw new Error("Settlement router is paused");

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(JSON.stringify({ network: network.name, chainId, admin: deployer.address,
    adminEth: ethers.formatEther(balance), fulfiller, router: SETTLEMENT_ROUTER, usdc: BASE_USDC,
    repoFund: REPO_FUND_SLUG, pinnerFund: PINNER_FUND_SLUG,
    repoDevShareBps: 200, pinnerShareBps: 800 }, null, 2));

  const NFT = await ethers.getContractFactory("DecentNFT_v0_3");
  const DJuke = await ethers.getContractFactory("contracts/DecentJukeBox_v0.1.sol:DecentJukeBox_v0_1");
  const nftDeploy = await NFT.getDeployTransaction("", deployer.address, 500);
  const djukeDeploy = await DJuke.getDeployTransaction(BASE_USDC, SETTLEMENT_ROUTER, fundId, pinnerFundId, deployer.address);
  const gas = (await ethers.provider.estimateGas({ ...nftDeploy, from: deployer.address }))
    + (await ethers.provider.estimateGas({ ...djukeDeploy, from: deployer.address })) + 120000n;
  const fee = await ethers.provider.getFeeData();
  console.log(`Estimated gas ${gas} (~${ethers.formatEther(gas * (fee.maxFeePerGas || fee.gasPrice))} ETH at current max fee)`);
  if (live && !confirm) {
    console.log("Dry run complete. Re-run with CONFIRM_DEPLOY=yes to broadcast.");
    return;
  }

  const nft = await NFT.deploy("", deployer.address, 500);
  await nft.waitForDeployment();
  const nftDeployment = nft.deploymentTransaction();
  if (live && nftDeployment) await nftDeployment.wait(2);
  const djuke = await DJuke.deploy(BASE_USDC, SETTLEMENT_ROUTER, fundId, pinnerFundId, deployer.address);
  await djuke.waitForDeployment();
  const djukeDeployment = djuke.deploymentTransaction();
  if (live && djukeDeployment) await djukeDeployment.wait(2);

  const result = { network: network.name, chainId, deployedAt: new Date().toISOString(), admin: deployer.address,
    decentNftV03: await nft.getAddress(), djukeV01: await djuke.getAddress(), fulfiller,
    router: SETTLEMENT_ROUTER, usdc: BASE_USDC, repoFund: REPO_FUND_SLUG, pinnerFund: PINNER_FUND_SLUG,
    repoDevShareBps: 200, pinnerShareBps: 800,
    deploymentTxs: { decentNftV03: nftDeployment?.hash, djukeV01: djukeDeployment?.hash },
    workerRoles: { fulfiller: false, registrar: false } };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  console.log(`Deployment addresses recorded at ${output} before role setup.`);

  const roles = [
    ["fulfiller", ethers.id("FULFILLER_ROLE")],
    ["registrar", ethers.id("REGISTRAR_ROLE")],
  ];
  for (const [name, role] of roles) {
    if (!(await djuke.hasRole(role, fulfiller))) {
      await djuke.grantRole.staticCall(role, fulfiller);
      const transaction = await djuke.grantRole(role, fulfiller);
      const receipt = await transaction.wait(live ? 2 : 1);
      if (receipt?.status !== 1) throw new Error(`Worker ${name} role grant did not confirm: ${transaction.hash}`);
    }
    if (!(await djuke.hasRole(role, fulfiller))) throw new Error(`Worker ${name} role grant is not visible on chain`);
    result.workerRoles[name] = true;
    fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  }

  result.workerRolesConfirmed = true;
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
