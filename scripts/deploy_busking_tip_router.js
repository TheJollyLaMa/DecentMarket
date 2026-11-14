// Deploys DecentBuskingTipRouter: a stateless tip router with no owner, fee, pause or custody.
// Dry-run by default; a Base broadcast requires CONFIRM_DEPLOY=yes.
//   Local rehearsal (in-process chain, no keys):  npx hardhat run scripts/deploy_busking_tip_router.js
//   Base dry run (PRIVATE_KEY from .env):         npx hardhat run scripts/deploy_busking_tip_router.js --network base
//   Base mainnet:                                 CONFIRM_DEPLOY=yes npx hardhat run scripts/deploy_busking_tip_router.js --network base
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const RECORD = path.join(__dirname, "../deployments/busking-tip-router-base.json");
const SOURCE = path.join(__dirname, "../contracts/DecentBuskingTipRouter.sol");
const FQN = "contracts/DecentBuskingTipRouter.sol:DecentBuskingTipRouter";
const BASE_GAS_PRICE_ORACLE = "0x420000000000000000000000000000000000000F";
const PROBE_CONTEXT = "decentbusking:live:deployment-check";

function revertName(iface, error) {
  if (error.revert?.name) return error.revert.name;
  const data = [error.data, error.info?.error?.data, error.error?.data].find(v => typeof v === "string" && v.startsWith("0x"));
  try { if (data) return iface.parseError(data)?.name; } catch { /* fall through to the message */ }
  return /custom error '(\w+)\(/.exec(String(error.message))?.[1];
}

// Read-only checks on the deployed contract. eth_call simulations broadcast nothing and move no funds.
async function checkDeployment({ ethers, artifacts, router, address }) {
  const code = await ethers.provider.getCode(address);
  const artifact = await artifacts.readArtifact("DecentBuskingTipRouter");
  const probe = ethers.Wallet.createRandom().address;
  const simulate = (recipient, kind, context, value) => router.tip.staticCall(recipient, kind, context, { value });
  const cases = [
    ["a valid live tip simulates", () => simulate(probe, 0, PROBE_CONTEXT, 1n), null],
    ["an unknown source kind is rejected", () => simulate(probe, 3, PROBE_CONTEXT, 1n), "InvalidSourceKind"],
    ["a zero recipient is rejected", () => simulate(ethers.ZeroAddress, 0, PROBE_CONTEXT, 1n), "InvalidRecipient"],
    ["an empty context is rejected", () => simulate(probe, 0, "", 1n), "InvalidContext"],
    ["a zero amount is rejected", () => simulate(probe, 0, PROBE_CONTEXT, 0n), "InvalidAmount"],
  ];
  const simulations = [];
  for (const [name, call, expected] of cases) {
    try { await call(); simulations.push({ name, ok: expected === null }); }
    catch (error) { simulations.push({ name, ok: expected !== null && revertName(router.interface, error) === expected }); }
  }
  // The router has no immutables, so the deployed code must equal the compiled runtime code exactly.
  const codeMatchesCompiled = code.toLowerCase() === artifact.deployedBytecode.toLowerCase();
  return { ok: codeMatchesCompiled && simulations.every(s => s.ok), codeMatchesCompiled, runtimeCodeHash: ethers.keccak256(code), simulations };
}

// Base charges a separate L1 data fee that eth_estimateGas does not include.
async function estimateL1Fee(ethers, request, gas, maxFee, deployer) {
  try {
    const unsigned = ethers.Transaction.from({
      type: 2, chainId: 8453, nonce: await ethers.provider.getTransactionCount(deployer.address),
      to: null, data: request.data, gasLimit: gas, maxFeePerGas: maxFee, maxPriorityFeePerGas: 0n, value: 0n,
    }).unsignedSerialized;
    const oracle = new ethers.Contract(BASE_GAS_PRICE_ORACLE, ["function getL1Fee(bytes) view returns (uint256)"], ethers.provider);
    return await oracle.getL1Fee(unsigned);
  } catch { return null; }
}

