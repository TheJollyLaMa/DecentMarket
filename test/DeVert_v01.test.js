const { expect } = require("chai");
const { ethers } = require("hardhat");
const { assertManifestAvailable, deploymentConfirmed, validateSchedulerAddress } = require("../scripts/devert_deploy_policy");

async function fundForkUsdc(token, holder, amount) {
  const { network } = require("hardhat");
  for (let slot = 0; slot < 20; slot++) {
    const key = ethers.solidityPackedKeccak256(["uint256", "uint256"], [holder, slot]);
    const previous = await network.provider.send("eth_getStorageAt", [token.target, key]);
    await network.provider.send("hardhat_setStorageAt", [token.target, key, ethers.toBeHex(amount, 32)]);
    if (await token.balanceOf(holder) === amount) return;
    await network.provider.send("hardhat_setStorageAt", [token.target, key, previous]);
  }
  throw new Error("Could not locate the fork USDC balance slot");
}

describe("DeVert_v0_1", function () {
  let devert, token, router, djuke, admin, scheduler, advertiser, rival, listener;
  let playbackId, topTenId, pinnerId, repoId;

  beforeEach(async function () {
    [admin, scheduler, advertiser, rival, listener] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("MockDJukeToken")).deploy();
    router = await (await ethers.getContractFactory("MockDJukeRouter")).deploy();
    djuke = await (await ethers.getContractFactory("MockDeVertDJuke")).deploy();
    playbackId = ethers.id("dbusk-playback");
    topTenId = ethers.id("dbusk-top10");
    pinnerId = ethers.id("dbusk-pinners");
    repoId = ethers.id("dbusk-repo-dev");
    devert = await (await ethers.getContractFactory("DeVert_v0_1")).deploy(
      token.target, router.target, djuke.target, playbackId, topTenId, pinnerId, repoId,
      admin.address, scheduler.address);
    await devert.unpause();
    for (const account of [advertiser, rival]) {
      await token.mint(account.address, 100_000_000n);
      await token.connect(account).approve(devert.target, 100_000_000n);
    }
  });

  async function createCampaign(signer = advertiser, offer = 5_000_000n) {
    const feeData = await ethers.provider.getFeeData();
    const maxFeePerGas = feeData.maxFeePerGas || feeData.gasPrice;
    const schedulerTopUp = await devert.quoteSchedulerGasTopUp(maxFeePerGas);
    const overrides = { value: schedulerTopUp };
    if (feeData.maxFeePerGas != null) {
      overrides.maxFeePerGas = feeData.maxFeePerGas;
      if (feeData.maxPriorityFeePerGas != null) overrides.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
    } else {
      overrides.gasPrice = feeData.gasPrice;
    }
    return devert.connect(signer).createCampaign("Artist announcement", "ipfs://bafy-ad-audio", offer, offer,
      overrides);
  }

  it("routes exact campaign revenue 45/45/8/2 and indexes a seven-day campaign across both market weeks", async function () {
    const start = BigInt((await ethers.provider.getBlock("latest")).timestamp);
    const feeData = await ethers.provider.getFeeData();
    const maxFeePerGas = feeData.maxFeePerGas || feeData.gasPrice;
    const expectedTopUp = await devert.quoteSchedulerGasTopUp(maxFeePerGas);
    const schedulerBalanceBefore = await ethers.provider.getBalance(scheduler.address);
    await createCampaign();
    expect(await ethers.provider.getBalance(scheduler.address) - schedulerBalanceBefore).to.equal(expectedTopUp);
    const campaign = await devert.getCampaign(1);
    expect(campaign.advertiser).to.equal(advertiser.address);
    expect(campaign.offerUnits).to.equal(5_000_000n);
    expect(campaign.paidUnits).to.equal(5_000_000n);
    expect(campaign.expiresAt - campaign.startedAt).to.equal(7n * 24n * 60n * 60n);
    expect(campaign.weekId).to.equal(await devert.campaignWeek(start));
    expect(await router.received(playbackId)).to.equal(2_250_000n);
    expect(await router.received(topTenId)).to.equal(2_250_000n);
    expect(await router.received(pinnerId)).to.equal(400_000n);
    expect(await router.received(repoId)).to.equal(100_000n);
    expect(await devert.getWeekCampaignIds(campaign.weekId)).to.deep.equal([1n]);
    expect(await devert.getWeekCampaignIds(campaign.weekId + 1n)).to.deep.equal([1n]);
  });

  it("requires a gas-price-aware Base ETH top-up without changing the USDC campaign splits", async function () {
    const feeData = await ethers.provider.getFeeData();
    const maxFeePerGas = feeData.maxFeePerGas || feeData.gasPrice;
    expect(await devert.quoteSchedulerGasTopUp(maxFeePerGas)).to.equal(500_000n * maxFeePerGas);
    await expect(devert.connect(advertiser).createCampaign("No top-up", "ipfs://bafy-ad-audio", 5_000_000n, 5_000_000n))
      .to.be.revertedWith("Scheduler gas top-up too low");
    expect(await router.received(playbackId)).to.equal(0n);
    expect(await router.received(topTenId)).to.equal(0n);
  });

  it("requires the minimum offer, exact payer cap and the next overbid threshold", async function () {
    await expect(devert.connect(advertiser).createCampaign("Low", "ipfs://audio", 4_999_999n, 6_000_000n))
      .to.be.revertedWith("Offer below minimum");
    await expect(devert.connect(advertiser).createCampaign("Cap", "ipfs://audio", 5_000_000n, 4_999_999n))
      .to.be.revertedWith("Offer exceeds approval");
    await createCampaign();
    const weekId = (await devert.getCampaign(1)).weekId;
    await devert.connect(scheduler).reportCompletedMusicPlays(Array.from({ length: 10 }, (_, i) => ethers.id(`music-${i}`)));
    const quote = await devert.quoteCampaign(weekId);
    expect(quote.minimumOfferUnits).to.equal(5_010_000n);
    expect(quote.bumpedCampaignId).to.equal(1n);
    await expect(devert.connect(rival).createCampaign("Underbid", "ipfs://bafy-ad-audio", 5_000_000n, 6_000_000n))
      .to.be.revertedWith("Offer below current market minimum");
    await createCampaign(rival, 5_010_000n);
    const market = await devert.mainRadioMarket(weekId);
    expect(market.slots).to.equal(1);
    expect(market.seated).to.equal(1);
    expect(market.lowestSeatedOfferUnits).to.equal(5_010_000n);
  });

  it("deduplicates reported music plays and impression IDs and only seats eligible main-radio impressions", async function () {
    await createCampaign();
    const campaign = await devert.getCampaign(1);
    const plays = Array.from({ length: 10 }, (_, i) => ethers.id(`song-play-${i}`));
    await devert.connect(scheduler).reportCompletedMusicPlays(plays);
    await devert.connect(scheduler).reportCompletedMusicPlays([plays[0], plays[1], ethers.id("song-play-10")]);
    let market = await devert.mainRadioMarket(campaign.weekId);
    expect(market.slots).to.equal(1);
    await devert.connect(scheduler).recordCampaignPlay(1, true, ethers.id("impression-1"));
    await expect(devert.connect(scheduler).recordCampaignPlay(1, true, ethers.id("impression-1")))
      .to.be.revertedWith("Impression already recorded");
    await expect(devert.connect(scheduler).recordCampaignPlay(1, true, ethers.id("impression-2")))
      .to.be.revertedWith("No seated main-radio slot");
    await devert.connect(scheduler).recordCampaignPlay(1, false, ethers.id("devert-impression-1"));
    const updated = await devert.getCampaign(1);
    expect(updated.mainRadioPlays).to.equal(1);
    expect(updated.devertPlays).to.equal(1);
    market = await devert.mainRadioMarket(campaign.weekId);
    expect(market.slots).to.equal(1);
  });

  it("links one verified paid DJuke request and rejects unpaid or replayed requests", async function () {
    await createCampaign();
    await expect(devert.connect(scheduler).applyDJukeBoost(1, 7)).to.be.revertedWith("DJuke request not paid by advertiser");
    await djuke.setPaidRequest(7, listener.address, 250_000);
    await expect(devert.connect(scheduler).applyDJukeBoost(1, 7)).to.be.revertedWith("DJuke request not paid by advertiser");
    await djuke.setPaidRequest(7, advertiser.address, 250_000);
    await devert.connect(scheduler).applyDJukeBoost(1, 7);
    await expect(devert.connect(scheduler).applyDJukeBoost(1, 7)).to.be.revertedWith("DJuke request already linked");
    expect((await devert.getCampaign(1)).djukeBoosts).to.equal(1);
  });

  it("keeps the contract paused when asked and rejects unauthorized scheduler writes", async function () {
    await expect(devert.connect(advertiser).reportCompletedMusicPlays([ethers.id("play")]))
      .to.be.revertedWithCustomError(devert, "AccessControlUnauthorizedAccount");
    await devert.pause();
    await expect(createCampaign()).to.be.revertedWithCustomError(devert, "EnforcedPause");
    await devert.unpause();
    await createCampaign();
  });

  it("starts paused after deployment until the admin explicitly activates it", async function () {
    const fresh = await (await ethers.getContractFactory("DeVert_v0_1")).deploy(
      token.target, router.target, djuke.target, playbackId, topTenId, pinnerId, repoId,
      admin.address, scheduler.address);
    expect(await fresh.paused()).to.equal(true);
    await expect(fresh.connect(advertiser).unpause()).to.be.revertedWithCustomError(fresh, "AccessControlUnauthorizedAccount");
    await fresh.unpause();
    expect(await fresh.paused()).to.equal(false);
  });

  it("does not retain collected campaign payment if any router fund rejects settlement", async function () {
    await router.setRejectDeposits(true);
    const before = await token.balanceOf(advertiser.address);
    await expect(createCampaign()).to.be.revertedWith("Fund unavailable");
    expect(await token.balanceOf(advertiser.address)).to.equal(before);
    expect(await devert.nextCampaignId()).to.equal(1);
  });

  (process.env.BASE_FORK_RPC ? it : it.skip)("rehearses campaign purchase, four-fund settlement and an idempotent ad impression against forked Base", async function () {
    const { network } = require("hardhat");
    await network.provider.send("hardhat_mine", ["0x1"]);
    const [admin, scheduler, advertiser] = await ethers.getSigners();
    const usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const routerAddress = "0x8ecca903e2a6Daa8CCbB933700e4F2C58C44A4B5";
    const djukeAddress = "0x333Aa353d6fc70aE79Cf91CE090645CD740FEf59";
    const forkToken = await ethers.getContractAt(["function balanceOf(address) view returns(uint256)",
      "function allowance(address,address) view returns(uint256)", "function approve(address,uint256) returns(bool)"], usdcAddress);
    const forkRouter = await ethers.getContractAt(["function funds(bytes32) view returns(string metadataUri,bool active,bool exists)",
      "function approvedAssets(address) view returns(bool)", "function fundBalances(bytes32,address) view returns(uint256)"], routerAddress);
    const fundIds = ["dbusk-playback", "dbusk-top10", "dbusk-pinners", "dbusk-repo-dev"].map(ethers.id);
    for (const fundId of fundIds) {
      const fund = await forkRouter.funds(fundId);
      expect(fund.exists && fund.active).to.equal(true);
    }
    expect(await forkRouter.approvedAssets(usdcAddress)).to.equal(true);
    const forkDevert = await (await ethers.getContractFactory("DeVert_v0_1")).deploy(
      usdcAddress, routerAddress, djukeAddress, ...fundIds, admin.address, scheduler.address);
    await forkDevert.unpause();
    await fundForkUsdc(forkToken, advertiser.address, 10_000_000n);
    await forkToken.connect(advertiser).approve(forkDevert.target, 10_000_000n);
    const before = await Promise.all(fundIds.map(fundId => forkRouter.fundBalances(fundId, usdcAddress)));
    const feeData = await ethers.provider.getFeeData();
    const maxFeePerGas = feeData.maxFeePerGas || feeData.gasPrice;
    const gasTopUp = await forkDevert.quoteSchedulerGasTopUp(maxFeePerGas);
    const purchaseFees = { value: gasTopUp };
    if (feeData.maxFeePerGas != null) {
      purchaseFees.maxFeePerGas = feeData.maxFeePerGas;
      if (feeData.maxPriorityFeePerGas != null) purchaseFees.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
    } else {
      purchaseFees.gasPrice = feeData.gasPrice;
    }
    await forkDevert.connect(advertiser).createCampaign("Fork rehearsal ad", "ipfs://bafy-ad-audio", 5_000_000n, 5_000_000n, purchaseFees);
    await forkDevert.connect(scheduler).reportCompletedMusicPlays(Array.from({ length: 10 }, (_, index) => ethers.id(`fork-song-${index}`)));
    const campaign = await forkDevert.getCampaign(1);
    await forkDevert.connect(scheduler).recordCampaignPlay(1, true, ethers.id("fork-impression-1"));
    const after = await Promise.all(fundIds.map(fundId => forkRouter.fundBalances(fundId, usdcAddress)));
    const deltas = after.map((balance, index) => balance - before[index]);
    expect(deltas).to.deep.equal([2_250_000n, 2_250_000n, 400_000n, 100_000n]);
    expect((await forkDevert.getCampaign(1)).mainRadioPlays).to.equal(1);
    await expect(forkDevert.connect(scheduler).recordCampaignPlay(1, true, ethers.id("fork-impression-1")))
      .to.be.revertedWith("Impression already recorded");
    expect(campaign.paidUnits).to.equal(5_000_000n);
  });
});

