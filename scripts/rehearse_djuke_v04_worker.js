const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { ethers, network } = require("hardhat");

async function main() {
  assert.equal(network.name, "hardhat", "Worker rehearsal must use the in-process network");
  assert.ok(!network.config.forking, "Use the fork rehearsal for a real catalog/router migration");
  assert.ok(process.env.BUSKING_WORKTREE, "Set BUSKING_WORKTREE to the reviewed worker checkout");
  // Initialize a local Base-chain-ID fixture without an external RPC or production credentials.
  network.config.chainId = 8453;
  const [admin, listener, artist, worker, collaborator] = await ethers.getSigners();
  const token = await (await ethers.getContractFactory("MockDJukeToken")).deploy();
  const router = await (await ethers.getContractFactory("MockDJukeRouter")).deploy();
  const module = await (await ethers.getContractFactory("DJukePlaylistModule")).deploy();
  const fundIds = ["dbusk-playback", "dbusk-top10", "dbusk-pinners", "dbusk-repo-dev"].map(ethers.id);
  const jukebox = await (await ethers.getContractFactory("DecentJukeBox_v0_4")).deploy(
    token.target, router.target, fundIds[3], fundIds[2], admin.address, worker.address,
    ethers.parseEther("0.1"), module.target, fundIds[0], fundIds[1]);
  await (await jukebox.grantRole(await jukebox.REGISTRAR_ROLE(), admin.address)).wait();
  await (await jukebox.grantRole(await jukebox.FULFILLER_ROLE(), worker.address)).wait();
  const songs = Array.from({ length: 12 }, (_, i) => {
    const trackId = `worker-rehearsal-${i}`;
    return { trackId, songId: ethers.keccak256(ethers.toUtf8Bytes(trackId)), audioURI: `ipfs://worker-audio-${i}`,
      recipients: [artist.address, collaborator.address], sharesBps: [7000, 3000] };
  });
  for (const song of songs) {
    await (await jukebox.registerSong(song.songId, song.audioURI, song.recipients, song.sharesBps)).wait();
  }
  await (await token.mint(listener.address, 100000000n)).wait();
  await (await token.connect(listener).approve(jukebox.target, 100000000n)).wait();
  const { rehearsePlaylistWorker } = await import(pathToFileURL(path.join(process.env.BUSKING_WORKTREE,
    "scripts/rehearse-djuke-playlist-worker.mjs")).href);
  const result = await rehearsePlaylistWorker({ provider: ethers.provider, jukebox, worker, listener, token, router,
    fundIds, songs, oracle: { getL1Fee: async () => 1000n }, readFundBalance: id => router.received(id) });
  console.log(JSON.stringify({ mode: "in-process local contracts, mock token/router/L1 oracle", ...result }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
