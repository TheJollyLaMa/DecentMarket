// Deploys DecentBuskingTipRouter. v0.1 is stateless with no owner, fee, pause or custody.
// TIP_ROUTER_VERSION=v0.2 deploys the v0.2 router (split ETH, allowlisted ERC-20 tips, NFT gifts) with its own record.
// v0.2 has an admin owner (TIP_ROUTER_OWNER, default the deployer) for the token allowlist only (no recovery or withdrawal);
// it launches with Base USDC allowed. Tips and gifts still move straight from the tipper to the owners; the router holds nothing.
// Dry-run by default; a Base broadcast requires CONFIRM_DEPLOY=yes.
//   Local rehearsal (in-process chain, no keys):  npx hardhat run scripts/deploy_busking_tip_router.js
//   Base dry run (PRIVATE_KEY from .env):         npx hardhat run scripts/deploy_busking_tip_router.js --network base
//   Base mainnet:                                 CONFIRM_DEPLOY=yes npx hardhat run scripts/deploy_busking_tip_router.js --network base
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const VERSIONS = {
  "v0.1": { record: "busking-tip-router-base.json", source: "DecentBuskingTipRouter.sol", name: "DecentBuskingTipRouter",
    interface: { tip: "tip(address,uint8,string)" } },
  "v0.2": { record: "busking-tip-router-v02-base.json", source: "DecentBuskingTipRouter_v0.2.sol", name: "DecentBuskingTipRouter_v0_2",
    owned: true,
    interface: {
      tip: "tip(address,uint8,string)", tipSplit: "tipSplit(address[],uint16[],uint8,string)",
      tipToken: "tipToken(address,address,uint256,uint8,string)",
      tipTokenSplit: "tipTokenSplit(address,address[],uint16[],uint256,uint8,string)",
      giftNfts: "giftNfts((address,uint8,uint256,uint256,address)[],uint8,string)",
      tokenEvent: "TokenTipSent(address,address,bytes32,address,uint8,uint256,string)",
      nftEvent: "NftGiftSent(address,address,bytes32,address,uint8,uint256,uint256,uint8,string)",
    } },
};
const VERSION = process.env.TIP_ROUTER_VERSION || "v0.1";
const TARGET = VERSIONS[VERSION];
if (!TARGET) throw new Error(`Unknown TIP_ROUTER_VERSION ${VERSION}`);
const RECORD = path.join(__dirname, "../deployments", TARGET.record);
const SOURCE = path.join(__dirname, "../contracts", TARGET.source);
const FQN = `contracts/${TARGET.source}:${TARGET.name}`;
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_GAS_PRICE_ORACLE = "0x420000000000000000000000000000000000000F";
const PROBE_CONTEXT = "decentbusking:live:deployment-check";

function revertName(iface, error) {
  if (error.revert?.name) return error.revert.name;
  const data = [error.data, error.info?.error?.data, error.error?.data].find(v => typeof v === "string" && v.startsWith("0x"));
  try { if (data) return iface.parseError(data)?.name; } catch { /* fall through to the message */ }
  return /custom error '(\w+)\(/.exec(String(error.message))?.[1];
}

