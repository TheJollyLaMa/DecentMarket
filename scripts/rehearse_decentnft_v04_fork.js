// Rehearses DecentNFT v0.4 creator permissions on a LOCAL fork of Base. Broadcasts nothing.
//   npm run rehearse:nft-v04:fork
// Deploys a fresh v0.4 inside the in-process Hardhat fork with Hardhat's built-in test
// accounts only, and proves the live Base collections are read, never written.
const { ethers, network } = require("hardhat");

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const LIVE_COLLECTIONS = {
  supporterV02: "0xe63EC9f8228720bAAC2fD528C0A6d06B3Dc5439B",
  musicV03: "0x64D5aDc50E5513975EfF7e9ba366B7eE58586fa3",
};
const AGENCY_ADMIN = "0x807061DF657A7697c04045dA7d16D941861cAABc";
const LIVE_ABI = [
  "function nextTokenId() view returns (uint256)",
  "function hasRole(bytes32, address) view returns (bool)",
];
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];

async function snapshot() {
  const out = {};
  for (const [name, address] of Object.entries(LIVE_COLLECTIONS)) {
    const code = await ethers.provider.getCode(address);
    if (code === "0x") throw new Error(`${name} has no code on this fork`);
    const live = new ethers.Contract(address, LIVE_ABI, ethers.provider);
    out[name] = {
      address,
      codeHash: ethers.keccak256(code),
      nextTokenId: (await live.nextTokenId()).toString(),
      agencyAdmin: await live.hasRole(ethers.ZeroHash, AGENCY_ADMIN),
    };
  }
  return out;
}

async function fundUsdc(holder, amount) {
  const token = new ethers.Contract(BASE_USDC, ERC20_ABI, ethers.provider);
  for (let slot = 0; slot < 20; slot++) {
    const key = ethers.solidityPackedKeccak256(["uint256", "uint256"], [holder, slot]);
    const previous = await network.provider.send("eth_getStorageAt", [BASE_USDC, key]);
    await network.provider.send("hardhat_setStorageAt", [BASE_USDC, key, ethers.toBeHex(amount, 32)]);
    if (await token.balanceOf(holder) === amount) return token;
    await network.provider.send("hardhat_setStorageAt", [BASE_USDC, key, previous]);
  }
  throw new Error("Could not locate the fork USDC balance slot");
}

async function expectRevert(promise, label) {
  try { await (await promise).wait(); } catch { return; }
  throw new Error(`Expected revert: ${label}`);
}

async function main() {
  if (network.name !== "hardhat" || Number((await ethers.provider.getNetwork()).chainId) !== 8453) {
    throw new Error("Run with BASE_FORK_RPC on the in-process hardhat network only");
  }
  if (!network.config.forking?.url) throw new Error("BASE_FORK_RPC fork is required");
  await network.provider.send("hardhat_mine", ["0x1"]);
  const before = await snapshot();

  const [admin, alice, bob, collector, splitter] = await ethers.getSigners();
  const nft = await (await ethers.getContractFactory("DecentNFT_v0_4")).deploy("", admin.address, 500, 1000);
  await nft.waitForDeployment();
  await (await nft.authorizeCreator(alice.address, 2, 50)).wait();
  await (await nft.authorizeCreator(bob.address, 2, 50)).wait();
  await (await nft.setEditionGiftRecipient(collector.address)).wait();

  const aliceTx = await (await nft.connect(alice).registerAndMintProductWithGift(
    19, 50, "ipfs://rehearsal-alice", splitter.address, 750, collector.address)).wait();
  const bobTx = await (await nft.connect(bob).registerAndMintProduct(
    1, 1, "ipfs://rehearsal-bob", bob.address, 0)).wait();
  if (await nft.balanceOf(alice.address, 0) !== 18n || await nft.balanceOf(collector.address, 0) !== 1n ||
      await nft.totalMinted(0) !== 19n) throw new Error("Optional gift split or supply mismatch");
  await (await nft.registerAndMintProductsBatch([{ recipient: collector.address, amount: 1, maxSupply: 1,
    tokenURI: "ipfs://rehearsal-agency", royaltyReceiver: admin.address, royaltyFeeBps: 500 }])).wait();

  const minted = (receipt) => receipt.logs.map(log => { try { return nft.interface.parseLog(log); } catch { return null; } })
    .filter(event => event?.name === "EditionMinted").map(event => ({
      tokenId: event.args.tokenId.toString(), to: event.args.to, minter: event.args.minter }));

  await expectRevert(nft.connect(bob).mintCreatorProduct(0, 1), "bob minting alice's product");
  await expectRevert(nft.mintProduct(admin.address, 0, 1), "admin minting alice's product");
  await expectRevert(nft.setTokenRoyalty(0, admin.address, 500), "admin re-royaltying alice's product");
  await expectRevert(nft.connect(alice).grantRole(await nft.CREATOR_ROLE(), collector.address), "creator granting roles");
  await expectRevert(nft.connect(alice).registerAndMintProduct(1, 10, "ipfs://x", alice.address, 1001), "royalty over cap");
  await (await nft.pause()).wait();
  await expectRevert(nft.connect(alice).mintCreatorProduct(0, 1), "mint while paused");
  await (await nft.unpause()).wait();
  await (await nft.revokeCreator(bob.address)).wait();
  await expectRevert(nft.connect(bob).registerAndMintProduct(1, 1, "ipfs://y", bob.address, 0), "revoked creator");

  const nftAddress = await nft.getAddress();
  const usdc = await fundUsdc(nftAddress, 1_000_000n);
  await (await nft.recoverERC20(BASE_USDC, admin.address, 1_000_000n)).wait();

  const after = await snapshot();
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error(`Live collections changed: ${JSON.stringify({ before, after })}`);
  }

  console.log(JSON.stringify({
    fork: { chainId: 8453, block: await ethers.provider.getBlockNumber(), broadcast: false },
    liveCollectionsUnchanged: after,
    rehearsalCollection: nftAddress,
    nextTokenId: (await nft.nextTokenId()).toString(),
    creators: {
      alice: { creatorOf0: await nft.creatorOf(0), royalty0: (await nft.royaltyInfo(0, 10000)).map(String), minted: minted(aliceTx) },
      bob: { creatorOf1: await nft.creatorOf(1), minted: minted(bobTx), revoked: !(await nft.hasRole(await nft.CREATOR_ROLE(), bob.address)) },
    },
    agencyToken2Creator: await nft.creatorOf(2),
    strayUsdcRecovered: (await usdc.balanceOf(nftAddress)) === 0n,
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
