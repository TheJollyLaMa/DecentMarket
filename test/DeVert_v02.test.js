const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("DeVert_v0_2 platform-funded scheduler", function () {
  let token, router, devert, admin, scheduler, advertiser;
  const funds = ["dbusk-playback", "dbusk-top10", "dbusk-pinners", "dbusk-repo-dev"].map(ethers.id);

  beforeEach(async function () {
    [admin, scheduler, advertiser] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("MockDJukeToken")).deploy();
    router = await (await ethers.getContractFactory("MockDJukeRouter")).deploy();
    const djuke = await (await ethers.getContractFactory("MockDeVertDJuke")).deploy();
    devert = await (await ethers.getContractFactory("DeVert_v0_2")).deploy(
      token.target, router.target, djuke.target, ...funds, admin.address, scheduler.address);
    await token.mint(advertiser.address, 20_000_000n);
    await token.connect(advertiser).approve(devert.target, 20_000_000n);
    await devert.unpause();
  });

  const buy = () => devert.connect(advertiser).createCampaign("Advert", "ipfs://bafy-ad", 5_000_000, 5_000_000);

  it("accepts USDC only, preserves 45/45/8/2 routing, and never transfers worker ETH", async function () {
    const workerBefore = await ethers.provider.getBalance(scheduler.address);
    const payerBefore = await ethers.provider.getBalance(advertiser.address);
    const receipt = await (await buy()).wait();
    expect(await devert.CONTRACT_VERSION()).to.equal("0.2");
    expect(await devert.quoteSchedulerGasTopUp(1_000_000_000)).to.equal(0);
    expect(await ethers.provider.getBalance(scheduler.address)).to.equal(workerBefore);
    expect(payerBefore - await ethers.provider.getBalance(advertiser.address)).to.equal(receipt.fee);
    expect(await ethers.provider.getBalance(devert.target)).to.equal(0);
    expect(await token.balanceOf(advertiser.address)).to.equal(15_000_000);
    for (const [i, amount] of [2_250_000, 2_250_000, 400_000, 100_000].entries()) {
      expect(await router.received(funds[i])).to.equal(amount);
    }
    const campaign = await devert.getCampaign(1);
    expect(campaign.advertiser).to.equal(advertiser.address);
    expect(campaign.expiresAt - campaign.startedAt).to.equal(604800);
  });

  it("rejects stale clients attaching any worker contribution before charging USDC", async function () {
    await expect(devert.connect(advertiser).createCampaign("Advert", "ipfs://bafy-ad", 5_000_000, 5_000_000, { value: 1 }))
      .to.be.revertedWith("Worker ETH is platform-funded");
    expect(await token.balanceOf(advertiser.address)).to.equal(20_000_000);
    expect(await devert.nextCampaignId()).to.equal(1);
  });

  it("keeps pause, approval, scheduler authorization and impression deduplication", async function () {
    await token.connect(advertiser).approve(devert.target, 0);
    await expect(buy()).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    await token.connect(advertiser).approve(devert.target, 5_000_000);
    await devert.pause();
    await expect(buy()).to.be.revertedWithCustomError(devert, "EnforcedPause");
    await devert.unpause();
    await buy();
    await expect(devert.connect(advertiser).recordCampaignPlay(1, false, ethers.id("play")))
      .to.be.revertedWithCustomError(devert, "AccessControlUnauthorizedAccount");
    await devert.connect(scheduler).recordCampaignPlay(1, false, ethers.id("play"));
    await expect(devert.connect(scheduler).recordCampaignPlay(1, false, ethers.id("play")))
      .to.be.revertedWith("Impression already recorded");
    await network.provider.send("evm_increaseTime", [604801]);
    await network.provider.send("evm_mine");
    await expect(devert.connect(scheduler).recordCampaignPlay(1, false, ethers.id("expired")))
      .to.be.reverted;
  });

  it("supports both paid queue tiers and routes settlement using the sponsored campaign", async function () {
    const queue = await (await ethers.getContractFactory("DeVertQueue_v0_2")).deploy(
      token.target, devert.target, router.target, ...funds, admin.address, scheduler.address);
    await buy();
    await queue.connect(scheduler).approveCampaign(1);
    await token.connect(advertiser).approve(queue.target, 3_000_000);
    await queue.connect(advertiser).requestAd(1, 0, 1_000_000);
    await queue.connect(advertiser).requestAd(1, 1, 2_000_000);
    expect(await queue.pendingCount()).to.equal(2);
    const immediate = await queue.headRequestIdForTier(1);
    await queue.connect(scheduler).fulfill(immediate, ethers.id("immediate"));
    const bump = await queue.headRequestIdForTier(0);
    await queue.connect(scheduler).fulfill(bump, ethers.id("bump"));
    expect(await queue.pendingCount()).to.equal(0);
    expect(await token.balanceOf(queue.target)).to.equal(0);
    for (const [i, amount] of [3_600_000, 3_600_000, 640_000, 160_000].entries()) {
      expect(await router.received(funds[i])).to.equal(amount);
    }
  });
});

describe("Sponsored DVert cutover drain policy", function () {
  const { assertDrained } = require("../scripts/deploy_devert_v02");

  it("refuses any unexpired paid term, pending request or unclaimed refund reserve", async function () {
    const source = { target: "source", nextCampaignId: async () => 2n,
      getCampaign: async () => ({ expiresAt: 100n }) };
    const queue = { target: "queue", pendingCount: async () => 0n };
    const token = { balanceOf: async () => 0n };
    await expect(assertDrained({ source, queue, token, now: 99 })).to.be.rejectedWith("still has a paid term");
    await assertDrained({ source, queue, token, now: 100 });
    queue.pendingCount = async () => 1n;
    await expect(assertDrained({ source, queue, token, now: 100 })).to.be.rejectedWith("must drain");
    queue.pendingCount = async () => 0n;
    token.balanceOf = async () => 1n;
    await expect(assertDrained({ source, queue, token, now: 100 })).to.be.rejectedWith("must drain");
  });
});