async function main() {
  const { ethers, network, artifacts } = hre;
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const live = network.name === "base";
  if (live && chainId !== 8453) throw new Error(`Base (8453) required; got ${chainId}`);
  if (!live && !["hardhat", "localhost"].includes(network.name)) {
    throw new Error("Use --network base, or the default in-process hardhat network for a rehearsal");
  }
  if (live && fs.existsSync(RECORD) && process.env.ALLOW_REDEPLOY !== "yes") {
    const existing = JSON.parse(fs.readFileSync(RECORD, "utf8"));
    throw new Error(`A tip router is already recorded at ${existing.address}. Set ALLOW_REDEPLOY=yes only for an intended replacement; the ledger and app must then be repointed.`);
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("Set PRIVATE_KEY in .env (a funded Base wallet)");
  const factory = await ethers.getContractFactory("DecentBuskingTipRouter", deployer);
  const request = await factory.getDeployTransaction();
  const gas = await ethers.provider.estimateGas({ ...request, from: deployer.address });
  const fee = await ethers.provider.getFeeData();
  const maxFee = fee.maxFeePerGas ?? fee.gasPrice;
  const executionCost = gas * 120n / 100n * maxFee;
  const l1Fee = live ? await estimateL1Fee(ethers, request, gas, maxFee, deployer) : null;
  const totalCost = executionCost + (l1Fee ?? ethers.parseEther("0.0003"));
  const balance = await ethers.provider.getBalance(deployer.address);
  const confirmed = process.env.CONFIRM_DEPLOY === "yes";
  console.log(JSON.stringify({
    network: network.name, chainId, mode: live && !confirmed ? "dry-run" : "deploy",
    deployer: deployer.address, deployGas: String(gas), maxFeePerGasGwei: ethers.formatUnits(maxFee, "gwei"),
    executionCostEth: ethers.formatEther(executionCost),
    l1DataFeeEth: l1Fee === null ? "unavailable (a 0.0003 ETH reserve is assumed)" : ethers.formatEther(l1Fee),
    estimatedTotalCostEth: ethers.formatEther(totalCost), balanceEth: ethers.formatEther(balance),
  }, null, 2));
  if (balance < totalCost) throw new Error("Insufficient ETH for deployment gas");
  if (live && !confirmed) return console.log("Dry run only. Re-run with CONFIRM_DEPLOY=yes to broadcast.");

  const router = await factory.deploy();
  const tx = router.deploymentTransaction();
  const receipt = await tx.wait(live ? 2 : 1);
  if (receipt.status !== 1) throw new Error(`Deployment failed: ${tx.hash}`);
  const address = await router.getAddress();

  // Save the deployment before any check, so a failing check can never lose the address or start block.
  const buildInfo = await artifacts.getBuildInfo(FQN);
  const settings = buildInfo?.input?.settings ?? {};
  const record = {
    contract: "DecentBuskingTipRouter", chainId, address, transactionHash: tx.hash, startBlock: receipt.blockNumber,
    deployer: deployer.address, deployedAt: new Date().toISOString(),
    compiler: { solc: buildInfo?.solcLongVersion ?? "0.8.26", optimizerRuns: settings.optimizer?.runs, evmVersion: settings.evmVersion, viaIR: Boolean(settings.viaIR) },
    sourceSha256: crypto.createHash("sha256").update(fs.readFileSync(SOURCE)).digest("hex"),
    interface: { tip: "tip(address,uint8,string)", event: "TipSent(address,address,bytes32,uint8,uint256,string)" },
  };
  const save = () => live && fs.writeFileSync(RECORD, JSON.stringify(record, null, 2) + "\n");
  save();
  console.log(`Deployed ${address} in block ${receipt.blockNumber} (tx ${tx.hash})`);
  if (live) console.log(`Worker env: TIP_ROUTER_ADDRESS=${address} TIP_START_BLOCK=${receipt.blockNumber}`);

  try {
    record.checks = await checkDeployment({ ethers, artifacts, router, address });
  } catch (error) {
    record.checks = { ok: false, error: String(error.message ?? error) };
  }
  save();
  console.log(JSON.stringify(record, null, 2));
  if (!record.checks.ok) {
    process.exitCode = 1;
    console.error("WARNING: a post-deploy check failed. The deployment itself is recorded; review the checks above before using this router.");
  } else if (live) {
    console.log(`Wrote ${RECORD}\nNext: verify the source on Basescan, then follow the release order in docs/LIVE_PERFORMANCE_RUNBOOK.md before setting the public tipRouterAddress.`);
  }
  return { router, deployer, record };
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
