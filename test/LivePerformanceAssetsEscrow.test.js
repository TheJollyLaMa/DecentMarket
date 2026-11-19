const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

describe('LivePerformanceAssetsEscrow (experimental)', function () {
  let admin, performer, other, token, nft, escrow, start, end, terms, id;
  const uri = 'ipfs://terms', report = 'ipfs://report';
  before(async function () {
    if ((await ethers.provider.getNetwork()).chainId !== 8453n) this.skip();
  });
  beforeEach(async function () {
    [admin, performer, other] = await ethers.getSigners();
    token = await (await ethers.getContractFactory('MockLiveToken')).deploy();
    nft = await (await ethers.getContractFactory('MockBookingNFT')).deploy();
    escrow = await (await ethers.getContractFactory('LivePerformanceAssetsEscrow')).deploy(admin.address, token.target);
    start = await time.latest() + 3600;
    end = start + 1200;
    id = ethers.id('canonical booking');
    terms = { performer: performer.address, asset: token.target, amount: 20_000_000n,
      showStart: start, showEnd: end, reviewWindow: 3600, termsHash: ethers.id('signed terms'),
      collection: nft.target, tokenId: 75, quantity: 1, giftTreasury: admin.address };
    await token.mint(admin.address, ethers.parseEther('10'));
    await token.approve(escrow.target, ethers.MaxUint256);
    await nft.mint(admin.address, 75, 2);
    await nft.setApprovalForAll(escrow.target, true);
  });
  async function fund(t = terms, booking = id, value = 0n) {
    return escrow.createBooking(booking, t, uri, { value });
  }
  it('binds immutable booking terms and recipient; only the producer may decide or release', async function () {
    await expect(fund({ ...terms, giftTreasury: ethers.ZeroAddress })).to.be.revertedWithCustomError(escrow, 'InvalidBooking');
    await expect(escrow.connect(other).createBooking(id, terms, uri)).to.be.revertedWithCustomError(escrow, 'AccessControlUnauthorizedAccount');
    await fund();
    const b = await escrow.bookings(id);
    expect(b.terms.performer).to.equal(performer.address);
    expect(b.terms.termsHash).to.equal(terms.termsHash);
    expect(b.terms.collection).to.equal(nft.target);
    expect(b.terms.tokenId).to.equal(75);
    expect(b.terms.quantity).to.equal(1);
    expect(b.terms.giftTreasury).to.equal(admin.address);
    await time.increaseTo(end);
    await expect(escrow.connect(other).approvePerformance(id, report)).to.be.revertedWithCustomError(escrow, 'AccessControlUnauthorizedAccount');
    await escrow.approvePerformance(id, report);
    await expect(escrow.connect(other).releaseGift(id)).to.be.revertedWithCustomError(escrow, 'AccessControlUnauthorizedAccount');
    await expect(escrow.connect(other).claim(id)).to.be.revertedWithCustomError(escrow, 'InvalidState');
    await expect(escrow.releaseGift(id)).to.emit(escrow, 'GiftSettled').withArgs(id, 4, performer.address, nft.target, 75, 1);
  });
  it('reserves an exact edition and pays fee independently of rejected gift; release can retry', async function () {
    const recipient = await (await ethers.getContractFactory('MockBookingRecipient')).deploy();
    terms.performer = recipient.target;
    await recipient.configure(escrow.target, id, true, false, false);
    await fund();
    expect(await nft.balanceOf(escrow.target, 75)).to.equal(1);
    await expect(fund()).to.be.revertedWithCustomError(escrow, 'InvalidBooking');
    await time.increaseTo(end);
    await escrow.approvePerformance(id, report);
    await expect(escrow.releaseGift(id)).to.be.revertedWith('reject NFT');
    expect((await escrow.bookings(id)).giftStatus).to.equal(2);
    await recipient.claim();
    expect(await token.balanceOf(recipient.target)).to.equal(terms.amount);
    await recipient.configure(escrow.target, id, false, false, false);
    await expect(escrow.releaseGift(id)).to.emit(escrow, 'GiftSettled')
      .withArgs(id, 4, recipient.target, nft.target, 75, 1);
    await expect(escrow.releaseGift(id)).to.be.revertedWithCustomError(escrow, 'InvalidState');
  });
  it('requires physical unlisted inventory and rejects duplicate or over-allocated reservations', async function () {
    await fund();
    await nft.safeTransferFrom(admin.address, other.address, 75, 1, '0x');
    await expect(fund(terms, ethers.id('second'))).to.be.reverted;
    expect((await escrow.bookings(ethers.id('second'))).feeStatus).to.equal(0);
    expect(await nft.balanceOf(escrow.target, 75)).to.equal(1);
  });
  it('prevents gift receiver reentry even when the recipient also has the admin role', async function () {
    const recipient = await (await ethers.getContractFactory('MockBookingRecipient')).deploy();
    terms.performer = recipient.target;
    await recipient.configure(escrow.target, id, false, false, true);
    await escrow.grantRole(await escrow.ADMIN_ROLE(), recipient.target);
    await fund();
    await time.increaseTo(end);
    await escrow.approvePerformance(id, report);
    await escrow.releaseGift(id);
    expect(await recipient.reentrySucceeded()).to.equal(false);
    expect(await nft.balanceOf(recipient.target, 75)).to.equal(1);
  });
  it('accepts exact Base ETH, rejects wrong amount, retries rejected transfers and blocks reentry', async function () {
    const recipient = await (await ethers.getContractFactory('MockBookingRecipient')).deploy();
    terms = { ...terms, performer: recipient.target, asset: ethers.ZeroAddress, amount: ethers.parseEther('0.02'), collection: ethers.ZeroAddress, tokenId: 0, quantity: 0, giftTreasury: ethers.ZeroAddress };
    await expect(fund(terms, id, terms.amount - 1n)).to.be.revertedWithCustomError(escrow, 'InvalidBooking');
    await fund(terms, id, terms.amount);
    await time.increaseTo(end);
    await escrow.approvePerformance(id, report);
    await recipient.configure(escrow.target, id, false, true, false);
    await expect(recipient.claim()).to.be.reverted;
    expect((await escrow.bookings(id)).feeStatus).to.equal(2);
    await recipient.configure(escrow.target, id, false, false, true);
    await recipient.claim();
    expect(await recipient.reentrySucceeded()).to.equal(false);
    expect(await ethers.provider.getBalance(recipient.target)).to.equal(terms.amount);
  });
  it('requires producer token approval and exact received units, without changing existing liabilities', async function () {
    const alt = await (await ethers.getContractFactory('MockLiveToken')).deploy();
    await alt.mint(admin.address, terms.amount);
    await alt.approve(escrow.target, terms.amount);
    terms.asset = alt.target;
    await expect(fund()).to.be.revertedWithCustomError(escrow, 'UnsupportedToken');
    await escrow.setTokenApproval(alt.target, true);
    await alt.setFee(1);
    await expect(fund()).to.be.revertedWithCustomError(escrow, 'UnsupportedToken');
    await alt.setFee(0);
    await fund();
    await escrow.setTokenApproval(alt.target, false);
    await time.increaseTo(end);
    await escrow.approvePerformance(id, report);
    await escrow.connect(performer).claim(id);
    expect(await alt.balanceOf(performer.address)).to.equal(terms.amount);
  });
  for (const decimals of [6, 18]) it(`preserves exact ${decimals}-decimal token quantities`, async function () {
    const alt = await (await ethers.getContractFactory('MockBookingToken')).deploy(decimals);
    const amount = ethers.parseUnits('0.02', decimals);
    await alt.mint(admin.address, amount);
    await alt.approve(escrow.target, amount);
    await escrow.setTokenApproval(alt.target, true);
    await fund({ ...terms, asset: alt.target, amount });
    await time.increaseTo(end);
    await escrow.approvePerformance(id, report);
    await escrow.connect(performer).claim(id);
    expect(await alt.balanceOf(performer.address)).to.equal(amount);
  });
  it('only reserves stock physically withdrawn after sales and delisting', async function () {
    const market = await (await ethers.getContractFactory('DecentEscrow_v001')).deploy(admin.address);
    await nft.safeTransferFrom(admin.address, market.target, 75, 2, '0x');
    await market.listDNFT(nft.target, 75, 1, ethers.ZeroAddress, 0, 2, 'supporter');
    await market.connect(other).purchaseWithETH(0, 1, { value: 1 });
    expect((await market.getListing(0)).available).to.equal(1);
    await expect(fund()).to.be.reverted;
    await market.delistDNFT(0);
    await market.withdrawNFT(nft.target, 75, 1, admin.address);
    await fund({ ...terms, giftTreasury: market.target });
    expect((await market.getListing(0)).active).to.equal(false);
    expect(await nft.balanceOf(escrow.target, 75)).to.equal(1);
    await expect(fund(terms, ethers.id('second'))).to.be.reverted;
    await escrow.connect(performer).performerCancel(id, report);
    await escrow.returnGift(id);
    expect(await nft.balanceOf(market.target, 75)).to.equal(1);
  });
  it('returns an unearned gift and fee separately on performer cancellation or no-show', async function () {
    await fund();
    await escrow.connect(performer).performerCancel(id, report);
    expect((await escrow.bookings(id)).giftStatus).to.equal(3);
    await escrow.refund(id);
    await escrow.returnGift(id);
    expect((await escrow.bookings(id)).feeStatus).to.equal(5);
    expect((await escrow.bookings(id)).giftStatus).to.equal(5);
    const id2 = ethers.id('another booking');
    await fund(terms, id2);
    await time.increaseTo(end);
    await escrow.noShow(id2, report);
    await escrow.returnGift(id2);
    await escrow.refund(id2);
    await expect(escrow.connect(performer).claim(id2)).to.be.revertedWithCustomError(escrow, 'InvalidState');
  });
  it('platform fault keeps the entire fee but returns the gift', async function () {
    await fund();
    await escrow.platformFault(id, report);
    await escrow.returnGift(id);
    await expect(escrow.connect(performer).claim(id)).to.be.revertedWithCustomError(escrow, 'InvalidTime');
    await time.increaseTo(end);
    await escrow.connect(performer).claim(id);
    expect(await token.balanceOf(performer.address)).to.equal(terms.amount);
    await expect(escrow.releaseGift(id)).to.be.revertedWithCustomError(escrow, 'InvalidState');
  });
  it('automatic fee claim is independent of later producer gift approval and never expires gift', async function () {
    await fund();
    await time.increaseTo(end + 3600);
    await escrow.connect(performer).claim(id);
    expect((await escrow.bookings(id)).giftStatus).to.equal(1);
    await time.increase(365 * 86400);
    await escrow.approvePerformance(id, report);
    await escrow.releaseGift(id);
  });
  it('unperformed gift can return after automatic payment without undoing the earned fee', async function () {
    await fund();
    await time.increaseTo(end + 3600);
    await escrow.connect(performer).claim(id);
    await escrow.markUnperformedGift(id, report);
    await escrow.returnGift(id);
    expect(await token.balanceOf(performer.address)).to.equal(terms.amount);
    expect((await escrow.bookings(id)).giftStatus).to.equal(5);
    await expect(escrow.approvePerformance(id, report)).to.be.revertedWithCustomError(escrow, 'InvalidState');
  });
  it('unperformed gift cannot be returned until the review window has closed', async function () {
    await fund();
    await time.increaseTo(end);
    await expect(escrow.markUnperformedGift(id, report)).to.be.revertedWithCustomError(escrow, 'InvalidTime');
    await time.increaseTo(end + 3598);
    await expect(escrow.markUnperformedGift(id, report)).to.be.revertedWithCustomError(escrow, 'InvalidTime');
    await time.increaseTo(end + 3600);
    await escrow.markUnperformedGift(id, report);
    expect((await escrow.bookings(id)).giftStatus).to.equal(3);
  });
  it('recovery marks the precise asset unavailable and cannot be repeated', async function () {
    await fund();
    await escrow.recover(id, other.address, false, true, report);
    expect((await escrow.bookings(id)).giftStatus).to.equal(6);
    expect((await escrow.bookings(id)).feeStatus).to.equal(1);
    await expect(escrow.recover(id, other.address, false, true, report)).to.be.revertedWithCustomError(escrow, 'InvalidState');
    await escrow.recover(id, other.address, true, false, report);
    expect((await escrow.bookings(id)).feeStatus).to.equal(6);
    await time.increaseTo(end);
    await expect(escrow.connect(performer).claim(id)).to.be.revertedWithCustomError(escrow, 'InvalidState');
  });
  it('surplus recovery cannot silently consume booking liabilities', async function () {
    await fund();
    await expect(escrow.recoverSurplus(token.target, 0, other.address, 1, false, report)).to.be.revertedWithCustomError(escrow, 'InvalidState');
    await expect(escrow.recoverSurplus(nft.target, 75, other.address, 1, true, report)).to.be.revertedWithCustomError(escrow, 'InvalidState');
    await nft.safeTransferFrom(admin.address, escrow.target, 75, 1, '0x');
    await escrow.recoverSurplus(nft.target, 75, other.address, 1, true, report);
    expect(await escrow.giftLiability(nft.target, 75)).to.equal(1);
    await time.increaseTo(end);
    await escrow.approvePerformance(id, report);
    await escrow.releaseGift(id);
    expect(await nft.balanceOf(performer.address, 75)).to.equal(1);
  });
});