// Read-only checks on the deployed contract. eth_call simulations broadcast nothing and move no funds.
async function checkDeployment({ ethers, artifacts, router, address, owner, tokens }) {
  const code = await ethers.provider.getCode(address);
  const artifact = await artifacts.readArtifact(TARGET.name);
  const probe = ethers.Wallet.createRandom().address;
  const simulate = (recipient, kind, context, value) => router.tip.staticCall(recipient, kind, context, { value });
  const cases = [
    ["a valid live tip simulates", () => simulate(probe, 0, PROBE_CONTEXT, 1n), null],
    ["an unknown source kind is rejected", () => simulate(probe, 3, PROBE_CONTEXT, 1n), "InvalidSourceKind"],
    ["a zero recipient is rejected", () => simulate(ethers.ZeroAddress, 0, PROBE_CONTEXT, 1n), "InvalidRecipient"],
    ["an empty context is rejected", () => simulate(probe, 0, "", 1n), "InvalidContext"],
    ["a zero amount is rejected", () => simulate(probe, 0, PROBE_CONTEXT, 0n), "InvalidAmount"],
  ];
  if (TARGET.interface.tipSplit) {
    const second = ethers.Wallet.createRandom().address;
    const split = (recipients, shares, value) => router.tipSplit.staticCall(recipients, shares, 1, PROBE_CONTEXT, { value });
    cases.push(
      ["a valid 50/50 split tip simulates", () => split([probe, second], [5000, 5000], 2n), null],
      ["shares not totalling 10000 are rejected", () => split([probe, second], [5000, 4999], 2n), "InvalidSplit"],
      ["a duplicate co-owner is rejected", () => split([probe, probe], [5000, 5000], 2n), "InvalidSplit"],
      ["a split too small to pay everyone is rejected", () => split([probe, second], [9999, 1], 1n), "InvalidAmount"],
    );
  }
  if (TARGET.interface.tipToken) {
    const unlisted = ethers.Wallet.createRandom().address;
    cases.push(
      ["an unlisted token tip is rejected", () => router.tipToken.staticCall(unlisted, probe, 1n, 1, PROBE_CONTEXT), "TokenNotAllowed"],
      ["an empty NFT gift batch is rejected", () => router.giftNfts.staticCall([], 1, PROBE_CONTEXT), "InvalidGift"],
    );
  }
  const simulations = [];
  for (const [name, call, expected] of cases) {
    try { await call(); simulations.push({ name, ok: expected === null }); }
    catch (error) { simulations.push({ name, ok: expected !== null && revertName(router.interface, error) === expected }); }
  }
  // The router has no immutables, so the deployed code must equal the compiled runtime code exactly.
  const codeMatchesCompiled = code.toLowerCase() === artifact.deployedBytecode.toLowerCase();
  const state = {};
  if (TARGET.owned) {
    state.ownerMatches = (await router.owner()).toLowerCase() === owner.toLowerCase();
    state.tokensAllowed = (await Promise.all(tokens.map(token => router.allowedTokens(token)))).every(Boolean);
  }
  const stateOk = Object.values(state).every(Boolean);
  return { ok: codeMatchesCompiled && stateOk && simulations.every(s => s.ok), codeMatchesCompiled, ...state, runtimeCodeHash: ethers.keccak256(code), simulations };
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
  const factory = await ethers.getContractFactory(TARGET.name, deployer);
  let args = [], owner = null, tokens = [];
  if (TARGET.owned) {
    owner = process.env.TIP_ROUTER_OWNER || deployer.address;
    if (!ethers.isAddress(owner) || owner === ethers.ZeroAddress) throw new Error(`Invalid TIP_ROUTER_OWNER ${owner}`);
    // A rehearsal chain has no USDC, so it stands up a 6-decimal stand-in; Base always uses native USDC.
    const usdc = live ? BASE_USDC : await (await (await ethers.getContractFactory("MockBookingToken", deployer)).deploy(6)).getAddress();
    if ((await ethers.provider.getCode(usdc)) === "0x") throw new Error(`No token contract at ${usdc}`);
    tokens = [usdc];
    args = [owner, tokens];
  }
  const request = await factory.getDeployTransaction(...args);
  const gas = await ethers.provider.estimateGas({ ...request, from: deployer.address });
  const fee = await ethers.provider.getFeeData();
  const maxFee = fee.maxFeePerGas ?? fee.gasPrice;
  const executionCost = gas * 120n / 100n * maxFee;
  const l1Fee = live ? await estimateL1Fee(ethers, request, gas, maxFee, deployer) : null;
  const totalCost = executionCost + (l1Fee ?? ethers.parseEther("0.0003"));
  const balance = await ethers.provider.getBalance(deployer.address);
  const confirmed = process.env.CONFIRM_DEPLOY === "yes";
  console.log(JSON.stringify({
    version: VERSION, network: network.name, chainId, mode: live && !confirmed ? "dry-run" : "deploy",
    deployer: deployer.address, ...(owner ? { owner, allowedTokens: tokens } : {}), deployGas: String(gas), maxFeePerGasGwei: ethers.formatUnits(maxFee, "gwei"),
    executionCostEth: ethers.formatEther(executionCost),
    l1DataFeeEth: l1Fee === null ? "unavailable (a 0.0003 ETH reserve is assumed)" : ethers.formatEther(l1Fee),
    estimatedTotalCostEth: ethers.formatEther(totalCost), balanceEth: ethers.formatEther(balance),
  }, null, 2));
  if (balance < totalCost) throw new Error("Insufficient ETH for deployment gas");
  if (live && !confirmed) return console.log("Dry run only. Re-run with CONFIRM_DEPLOY=yes to broadcast.");

  const router = await factory.deploy(...args);
  const tx = router.deploymentTransaction();
  const receipt = await tx.wait(live ? 2 : 1);
  if (receipt.status !== 1) throw new Error(`Deployment failed: ${tx.hash}`);
  const address = await router.getAddress();

  // Save the deployment before any check, so a failing check can never lose the address or start block.
  const buildInfo = await artifacts.getBuildInfo(FQN);
  const settings = buildInfo?.input?.settings ?? {};
  const record = {
    contract: TARGET.name, version: VERSION, chainId, address, transactionHash: tx.hash, startBlock: receipt.blockNumber,
    deployer: deployer.address, ...(owner ? { owner, allowedTokens: tokens } : {}), deployedAt: new Date().toISOString(),
    compiler: { solc: buildInfo?.solcLongVersion ?? "0.8.26", optimizerRuns: settings.optimizer?.runs, evmVersion: settings.evmVersion, viaIR: Boolean(settings.viaIR) },
    sourceSha256: crypto.createHash("sha256").update(fs.readFileSync(SOURCE)).digest("hex"),
    interface: { ...TARGET.interface, event: "TipSent(address,address,bytes32,uint8,uint256,string)" },
  };
  const save = () => live && fs.writeFileSync(RECORD, JSON.stringify(record, null, 2) + "\n");
  save();
  console.log(`Deployed ${address} in block ${receipt.blockNumber} (tx ${tx.hash})`);
  if (live) {
    const prefix = VERSION === "v0.2" ? "TIP_SPLIT" : "TIP";
    console.log(`Worker env: ${prefix}_ROUTER_ADDRESS=${address} ${prefix}_START_BLOCK=${receipt.blockNumber}`);
  }

  try {
    record.checks = await checkDeployment({ ethers, artifacts, router, address, owner, tokens });
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
