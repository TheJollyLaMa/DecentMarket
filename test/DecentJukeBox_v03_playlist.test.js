const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DecentJukeBox_v0_3 named playlist checkout", function () {
  const playbackId = ethers.id("dbusk-playback");
  const topTenId = ethers.id("dbusk-top10");
  const pinnerId = ethers.id("pinners");
  const repoId = ethers.id("repo");
  const songs = Array.from({ length: 11 }, (_, index) => ethers.id(`playlist-song-${index}`));
  const types = { PlaylistGasQuote: [
    { name: "listener", type: "address" }, { name: "songIdsHash", type: "bytes32" },
    { name: "maxTotal", type: "uint256" }, { name: "fulfillmentCostWei", type: "uint256" },
    { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
  ] };

  let jukebox, token, router, admin, listener, artist, worker, domain;
  beforeEach(async function () {
    [admin, listener, artist, worker] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("MockDJukeToken")).deploy();
    router = await (await ethers.getContractFactory("MockDJukeRouter")).deploy();
    const module = await (await ethers.getContractFactory("DJukePlaylistModule")).deploy();
    jukebox = await (await ethers.getContractFactory("DecentJukeBox_v0_3")).deploy(
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

  async function buySingle() {
    const price = await jukebox.quote();
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 240;
    const quote = { listener: listener.address, songId: songs[0], maxPrice: price,
      fulfillmentCostWei: 1000000, nonce: await jukebox.gasQuoteNonces(listener.address), deadline };
    const signature = await worker.signTypedData(domain, { GasQuote: [
      { name: "listener", type: "address" }, { name: "songId", type: "bytes32" },
      { name: "maxPrice", type: "uint256" }, { name: "fulfillmentCostWei", type: "uint256" },
      { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
    ] }, quote);
    await jukebox.connect(listener).requestPlayWithGas(songs[0], price, quote.fulfillmentCostWei, deadline, signature,
      { value: 2000000 });
  }

  async function buyBatch(songIds = songs.slice(0, 10), maxTotal = 7500000) {
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 240;
    const gasQuote = { listener: listener.address, songIdsHash: ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32[]"], [songIds])),
      maxTotal, fulfillmentCostWei: 1000000, nonce: await jukebox.gasQuoteNonces(listener.address), deadline };
    const signature = await worker.signTypedData(domain, types, gasQuote);
    return jukebox.connect(listener).requestPlaylistWithGas(songIds, maxTotal, gasQuote.fulfillmentCostWei,
      deadline, signature, { value: BigInt(gasQuote.fulfillmentCostWei) * 2n * BigInt(songIds.length) });
  }

  it("quotes flat private/radio prices and leaves creator-set personal listen pricing unchanged", async function () {
    expect(await jukebox.quotePlaylist(songs.slice(0, 10), false)).to.deep.equal([2500000n, 0n, 2500000n]);
    expect(await jukebox.quotePlaylist(songs.slice(0, 10), true)).to.deep.equal([2500000n, 5000000n, 7500000n]);
    expect(await jukebox.quoteListens([songs[0]])).to.equal(700000n);
    const before = await token.balanceOf(listener.address);
    await jukebox.connect(listener).purchasePlaylistPrivate(songs.slice(0, 2), 500000);
    expect(before - await token.balanceOf(listener.address)).to.equal(500000n);
    expect(await jukebox.pendingCount()).to.equal(0);
    expect(await router.received(playbackId)).to.equal(0n);
  });

  it("charges exactly 0.25 per radio song at queue depths 7, 8, and above", async function () {
    for (const targetDepth of [7, 8, 17]) {
      while (Number(await jukebox.pendingCount()) < targetDepth) await buySingle();
      const regularQuoteBefore = await jukebox.quote();
      const expectedQueueQuote = targetDepth < 8 ? 250000n : targetDepth < 16 ? 500000n : 1000000n;
      expect(regularQuoteBefore).to.equal(expectedQueueQuote);
      const firstRequestId = Number(await jukebox.nextRequestId());
      const before = await token.balanceOf(listener.address);
      await buyBatch(songs.slice(0, 2), 5500000);
      expect(before - await token.balanceOf(listener.address)).to.equal(5500000n);
      expect((await jukebox.getRequest(firstRequestId)).amount).to.equal(250000n);
      expect((await jukebox.getRequest(firstRequestId + 1)).amount).to.equal(250000n);
      while (Number(await jukebox.pendingCount()) > 0) {
        const requestId = await jukebox.headRequestId();
        const request = await jukebox.getRequest(requestId);
        await jukebox.connect(worker).fulfill(requestId, request.songId, request.revision,
          ethers.id(`boundary-proof-${targetDepth}-${requestId}`));
      }
    }
  });

  it("requires an exact doubled worker-gas contribution for every batch song", async function () {
    const songIds = songs.slice(0, 2);
    const maxTotal = 5500000;
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 240;
    const fulfillmentCostWei = 1000000;
    const quote = { listener: listener.address,
      songIdsHash: ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32[]"], [songIds])),
      maxTotal, fulfillmentCostWei, nonce: await jukebox.gasQuoteNonces(listener.address), deadline };
    const signature = await worker.signTypedData(domain, types, quote);
    const args = [songIds, maxTotal, fulfillmentCostWei, deadline, signature];
    await expect(jukebox.connect(listener).requestPlaylistWithGas(...args, { value: 3999999 }))
      .to.be.revertedWith("Exact batch gas contribution required");
    await expect(jukebox.connect(listener).requestPlaylistWithGas(...args, { value: 4000001 }))
      .to.be.revertedWith("Exact batch gas contribution required");
    expect(await jukebox.gasQuoteNonces(listener.address)).to.equal(0n);
    expect(await jukebox.pendingCount()).to.equal(0n);
    await buyBatch(songIds, maxTotal);
    expect(await jukebox.gasQuoteNonces(listener.address)).to.equal(1n);
  });

  it("appends a complete ordered batch atomically and distributes its fee once after audible completion", async function () {
    const receipt = await (await buyBatch()).wait();
    const event = receipt.logs.map(log => { try { return jukebox.interface.parseLog(log); } catch { return null; } })
      .find(parsed => parsed?.name === "PlaylistBatchRequested");
    expect(event.args.songIds).to.deep.equal(songs.slice(0, 10));
    expect(await jukebox.pendingCount()).to.equal(10n);
    expect(await router.received(playbackId)).to.equal(0n);
    for (let index = 0; index < 10; index++) {
      const requestId = BigInt(index);
      const request = await jukebox.getRequest(requestId);
      expect(request.songId).to.equal(songs[index]);
      expect(request.amount).to.equal(250000n);
      await jukebox.connect(worker).fulfill(requestId, songs[index], 0, ethers.id(`proof-${index}`));
      expect(await router.received(playbackId)).to.equal(index === 9 ? 2250000n : 0n);
    }
    expect(await router.received(topTenId)).to.equal(2250000n);
    expect(await router.received(pinnerId)).to.equal(600000n);
    expect(await router.received(repoId)).to.equal(150000n);
    expect(await token.balanceOf(jukebox.target)).to.equal(2250000n);
  });

  it("rejects over-cap, duplicate, stale/undersized, and invalid batches without partial queue changes", async function () {
    const before = await token.balanceOf(listener.address);
    await expect(buyBatch(songs.slice(0, 10), 7499999)).to.be.revertedWith("Price exceeds approval");
    await expect(buyBatch(songs, 7750000)).to.be.revertedWith("Playlist must contain 1-10 songs");
    await expect(buyBatch([songs[0], songs[0]], 5500000)).to.be.revertedWith("Duplicate playlist song");
    await expect(buyBatch([songs[0], ethers.id("unregistered")], 5500000)).to.be.revertedWith("Song unavailable");
    expect(await jukebox.pendingCount()).to.equal(0n);
    expect(await token.balanceOf(listener.address)).to.equal(before);
  });

  it("refunds only undelivered items and the reserved fee if the batch cannot finish", async function () {
    const before = await token.balanceOf(listener.address);
    await buyBatch(songs.slice(0, 3), 5750000);
    await jukebox.connect(worker).fulfill(0, songs[0], 0, ethers.id("delivered-first"));
    await jukebox.connect(worker).refundUndeliveredPlaylist(0);
    expect(before - await token.balanceOf(listener.address)).to.equal(250000n);
    expect(await jukebox.pendingCount()).to.equal(0n);
    expect(await router.received(playbackId)).to.equal(0n);
    expect(await router.received(topTenId)).to.equal(0n);
    await expect(jukebox.connect(worker).refundUndeliveredPlaylist(0)).to.be.revertedWith("Playlist refund unavailable");
  });
});
