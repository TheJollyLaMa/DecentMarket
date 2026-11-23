const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const ZERO = ethers.ZeroAddress;
const Reason = { Delisted: 0, SoldOut: 1, EmergencyReturn: 2 };

describe("DecentSupporterListings_v0_1", function () {
  let listings, nft, usdc, plain;
  let owner, alice, bob, buyer, creator, feeTo, stranger;
  let L, N, U;

  beforeEach(async function () {
    [owner, alice, bob, buyer, creator, feeTo, stranger] = await ethers.getSigners();
    usdc = await (await ethers.getContractFactory("MockListingsUSDC")).deploy();
    nft = await (await ethers.getContractFactory("DecentNFT_v0_2")).deploy("ipfs://root/", creator.address, 500);
    // Token 0: supporter edition with a 10 % per-token royalty to the creator (as Supporter Studio registers).
    await nft.registerToken(1000, "", 0, creator.address, 1000);
    await nft.mintProduct(alice.address, 0, 10);
    await nft.mintProduct(bob.address, 0, 10);
    plain = await (await ethers.getContractFactory("MockPlain1155")).deploy();

    U = await usdc.getAddress();
    N = await nft.getAddress();
    listings = await (await ethers.getContractFactory("DecentSupporterListings_v0_1")).deploy(owner.address, [U], [N]);
    L = await listings.getAddress();
    for (const s of [alice, bob]) await nft.connect(s).setApprovalForAll(L, true);
    await usdc.mint(buyer.address, 1_000_000_000n);
    await usdc.connect(buyer).approve(L, ethers.MaxUint256);
  });

  async function listETH(seller, qty, price, collection = N, tokenId = 0) {
    await listings.connect(seller).list(collection, tokenId, qty, ZERO, price);
    return (await listings.nextListingId()) - 1n;
  }

  async function listUSDC(seller, qty, price) {
    await listings.connect(seller).list(N, 0, qty, U, price);
    return (await listings.nextListingId()) - 1n;
  }

  describe("seller-only controls", function () {
    it("lets only the recorded seller update or delist", async function () {
      const id = await listETH(alice, 4, 100n);
      for (const s of [bob, owner, stranger]) {
        await expect(listings.connect(s).update(id, 200n, 4)).to.be.revertedWithCustomError(listings, "NotSeller");
        await expect(listings.connect(s).delist(id)).to.be.revertedWithCustomError(listings, "NotSeller");
      }
      await expect(listings.connect(alice).update(id, 200n, 4))
        .to.emit(listings, "ListingUpdated").withArgs(id, alice.address, 200n, 4);
      expect((await listings.getListing(id)).unitPrice).to.equal(200n);
    });

    it("moves editions with quantity updates and returns unsold stock on delist", async function () {
      const id = await listETH(alice, 4, 100n);
      expect(await nft.balanceOf(alice.address, 0)).to.equal(6n);
      await listings.connect(alice).update(id, 100n, 7);
      expect(await nft.balanceOf(alice.address, 0)).to.equal(3n);
      expect(await listings.custodied(N, 0)).to.equal(7n);
      await listings.connect(alice).update(id, 100n, 2);
      expect(await nft.balanceOf(alice.address, 0)).to.equal(8n);
      await expect(listings.connect(alice).update(id, 100n, 0)).to.be.revertedWithCustomError(listings, "ZeroQuantity");
      await expect(listings.connect(alice).update(id, 0n, 2)).to.be.revertedWithCustomError(listings, "ZeroPrice");

      await expect(listings.connect(alice).delist(id))
        .to.emit(listings, "ListingClosed").withArgs(id, alice.address, 2, Reason.Delisted);
      expect(await nft.balanceOf(alice.address, 0)).to.equal(10n);
      expect(await nft.balanceOf(L, 0)).to.equal(0n);
      await expect(listings.connect(alice).delist(id)).to.be.revertedWithCustomError(listings, "ListingNotActive");
      await expect(listings.connect(alice).update(id, 1n, 1)).to.be.revertedWithCustomError(listings, "ListingNotActive");
    });

    it("records listing details and seller listing ids for indexers", async function () {
      await expect(listings.connect(alice).list(N, 0, 3, U, 10_000_000n))
        .to.emit(listings, "ListingCreated").withArgs(0, alice.address, N, 0, U, 10_000_000n, 3, 0);
      await listETH(bob, 1, 5n);
      await listETH(alice, 1, 5n);
      expect(await listings.sellerListingIds(alice.address)).to.deep.equal([0n, 2n]);
      expect(await listings.sellerListingIds(bob.address)).to.deep.equal([1n]);
      const l = await listings.getListing(0);
      expect([l.seller, l.collection, l.tokenId, l.payToken, l.unitPrice, l.quantity, l.active])
        .to.deep.equal([alice.address, N, 0n, U, 10_000_000n, 3n, true]);
    });

    it("validates list inputs and the allowlists", async function () {
      await plain.mint(alice.address, 1, 5);
      await plain.connect(alice).setApprovalForAll(L, true);
      const P = await plain.getAddress();
      await expect(listings.connect(alice).list(P, 1, 1, ZERO, 1n)).to.be.revertedWithCustomError(listings, "CollectionNotAllowed");
      await expect(listings.connect(alice).list(N, 0, 1, stranger.address, 1n)).to.be.revertedWithCustomError(listings, "PayTokenNotAllowed");
      await expect(listings.connect(alice).list(N, 0, 0, ZERO, 1n)).to.be.revertedWithCustomError(listings, "ZeroQuantity");
      await expect(listings.connect(alice).list(N, 0, 1, ZERO, 0n)).to.be.revertedWithCustomError(listings, "ZeroPrice");
      await expect(listings.connect(alice).list(N, 0, 11, ZERO, 1n)).to.be.revertedWithCustomError(nft, "ERC1155InsufficientBalance");
      await expect(listings.connect(stranger).list(N, 0, 1, ZERO, 1n)).to.be.reverted;
      await expect(listings.connect(alice).setCollectionAllowed(P, true)).to.be.revertedWithCustomError(listings, "OwnableUnauthorizedAccount");
      await expect(listings.setCollectionAllowed(P, true)).to.emit(listings, "CollectionAllowed").withArgs(P, true);
      await listings.connect(alice).list(P, 1, 1, ZERO, 1n);
    });

    it("blocks sales from a de-allowlisted collection but still lets the seller delist", async function () {
      const id = await listETH(alice, 2, 10n);
      await listings.setCollectionAllowed(N, false);
      await expect(listings.connect(buyer).purchaseWithETH(id, 1, { value: 10n })).to.be.revertedWithCustomError(listings, "CollectionNotAllowed");
      await expect(listings.connect(alice).update(id, 10n, 3)).to.be.revertedWithCustomError(listings, "CollectionNotAllowed");
      await listings.connect(alice).delist(id);
      expect(await nft.balanceOf(alice.address, 0)).to.equal(10n);
    });
  });

  describe("custody accounting", function () {
    it("keeps separate custody for several sellers of the same token id", async function () {
      const a = await listETH(alice, 4, 100n);
      const b = await listUSDC(bob, 6, 5_000_000n);
      const a2 = await listETH(alice, 2, 150n);
      expect(await listings.custodied(N, 0)).to.equal(12n);
      expect(await nft.balanceOf(L, 0)).to.equal(12n);

      await listings.connect(buyer).purchaseWithToken(b, 3, 15_000_000n);
      await listings.connect(buyer).purchaseWithETH(a2, 2, { value: 300n });
      expect(await listings.custodied(N, 0)).to.equal(7n);
      expect((await listings.getListing(a2)).active).to.equal(false);

      await listings.connect(alice).delist(a);
      expect(await nft.balanceOf(alice.address, 0)).to.equal(8n); // 10 - 2 sold, never Bob's stock
      expect(await nft.balanceOf(bob.address, 0)).to.equal(4n);
      expect(await nft.balanceOf(L, 0)).to.equal(3n);
      expect(await listings.custodied(N, 0)).to.equal(3n);
      expect(await listings.strayERC1155(N, 0)).to.equal(0n);
      await expect(listings.connect(alice).delist(b)).to.be.revertedWithCustomError(listings, "NotSeller");

      await listings.connect(bob).delist(b);
      expect(await nft.balanceOf(bob.address, 0)).to.equal(7n);
      expect(await nft.balanceOf(buyer.address, 0)).to.equal(5n);
      expect(await nft.balanceOf(L, 0)).to.equal(0n);
    });

    it("closes sold-out listings", async function () {
      const id = await listETH(alice, 2, 10n);
      await expect(listings.connect(buyer).purchaseWithETH(id, 2, { value: 20n }))
        .to.emit(listings, "ListingClosed").withArgs(id, alice.address, 0, Reason.SoldOut);
      await expect(listings.connect(buyer).purchaseWithETH(id, 1, { value: 10n })).to.be.revertedWithCustomError(listings, "ListingNotActive");
      await expect(listings.connect(alice).delist(id)).to.be.revertedWithCustomError(listings, "ListingNotActive");
    });
  });

  describe("royalty and platform fee math", function () {
    it("splits seller proceeds, capped royalty and fee with rounding left to the seller", async function () {
      await listings.setPlatformFee(250, feeTo.address);
      const id = await listETH(alice, 5, 333n);
      // total 999: royalty floor(999 * 10%) = 99, fee floor(999 * 2.5%) = 24, seller 876
      const q = await listings.quote(id, 3);
      expect([q.total, q.sellerProceeds, q.royaltyReceiver, q.royaltyAmount, q.platformFee])
        .to.deep.equal([999n, 876n, creator.address, 99n, 24n]);
      await expect(listings.connect(buyer).purchaseWithETH(id, 3, { value: 999n }))
        .to.emit(listings, "SaleSettled").withArgs(id, 876n, creator.address, 99n, feeTo.address, 24n)
        .and.to.emit(listings, "Purchased").withArgs(id, buyer.address, alice.address, 3, ZERO, 999n);
      expect(await listings.owed(alice.address, ZERO)).to.equal(876n);
      expect(await listings.owed(creator.address, ZERO)).to.equal(99n);
      expect(await listings.owed(feeTo.address, ZERO)).to.equal(24n);
      expect(await listings.totalOwed(ZERO)).to.equal(999n);
      expect(await ethers.provider.getBalance(L)).to.equal(999n);
    });

    it("clips royalty quotes above the cap", async function () {
      await nft.setTokenRoyalty(0, creator.address, 5000);
      const id = await listUSDC(alice, 1, 10_000_001n);
      await listings.connect(buyer).purchaseWithToken(id, 1, 10_000_001n);
      expect(await listings.owed(creator.address, U)).to.equal(1_000_000n); // floor(10 % of 10_000_001)
      expect(await listings.owed(alice.address, U)).to.equal(9_000_001n);
    });

    it("pays no royalty for collections without ERC-2981 or with a reverting royaltyInfo", async function () {
      const broken = await (await ethers.getContractFactory("MockBrokenRoyalty1155")).deploy();
      for (const c of [plain, broken]) {
        const C = await c.getAddress();
        await c.mint(alice.address, 7, 1);
        await c.connect(alice).setApprovalForAll(L, true);
        await listings.setCollectionAllowed(C, true);
        const id = await listETH(alice, 1, 1000n, C, 7);
        await listings.connect(buyer).purchaseWithETH(id, 1, { value: 1000n });
      }
      expect(await listings.owed(alice.address, ZERO)).to.equal(2000n);
      expect(await listings.totalOwed(ZERO)).to.equal(2000n);
    });

    it("credits a creator selling its own editions as both seller and royalty receiver", async function () {
      await nft.mintProduct(creator.address, 0, 2);
      await nft.connect(creator).setApprovalForAll(L, true);
      const id = await listETH(creator, 2, 1000n);
      await listings.connect(buyer).purchaseWithETH(id, 2, { value: 2000n });
      expect(await listings.owed(creator.address, ZERO)).to.equal(2000n);
    });

    it("allows an adjustable fee up to 10% and never charges more than a listing's snapshot", async function () {
      await expect(listings.setPlatformFee(1001, feeTo.address)).to.be.revertedWithCustomError(listings, "FeeTooHigh");
      await expect(listings.setPlatformFee(100, ZERO)).to.be.revertedWithCustomError(listings, "ZeroAddress");
      await expect(listings.connect(stranger).setPlatformFee(100, feeTo.address)).to.be.revertedWithCustomError(listings, "OwnableUnauthorizedAccount");
      expect(await listings.platformFeeBps()).to.equal(0n);

      const zeroFee = await listETH(alice, 2, 10_000n);
      await listings.setPlatformFee(1000, feeTo.address);
      await listings.connect(buyer).purchaseWithETH(zeroFee, 1, { value: 10_000n });
      expect(await listings.owed(feeTo.address, ZERO)).to.equal(0n); // listed at 0 bps

      const tenPct = await listETH(alice, 2, 10_000n);
      await listings.connect(buyer).purchaseWithETH(tenPct, 1, { value: 10_000n });
      expect(await listings.owed(feeTo.address, ZERO)).to.equal(1000n); // 10% of 10,000

      const listingAtTenPct = await listETH(bob, 2, 10_000n);
      await listings.setPlatformFee(100, feeTo.address);
      await listings.connect(buyer).purchaseWithETH(listingAtTenPct, 1, { value: 10_000n });
      expect(await listings.owed(feeTo.address, ZERO)).to.equal(1100n); // lowered fee applies
      expect(await listings.owed(bob.address, ZERO)).to.equal(10_000n - 1000n - 100n);
    });
  });

  describe("ETH and USDC purchase paths", function () {
    it("requires the exact ETH amount and the matching purchase function", async function () {
      const e = await listETH(alice, 3, 100n);
      const u = await listUSDC(bob, 3, 1_000_000n);
      await expect(listings.connect(buyer).purchaseWithETH(e, 2, { value: 199n })).to.be.revertedWithCustomError(listings, "IncorrectPayment");
      await expect(listings.connect(buyer).purchaseWithETH(e, 2, { value: 201n })).to.be.revertedWithCustomError(listings, "IncorrectPayment");
      await expect(listings.connect(buyer).purchaseWithETH(e, 4, { value: 400n })).to.be.revertedWithCustomError(listings, "InvalidAmount");
      await expect(listings.connect(buyer).purchaseWithETH(e, 0, { value: 0n })).to.be.revertedWithCustomError(listings, "InvalidAmount");
      await expect(listings.connect(buyer).purchaseWithToken(e, 1, 100n)).to.be.revertedWithCustomError(listings, "PayTokenNotAllowed");
      await expect(listings.connect(buyer).purchaseWithETH(u, 1, { value: 1n })).to.be.revertedWithCustomError(listings, "PayTokenNotAllowed");
      await listings.connect(buyer).purchaseWithETH(e, 2, { value: 200n });
      expect(await nft.balanceOf(buyer.address, 0)).to.equal(2n);
    });

    it("protects USDC buyers from a price raise with maxTotal", async function () {
      const u = await listUSDC(bob, 3, 1_000_000n);
      await listings.connect(bob).update(u, 2_000_000n, 3);
      await expect(listings.connect(buyer).purchaseWithToken(u, 1, 1_000_000n)).to.be.revertedWithCustomError(listings, "PriceAboveMax");
      await listings.connect(buyer).purchaseWithToken(u, 1, 2_000_000n);
      expect(await usdc.balanceOf(L)).to.equal(2_000_000n);
    });

    it("pays out by pull withdrawal in ETH and USDC", async function () {
      const e = await listETH(alice, 2, ethers.parseEther("1"));
      const u = await listUSDC(alice, 2, 10_000_000n);
      await listings.connect(buyer).purchaseWithETH(e, 1, { value: ethers.parseEther("1") });
      await listings.connect(buyer).purchaseWithToken(u, 2, 20_000_000n);

      await expect(listings.connect(alice).withdraw(ZERO)).to.changeEtherBalances(
        [alice, listings], [ethers.parseEther("0.9"), -ethers.parseEther("0.9")]);
      await expect(listings.connect(alice).withdraw(U)).to.changeTokenBalances(usdc, [alice, listings], [18_000_000n, -18_000_000n]);
      await expect(listings.connect(alice).withdraw(U)).to.be.revertedWithCustomError(listings, "NothingOwed");

      // Anyone may flush a creditor's balance, but it is only ever paid to that creditor.
      await expect(listings.connect(stranger).withdrawFor(creator.address, U))
        .to.changeTokenBalances(usdc, [creator, stranger], [2_000_000n, 0n]);
      await expect(listings.connect(stranger).withdrawFor(creator.address, ZERO))
        .to.emit(listings, "Withdrawn").withArgs(creator.address, ZERO, ethers.parseEther("0.1"));
      expect(await listings.totalOwed(ZERO)).to.equal(0n);
      expect(await listings.totalOwed(U)).to.equal(0n);
    });
  });

  describe("pause", function () {
    it("stops listing, updates and purchases but never seller exits or withdrawals", async function () {
      const id = await listETH(alice, 3, 10n);
      await listings.connect(buyer).purchaseWithETH(id, 1, { value: 10n });
      await expect(listings.connect(stranger).pause()).to.be.revertedWithCustomError(listings, "OwnableUnauthorizedAccount");
      await listings.pause();
      await expect(listETH(bob, 1, 1n)).to.be.revertedWithCustomError(listings, "EnforcedPause");
      await expect(listings.connect(alice).update(id, 11n, 2)).to.be.revertedWithCustomError(listings, "EnforcedPause");
      await expect(listings.connect(buyer).purchaseWithETH(id, 1, { value: 10n })).to.be.revertedWithCustomError(listings, "EnforcedPause");
      await expect(listings.connect(buyer).purchaseWithToken(id, 1, 10n)).to.be.revertedWithCustomError(listings, "EnforcedPause");
      await listings.connect(alice).withdraw(ZERO);
      await listings.connect(alice).delist(id);
      expect(await nft.balanceOf(alice.address, 0)).to.equal(9n);
      await listings.unpause();
      await listETH(bob, 1, 1n);
    });
  });

  describe("administrator recovery", function () {
    it("emergency return sends each listing's stock to its recorded seller, only while paused", async function () {
      const a = await listETH(alice, 3, 10n);
      const b = await listUSDC(bob, 4, 10n);
      const c = await listETH(alice, 1, 10n);
      await listings.connect(alice).delist(c);
      await expect(listings.emergencyReturn([a, b])).to.be.revertedWithCustomError(listings, "ExpectedPause");
      await listings.pause();
      await expect(listings.connect(alice).emergencyReturn([a])).to.be.revertedWithCustomError(listings, "OwnableUnauthorizedAccount");
      await expect(listings.emergencyReturn([a, b, c, 99]))
        .to.emit(listings, "ListingClosed").withArgs(a, alice.address, 3, Reason.EmergencyReturn)
        .and.to.emit(listings, "ListingClosed").withArgs(b, bob.address, 4, Reason.EmergencyReturn);
      expect(await nft.balanceOf(alice.address, 0)).to.equal(10n);
      expect(await nft.balanceOf(bob.address, 0)).to.equal(10n);
      expect(await nft.balanceOf(owner.address, 0)).to.equal(0n);
      expect(await listings.custodied(N, 0)).to.equal(0n);
    });

    it("keeps a listing intact when its seller refuses the emergency return", async function () {
      const seller = await (await ethers.getContractFactory("MockListingSeller")).deploy(L);
      await nft.mintProduct(await seller.getAddress(), 0, 2);
      await seller.listFrom(N, 0, 2, ZERO, 10n);
      const a = await listETH(alice, 1, 10n);
      await seller.setRejectEditions(true);
      await listings.pause();
      await expect(listings.emergencyReturn([0, a]))
        .to.emit(listings, "EmergencyReturnFailed").withArgs(0, await seller.getAddress());
      expect((await listings.getListing(0)).active).to.equal(true);
      expect(await listings.custodied(N, 0)).to.equal(2n);
      expect(await nft.balanceOf(alice.address, 0)).to.equal(10n);
      await seller.setRejectEditions(false);
      await seller.delist(0);
      expect(await nft.balanceOf(await seller.getAddress(), 0)).to.equal(2n);
    });

    it("recovers stray editions but never listed stock", async function () {
      const P = await plain.getAddress();
      await listings.setCollectionAllowed(P, true);
      await plain.mint(alice.address, 1, 2);
      await plain.connect(alice).setApprovalForAll(L, true);
      await listETH(alice, 2, 10n, P, 1);
      await listETH(alice, 4, 10n);

      await expect(listings.recoverStrayERC1155(N, 0, 1, owner.address)).to.be.revertedWithCustomError(listings, "ExceedsStray");
      await plain.forceMint(L, 1, 3);
      expect(await listings.strayERC1155(P, 1)).to.equal(3n);
      await expect(listings.recoverStrayERC1155(P, 1, 4, owner.address)).to.be.revertedWithCustomError(listings, "ExceedsStray");
      await expect(listings.connect(stranger).recoverStrayERC1155(P, 1, 3, stranger.address)).to.be.revertedWithCustomError(listings, "OwnableUnauthorizedAccount");
      await expect(listings.recoverStrayERC1155(P, 1, 3, owner.address))
        .to.emit(listings, "StrayERC1155Recovered").withArgs(P, 1, owner.address, 3);
      expect(await plain.balanceOf(L, 1)).to.equal(2n);
      await expect(listings.recoverStrayERC1155(P, 1, 1, owner.address)).to.be.revertedWithCustomError(listings, "ExceedsStray");
    });

    it("recovers stray ETH and USDC but never owed balances", async function () {
      const e = await listETH(alice, 1, 1000n);
      const u = await listUSDC(bob, 1, 5000n);
      await listings.connect(buyer).purchaseWithETH(e, 1, { value: 1000n });
      await listings.connect(buyer).purchaseWithToken(u, 1, 5000n);

      await expect(listings.recoverStrayFunds(ZERO, 1, owner.address)).to.be.revertedWithCustomError(listings, "ExceedsStray");
      await expect(listings.recoverStrayFunds(U, 1, owner.address)).to.be.revertedWithCustomError(listings, "ExceedsStray");

      await network.provider.send("hardhat_setBalance", [L, ethers.toQuantity(1000n + 77n)]);
      await usdc.connect(buyer).transfer(L, 55n);
      expect(await listings.strayFunds(ZERO)).to.equal(77n);
      expect(await listings.strayFunds(U)).to.equal(55n);
      await expect(listings.recoverStrayFunds(ZERO, 78, owner.address)).to.be.revertedWithCustomError(listings, "ExceedsStray");
      await expect(listings.connect(stranger).recoverStrayFunds(ZERO, 77, stranger.address)).to.be.revertedWithCustomError(listings, "OwnableUnauthorizedAccount");
      await expect(listings.recoverStrayFunds(ZERO, 77, feeTo.address)).to.changeEtherBalance(feeTo, 77n);
      await expect(listings.recoverStrayFunds(U, 55, feeTo.address)).to.changeTokenBalance(usdc, feeTo, 55n);

      await listings.pause();
      await expect(listings.connect(alice).withdraw(ZERO)).to.changeEtherBalance(alice, 900n);
      await expect(listings.connect(bob).withdraw(U)).to.changeTokenBalance(usdc, bob, 4500n);
      await listings.withdrawFor(creator.address, ZERO);
      await listings.withdrawFor(creator.address, U);
      expect(await ethers.provider.getBalance(L)).to.equal(0n);
      expect(await usdc.balanceOf(L)).to.equal(0n);
    });

    it("rejects plain ETH sends", async function () {
      await expect(buyer.sendTransaction({ to: L, value: 1n })).to.be.reverted;
    });
  });

  describe("reentrancy", function () {
    it("blocks a buyer re-entering purchase from the ERC-1155 receive hook", async function () {
      const id = await listETH(alice, 3, 10n);
      const attacker = await (await ethers.getContractFactory("MockReentrantBuyer")).deploy(L);
      await expect(attacker.buy(id, 1, true, { value: 10n })).to.be.revertedWithCustomError(listings, "ReentrancyGuardReentrantCall");
      await attacker.buy(id, 1, false, { value: 10n });
      expect(await nft.balanceOf(await attacker.getAddress(), 0)).to.equal(1n);
    });

    it("blocks a seller re-entering withdraw from its ETH hook", async function () {
      const seller = await (await ethers.getContractFactory("MockListingSeller")).deploy(L);
      const S = await seller.getAddress();
      await nft.mintProduct(S, 0, 1);
      const id = (await listings.nextListingId());
      await seller.listFrom(N, 0, 1, ZERO, 1000n);
      await listings.connect(buyer).purchaseWithETH(id, 1, { value: 1000n });
      await seller.setReenterOnEth(true);
      await expect(seller.withdraw(ZERO)).to.be.revertedWithCustomError(listings, "EthTransferFailed");
      expect(await listings.owed(S, ZERO)).to.equal(900n);
      await seller.setReenterOnEth(false);
      await seller.withdraw(ZERO);
      expect(await ethers.provider.getBalance(S)).to.equal(900n);
    });
  });

  describe("ERC-1155 receiver hooks", function () {
    it("accepts only deposits the contract pulls itself", async function () {
      expect(await listings.supportsInterface("0x4e2312e0")).to.equal(true); // IERC1155Receiver
      await expect(nft.connect(alice).safeTransferFrom(alice.address, L, 0, 1, "0x"))
        .to.be.revertedWithCustomError(listings, "UnsolicitedTransfer");
      await expect(nft.connect(alice).safeBatchTransferFrom(alice.address, L, [0], [1], "0x"))
        .to.be.revertedWithCustomError(listings, "UnsolicitedTransfer");
      await nft.connect(alice).setApprovalForAll(L, false);
      await expect(listings.connect(alice).list(N, 0, 1, ZERO, 1n)).to.be.revertedWithCustomError(nft, "ERC1155MissingApprovalForAll");
      await nft.connect(alice).setApprovalForAll(L, true);
      await listETH(alice, 1, 1n);
      expect(await nft.balanceOf(L, 0)).to.equal(1n);
    });
  });
});
