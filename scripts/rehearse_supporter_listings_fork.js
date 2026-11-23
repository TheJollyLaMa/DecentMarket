// Rehearses DecentSupporterListings v0.1 against real Base Supporter DNFTs on a LOCAL fork. Broadcasts nothing.
//   npm run rehearse:listings:fork
// Fork-only state changes: the Agency escrow owner is impersonated to hand two DecentHead editions to a test
// seller, and test buyers receive USDC via a storage write. No key is read and no live network is touched.
const { ethers, network } = require("hardhat");

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
// DEPLOYMENTS.md / README.md: Base DecentNFT v0.2 (Supporter collection) and DecentEscrow v0.1.
const SUPPORTER_NFT = "0xe63EC9f8228720bAAC2fD528C0A6d06B3Dc5439B";
const AGENCY_ESCROW = "0x31b07b83e99A9bdF379bf40225b8A80d3804C89d";
// releases/listings.json: DecentHead v2.0.0 Supporter, token 70, escrow listing 11 at 10 USDC.
const TOKEN_ID = 70n;
const ESCROW_LISTING_ID = 11n;
const PRICE = 10_000_000n;

const ESCROW_ABI = [
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
  "function withdrawNFT(address,uint256,uint256,address)",
  "function purchaseWithToken(uint256,uint256)",
  "function listings(uint256) view returns (address nftContract, uint256 tokenId, uint256 priceETH, address priceToken, uint256 priceAmount, uint256 available, bool active, string note)",
];
const NFT_ABI = [
  "function balanceOf(address,uint256) view returns (uint256)",
  "function setApprovalForAll(address,bool)",
  "function royaltyInfo(uint256,uint256) view returns (address,uint256)",
  "function supportsInterface(bytes4) view returns (bool)",
];
const USDC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
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

function check(condition, label, checks) {
  checks[label] = Boolean(condition);
  if (!condition) throw new Error(`Rehearsal check failed: ${label}\n${JSON.stringify(checks, null, 2)}`);
}

