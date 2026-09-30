const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DecentEscrow_v001", function () {
  let escrow, nft;
  let owner, buyer;

  beforeEach(async function () {
    [owner, buyer] = await ethers.getSigners();
    const Escrow = await ethers.getContractFactory("DecentEscrow_v001");
    escrow = await Escrow.deploy(owner.address);
    const NFT = await ethers.getContractFactory("DecentNFT_v0_2");
    nft = await NFT.deploy("ipfs://root/", owner.address, 500);
    await nft.registerToken(10, "", 0, ethers.ZeroAddress, 0);
    await nft.mintProduct(await escrow.getAddress(), 0, 5);
  });

  it("requires listed quantity to be held by the escrow", async function () {
    await expect(
      escrow.listDNFT(await nft.getAddress(), 0, 1n, ethers.ZeroAddress, 0, 6, "too many")
    ).to.be.revertedWith("DecentEscrow: escrow does not hold quantity");
    await expect(escrow.listDNFT(await nft.getAddress(), 0, 1n, ethers.ZeroAddress, 0, 5, "ok"))
      .to.emit(escrow, "Listed");
  });

  it("rejects mismatched token price configuration", async function () {
    await expect(
      escrow.listDNFT(await nft.getAddress(), 0, 1n, ethers.ZeroAddress, 5n, 1, "bad")
    ).to.be.revertedWith("DecentEscrow: token price mismatch");
    await expect(
      escrow.listDNFT(await nft.getAddress(), 0, 1n, buyer.address, 0, 1, "bad")
    ).to.be.revertedWith("DecentEscrow: token price mismatch");
  });

  it("sells editions for ETH and pauses purchases", async function () {
    await escrow.listDNFT(await nft.getAddress(), 0, 10n, ethers.ZeroAddress, 0, 2, "sale");
    await escrow.connect(buyer).purchaseWithETH(0, 1, { value: 10n });
    expect(await nft.balanceOf(buyer.address, 0)).to.equal(1n);

    await escrow.pause();
    await expect(escrow.connect(buyer).purchaseWithETH(0, 1, { value: 10n }))
      .to.be.revertedWithCustomError(escrow, "EnforcedPause");
    await escrow.withdrawETH(10n, "proceeds");
    await escrow.unpause();
  });

  it("creates, subscribes to, and deactivates plans", async function () {
    await expect(escrow.createPlan("", ethers.ZeroAddress, 1n, 60)).to.be.revertedWith("DecentEscrow: empty name");
    await escrow.createPlan("Pro", ethers.ZeroAddress, 1n, 60);
    await escrow.connect(buyer).subscribe(0, { value: 1n });
    expect(await escrow.isSubscribed(0, buyer.address)).to.equal(true);

    await expect(escrow.deactivatePlan(0)).to.emit(escrow, "PlanDeactivated").withArgs(0);
    await expect(escrow.deactivatePlan(0)).to.be.revertedWith("DecentEscrow: plan not active");
    await expect(escrow.connect(buyer).subscribe(0, { value: 1n })).to.be.revertedWith("DecentEscrow: plan not active");
  });

  it("only owner can pause", async function () {
    await expect(escrow.connect(buyer).pause()).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
  });
});
