const { expect } = require("chai");
const { ethers, network } = require("hardhat");

(process.env.BASE_FORK_RPC ? describe : describe.skip)("DeVertQueue Base fork rehearsal", function () {
  it("purchases from the deployed campaign source, settles through the real router and refunds a removal", async function () {
    await network.provider.send("evm_mine");
    const adminAddress = "0x807061DF657A7697c04045dA7d16D941861cAABc";
    const tokenAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const campaignsAddress = "0x135Cbc573F87637158eb3186C87c584fb0B34CD9";
    const routerAddress = "0x8ecca903e2a6Daa8CCbB933700e4F2C58C44A4B5";
    const [, worker] = await ethers.getSigners();
    await network.provider.send("hardhat_impersonateAccount", [adminAddress]);
    await network.provider.send("hardhat_setBalance", [adminAddress, "0x56BC75E2D63100000"]);
    const admin = await ethers.getSigner(adminAddress);
    const token = new ethers.Contract(tokenAddress, [
      "function balanceOf(address) view returns(uint256)",
      "function approve(address,uint256) returns(bool)",
    ], admin);
    const router = new ethers.Contract(routerAddress, [
      "function fundBalances(bytes32,address) view returns(uint256)",
    ], ethers.provider);
    const funds = ["dbusk-playback", "dbusk-top10", "dbusk-pinners", "dbusk-repo-dev"].map(ethers.id);
    const queue = await (await ethers.getContractFactory("DeVertQueue_v0_1", admin)).deploy(
      tokenAddress, campaignsAddress, routerAddress, ...funds, adminAddress, worker.address);
    await queue.waitForDeployment();
    expect(await queue.hasRole(await queue.FULFILLER_ROLE(), worker.address)).to.equal(true);
    expect(await token.balanceOf(adminAddress)).to.be.gte(2000000n);
    await queue.connect(worker).approveCampaign(1);
    await token.approve(queue.target, 2000000n);
    await queue.requestAd(1, 1000000n);
    await queue.requestAd(1, 1000000n);
    expect((await queue.getRequest(0)).title).to.equal("DecentAdvert0001");
    expect(await token.balanceOf(queue.target)).to.equal(2000000n);
    const balances = await Promise.all(funds.map(fund => router.fundBalances(fund, tokenAddress)));
    await queue.connect(worker).fulfill(0, ethers.id("fork-natural-ad-play"));
    const after = await Promise.all(funds.map(fund => router.fundBalances(fund, tokenAddress)));
    expect(after.map((value, index) => value - balances[index])).to.deep.equal([450000n, 450000n, 80000n, 20000n]);
    await queue.connect(worker).removeCampaign(1);
    await queue.setPaused(true);
    const payerBalance = await token.balanceOf(adminAddress);
    await queue.claimRefund(1);
    expect(await token.balanceOf(adminAddress)).to.equal(payerBalance + 1000000n);
    expect(await token.balanceOf(queue.target)).to.equal(0);
    expect(await queue.pendingCount()).to.equal(0);
    expect(await queue.headRequestId()).to.equal(2);
    await network.provider.send("hardhat_stopImpersonatingAccount", [adminAddress]);
  });
});