async function main() {
  if (network.name !== "hardhat" || !network.config.forking?.url
      || Number((await ethers.provider.getNetwork()).chainId) !== 8453) {
    throw new Error("Run with BASE_FORK_RPC on the local hardhat network only");
  }
  await network.provider.send("hardhat_mine", ["0x1"]);
  const [admin, seller, buyer, escrowBuyer] = await ethers.getSigners();
  const checks = {};

  const nft = new ethers.Contract(SUPPORTER_NFT, NFT_ABI, ethers.provider);
  const usdc = new ethers.Contract(BASE_USDC, USDC_ABI, ethers.provider);
  const escrow = new ethers.Contract(AGENCY_ESCROW, ESCROW_ABI, ethers.provider);
  const escrowListingBefore = await escrow.listings(ESCROW_LISTING_ID);
  check(escrowListingBefore.nftContract === SUPPORTER_NFT && escrowListingBefore.tokenId === TOKEN_ID,
    "escrowListing11IsDecentHead70", checks);
  check(await nft.supportsInterface("0x2a55205a"), "collectionSupportsERC2981", checks);

  // Fork only: the Agency hands two editions to a test seller, as a collaborator or performer gift would.
  const escrowOwner = await escrow.owner();
  await network.provider.send("hardhat_impersonateAccount", [escrowOwner]);
  await network.provider.send("hardhat_setBalance", [escrowOwner, "0x8AC7230489E80000"]);
  await (await escrow.connect(await ethers.getSigner(escrowOwner)).withdrawNFT(SUPPORTER_NFT, TOKEN_ID, 2, seller.address)).wait();
  await network.provider.send("hardhat_stopImpersonatingAccount", [escrowOwner]);
  check(await nft.balanceOf(seller.address, TOKEN_ID) === 2n, "sellerHoldsTwoEditions", checks);

  const listings = await (await ethers.getContractFactory("DecentSupporterListings_v0_1"))
    .deploy(admin.address, [BASE_USDC], [SUPPORTER_NFT]);
  const L = await listings.getAddress();

  await (await nft.connect(seller).setApprovalForAll(L, true)).wait();
  await (await listings.connect(seller).list(SUPPORTER_NFT, TOKEN_ID, 2, BASE_USDC, PRICE)).wait();
  check(await listings.custodied(SUPPORTER_NFT, TOKEN_ID) === 2n, "custodyRecorded", checks);

  const [royaltyReceiver, royaltyQuoted] = await nft.royaltyInfo(TOKEN_ID, PRICE);
  const q = await listings.quote(0, 1);
  const cap = PRICE * 1000n / 10000n;
  check(q.royaltyAmount === (royaltyQuoted > cap ? cap : royaltyQuoted) && q.platformFee === 0n
    && q.sellerProceeds === PRICE - q.royaltyAmount, "quoteMatchesRealRoyalty", checks);

  await fundUsdc(usdc, buyer.address, 100_000_000n);
  await (await usdc.connect(buyer).approve(L, PRICE)).wait();
  await (await listings.connect(buyer).purchaseWithToken(0, 1, PRICE)).wait();
  check(await nft.balanceOf(buyer.address, TOKEN_ID) === 1n, "buyerReceivedEdition", checks);
  check(await listings.owed(seller.address, BASE_USDC) === q.sellerProceeds, "sellerCredited", checks);

  const sellerUsdcBefore = await usdc.balanceOf(seller.address);
  await (await listings.connect(seller).withdraw(BASE_USDC)).wait();
  check(await usdc.balanceOf(seller.address) - sellerUsdcBefore === q.sellerProceeds, "sellerWithdrewUsdc", checks);
  if (q.royaltyAmount > 0n) {
    await (await listings.withdrawFor(royaltyReceiver, BASE_USDC)).wait();
  }
  check(await usdc.balanceOf(L) === 0n && await listings.totalOwed(BASE_USDC) === 0n, "noFundsLeftBehind", checks);

  check(await listings.strayERC1155(SUPPORTER_NFT, TOKEN_ID) === 0n, "noStrayEditions", checks);
  await (await listings.pause()).wait();
  await (await listings.emergencyReturn([0])).wait();
  check(await nft.balanceOf(seller.address, TOKEN_ID) === 1n
    && await nft.balanceOf(admin.address, TOKEN_ID) === 0n, "emergencyReturnWentToSeller", checks);

  // The Agency's existing escrow listing keeps working beside the new contract.
  if (!(await escrow.paused()) && escrowListingBefore.active && escrowListingBefore.priceAmount > 0n) {
    await fundUsdc(usdc, escrowBuyer.address, escrowListingBefore.priceAmount);
    await (await usdc.connect(escrowBuyer).approve(AGENCY_ESCROW, escrowListingBefore.priceAmount)).wait();
    await (await escrow.connect(escrowBuyer).purchaseWithToken(ESCROW_LISTING_ID, 1)).wait();
    const after = await escrow.listings(ESCROW_LISTING_ID);
    check(after.available === escrowListingBefore.available - 1n
      && await nft.balanceOf(escrowBuyer.address, TOKEN_ID) === 1n, "agencyEscrowListing11StillSells", checks);
  } else {
    checks.agencyEscrowListing11StillSells = "skipped: listing inactive or escrow paused at fork block";
  }

  console.log(JSON.stringify({
    forkBlock: await ethers.provider.getBlockNumber(),
    collection: SUPPORTER_NFT,
    tokenId: TOKEN_ID.toString(),
    listingsContractOnFork: L,
    royalty: { receiver: royaltyReceiver, quotedOn10Usdc: royaltyQuoted.toString(), honoured: q.royaltyAmount.toString() },
    sellerProceeds: q.sellerProceeds.toString(),
    checks,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
