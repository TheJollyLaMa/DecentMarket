const fs = require("node:fs");
const path = require("node:path");
const { ethers, network } = require("hardhat");

const OWNER = "0x807061DF657A7697c04045dA7d16D941861cAABc";
const SOURCE = "0x135Cbc573F87637158eb3186C87c584fb0B34CD9";
const SOURCE_QUEUE = "0xe54609f022A8D760417E7cc0Eea6360b6E1D11Bb";
const DJUKE = "0xf51D2F7892cF9D49e14DF4afDf227a59ee170A51";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ROUTER = "0x8ecca903e2a6Daa8CCbB933700e4F2C58C44A4B5";
const WORKER_MINIMUM = ethers.parseEther("0.001");
const SLUGS = ["dbusk-playback", "dbusk-top10", "dbusk-pinners", "dbusk-repo-dev"];
const output = path.join(__dirname, "../deployments/devert-v02-base.json");
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

async function assertDrained({ source, queue, token, now }) {
  const next = await source.nextCampaignId();
  if (next < 1n || next > 1025n) throw new Error("Source campaign scan needs explicit review");
  for (let id = 1n; id < next; id++) {
    const campaign = await source.getCampaign(id);
    if (campaign.expiresAt > BigInt(now)) throw new Error(`Legacy campaign ${id} still has a paid term`);
  }
  if (await queue.pendingCount() !== 0n || await token.balanceOf(queue.target) !== 0n ||
      await token.balanceOf(source.target) !== 0n) {
    throw new Error("Legacy campaigns and paid requests/refund reserves must drain before cutover");
  }
}

