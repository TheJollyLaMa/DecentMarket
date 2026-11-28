const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("DecentNFT_v0_4 creator permissions", function () {
  const CAP = 1000; // 10 %
  let nft, admin, alice, bob, collector, pauser, splitter;

  const projectId = (address, key = "forest") => `decent-project:${address.toLowerCase()}:${key}`;
  const projectHash = (address, key = "forest") => ethers.id(projectId(address, key));
  const approveProject = (address, key = "forest", approved = true) =>
    nft.setCreatorProjectApproval(address, projectId(address, key), approved);
  const create = (signer, overrides = {}) => {
    const o = { amount: 1, maxSupply: 10, uri: "ipfs://alice-supporter", receiver: signer.address, bps: 500, project: projectHash(signer.address), ...overrides };
    return nft.connect(signer).registerAndMintProduct(o.amount, o.maxSupply, o.uri, o.receiver, o.bps, o.project);
  };
  const createWithGift = (signer, giftRecipient, overrides = {}) => {
    const o = { amount: 10, maxSupply: 100, uri: "ipfs://alice-supporter", receiver: signer.address, bps: 500, project: projectHash(signer.address), ...overrides };
    return nft.connect(signer).registerAndMintProductWithGift(o.amount, o.maxSupply, o.uri, o.receiver, o.bps, o.project, giftRecipient);
  };
  const adminProduct = (recipient, overrides = {}) => ({
    recipient, amount: 1, maxSupply: 10, tokenURI: "ipfs://agency", royaltyReceiver: admin.address, royaltyFeeBps: 500, ...overrides,
  });

  beforeEach(async function () {
    [admin, alice, bob, collector, pauser, splitter] = await ethers.getSigners();
    nft = await (await ethers.getContractFactory("DecentNFT_v0_4")).deploy("", admin.address, 500, CAP);
    await nft.authorizeCreator(alice.address, 100);
    await nft.authorizeCreator(bob.address, 100);
    await approveProject(alice.address);
    await approveProject(bob.address);
  });

  describe("authorization boundaries", function () {
    it("lets an authorized creator register and mint only to themselves with full provenance", async function () {
      const tx = create(alice, { amount: 4 });
      await expect(tx).to.emit(nft, "TokenRegistered").withArgs(0, alice.address, 10, 0, "ipfs://alice-supporter");
      await expect(tx).to.emit(nft, "EditionMinted").withArgs(0, alice.address, 4, alice.address);
      await expect(tx).to.emit(nft, "CreatorProductRegistered").withArgs(0, alice.address, alice.address, 500, 10);
      await expect(tx).to.emit(nft, "CreatorProjectLinked").withArgs(0, alice.address, projectHash(alice.address));
      await expect(tx).to.emit(nft, "TransferSingle").withArgs(alice.address, ethers.ZeroAddress, alice.address, 0, 4);
      expect(await nft.creatorOf(0)).to.equal(alice.address);
      expect(await nft.productCreator(0)).to.equal(alice.address);
      expect(await nft.productProject(0)).to.equal(projectHash(alice.address));
      expect(await nft.kindOf(0)).to.equal(0);
      expect(await nft.balanceOf(alice.address, 0)).to.equal(4);
      expect(await nft.uri(0)).to.equal("ipfs://alice-supporter");
    });

    it("requires a creator role, an approved project and an edition limit", async function () {
      await expect(create(collector)).to.be.revertedWithCustomError(nft, "AccessControlUnauthorizedAccount")
        .withArgs(collector.address, await nft.CREATOR_ROLE());
      await nft.grantRole(await nft.CREATOR_ROLE(), collector.address);
      await expect(create(collector)).to.be.revertedWithCustomError(nft, "CreatorProjectNotApproved");
      expect(await nft.creatorProjectLimit(collector.address)).to.equal(10);
      await approveProject(collector.address);
      await expect(create(collector)).to.be.revertedWithCustomError(nft, "InvalidCreatorSupply").withArgs(10, 0);
    });

    it("never gives creators admin, role, achievement or collection-wide product powers", async function () {
      await create(alice);
      const admin_ = await nft.DEFAULT_ADMIN_ROLE();
      const asAlice = nft.connect(alice);
      const CREATOR = await nft.CREATOR_ROLE();
      const MINTER = await nft.MINTER_ROLE();
      expect(await nft.hasRole(admin_, alice.address)).to.equal(false);
      const denied = [
        () => asAlice.grantRole(CREATOR, collector.address),
        () => asAlice.revokeRole(CREATOR, bob.address),
        () => asAlice.grantRole(MINTER, alice.address),
        () => asAlice.authorizeCreator(alice.address, 1000),
        () => asAlice.setCreatorProjectLimit(alice.address, 1000),
        () => asAlice.setCreatorProjectApproval(alice.address, projectId(alice.address, "unapproved"), true),
        () => asAlice.registerToken(0, "ipfs://x", 1, alice.address, 9000),
        () => asAlice.mintProduct(alice.address, 0, 1),
        () => asAlice.registerAndMintProductsBatch([adminProduct(alice.address)]),
        () => asAlice.setTokenURI(0, "ipfs://changed"),
        () => asAlice.setTokenRoyalty(0, alice.address, 9000),
        () => asAlice.setDefaultRoyalty(alice.address, 9000),
        () => asAlice.setCreatorRoyaltyCap(2500),
        () => asAlice.unpause(),
        () => asAlice.recoverETH(alice.address, 0),
        () => asAlice.multicall([nft.interface.encodeFunctionData("registerToken", [0, "ipfs://x", 0, alice.address, 0])]),
      ];
      for (const call of denied) await expect(call()).to.be.revertedWithCustomError(nft, "AccessControlUnauthorizedAccount");
      await expect(asAlice.mintAchievement(alice.address, 0, 1)).to.be.revertedWithCustomError(nft, "AccessControlUnauthorizedAccount");
    });

    it("stops creators minting or re-royaltying another creator's or the Agency's products", async function () {
      await create(alice);
      await nft.registerAndMintProductsBatch([adminProduct(admin.address)]);
      await expect(nft.connect(bob).mintCreatorProduct(0, 1))
        .to.be.revertedWithCustomError(nft, "NotProductCreator").withArgs(0, bob.address);
      await expect(nft.connect(bob).mintCreatorProduct(1, 1))
        .to.be.revertedWithCustomError(nft, "NotProductCreator").withArgs(1, bob.address);
      await expect(nft.connect(bob).setCreatorProductRoyalty(0, bob.address, 100))
        .to.be.revertedWithCustomError(nft, "NotProductCreator");
      await expect(nft.connect(alice).setCreatorProductRoyalty(1, alice.address, 100))
        .to.be.revertedWithCustomError(nft, "NotProductCreator");
    });

    it("stops the admin minting, re-royaltying or re-pointing a creator's product", async function () {
      await create(alice);
      await expect(nft.mintProduct(admin.address, 0, 1)).to.be.revertedWithCustomError(nft, "CreatorProductLocked").withArgs(0);
      await expect(nft.mintProduct(alice.address, 0, 1)).to.be.revertedWithCustomError(nft, "CreatorProductLocked");
      await expect(nft.setTokenRoyalty(0, admin.address, 500)).to.be.revertedWithCustomError(nft, "CreatorProductLocked");
      await expect(nft.setTokenURI(0, "ipfs://impersonation")).to.be.revertedWithCustomError(nft, "CreatorProductLocked");
      for (const data of [
        nft.interface.encodeFunctionData("mintProduct", [admin.address, 0, 1]),
        nft.interface.encodeFunctionData("setTokenRoyalty", [0, admin.address, 500]),
        nft.interface.encodeFunctionData("setTokenURI", [0, "ipfs://impersonation"]),
      ]) await expect(nft.multicall([data])).to.be.revertedWithCustomError(nft, "CreatorProductLocked");
      await nft.setDefaultRoyalty(admin.address, 2000);
      expect(await nft.royaltyInfo(0, 10000)).to.deep.equal([alice.address, 500n]);
      expect(await nft.totalMinted(0)).to.equal(1);
      expect(await nft.uri(0)).to.equal("ipfs://alice-supporter");
      // Admin products keep v0.2/v0.3 behavior.
      await nft.registerAndMintProductsBatch([adminProduct(collector.address)]);
      await nft.setTokenURI(1, "ipfs://agency-v2");
      await nft.mintProduct(collector.address, 1, 2);
      expect(await nft.creatorOf(1)).to.equal(admin.address);
      expect(await nft.productCreator(1)).to.equal(ethers.ZeroAddress);
    });

    it("blocks re-entrant escalation from a contract creator's receive hook", async function () {
      const creator = await (await ethers.getContractFactory("MockReentrantCreator")).deploy(await nft.getAddress());
      const address = await creator.getAddress(), project = projectHash(address);
      await nft.authorizeCreator(address, 10);
      await approveProject(address);
      const expectedErrors = {
        1: nft.interface.getError("AccessControlUnauthorizedAccount").selector,
        2: nft.interface.getError("AccessControlUnauthorizedAccount").selector,
        3: nft.interface.getError("ReentrancyGuardReentrantCall").selector,
      };
      for (const mode of [1, 2, 3]) {
        await creator.setMode(mode);
        const before = await nft.nextTokenId();
        await creator.create(1, 10, project);
        expect(await creator.attempted()).to.equal(true);
        expect(await creator.reentrySucceeded()).to.equal(false);
        expect((await creator.reentryError()).slice(0, 10)).to.equal(expectedErrors[mode]);
        expect(await nft.nextTokenId()).to.equal(before + 1n);
        expect(await nft.totalMinted(before)).to.equal(1);
      }
      expect(await nft.creatorOf(0)).to.equal(await creator.getAddress());
    });
  });

  describe("optional edition gifts", function () {
    it("rounds each opted-in gift down and keeps the total minted within the chosen amount", async function () {
      await nft.setEditionGiftRecipient(collector.address);
      for (const [amount, gifted] of [[1, 0], [9, 0], [10, 1], [19, 1], [20, 2], [99, 9]]) {
        const tokenId = await nft.nextTokenId();
        await expect(createWithGift(alice, collector.address, { amount, maxSupply: amount }))
          .to.emit(nft, "CreatorEditionsGifted").withArgs(tokenId, alice.address, collector.address, gifted);
        expect(await nft.balanceOf(alice.address, tokenId)).to.equal(BigInt(amount - gifted));
        expect(await nft.balanceOf(collector.address, tokenId)).to.equal(BigInt(gifted));
        expect(await nft.totalMinted(tokenId)).to.equal(BigInt(amount));
      }
    });

    it("gifts only on explicit opt-in, including subsequent mint transactions", async function () {
      await nft.setEditionGiftRecipient(collector.address);
      await create(alice, { amount: 10, maxSupply: 50 });
      expect(await nft.balanceOf(collector.address, 0)).to.equal(0);
      await expect(nft.connect(alice).mintCreatorProductWithGift(0, 19, collector.address))
        .to.emit(nft, "EditionMinted").withArgs(0, alice.address, 18, alice.address)
        .and.to.emit(nft, "EditionMinted").withArgs(0, collector.address, 1, alice.address)
        .and.to.emit(nft, "CreatorEditionsGifted").withArgs(0, alice.address, collector.address, 1);
      await nft.connect(alice).mintCreatorProduct(0, 10);
      expect(await nft.balanceOf(alice.address, 0)).to.equal(38);
      expect(await nft.balanceOf(collector.address, 0)).to.equal(1);
      expect(await nft.totalMinted(0)).to.equal(39);
      await expect(nft.connect(bob).mintCreatorProductWithGift(0, 10, collector.address))
        .to.be.revertedWithCustomError(nft, "NotProductCreator");

      await createWithGift(alice, collector.address, { amount: 9, maxSupply: 18 });
      await nft.connect(alice).mintCreatorProductWithGift(1, 9, collector.address);
      expect(await nft.balanceOf(alice.address, 1)).to.equal(18);
      expect(await nft.balanceOf(collector.address, 1)).to.equal(0);
    });

    it("requires the creator's expected recipient to match the admin configuration", async function () {
      await expect(nft.connect(alice).setEditionGiftRecipient(collector.address))
        .to.be.revertedWithCustomError(nft, "AccessControlUnauthorizedAccount");
      await expect(nft.setEditionGiftRecipient(await nft.getAddress()))
        .to.be.revertedWithCustomError(nft, "InvalidGiftRecipient");
      await expect(createWithGift(alice, collector.address))
        .to.be.revertedWithCustomError(nft, "GiftRecipientMismatch").withArgs(collector.address, ethers.ZeroAddress);
      await expect(nft.setEditionGiftRecipient(collector.address))
        .to.emit(nft, "EditionGiftRecipientUpdated").withArgs(collector.address);
      await expect(createWithGift(alice, ethers.ZeroAddress))
        .to.be.revertedWithCustomError(nft, "GiftRecipientMismatch");
      await nft.setEditionGiftRecipient(bob.address);
      await expect(createWithGift(alice, collector.address))
        .to.be.revertedWithCustomError(nft, "GiftRecipientMismatch").withArgs(collector.address, bob.address);
      expect(await nft.nextTokenId()).to.equal(0);
      expect(await nft.creatorEditionLimit(alice.address)).to.equal(100);
      await nft.setEditionGiftRecipient(ethers.ZeroAddress);
      await create(alice, { amount: 10 });
      expect(await nft.balanceOf(alice.address, 0)).to.equal(10);
    });

    it("rolls back the entire mint if the gift recipient rejects editions", async function () {
      const receiver = await (await ethers.getContractFactory("RejectingNFTReceiver")).deploy();
      const recipient = await receiver.getAddress();
      await nft.setEditionGiftRecipient(recipient);
      await expect(createWithGift(alice, recipient, { amount: 10, maxSupply: 10 })).to.be.revertedWith("Receiver rejected mint");
      expect(await nft.nextTokenId()).to.equal(0);
      expect(await nft.creatorEditionLimit(alice.address)).to.equal(100);
      await expect(createWithGift(alice, recipient, { amount: 9, maxSupply: 9 }))
        .to.emit(nft, "CreatorEditionsGifted").withArgs(0, alice.address, recipient, 0);
      expect(await nft.balanceOf(alice.address, 0)).to.equal(9);
    });

    it("rolls back both sides of a gift when the requested total exceeds the supply cap", async function () {
      await nft.setEditionGiftRecipient(collector.address);
      await create(alice, { amount: 1, maxSupply: 10 });
      await expect(nft.connect(alice).mintCreatorProductWithGift(0, 10, collector.address))
        .to.be.revertedWith("DecentNFT: exceeds supply cap");
      expect(await nft.balanceOf(alice.address, 0)).to.equal(1);
      expect(await nft.balanceOf(collector.address, 0)).to.equal(0);
      expect(await nft.totalMinted(0)).to.equal(1);
    });

    it("closes mint authorization before an admin gift recipient's receiver callback", async function () {
      const receiver = await (await ethers.getContractFactory("MockReentrantCreator")).deploy(await nft.getAddress());
      const recipient = await receiver.getAddress();
      await nft.grantRole(await nft.DEFAULT_ADMIN_ROLE(), recipient);
      await nft.setEditionGiftRecipient(recipient);
      await receiver.setMode(2);
      await createWithGift(alice, recipient, { amount: 10, maxSupply: 20 });
      expect(await receiver.attempted()).to.equal(true);
      expect(await receiver.reentrySucceeded()).to.equal(false);
      expect((await receiver.reentryError()).slice(0, 10)).to.equal(nft.interface.getError("CreatorProductLocked").selector);
      expect(await nft.totalMinted(0)).to.equal(10);
      expect(await nft.balanceOf(recipient, 0)).to.equal(1);
    });

    it("also closes mint authorization before a creator-admin's own receiver callback", async function () {
      const creator = await (await ethers.getContractFactory("MockReentrantCreator")).deploy(await nft.getAddress());
      const address = await creator.getAddress();
      await nft.authorizeCreator(address, 10);
      await approveProject(address);
      await nft.grantRole(await nft.DEFAULT_ADMIN_ROLE(), address);
      await creator.setMode(2);
      await creator.create(1, 10, projectHash(address));
      expect(await creator.reentrySucceeded()).to.equal(false);
      expect((await creator.reentryError()).slice(0, 10)).to.equal(nft.interface.getError("CreatorProductLocked").selector);
      expect(await nft.totalMinted(0)).to.equal(1);
    });
  });

  describe("royalties", function () {
    it("requires the creator wallet as receiver and enforces the creator royalty cap", async function () {
      await expect(create(alice, { bps: CAP + 1 })).to.be.revertedWithCustomError(nft, "InvalidCreatorRoyalty")
        .withArgs(alice.address, CAP + 1, CAP);
      await expect(create(alice, { receiver: ethers.ZeroAddress })).to.be.revertedWithCustomError(nft, "InvalidCreatorRoyalty");
      await expect(create(alice, { receiver: splitter.address })).to.be.revertedWithCustomError(nft, "InvalidCreatorRoyalty");
      await create(alice, { bps: CAP });
      expect(await nft.royaltyInfo(0, 10000)).to.deep.equal([alice.address, BigInt(CAP)]);
      await create(alice, { bps: 0 });
      expect(await nft.royaltyInfo(1, 10000)).to.deep.equal([alice.address, 0n]);
    });

    it("lets only the creator change their royalty rate within the cap", async function () {
      await create(alice);
      await nft.connect(alice).setCreatorProductRoyalty(0, alice.address, 750);
      expect(await nft.royaltyInfo(0, 10000)).to.deep.equal([alice.address, 750n]);
      await expect(nft.connect(alice).setCreatorProductRoyalty(0, splitter.address, 750))
        .to.be.revertedWithCustomError(nft, "InvalidCreatorRoyalty");
      await expect(nft.connect(alice).setCreatorProductRoyalty(0, alice.address, CAP + 1))
        .to.be.revertedWithCustomError(nft, "InvalidCreatorRoyalty");
      await expect(nft.setCreatorRoyaltyCap(CAP + 1)).to.be.revertedWithCustomError(nft, "RoyaltyCapTooHigh");
      await expect(nft.setCreatorRoyaltyCap(200)).to.emit(nft, "CreatorRoyaltyCapUpdated").withArgs(200);
      expect(await nft.royaltyInfo(0, 10000)).to.deep.equal([alice.address, 750n]);
      await expect(create(alice, { bps: 201 })).to.be.revertedWithCustomError(nft, "InvalidCreatorRoyalty");
      await expect((await ethers.getContractFactory("DecentNFT_v0_4")).deploy("", admin.address, 500, CAP + 1))
        .to.be.revertedWithCustomError(nft, "RoyaltyCapTooHigh");
    });
  });

  describe("limits, supply and revocation", function () {
    it("counts ten distinct lifetime projects, not series or repeated approvals", async function () {
      expect(await nft.creatorProjectLimit(alice.address)).to.equal(10);
      for (let i = 1; i < 10; i++) await approveProject(alice.address, `project-${i}`);
      expect(await nft.creatorProjectCount(alice.address)).to.equal(10);
      await create(alice);
      await create(alice);
      await approveProject(alice.address, "forest", false);
      await expect(approveProject(alice.address, "eleventh"))
        .to.be.revertedWithCustomError(nft, "CreatorProjectLimitReached").withArgs(alice.address, 10);
      await approveProject(alice.address);
      await approveProject(alice.address);
      expect(await nft.creatorProjectCount(alice.address)).to.equal(10);
      await nft.revokeCreator(alice.address);
      await nft.authorizeCreator(alice.address, 100);
      await approveProject(alice.address);
      expect(await nft.creatorProjectCount(alice.address)).to.equal(10);
      await expect(approveProject(alice.address, "eleventh"))
        .to.be.revertedWithCustomError(nft, "CreatorProjectLimitReached").withArgs(alice.address, 10);
      await expect(nft.setCreatorProjectLimit(alice.address, 11))
        .to.emit(nft, "CreatorProjectLimitUpdated").withArgs(alice.address, 11);
      await approveProject(alice.address, "eleventh");
      expect(await nft.creatorProjectCount(alice.address)).to.equal(11);
      await nft.setCreatorProjectLimit(alice.address, 5);
      expect(await nft.isCreatorProjectApproved(alice.address, projectHash(alice.address, "eleventh"))).to.equal(true);
      await expect(approveProject(alice.address, "twelfth"))
        .to.be.revertedWithCustomError(nft, "CreatorProjectLimitReached").withArgs(alice.address, 5);
      await approveProject(alice.address);
    });

    it("preserves a steward-set project limit across later creator authorization", async function () {
      await nft.setCreatorProjectLimit(collector.address, 0);
      await nft.grantRole(await nft.CREATOR_ROLE(), collector.address);
      expect(await nft.creatorProjectLimit(collector.address)).to.equal(0);
      await expect(approveProject(collector.address)).to.be.revertedWithCustomError(nft, "CreatorProjectLimitReached");
      await nft.authorizeCreator(collector.address, 10);
      expect(await nft.creatorProjectLimit(collector.address)).to.equal(0);
      await nft.setCreatorProjectLimit(collector.address, 1);
      await approveProject(collector.address);
      await nft.revokeCreator(collector.address);
      await nft.authorizeCreator(collector.address, 10);
      expect(await nft.creatorProjectLimit(collector.address)).to.equal(1);
      await approveProject(collector.address);
      await expect(approveProject(collector.address, "another")).to.be.revertedWithCustomError(nft, "CreatorProjectLimitReached");
    });

    it("enforces finite supply and the per-product edition limit", async function () {
      await expect(create(alice, { maxSupply: 0 })).to.be.revertedWithCustomError(nft, "InvalidCreatorSupply").withArgs(0, 100);
      await expect(create(alice, { maxSupply: 101 })).to.be.revertedWithCustomError(nft, "InvalidCreatorSupply").withArgs(101, 100);
      await expect(create(alice, { amount: 0 })).to.be.revertedWithCustomError(nft, "ZeroAmount");
      await expect(create(alice, { uri: "" })).to.be.revertedWithCustomError(nft, "MetadataURIRequired");
      await expect(create(alice, { amount: 11 })).to.be.revertedWith("DecentNFT: exceeds supply cap");
      await create(alice, { amount: 9 });
      await nft.connect(alice).mintCreatorProduct(0, 1);
      await expect(nft.connect(alice).mintCreatorProduct(0, 1)).to.be.revertedWith("DecentNFT: exceeds supply cap");
      await create(alice);
      await nft.authorizeCreator(alice.address, 5);
      await expect(create(alice)).to.be.revertedWithCustomError(nft, "InvalidCreatorSupply").withArgs(10, 5);
      await nft.connect(alice).mintCreatorProduct(1, 1);
      expect(await nft.totalMinted(1)).to.equal(2);
    });

    it("validates wallet-bound canonical IDs and permits many series per approved project", async function () {
      await expect(nft.setCreatorProjectApproval(collector.address, projectId(collector.address), true))
        .to.be.revertedWithCustomError(nft, "CreatorNotAuthorized");
      for (const id of [
        projectId(bob.address),
        `decent-project:${alice.address.toUpperCase()}:forest`,
        projectId(alice.address, ""),
        projectId(alice.address, "a".repeat(51)),
        projectId(alice.address, "a/b"),
        projectId(alice.address, "caf\u00e9"),
      ]) await expect(nft.setCreatorProjectApproval(alice.address, id, true))
        .to.be.revertedWithCustomError(nft, "InvalidCanopyProjectId");

      const second = projectId(alice.address, "Art_1-X"), secondHash = ethers.id(second);
      await expect(nft.setCreatorProjectApproval(alice.address, second, true))
        .to.emit(nft, "CreatorProjectApproval").withArgs(alice.address, secondHash, second, true);
      const longest = projectId(alice.address, "a".repeat(50));
      await nft.setCreatorProjectApproval(alice.address, longest, true);
      expect(await nft.isCreatorProjectApproved(alice.address, ethers.id(longest))).to.equal(true);
      for (let i = 0; i < 5; i++) await create(alice);
      await create(alice, { project: secondHash });
      expect(await nft.nextTokenId()).to.equal(6);
      expect(await nft.productProject(4)).to.equal(projectHash(alice.address));
      expect(await nft.productProject(5)).to.equal(secondHash);
      await expect(create(alice, { project: projectHash(bob.address) }))
        .to.be.revertedWithCustomError(nft, "CreatorProjectNotApproved").withArgs(alice.address, projectHash(bob.address));
    });

    it("revokes project minting without affecting transfers, other projects, or royalty updates", async function () {
      const secondHash = projectHash(alice.address, "music");
      await approveProject(alice.address, "music");
      await nft.setEditionGiftRecipient(collector.address);
      await create(alice, { amount: 2 });
      await create(alice, { project: secondHash });
      await expect(approveProject(alice.address, "forest", false))
        .to.emit(nft, "CreatorProjectApproval")
        .withArgs(alice.address, projectHash(alice.address), projectId(alice.address), false);
      expect(await nft.isCreatorProjectApproved(alice.address, projectHash(alice.address))).to.equal(false);
      await expect(create(alice)).to.be.revertedWithCustomError(nft, "CreatorProjectNotApproved");
      await expect(createWithGift(alice, collector.address)).to.be.revertedWithCustomError(nft, "CreatorProjectNotApproved");
      await expect(nft.connect(alice).mintCreatorProduct(0, 1)).to.be.revertedWithCustomError(nft, "CreatorProjectNotApproved");
      await expect(nft.connect(alice).mintCreatorProductWithGift(0, 1, collector.address))
        .to.be.revertedWithCustomError(nft, "CreatorProjectNotApproved");
      await nft.connect(alice).safeTransferFrom(alice.address, collector.address, 0, 1, "0x");
      await nft.connect(alice).setCreatorProductRoyalty(0, alice.address, 100);
      await nft.connect(alice).mintCreatorProduct(1, 1);
      await approveProject(alice.address);
      await nft.connect(alice).mintCreatorProduct(0, 1);
      expect(await nft.totalMinted(0)).to.equal(3);
    });

    it("invalidates old project approvals on every creator role revocation path", async function () {
      const role = await nft.CREATOR_ROLE(), hash = projectHash(alice.address);
      for (const revoke of [
        () => nft.revokeCreator(alice.address),
        () => nft.revokeRole(role, alice.address),
        () => nft.connect(alice).renounceRole(role, alice.address),
      ]) {
        const tokenId = await nft.nextTokenId();
        await create(alice);
        await revoke();
        expect(await nft.creatorEditionLimit(alice.address)).to.equal(0);
        expect(await nft.isCreatorProjectApproved(alice.address, hash)).to.equal(false);
        await nft.grantRole(role, alice.address);
        await expect(nft.connect(alice).mintCreatorProduct(tokenId, 1))
          .to.be.revertedWithCustomError(nft, "CreatorProjectNotApproved");
        await nft.authorizeCreator(alice.address, 100);
        await expect(create(alice)).to.be.revertedWithCustomError(nft, "CreatorProjectNotApproved");
        await approveProject(alice.address);
        await nft.connect(alice).mintCreatorProduct(tokenId, 1);
      }
    });

    it("revokes minting while preserving creator ownership and royalty control", async function () {
      await create(alice, { amount: 2 });
      await expect(nft.revokeCreator(alice.address)).to.emit(nft, "CreatorRevoked").withArgs(alice.address);
      expect(await nft.hasRole(await nft.CREATOR_ROLE(), alice.address)).to.equal(false);
      await expect(create(alice)).to.be.revertedWithCustomError(nft, "AccessControlUnauthorizedAccount");
      await expect(nft.connect(alice).mintCreatorProduct(0, 1)).to.be.revertedWithCustomError(nft, "AccessControlUnauthorizedAccount");
      await nft.connect(alice).setCreatorProductRoyalty(0, alice.address, 1);
      expect(await nft.royaltyInfo(0, 10000)).to.deep.equal([alice.address, 1n]);
      await expect(nft.connect(bob).setCreatorProductRoyalty(0, bob.address, 1))
        .to.be.revertedWithCustomError(nft, "NotProductCreator");
      await expect(nft.mintProduct(admin.address, 0, 1)).to.be.revertedWithCustomError(nft, "CreatorProductLocked");
      expect(await nft.creatorOf(0)).to.equal(alice.address);
      await nft.connect(alice).safeTransferFrom(alice.address, collector.address, 0, 1, "0x");
      expect(await nft.balanceOf(collector.address, 0)).to.equal(1);
      await nft.grantRole(await nft.CREATOR_ROLE(), alice.address);
      await expect(create(alice)).to.be.revertedWithCustomError(nft, "CreatorProjectNotApproved");
    });
  });

  describe("atomic batches and token-ID sequencing", function () {
    it("interleaves Agency and creator registrations on one sequential ID space", async function () {
      await nft.registerToken(0, "ipfs://agency-0", 0, ethers.ZeroAddress, 0);
      await create(alice);
      await nft.registerAndMintProductsBatch([adminProduct(collector.address), adminProduct(collector.address)]);
      await create(bob, { uri: "ipfs://bob" });
      expect(await nft.nextTokenId()).to.equal(5);
      expect(await Promise.all([0, 1, 2, 3, 4].map(id => nft.creatorOf(id))))
        .to.deep.equal([admin.address, alice.address, admin.address, admin.address, bob.address]);
      expect(await nft.connect(bob).registerAndMintProduct.staticCall(1, 1, "ipfs://b2", bob.address, 0, projectHash(bob.address))).to.equal(5n);
    });

    it("batches a creator's releases atomically through multicall with the creator as sender", async function () {
      const call = (uri, amount = 1, project = projectHash(alice.address)) =>
        nft.interface.encodeFunctionData("registerAndMintProduct", [amount, 10, uri, alice.address, 300, project]);
      const tx = nft.connect(alice).multicall([call("ipfs://a"), call("ipfs://b", 2)]);
      await expect(tx).to.emit(nft, "EditionMinted").withArgs(1, alice.address, 2, alice.address);
      await expect(tx).to.emit(nft, "TokenRegistered").withArgs(1, alice.address, 10, 0, "ipfs://b");
      expect(await nft.balanceOf(alice.address, 1)).to.equal(2);
      await expect(nft.connect(alice).multicall([call("ipfs://c"), call("ipfs://d", 1, projectHash(alice.address, "unapproved"))]))
        .to.be.revertedWithCustomError(nft, "CreatorProjectNotApproved");
      expect(await nft.nextTokenId()).to.equal(2);
      const bobCall = (uri, amount) => nft.interface.encodeFunctionData("registerAndMintProduct", [amount, 10, uri, bob.address, 300, projectHash(bob.address)]);
      await expect(nft.connect(bob).multicall([bobCall("ipfs://b1", 1), bobCall("ipfs://over", 11)]))
        .to.be.revertedWith("DecentNFT: exceeds supply cap");
      expect(await nft.nextTokenId()).to.equal(2);
      expect(await nft.balanceOf(bob.address, 2)).to.equal(0);
    });

    it("keeps the owner batch atomic and attributed to the owner", async function () {
      const receiver = await (await ethers.getContractFactory("RejectingNFTReceiver")).deploy();
      await create(alice);
      await expect(nft.registerAndMintProductsBatch([adminProduct(collector.address), adminProduct(await receiver.getAddress())]))
        .to.be.revertedWith("Receiver rejected mint");
      expect(await nft.nextTokenId()).to.equal(1);
      await expect(nft.registerAndMintProductsBatch([adminProduct(collector.address), adminProduct(bob.address, { amount: 3 })]))
        .to.emit(nft, "EditionMinted").withArgs(2, bob.address, 3, admin.address);
      expect(await nft.creatorOf(2)).to.equal(admin.address);
    });
  });

  describe("pause", function () {
    it("halts every mint path and creator self-service but never transfers", async function () {
      await nft.grantRole(await nft.PAUSER_ROLE(), pauser.address);
      await create(alice, { amount: 2 });
      await nft.registerToken(10, "ipfs://ach", 1, ethers.ZeroAddress, 0);
      await nft.grantRole(await nft.MINTER_ROLE(), admin.address);
      await expect(nft.connect(collector).pause()).to.be.revertedWithCustomError(nft, "AccessControlUnauthorizedAccount");
      await nft.connect(pauser).pause();
      await expect(nft.connect(pauser).unpause()).to.be.revertedWithCustomError(nft, "AccessControlUnauthorizedAccount");
      await expect(create(alice)).to.be.revertedWithCustomError(nft, "EnforcedPause");
      await expect(nft.connect(alice).mintCreatorProduct(0, 1)).to.be.revertedWithCustomError(nft, "EnforcedPause");
      await expect(nft.registerAndMintProductsBatch([adminProduct(collector.address)])).to.be.revertedWithCustomError(nft, "EnforcedPause");
      await expect(nft.mintAchievement(collector.address, 1, 1)).to.be.revertedWithCustomError(nft, "EnforcedPause");
      await nft.connect(alice).safeTransferFrom(alice.address, collector.address, 0, 1, "0x");
      await nft.unpause();
      await nft.connect(alice).mintCreatorProduct(0, 1);
      expect(await nft.totalMinted(0)).to.equal(3);
    });
  });

  describe("admin recovery of stray assets", function () {
    it("recovers stray ERC-20, ERC-721 and forced ETH, but never collection tokens", async function () {
      const address = await nft.getAddress();
      const usdc = await (await ethers.getContractFactory("MockDJukeToken")).deploy();
      const gift = await (await ethers.getContractFactory("MockTipNFT721")).deploy();
      await usdc.mint(address, 5_000_000);
      await gift.mint(address, 7);
      await network.provider.send("hardhat_setBalance", [address, "0x64"]);
      await expect(nft.connect(alice).recoverERC20(await usdc.getAddress(), alice.address, 1))
        .to.be.revertedWithCustomError(nft, "AccessControlUnauthorizedAccount");
      await expect(nft.recoverERC20(await usdc.getAddress(), collector.address, 5_000_000))
        .to.emit(nft, "Recovered").withArgs(await usdc.getAddress(), collector.address, 5_000_000);
      await nft.recoverERC721(await gift.getAddress(), 7, collector.address);
      await expect(nft.recoverETH(collector.address, 100)).to.changeEtherBalance(collector, 100);
      expect(await usdc.balanceOf(collector.address)).to.equal(5_000_000);
      expect(await gift.ownerOf(7)).to.equal(collector.address);
      await expect(nft.recoverERC20(address, admin.address, 1)).to.be.revertedWithCustomError(nft, "CannotRecoverCollectionTokens");
      await expect(nft.recoverERC721(address, 0, admin.address)).to.be.revertedWithCustomError(nft, "CannotRecoverCollectionTokens");
      await expect(nft.recoverERC20(await usdc.getAddress(), ethers.ZeroAddress, 1)).to.be.revertedWithCustomError(nft, "ZeroAddress");
    });

    it("cannot receive its own editions or native value", async function () {
      await create(alice);
      await expect(nft.connect(alice).safeTransferFrom(alice.address, await nft.getAddress(), 0, 1, "0x")).to.be.reverted;
      await expect(admin.sendTransaction({ to: await nft.getAddress(), value: 1 })).to.be.reverted;
      await expect(nft.connect(alice).registerAndMintProduct(1, 1, "ipfs://x", alice.address, 0, projectHash(alice.address), { value: 1 })).to.be.reverted;
    });
  });
});
