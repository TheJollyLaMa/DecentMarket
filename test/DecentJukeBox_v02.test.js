const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DecentJukeBox_v0_2", function () {
  let jukebox, token, admin, listener, artist, collaborator, worker, domain;
  const albumId = ethers.id("album");
  const songId = ethers.id("song");
  const quoteTypes = { GasQuote: [
    { name: "listener", type: "address" }, { name: "songId", type: "bytes32" },
    { name: "maxPrice", type: "uint256" }, { name: "fulfillmentCostWei", type: "uint256" },
    { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
  ] };

  beforeEach(async function () {
    [admin, listener, artist, collaborator, worker] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("MockDJukeToken")).deploy();
    const router = await (await ethers.getContractFactory("MockDJukeRouter")).deploy();
    jukebox = await (await ethers.getContractFactory("contracts/DecentJukeBox_v0.2.sol:DecentJukeBox_v0_2")).deploy(
      token.target, router.target, ethers.id("repo"), ethers.id("pinners"), admin.address, worker.address, ethers.parseEther("0.001"));
    domain = { name: "DecentJukeBox", version: "0.2", chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: jukebox.target };
    await jukebox.grantRole(await jukebox.REGISTRAR_ROLE(), admin.address);
    await jukebox.grantRole(await jukebox.FULFILLER_ROLE(), worker.address);
    await jukebox.connect(artist).createAlbum(albumId, "Album", "ipfs://manifest", [artist.address], [10000], ["Performer"], 250000, 400000);
    await jukebox.registerAlbumSong(albumId, songId, "ipfs://song");
    await token.mint(listener.address, 10000000);
    await token.connect(listener).approve(jukebox.target, 10000000);
  });

  async function signedQuote(overrides = {}) {
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 240;
    const quote = { listener: listener.address, songId, maxPrice: 250000, fulfillmentCostWei: 1000000,
      nonce: await jukebox.gasQuoteNonces(listener.address), deadline, ...overrides };
    return { quote, signature: await worker.signTypedData(domain, quoteTypes, quote) };
  }

  async function buy() {
    const { quote, signature } = await signedQuote();
    await jukebox.connect(listener).requestPlayWithGas(songId, quote.maxPrice, quote.fulfillmentCostWei, quote.deadline, signature,
      { value: BigInt(quote.fulfillmentCostWei) * 2n });
    return { quote, signature };
  }

  it("funds the fixed worker atomically while preserving FIFO and quarter-dollar tiers", async function () {
    const before = await ethers.provider.getBalance(worker.address);
    const { quote, signature } = await buy();
    expect(await ethers.provider.getBalance(worker.address)).to.equal(before + 2000000n);
    expect(await jukebox.pendingCount()).to.equal(1);
    expect(await jukebox.quote()).to.equal(250000);
    await expect(jukebox.connect(listener).requestPlayWithGas(songId, 250000, 1000000, quote.deadline, signature, { value: 2000000 }))
      .to.be.revertedWith("Invalid gas quote signature");
    expect(await jukebox.pendingCount()).to.equal(1);
    for (let index = 1; index < 8; index++) await buy();
    expect(await jukebox.quote()).to.equal(500000);
  });

  it("rejects unsigned requests, expired quotes, over-cap gas and incorrect ETH without collecting USDC", async function () {
    const balance = await token.balanceOf(listener.address);
    await expect(jukebox.connect(listener).requestPlay(songId, 250000)).to.be.revertedWith("Signed gas quote required");
    const { quote, signature } = await signedQuote();
    await expect(jukebox.connect(listener).requestPlayWithGas(songId, 250000, 1000000, quote.deadline, signature, { value: 1 }))
      .to.be.revertedWith("Exact gas contribution required");
    await expect(jukebox.connect(listener).requestPlayWithGas(songId, 250000, ethers.parseEther("1"), quote.deadline, signature))
      .to.be.revertedWith("Gas contribution exceeds cap");
    await expect(jukebox.connect(listener).requestPlayWithGas(songId, 250000, 1000000, 1, signature, { value: 2000000 }))
      .to.be.revertedWith("Expired or invalid gas quote");
    expect(await token.balanceOf(listener.address)).to.equal(balance);
    expect(await jukebox.gasQuoteNonces(listener.address)).to.equal(0);
  });

  it("adds collaborators only with current-owner consent and never rewrites purchased terms", async function () {
    await buy();
    const recipients = [artist.address, collaborator.address], shares = [7000, 3000], positions = ["Performer", "Producer"];
    const types = { AlbumSplit: [
      { name: "albumId", type: "bytes32" }, { name: "revision", type: "uint256" },
      { name: "recipientsHash", type: "bytes32" }, { name: "sharesHash", type: "bytes32" }, { name: "positionsHash", type: "bytes32" },
    ] };
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const proposal = { albumId, revision: 1,
      recipientsHash: ethers.keccak256(coder.encode(["address[]"], [recipients])),
      sharesHash: ethers.keccak256(coder.encode(["uint16[]"], [shares])),
      positionsHash: ethers.keccak256(coder.encode(["string[]"], [positions])) };
    await expect(jukebox.connect(artist).updateAlbumOwners(albumId, recipients, shares, positions, ["0x"]))
      .to.be.revertedWith("Missing owner consent");
    const approval = await artist.signTypedData(domain, types, proposal);
    await jukebox.connect(artist).updateAlbumOwners(albumId, recipients, shares, positions, [approval]);
    await jukebox.connect(artist).syncAlbumSongSplits(albumId, [songId]);
    expect((await jukebox.getSong(songId)).recipients).to.deep.equal(recipients);
    expect((await jukebox.getRequest(0)).recipients).to.deep.equal([artist.address]);
    await jukebox.connect(worker).fulfill(0, songId, 0, ethers.id("played"));
    expect(await jukebox.artistCredits(artist.address)).to.equal(225000);
    expect(await jukebox.artistCredits(collaborator.address)).to.equal(0);
    await expect(jukebox.connect(artist).updateAlbumOwners(albumId, recipients, shares, positions, [approval]))
      .to.be.revertedWith("All current owners must approve");
  });

  it("restricts album management, keeps audio immutable and quotes personal prices independently", async function () {
    await expect(jukebox.configureSong(songId, "ipfs://song", [admin.address], [10000])).to.be.revertedWith("Album songs require owner consent");
    await expect(jukebox.connect(listener).updateAlbumFees(albumId, 500000, 600000)).to.be.revertedWith("Only album manager");
    await jukebox.connect(artist).updateAlbumManifest(albumId, "ipfs://updated");
    expect((await jukebox.getSong(songId)).audioURI).to.equal("ipfs://song");
    await jukebox.connect(artist).updateAlbumFees(albumId, 500000, 600000);
    expect(await jukebox.quoteListens([songId])).to.equal(500000);
    expect(await jukebox.quote()).to.equal(250000);
    await jukebox.connect(listener).purchaseListens([songId], 500000);
    await jukebox.connect(listener).purchaseAlbum(albumId, 600000);
    expect(await jukebox.pendingCount()).to.equal(0);
    expect(await jukebox.artistCredits(artist.address)).to.equal(990000);
    await jukebox.pauseRequests();
    await expect(jukebox.connect(listener).purchaseAlbum(albumId, 600000)).to.be.revertedWithCustomError(jukebox, "EnforcedPause");
  });
});