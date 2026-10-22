const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DecentJukeBox_v0_1", function () {
  let token;
  let router;
  let jukebox;
  let admin;
  let listener;
  let artist;
  let collaborator;
  const songId = ethers.id("canonical-song");
  const fundId = ethers.id("dbusk-repo-dev");
  const pinnerFundId = ethers.id("dbusk-pinners");

  beforeEach(async function () {
    [admin, listener, artist, collaborator] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("MockDJukeToken")).deploy();
    router = await (await ethers.getContractFactory("MockDJukeRouter")).deploy();
    jukebox = await (await ethers.getContractFactory("contracts/DecentJukeBox_v0.1.sol:DecentJukeBox_v0_1"))
      .deploy(await token.getAddress(), await router.getAddress(), fundId, pinnerFundId, admin.address);
    await jukebox.configureSong(songId, "ipfs://recording", [artist.address], [10000]);
    await token.mint(listener.address, 1000000000);
    await token.connect(listener).approve(await jukebox.getAddress(), ethers.MaxUint256);
    await jukebox.grantRole(await jukebox.FULFILLER_ROLE(), admin.address);
  });

  it("charges quarter-dollar tiers and protects a stale wallet quote", async function () {
    for (let index = 0; index < 8; index++) {
      expect(await jukebox.quote()).to.equal(250000);
      await jukebox.connect(listener).requestPlay(songId, 250000);
    }
    expect(await jukebox.quote()).to.equal(500000);
    await expect(jukebox.connect(listener).requestPlay(songId, 250000)).to.be.revertedWith("Price exceeds approval");
    expect(await jukebox.pendingCount()).to.equal(8);
    for (let index = 8; index < 16; index++) await jukebox.connect(listener).requestPlay(songId, 500000);
    expect(await jukebox.quote()).to.equal(1000000);
    await jukebox.fulfill(0, songId, 0, ethers.id("play-0"));
    expect(await jukebox.quote()).to.equal(500000);
  });

  it("escrows requests, routes two percent to repo-dev and eight percent to pinners after fulfillment", async function () {
    await jukebox.connect(listener).requestPlay(songId, 250000);
    expect(await router.received(fundId)).to.equal(0);
    expect(await jukebox.artistCredits(artist.address)).to.equal(0);
    await expect(jukebox.fulfill(0, songId, 0, ethers.id("play-0"))).to.emit(jukebox, "PlayFulfilled");
    expect(await router.received(fundId)).to.equal(5000);
    expect(await router.received(pinnerFundId)).to.equal(20000);
    expect(await jukebox.artistCredits(artist.address)).to.equal(225000);
    expect(await token.allowance(await jukebox.getAddress(), await router.getAddress())).to.equal(0);
    await jukebox.connect(artist).withdrawArtistCredit();
    expect(await token.balanceOf(artist.address)).to.equal(225000);
    await expect(jukebox.connect(artist).withdrawArtistCredit()).to.be.revertedWith("No artist credit");
  });

  it("snapshots approved collaborator shares and cannot substitute the paid recording", async function () {
    await jukebox.configureSong(songId, "ipfs://recording", [artist.address, collaborator.address], [7000, 3000]);
    await jukebox.connect(listener).requestPlay(songId, 250000);
    await jukebox.configureSong(songId, "ipfs://recording", [collaborator.address], [10000]);
    await expect(jukebox.configureSong(songId, "ipfs://different-recording", [artist.address], [10000]))
      .to.be.revertedWith("Song audio is immutable");
    await jukebox.fulfill(0, songId, 0, ethers.id("play-0"));
    expect(await jukebox.artistCredits(artist.address)).to.equal(157500);
    expect(await jukebox.artistCredits(collaborator.address)).to.equal(67500);
  });

  it("enforces FIFO, roles and non-replayable playback identifiers", async function () {
    await jukebox.connect(listener).requestPlay(songId, 250000);
    await jukebox.connect(listener).requestPlay(songId, 250000);
    await expect(jukebox.connect(listener).fulfill(0, songId, 0, ethers.id("play-0")))
      .to.be.revertedWithCustomError(jukebox, "AccessControlUnauthorizedAccount");
    await expect(jukebox.fulfill(1, songId, 0, ethers.id("play-1"))).to.be.revertedWith("Fulfill FIFO head only");
    await jukebox.fulfill(0, songId, 0, ethers.id("play-0"));
    await expect(jukebox.fulfill(1, songId, 0, ethers.id("play-0"))).to.be.revertedWith("Playback proof already used or empty");
    expect(await jukebox.pendingCount()).to.equal(1);
  });

  it("retains paid requests if the fund is unavailable and permits retry", async function () {
    await jukebox.connect(listener).requestPlay(songId, 250000);
    await router.setRejectDeposits(true);
    await expect(jukebox.fulfill(0, songId, 0, ethers.id("play-0"))).to.be.revertedWith("Fund unavailable");
    expect(await jukebox.headRequestId()).to.equal(0);
    expect((await jukebox.getRequest(0)).fulfilled).to.equal(false);
    expect(await jukebox.artistCredits(artist.address)).to.equal(0);
    await router.setRejectDeposits(false);
    await jukebox.fulfill(0, songId, 0, ethers.id("play-0"));
    expect(await jukebox.headRequestId()).to.equal(1);
  });

  it("pauses new purchases without preventing existing request fulfillment", async function () {
    await jukebox.connect(listener).requestPlay(songId, 250000);
    await jukebox.pauseRequests();
    await expect(jukebox.connect(listener).requestPlay(songId, 250000)).to.be.revertedWithCustomError(jukebox, "EnforcedPause");
    await jukebox.fulfill(0, songId, 0, ethers.id("play-0"));
    await jukebox.resumeRequests();
    await jukebox.setSongEnabled(songId, false);
    await expect(jukebox.connect(listener).requestPlay(songId, 250000)).to.be.revertedWith("Song unavailable");
  });

  it("rejects unapproved split changes, malformed splits and native currency", async function () {
    await expect(jukebox.connect(listener).configureSong(songId, "ipfs://recording", [listener.address], [10000]))
      .to.be.revertedWithCustomError(jukebox, "AccessControlUnauthorizedAccount");
    await expect(jukebox.configureSong(songId, "ipfs://recording", [artist.address], [9999]))
      .to.be.revertedWith("Shares must total 10000");
    await expect(jukebox.configureSong(songId, "ipfs://recording", [artist.address, artist.address], [5000, 5000]))
      .to.be.revertedWith("Duplicate artist");
    await expect(jukebox.connect(listener).requestPlay(songId, 250000, { value: 1 })).to.be.reverted;
  });

  it("sells on-demand listens and playlists without touching the radio queue", async function () {
    const duet = ethers.id("duet-recording");
    await jukebox.configureSong(duet, "ipfs://duet", [artist.address, collaborator.address], [7000, 3000]);
    const balance = await token.balanceOf(listener.address);
    await expect(jukebox.connect(listener).purchaseListens([songId, duet, songId], 750000))
      .to.emit(jukebox, "ListensPurchased").withArgs(0, listener.address, [songId, duet, songId], 750000);
    expect(balance - await token.balanceOf(listener.address)).to.equal(750000);
    expect(await router.received(fundId)).to.equal(15000);
    expect(await router.received(pinnerFundId)).to.equal(60000);
    expect(await jukebox.artistCredits(artist.address)).to.equal(225000 * 2 + 157500);
    expect(await jukebox.artistCredits(collaborator.address)).to.equal(67500);
    expect(await jukebox.pendingCount()).to.equal(0);
    expect(await jukebox.quote()).to.equal(250000);
    expect(await token.balanceOf(await jukebox.getAddress())).to.equal(675000);
  });

  it("rejects listen purchases above approval, for disabled songs, empty or oversized, and while paused", async function () {
    await expect(jukebox.connect(listener).purchaseListens([songId, songId], 250000)).to.be.revertedWith("Price exceeds approval");
    await expect(jukebox.connect(listener).purchaseListens([], 0)).to.be.revertedWith("Invalid listen batch");
    await expect(jukebox.connect(listener).purchaseListens(Array(51).fill(songId), 51n * 250000n)).to.be.revertedWith("Invalid listen batch");
    await expect(jukebox.connect(listener).purchaseListens([ethers.id("unknown")], 250000)).to.be.revertedWith("Song unavailable");
    await jukebox.setSongEnabled(songId, false);
    await expect(jukebox.connect(listener).purchaseListens([songId], 250000)).to.be.revertedWith("Song unavailable");
    await jukebox.setSongEnabled(songId, true);
    await jukebox.pauseRequests();
    await expect(jukebox.connect(listener).purchaseListens([songId], 250000)).to.be.revertedWithCustomError(jukebox, "EnforcedPause");
    expect(await router.received(fundId)).to.equal(0);
    expect(await router.received(pinnerFundId)).to.equal(0);
  });

  it("lets registrars add new songs only, never altering existing payees", async function () {
    await jukebox.grantRole(await jukebox.REGISTRAR_ROLE(), collaborator.address);
    const fresh = ethers.id("registered-by-worker");
    await expect(jukebox.connect(listener).registerSong(fresh, "ipfs://fresh", [artist.address], [10000]))
      .to.be.revertedWithCustomError(jukebox, "AccessControlUnauthorizedAccount");
    await jukebox.connect(collaborator).multicall([
      jukebox.interface.encodeFunctionData("registerSong", [fresh, "ipfs://fresh", [artist.address], [10000]])]);
    expect((await jukebox.getSong(fresh)).enabled).to.equal(true);
    await expect(jukebox.connect(collaborator).registerSong(songId, "ipfs://recording", [collaborator.address], [10000]))
      .to.be.revertedWith("Song already registered");
    await expect(jukebox.connect(collaborator).configureSong(songId, "ipfs://recording", [collaborator.address], [10000]))
      .to.be.revertedWithCustomError(jukebox, "AccessControlUnauthorizedAccount");
    await expect(jukebox.connect(collaborator).setSongEnabled(songId, false))
      .to.be.revertedWithCustomError(jukebox, "AccessControlUnauthorizedAccount");
    await expect(jukebox.connect(collaborator).registerSong(ethers.id("bad"), "ipfs://bad", [artist.address], [9000]))
      .to.be.revertedWith("Shares must total 10000");
  });

  it("configures many songs atomically by admin multicall only", async function () {
    const songs = ["a", "b", "c"].map(name => ethers.id(`batch-${name}`));
    const calls = songs.map((id, index) => jukebox.interface.encodeFunctionData("configureSong",
      [id, `ipfs://batch-${index}`, [artist.address], [10000]]));
    await expect(jukebox.connect(listener).multicall(calls))
      .to.be.revertedWithCustomError(jukebox, "AccessControlUnauthorizedAccount");
    await expect(jukebox.multicall([...calls, jukebox.interface.encodeFunctionData("configureSong",
      [songs[0], "ipfs://batch-0", [artist.address], [9999]])])).to.be.revertedWith("Shares must total 10000");
    expect((await jukebox.getSong(songs[1])).enabled).to.equal(false);
    await jukebox.multicall(calls);
    for (const id of songs) expect((await jukebox.getSong(id)).enabled).to.equal(true);
  });

  it("lets only the payer replace a pending request without recharging or losing its position", async function () {
    const replacement = ethers.id("replacement-recording");
    await jukebox.configureSong(replacement, "ipfs://replacement", [collaborator.address], [10000]);
    await jukebox.connect(listener).requestPlay(songId, 250000);
    const balance = await token.balanceOf(listener.address);
    await expect(jukebox.replaceRequest(0, replacement)).to.be.revertedWith("Only payer can replace");
    await expect(jukebox.connect(listener).replaceRequest(0, replacement)).to.emit(jukebox, "RequestReplaced");
    expect(await token.balanceOf(listener.address)).to.equal(balance);
    expect(await jukebox.pendingCount()).to.equal(1);
    expect((await jukebox.getRequest(0)).amount).to.equal(250000);
    await expect(jukebox.fulfill(0, songId, 0, ethers.id("stale-play"))).to.be.revertedWith("Paid recording changed");
    await jukebox.connect(listener).replaceRequest(0, songId);
    await expect(jukebox.fulfill(0, songId, 0, ethers.id("stale-play"))).to.be.revertedWith("Paid recording changed");
    await jukebox.connect(listener).replaceRequest(0, replacement);
    await jukebox.fulfill(0, replacement, 3, ethers.id("replacement-play"));
    expect(await jukebox.artistCredits(artist.address)).to.equal(0);
    expect(await jukebox.artistCredits(collaborator.address)).to.equal(225000);
    await expect(jukebox.connect(listener).replaceRequest(0, songId)).to.be.revertedWith("Request is not pending");
  });
});