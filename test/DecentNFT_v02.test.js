// test/DecentNFT_v02.test.js
// Unit tests for DecentNFT_v0.2 (ERC-1155 editionable NFT contract)

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DecentNFT_v0_2", function () {
  const BASE_URI = "ipfs://bafytest123/";
  const ROYALTY_BPS = 500; // 5%

  let decentNFT;
  let owner;
  let addr1;
  let addr2;
  let royaltyReceiver;

  beforeEach(async function () {
    [owner, addr1, addr2, royaltyReceiver] = await ethers.getSigners();

    const DecentNFT = await ethers.getContractFactory("DecentNFT_v0_2");
    decentNFT = await DecentNFT.deploy(BASE_URI, royaltyReceiver.address, ROYALTY_BPS);
    await decentNFT.waitForDeployment();
  });

  // ── Deployment ───────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("sets the owner correctly", async function () {
      expect(await decentNFT.owner()).to.equal(owner.address);
    });

    it("supports ERC-1155 interface (0xd9b67a26)", async function () {
      expect(await decentNFT.supportsInterface("0xd9b67a26")).to.be.true;
    });

    it("supports ERC-2981 interface (0x2a55205a)", async function () {
      expect(await decentNFT.supportsInterface("0x2a55205a")).to.be.true;
    });

    it("starts with nextTokenId = 0", async function () {
      expect(await decentNFT.nextTokenId()).to.equal(0n);
    });
  });

  // ── Token registration ───────────────────────────────────────────────────────

  describe("registerToken", function () {
    it("allows the owner to register a new token", async function () {
      await expect(decentNFT.registerToken(1000, "", ethers.ZeroAddress, 0))
        .to.emit(decentNFT, "TokenRegistered")
        .withArgs(0n, owner.address, 1000n, BASE_URI + "0.json");

      expect(await decentNFT.nextTokenId()).to.equal(1n);
      expect(await decentNFT.creatorOf(0)).to.equal(owner.address);
      expect(await decentNFT.maxSupply(0)).to.equal(1000n);
      expect(await decentNFT.totalMinted(0)).to.equal(0n);
    });

    it("assigns ascending token IDs", async function () {
      await decentNFT.registerToken(0, "", ethers.ZeroAddress, 0);
      await decentNFT.registerToken(0, "", ethers.ZeroAddress, 0);
      expect(await decentNFT.nextTokenId()).to.equal(2n);
      expect(await decentNFT.creatorOf(0)).to.equal(owner.address);
      expect(await decentNFT.creatorOf(1)).to.equal(owner.address);
    });

    it("reverts when called by non-owner", async function () {
      await expect(
        decentNFT.connect(addr1).registerToken(100, "", ethers.ZeroAddress, 0)
      ).to.be.revertedWithCustomError(decentNFT, "OwnableUnauthorizedAccount");
    });

    it("uses per-token URI override when provided", async function () {
      const customURI = "ipfs://custom123/my-token.json";
      await decentNFT.registerToken(0, customURI, ethers.ZeroAddress, 0);
      expect(await decentNFT.uri(0)).to.equal(customURI);
    });

    it("uses base URI pattern when no override is set", async function () {
      await decentNFT.registerToken(0, "", ethers.ZeroAddress, 0);
      expect(await decentNFT.uri(0)).to.equal(BASE_URI + "0.json");
    });
  });

  // ── URI management ───────────────────────────────────────────────────────────

  describe("URI management", function () {
    beforeEach(async function () {
      await decentNFT.registerToken(100, "", ethers.ZeroAddress, 0);
    });

    it("allows owner to update base URI", async function () {
      const newBase = "ipfs://newroot/";
      await decentNFT.setBaseURI(newBase);
      expect(await decentNFT.uri(0)).to.equal(newBase + "0.json");
    });

    it("allows owner to set per-token URI override", async function () {
      const customURI = "ipfs://override/token.json";
      await decentNFT.setTokenURI(0, customURI);
      expect(await decentNFT.uri(0)).to.equal(customURI);
    });

    it("reverts setTokenURI for unregistered token", async function () {
      await expect(decentNFT.setTokenURI(99, "ipfs://x/")).to.be.revertedWith(
        "DecentNFT: token not registered"
      );
    });

    it("reverts setBaseURI when called by non-owner", async function () {
      await expect(
        decentNFT.connect(addr1).setBaseURI("ipfs://hacker/")
      ).to.be.revertedWithCustomError(decentNFT, "OwnableUnauthorizedAccount");
    });
  });

  // ── mintEdition (owner-only) ─────────────────────────────────────────────────

  describe("mintEdition", function () {
    beforeEach(async function () {
      await decentNFT.registerToken(10, "", ethers.ZeroAddress, 0); // tokenId 0, maxSupply 10
    });

    it("allows owner to mint editions", async function () {
      await expect(decentNFT.mintEdition(addr1.address, 0, 3))
        .to.emit(decentNFT, "EditionMinted")
        .withArgs(0n, addr1.address, 3n, owner.address);

      expect(await decentNFT.balanceOf(addr1.address, 0)).to.equal(3n);
      expect(await decentNFT.totalMinted(0)).to.equal(3n);
    });

    it("respects the supply cap", async function () {
      await decentNFT.mintEdition(addr1.address, 0, 8);
      await expect(
        decentNFT.mintEdition(addr1.address, 0, 3) // would bring total to 11 > 10
      ).to.be.revertedWith("DecentNFT: exceeds supply cap");
    });

    it("allows minting up to the cap exactly", async function () {
      await decentNFT.mintEdition(addr1.address, 0, 10);
      expect(await decentNFT.totalMinted(0)).to.equal(10n);
    });

    it("supports unlimited supply (maxSupply = 0)", async function () {
      await decentNFT.registerToken(0, "", ethers.ZeroAddress, 0); // tokenId 1, unlimited
      await decentNFT.mintEdition(addr1.address, 1, 9999);
      expect(await decentNFT.totalMinted(1)).to.equal(9999n);
    });

    it("reverts when called by non-owner", async function () {
      await expect(
        decentNFT.connect(addr1).mintEdition(addr1.address, 0, 1)
      ).to.be.revertedWithCustomError(decentNFT, "OwnableUnauthorizedAccount");
    });

    it("reverts for unregistered token", async function () {
      await expect(
        decentNFT.mintEdition(addr1.address, 99, 1)
      ).to.be.revertedWith("DecentNFT: token not registered");
    });

    it("reverts when amount is zero", async function () {
      await expect(
        decentNFT.mintEdition(addr1.address, 0, 0)
      ).to.be.revertedWith("DecentNFT: amount must be > 0");
    });
  });

  // ── mintUser (open/self-mint) ────────────────────────────────────────────────

  describe("mintUser", function () {
    beforeEach(async function () {
      await decentNFT.registerToken(5, "", ethers.ZeroAddress, 0); // tokenId 0, maxSupply 5
    });

    it("allows any user to mint editions", async function () {
      await expect(decentNFT.connect(addr1).mintUser(0, 2))
        .to.emit(decentNFT, "EditionMinted")
        .withArgs(0n, addr1.address, 2n, addr1.address);

      expect(await decentNFT.balanceOf(addr1.address, 0)).to.equal(2n);
    });

    it("respects the supply cap across multiple users", async function () {
      await decentNFT.connect(addr1).mintUser(0, 3);
      await decentNFT.connect(addr2).mintUser(0, 2);
      await expect(
        decentNFT.connect(addr1).mintUser(0, 1) // total would be 6 > 5
      ).to.be.revertedWith("DecentNFT: exceeds supply cap");
    });

    it("reverts for unregistered token", async function () {
      await expect(
        decentNFT.connect(addr1).mintUser(99, 1)
      ).to.be.revertedWith("DecentNFT: token not registered");
    });
  });

  // ── Royalties (ERC-2981) ─────────────────────────────────────────────────────

  describe("Royalties (ERC-2981)", function () {
    const SALE_PRICE = ethers.parseEther("1");

    it("returns correct default royalty info", async function () {
      await decentNFT.registerToken(0, "", ethers.ZeroAddress, 0);
      const [receiver, amount] = await decentNFT.royaltyInfo(0, SALE_PRICE);
      expect(receiver).to.equal(royaltyReceiver.address);
      expect(amount).to.equal((SALE_PRICE * 500n) / 10000n); // 5%
    });

    it("allows owner to update default royalty", async function () {
      await decentNFT.setDefaultRoyalty(addr1.address, 300); // 3%
      await decentNFT.registerToken(0, "", ethers.ZeroAddress, 0);
      const [receiver, amount] = await decentNFT.royaltyInfo(0, SALE_PRICE);
      expect(receiver).to.equal(addr1.address);
      expect(amount).to.equal((SALE_PRICE * 300n) / 10000n);
    });

    it("allows owner to set per-token royalty override", async function () {
      await decentNFT.registerToken(0, "", ethers.ZeroAddress, 0);
      await decentNFT.setTokenRoyalty(0, addr2.address, 750); // 7.5%
      const [receiver, amount] = await decentNFT.royaltyInfo(0, SALE_PRICE);
      expect(receiver).to.equal(addr2.address);
      expect(amount).to.equal((SALE_PRICE * 750n) / 10000n);
    });

    it("can set per-token royalty during registration", async function () {
      await decentNFT.registerToken(0, "", addr1.address, 250); // 2.5%
      const [receiver, amount] = await decentNFT.royaltyInfo(0, SALE_PRICE);
      expect(receiver).to.equal(addr1.address);
      expect(amount).to.equal((SALE_PRICE * 250n) / 10000n);
    });

    it("reverts setDefaultRoyalty when called by non-owner", async function () {
      await expect(
        decentNFT.connect(addr1).setDefaultRoyalty(addr1.address, 500)
      ).to.be.revertedWithCustomError(decentNFT, "OwnableUnauthorizedAccount");
    });
  });

  // ── Creator tracking ─────────────────────────────────────────────────────────

  describe("Creator tracking", function () {
    it("records the owner as creator on registration", async function () {
      await decentNFT.registerToken(0, "", ethers.ZeroAddress, 0);
      expect(await decentNFT.creatorOf(0)).to.equal(owner.address);
    });

    it("returns zero address for unregistered token", async function () {
      expect(await decentNFT.creatorOf(999)).to.equal(ethers.ZeroAddress);
    });
  });
});
