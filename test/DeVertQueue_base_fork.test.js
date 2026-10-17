const { expect } = require("chai");
const { ethers, network } = require("hardhat");

(process.env.BASE_FORK_RPC ? describe : describe.skip)("DeVertQueue Base fork rehearsal", function () {
  for (const version of [1, 2]) {
  it(`v0.${version} purchases from the deployed campaign source, settles through the real router and refunds a removal`, async function () {
    expect(network.name).to.equal("hardhat");
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
      "function transfer(address,uint256) returns(bool)",
    ], admin);
    const router = new ethers.Contract(routerAddress, [
      "function fundBalances(bytes32,address) view returns(uint256)",
    ], ethers.provider);
    const funds = ["dbusk-playback", "dbusk-top10", "dbusk-pinners", "dbusk-repo-dev"].map(ethers.id);
    const queue = await (await ethers.getContractFactory(`DeVertQueue_v0_${version}`, admin)).deploy(
      tokenAddress, campaignsAddress, routerAddress, ...funds, adminAddress, worker.address);
    await queue.waitForDeployment();
    expect(await queue.hasRole(await queue.FULFILLER_ROLE(), worker.address)).to.equal(true);
    const total = version === 2 ? 3000000n : 2000000n;
    const payerFunds = await token.balanceOf(adminAddress);
    if (payerFunds < total) {
      // Local fork only: fund the test payer from an existing USDC holder, never from a live signer.
      await network.provider.send("hardhat_impersonateAccount", [routerAddress]);
      await network.provider.send("hardhat_setBalance", [routerAddress, "0x56BC75E2D63100000"]);
      const holder = await ethers.getSigner(routerAddress);
      await token.connect(holder).transfer(adminAddress, total - payerFunds);
      await network.provider.send("hardhat_stopImpersonatingAccount", [routerAddress]);
    }
    expect(await token.balanceOf(adminAddress)).to.be.gte(total);
    await queue.connect(worker).approveCampaign(1);
    await token.approve(queue.target, total);
    if (version === 2) {
      await queue.requestAd(1, 0, 1000000n);
      await queue.requestAd(1, 1, 2000000n);
    } else {
      await queue.requestAd(1, 1000000n);
      await queue.requestAd(1, 1000000n);
    }
    expect((await queue.getRequest(0)).title).to.equal("DecentAdvert0001");
    expect(await token.balanceOf(queue.target)).to.equal(total);
    const balances = await Promise.all(funds.map(fund => router.fundBalances(fund, tokenAddress)));
    await queue.connect(worker).fulfill(version === 2 ? 1 : 0, ethers.id("fork-natural-ad-play"));
    const after = await Promise.all(funds.map(fund => router.fundBalances(fund, tokenAddress)));
    const multiplier = version === 2 ? 2n : 1n;
    expect(after.map((value, index) => value - balances[index])).to.deep.equal(
      [450000n, 450000n, 80000n, 20000n].map(value => value * multiplier));
    await queue.connect(worker).removeCampaign(1);
    await queue.setPaused(true);
    const payerBalance = await token.balanceOf(adminAddress);
    await queue.claimRefund(version === 2 ? 0 : 1);
    expect(await token.balanceOf(adminAddress)).to.equal(payerBalance + 1000000n);
    expect(await token.balanceOf(queue.target)).to.equal(0);
    expect(await queue.pendingCount()).to.equal(0);
    expect(await queue.headRequestId()).to.equal(2);
    await network.provider.send("hardhat_stopImpersonatingAccount", [adminAddress]);
  });
  }
});
