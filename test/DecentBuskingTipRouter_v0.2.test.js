const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('DecentBuskingTipRouter v0.2', function () {
  const LIVE = 0, RADIO = 1;
  const radioRef = `decentbusking:radio:8453:0x${'ab'.repeat(20)}:49`;
  const liveRef = 'decentbusking:live:friday-live-performance:2026-11-27:wharfrat';
  let router, tipper, audio, video, other, admin, usdc;

  beforeEach(async function () {
    [tipper, audio, video, other, admin] = await ethers.getSigners();
    usdc = await (await ethers.getContractFactory('MockBookingToken')).deploy(6);
    router = await (await ethers.getContractFactory('DecentBuskingTipRouter_v0_2')).deploy(admin.address, [usdc.target]);
  });

  const split = (recipients, shares, { value = 10001n, kind = RADIO, ref = radioRef } = {}) =>
    router.connect(tipper).tipSplit(recipients, shares, kind, ref, { value });

  it('keeps the v0.1 tip interface and event, adds tipSplit, and has no receive or fallback', async function () {
    expect(router.interface.getFunction('tip').format('sighash')).to.equal('tip(address,uint8,string)');
    expect(router.interface.getFunction('tipSplit').format('sighash')).to.equal('tipSplit(address[],uint16[],uint8,string)');
    expect(router.interface.getEvent('TipSent').format('sighash')).to.equal('TipSent(address,address,bytes32,uint8,uint256,string)');
    expect(router.interface.fragments.some(f => f.type === 'receive' || f.type === 'fallback')).to.equal(false);
    const tx = await router.tip(audio.address, LIVE, liveRef, { value: 5n });
    await expect(tx).to.emit(router, 'TipSent').withArgs(tipper.address, audio.address, ethers.id(liveRef), LIVE, 5n, liveRef);
    await expect(tx).to.changeEtherBalances([tipper, audio, router], [-5n, 5n, 0n]);
  });

  it('splits one tip by shares, gives the rounding remainder to the last co-owner and keeps nothing', async function () {
    const tx = await split([audio.address, video.address], [5000, 5000]);
    await expect(tx).to.emit(router, 'TipSent').withArgs(tipper.address, audio.address, ethers.id(radioRef), RADIO, 5000n, radioRef);
    await expect(tx).to.emit(router, 'TipSent').withArgs(tipper.address, video.address, ethers.id(radioRef), RADIO, 5001n, radioRef);
    await expect(tx).to.changeEtherBalances([tipper, audio, video, router], [-10001n, 5000n, 5001n, 0n]);
    const uneven = await split([audio.address, video.address, other.address], [7000, 2000, 1000], { value: ethers.parseEther('0.01') });
    await expect(uneven).to.changeEtherBalances([audio, video, other],
      [ethers.parseEther('0.007'), ethers.parseEther('0.002'), ethers.parseEther('0.001')]);
    expect(await ethers.provider.getBalance(router.target)).to.equal(0n);
  });

  it('accepts exactly the splits DJuke accepts', async function () {
    const many = (await ethers.getSigners()).slice(1, 18).map(signer => signer.address);
    await expect(split([], [])).to.be.revertedWithCustomError(router, 'InvalidSplit');
    await expect(split([audio.address], [5000, 5000])).to.be.revertedWithCustomError(router, 'InvalidSplit');
    await expect(split([audio.address, video.address], [5000, 4999])).to.be.revertedWithCustomError(router, 'InvalidSplit');
    await expect(split([audio.address, video.address], [10000, 0])).to.be.revertedWithCustomError(router, 'InvalidSplit');
    await expect(split([audio.address, audio.address], [5000, 5000])).to.be.revertedWithCustomError(router, 'InvalidSplit');
    await expect(split([audio.address, ethers.ZeroAddress], [5000, 5000])).to.be.revertedWithCustomError(router, 'InvalidRecipient');
    await expect(split(many, many.map((_, index) => index ? 588 : 592))).to.be.revertedWithCustomError(router, 'InvalidSplit');
    await expect(split(many.slice(0, 16), many.slice(0, 16).map(() => 625))).to.emit(router, 'TipSent');
    await expect(split([audio.address], [10000])).to.changeEtherBalances([audio], [10001n]);
  });

  it('rejects zero or too-small amounts, bad source kinds and bad context like v0.1', async function () {
    const pair = [audio.address, video.address];
    await expect(split(pair, [5000, 5000], { value: 0n })).to.be.revertedWithCustomError(router, 'InvalidAmount');
    await expect(split(pair, [9999, 1], { value: 1n })).to.be.revertedWithCustomError(router, 'InvalidAmount');
    await expect(split(pair, [5000, 5000], { kind: 3 })).to.be.revertedWithCustomError(router, 'InvalidSourceKind');
    await expect(split(pair, [5000, 5000], { ref: '' })).to.be.revertedWithCustomError(router, 'InvalidContext');
    await expect(split(pair, [5000, 5000], { ref: 'x'.repeat(257) })).to.be.revertedWithCustomError(router, 'InvalidContext');
    expect(await router.queryFilter(router.filters.TipSent())).to.have.length(0);
  });

  it('reverts the whole split, paying nobody, when any co-owner refuses its share', async function () {
    const refuser = await (await ethers.getContractFactory('RejectingTipRecipient')).deploy();
    await expect(split([audio.address, refuser.target], [5000, 5000])).to.be.revertedWithCustomError(router, 'TransferFailed');
    expect(await ethers.provider.getBalance(refuser.target)).to.equal(0n);
    expect(await ethers.provider.getBalance(router.target)).to.equal(0n);
    expect(await router.queryFilter(router.filters.TipSent())).to.have.length(0);
  });

  it('cannot be sent ETH directly', async function () {
    await expect(tipper.sendTransaction({ to: router.target, value: 1n })).to.be.reverted;
  });

  describe('ERC-20 tips', function () {
    beforeEach(async function () {
      await usdc.mint(tipper.address, 1_000_000n);
      await usdc.connect(tipper).approve(router.target, 1_000_000n);
    });

    it('moves allowed tokens straight from the tipper to one owner or every co-owner by share', async function () {
      await expect(router.connect(tipper).tipToken(usdc.target, audio.address, 250_000n, RADIO, radioRef))
        .to.emit(router, 'TokenTipSent').withArgs(tipper.address, audio.address, ethers.id(radioRef), usdc.target, RADIO, 250_000n, radioRef);
      const tx = await router.connect(tipper).tipTokenSplit(usdc.target, [audio.address, video.address], [7000, 3000], 100_001n, RADIO, radioRef);
      await expect(tx).to.emit(router, 'TokenTipSent').withArgs(tipper.address, audio.address, ethers.id(radioRef), usdc.target, RADIO, 70_000n, radioRef);
      await expect(tx).to.emit(router, 'TokenTipSent').withArgs(tipper.address, video.address, ethers.id(radioRef), usdc.target, RADIO, 30_001n, radioRef);
      expect(await usdc.balanceOf(audio.address)).to.equal(320_000n);
      expect(await usdc.balanceOf(video.address)).to.equal(30_001n);
      expect(await usdc.balanceOf(router.target)).to.equal(0n);
    });

    it('rejects tokens the admin has not allowed, bad splits, zero amounts and missing approval', async function () {
      const ommm = await (await ethers.getContractFactory('MockBookingToken')).deploy(18);
      await expect(router.connect(tipper).tipToken(ommm.target, audio.address, 1n, RADIO, radioRef)).to.be.revertedWithCustomError(router, 'TokenNotAllowed');
      await expect(router.connect(tipper).tipToken(usdc.target, audio.address, 0n, RADIO, radioRef)).to.be.revertedWithCustomError(router, 'InvalidAmount');
      await expect(router.connect(tipper).tipToken(usdc.target, ethers.ZeroAddress, 1n, RADIO, radioRef)).to.be.revertedWithCustomError(router, 'InvalidRecipient');
      await expect(router.connect(tipper).tipTokenSplit(usdc.target, [audio.address, audio.address], [5000, 5000], 10n, RADIO, radioRef)).to.be.revertedWithCustomError(router, 'InvalidSplit');
      await expect(router.connect(tipper).tipTokenSplit(usdc.target, [audio.address, video.address], [9999, 1], 1n, RADIO, radioRef)).to.be.revertedWithCustomError(router, 'InvalidAmount');
      await usdc.connect(tipper).approve(router.target, 0n);
      await expect(router.connect(tipper).tipToken(usdc.target, audio.address, 1n, RADIO, radioRef)).to.be.reverted;
    });

    it('lets only the admin add or remove tokens, and never move a tipper\'s approved tokens', async function () {
      const ommm = await (await ethers.getContractFactory('MockBookingToken')).deploy(18);
      await expect(router.connect(tipper).setTokenAllowed(ommm.target, true)).to.be.revertedWithCustomError(router, 'OwnableUnauthorizedAccount');
      await expect(router.connect(admin).setTokenAllowed(audio.address, true)).to.be.revertedWithCustomError(router, 'InvalidToken');
      await expect(router.connect(admin).setTokenAllowed(ommm.target, true)).to.emit(router, 'TokenAllowed').withArgs(ommm.target, true);
      await ommm.mint(tipper.address, 5n);
      await ommm.connect(tipper).approve(router.target, 5n);
      await router.connect(tipper).tipToken(ommm.target, audio.address, 5n, LIVE, liveRef);
      expect(await ommm.balanceOf(audio.address)).to.equal(5n);
      await router.connect(admin).setTokenAllowed(usdc.target, false);
      await expect(router.connect(tipper).tipToken(usdc.target, audio.address, 1n, RADIO, radioRef)).to.be.revertedWithCustomError(router, 'TokenNotAllowed');
      await expect(router.connect(admin).recover(usdc.target, admin.address, 1n)).to.be.reverted;
      expect(await usdc.balanceOf(tipper.address)).to.equal(1_000_000n);
    });
  });

  describe('NFT gifts', function () {
    let nft1155, nft721;
    const gift = (collection, standard, tokenId, amount, recipient) => ({ collection, standard, tokenId, amount, recipient });

    beforeEach(async function () {
      nft1155 = await (await ethers.getContractFactory('MockBookingNFT')).deploy();
      nft721 = await (await ethers.getContractFactory('MockTipNFT721')).deploy();
      await nft1155.mint(tipper.address, 7n, 5n);
      await nft1155.mint(tipper.address, 8n, 1n);
      await nft721.mint(tipper.address, 42n);
      await nft1155.connect(tipper).setApprovalForAll(router.target, true);
      await nft721.connect(tipper).setApprovalForAll(router.target, true);
    });

    it('sends several different NFTs to any one or all of a song\'s owners in one call', async function () {
      const tx = await router.connect(tipper).giftNfts([
        gift(nft1155.target, 1, 7n, 2n, audio.address),
        gift(nft1155.target, 1, 7n, 3n, video.address),
        gift(nft1155.target, 1, 8n, 1n, video.address),
        gift(nft721.target, 0, 42n, 1n, audio.address),
      ], RADIO, radioRef);
      await expect(tx).to.emit(router, 'NftGiftSent')
        .withArgs(tipper.address, audio.address, ethers.id(radioRef), nft721.target, 0, 42n, 1n, RADIO, radioRef);
      await expect(tx).to.emit(router, 'NftGiftSent')
        .withArgs(tipper.address, video.address, ethers.id(radioRef), nft1155.target, 1, 7n, 3n, RADIO, radioRef);
      expect(await nft1155.balanceOf(audio.address, 7n)).to.equal(2n);
      expect(await nft1155.balanceOf(video.address, 7n)).to.equal(3n);
      expect(await nft1155.balanceOf(video.address, 8n)).to.equal(1n);
      expect(await nft721.ownerOf(42n)).to.equal(audio.address);
    });

    it('rejects empty or oversized batches, bad standards/amounts, self-gifts and NFTs the tipper does not own', async function () {
      const gifts = list => router.connect(tipper).giftNfts(list, RADIO, radioRef);
      await expect(gifts([])).to.be.revertedWithCustomError(router, 'InvalidGift');
      await expect(gifts(Array(33).fill(gift(nft1155.target, 1, 7n, 1n, audio.address)))).to.be.revertedWithCustomError(router, 'InvalidGift');
      await expect(gifts([gift(nft721.target, 0, 42n, 2n, audio.address)])).to.be.revertedWithCustomError(router, 'InvalidGift');
      await expect(gifts([gift(nft1155.target, 1, 7n, 0n, audio.address)])).to.be.revertedWithCustomError(router, 'InvalidGift');
      await expect(gifts([gift(nft1155.target, 2, 7n, 1n, audio.address)])).to.be.revertedWithCustomError(router, 'InvalidGift');
      await expect(gifts([gift(audio.address, 1, 7n, 1n, video.address)])).to.be.revertedWithCustomError(router, 'InvalidGift');
      await expect(gifts([gift(nft1155.target, 1, 7n, 1n, tipper.address)])).to.be.revertedWithCustomError(router, 'InvalidRecipient');
      await expect(gifts([gift(nft1155.target, 1, 7n, 1n, audio.address), gift(nft1155.target, 1, 7n, 9n, video.address)])).to.be.reverted;
      expect(await nft1155.balanceOf(audio.address, 7n)).to.equal(0n);
      await nft721.mint(other.address, 43n);
      await expect(gifts([gift(nft721.target, 0, 43n, 1n, audio.address)])).to.be.reverted;
    });

    it('refuses safe NFT transfers to itself, so gifts never rest in the contract', async function () {
      await expect(nft1155.connect(tipper).safeTransferFrom(tipper.address, router.target, 7n, 1n, '0x')).to.be.reverted;
      await expect(nft721.connect(tipper)['safeTransferFrom(address,address,uint256)'](tipper.address, router.target, 42n)).to.be.reverted;
    });
  });

  it('lets only the admin recover ERC-20 and ERC-721 assets sent to it by mistake', async function () {
    await usdc.mint(router.target, 9n);
    const nft721 = await (await ethers.getContractFactory('MockTipNFT721')).deploy();
    await nft721.mint(router.target, 1n);
    await expect(router.connect(tipper).recover(usdc.target, tipper.address, 9n)).to.be.revertedWithCustomError(router, 'OwnableUnauthorizedAccount');
    await expect(router.connect(admin).recover(usdc.target, admin.address, 9n)).to.emit(router, 'Recovered').withArgs(usdc.target, admin.address, 9n);
    expect(await usdc.balanceOf(admin.address)).to.equal(9n);
    await expect(router.connect(tipper).recoverERC721(nft721.target, 1n, tipper.address)).to.be.revertedWithCustomError(router, 'OwnableUnauthorizedAccount');
    await router.connect(admin).recoverERC721(nft721.target, 1n, admin.address);
    expect(await nft721.ownerOf(1n)).to.equal(admin.address);
    await expect(router.connect(admin).recover(ethers.ZeroAddress, admin.address, 1n)).to.be.revertedWithCustomError(router, 'TransferFailed');
  });
});
