const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DJuke v0.5 platform-funded playlist", function () {
  let box, token, router, admin, listener, artist, worker, domain;
  const funds = ["repo", "pinners", "playback", "top10"].map(ethers.id);
  const songs = Array.from({ length: 24 }, (_, i) => ethers.id(`sponsored-${i}`));
  const types = { PlaylistGasQuote: [
    { name: "listener", type: "address" }, { name: "songIdsHash", type: "bytes32" },
    { name: "maxTotal", type: "uint256" }, { name: "fulfillmentCostWei", type: "uint256" },
    { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
  ] };
  beforeEach(async function () {
    [admin, listener, artist, worker] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("MockDJukeToken")).deploy();
    router = await (await ethers.getContractFactory("MockDJukeRouter")).deploy();
    const module = await (await ethers.getContractFactory("DJukeSponsoredPlaylistModule")).deploy();
    box = await (await ethers.getContractFactory("DecentJukeBox_v0_5")).deploy(
      token.target, router.target, funds[0], funds[1], admin.address, worker.address,
      ethers.parseEther("0.001"), module.target, funds[2], funds[3]);
    await box.grantRole(await box.REGISTRAR_ROLE(), admin.address);
    await box.grantRole(await box.FULFILLER_ROLE(), worker.address);
    for (const song of songs) await box.registerSong(song, `ipfs://${song.slice(2)}`, [artist.address], [10000]);
    await token.mint(listener.address, 100000000);
    await token.connect(listener).approve(box.target, 100000000);
    domain = { name: "DecentJukeBox", version: "0.2",
      chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: box.target };
  });
  async function quote(ids, cost = 0) {
    const [, , total] = await box.quotePlaylist(ids, true);
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 240;
    const signature = await worker.signTypedData(domain, types, { listener: listener.address,
      songIdsHash: ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32[]"], [ids])),
      maxTotal: total, fulfillmentCostWei: cost, nonce: await box.gasQuoteNonces(listener.address), deadline });
    return [ids, total, cost, deadline, signature];
  }
  async function deliver(index) {
    await box.connect(worker).fulfillPlaylistSong(index, songs[index], 0, ethers.id(`proof-${index}`));
  }
  it("accepts zero worker ETH, rejects any surcharge, and releases exactly $1 at 4/8/12", async function () {
    const args = await quote(songs.slice(0, 12));
    await expect(box.connect(listener).requestPlaylistWithGas(...args, { value: 1 })).to.be.revertedWith("USDC payment only");
    await expect(box.connect(listener).requestPlaylistWithGas(...await quote(songs.slice(0, 12), 1))).to.be.revertedWith("USDC payment only");
    const workerBefore = await ethers.provider.getBalance(worker.address);
    await expect(box.connect(listener).requestPlaylistWithGas(...args)).not.to.emit(box, "WorkerGasFunded");
    expect(await ethers.provider.getBalance(worker.address)).to.equal(workerBefore);
    expect(await token.balanceOf(listener.address)).to.equal(93000000n);
    for (let i = 0; i < 12; i++) {
      await deliver(i);
      expect(await router.received(funds[2])).to.equal(BigInt(Math.floor((i + 1) / 4)) * 250000n);
    }
    expect(await router.received(funds[3])).to.equal(750000n);
    expect(await token.balanceOf(box.target)).to.equal(0n);
  });
  it("refunds only undelivered songs plus unreleased fee after a milestone", async function () {
    await box.connect(listener).requestPlaylistWithGas(...await quote(songs.slice(0, 12)));
    for (let i = 0; i < 5; i++) await deliver(i);
    const before = await token.balanceOf(listener.address);
    await expect(box.connect(worker).refundUndeliveredPlaylist(0))
      .to.emit(box, "PlaylistBatchFeeRefunded").withArgs(0, listener.address, 2000000);
    expect(await token.balanceOf(listener.address) - before).to.equal(4750000n);
    expect(await router.received(funds[2])).to.equal(250000n);
    expect(await token.balanceOf(box.target)).to.equal(0n);
    await expect(box.connect(worker).refundUndeliveredPlaylist(0)).to.be.revertedWith("Playlist refund unavailable");
  });
  for (const count of [1, 4, 5, 13, 24]) {
    it(`settles the entire fee exactly once for ${count} songs`, async function () {
      const ids = songs.slice(0, count);
      const [, fee] = await box.quotePlaylist(ids, true);
      await box.connect(listener).requestPlaylistWithGas(...await quote(ids));
      for (let i = 0; i < count; i++) await deliver(i);
      expect(await router.received(funds[2])).to.equal(fee / 4n);
      expect(await router.received(funds[3])).to.equal(fee / 4n);
      expect(await token.balanceOf(box.target)).to.equal(0n);
      await expect(deliver(count - 1)).to.be.reverted;
    });
  }
  it("remains below EIP-170 and identifies sponsored policy explicitly", async function () {
    expect(await box.CONTRACT_VERSION()).to.equal("0.5");
    expect((await ethers.provider.getCode(box.target)).length / 2 - 1).to.be.at.most(24576);
  });
  it("sponsors ordinary song requests too and preserves main-lane cut-in priority", async function () {
    await box.connect(listener).requestPlaylistWithGas(...await quote(songs.slice(0, 12)));
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 240;
    const maxPrice = await box.quote();
    const value = { listener: listener.address, songId: songs[23], maxPrice, fulfillmentCostWei: 0,
      nonce: await box.gasQuoteNonces(listener.address), deadline };
    const singleTypes = { GasQuote: [
      { name: "listener", type: "address" }, { name: "songId", type: "bytes32" },
      { name: "maxPrice", type: "uint256" }, { name: "fulfillmentCostWei", type: "uint256" },
      { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
    ] };
    const signature = await worker.signTypedData(domain, singleTypes, value);
    await expect(box.connect(listener).requestPlayWithGas(songs[23], maxPrice, 0, deadline, signature, { value: 1 }))
      .to.be.revertedWith("USDC payment only");
    const workerBefore = await ethers.provider.getBalance(worker.address);
    await expect(box.connect(listener).requestPlayWithGas(songs[23], maxPrice, 0, deadline, signature))
      .not.to.emit(box, "WorkerGasFunded");
    expect(await ethers.provider.getBalance(worker.address)).to.equal(workerBefore);
    await expect(deliver(0)).to.be.revertedWith("Main lane is not empty");
    const request = await box.getRequest(0);
    await box.connect(worker).fulfill(0, request.songId, request.revision, ethers.id("single-proof"));
    await deliver(0);
    await expect(box.connect(listener).requestPlayWithGas(songs[23], maxPrice, 0, deadline, signature))
      .to.be.revertedWith("Invalid worker quote");
  });
});