async function main() {
  if (Number((await ethers.provider.getNetwork()).chainId) !== 8453) throw new Error("Base or a Base fork is required");
  const live = process.env.CONFIRM_DEPLOY === "v0.2-base";
  const activate = process.env.CONFIRM_ACTIVATE === "v0.2-base";
  if ((live || activate) && network.name !== "base") throw new Error("Broadcasting requires the named Base network");
  if (live && activate) throw new Error("Deploy paused, configure the worker/site, then activate separately");
  const source = await ethers.getContractAt("DeVert_v0_1", SOURCE);
  const oldQueue = await ethers.getContractAt("DeVertQueue_v0_2", SOURCE_QUEUE);
  const token = await ethers.getContractAt("IERC20", USDC);
  const djuke = new ethers.Contract(DJUKE, [
    "function gasWorker() view returns(address)", "function CONTRACT_VERSION() view returns(string)",
  ], ethers.provider);
  const worker = await djuke.gasWorker();
  if (same(worker, OWNER) || worker === ethers.ZeroAddress || await djuke.CONTRACT_VERSION() !== "0.5") {
    throw new Error("The shared DJuke v0.5 worker must be separate from the owner");
  }
  if (!same(await oldQueue.campaigns(), SOURCE)) throw new Error("Unexpected legacy queue campaign source");
  await assertDrained({ source, queue: oldQueue, token, now: (await ethers.provider.getBlock("latest")).timestamp });
  if (await ethers.provider.getBalance(worker) < WORKER_MINIMUM) throw new Error("Shared worker needs a manual Base ETH top-up");
  const router = new ethers.Contract(ROUTER, [
    "function funds(bytes32) view returns(string metadataUri,bool active,bool exists)",
    "function approvedAssets(address) view returns(bool)", "function paused() view returns(bool)",
  ], ethers.provider);
  if (await router.paused() || !await router.approvedAssets(USDC)) throw new Error("Settlement router must accept native Base USDC");
  for (const slug of SLUGS) {
    const fund = await router.funds(ethers.id(slug));
    if (!fund.active || !fund.exists) throw new Error(`Unavailable settlement fund: ${slug}`);
  }
  if (!await source.hasRole(ethers.ZeroHash, OWNER) || !await oldQueue.hasRole(ethers.ZeroHash, OWNER)) {
    throw new Error("Owner must administer both legacy contracts");
  }
  const factory = await ethers.getContractFactory("DeVert_v0_2");
  const args = [USDC, ROUTER, DJUKE, ...SLUGS.map(ethers.id), OWNER, worker];
  const request = await factory.getDeployTransaction(...args);
  const gas = await ethers.provider.estimateGas({ ...request, from: OWNER });
  const fees = await ethers.provider.getFeeData();
  const fee = fees.maxFeePerGas ?? fees.gasPrice;
  if (!fee || fee <= 0n) throw new Error("Base deployment fee unavailable");
  const deploymentBudgetWei = (gas * 2n + 3_000_000n) * fee;
  console.log(JSON.stringify({ mode: activate ? "activate" : live ? "deploy-paused" : "dry-run",
    source: SOURCE, sourceQueue: SOURCE_QUEUE, worker, workerBalanceEth: ethers.formatEther(await ethers.provider.getBalance(worker)),
    campaignDeploymentGas: gas.toString(), campaignDeploymentMaxEth: ethers.formatEther(gas * fee),
    conservativeCutoverBudgetEth: ethers.formatEther(deploymentBudgetWei),
    workerContributionWei: "0", automaticTopUps: false, fundSharesBps: [4500, 4500, 800, 200] }, null, 2));
  if (!live && !activate) return;
  const [signer] = await ethers.getSigners();
  if (!signer || !same(signer.address, OWNER)) throw new Error("Authorized owner signer is required");
  if (await ethers.provider.getBalance(OWNER) < deploymentBudgetWei) throw new Error("Owner needs Base ETH for the deployment budget");
  if (await ethers.provider.getTransactionCount(OWNER, "pending") !== await ethers.provider.getTransactionCount(OWNER, "latest")) {
    throw new Error("Resolve pending owner transactions before deploying");
  }
  let manifest = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, "utf8")) : null;
  if (manifest && (manifest.version !== "0.2" || manifest.source !== SOURCE || manifest.sourceQueue !== SOURCE_QUEUE ||
      !same(manifest.worker, worker))) throw new Error("Deployment manifest identity mismatch");
  const write = () => {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(`${output}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
    fs.renameSync(`${output}.tmp`, output);
  };
  const transact = async (key, send) => {
    if (!manifest.transactions[key]) {
      const tx = await send();
      manifest.transactions[key] = tx.hash;
      write();
    }
    const receipt = await ethers.provider.waitForTransaction(manifest.transactions[key], 2, 120000);
    if (receipt?.status !== 1) throw new Error(`Transaction did not confirm: ${key}`);
    return receipt;
  };
  if (activate) {
    if (!manifest?.address || !manifest.queueAddress) throw new Error("Deploy paused contracts first");
    if (!await source.paused() || !await oldQueue.paused()) throw new Error("Legacy purchases must stay paused");
    const campaign = await ethers.getContractAt("DeVert_v0_2", manifest.address, signer);
    const queue = await ethers.getContractAt("DeVertQueue_v0_2", manifest.queueAddress, signer);
    if (await campaign.CONTRACT_VERSION() !== "0.2" || !same(await queue.campaigns(), campaign.target) ||
        !same(await campaign.schedulerWallet(), worker)) throw new Error("Replacement contract identity mismatch");
    const response = await fetch("https://decentbusking.onrender.com/api/devert", { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error("Deploy the worker before activation");
    const state = await response.json();
    if (!same(state.contractAddress || "", campaign.target) || state.version !== "0.2" || state.checkout?.available !== true) {
      throw new Error("Worker must report the replacement contract, funded scheduler and ready checkout before activation");
    }
    const queueResponse = await fetch("https://decentbusking.onrender.com/api/devert/queue", { signal: AbortSignal.timeout(30000) });
    if (!queueResponse.ok || !same((await queueResponse.json()).contractAddress || "", queue.target)) {
      throw new Error("Worker must report the replacement paid queue before activation");
    }
    if (await campaign.paused()) await transact("activateCampaigns", () => campaign.unpause());
    if (await queue.paused()) await transact("activateQueue", () => queue.setPaused(false));
    manifest.phase = "active";
    write();
    return;
  }
  manifest ||= { version: "0.2", source: SOURCE, sourceQueue: SOURCE_QUEUE, worker, admin: OWNER,
    constructorArguments: args, transactions: {}, phase: "prepared", createdAt: new Date().toISOString() };
  write();
  if (!await oldQueue.paused()) await transact("pauseLegacyQueue", () => oldQueue.connect(signer).setPaused(true));
  if (!await source.paused()) await transact("pauseLegacyCampaigns", () => source.connect(signer).pause());
  await assertDrained({ source, queue: oldQueue, token, now: (await ethers.provider.getBlock("latest")).timestamp });
  const deploy = async (key, contractFactory, constructorArguments) => {
    const receipt = await transact(key, () => contractFactory.connect(signer).deploy(...constructorArguments).then(contract => contract.deploymentTransaction()));
    if (!receipt.contractAddress) throw new Error(`Missing deployment address for ${key}`);
    return receipt;
  };
  const campaignReceipt = await deploy("campaignDeployment", factory, args);
  manifest.address = campaignReceipt.contractAddress;
  manifest.deploymentBlock = campaignReceipt.blockNumber;
  write();
  const queueFactory = await ethers.getContractFactory("DeVertQueue_v0_2");
  const queueArgs = [USDC, manifest.address, ROUTER, ...SLUGS.map(ethers.id), OWNER, worker];
  const queueReceipt = await deploy("queueDeployment", queueFactory, queueArgs);
  manifest.queueAddress = queueReceipt.contractAddress;
  manifest.queueDeploymentBlock = queueReceipt.blockNumber;
  manifest.queueConstructorArguments = queueArgs;
  const queue = await ethers.getContractAt("DeVertQueue_v0_2", manifest.queueAddress, signer);
  if (!await queue.paused()) await transact("pauseReplacementQueue", () => queue.setPaused(true));
  manifest.phase = "deployed-paused";
  write();
  console.log(JSON.stringify(manifest, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { assertDrained };
