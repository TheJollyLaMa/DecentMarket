const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('DecentBuskingTipRouter v0.2', function () {
  const LIVE = 0, RADIO = 1;
  const radioRef = `decentbusking:radio:8453:0x${'ab'.repeat(20)}:49`;
  const liveRef = 'decentbusking:live:friday-live-performance:2026-11-27:wharfrat';
  let router, tipper, audio, video, other;

  beforeEach(async function () {
    [tipper, audio, video, other] = await ethers.getSigners();
    router = await (await ethers.getContractFactory('DecentBuskingTipRouter_v0_2')).deploy();
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
});
