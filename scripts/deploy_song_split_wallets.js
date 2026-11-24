// Deploys DecentSongSplitWalletFactory v0.1: one deterministic wallet per exact song split, so payers that can
// only pay one address (the DMTv escrow) pay the split. Anyone can push a wallet's balance to its owners; the
// factory owner (SPLIT_WALLET_OWNER, default the deployer) can recover stuck assets (prototype recovery rule).
// Dry-run by default; a Base broadcast requires CONFIRM_DEPLOY=yes.
//   Local rehearsal (in-process chain, no keys):  npx hardhat run scripts/deploy_song_split_wallets.js
//   Base dry run (PRIVATE_KEY from .env):         npx hardhat run scripts/deploy_song_split_wallets.js --network base
//   Base mainnet:                                 CONFIRM_DEPLOY=yes npx hardhat run scripts/deploy_song_split_wallets.js --network base
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const NAME = "DecentSongSplitWalletFactory_v0_1";
const RECORD = path.join(__dirname, "../deployments/song-split-wallets-v01-base.json");
const SOURCE = path.join(__dirname, "../contracts/DecentSongSplitWallets_v0.1.sol");
const FQN = `contracts/DecentSongSplitWallets_v0.1.sol:${NAME}`;
const BASE_GAS_PRICE_ORACLE = "0x420000000000000000000000000000000000000F";

function cloneInitCodeHash(ethers, implementation) {
  return ethers.keccak256(`0x3d602d80600a3d3981f3363d3d373d3d3d363d73${implementation.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3`);
}

