const fs = require("fs");
const path = require("path");
const ethers = require("ethers");
const dotenv = require("dotenv");

const OLD_ADDRESS = "0x153ef59a57C9A88cbB7822252B5d9D0B11E48F0E";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ROUTER = "0x8ecca903e2a6Daa8CCbB933700e4F2C58C44A4B5";
const OWNER = "0x807061DF657A7697c04045dA7d16D941861cAABc";
const WORKER = "0x4894698f2B5cAF13Fad4Aa8fbaFE3618b960909F";
const OLD_ABI = ["function getSong(bytes32) view returns((string audioURI,bool enabled,address[] recipients,uint16[] sharesBps))",
  "function pendingCount() view returns(uint256)", "function paused() view returns(bool)", "function pauseRequests()",
  "function hasRole(bytes32,address) view returns(bool)"];

class MigrationProvider extends ethers.JsonRpcProvider {
  constructor(url) {
    super(url, 8453, { staticNetwork: true, batchMaxCount: 1 });
    this.requestQueue = Promise.resolve();
    this.nextRequestAt = 0;
  }

  _send(payload) {
    const result = this.requestQueue.then(async () => {
      const delay = this.nextRequestAt - Date.now();
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      this.nextRequestAt = Date.now() + 100;
      return super._send(payload);
    });
    this.requestQueue = result.catch(() => {});
    return result;
  }
}

function validateCatalog(songs) {
  if (!Array.isArray(songs) || !songs.length || songs.length > 5000) throw new Error("Invalid catalog size");
  const identities = new Set();
  for (const song of songs) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(song.songId || "") || identities.has(song.songId) || !song.audioURI?.startsWith("ipfs://")) throw new Error("Invalid or duplicate song identity");
    identities.add(song.songId);
    if (!song.recipients.length || song.recipients.length > 16 || song.recipients.length !== song.sharesBps.length ||
        song.recipients.some(recipient => !ethers.isAddress(recipient) || recipient === ethers.ZeroAddress) ||
        new Set(song.recipients.map(recipient => recipient.toLowerCase())).size !== song.recipients.length ||
        song.sharesBps.some(share => !Number.isInteger(share) || share <= 0) || song.sharesBps.reduce((sum, share) => sum + share, 0) !== 10000) throw new Error("Invalid migration split");
  }
  return ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(songs)));
}

async function retryRead(operation) {
  let error;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await operation(); } catch (caught) { error = caught; }
  }
  throw error;
}

