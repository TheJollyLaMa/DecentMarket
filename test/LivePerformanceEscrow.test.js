const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

describe('LivePerformanceEscrow (undeployed draft)', function () {
 let token, escrow, admin, performer, outsider, start, end, deadline;
 const amount = 20_000_000n;
 const bookingId = ethers.id('friday-live-performance:2026-10-23:jose');
 const termsHash = ethers.id('DRAFT per-booking agreement');
 const uri = 'ipfs://bafyterms';
 const review = 72 * 3600;
 const window = 48 * 3600;
 async function create(overrides = {}) {
   const p = { id:bookingId, performer:performer.address, amount, start, end, deadline, termsHash, uri, review, window, fee:2500, ...overrides };
   return escrow.createBooking(p.id,p.performer,p.amount,p.start,p.end,p.deadline,p.termsHash,p.uri,p.review,p.window,p.fee);
 }
 beforeEach(async function () {
   [admin,performer,outsider] = await ethers.getSigners();
   token = await (await ethers.getContractFactory('MockDJukeToken')).deploy();
   escrow = await (await ethers.getContractFactory('LivePerformanceEscrow')).deploy(token.target,admin.address);
   start = await time.latest() + 3 * 86400;
   end = start + 3600; deadline = end + 30 * 86400;
   await token.mint(admin.address,amount*10n);
   await token.approve(escrow.target,ethers.MaxUint256);
 });
 it('fund → approve → performer claim emits provable terms and prevents double claim', async function () {
   await expect(create()).to.emit(escrow,'BookingFunded').withArgs(bookingId,performer.address,admin.address,amount,termsHash,uri);
   expect(await token.balanceOf(escrow.target)).to.equal(amount);
   await time.increaseTo(end);
   await expect(escrow.approve(bookingId,10000,'ipfs://report')).to.emit(escrow,'PerformanceApproved').withArgs(bookingId,10000,amount,0,'ipfs://report',termsHash);
   await expect(escrow.connect(outsider).claim(bookingId)).to.be.revertedWithCustomError(escrow,'PerformerOnly');
   await expect(escrow.connect(performer).claim(bookingId)).to.emit(escrow,'PerformancePaid').withArgs(bookingId,performer.address,amount,termsHash);
   expect(await token.balanceOf(performer.address)).to.equal(amount);
   await expect(escrow.connect(performer).claim(bookingId)).to.be.revertedWithCustomError(escrow,'InvalidState');
 });
 it('partial approval refunds only the original funder and leaves exact performer liability', async function () {
   await create(); const before = await token.balanceOf(admin.address);
   await time.increaseTo(end);
   await expect(escrow.approve(bookingId,5000,'ipfs://partial')).to.emit(escrow,'BookingRefunded').withArgs(bookingId,admin.address,amount/2n,'ipfs://partial',termsHash);
   expect(await token.balanceOf(admin.address)).to.equal(before+amount/2n);
   expect(await token.balanceOf(escrow.target)).to.equal(amount/2n);
   await escrow.connect(performer).claim(bookingId);
   expect(await token.balanceOf(performer.address)).to.equal(amount/2n);
 });
 for (const method of ['reject','markNoShow']) it(`${method} records reason and refunds; no claim remains`, async function () {
   await create(); await time.increaseTo(end);
   await expect(escrow[method](bookingId,'ipfs://reason')).to.emit(escrow,'BookingRefunded').withArgs(bookingId,admin.address,amount,'ipfs://reason',termsHash);
   await expect(escrow.connect(performer).claim(bookingId)).to.be.revertedWithCustomError(escrow,'InvalidState');
   expect(await token.balanceOf(escrow.target)).to.equal(0);
 });
 it('auto-claim vests at configurable review boundary and blocks late admin rejection', async function () {
   await create({ review:3600 });
   await time.increaseTo(end+3598);
   await expect(escrow.connect(performer).claim(bookingId)).to.be.revertedWithCustomError(escrow,'InvalidTime');
   await time.increaseTo(end+3600);
   await expect(escrow.reject(bookingId,'ipfs://late')).to.be.revertedWithCustomError(escrow,'InvalidTime');
   await expect(escrow.connect(performer).claim(bookingId)).to.emit(escrow,'PerformancePaid');
 });
 it('early platform cancellation fully refunds without kill fee', async function () {
   await create();
   await expect(escrow.cancel(bookingId,'ipfs://cancel')).to.emit(escrow,'BookingCancelled').withArgs(bookingId,0,'ipfs://cancel',termsHash);
   expect(await token.balanceOf(escrow.target)).to.equal(0);
 });
 it('late platform cancellation reserves configurable kill fee for performer claim', async function () {
   await create({ fee:3000 }); await time.increaseTo(start-3600);
   await expect(escrow.cancel(bookingId,'ipfs://cancel')).to.emit(escrow,'BookingCancelled').withArgs(bookingId,6_000_000,'ipfs://cancel',termsHash);
   expect(await token.balanceOf(escrow.target)).to.equal(6_000_000);
   await escrow.connect(performer).claim(bookingId);
   expect(await token.balanceOf(performer.address)).to.equal(6_000_000);
 });
 it('performer cancellation never charges a platform kill fee', async function () {
   await create(); await time.increaseTo(start-3600);
   await escrow.connect(performer).cancel(bookingId,'ipfs://performer-cancel');
   expect(await token.balanceOf(escrow.target)).to.equal(0);
 });
 it('cancel cannot be used during/after show; review handles completion separately', async function () {
   await create(); await time.increaseTo(start);
   await expect(escrow.cancel(bookingId,'ipfs://cancel')).to.be.revertedWithCustomError(escrow,'InvalidTime');
   await expect(escrow.approve(bookingId,10000,'ipfs://report')).to.be.revertedWithCustomError(escrow,'InvalidTime');
 });
 it('unique booking IDs, proper roles, reports and parameters are enforced', async function () {
   await expect(create({ performer:ethers.ZeroAddress })).to.be.revertedWithCustomError(escrow,'InvalidBooking');
   await expect(create({ termsHash:ethers.ZeroHash })).to.be.revertedWithCustomError(escrow,'InvalidBooking');
   await expect(create({ fee:10001 })).to.be.revertedWithCustomError(escrow,'InvalidBooking');
   await expect(create({ deadline:end+review })).to.be.revertedWithCustomError(escrow,'InvalidTime');
   await create();
   await expect(create()).to.be.revertedWithCustomError(escrow,'InvalidBooking');
   await time.increaseTo(end);
   await expect(escrow.connect(outsider).approve(bookingId,10000,'ipfs://report')).to.be.revertedWithCustomError(escrow,'AccessControlUnauthorizedAccount');
   await expect(escrow.approve(bookingId,5000,'')).to.be.revertedWithCustomError(escrow,'InvalidReport');
   await expect(escrow.approve(bookingId,10001,'ipfs://report')).to.be.revertedWithCustomError(escrow,'InvalidBooking');
   expect(escrow.interface.fragments.some(f=>f.name==='withdraw'||f.name==='recoverFund')).to.equal(false);
 });
 it('pause blocks creation, approvals, claims and cancellation; unpause preserves custody', async function () {
   await create(); await escrow.pause();
   await expect(create({ id:ethers.id('another') })).to.be.revertedWithCustomError(escrow,'EnforcedPause');
   await expect(escrow.cancel(bookingId,'ipfs://cancel')).to.be.revertedWithCustomError(escrow,'EnforcedPause');
   await expect(escrow.connect(performer).claim(bookingId)).to.be.revertedWithCustomError(escrow,'EnforcedPause');
   await time.increaseTo(end);
   await expect(escrow.approve(bookingId,10000,'ipfs://report')).to.be.revertedWithCustomError(escrow,'EnforcedPause');
   await escrow.unpause(); await escrow.approve(bookingId,10000,'ipfs://report'); await escrow.connect(performer).claim(bookingId);
 });
 it('expiration refunds only unpaid remainder, never another booking balance', async function () {
   await create(); await create({ id:ethers.id('second') });
   await time.increaseTo(end); await escrow.approve(bookingId,5000,'ipfs://partial');
   await time.increaseTo(deadline+1);
   await escrow.connect(outsider).expire(bookingId);
   expect(await token.balanceOf(escrow.target)).to.equal(amount);
   await expect(escrow.connect(performer).claim(bookingId)).to.be.revertedWithCustomError(escrow,'InvalidTime');
   await expect(escrow.expire(bookingId)).to.be.revertedWithCustomError(escrow,'InvalidState');
 });
 it('reentrant performer token cannot claim twice', async function () {
   const malicious = await (await ethers.getContractFactory('MockLiveToken')).deploy();
   const guarded = await (await ethers.getContractFactory('LivePerformanceEscrow')).deploy(malicious.target,admin.address);
   await malicious.mint(admin.address,amount); await malicious.approve(guarded.target,amount);
   await guarded.createBooking(bookingId,malicious.target,amount,start,end,deadline,termsHash,uri,review,window,2500);
   await time.increaseTo(end); await guarded.approve(bookingId,10000,'ipfs://report');
   await malicious.configureAttack(guarded.target,bookingId); await malicious.triggerClaim();
   expect(await malicious.reentrySucceeded()).to.equal(false);
   expect(await malicious.balanceOf(malicious.target)).to.equal(amount);
   expect(await malicious.balanceOf(guarded.target)).to.equal(0);
 });
 it('fee-on-transfer token cannot create undercollateralized booking', async function () {
   const feeToken = await (await ethers.getContractFactory('MockLiveToken')).deploy();
   const guarded = await (await ethers.getContractFactory('LivePerformanceEscrow')).deploy(feeToken.target,admin.address);
   await feeToken.mint(admin.address,amount); await feeToken.approve(guarded.target,amount); await feeToken.setFee(1);
   await expect(guarded.createBooking(bookingId,performer.address,amount,start,end,deadline,termsHash,uri,review,window,2500))
     .to.be.revertedWithCustomError(guarded,'UnsupportedToken');
   expect((await guarded.bookings(bookingId)).status).to.equal(0);
 });

});
