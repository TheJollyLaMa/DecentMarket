const fs = require("node:fs");
const path = require("node:path");
const ethers = require("ethers");
const dotenv = require("dotenv");

const OLD_ADDRESS = "0x5d07489163feBCdB39C9F579CCC36dff5A067FF9";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ROUTER = "0x8ecca903e2a6Daa8CCbB933700e4F2C58C44A4B5";
const OWNER = "0x807061DF657A7697c04045dA7d16D941861cAABc";
const WORKER = "0x4894698f2B5cAF13Fad4Aa8fbaFE3618b960909F";
const PLAYBACK = ethers.id("dbusk-playback");
const TOP_TEN = ethers.id("dbusk-top10");
const OLD_ABI = [
  "function getSong(bytes32) view returns((string audioURI,bool enabled,address[] recipients,uint16[] sharesBps))",
  "function pendingCount() view returns(uint256)", "function paused() view returns(bool)", "function pauseRequests()", "function hasRole(bytes32,address) view returns(bool)",
];

function validateSongs(songs) {
  if (!Array.isArray(songs) || !songs.length || songs.length > 5000) throw new Error("Invalid catalog size");
  const seen = new Set();
  for (const song of songs) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(song.songId || "") || seen.has(song.songId.toLowerCase()) ||
      !song.audioURI?.startsWith("ipfs://") || !song.recipients?.length || song.recipients.length > 16 ||
      song.recipients.length !== song.sharesBps?.length || song.recipients.some(a => !ethers.isAddress(a) || a === ethers.ZeroAddress) ||
      new Set(song.recipients.map(a => a.toLowerCase())).size !== song.recipients.length ||
      song.sharesBps.some(share => !Number.isInteger(Number(share)) || Number(share) <= 0) ||
      song.sharesBps.reduce((sum, share) => sum + Number(share), 0) !== 10000) throw new Error("Invalid migration song or payout split");
    seen.add(song.songId.toLowerCase());
  }
  return ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(songs)));
}

async function retryRead(task) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await task(); } catch (error) { lastError = error; }
  }
  throw lastError;
}