describe("DeVert deployment preflight policy", function () {
  const owner = "0x807061DF657A7697c04045dA7d16D941861cAABc";
  const radioScheduler = "0x1111111111111111111111111111111111111111";

  it("requires one valid scheduler distinct from the project owner", function () {
    expect(validateSchedulerAddress({ ethers, deployerAddress: owner, scheduler: radioScheduler })).to.equal(radioScheduler);
    expect(() => validateSchedulerAddress({ ethers, deployerAddress: owner, scheduler: "invalid" }))
      .to.throw("DEVERT_SCHEDULER_ADDRESS");
    expect(() => validateSchedulerAddress({ ethers, deployerAddress: owner, scheduler: ethers.ZeroAddress }))
      .to.throw("DEVERT_SCHEDULER_ADDRESS");
    expect(() => validateSchedulerAddress({ ethers, deployerAddress: owner, scheduler: owner }))
      .to.throw("dedicated scheduler wallet");
  });

  describe("DeVert_v0_2 Base settlement rehearsal", function () {
    it("routes a USDC-only campaign through the live router and records its advert", async function () {
      if (!process.env.BASE_FORK_RPC) this.skip();
      const [admin, scheduler, advertiser] = await ethers.getSigners();
      const usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      const routerAddress = "0x8ecca903e2a6Daa8CCbB933700e4F2C58C44A4B5";
      const djukeAddress = "0xf51D2F7892cF9D49e14DF4afDf227a59ee170A51";
      const funds = ["dbusk-playback", "dbusk-top10", "dbusk-pinners", "dbusk-repo-dev"].map(ethers.id);
      const token = await ethers.getContractAt("IERC20", usdcAddress);
      const router = new ethers.Contract(routerAddress,
        ["function fundBalances(bytes32,address) view returns(uint256)"], ethers.provider);
      const devert = await (await ethers.getContractFactory("DeVert_v0_2")).deploy(
        usdcAddress, routerAddress, djukeAddress, ...funds, admin.address, scheduler.address);
      await devert.unpause();
      await fundForkUsdc(token, advertiser.address, 5_000_000n);
      await token.connect(advertiser).approve(devert.target, 5_000_000n);
      const before = await Promise.all(funds.map(id => router.fundBalances(id, usdcAddress)));
      const workerBefore = await ethers.provider.getBalance(scheduler.address);
      await devert.connect(advertiser).createCampaign("USDC only", "ipfs://bafy-ad", 5_000_000, 5_000_000);
      expect(await ethers.provider.getBalance(scheduler.address)).to.equal(workerBefore);
      const after = await Promise.all(funds.map(id => router.fundBalances(id, usdcAddress)));
      expect(after.map((balance, i) => balance - before[i])).to.deep.equal([2_250_000n, 2_250_000n, 400_000n, 100_000n]);
      await devert.connect(scheduler).recordCampaignPlay(1, false, ethers.id("sponsored-fork-ad"));
      expect((await devert.getCampaign(1)).devertPlays).to.equal(1);
    });
  });

  it("requires exact live confirmation and refuses an existing deployment manifest", function () {
    expect(deploymentConfirmed("yes")).to.equal(true);
    for (const value of [undefined, "YES", "true", "1", "no"]) expect(deploymentConfirmed(value)).to.equal(false);
    expect(() => assertManifestAvailable("manifest.json", () => true))
      .to.throw("refusing duplicate deployment");
    expect(() => assertManifestAvailable("manifest.json", () => false)).not.to.throw();
  });
});