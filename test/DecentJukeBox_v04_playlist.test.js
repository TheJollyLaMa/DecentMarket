const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DecentJukeBox_v0_4 playlist lane", function () {
  const playbackId = ethers.id("dbusk-playback");
  const topTenId = ethers.id("dbusk-top10");
  const pinnerId = ethers.id("pinners");
  const repoId = ethers.id("repo");
  const songs = Array.from({ length: 26 }, (_, index) => ethers.id(`playlist-song-${index}`));
  const playlistTypes = { PlaylistGasQuote: [
    { name: "listener", type: "address" }, { name: "songIdsHash", type: "bytes32" },
    { name: "maxTotal", type: "uint256" }, { name: "fulfillmentCostWei", type: "uint256" },
    { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
  ] };
  const gasTypes = { GasQuote: [
    { name: "listener", type: "address" }, { name: "songId", type: "bytes32" },
    { name: "maxPrice", type: "uint256" }, { name: "fulfillmentCostWei", type: "uint256" },
    { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
  ] };

  let jukebox, token, router, admin, listener, artist, worker, domain;
  beforeEach(async function () {
    [admin, listener, artist, worker] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("MockDJukeToken")).deploy();
    router = await (await ethers.getContractFactory("MockDJukeRouter")).deploy();
    const module = await (await ethers.getContractFactory("DJukePlaylistModule")).deploy();
    jukebox = await (await ethers.getContractFactory("DecentJukeBox_v0_4")).deploy(
      token.target, router.target, repoId, pinnerId, admin.address, worker.address,
      ethers.parseEther("0.001"), module.target, playbackId, topTenId);
    await jukebox.grantRole(await jukebox.REGISTRAR_ROLE(), admin.address);
    await jukebox.grantRole(await jukebox.FULFILLER_ROLE(), worker.address);
    const albumId = ethers.id("playlist-test-album");
    await jukebox.connect(artist).createAlbum(albumId, "Test", "ipfs://manifest", [artist.address], [10000], ["Artist"], 700000, 900000);
    for (const song of songs) await jukebox.registerAlbumSong(albumId, song, `ipfs://${song.slice(2)}`);
    await token.mint(listener.address, 100000000);
    await token.connect(listener).approve(jukebox.target, 100000000);
    const net = await ethers.provider.getNetwork();
    domain = { name: "DecentJukeBox", version: "0.2", chainId: net.chainId, verifyingContract: jukebox.target };
  });

  async function playlistQuote(songIds, maxTotal, signer = worker) {
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 240;
    const fulfillmentCostWei = 1000000;
    const quote = { listener: listener.address,
      songIdsHash: ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32[]"], [songIds])),
      maxTotal, fulfillmentCostWei, nonce: await jukebox.gasQuoteNonces(listener.address), deadline };
    const signature = await signer.signTypedData(domain, playlistTypes, quote);
    return { deadline, fulfillmentCostWei, signature };
  }

  async function buyBatch(songIds, maxTotal, signer = worker) {
    const { deadline, fulfillmentCostWei, signature } = await playlistQuote(songIds, maxTotal, signer);
    return jukebox.connect(listener).requestPlaylistWithGas(songIds, maxTotal, fulfillmentCostWei,
      deadline, signature, { value: BigInt(fulfillmentCostWei) * 2n * BigInt(songIds.length) });
  }

  async function buySingle(songId = songs[25]) {
    const maxPrice = await jukebox.quote();
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 240;
    const fulfillmentCostWei = 1000000;
    const quote = { listener: listener.address, songId, maxPrice, fulfillmentCostWei,
      nonce: await jukebox.gasQuoteNonces(listener.address), deadline };
    const signature = await worker.signTypedData(domain, gasTypes, quote);
    return jukebox.connect(listener).requestPlayWithGas(songId, maxPrice, fulfillmentCostWei, deadline, signature,
      { value: 2000000 });
  }

  async function fulfillPlaylist(laneId, proof = ethers.id(`playlist-proof-${laneId}`)) {
    const item = await jukebox.getPlaylistItem(laneId);
    await jukebox.connect(worker).fulfillPlaylistSong(laneId, item.songId, 0, proof);
  }

  it("quotes all tier boundaries, both fee tiers, private album listen prices, and rejects 25 songs", async function () {
    const expected = new Map([[1, 250000n], [8, 2000000n], [9, 2500000n], [16, 6000000n], [17, 7000000n], [24, 14000000n]]);
    for (const [count, subtotal] of expected) {
      const radioFee = count <= 12 ? 3000000n : 6000000n;
      expect(await jukebox.quotePlaylist(songs.slice(0, count), true)).to.deep.equal([subtotal, radioFee, subtotal + radioFee]);
    }
    expect(await jukebox.quotePlaylist(songs.slice(0, 2), false)).to.deep.equal([1400000n, 0n, 1400000n]);
    await expect(jukebox.quotePlaylist(songs.slice(0, 25), true)).to.be.revertedWith("Playlist must contain 1-24 songs");
    await expect(jukebox.quotePlaylist([songs[0], songs[0]], true)).to.be.revertedWith("Duplicate playlist song");
    await expect(buyBatch(songs.slice(0, 25), 50000000)).to.be.revertedWith("Playlist must contain 1-24 songs");
    const before = await token.balanceOf(listener.address);
    await jukebox.connect(listener).purchasePlaylistPrivate(songs.slice(0, 2), 1400000);
    expect(before - await token.balanceOf(listener.address)).to.equal(1400000n);
    expect(await jukebox.pendingCount()).to.equal(0n);
    expect(await router.received(playbackId)).to.equal(0n);
    expect(await token.balanceOf(artist.address)).to.equal(1260000n);
    expect(await jukebox.artistLedger(artist.address)).to.deep.equal([1260000n, 2n]);
    expect(await router.received(repoId)).to.equal(28000n);
    expect(await router.received(pinnerId)).to.equal(112000n);
  });

  it("preserves direct artist settlement for normal paid requests", async function () {
    await buySingle();
    const request = await jukebox.getRequest(0);
    await jukebox.connect(worker).fulfill(0, request.songId, request.revision, ethers.id("single-direct-payout"));
    expect(await token.balanceOf(artist.address)).to.equal(225000n);
    expect(await jukebox.artistLedger(artist.address)).to.deep.equal([225000n, 1n]);
    expect(await jukebox.artistCredits(artist.address)).to.equal(0n);
  });

  it("tiers ordinary queue quotes by main plus playlist pending while pendingCount remains main-only", async function () {
    await buyBatch(songs.slice(0, 8), 5000000);
    expect(await jukebox.pendingCount()).to.equal(0n);
    expect(await jukebox.playlistPendingCount()).to.equal(8n);
    expect(await jukebox.totalPendingCount()).to.equal(8n);
    expect(await jukebox.quote()).to.equal(500000n);
    await buySingle();
    expect(await jukebox.pendingCount()).to.equal(1n);
    expect(await jukebox.playlistPendingCount()).to.equal(8n);
    expect(await jukebox.quote()).to.equal(500000n);
    const request = await jukebox.getRequest(0);
    expect(request.amount).to.equal(500000n);
  });

  it("lets main-lane requests cut in, and forbids playlist delivery until that lane drains", async function () {
    await buyBatch(songs.slice(0, 2), 3500000);
    await buySingle();
    await expect(fulfillPlaylist(0)).to.be.revertedWith("Main lane is not empty");
    const main = await jukebox.getRequest(0);
    await jukebox.connect(worker).fulfill(0, main.songId, main.revision, ethers.id("main-cut-in"));
    expect(await jukebox.playlistHeadId()).to.equal(0n);
    await fulfillPlaylist(0);
    expect((await jukebox.getPlaylistItem(0)).status).to.equal(1n);
    await fulfillPlaylist(1);
    expect(await jukebox.playlistHeadId()).to.equal(2n);
  });

  it("settles delivered songs 90/8/2 and only routes the 25/25/25/25 batch fee on completion", async function () {
    await buyBatch(songs.slice(0, 2), 3500000);
    expect(await router.received(playbackId)).to.equal(0n);
    const artistBefore = await token.balanceOf(artist.address);
    await fulfillPlaylist(0);
    expect(await router.received(playbackId)).to.equal(0n);
    await fulfillPlaylist(1);
    expect(await token.balanceOf(artist.address) - artistBefore).to.equal(450000n);
    expect(await router.received(playbackId)).to.equal(750000n);
    expect(await router.received(topTenId)).to.equal(750000n);
    expect(await router.received(pinnerId)).to.equal(750000n + 40000n);
    expect(await router.received(repoId)).to.equal(750000n + 10000n);
    expect(await token.balanceOf(jukebox.target)).to.equal(0n);
    expect(await jukebox.artistLedger(artist.address)).to.deep.equal([450000n, 2n]);
  });

  it("requires exact gas, valid EIP-712 signer, and exact payment approval", async function () {
    const ids = songs.slice(0, 2), maxTotal = 3500000;
    const { deadline, fulfillmentCostWei, signature } = await playlistQuote(ids, maxTotal);
    const args = [ids, maxTotal, fulfillmentCostWei, deadline, signature];
    await expect(jukebox.connect(listener).requestPlaylistWithGas(...args, { value: 3999999 }))
      .to.be.revertedWith("Exact batch gas contribution required");
    await expect(jukebox.connect(listener).requestPlaylistWithGas(...args, { value: 4000001 }))
      .to.be.revertedWith("Exact batch gas contribution required");
    const bad = await playlistQuote(ids, maxTotal, admin);
    await expect(jukebox.connect(listener).requestPlaylistWithGas(ids, maxTotal, bad.fulfillmentCostWei,
      bad.deadline, bad.signature, { value: 4000000 })).to.be.revertedWith("Invalid playlist gas quote signature");
    expect(await jukebox.gasQuoteNonces(listener.address)).to.equal(0n);
    await buyBatch(ids, maxTotal);
    expect(await jukebox.gasQuoteNonces(listener.address)).to.equal(1n);
    await expect(buyBatch(songs.slice(0, 2), 3499999)).to.be.revertedWith("Price exceeds approval");
  });

  it("stores separate ordered lane items and settles $6 fee at 13-24 songs", async function () {
    const ids = songs.slice(0, 17);
    const receipt = await (await buyBatch(ids, 13000000)).wait();
    const event = receipt.logs.map(log => { try { return jukebox.interface.parseLog(log); } catch { return null; } })
      .find(parsed => parsed?.name === "PlaylistBatchRequested");
    expect(event.args.songIds).to.deep.equal(ids);
    expect(event.args.subtotal).to.equal(7000000n);
    expect(event.args.fee).to.equal(6000000n);
    expect(event.args.firstLaneId).to.equal(0n);
    expect(await jukebox.pendingCount()).to.equal(0n);
    expect(await jukebox.playlistPendingCount()).to.equal(17n);
    for (let i = 0; i < ids.length; i++) {
      const item = await jukebox.getPlaylistItem(i);
      expect(item.songId).to.equal(ids[i]);
      expect(item.amount).to.equal(i < 8 ? 250000n : i < 16 ? 500000n : 1000000n);
      await fulfillPlaylist(i);
    }
    expect(await router.received(playbackId)).to.equal(1500000n);
    expect(await router.received(topTenId)).to.equal(1500000n);
    expect(await router.received(pinnerId)).to.equal(1500000n + 560000n);
    expect(await router.received(repoId)).to.equal(1500000n + 140000n);
    expect(await jukebox.playlistPendingCount()).to.equal(0n);
  });

  it("refunds only pending batch items and its fee, and advances the lane head past refunded items", async function () {
    const before = await token.balanceOf(listener.address);
    await buyBatch(songs.slice(0, 4), 4500000);
    await fulfillPlaylist(0);
    await jukebox.connect(worker).refundUndeliveredPlaylist(0);
    expect(before - await token.balanceOf(listener.address)).to.equal(250000n);
    expect((await jukebox.getPlaylistItem(0))[4]).to.equal(1n);
    for (const id of [1, 2, 3]) expect((await jukebox.getPlaylistItem(id))[4]).to.equal(2n);
    expect(await jukebox.playlistPendingCount()).to.equal(0n);
    expect(await jukebox.playlistHeadId()).to.equal(4n);
    expect(await router.received(playbackId)).to.equal(0n);
    await expect(jukebox.connect(worker).refundUndeliveredPlaylist(0)).to.be.revertedWith("Playlist refund unavailable");
  });

  it("rejects playlist delivery while main requests exist and validates song, revision, and proof", async function () {
    await buyBatch(songs.slice(0, 1), 3250000);
    await expect(jukebox.connect(worker).fulfillPlaylistSong(0, songs[1], 0, ethers.id("wrong-song")))
      .to.be.revertedWith("Playlist song mismatch");
    await expect(jukebox.connect(worker).fulfillPlaylistSong(0, songs[0], 1, ethers.id("wrong-revision")))
      .to.be.revertedWith("Playlist revision mismatch");
    await expect(jukebox.connect(worker).fulfillPlaylistSong(0, songs[0], 0, ethers.ZeroHash))
      .to.be.revertedWith("Invalid playback proof");
    await expect(jukebox.connect(listener).fulfillPlaylistSong(0, songs[0], 0, ethers.id("not-fulfiller")))
      .to.be.reverted;
  });
});
