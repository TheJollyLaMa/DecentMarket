const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("DeVertQueue_v0_2 two-tier advert priority", function () {
  let token, campaigns, router, queue, admin, worker, buyer, outsider;
  const funds = ["dbusk-playback", "dbusk-top10", "dbusk-pinners", "dbusk-repo-dev"].map(ethers.id);
  const buy = (tier, campaign = 1) => queue.connect(buyer).requestAd(campaign, tier, queue.quoteForTier(tier));
  beforeEach(async function () {
    [admin, worker, buyer, outsider] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("MockDJukeToken")).deploy();
    campaigns = await (await ethers.getContractFactory("MockDeVertQueueCampaigns")).deploy();
    router = await (await ethers.getContractFactory("MockDJukeRouter")).deploy();
    queue = await (await ethers.getContractFactory("DeVertQueue_v0_2")).deploy(
      token.target, campaigns.target, router.target, ...funds, admin.address, worker.address);
    for (const campaign of [1, 2]) {
      await campaigns.setCampaign(campaign, admin.address, (await time.latest()) + 604800);
      await queue.connect(worker).approveCampaign(campaign);
    }
    await token.mint(buyer.address, 1000000000000000n);
    await token.connect(buyer).approve(queue.target, ethers.MaxUint256);
  });
  it("prices immediate plays at exactly twice the shared queue quote at every seven-request boundary", async function () {
    expect(await queue.queueVersion()).to.equal(2);
    for (let i = 0; i < 15; i++) {
      const base = 1000000n * 2n ** BigInt(Math.floor(i / 7));
      expect(await queue.quote()).to.equal(base);
      expect(await queue.quoteForTier(0)).to.equal(base);
      expect(await queue.quoteForTier(1)).to.equal(base * 2n);
      await buy(i % 2);
      const request = await queue.getRequest(i);
      expect(request.tier).to.equal(i % 2);
      expect(request.amount).to.equal(base * (i % 2 ? 2n : 1n));
    }
    expect(await router.received(funds[0])).to.equal(0);
    await expect(queue.connect(buyer).requestAd(1, 1, 1000000)).to.be.revertedWith("Price increased");
    await expect(queue.connect(buyer).requestAd(1, 2, 999999999)).to.be.reverted;
  });
  it("allows immediate requests ahead of older bumps, but enforces FIFO inside each tier", async function () {
    await buy(0); await buy(1); await buy(0); await buy(1);
    expect(await queue.headRequestIdForTier(0)).to.equal(0);
    expect(await queue.headRequestIdForTier(1)).to.equal(1);
    await expect(queue.connect(worker).fulfill(3, ethers.id("late-immediate"))).to.be.revertedWith("Tier FIFO head required");
    await expect(queue.connect(worker).fulfill(2, ethers.id("late-bump"))).to.be.revertedWith("Tier FIFO head required");
    await queue.connect(worker).fulfill(1, ethers.id("immediate-1"));
    expect(await queue.headRequestId()).to.equal(0);
    expect(await Promise.all(funds.map(f => router.received(f)))).to.deep.equal([900000n, 900000n, 160000n, 40000n]);
    await queue.connect(worker).fulfill(3, ethers.id("immediate-3"));
    await queue.connect(worker).fulfill(0, ethers.id("bump-0"));
    expect(await queue.headRequestId()).to.equal(2);
    await queue.connect(worker).fulfill(2, ethers.id("bump-2"));
    expect(await queue.headRequestId()).to.equal(4);
    expect(await queue.pendingCount()).to.equal(0);
    expect(await token.balanceOf(queue.target)).to.equal(0);
  });
  it("settles a bump already playing even when an immediate request arrives", async function () {
    await buy(0); await buy(1);
    await expect(queue.connect(outsider).fulfill(0, ethers.id("bump"))).to.be.reverted;
    await queue.connect(worker).fulfill(0, ethers.id("bump"));
    await expect(queue.connect(worker).fulfill(1, ethers.id("bump"))).to.be.revertedWith("Unique proof required");
    await queue.connect(worker).fulfill(1, ethers.id("immediate"));
    await expect(queue.connect(worker).fulfill(0, ethers.id("again"))).to.be.revertedWith("Request unavailable");
  });
  it("preserves both tiers after expiry and refunds their complete actual price after removal, even paused", async function () {
    await buy(0); await buy(1); await buy(1, 2);
    await time.increase(604801);
    await expect(buy(0)).to.be.revertedWith("Active campaign required");
    await queue.connect(worker).fulfill(1, ethers.id("expired-paid"));
    await expect(queue.connect(outsider).removeCampaign(1)).to.be.revertedWith("Removal role required");
    await queue.removeCampaign(1);
    expect(await queue.pendingCount()).to.equal(1);
    expect(await queue.headRequestIdForTier(0)).to.equal(3);
    expect(await queue.headRequestIdForTier(1)).to.equal(2);
    await queue.removeCampaign(2);
    await queue.setPaused(true);
    await expect(queue.connect(outsider).claimRefund(0)).to.be.revertedWith("Payer refund unavailable");
    const before = await token.balanceOf(buyer.address);
    await queue.connect(buyer).claimRefund(0);
    await queue.connect(buyer).claimRefund(2);
    expect(await token.balanceOf(buyer.address)).to.equal(before + 3000000n);
    expect(await token.balanceOf(queue.target)).to.equal(0);
    await expect(queue.connect(buyer).claimRefund(2)).to.be.revertedWith("Payer refund unavailable");
    await expect(queue.connect(buyer).claimRefund(1)).to.be.revertedWith("Payer refund unavailable");
  });
  it("rolls back failed settlement atomically and still requires active approved campaigns at purchase", async function () {
    await buy(1);
    await router.setRejectDeposits(true);
    await expect(queue.connect(worker).fulfill(0, ethers.id("retry"))).to.be.revertedWith("Fund unavailable");
    expect((await queue.getRequest(0)).status).to.equal(0);
    expect(await queue.usedPlaybackProofs(ethers.id("retry"))).to.equal(false);
    expect(await token.balanceOf(queue.target)).to.equal(2000000);
    await router.setRejectDeposits(false);
    await queue.connect(worker).fulfill(0, ethers.id("retry"));
    await expect(buy(0, 9)).to.be.revertedWith("Approved advert required");
    await campaigns.setPaused(true);
    await expect(buy(1)).to.be.revertedWith("Campaign unavailable");
  });
  it("bounds scans even if immediate requests settle while the oldest bump remains pending", async function () {
    await buy(0);
    for (let i = 1; i < 128; i++) {
      await buy(1, 2);
      await queue.connect(worker).fulfill(i, ethers.id(`immediate-${i}`));
    }
    expect(await queue.pendingCount()).to.equal(1);
    await expect(buy(1)).to.be.revertedWith("Queue full");
    await queue.connect(worker).fulfill(0, ethers.id("oldest-bump"));
    expect(await queue.headRequestId()).to.equal(128);
    await buy(1);
    expect(await queue.pendingCount()).to.equal(1);
  });
});
