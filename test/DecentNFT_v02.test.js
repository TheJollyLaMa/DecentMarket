// test/DecentNFT_v02.test.js
// Unit tests for DecentNFT_v0.2 (ERC-1155 editionable NFT contract)

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DecentNFT_v0_2", function () {
  const BASE_URI = "ipfs://bafytest123/";
  const ROYALTY_BPS = 500; // 5%

  // TokenKind enum values (must match contract)
  const TokenKind = { Product: 0n, Achievement: 1n };

  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;

  let decentNFT;
  let admin;
  let minter;
  let addr1;
  let addr2;
  let royaltyReceiver;

  beforeEach(async function () {
    [admin, minter, addr1, addr2, royaltyReceiver] = await ethers.getSigners();

    const DecentNFT = await ethers.getContractFactory("DecentNFT_v0_2");
    decentNFT = await DecentNFT.deploy(BASE_URI, royaltyReceiver.address, ROYALTY_BPS);
    await decentNFT.waitForDeployment();
  });

  // ── Deployment ───────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("grants DEFAULT_ADMIN_ROLE to deployer", async function () {
      expect(await decentNFT.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("does not grant MINTER_ROLE to deployer by default", async function () {
      expect(await decentNFT.hasRole(MINTER_ROLE, admin.address)).to.be.false;
    });

    it("supports ERC-1155 interface (0xd9b67a26)", async function () {
      expect(await decentNFT.supportsInterface("0xd9b67a26")).to.be.true;
    });

    it("supports ERC-2981 interface (0x2a55205a)", async function () {
      expect(await decentNFT.supportsInterface("0x2a55205a")).to.be.true;
    });

    it("supports AccessControl interface (0x7965db0b)", async function () {
      expect(await decentNFT.supportsInterface("0x7965db0b")).to.be.true;
    });

    it("starts with nextTokenId = 0", async function () {
      expect(await decentNFT.nextTokenId()).to.equal(0n);
    });
  });

  // ── Role management ──────────────────────────────────────────────────────────

  describe("Role management", function () {
    it("allows admin to grant MINTER_ROLE", async function () {
      await decentNFT.grantRole(MINTER_ROLE, minter.address);
      expect(await decentNFT.hasRole(MINTER_ROLE, minter.address)).to.be.true;
    });

    it("allows admin to revoke MINTER_ROLE", async function () {
      await decentNFT.grantRole(MINTER_ROLE, minter.address);
      await decentNFT.revokeRole(MINTER_ROLE, minter.address);
      expect(await decentNFT.hasRole(MINTER_ROLE, minter.address)).to.be.false;
    });

    it("reverts when non-admin tries to grant MINTER_ROLE", async function () {
      await expect(
        decentNFT.connect(addr1).grantRole(MINTER_ROLE, addr1.address)
      ).to.be.revertedWithCustomError(decentNFT, "AccessControlUnauthorizedAccount");
    });
  });

  // ── Token registration ───────────────────────────────────────────────────────

  describe("registerToken", function () {
    it("allows admin to register a Product token", async function () {
      await expect(
        decentNFT.registerToken(1000, "", TokenKind.Product, ethers.ZeroAddress, 0)
      )
        .to.emit(decentNFT, "TokenRegistered")
        .withArgs(0n, admin.address, 1000n, TokenKind.Product, BASE_URI + "0.json");

      expect(await decentNFT.nextTokenId()).to.equal(1n);
      expect(await decentNFT.creatorOf(0)).to.equal(admin.address);
      expect(await decentNFT.maxSupply(0)).to.equal(1000n);
      expect(await decentNFT.totalMinted(0)).to.equal(0n);
      expect(await decentNFT.kindOf(0)).to.equal(TokenKind.Product);
    });

    it("allows admin to register an Achievement token", async function () {
      await expect(
        decentNFT.registerToken(500, "", TokenKind.Achievement, ethers.ZeroAddress, 0)
      )
        .to.emit(decentNFT, "TokenRegistered")
        .withArgs(0n, admin.address, 500n, TokenKind.Achievement, BASE_URI + "0.json");

      expect(await decentNFT.kindOf(0)).to.equal(TokenKind.Achievement);
    });

    it("assigns ascending token IDs", async function () {
      await decentNFT.registerToken(0, "", TokenKind.Product, ethers.ZeroAddress, 0);
      await decentNFT.registerToken(0, "", TokenKind.Achievement, ethers.ZeroAddress, 0);
      expect(await decentNFT.nextTokenId()).to.equal(2n);
      expect(await decentNFT.kindOf(0)).to.equal(TokenKind.Product);
      expect(await decentNFT.kindOf(1)).to.equal(TokenKind.Achievement);
    });

    it("reverts when called by non-admin", async function () {
      await expect(
        decentNFT.connect(addr1).registerToken(100, "", TokenKind.Product, ethers.ZeroAddress, 0)
      ).to.be.revertedWithCustomError(decentNFT, "AccessControlUnauthorizedAccount");
    });

    it("reverts when called by MINTER_ROLE (insufficient privilege)", async function () {
      await decentNFT.grantRole(MINTER_ROLE, minter.address);
      await expect(
        decentNFT.connect(minter).registerToken(100, "", TokenKind.Achievement, ethers.ZeroAddress, 0)
      ).to.be.revertedWithCustomError(decentNFT, "AccessControlUnauthorizedAccount");
    });

    it("uses per-token URI override when provided", async function () {
      const customURI = "ipfs://custom123/my-token.json";
      await decentNFT.registerToken(0, customURI, TokenKind.Product, ethers.ZeroAddress, 0);
      expect(await decentNFT.uri(0)).to.equal(customURI);
    });

    it("uses base URI pattern when no override is set", async function () {
      await decentNFT.registerToken(0, "", TokenKind.Product, ethers.ZeroAddress, 0);
      expect(await decentNFT.uri(0)).to.equal(BASE_URI + "0.json");
    });
  });

  // ── URI management ───────────────────────────────────────────────────────────

  describe("URI management", function () {
    beforeEach(async function () {
      await decentNFT.registerToken(100, "", TokenKind.Product, ethers.ZeroAddress, 0);
    });

    it("allows admin to update base URI", async function () {
      const newBase = "ipfs://newroot/";
      await decentNFT.setBaseURI(newBase);
      expect(await decentNFT.uri(0)).to.equal(newBase + "0.json");
    });

    it("allows admin to set per-token URI override", async function () {
      const customURI = "ipfs://override/token.json";
      await decentNFT.setTokenURI(0, customURI);
      expect(await decentNFT.uri(0)).to.equal(customURI);
    });

    it("reverts setTokenURI for unregistered token", async function () {
      await expect(decentNFT.setTokenURI(99, "ipfs://x/")).to.be.revertedWith(
        "DecentNFT: token not registered"
      );
    });

    it("reverts setBaseURI when called by non-admin", async function () {
      await expect(
        decentNFT.connect(addr1).setBaseURI("ipfs://hacker/")
      ).to.be.revertedWithCustomError(decentNFT, "AccessControlUnauthorizedAccount");
    });

    it("reverts setBaseURI when called by MINTER_ROLE", async function () {
      await decentNFT.grantRole(MINTER_ROLE, minter.address);
      await expect(
        decentNFT.connect(minter).setBaseURI("ipfs://hacker/")
      ).to.be.revertedWithCustomError(decentNFT, "AccessControlUnauthorizedAccount");
    });
  });

  // ── mintProduct (Lane A — DEFAULT_ADMIN_ROLE only) ───────────────────────────

  describe("mintProduct", function () {
    beforeEach(async function () {
      // tokenId 0 = Product, maxSupply 10
      await decentNFT.registerToken(10, "", TokenKind.Product, ethers.ZeroAddress, 0);
    });

    it("allows admin to mint Product editions", async function () {
      await expect(decentNFT.mintProduct(addr1.address, 0, 3))
        .to.emit(decentNFT, "EditionMinted")
        .withArgs(0n, addr1.address, 3n, admin.address);

      expect(await decentNFT.balanceOf(addr1.address, 0)).to.equal(3n);
      expect(await decentNFT.totalMinted(0)).to.equal(3n);
    });

    it("respects the supply cap", async function () {
      await decentNFT.mintProduct(addr1.address, 0, 8);
      await expect(
        decentNFT.mintProduct(addr1.address, 0, 3) // would bring total to 11 > 10
      ).to.be.revertedWith("DecentNFT: exceeds supply cap");
    });

    it("allows minting up to the cap exactly", async function () {
      await decentNFT.mintProduct(addr1.address, 0, 10);
      expect(await decentNFT.totalMinted(0)).to.equal(10n);
    });

    it("supports unlimited supply (maxSupply = 0)", async function () {
      await decentNFT.registerToken(0, "", TokenKind.Product, ethers.ZeroAddress, 0); // tokenId 1
      await decentNFT.mintProduct(addr1.address, 1, 9999);
      expect(await decentNFT.totalMinted(1)).to.equal(9999n);
    });

    it("reverts when called by non-admin", async function () {
      await expect(
        decentNFT.connect(addr1).mintProduct(addr1.address, 0, 1)
      ).to.be.revertedWithCustomError(decentNFT, "AccessControlUnauthorizedAccount");
    });

    it("reverts when called by MINTER_ROLE (insufficient privilege)", async function () {
      await decentNFT.grantRole(MINTER_ROLE, minter.address);
      await expect(
        decentNFT.connect(minter).mintProduct(addr1.address, 0, 1)
      ).to.be.revertedWithCustomError(decentNFT, "AccessControlUnauthorizedAccount");
    });

    it("reverts for unregistered token", async function () {
      await expect(
        decentNFT.mintProduct(addr1.address, 99, 1)
      ).to.be.revertedWith("DecentNFT: token not registered");
    });

    it("reverts when amount is zero", async function () {
      await expect(
        decentNFT.mintProduct(addr1.address, 0, 0)
      ).to.be.revertedWith("DecentNFT: amount must be > 0");
    });

    it("reverts when tokenId is an Achievement token", async function () {
      // Register an Achievement token (tokenId 1)
      await decentNFT.registerToken(0, "", TokenKind.Achievement, ethers.ZeroAddress, 0);
      await expect(
        decentNFT.mintProduct(addr1.address, 1, 1)
      ).to.be.revertedWith("DecentNFT: not a Product token");
    });
  });

  // ── mintAchievement (Lane B — MINTER_ROLE only) ──────────────────────────────

  describe("mintAchievement", function () {
    beforeEach(async function () {
      // Grant MINTER_ROLE to minter
      await decentNFT.grantRole(MINTER_ROLE, minter.address);
      // tokenId 0 = Achievement, maxSupply 5
      await decentNFT.registerToken(5, "", TokenKind.Achievement, ethers.ZeroAddress, 0);
    });

    it("allows MINTER_ROLE to mint Achievement editions", async function () {
      await expect(decentNFT.connect(minter).mintAchievement(addr1.address, 0, 2))
        .to.emit(decentNFT, "EditionMinted")
        .withArgs(0n, addr1.address, 2n, minter.address);

      expect(await decentNFT.balanceOf(addr1.address, 0)).to.equal(2n);
    });

    it("respects the supply cap across multiple minters", async function () {
      await decentNFT.connect(minter).mintAchievement(addr1.address, 0, 3);
      await decentNFT.connect(minter).mintAchievement(addr2.address, 0, 2);
      await expect(
        decentNFT.connect(minter).mintAchievement(addr1.address, 0, 1) // total would be 6 > 5
      ).to.be.revertedWith("DecentNFT: exceeds supply cap");
    });

    it("supports unlimited Achievement supply (maxSupply = 0)", async function () {
      await decentNFT.registerToken(0, "", TokenKind.Achievement, ethers.ZeroAddress, 0); // tokenId 1
      await decentNFT.connect(minter).mintAchievement(addr1.address, 1, 9999);
      expect(await decentNFT.totalMinted(1)).to.equal(9999n);
    });

    it("reverts when called by non-minter (unpermissioned wallet)", async function () {
      await expect(
        decentNFT.connect(addr1).mintAchievement(addr1.address, 0, 1)
      ).to.be.revertedWithCustomError(decentNFT, "AccessControlUnauthorizedAccount");
    });

    it("reverts when called by admin without MINTER_ROLE", async function () {
      await expect(
        decentNFT.mintAchievement(addr1.address, 0, 1)
      ).to.be.revertedWithCustomError(decentNFT, "AccessControlUnauthorizedAccount");
    });

    it("reverts for unregistered token", async function () {
      await expect(
        decentNFT.connect(minter).mintAchievement(addr1.address, 99, 1)
      ).to.be.revertedWith("DecentNFT: token not registered");
    });

    it("reverts when tokenId is a Product token", async function () {
      // Register a Product token (tokenId 1)
      await decentNFT.registerToken(0, "", TokenKind.Product, ethers.ZeroAddress, 0);
      await expect(
        decentNFT.connect(minter).mintAchievement(addr1.address, 1, 1)
      ).to.be.revertedWith("DecentNFT: not an Achievement token");
    });

    it("BigNuten use case: admin registers achievement IDs, minter issues at runtime", async function () {
      // Admin registers achievement token IDs
      await decentNFT.registerToken(0, "ipfs://meta/weigh7.json", TokenKind.Achievement, ethers.ZeroAddress, 0); // tokenId 1
      await decentNFT.registerToken(0, "ipfs://meta/weigh30.json", TokenKind.Achievement, ethers.ZeroAddress, 0); // tokenId 2

      // Minter (BigNuten issuer wallet) issues achievements at runtime
      await decentNFT.connect(minter).mintAchievement(addr1.address, 1, 1);
      await decentNFT.connect(minter).mintAchievement(addr1.address, 2, 1);

      expect(await decentNFT.balanceOf(addr1.address, 1)).to.equal(1n);
      expect(await decentNFT.balanceOf(addr1.address, 2)).to.equal(1n);
      expect(await decentNFT.uri(1)).to.equal("ipfs://meta/weigh7.json");
    });
  });

  // ── Royalties (ERC-2981) ─────────────────────────────────────────────────────

  describe("Royalties (ERC-2981)", function () {
    const SALE_PRICE = ethers.parseEther("1");

    it("returns correct default royalty info", async function () {
      await decentNFT.registerToken(0, "", TokenKind.Product, ethers.ZeroAddress, 0);
      const [receiver, amount] = await decentNFT.royaltyInfo(0, SALE_PRICE);
      expect(receiver).to.equal(royaltyReceiver.address);
      expect(amount).to.equal((SALE_PRICE * 500n) / 10000n); // 5%
    });

    it("allows admin to update default royalty", async function () {
      await decentNFT.setDefaultRoyalty(addr1.address, 300); // 3%
      await decentNFT.registerToken(0, "", TokenKind.Product, ethers.ZeroAddress, 0);
      const [receiver, amount] = await decentNFT.royaltyInfo(0, SALE_PRICE);
      expect(receiver).to.equal(addr1.address);
      expect(amount).to.equal((SALE_PRICE * 300n) / 10000n);
    });

    it("allows admin to set per-token royalty override", async function () {
      await decentNFT.registerToken(0, "", TokenKind.Product, ethers.ZeroAddress, 0);
      await decentNFT.setTokenRoyalty(0, addr2.address, 750); // 7.5%
      const [receiver, amount] = await decentNFT.royaltyInfo(0, SALE_PRICE);
      expect(receiver).to.equal(addr2.address);
      expect(amount).to.equal((SALE_PRICE * 750n) / 10000n);
    });

    it("can set per-token royalty during registration", async function () {
      await decentNFT.registerToken(0, "", TokenKind.Product, addr1.address, 250); // 2.5%
      const [receiver, amount] = await decentNFT.royaltyInfo(0, SALE_PRICE);
      expect(receiver).to.equal(addr1.address);
      expect(amount).to.equal((SALE_PRICE * 250n) / 10000n);
    });

    it("reverts setDefaultRoyalty when called by non-admin", async function () {
      await expect(
        decentNFT.connect(addr1).setDefaultRoyalty(addr1.address, 500)
      ).to.be.revertedWithCustomError(decentNFT, "AccessControlUnauthorizedAccount");
    });

    it("reverts setDefaultRoyalty when called by MINTER_ROLE", async function () {
      await decentNFT.grantRole(MINTER_ROLE, minter.address);
      await expect(
        decentNFT.connect(minter).setDefaultRoyalty(minter.address, 500)
      ).to.be.revertedWithCustomError(decentNFT, "AccessControlUnauthorizedAccount");
    });
  });

  // ── Creator tracking ─────────────────────────────────────────────────────────

  describe("Creator tracking", function () {
    it("records the admin as creator on registration", async function () {
      await decentNFT.registerToken(0, "", TokenKind.Product, ethers.ZeroAddress, 0);
      expect(await decentNFT.creatorOf(0)).to.equal(admin.address);
    });

    it("returns zero address for unregistered token", async function () {
      expect(await decentNFT.creatorOf(999)).to.equal(ethers.ZeroAddress);
    });
  });
});