// Read-only checks on the deployed factory. eth_call simulations broadcast nothing and move no funds.
async function checkDeployment({ ethers, artifacts, factory, address, owner }) {
  const code = await ethers.provider.getCode(address);
  const artifact = await artifacts.readArtifact(NAME);
  const implementation = await factory.implementation();
  const walletArtifact = await artifacts.readArtifact("DecentSongSplitWallet_v0_1");
  const wallet = await ethers.getContractAt("DecentSongSplitWallet_v0_1", implementation);
  const [a, b] = [ethers.Wallet.createRandom().address, ethers.Wallet.createRandom().address];
  const salt = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address[]", "uint16[]"], [[a, b], [5000, 5000]]));
  const predicted = ethers.getCreate2Address(address, salt, cloneInitCodeHash(ethers, implementation));
  const rejects = async call => { try { await call(); return false; } catch { return true; } };
  const state = {
    ownerMatches: (await factory.owner()).toLowerCase() === owner.toLowerCase(),
    implementationLocked: (await wallet.factory()).toLowerCase() === address.toLowerCase(),
    implementationCodeMatches: (await ethers.provider.getCode(implementation)) === walletArtifact.deployedBytecode,
    offChainPredictionMatches: (await factory.walletFor([a, b], [5000, 5000])) === predicted,
    createSimulates: (await factory.createWallet.staticCall([a, b], [5000, 5000])) === predicted,
    invalidSplitRejected: await rejects(() => factory.walletFor([a, b], [5000, 4999])),
  };
  // The immutable implementation address is written into runtime code at deploy; the artifact holds zeros there.
  const immutableWord = implementation.slice(2).toLowerCase().padStart(64, "0");
  const codeMatchesCompiled = code.toLowerCase().split(immutableWord).join("0".repeat(64)) === artifact.deployedBytecode.toLowerCase();
  return { ok: codeMatchesCompiled && Object.values(state).every(Boolean), codeMatchesCompiled, implementation, ...state,
    runtimeCodeHash: ethers.keccak256(code) };
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
    throw new Error(`A split wallet factory is already recorded at ${existing.address}. Set ALLOW_REDEPLOY=yes only for an intended replacement; every wallet address changes with it.`);
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("Set PRIVATE_KEY in .env (a funded Base wallet)");
  const owner = process.env.SPLIT_WALLET_OWNER || deployer.address;
  if (!ethers.isAddress(owner) || owner === ethers.ZeroAddress) throw new Error(`Invalid SPLIT_WALLET_OWNER ${owner}`);
  const contractFactory = await ethers.getContractFactory(NAME, deployer);
  const request = await contractFactory.getDeployTransaction(owner);
  const gas = await ethers.provider.estimateGas({ ...request, from: deployer.address });
  const fee = await ethers.provider.getFeeData();
  const maxFee = fee.maxFeePerGas ?? fee.gasPrice;
  const executionCost = gas * 120n / 100n * maxFee;
  const l1Fee = live ? await estimateL1Fee(ethers, request, gas, maxFee, deployer) : null;
  const totalCost = executionCost + (l1Fee ?? ethers.parseEther("0.0003"));
  const balance = await ethers.provider.getBalance(deployer.address);
  const confirmed = process.env.CONFIRM_DEPLOY === "yes";
  console.log(JSON.stringify({
    network: network.name, chainId, mode: live && !confirmed ? "dry-run" : "deploy", deployer: deployer.address, owner,
    deployGas: String(gas), maxFeePerGasGwei: ethers.formatUnits(maxFee, "gwei"), executionCostEth: ethers.formatEther(executionCost),
    l1DataFeeEth: l1Fee === null ? "unavailable (a 0.0003 ETH reserve is assumed)" : ethers.formatEther(l1Fee),
    estimatedTotalCostEth: ethers.formatEther(totalCost), balanceEth: ethers.formatEther(balance),
  }, null, 2));
  if (balance < totalCost) throw new Error("Insufficient ETH for deployment gas");
  if (live && !confirmed) return console.log("Dry run only. Re-run with CONFIRM_DEPLOY=yes to broadcast.");

  const factory = await contractFactory.deploy(owner);
  const tx = factory.deploymentTransaction();
  const receipt = await tx.wait(live ? 2 : 1);
  if (receipt.status !== 1) throw new Error(`Deployment failed: ${tx.hash}`);
  const address = await factory.getAddress();

  // Save the deployment before any check, so a failing check can never lose the address or start block.
  const buildInfo = await artifacts.getBuildInfo(FQN);
  const settings = buildInfo?.input?.settings ?? {};
  const record = {
    contract: NAME, version: "v0.1", chainId, address, implementation: await factory.implementation(),
    transactionHash: tx.hash, startBlock: receipt.blockNumber, deployer: deployer.address, owner, deployedAt: new Date().toISOString(),
    compiler: { solc: buildInfo?.solcLongVersion ?? "0.8.26", optimizerRuns: settings.optimizer?.runs, evmVersion: settings.evmVersion, viaIR: Boolean(settings.viaIR) },
    sourceSha256: crypto.createHash("sha256").update(fs.readFileSync(SOURCE)).digest("hex"),
    interface: {
      walletFor: "walletFor(address[],uint16[])", createWallet: "createWallet(address[],uint16[])",
      distribute: "distribute(address)", recover: "recover(address,address,uint256)",
      event: "WalletCreated(address,address[],uint16[])", paid: "Paid(address,address,uint256)",
    },
  };
  const save = () => live && fs.writeFileSync(RECORD, JSON.stringify(record, null, 2) + "\n");
  save();
  console.log(`Deployed ${address} in block ${receipt.blockNumber} (tx ${tx.hash})`);

  try {
    record.checks = await checkDeployment({ ethers, artifacts, factory, address, owner });
  } catch (error) {
    record.checks = { ok: false, error: String(error.message ?? error) };
  }
  save();
  console.log(JSON.stringify(record, null, 2));
  if (!record.checks.ok) {
    process.exitCode = 1;
    console.error("WARNING: a post-deploy check failed. The deployment itself is recorded; review the checks above before using this factory.");
  } else if (live) {
    console.log(`Wrote ${RECORD}\nSite config: songSplitWalletFactory=${address} songSplitWalletImplementation=${record.implementation}`);
  }
  return { factory, deployer, record };
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
