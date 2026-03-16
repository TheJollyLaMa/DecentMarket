// test/DecentEscrow.test.js
// Unit tests for DecentEscrow — Community Treasury v1

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DecentEscrow", function () {
  let escrow;
  let owner;
  let depositor;
  let addr1;
  let mockToken;

  beforeEach(async function () {
    [owner, depositor, addr1] = await ethers.getSigners();

    const DecentEscrow = await ethers.getContractFactory("DecentEscrow");
    escrow = await DecentEscrow.deploy(owner.address);
    await escrow.waitForDeployment();

    // Deploy a minimal ERC-20 mock for token deposit/withdraw tests
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy("Mock USDC", "mUSDC", 6);
    await mockToken.waitForDeployment();

    // Mint some tokens to the depositor for testing
    await mockToken.mint(depositor.address, 1_000_000_000n); // 1000 mUSDC (6 decimals)
  });

  // ── Deployment ───────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("sets the correct owner", async function () {
      expect(await escrow.owner()).to.equal(owner.address);
    });

    it("starts with zero ETH balance", async function () {
      expect(await escrow.getETHBalance()).to.equal(0n);
    });

    it("starts with zero token balance", async function () {
      expect(await escrow.getBalance(await mockToken.getAddress())).to.equal(0n);
    });
  });

  // ── ETH deposits ─────────────────────────────────────────────────────────────

  describe("ETH deposits", function () {
    it("accepts ETH via receive() and emits Deposited with empty note", async function () {
      const amount = ethers.parseEther("1");
      await expect(
        depositor.sendTransaction({ to: await escrow.getAddress(), value: amount })
      )
        .to.emit(escrow, "Deposited")
        .withArgs(depositor.address, ethers.ZeroAddress, amount, "");

      expect(await escrow.getETHBalance()).to.equal(amount);
    });

    it("accepts ETH via depositETH() and emits Deposited with note", async function () {
      const amount = ethers.parseEther("0.5");
      const note = "DecentHead v1.0 DNFT sale";

      await expect(
        escrow.connect(depositor).depositETH(note, { value: amount })
      )
        .to.emit(escrow, "Deposited")
        .withArgs(depositor.address, ethers.ZeroAddress, amount, note);

      expect(await escrow.getETHBalance()).to.equal(amount);
    });

    it("reverts depositETH with zero value", async function () {
      await expect(
        escrow.connect(depositor).depositETH("test", { value: 0 })
      ).to.be.revertedWith("DecentEscrow: zero ETH deposit");
    });

    it("accumulates ETH from multiple deposits", async function () {
      const a1 = ethers.parseEther("1");
      const a2 = ethers.parseEther("2");
      await escrow.connect(depositor).depositETH("first", { value: a1 });
      await escrow.connect(depositor).depositETH("second", { value: a2 });
      expect(await escrow.getETHBalance()).to.equal(a1 + a2);
    });
  });

  // ── ERC-20 deposits ───────────────────────────────────────────────────────────

  describe("ERC-20 deposits", function () {
    it("accepts token deposit and emits Deposited with note", async function () {
      const amount = 100_000_000n; // 100 mUSDC
      const note = "BigNuten v1.0 DNFT sale";
      const tokenAddr = await mockToken.getAddress();
      const escrowAddr = await escrow.getAddress();

      await mockToken.connect(depositor).approve(escrowAddr, amount);

      await expect(escrow.connect(depositor).deposit(tokenAddr, amount, note))
        .to.emit(escrow, "Deposited")
        .withArgs(depositor.address, tokenAddr, amount, note);

      expect(await escrow.getBalance(tokenAddr)).to.equal(amount);
    });

    it("reverts deposit with zero amount", async function () {
      const tokenAddr = await mockToken.getAddress();
      await expect(
        escrow.connect(depositor).deposit(tokenAddr, 0, "note")
      ).to.be.revertedWith("DecentEscrow: zero token deposit");
    });

    it("reverts deposit with address(0) as token", async function () {
      await expect(
        escrow.connect(depositor).deposit(ethers.ZeroAddress, 1n, "note")
      ).to.be.revertedWith("DecentEscrow: use depositETH for ETH");
    });

    it("reverts deposit when allowance is insufficient", async function () {
      const tokenAddr = await mockToken.getAddress();
      // No approval given
      await expect(
        escrow.connect(depositor).deposit(tokenAddr, 100_000_000n, "note")
      ).to.be.reverted;
    });
  });

  // ── ETH withdrawals ───────────────────────────────────────────────────────────

  describe("ETH withdrawals", function () {
    const depositAmount = ethers.parseEther("2");
    const withdrawReason = "Bounty payout — DecentMarket TheJollyLaMa/DecentMarket#45";

    beforeEach(async function () {
      await escrow.connect(depositor).depositETH("test deposit", { value: depositAmount });
    });

    it("allows owner to withdraw ETH and emits Withdrawn", async function () {
      const withdrawAmount = ethers.parseEther("1");

      await expect(escrow.connect(owner).withdrawETH(withdrawAmount, withdrawReason))
        .to.emit(escrow, "Withdrawn")
        .withArgs(ethers.ZeroAddress, owner.address, withdrawAmount, withdrawReason);

      expect(await escrow.getETHBalance()).to.equal(depositAmount - withdrawAmount);
    });

    it("reverts withdrawETH with zero amount", async function () {
      await expect(
        escrow.connect(owner).withdrawETH(0, withdrawReason)
      ).to.be.revertedWith("DecentEscrow: zero amount");
    });

    it("reverts withdrawETH when balance is insufficient", async function () {
      const tooMuch = ethers.parseEther("999");
      await expect(
        escrow.connect(owner).withdrawETH(tooMuch, withdrawReason)
      ).to.be.revertedWith("DecentEscrow: insufficient ETH balance");
    });

    it("reverts withdrawETH when called by non-owner", async function () {
      await expect(
        escrow.connect(addr1).withdrawETH(ethers.parseEther("1"), withdrawReason)
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });

    it("allows owner to withdraw full ETH balance", async function () {
      await escrow.connect(owner).withdrawETH(depositAmount, withdrawReason);
      expect(await escrow.getETHBalance()).to.equal(0n);
    });
  });

  // ── ERC-20 withdrawals ────────────────────────────────────────────────────────

  describe("ERC-20 withdrawals", function () {
    const depositAmount = 500_000_000n; // 500 mUSDC
    const withdrawReason = "Development expenses Q1 2025";

    beforeEach(async function () {
      const tokenAddr = await mockToken.getAddress();
      const escrowAddr = await escrow.getAddress();
      await mockToken.connect(depositor).approve(escrowAddr, depositAmount);
      await escrow.connect(depositor).deposit(tokenAddr, depositAmount, "test deposit");
    });

    it("allows owner to withdraw tokens and emits Withdrawn", async function () {
      const tokenAddr = await mockToken.getAddress();
      const withdrawAmount = 100_000_000n; // 100 mUSDC

      await expect(
        escrow.connect(owner).withdraw(tokenAddr, withdrawAmount, withdrawReason)
      )
        .to.emit(escrow, "Withdrawn")
        .withArgs(tokenAddr, owner.address, withdrawAmount, withdrawReason);

      expect(await escrow.getBalance(tokenAddr)).to.equal(depositAmount - withdrawAmount);
    });

    it("reverts withdraw with zero amount", async function () {
      const tokenAddr = await mockToken.getAddress();
      await expect(
        escrow.connect(owner).withdraw(tokenAddr, 0n, withdrawReason)
      ).to.be.revertedWith("DecentEscrow: zero amount");
    });

    it("reverts withdraw with address(0) as token", async function () {
      await expect(
        escrow.connect(owner).withdraw(ethers.ZeroAddress, 1n, withdrawReason)
      ).to.be.revertedWith("DecentEscrow: use withdrawETH for ETH");
    });

    it("reverts withdraw when called by non-owner", async function () {
      const tokenAddr = await mockToken.getAddress();
      await expect(
        escrow.connect(addr1).withdraw(tokenAddr, 100_000_000n, withdrawReason)
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });

    it("reverts withdraw when token balance is insufficient", async function () {
      const tokenAddr = await mockToken.getAddress();
      await expect(
        escrow.connect(owner).withdraw(tokenAddr, 999_999_999_999n, withdrawReason)
      ).to.be.reverted;
    });
  });

  // ── Ownership transfer ────────────────────────────────────────────────────────

  describe("Ownership transfer (Phase 2 upgrade path)", function () {
    it("allows owner to transfer ownership to a new address", async function () {
      await escrow.connect(owner).transferOwnership(addr1.address);
      expect(await escrow.owner()).to.equal(addr1.address);
    });

    it("reverts transferOwnership when called by non-owner", async function () {
      await expect(
        escrow.connect(addr1).transferOwnership(addr1.address)
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });

    it("new owner can withdraw after ownership transfer", async function () {
      const depositAmount = ethers.parseEther("1");
      await escrow.connect(depositor).depositETH("test", { value: depositAmount });

      await escrow.connect(owner).transferOwnership(addr1.address);

      await expect(
        escrow.connect(addr1).withdrawETH(depositAmount, "post-transfer withdrawal")
      ).to.emit(escrow, "Withdrawn");
    });

    it("old owner cannot withdraw after ownership transfer", async function () {
      await escrow.connect(owner).transferOwnership(addr1.address);
      await expect(
        escrow.connect(owner).withdrawETH(1n, "should fail")
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });
  });

  // ── View functions ────────────────────────────────────────────────────────────

  describe("View functions", function () {
    it("getETHBalance returns zero for fresh contract", async function () {
      expect(await escrow.getETHBalance()).to.equal(0n);
    });

    it("getBalance returns zero for undeposited token", async function () {
      expect(await escrow.getBalance(await mockToken.getAddress())).to.equal(0n);
    });

    it("getETHBalance reflects actual ETH held", async function () {
      const amount = ethers.parseEther("3");
      await escrow.connect(depositor).depositETH("deposit", { value: amount });
      expect(await escrow.getETHBalance()).to.equal(amount);
    });

    it("getBalance reflects actual token held", async function () {
      const tokenAddr = await mockToken.getAddress();
      const amount = 250_000_000n;
      await mockToken.connect(depositor).approve(await escrow.getAddress(), amount);
      await escrow.connect(depositor).deposit(tokenAddr, amount, "deposit");
      expect(await escrow.getBalance(tokenAddr)).to.equal(amount);
    });
  });
});
