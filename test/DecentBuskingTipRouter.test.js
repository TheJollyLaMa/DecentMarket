const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('DecentBuskingTipRouter', function () {
  const LIVE = 0, RADIO = 1, ARCHIVE = 2;
  const liveRef = 'decentbusking:live:friday-live-performance:2026-11-20:withinthevacuum';
  const radioRef = `decentbusking:radio:8453:0x${'ab'.repeat(20)}:12`;
  const archiveRef = `decentbusking:archive:8453:0x${'cd'.repeat(20)}:7`;
  const amount = ethers.parseEther('0.01');
  let router, tipper, performer, other;

  beforeEach(async function () {
    [tipper, performer, other] = await ethers.getSigners();
    router = await (await ethers.getContractFactory('DecentBuskingTipRouter')).deploy();
  });

  const send = (kind, ref, { value = amount, to = performer.address, from = tipper } = {}) =>
    router.connect(from).tip(to, kind, ref, { value });
  const routerBalance = async () => ethers.provider.getBalance(router.target);

  it('keeps the exact interface the DecentBusking app and ledger decode', function () {
    const tip = router.interface.getFunction('tip');
    expect(tip.format('sighash')).to.equal('tip(address,uint8,string)');
    expect(tip.stateMutability).to.equal('payable');
    const event = router.interface.getEvent('TipSent');
    expect(event.format('sighash')).to.equal('TipSent(address,address,bytes32,uint8,uint256,string)');
    expect(event.inputs.map(input => [input.name, input.indexed])).to.deep.equal([
      ['sender', true], ['recipient', true], ['contextId', true],
      ['sourceKind', false], ['amount', false], ['contextRef', false],
    ]);
    expect(router.interface.fragments.some(f => f.type === 'receive' || f.type === 'fallback')).to.equal(false);
  });

  for (const [name, kind, ref] of [['live show', LIVE, liveRef], ['radio play', RADIO, radioRef], ['archived recording', ARCHIVE, archiveRef]]) {
    it(`pays the whole ${name} tip to the performer and records where it came from`, async function () {
      const tx = await send(kind, ref);
      await expect(tx).to.emit(router, 'TipSent')
        .withArgs(tipper.address, performer.address, ethers.id(ref), kind, amount, ref);
      await expect(tx).to.changeEtherBalances([tipper, performer, router], [-amount, amount, 0n]);
      expect(await routerBalance()).to.equal(0n);
    });
  }

  it('lets the same wallet tip the same show repeatedly, each tip a separate event', async function () {
    const first = await send(LIVE, liveRef);
    const second = await send(LIVE, liveRef);
    const events = await router.queryFilter(router.filters.TipSent());
    expect(events).to.have.length(2);
    expect(events[0].transactionHash).to.equal(first.hash);
    expect(events[1].transactionHash).to.equal(second.hash);
    expect(events.map(event => event.args.amount)).to.deep.equal([amount, amount]);
    expect(await routerBalance()).to.equal(0n);
  });

  it('lets a ledger find one show or recording, one tipper or one performer by indexed filters', async function () {
    await send(LIVE, liveRef);
    await send(RADIO, radioRef, { from: other });
    await send(ARCHIVE, archiveRef, { to: other.address });
    const byContext = await router.queryFilter(router.filters.TipSent(null, null, ethers.id(radioRef)));
    expect(byContext.map(event => event.args.contextRef)).to.deep.equal([radioRef]);
    const byTipper = await router.queryFilter(router.filters.TipSent(tipper.address));
    expect(byTipper.map(event => event.args.contextRef)).to.deep.equal([liveRef, archiveRef]);
    const byPerformer = await router.queryFilter(router.filters.TipSent(null, performer.address));
    expect(byPerformer.map(event => event.args.contextRef)).to.deep.equal([liveRef, radioRef]);
  });

  it('rejects a zero recipient, a zero amount and unknown source kinds', async function () {
    await expect(send(LIVE, liveRef, { to: ethers.ZeroAddress })).to.be.revertedWithCustomError(router, 'InvalidRecipient');
    await expect(send(LIVE, liveRef, { value: 0n })).to.be.revertedWithCustomError(router, 'InvalidAmount');
    for (const kind of [3, 4, 255]) {
      await expect(send(kind, liveRef)).to.be.revertedWithCustomError(router, 'InvalidSourceKind');
    }
    expect(await router.queryFilter(router.filters.TipSent())).to.have.length(0);
  });

  it('requires a context reference of 1 to 256 bytes, counting bytes rather than characters', async function () {
    await expect(send(LIVE, '')).to.be.revertedWithCustomError(router, 'InvalidContext');
    await expect(send(LIVE, 'x'.repeat(257))).to.be.revertedWithCustomError(router, 'InvalidContext');
    await expect(send(LIVE, 'x'.repeat(256))).to.emit(router, 'TipSent');
    expect(await router.MAX_CONTEXT_BYTES()).to.equal(256n);

    const twoBytePerChar = 'é'.repeat(128);
    expect(ethers.toUtf8Bytes(twoBytePerChar)).to.have.length(256);
    await expect(send(LIVE, twoBytePerChar)).to.emit(router, 'TipSent');
    const overByBytes = 'é'.repeat(129);
    expect(overByBytes.length).to.be.lessThan(256);
    await expect(send(LIVE, overByBytes)).to.be.revertedWithCustomError(router, 'InvalidContext');
  });

  it('hashes the exact UTF-8 bytes and returns the reference unchanged', async function () {
    const ref = 'decentbusking:live:café-🎸';
    const tx = await send(LIVE, ref);
    await expect(tx).to.emit(router, 'TipSent').withArgs(tipper.address, performer.address, ethers.id(ref), LIVE, amount, ref);
    const [event] = await router.queryFilter(router.filters.TipSent());
    expect(event.args.contextId).to.equal(ethers.keccak256(ethers.toUtf8Bytes(ref)));
  });

  it('reverts the whole tip, with no event and no stranded funds, when the recipient refuses it', async function () {
    const refuser = await (await ethers.getContractFactory('RejectingTipRecipient')).deploy();
    const before = await ethers.provider.getBalance(tipper.address);
    await expect(send(LIVE, liveRef, { to: refuser.target })).to.be.revertedWithCustomError(router, 'TransferFailed');
    await expect(router.tip(refuser.target, LIVE, liveRef, { value: amount, gasLimit: 200_000 }))
      .to.be.revertedWithCustomError(router, 'TransferFailed');
    expect(await ethers.provider.getBalance(tipper.address)).to.be.lessThanOrEqual(before);
    expect(await ethers.provider.getBalance(refuser.target)).to.equal(0n);
    expect(await routerBalance()).to.equal(0n);
    expect(await router.queryFilter(router.filters.TipSent())).to.have.length(0);
  });

  it('delivers to contract wallets whose receive hook needs more than the transfer stipend', async function () {
    const wallet = await (await ethers.getContractFactory('GasHungryTipRecipient')).deploy();
    const tx = await send(LIVE, liveRef, { to: wallet.target });
    await expect(tx).to.changeEtherBalances([tipper, wallet, router], [-amount, amount, 0n]);
    expect(await wallet.received()).to.equal(amount);
  });

  it('refuses to tip the router itself, which cannot receive ETH', async function () {
    await expect(send(LIVE, liveRef, { to: router.target })).to.be.revertedWithCustomError(router, 'TransferFailed');
    expect(await routerBalance()).to.equal(0n);
  });

  it('lets a recipient tip onward in the same transaction without trapping or double counting funds', async function () {
    const splitter = await (await ethers.getContractFactory('ReentrantTipRecipient')).deploy(router.target);
    await splitter.arm(other.address, RADIO, radioRef);
    const tx = await send(LIVE, liveRef, { to: splitter.target });
    await expect(tx).to.emit(router, 'TipSent')
      .withArgs(tipper.address, splitter.target, ethers.id(liveRef), LIVE, amount, liveRef);
    await expect(tx).to.emit(router, 'TipSent')
      .withArgs(splitter.target, other.address, ethers.id(radioRef), RADIO, amount / 2n, radioRef);
    await expect(tx).to.changeEtherBalances([tipper, splitter, other, router], [-amount, amount / 2n, amount / 2n, 0n]);
    expect(await router.queryFilter(router.filters.TipSent())).to.have.length(2);
  });

  it('cannot be sent ETH directly or through an unknown function, so it never holds funds', async function () {
    await expect(tipper.sendTransaction({ to: router.target, value: 1n })).to.be.reverted;
    await expect(tipper.sendTransaction({ to: router.target, data: '0x12345678', value: 1n })).to.be.reverted;
    await send(LIVE, liveRef);
    expect(await routerBalance()).to.equal(0n);
  });

  it('allows a wallet to tip itself, which the ledger can recognise from sender equal to recipient', async function () {
    const tx = await send(LIVE, liveRef, { to: tipper.address });
    await expect(tx).to.emit(router, 'TipSent')
      .withArgs(tipper.address, tipper.address, ethers.id(liveRef), LIVE, amount, liveRef);
  });

  it('keeps the cost of a tip close to a plain transfer', async function () {
    const receipt = await (await send(LIVE, liveRef)).wait();
    expect(receipt.gasUsed).to.be.lessThan(60_000n);
  });
});
