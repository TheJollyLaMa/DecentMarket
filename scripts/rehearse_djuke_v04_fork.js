const { ethers, network } = require("hardhat");

const LIVE = "0x5d07489163feBCdB39C9F579CCC36dff5A067FF9";
const ROUTER = "0x8ecca903e2a6Daa8CCbB933700e4F2C58C44A4B5";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const OWNER = "0x807061DF657A7697c04045dA7d16D941861cAABc";
const WORKER = "0x4894698f2B5cAF13Fad4Aa8fbaFE3618b960909F";
const REPO = ethers.id("dbusk-repo-dev"), PINNERS = ethers.id("dbusk-pinners");
const PLAYBACK = ethers.id("dbusk-playback"), TOP_TEN = ethers.id("dbusk-top10");
const QUOTE_TYPES = { PlaylistGasQuote: [
  { name: "listener", type: "address" }, { name: "songIdsHash", type: "bytes32" },
  { name: "maxTotal", type: "uint256" }, { name: "fulfillmentCostWei", type: "uint256" },
  { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
] };
const GAS_TYPES = { GasQuote: [
  { name: "listener", type: "address" }, { name: "songId", type: "bytes32" },
  { name: "maxPrice", type: "uint256" }, { name: "fulfillmentCostWei", type: "uint256" },
  { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
] };
const ROUTER_ABI = [
  "function funds(bytes32) view returns(string metadataUri,bool active,bool exists)",
  "function approvedAssets(address) view returns(bool)", "function paused() view returns(bool)",
  "function fundBalances(bytes32,address) view returns(uint256)",
];
const USDC_ABI = ["function balanceOf(address) view returns(uint256)", "function transfer(address,uint256) returns(bool)",
  "function approve(address,uint256) returns(bool)"];
const OLD_ABI = ["function hasRole(bytes32,address) view returns(bool)", "function pendingCount() view returns(uint256)",
  "function paused() view returns(bool)", "function pauseRequests()", "function getSong(bytes32) view returns((string audioURI,bool enabled,address[] recipients,uint16[] sharesBps))"];

async function impersonate(address) {
  await network.provider.request({ method: "hardhat_impersonateAccount", params: [address] });
  await network.provider.request({ method: "hardhat_setBalance", params: [address, ethers.toBeHex(ethers.parseEther("100"))] });
  return ethers.getSigner(address);
}
async function confirmed(tx, label) {
  const receipt = await tx.wait();
  if (receipt?.status !== 1) throw new Error(`${label} failed`);
  return receipt;
}

async function main() {
  if (!process.env.BASE_FORK_RPC || Number((await ethers.provider.getNetwork()).chainId) !== 8453) {
    throw new Error("Set BASE_FORK_RPC=https://mainnet.base.org; this rehearsal mutates only the in-process fork");
  }
  const owner = await impersonate(OWNER);
  const worker = await impersonate(WORKER);
  const router = new ethers.Contract(ROUTER, ROUTER_ABI, ethers.provider);
  const token = new ethers.Contract(USDC, USDC_ABI, ethers.provider);
  const old = new ethers.Contract(LIVE, OLD_ABI, owner);
  if (!await old.hasRole(ethers.ZeroHash, OWNER)) throw new Error("Impersonated steward is not old-contract admin");
  if (await old.pendingCount() !== 0n) throw new Error("Live source queue is not empty; rehearsal stopped before pause");
  if (!await token.balanceOf(ROUTER)) throw new Error("Router has no fork-local USDC available to seed the rehearsal listener");
  for (const fundId of [REPO, PINNERS, PLAYBACK, TOP_TEN]) {
    const fund = await router.funds(fundId);
    if (!fund.active || !fund.exists) throw new Error(`Missing or inactive router fund ${fundId}`);
  }
  if (!await router.approvedAssets(USDC) || await router.paused()) throw new Error("Router token/fund preflight failed");

  const response = await fetch("https://decentbusking.onrender.com/api/djuke", { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`DJuke snapshot failed (${response.status})`);
  const snapshot = await response.json();
  if (snapshot.contractAddress?.toLowerCase() !== LIVE.toLowerCase() || snapshot.paymentsEnabled !== false ||
      snapshot.requests?.length || snapshot.catalogReadErrors || !snapshot.tracks?.length) throw new Error("Source snapshot is not complete and read-only");
  const blockTag = await ethers.provider.getBlockNumber() - 2;
  const block = await ethers.provider.getBlock(blockTag);
  const songs = [];
  for (const track of snapshot.tracks) {
    const song = await old.getSong(track.songId, { blockTag });
    if (!song.enabled || song.audioURI !== `ipfs://${track.ipfsCid}`) throw new Error(`Catalog mismatch for ${track.songId}`);
    songs.push({ songId: track.songId, audioURI: song.audioURI, recipients: [...song.recipients], sharesBps: song.sharesBps.map(Number) });
  }
  if ((await ethers.provider.getBlock(blockTag)).hash !== block.hash) throw new Error("Pinned catalog block changed");
  const catalogHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(songs)));
  if (!await old.paused()) await confirmed(await old.pauseRequests(), "Fork-only old DJuke pause");

  const module = await (await ethers.getContractFactory("DJukePlaylistModule", owner)).deploy();
  await module.waitForDeployment();
  const artifact = await ethers.getContractFactory("contracts/DecentJukeBox_v0.4.sol:DecentJukeBox_v0_4", owner);
  const artifactJson = require("../artifacts/contracts/DecentJukeBox_v0.4.sol/DecentJukeBox_v0_4.json");
  const size = (artifactJson.deployedBytecode.length - 2) / 2;
  const jukebox = await artifact.deploy(USDC, ROUTER, REPO, PINNERS, OWNER, WORKER, ethers.parseEther("0.001"), module.target, PLAYBACK, TOP_TEN);
  await jukebox.waitForDeployment();
  await confirmed(await jukebox.grantRole(await jukebox.REGISTRAR_ROLE(), OWNER), "Grant fork registrar role");
  await confirmed(await jukebox.grantRole(await jukebox.FULFILLER_ROLE(), WORKER), "Grant fork worker role");
  for (let start = 0; start < songs.length; start += 20) {
    const batch = songs.slice(start, start + 20);
    const calls = batch.map(song => jukebox.interface.encodeFunctionData("registerSong", [song.songId, song.audioURI, song.recipients, song.sharesBps]));
    await confirmed(await jukebox.multicall(calls), `Migrate fork catalog ${start + 1}-${start + batch.length}`);
  }
  if (await jukebox.CONTRACT_VERSION() !== "0.4") throw new Error("Wrong v0.4 artifact deployed to fork");
  const workerContract = jukebox.connect(worker);
  const listener = owner;
  const listenerAddress = OWNER;
  const topUp = 20_000_000n;
  const routerSigner = await impersonate(ROUTER);
  await confirmed(await new ethers.Contract(USDC, USDC_ABI, routerSigner).transfer(listenerAddress, topUp), "Fork-only listener USDC seed");
  await confirmed(await token.connect(listener).approve(jukebox.target, 50_000_000n), "Approve fork-only DJuke USDC");

  const firstSong = songs[0].songId;
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const singleCost = 1_000_000n;
  const singleQuote = { listener: listenerAddress, songId: firstSong, maxPrice: await jukebox.quote(),
    fulfillmentCostWei: singleCost, nonce: await jukebox.gasQuoteNonces(listenerAddress), deadline: now + 180 };
  const domain = { name: "DecentJukeBox", version: "0.2", chainId: 8453, verifyingContract: jukebox.target };
  const singleSignature = await worker.signTypedData(domain, GAS_TYPES, singleQuote);
  await confirmed(await jukebox.connect(listener).requestPlayWithGas(firstSong, singleQuote.maxPrice, singleCost, singleQuote.deadline,
    singleSignature, { value: singleCost * 2n }), "Single-song gas-funded request");
  const single = await jukebox.getRequest(0);
  const singleArtist = single.recipients[0];
  const singleArtistBefore = await token.balanceOf(singleArtist);
  await confirmed(await workerContract.fulfill(0, firstSong, single.revision, ethers.id("fork-single-proof")), "Single-song fulfillment");
  if (await token.balanceOf(singleArtist) - singleArtistBefore !== 225_000n) throw new Error("Single-song artist was not paid directly");

  const privateIds = songs.slice(1, 3).map(song => song.songId);
  const privateArtist = (await jukebox.getSong(privateIds[0])).recipients[0];
  const privateBefore = await token.balanceOf(privateArtist);
  await confirmed(await jukebox.connect(listener).purchasePlaylistPrivate(privateIds, 500_000), "Private playlist purchase");
  if (await token.balanceOf(privateArtist) - privateBefore !== 450_000n) throw new Error("Private playlist artists were not paid directly");

  const radioIds = songs.slice(3, 5).map(song => song.songId);
  const maxTotal = 5_500_000n, fulfillmentCostWei = 1_000_000n;
  const radioNonce = await jukebox.gasQuoteNonces(listenerAddress);
  const radioDeadline = (await ethers.provider.getBlock("latest")).timestamp + 180;
  const songIdsHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32[]"], [radioIds]));
  const radioQuote = { listener: listenerAddress, songIdsHash, maxTotal, fulfillmentCostWei, nonce: radioNonce, deadline: radioDeadline };
  const radioSignature = await worker.signTypedData(domain, QUOTE_TYPES, radioQuote);
  const fundBefore = await Promise.all([PLAYBACK, TOP_TEN, PINNERS, REPO].map(id => router.fundBalances(id, USDC)));
  const radioReceipt = await confirmed(await jukebox.connect(listener).requestPlaylistWithGas(radioIds, maxTotal, fulfillmentCostWei, radioDeadline,
    radioSignature, { value: fulfillmentCostWei * 4n }), "Radio playlist checkout");
  const batchId = radioReceipt.logs.map(log => { try { return jukebox.interface.parseLog(log); } catch { return null; } })
    .find(event => event?.name === "PlaylistBatchRequested").args.batchId;
  for (let index = 0; index < radioIds.length; index++) {
    const request = await jukebox.getRequest(BigInt(index + 1));
    await confirmed(await workerContract.fulfill(BigInt(index + 1), radioIds[index], request.revision,
      ethers.id(`fork-radio-${index}`)), `Radio item ${index + 1} fulfillment`);
  }
  const fundAfter = await Promise.all([PLAYBACK, TOP_TEN, PINNERS, REPO].map(id => router.fundBalances(id, USDC)));
  const expectedDeltas = [2_250_000n, 2_250_000n, 600_000n, 150_000n];
  if (fundAfter.some((value, index) => value - fundBefore[index] !== expectedDeltas[index])) throw new Error("Four-fund radio fee/song split mismatch");

  const refundIds = songs.slice(5, 7).map(song => song.songId);
  const refundNonce = await jukebox.gasQuoteNonces(listenerAddress);
  const refundDeadline = (await ethers.provider.getBlock("latest")).timestamp + 180;
  const refundQuote = { listener: listenerAddress,
    songIdsHash: ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32[]"], [refundIds])),
    maxTotal, fulfillmentCostWei, nonce: refundNonce, deadline: refundDeadline };
  const refundSignature = await worker.signTypedData(domain, QUOTE_TYPES, refundQuote);
  const refundReceipt = await confirmed(await jukebox.connect(listener).requestPlaylistWithGas(refundIds, maxTotal, fulfillmentCostWei, refundDeadline,
    refundSignature, { value: fulfillmentCostWei * 4n }), "Refund-test playlist checkout");
  const refundedBatch = refundReceipt.logs.map(log => { try { return jukebox.interface.parseLog(log); } catch { return null; } })
    .find(event => event?.name === "PlaylistBatchRequested").args.batchId;
  const firstRefundTestRequestId = await jukebox.headRequestId();
  const firstRefundTest = await jukebox.getRequest(firstRefundTestRequestId);
  await confirmed(await workerContract.fulfill(firstRefundTestRequestId, refundIds[0], firstRefundTest.revision,
    ethers.id("fork-refund-prefix-proof")), "Refund-test delivered prefix");
  const payerBefore = await token.balanceOf(listenerAddress);
  await confirmed(await workerContract.refundUndeliveredPlaylist(refundedBatch), "Undelivered suffix + fee refund");
  if (await token.balanceOf(listenerAddress) - payerBefore !== 5_250_000n) throw new Error("Refund did not cover only suffix song plus the reserved fee");
  if (await jukebox.artistCredits(singleArtist) !== 0n || size > 24576) throw new Error("Direct settlement or EIP-170 check failed");

  console.log(JSON.stringify({ mode: "in-process Base fork only", oldSourcePausedOnFork: await old.paused(),
    sourceBlock: blockTag, catalogSongs: songs.length, catalogHash, module: module.target, v0_4: jukebox.target,
    runtimeBytes: size, headroom: 24576 - size, worker: WORKER, singleSongDirectArtistPaid: true,
    privatePlaylistDirectArtistPaid: true, radioBatchId: String(batchId), feeAndSongFundDeltas: fundAfter.map((v, i) => String(v - fundBefore[i])),
    refundBatchId: String(refundedBatch), undeliveredSuffixAndFeeRefund: "5,250,000 USDC units",
    routerAuthorizedBySuccessfulSettlement: true, realBaseTransactions: 0 }, null, 2));
  for (const address of [OWNER, WORKER, ROUTER]) await network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [address] });
}

main().catch(error => { console.error(error.shortMessage || error.message); process.exitCode = 1; });