async function main() {
  if (!process.env.DBUSK_ENV_FILE) throw new Error("Set DBUSK_ENV_FILE to the ignored deployment environment file");
  dotenv.config({ path: process.env.DBUSK_ENV_FILE, override: true, quiet: true });
  const rpc = process.env.DJUKE_DEPLOY_RPC_URL || process.env.BASE_RPC_URL || "https://mainnet.base.org";
  const provider = new ethers.JsonRpcProvider(rpc, 8453, { staticNetwork: true, batchMaxCount: 1 });
  if (Number((await provider.getNetwork()).chainId) !== 8453) throw new Error("Base-only migration");
  const signer = new ethers.Wallet(process.env.MINT_OWNER_PRIVATE_KEY, provider);
  if (signer.address.toLowerCase() !== OWNER.toLowerCase()) throw new Error("Deployer is not the reviewed owner");

  const old = new ethers.Contract(OLD_ADDRESS, OLD_ABI, signer);
  if (!(await old.hasRole(ethers.ZeroHash, signer.address))) throw new Error("Owner lacks old DJuke admin role");
  if (await old.pendingCount() !== 0n) throw new Error("Old paid queue must be empty before migration");
  const router = new ethers.Contract(ROUTER, [
    "function funds(bytes32) view returns(string metadataUri,bool active,bool exists)",
    "function approvedAssets(address) view returns(bool)", "function paused() view returns(bool)",
  ], provider);
  const fundIds = [ethers.id("dbusk-repo-dev"), ethers.id("dbusk-pinners"), PLAYBACK, TOP_TEN];
  for (const fundId of fundIds) {
    const fund = await router.funds(fundId);
    if (!fund.active || !fund.exists) throw new Error(`Inactive or missing router fund ${fundId}`);
  }
  if (!await router.approvedAssets(USDC) || await router.paused()) throw new Error("Router or Base USDC is unavailable");

  const response = await fetch("https://decentbusking.onrender.com/api/djuke", { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Catalog snapshot unavailable (${response.status})`);
  const snapshot = await response.json();
  if (snapshot.contractAddress?.toLowerCase() !== OLD_ADDRESS.toLowerCase() || snapshot.paymentsEnabled !== false ||
    snapshot.requests?.length !== 0 || snapshot.catalogReadErrors !== 0 || !snapshot.tracks?.length) {
    throw new Error("Need a complete read-only snapshot from the live v0.3 catalog");
  }
  const blockTag = await provider.getBlockNumber() - 2;
  const before = await provider.getBlock(blockTag);
  const songs = [];
  for (const track of snapshot.tracks) {
    const song = await retryRead(() => old.getSong(track.songId, { blockTag }));
    if (!song.enabled || song.audioURI !== `ipfs://${track.ipfsCid}`) throw new Error(`Source mismatch for ${track.songId}`);
    songs.push({ songId: track.songId, audioURI: song.audioURI, recipients: [...song.recipients], sharesBps: song.sharesBps.map(Number) });
  }
  songs.sort((a, b) => a.songId.localeCompare(b.songId));
  const catalogHash = validateSongs(songs);
  if ((await provider.getBlock(blockTag)).hash !== before.hash) throw new Error("Pinned source block changed during catalog verification");

  const artifact = require("../artifacts/contracts/DecentJukeBox_v0.4.sol/DecentJukeBox_v0_4.json");
  const moduleArtifact = require("../artifacts/contracts/DJukePlaylistModule.sol/DJukePlaylistModule.json");
  const jukeboxSize = (artifact.deployedBytecode.length - 2) / 2;
  if (jukeboxSize > 24576) throw new Error(`v0.4 exceeds EIP-170 (${jukeboxSize} bytes)`);
  const manifestPath = path.join(__dirname, "../deployments/djuke-v04-base.json");
  let manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : null;
  if (manifest && (manifest.catalogHash !== catalogHash || manifest.source !== OLD_ADDRESS || manifest.admin !== OWNER)) {
    throw new Error("Existing migration manifest does not match this source snapshot");
  }
  const writeManifest = () => {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  };
  const cap = ethers.parseEther("0.001");
  const moduleFactory = new ethers.ContractFactory(moduleArtifact.abi, moduleArtifact.bytecode, signer);
  const jukeboxFactory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const deployModule = await moduleFactory.getDeployTransaction();
  const deployJukebox = await jukeboxFactory.getDeployTransaction(USDC, ROUTER, ethers.id("dbusk-repo-dev"),
    ethers.id("dbusk-pinners"), OWNER, WORKER, cap, manifest?.module || ethers.getCreateAddress({ from: signer.address, nonce: await provider.getTransactionCount(signer.address, "pending") }), PLAYBACK, TOP_TEN);
  const estimatedGas = await provider.estimateGas({ ...deployModule, from: signer.address }) +
    await provider.estimateGas({ ...deployJukebox, from: signer.address });
  const fees = await provider.getFeeData();
  const runtime = { v0_4Bytes: jukeboxSize, eip170Headroom: 24576 - jukeboxSize,
    moduleBytes: (moduleArtifact.deployedBytecode.length - 2) / 2 };
  console.log(JSON.stringify({ mode: process.env.CONFIRM_DEPLOY === "yes" ? "live" : "dry-run",
    source: OLD_ADDRESS, sourceBlock: blockTag, catalogHash, songs: songs.length, estimatedDeployGas: String(estimatedGas),
    estimatedDeployCostWei: String(estimatedGas * (fees.maxFeePerGas || fees.gasPrice || 0n)), runtime,
    routerAuthorization: "Verified router fundToken is permissionless; preflight checks all four funds are active/existing, USDC approved, and router unpaused. Reconfirm on the fork." }, null, 2));
  if (process.env.CONFIRM_DEPLOY !== "yes") return;

  const confirmed = async (tx, label) => {
    const receipt = await tx.wait(2);
    if (receipt?.status !== 1) throw new Error(`${label} failed: ${tx.hash}`);
    return receipt;
  };
  if (!manifest) manifest = { schemaVersion: 1, source: OLD_ADDRESS, catalogHash, admin: OWNER, sourceBlock: blockTag,
    runtime, migratedSongIds: [], createdAt: new Date().toISOString() };
  if (!manifest.module) {
    const module = await moduleFactory.deploy();
    await module.waitForDeployment();
    manifest.module = module.target;
    writeManifest();
  }
  if (!manifest.address) {
    if (!await old.paused()) await confirmed(await old.pauseRequests(), "Pause old v0.3 DJuke");
    if (await old.pendingCount() !== 0n) throw new Error("Queue changed while pausing; resolve it before migration");
    const jukebox = await jukeboxFactory.deploy(USDC, ROUTER, ethers.id("dbusk-repo-dev"), ethers.id("dbusk-pinners"),
      OWNER, WORKER, cap, manifest.module, PLAYBACK, TOP_TEN);
    await jukebox.waitForDeployment();
    manifest.address = jukebox.target;
    writeManifest();
  }
  const jukebox = new ethers.Contract(manifest.address, artifact.abi, signer);
  const registrarRole = await jukebox.REGISTRAR_ROLE();
  const fulfillerRole = await jukebox.FULFILLER_ROLE();
  if (!await jukebox.hasRole(registrarRole, OWNER)) await confirmed(await jukebox.grantRole(registrarRole, OWNER), "Grant catalog registrar role");
  if (!await jukebox.hasRole(fulfillerRole, WORKER)) await confirmed(await jukebox.grantRole(fulfillerRole, WORKER), "Grant worker fulfiller role");
  const migrated = new Set(manifest.migratedSongIds || []);
  for (let start = 0; start < songs.length; start += 20) {
    const chunk = songs.slice(start, start + 20).filter(song => !migrated.has(song.songId));
    if (!chunk.length) continue;
    const calls = chunk.map(song => jukebox.interface.encodeFunctionData("registerSong", [song.songId, song.audioURI, song.recipients, song.sharesBps]));
    await confirmed(await jukebox.multicall(calls), `Migrate songs ${start + 1}-${start + chunk.length}`);
    for (const song of chunk) migrated.add(song.songId);
    manifest.migratedSongIds = [...migrated];
    writeManifest();
  }
  manifest.completedAt = new Date().toISOString();
  writeManifest();
  console.log(`Migration manifest written: ${manifestPath}`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
