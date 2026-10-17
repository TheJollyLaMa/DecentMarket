const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("DeVertQueue_v0_1", function () {
  let token, campaigns, router, queue, admin, worker, buyer, outsider;
  const funds = ["dbusk-playback", "dbusk-top10", "dbusk-pinners", "dbusk-repo-dev"].map(ethers.id);
  beforeEach(async function () {
    [admin, worker, buyer, outsider] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("MockDJukeToken")).deploy();
    campaigns = await (await ethers.getContractFactory("MockDeVertQueueCampaigns")).deploy();
    router = await (await ethers.getContractFactory("MockDJukeRouter")).deploy();
    queue = await (await ethers.getContractFactory("DeVertQueue_v0_1")).deploy(token.target, campaigns.target, router.target, ...funds, admin.address, worker.address);
    await campaigns.setCampaign(1, admin.address, (await time.latest()) + 604800);
    await queue.connect(worker).approveCampaign(1);
    await token.mint(buyer.address, 1000000000n);
    await token.connect(buyer).approve(queue.target, ethers.MaxUint256);
  });
  it("escrows exact payment and prices by pending requests, doubling every seven", async function () {
    expect(await queue.quote()).to.equal(1000000);
    for (let i = 0; i < 7; i++) await queue.connect(buyer).requestAd(1, 1000000);
    expect(await queue.quote()).to.equal(2000000);
    await expect(queue.connect(buyer).requestAd(1, 1000000)).to.be.revertedWith("Price increased");
    expect(await token.balanceOf(queue.target)).to.equal(7000000);
    expect(await router.received(funds[0])).to.equal(0);
  });
  it("fulfills only FIFO head, routes 45/45/8/2 and rejects double settlement", async function () {
    await queue.connect(buyer).requestAd(1, 1000000);
    await queue.connect(buyer).requestAd(1, 1000000);
    await expect(queue.connect(worker).fulfill(1, ethers.id("play"))).to.be.revertedWith("FIFO head required");
    await expect(queue.connect(outsider).fulfill(0, ethers.id("play"))).to.be.reverted;
    await queue.connect(worker).fulfill(0, ethers.id("play"));
    expect(await Promise.all(funds.map(f => router.received(f)))).to.deep.equal([450000n, 450000n, 80000n, 20000n]);
    await expect(queue.connect(worker).fulfill(1, ethers.id("play"))).to.be.revertedWith("Unique proof required");
    expect(await queue.pendingCount()).to.equal(1);
    expect(await queue.headRequestId()).to.equal(1);
  });
  it("keeps purchased media valid after campaign expiry", async function () {
    await queue.connect(buyer).requestAd(1, 1000000);
    await time.increase(604801);
    await expect(queue.connect(buyer).requestAd(1, 1000000)).to.be.revertedWith("Active campaign required");
    await queue.connect(worker).fulfill(0, ethers.id("expired-but-paid"));
    expect((await queue.getRequest(0)).status).to.equal(1);
  });
  it("removal skips pending requests and preserves full refunds for only their payer, even paused", async function () {
    await queue.connect(buyer).requestAd(1, 1000000);
    await expect(queue.connect(outsider).removeCampaign(1)).to.be.revertedWith("Removal role required");
    await queue.connect(worker).removeCampaign(1);
    expect(await queue.pendingCount()).to.equal(0);
    expect(await queue.headRequestId()).to.equal(1);
    await queue.setPaused(true);
    await expect(queue.connect(outsider).claimRefund(0)).to.be.revertedWith("Payer refund unavailable");
    await queue.connect(buyer).claimRefund(0);
    expect(await token.balanceOf(queue.target)).to.equal(0);
    await expect(queue.connect(buyer).claimRefund(0)).to.be.revertedWith("Payer refund unavailable");
  });
  it("rolls settlement back if a destination fund cannot receive payment", async function () {
    await queue.connect(buyer).requestAd(1, 1000000);
    await router.setRejectDeposits(true);
    await expect(queue.connect(worker).fulfill(0, ethers.id("retry"))).to.be.revertedWith("Fund unavailable");
    expect(await queue.pendingCount()).to.equal(1);
    expect(await token.balanceOf(queue.target)).to.equal(1000000);
    await router.setRejectDeposits(false);
    await queue.connect(worker).fulfill(0, ethers.id("retry"));
  });
  it("rejects unknown, paused and removed campaigns before payment", async function () {
    await expect(queue.connect(buyer).requestAd(9, 1000000)).to.be.revertedWith("Approved advert required");
    await campaigns.setPaused(true);
    await expect(queue.connect(buyer).requestAd(1, 1000000)).to.be.revertedWith("Campaign unavailable");
    await campaigns.setPaused(false);
    await queue.removeCampaign(1);
    await expect(queue.connect(buyer).requestAd(1, 1000000)).to.be.revertedWith("Campaign unavailable");
  });
  it("requires an approved campaign and restricts approval to the moderation roles", async function () {
    await campaigns.setCampaign(2, admin.address, (await time.latest()) + 604800);
    await expect(queue.connect(buyer).requestAd(2, 1000000)).to.be.revertedWith("Approved advert required");
    await expect(queue.connect(outsider).approveCampaign(2)).to.be.revertedWith("Approval role required");
    await queue.connect(worker).approveCampaign(2);
    await queue.connect(buyer).requestAd(2, 1000000);
  });
  it("bounds the complete FIFO window and preserves refunds for removed non-head requests", async function () {
    await token.mint(buyer.address, 1000000000000000n);
    await campaigns.setCampaign(2, admin.address, (await time.latest()) + 604800);
    await queue.approveCampaign(2);
    for (let i = 0; i < 128; i++) await queue.connect(buyer).requestAd(i % 2 + 1, await queue.quote());
    expect(await queue.pendingCount()).to.equal(128);
    expect(await queue.quote()).to.equal(262144000000n);
    await expect(queue.connect(buyer).requestAd(1, await queue.quote())).to.be.revertedWith("Queue full");
    const refund = (await queue.getRequest(1)).amount;
    await queue.removeCampaign(2);
    expect(await queue.pendingCount()).to.equal(64);
    expect(await queue.headRequestId()).to.equal(0);
    await expect(queue.connect(buyer).requestAd(1, await queue.quote())).to.be.revertedWith("Queue full");
    await queue.connect(worker).fulfill(0, ethers.id("advance-over-removal"));
    expect(await queue.headRequestId()).to.equal(2);
    const balance = await token.balanceOf(buyer.address);
    await queue.connect(buyer).claimRefund(1);
    expect(await token.balanceOf(buyer.address)).to.equal(balance + refund);
    expect(await queue.pendingCount()).to.equal(63);
    await queue.connect(buyer).requestAd(1, await queue.quote());
    expect(await queue.pendingCount()).to.equal(64);
  });
});
