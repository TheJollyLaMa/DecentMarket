// Rehearses the DecentBusking Base rollout on a local fork of real Base state. Broadcasts nothing.
//   npm run rehearse:dbusk:fork
const { ethers, network } = require("hardhat");

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const SETTLEMENT_ROUTER = "0x8ecca903e2a6Daa8CCbB933700e4F2C58C44A4B5";
const ROUTER_ABI = [
  "function funds(bytes32) view returns (string metadataUri, bool active, bool exists)",
  "function fundBalances(bytes32, address) view returns (uint256)",
  "function approvedAssets(address) view returns (bool)",
];

async function fundUsdc(token, holder, amount) {
  for (let slot = 0; slot < 20; slot++) {
    const key = ethers.solidityPackedKeccak256(["uint256", "uint256"], [holder, slot]);
    const previous = await network.provider.send("eth_getStorageAt", [BASE_USDC, key]);
    await network.provider.send("hardhat_setStorageAt", [BASE_USDC, key, ethers.toBeHex(amount, 32)]);
    if (await token.balanceOf(holder) === amount) return;
    await network.provider.send("hardhat_setStorageAt", [BASE_USDC, key, previous]);
  }
  throw new Error("Could not locate the fork USDC balance slot");
}

async function main() {
  if (network.name !== "hardhat" || Number((await ethers.provider.getNetwork()).chainId) !== 8453) {
    throw new Error("Run with BASE_FORK_RPC on the local hardhat network only");
  }
  // Calls at the fork block itself need remote hardfork history; run on a fresh local block instead.
  await network.provider.send("hardhat_mine", ["0x1"]);
  const [admin, fulfiller, listener, artist, collaborator] = await ethers.getSigners();
  const fundId = ethers.id("dbusk-repo-dev");
  const pinnerFundId = ethers.id("dbusk-pinners");
  const router = new ethers.Contract(SETTLEMENT_ROUTER, ROUTER_ABI, ethers.provider);
  const fund = await router.funds(fundId);
  const pinnerFund = await router.funds(pinnerFundId);
  const checks = { repoFundExists: fund.exists, repoFundActive: fund.active,
    pinnerFundExists: pinnerFund.exists, pinnerFundActive: pinnerFund.active,
    usdcApproved: await router.approvedAssets(BASE_USDC) };
  if (!fund.exists || !pinnerFund.exists) {
    const routerAdmin = process.env.DBUSK_ROUTER_ADMIN || "0x807061DF657A7697c04045dA7d16D941861cAABc";
    await network.provider.send("hardhat_impersonateAccount", [routerAdmin]);
    await network.provider.send("hardhat_setBalance", [routerAdmin, "0x8AC7230489E80000"]);
    const adminRouter = new ethers.Contract(SETTLEMENT_ROUTER, ["function createFund(bytes32, string)"], await ethers.getSigner(routerAdmin));
    if (!fund.exists) await (await adminRouter.createFund(fundId, "https://thejollylama.github.io/DecentBusking/payroll-assets.json#dbusk-repo-dev")).wait();
    if (!pinnerFund.exists) await (await adminRouter.createFund(pinnerFundId, "https://thejollylama.github.io/DecentBusking/payroll-assets.json#dbusk-pinners")).wait();
    checks.fundsCreatedOnForkOnly = true;
    checks.repoFundActive = (await router.funds(fundId)).active;
    checks.pinnerFundActive = (await router.funds(pinnerFundId)).active;
  }
  if (!checks.repoFundActive || !checks.pinnerFundActive || !checks.usdcApproved) throw new Error(`Router not ready: ${JSON.stringify(checks)}`);

  const nft = await (await ethers.getContractFactory("DecentNFT_v0_3")).deploy("", admin.address, 500);
  const djuke = await (await ethers.getContractFactory("DecentJukeBox_v0_1"))
    .deploy(BASE_USDC, SETTLEMENT_ROUTER, fundId, pinnerFundId, admin.address);
  await djuke.grantRole(await djuke.FULFILLER_ROLE(), fulfiller.address);
  await djuke.grantRole(await djuke.REGISTRAR_ROLE(), fulfiller.address);

  const batch = await nft.registerAndMintProductsBatch(["first", "second", "third"].map(name => ({
    recipient: artist.address, amount: 1, maxSupply: 0, tokenURI: `ipfs://rehearsal-${name}`,
    royaltyReceiver: artist.address, royaltyFeeBps: 500 })));
  const batchReceipt = await batch.wait();

  const songIds = ["solo", "duet"].map(name => ethers.id(`album:rehearsal:${name}`));
  await djuke.connect(fulfiller).multicall([
    djuke.interface.encodeFunctionData("registerSong", [songIds[0], "ipfs://solo", [artist.address], [10000]]),
    djuke.interface.encodeFunctionData("registerSong", [songIds[1], "ipfs://duet", [artist.address, collaborator.address], [7000, 3000]]),
  ]);

  const usdc = await ethers.getContractAt("IERC20", BASE_USDC);
  await fundUsdc(usdc, listener.address, 10_000_000n);
  const before = await router.fundBalances(fundId, BASE_USDC);
  const pinnersBefore = await router.fundBalances(pinnerFundId, BASE_USDC);
  const price = await djuke.quote();
  await usdc.connect(listener).approve(await djuke.getAddress(), price);
  await djuke.connect(listener).requestPlay(songIds[1], price);
  await djuke.connect(fulfiller).fulfill(0, songIds[1], 0, ethers.id("rehearsal-play-0"));
  const fundDelta = (await router.fundBalances(fundId, BASE_USDC)) - before;
  const pinnerDelta = (await router.fundBalances(pinnerFundId, BASE_USDC)) - pinnersBefore;
  const credits = [await djuke.artistCredits(artist.address), await djuke.artistCredits(collaborator.address)];
  await usdc.connect(listener).approve(await djuke.getAddress(), 500000n);
  await djuke.connect(listener).purchaseListens(songIds, 500000n);
  const listenFundDelta = (await router.fundBalances(fundId, BASE_USDC)) - before - fundDelta;
  const listenPinnerDelta = (await router.fundBalances(pinnerFundId, BASE_USDC)) - pinnersBefore - pinnerDelta;
  const queueAfterListens = (await djuke.pendingCount()).toString();
  await djuke.connect(artist).withdrawArtistCredit();

  const result = { ...checks, batchMintGas: batchReceipt.gasUsed.toString(), batchTokens: (await nft.nextTokenId()).toString(),
    priceUnits: price.toString(), repoFundDeltaUnits: fundDelta.toString(), pinnerFundDeltaUnits: pinnerDelta.toString(),
    artistCreditUnits: credits[0].toString(), collaboratorCreditUnits: credits[1].toString(),
    listenPlaylistFundDeltaUnits: listenFundDelta.toString(), listenPlaylistPinnerFundDeltaUnits: listenPinnerDelta.toString(), queueAfterListens,
    artistWithdrawnUnits: (await usdc.balanceOf(artist.address)).toString(), broadcast: false };
  if (price !== 250000n || fundDelta !== 5000n || pinnerDelta !== 20000n || credits[0] !== 157500n || credits[1] !== 67500n ||
    listenFundDelta !== 10000n || listenPinnerDelta !== 40000n || queueAfterListens !== "0") {
    throw new Error(`Unexpected rehearsal amounts: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
