// Dry-run by default. Broadcasting requires Base plus CONFIRM_DEPLOY=yes.
const fs = require("node:fs");
const path = require("node:path");
const { ethers, network, artifacts } = require("hardhat");

async function main() {
  const token = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const campaigns = "0x135Cbc573F87637158eb3186C87c584fb0B34CD9";
  const routerAddress = "0x8ecca903e2a6Daa8CCbB933700e4F2C58C44A4B5";
  const slugs = ["dbusk-playback", "dbusk-top10", "dbusk-pinners", "dbusk-repo-dev"];
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== 8453) throw new Error("Base or a Base fork (chain 8453) is required");
  if (!ethers.isAddress(process.env.DBUSK_ADMIN || "")) throw new Error("Set DBUSK_ADMIN to the intended admin address");
  const admin = ethers.getAddress(process.env.DBUSK_ADMIN);
  if (admin === ethers.ZeroAddress) throw new Error("An admin address is required");
  const worker = process.env.DBUSK_FULFILLER;
  if (!ethers.isAddress(worker || "") || worker === ethers.ZeroAddress || worker.toLowerCase() === admin.toLowerCase()) {
    throw new Error("Set DBUSK_FULFILLER to the separate radio worker wallet");
  }
  for (const address of [token, campaigns, routerAddress]) {
    if (await ethers.provider.getCode(address) === "0x") throw new Error(`Missing Base contract: ${address}`);
  }
  const campaignSource = new ethers.Contract(campaigns, [
    "function getCampaign(uint256) view returns((address advertiser,string title,string audioURI,uint64 startedAt,uint64 expiresAt,uint64 weekId,uint128 offerUnits,uint128 paidUnits,uint32 djukeBoosts,uint32 mainRadioPlays,uint32 devertPlays))",
  ], ethers.provider);
  const sample = await campaignSource.getCampaign(1);
  if (sample.advertiser === ethers.ZeroAddress || !sample.audioURI.startsWith("ipfs://")) {
    throw new Error("The deployed campaign ABI did not decode the known first campaign");
  }
  const router = new ethers.Contract(routerAddress, [
    "function funds(bytes32) view returns(string metadataUri,bool active,bool exists)",
    "function approvedAssets(address) view returns(bool)",
    "function paused() view returns(bool)",
  ], ethers.provider);
  if (await router.paused() || !await router.approvedAssets(token)) throw new Error("Router must accept native Base USDC");
  for (const slug of slugs) {
    const fund = await router.funds(ethers.id(slug));
    if (!fund.exists || !fund.active) throw new Error(`Fund must exist and be active: ${slug}`);
  }
  const args = [token, campaigns, routerAddress, ...slugs.map(ethers.id), admin, worker];
  const artifact = await artifacts.readArtifact("DeVertQueue_v0_1");
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, ethers.provider);
  const deployment = await factory.getDeployTransaction(...args);
  const output = path.join(__dirname, "../deployments/devert-queue-base.json");
  if (fs.existsSync(output)) throw new Error("A deployment record already exists; review it before deploying again");
  const gas = await ethers.provider.estimateGas({ ...deployment, from: admin });
  const fees = await ethers.provider.getFeeData();
  const gasPrice = fees.maxFeePerGas || fees.gasPrice;
  if (!gasPrice) throw new Error("Deployment fee estimate is unavailable");
  const estimatedMaxCost = gas * gasPrice;
  const balance = await ethers.provider.getBalance(admin);
  if (balance < estimatedMaxCost) throw new Error("Admin has insufficient Base ETH for the estimated deployment");
  console.log(JSON.stringify({ network: network.name, chainId, admin, worker, token, campaigns,
    router: routerAddress, funds: slugs, gas: gas.toString(),
    estimatedMaxCostEth: ethers.formatEther(estimatedMaxCost), constructorArguments: args }, null, 2));
  if (process.env.CONFIRM_DEPLOY !== "yes") {
    console.log("Dry-run only. No transaction sent. Review and authorize deployment separately.");
    return;
  }
  if (network.name !== "base") throw new Error("Broadcasting is restricted to the named Base network");
  const [signer] = await ethers.getSigners();
  if (!signer || signer.address.toLowerCase() !== admin.toLowerCase()) throw new Error("The signer must match DBUSK_ADMIN");
  const contract = await factory.connect(signer).deploy(...args);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const pending = { chainId, address: contract.target, transactionHash: contract.deploymentTransaction().hash,
    constructorArguments: args, status: "pending", submittedAt: new Date().toISOString() };
  fs.writeFileSync(output, JSON.stringify(pending, null, 2) + "\n", { flag: "wx" });
  console.log(`Deployment submitted: ${pending.transactionHash}`);
  await contract.waitForDeployment();
  const receipt = await contract.deploymentTransaction().wait(2);
  const result = { chainId, address: contract.target, transactionHash: receipt.hash,
    deploymentBlock: receipt.blockNumber, constructorArguments: args, deployedAt: new Date().toISOString() };
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
