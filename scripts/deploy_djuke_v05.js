const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");
const dotenv = require("dotenv");

const SOURCE = "0xBBCb7F7369978cbdc32C6719B1d24B07f3d55619";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ROUTER = "0x8ecca903e2a6daa8ccbb933700e4f2c58c44a4b5";
const OWNER = "0x807061DF657A7697c04045dA7d16D941861cAABc";
const WORKER = "0x4894698f2B5cAF13Fad4Aa8fbaFE3618b960909F";
const FUNDS = ["dbusk-repo-dev", "dbusk-pinners", "dbusk-playback", "dbusk-top10"].map(ethers.id);
const SOURCE_ABI = [
  "function CONTRACT_VERSION() view returns(string)", "function pendingCount() view returns(uint256)",
  "function playlistPendingCount() view returns(uint256)", "function paused() view returns(bool)",
  "function pauseRequests()", "function hasRole(bytes32,address) view returns(bool)",
  "function getSong(bytes32) view returns((string audioURI,bool enabled,address[] recipients,uint16[] sharesBps))",
  "function songAlbum(bytes32) view returns(bytes32)", "function playlistListenPrice(bytes32) view returns(uint256)",
];
const manifestPath = path.join(__dirname, "../deployments/djuke-v05-base.json");
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

async function main() {
  if (!process.env.DBUSK_ENV_FILE) throw new Error("Set DBUSK_ENV_FILE to the ignored owner environment file");
  const config = dotenv.parse(fs.readFileSync(process.env.DBUSK_ENV_FILE));
  const rpc = process.env.DJUKE_DEPLOY_RPC_URL || config.BASE_RPC_URL;
  if (!rpc) throw new Error("Base deployment RPC is required");
  const provider = new ethers.JsonRpcProvider(rpc, 8453, { staticNetwork: true, batchMaxCount: 1 });
  try {
    if (BigInt(await provider.send("eth_chainId", [])) !== 8453n) throw new Error("Base-only deployment");
    const signer = new ethers.Wallet(config.MINT_OWNER_PRIVATE_KEY || config.PRIVATE_KEY, provider);
    if (!same(signer.address, OWNER)) throw new Error("Wrong deployment owner");
    const source = new ethers.Contract(SOURCE, SOURCE_ABI, signer);
    if (await source.CONTRACT_VERSION() !== "0.4" || !await source.hasRole(ethers.ZeroHash, OWNER)) {
      throw new Error("Unexpected migration source or admin");
    }
    const queuesEmpty = async () => {
      if (await source.pendingCount() !== 0n || await source.playlistPendingCount() !== 0n) {
        throw new Error("Both v0.4 paid lanes must drain before migration");
      }
    };
    await queuesEmpty();
    if (await provider.getBalance(WORKER) < ethers.parseEther("0.001")) throw new Error("Worker needs a manual Base ETH top-up");
    const router = new ethers.Contract(ROUTER, [
      "function funds(bytes32) view returns(string metadataUri,bool active,bool exists)",
      "function approvedAssets(address) view returns(bool)", "function paused() view returns(bool)",
    ], provider);
    for (const id of FUNDS) {
      const fund = await router.funds(id);
      if (!fund.active || !fund.exists) throw new Error(`Router fund is unavailable: ${id}`);
    }
    if (!await router.approvedAssets(USDC) || await router.paused()) throw new Error("Router or USDC is unavailable");
    const response = await fetch("https://decentbusking.onrender.com/api/djuke", { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Catalog snapshot failed (${response.status})`);
    const snapshot = await response.json();
    if (!same(snapshot.contractAddress || "", SOURCE) || snapshot.catalogReadErrors !== 0 ||
        snapshot.requests?.length !== 0 || !snapshot.tracks?.length) throw new Error("Incomplete source catalog");
    if (!Array.isArray(snapshot.playlistReceipts) || snapshot.playlistReceipts.some(batch =>
      !["settled", "refunded"].includes(batch.status) || batch.refundedUnits === null)) {
      throw new Error("Legacy receipts are not fully reconciled");
    }
    const blockTag = await provider.getBlockNumber() - 2;
    const pinned = await provider.getBlock(blockTag);
    const songs = [];
    const seen = new Set();
    for (const track of snapshot.tracks) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(track.songId) || seen.has(track.songId.toLowerCase())) throw new Error("Invalid catalog song ID");
      seen.add(track.songId.toLowerCase());
      const song = await source.getSong(track.songId, { blockTag });
      if (!song.enabled || song.audioURI !== `ipfs://${track.ipfsCid}` ||
          await source.songAlbum(track.songId, { blockTag }) !== ethers.ZeroHash ||
          await source.playlistListenPrice(track.songId, { blockTag }) !== 250000n) {
        throw new Error(`Song ${track.songId} needs a metadata/pricing-preserving migration; refusing a lossy copy`);
      }
      songs.push({ songId: track.songId, audioURI: song.audioURI, recipients: [...song.recipients],
        sharesBps: song.sharesBps.map(Number) });
    }
    songs.sort((a, b) => a.songId.localeCompare(b.songId));
    if ((await provider.getBlock(blockTag)).hash !== pinned.hash) throw new Error("Catalog source block changed");
    const catalogHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(songs)));
    const artifact = require("../artifacts/contracts/DecentJukeBox_v0.5.sol/DecentJukeBox_v0_5.json");
    const moduleArtifact = require("../artifacts/contracts/DJukeSponsoredPlaylistModule.sol/DJukeSponsoredPlaylistModule.json");
    const runtimeBytes = (artifact.deployedBytecode.length - 2) / 2;
    if (runtimeBytes > 24576 || (moduleArtifact.deployedBytecode.length - 2) / 2 > 24576) throw new Error("EIP-170 size exceeded");
    let manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : null;
    if (manifest && (manifest.source !== SOURCE || manifest.catalogHash !== catalogHash ||
        manifest.admin !== OWNER || manifest.worker !== WORKER)) throw new Error("Migration manifest mismatch");
    const live = process.env.CONFIRM_DEPLOY === "v0.5-base";
    console.log(JSON.stringify({ mode: live ? "live" : "dry-run", source: SOURCE, sourceBlock: blockTag,
      catalogSongs: songs.length, catalogHash, runtimeBytes, worker: WORKER,
      workerBalanceEth: ethers.formatEther(await provider.getBalance(WORKER)), automaticTopUps: false }, null, 2));
    if (!live) return;
    manifest ||= { schemaVersion: 1, version: "0.5", source: SOURCE, sourceBlock: blockTag, sourceBlockHash: pinned.hash,
      catalogHash, catalogSongs: songs.length, admin: OWNER, worker: WORKER, token: USDC, router: ROUTER,
      runtimeBytes, createdAt: new Date().toISOString(), transactions: {}, migratedSongIds: [],
      legacyPlaylistReceipts: snapshot.playlistReceipts.map(batch => ({ ...batch, contractAddress: SOURCE, workerGasSponsored: false })) };
    const write = () => {
      fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
      fs.writeFileSync(`${manifestPath}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
      fs.renameSync(`${manifestPath}.tmp`, manifestPath);
    };
    const confirm = async (label, submit) => {
      let hash = manifest.transactions[label];
      if (!hash) {
        const tx = await submit();
        hash = tx.hash;
        manifest.transactions[label] = hash;
        write();
      }
      const receipt = await provider.waitForTransaction(hash, 2, 180000);
      if (receipt?.status !== 1) throw new Error(`Transaction ${label} not confirmed successfully: ${hash}`);
      console.log(`${label}: ${hash}`);
      return receipt;
    };
    write();
    if (!await source.paused()) await confirm("pause-source", () => source.pauseRequests());
    await queuesEmpty();
    if (!manifest.module) {
      const factory = new ethers.ContractFactory(moduleArtifact.abi, moduleArtifact.bytecode, signer);
      const receipt = await confirm("deploy-module", async () => (await factory.deploy()).deploymentTransaction());
      manifest.module = receipt.contractAddress;
      write();
    }
    const module = new ethers.Contract(manifest.module, moduleArtifact.abi, provider);
    if (await provider.getCode(manifest.module) !== moduleArtifact.deployedBytecode ||
        !await module.WORKER_GAS_SPONSORED()) throw new Error("Unexpected module code");
    if (!manifest.address) {
      const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
      const receipt = await confirm("deploy-djuke", async () => (await factory.deploy(USDC, ROUTER, FUNDS[0], FUNDS[1],
        OWNER, WORKER, ethers.parseEther("0.001"), manifest.module, FUNDS[2], FUNDS[3])).deploymentTransaction());
      manifest.address = receipt.contractAddress;
      manifest.deploymentBlock = receipt.blockNumber;
      write();
    }
    const jukebox = new ethers.Contract(manifest.address, artifact.abi, signer);
    if (await jukebox.CONTRACT_VERSION() !== "0.5" || !same(await jukebox.playlistModule(), manifest.module) ||
        !same(await jukebox.gasWorker(), WORKER) || !same(await jukebox.paymentToken(), USDC) ||
        !same(await jukebox.fundRouter(), ROUTER)) throw new Error("Deployment identity mismatch");
    for (const [roleName, address] of [["REGISTRAR_ROLE", OWNER], ["REGISTRAR_ROLE", WORKER], ["FULFILLER_ROLE", WORKER]]) {
      const role = await jukebox[roleName]();
      if (!await jukebox.hasRole(role, address)) await confirm(`${roleName}-${address}`, () => jukebox.grantRole(role, address));
    }
    for (let start = 0; start < songs.length; start += 20) {
      const chunk = songs.slice(start, start + 20);
      if (chunk.some(song => !manifest.migratedSongIds.includes(song.songId))) {
        const calls = chunk.map(song => jukebox.interface.encodeFunctionData("registerSong",
          [song.songId, song.audioURI, song.recipients, song.sharesBps]));
        await confirm(`catalog-${start}`, () => jukebox.multicall(calls));
        manifest.migratedSongIds = [...new Set([...manifest.migratedSongIds, ...chunk.map(song => song.songId)])];
        write();
      }
      for (const song of chunk) {
        const migrated = await jukebox.getSong(song.songId);
        if (!migrated.enabled || migrated.audioURI !== song.audioURI ||
            JSON.stringify(migrated.recipients.map(a => a.toLowerCase())) !== JSON.stringify(song.recipients.map(a => a.toLowerCase())) ||
            JSON.stringify(migrated.sharesBps.map(Number)) !== JSON.stringify(song.sharesBps) ||
            await jukebox.playlistListenPrice(song.songId) !== 250000n) throw new Error(`Migrated song mismatch: ${song.songId}`);
      }
    }
    await queuesEmpty();
    if (!await source.paused() || await jukebox.totalPendingCount() !== 0n) throw new Error("Unexpected queues at cutover");
    manifest.completedAt = new Date().toISOString();
    write();
    console.log(JSON.stringify({ readyForConfiguration: true, address: manifest.address, module: manifest.module,
      deploymentBlock: manifest.deploymentBlock, migratedSongs: manifest.migratedSongIds.length,
      productionConfigurationChanged: false }, null, 2));
  } finally {
    provider.destroy();
  }
}

main().catch(error => {
  console.error(String(error.shortMessage || error.message || error.code || "DJuke v0.5 migration failed")
    .replace(/https?:\/\/[^\s"')]+/g, "[RPC URL]"));
  process.exitCode = 1;
});
