const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DecentNFT_v0_3 batches", function () {
  let nft;
  let admin;
  let artist;
  let listener;

  const product = (recipient, overrides = {}) => ({
    recipient,
    amount: 1,
    maxSupply: 10,
    tokenURI: "ipfs://song-metadata",
    royaltyReceiver: recipient,
    royaltyFeeBps: 500,
    ...overrides,
  });

  beforeEach(async function () {
    [admin, artist, listener] = await ethers.getSigners();
    const NFT = await ethers.getContractFactory("DecentNFT_v0_3");
    nft = await NFT.deploy("ipfs://collection/", admin.address, 500);
    await nft.waitForDeployment();
  });

  it("registers and mints multiple songs to different recipients atomically", async function () {
    await expect(nft.registerAndMintProductsBatch([
      product(artist.address),
      product(listener.address, { amount: 2, tokenURI: "ipfs://second-song" }),
    ])).to.emit(nft, "EditionMinted").withArgs(1, listener.address, 2, admin.address);
    expect(await nft.balanceOf(artist.address, 0)).to.equal(1);
    expect(await nft.balanceOf(listener.address, 1)).to.equal(2);
    expect(await nft.creatorOf(0)).to.equal(admin.address);
    expect(await nft.creatorOf(1)).to.equal(admin.address);
    expect(await nft.uri(1)).to.equal("ipfs://second-song");
    expect(await nft.royaltyInfo(0, 10000)).to.deep.equal([artist.address, 500n]);
    expect(await nft.nextTokenId()).to.equal(2);
  });

  it("uses the actual next ID after earlier registrations", async function () {
    await nft.registerToken(0, "", 0, ethers.ZeroAddress, 0);
    expect(await nft.registerAndMintProductsBatch.staticCall([product(artist.address)]))
      .to.deep.equal([1n]);
    await nft.registerAndMintProductsBatch([product(artist.address)]);
    expect(await nft.balanceOf(artist.address, 1)).to.equal(1);
    expect(await nft.totalMinted(0)).to.equal(0);
  });

  it("rolls back registrations and balances when a later mint exceeds its cap", async function () {
    await expect(nft.registerAndMintProductsBatch([
      product(artist.address), product(listener.address, { amount: 11 }),
    ])).to.be.revertedWith("DecentNFT: exceeds supply cap");
    expect(await nft.nextTokenId()).to.equal(0);
    expect(await nft.balanceOf(artist.address, 0)).to.equal(0);
    expect(await nft.creatorOf(0)).to.equal(ethers.ZeroAddress);
  });

  it("rolls back the entire batch when a contract recipient rejects its mint", async function () {
    const receiver = await (await ethers.getContractFactory("RejectingNFTReceiver")).deploy();
    await expect(nft.registerAndMintProductsBatch([
      product(artist.address), product(await receiver.getAddress()),
    ])).to.be.revertedWith("Receiver rejected mint");
    expect(await nft.nextTokenId()).to.equal(0);
    expect(await nft.balanceOf(artist.address, 0)).to.equal(0);
    expect(await nft.totalMinted(0)).to.equal(0);
  });

  it("rejects empty batches and unauthorized registration, including through multicall", async function () {
    await expect(nft.registerAndMintProductsBatch([])).to.be.revertedWithCustomError(nft, "EmptyProductBatch");
    const products = [product(artist.address)];
    await expect(nft.connect(listener).registerAndMintProductsBatch(products))
      .to.be.revertedWithCustomError(nft, "AccessControlUnauthorizedAccount");
    await expect(nft.connect(listener).multicall([
      nft.interface.encodeFunctionData("registerAndMintProductsBatch", [products]),
    ])).to.be.revertedWithCustomError(nft, "AccessControlUnauthorizedAccount");
  });

  it("batches royalty updates and additional editions while preserving authorization", async function () {
    await nft.registerAndMintProductsBatch([product(artist.address), product(artist.address)]);
    const calls = [
      nft.interface.encodeFunctionData("setTokenRoyalty", [0, listener.address, 250]),
      nft.interface.encodeFunctionData("setTokenRoyalty", [1, listener.address, 750]),
      nft.interface.encodeFunctionData("mintProduct", [artist.address, 0, 2]),
    ];
    await expect(nft.connect(listener).multicall(calls))
      .to.be.revertedWithCustomError(nft, "AccessControlUnauthorizedAccount");
    await nft.multicall(calls);
    expect(await nft.royaltyInfo(0, 10000)).to.deep.equal([listener.address, 250n]);
    expect(await nft.royaltyInfo(1, 10000)).to.deep.equal([listener.address, 750n]);
    expect(await nft.balanceOf(artist.address, 0)).to.equal(3);
  });

  it("preserves Achievement lane restrictions inside multicall", async function () {
    await nft.registerToken(10, "", 1, ethers.ZeroAddress, 0);
    await expect(nft.multicall([
      nft.interface.encodeFunctionData("mintProduct", [artist.address, 0, 1]),
    ])).to.be.revertedWith("DecentNFT: not a Product token");
    await nft.grantRole(await nft.MINTER_ROLE(), artist.address);
    await nft.connect(artist).multicall([
      nft.interface.encodeFunctionData("mintAchievement", [listener.address, 0, 1]),
    ]);
    expect(await nft.balanceOf(listener.address, 0)).to.equal(1);
  });

  it("rejects native payments rather than reusing msg.value across batch calls", async function () {
    await expect(nft.multicall([], { value: 1 })).to.be.reverted;
    await expect(nft.registerAndMintProductsBatch([product(artist.address)], { value: 1 }))
      .to.be.reverted;
  });
});