async function main() {
  if (!process.env.DBUSK_ENV_FILE) throw new Error("Set DBUSK_ENV_FILE to the local ignored environment file");
  dotenv.config({ path: process.env.DBUSK_ENV_FILE, override: true, quiet: true });
  const provider = new MigrationProvider(process.env.DJUKE_DEPLOY_RPC_URL || process.env.BASE_RPC_URL || "https://mainnet.base.org");
  try {
    if (Number((await provider.getNetwork()).chainId) !== 8453) throw new Error("Base-only deployment");
    const signer = new ethers.Wallet(process.env.MINT_OWNER_PRIVATE_KEY, provider);
    if (signer.address.toLowerCase() !== OWNER.toLowerCase()) throw new Error("Deployer is not the reviewed owner");
    const old = new ethers.Contract(OLD_ADDRESS, OLD_ABI, signer);
    if (!await old.hasRole(ethers.ZeroHash, signer.address)) throw new Error("Owner does not administer old DJuke");
    if (await old.pendingCount() !== 0n) throw new Error("Old paid queue must be empty; do not migrate pending requests");
    const router = new ethers.Contract(ROUTER, ["function funds(bytes32) view returns(string metadataUri,bool active,bool exists)",
      "function approvedAssets(address) view returns(bool)", "function paused() view returns(bool)"], provider);
    for (const slug of ["dbusk-repo-dev", "dbusk-pinners"]) {
      const fund = await router.funds(ethers.id(slug));
      if (!fund.active || !fund.exists) throw new Error(`Inactive router fund ${slug}`);
    }
    if (!await router.approvedAssets(USDC) || await router.paused()) throw new Error("Settlement router is unavailable");
    const response = await fetch("https://decentbusking.onrender.com/api/djuke", { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Catalog source unavailable (${response.status})`);
    const snapshot = await response.json();
    if (snapshot.contractAddress?.toLowerCase() !== OLD_ADDRESS.toLowerCase() || snapshot.paymentsEnabled !== false ||
        snapshot.requests?.length !== 0 || snapshot.catalogReadErrors !== 0 || !snapshot.tracks?.length) throw new Error("Migration needs a complete read-only source catalog");
    const blockTag = await provider.getBlockNumber() - 2;
    const before = await provider.getBlock(blockTag);
    const songs = [];
    for (const track of snapshot.tracks) {
      const song = await retryRead(() => old.getSong(track.songId, { blockTag }));
      if (!song.enabled || song.audioURI !== `ipfs://${track.ipfsCid}`) throw new Error("Catalog recording differs from chain");
      songs.push({ songId: track.songId, audioURI: song.audioURI, recipients: [...song.recipients], sharesBps: song.sharesBps.map(Number) });
    }
    songs.sort((first, second) => first.songId.localeCompare(second.songId));
    const catalogHash = validateCatalog(songs);
    if ((await provider.getBlock(blockTag)).hash !== before.hash) throw new Error("Source block changed");
    const artifact = require("../artifacts/contracts/DecentJukeBox_v0.2.sol/DecentJukeBox_v0_2.json");
    if ((artifact.deployedBytecode.length - 2) / 2 > 24576) throw new Error("Contract exceeds deployment size limit");
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
    const cap = ethers.parseEther("0.001");
    const args = [USDC, ROUTER, ethers.id("dbusk-repo-dev"), ethers.id("dbusk-pinners"), OWNER, WORKER, cap];
    const deployRequest = await factory.getDeployTransaction(...args);
    const deployGas = await provider.estimateGas({ ...deployRequest, from: signer.address });
    const fee = await provider.getFeeData();
    const executionBudget = (deployGas * 120n / 100n + BigInt(Math.ceil(songs.length / 25)) * 7500000n + 300000n) * fee.maxFeePerGas;
    const balance = await provider.getBalance(signer.address);
    const budget = executionBudget + ethers.parseEther("0.0002");
    console.log(JSON.stringify({ mode: process.env.CONFIRM_DEPLOY === "yes" ? "live" : "dry-run", source: OLD_ADDRESS,
      songs: songs.length, catalogHash, sourceBlock: blockTag, gasContributionCapEth: ethers.formatEther(cap),
      deployGas: String(deployGas), estimatedBudgetEth: ethers.formatEther(budget), ownerBalanceEth: ethers.formatEther(balance) }));
    if (balance < budget) throw new Error("Insufficient deployment/migration budget");
    if (process.env.CONFIRM_DEPLOY !== "yes") return;
    const output = path.join(__dirname, "../deployments/djuke-v02-base.json");
    let manifest = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, "utf8")) : null;
    if (manifest && (manifest.catalogHash !== catalogHash || manifest.admin !== OWNER || manifest.source !== OLD_ADDRESS)) throw new Error("Existing migration manifest mismatch");
    const write = () => { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n"); };
    const confirmed = async (transaction, label) => {
      const receipt = await transaction.wait(2);
      if (receipt?.status !== 1) throw new Error(`${label} did not confirm: ${transaction.hash}`);
      return receipt;
    };
    if (!await old.paused()) {
      const paused = await old.pauseRequests();
      await confirmed(paused, "Old queue pause");
    }
    if (await old.pendingCount() !== 0n) throw new Error("A request entered before pause; settle it before migrating");
    if (!manifest) {
      const nonce = await provider.getTransactionCount(signer.address, "pending");
      if (nonce !== await provider.getTransactionCount(signer.address, "latest")) throw new Error("Owner has pending transactions");
      manifest = { source: OLD_ADDRESS, address: ethers.getCreateAddress({ from: signer.address, nonce }), chainId: 8453,
        admin: OWNER, worker: WORKER, gasContributionCapWei: String(cap), catalogHash, songs: songs.length,
        sourceBlock: blockTag, phase: "deployment-prepared", transactions: [], createdAt: new Date().toISOString() };
      write();
      const contract = await factory.deploy(...args, { nonce, gasLimit: deployGas * 120n / 100n });
      const transaction = contract.deploymentTransaction();
      manifest.deploymentTx = transaction.hash;
      write();
      const receipt = await confirmed(transaction, "DJuke deployment");
      manifest.deploymentBlock = receipt.blockNumber;
      manifest.phase = "deployed";
      write();
    }
    if (await provider.getCode(manifest.address) === "0x") throw new Error("Recorded deployment not visible; resolve it without redeploying");
    for (const record of [{ hash: manifest.deploymentTx, kind: "deployment" }, ...manifest.transactions]) {
      if (!record.hash) throw new Error("Recorded deployment hash missing; resolve it without redeploying");
      const receipt = await retryRead(() => provider.getTransactionReceipt(record.hash));
      if (receipt?.status !== 1 || await receipt.confirmations() < 2) throw new Error(`Recorded ${record.kind} transaction is not confirmed; no new transactions sent`);
      if (record.kind === "deployment") {
        if (receipt.contractAddress?.toLowerCase() !== manifest.address.toLowerCase()) throw new Error("Recorded deployment address mismatch");
        manifest.deploymentBlock = receipt.blockNumber;
      }
    }
    manifest.phase = "deployed";
    write();
    const contract = new ethers.Contract(manifest.address, artifact.abi, signer);
    if ((await contract.gasWorker()).toLowerCase() !== WORKER.toLowerCase() || await contract.maxGasContributionWei() !== cap ||
        (await contract.paymentToken()).toLowerCase() !== USDC.toLowerCase() || (await contract.fundRouter()).toLowerCase() !== ROUTER.toLowerCase()) throw new Error("Deployment configuration mismatch");
    if (!await contract.paused()) {
      const transaction = await contract.pauseRequests();
      manifest.transactions.push({ kind: "pause-new", hash: transaction.hash }); write();
      await confirmed(transaction, "New queue pause");
    }
    for (const roleName of ["REGISTRAR_ROLE", "FULFILLER_ROLE"]) {
      const role = ethers.id(roleName);
      if (!await contract.hasRole(role, WORKER)) {
        const transaction = await contract.grantRole(role, WORKER);
        manifest.transactions.push({ kind: roleName, hash: transaction.hash }); write();
        await confirmed(transaction, roleName);
      }
    }
    for (let start = 0; start < songs.length; start += 25) {
      const missing = [];
      for (const song of songs.slice(start, start + 25)) {
        const current = await retryRead(() => contract.getSong(song.songId));
        if (!current.audioURI) missing.push(song);
        else if (current.audioURI !== song.audioURI || JSON.stringify([...current.recipients].map(value => value.toLowerCase())) !==
          JSON.stringify(song.recipients.map(value => value.toLowerCase())) || JSON.stringify(current.sharesBps.map(Number)) !== JSON.stringify(song.sharesBps)) throw new Error("Existing new-catalog entry differs; stop migration");
      }
      if (!missing.length) continue;
      const calls = missing.map(song => contract.interface.encodeFunctionData("configureSong", [song.songId, song.audioURI, song.recipients, song.sharesBps]));
      const gas = await retryRead(() => contract.multicall.estimateGas(calls));
      const transaction = await contract.multicall(calls, { gasLimit: gas * 120n / 100n });
      manifest.transactions.push({ kind: "catalog-batch", hash: transaction.hash, songIds: missing.map(song => song.songId) }); write();
      await confirmed(transaction, "Catalog batch");
      console.log(JSON.stringify({ batch: Math.floor(start / 25) + 1, migrated: missing.length, txHash: transaction.hash }));
    }
    for (const song of songs) {
      const current = await retryRead(() => contract.getSong(song.songId));
      if (!current.enabled || current.audioURI !== song.audioURI || JSON.stringify([...current.recipients]) !== JSON.stringify(song.recipients) ||
          JSON.stringify(current.sharesBps.map(Number)) !== JSON.stringify(song.sharesBps)) throw new Error("Final catalog verification failed");
    }
    manifest.phase = "catalog-verified-paused";
    manifest.workerRolesConfirmed = true;
    write();
    console.log(JSON.stringify({ address: manifest.address, migrated: songs.length, paused: await contract.paused(), deploymentTx: manifest.deploymentTx }));
  } finally { provider.destroy(); }
}

module.exports = { validateCatalog, MigrationProvider };
if (require.main === module) main().catch(error => {
  console.error(JSON.stringify({ code: error.code || "MIGRATION_STOPPED", reason: String(error.shortMessage || error.reason || error.message).slice(0, 200) }));
  const rpcMessage = error.error?.message || error.info?.error?.message;
  if (typeof rpcMessage === "string") console.error(JSON.stringify({ rpcReason: rpcMessage.replace(/0x[0-9a-fA-F]{64,}/g, "[redacted]").slice(0, 200) }));
  console.error("DJuke deployment/migration stopped. Inspect the recorded manifest and confirmed receipts before retrying; no automatic redeploy.");
  process.exitCode = 1;
});