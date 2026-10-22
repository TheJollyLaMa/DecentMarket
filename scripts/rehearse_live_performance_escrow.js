// Base-fork rehearsal of the full LivePerformanceEscrow lifecycle with real Base USDC. Never broadcasts.
//   BASE_FORK_RPC=https://mainnet.base.org npx hardhat run scripts/rehearse_live_performance_escrow.js
const hre = require("hardhat");
const { main: deploy, USDC, OWNER } = require("./deploy_live_performance_escrow");

const USDC_BALANCE_SLOT = 9n;
const units = value => hre.ethers.parseUnits(String(value), 6);

async function main() {
  const { ethers, network } = hre;
  if (network.name !== "hardhat") throw new Error("Rehearsal runs only on the in-process Base fork");
  const { escrow, deployer: owner } = await deploy();
  const address = await escrow.getAddress();
  const usdc = await ethers.getContractAt("IERC20", USDC, owner);
  const [, performer, stranger] = await ethers.getSigners();
  const slot = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [OWNER, USDC_BALANCE_SLOT]));
  await network.provider.send("hardhat_setStorageAt", [USDC, slot, ethers.toBeHex(units(1000), 32)]);
  const now = async () => (await ethers.provider.getBlock("latest")).timestamp;
  const warp = async to => { await network.provider.send("evm_setNextBlockTimestamp", [to]); await network.provider.send("evm_mine"); };
  const terms = ethers.id("DecentBusking Friday Live terms DRAFT v1");
  const book = async (label, amount, start, review = 3 * 86400, cancelWindow = 2 * 86400, killFee = 2500) => {
    const id = ethers.id(label);
    await (await usdc.approve(address, units(amount))).wait();
    await (await escrow.createBooking(id, performer.address, units(amount), start, start + 3600, start + 3600 + review + 7 * 86400,
      terms, "ipfs://rehearsal-terms", review, cancelWindow, killFee)).wait();
    return id;
  };
  const log = (step, extra = {}) => console.log(JSON.stringify({ step, ...extra }));
  const bal = async who => ethers.formatUnits(await usdc.balanceOf(who), 6);

  let t = await now();
  const a = await book("rehearsal:a", 20, t + 86400);
  const b = await book("rehearsal:b", 20, t + 86400);
  const c = await book("rehearsal:c", 20, t + 3 * 86400);
  const d = await book("rehearsal:d", 20, t + 86400);
  log("funded 4 bookings", { escrowUsdc: await bal(address) });

  await (await escrow.cancel(c, "ipfs://early-cancel")).wait();
  log("admin cancel outside window -> full refund", { status: Number((await escrow.bookings(c)).status) });

  await warp(t + 86400 + 3600 + 60);
  await (await escrow.approve(a, 10000, "ipfs://report-a")).wait();
  await (await escrow.reject(b, "ipfs://report-b")).wait();
  const before = await usdc.balanceOf(performer.address);
  await (await escrow.connect(performer).claim(a)).wait();
  log("approve 100% + performer claim", { performerReceived: ethers.formatUnits(await usdc.balanceOf(performer.address) - before, 6) });
  log("reject -> funder refunded", { status: Number((await escrow.bookings(b)).status) });
  try { await escrow.connect(stranger).claim(d); throw new Error("stranger claim should revert"); } catch (e) { if (!/PerformerOnly/.test(e.message)) throw e; }
  log("non-performer claim blocked");

  const dEnd = Number((await escrow.bookings(d)).claimDeadline);
  await warp(dEnd + 1);
  await (await escrow.connect(stranger).expire(d)).wait();
  log("undecided booking left past claim deadline -> anyone expires to funder", { status: Number((await escrow.bookings(d)).status) });

  if (await usdc.balanceOf(address) !== 0n) throw new Error("Escrow should hold no residual USDC");
  log("PASS", { escrowUsdc: await bal(address), ownerUsdc: await bal(OWNER) });
}

main().catch(error => { console.error(error); process.exitCode = 1; });
