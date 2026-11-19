const { expect } = require('chai');
const { ethers } = require('hardhat');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

describe('Asset escrow and Busking booking integration', function () {
  it('signs the exact terms and indexes independent confirmed fee and gift receipts', async function () {
    const root = process.env.BUSKING_BOOKING_ROOT;
    if (!root || (await ethers.provider.getNetwork()).chainId !== 8453n) this.skip();
    const moduleUrl = file => pathToFileURL(path.join(root, file)).href;
    const shared = await import(moduleUrl('js/live-bookings.mjs'));
    const { createLiveBookings } = await import(moduleUrl('discord-bot/live-bookings.js'));
    const { createHistoricalTipBookingReader } = await import(moduleUrl('discord-bot/tip-context.js'));
    const [owner, performer] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory('MockBookingToken')).deploy(6);
    const nft = await (await ethers.getContractFactory('MockBookingNFT')).deploy();
    const market = await (await ethers.getContractFactory('DecentEscrow_v001')).deploy(owner.address);
    const escrow = await (await ethers.getContractFactory('LivePerformanceAssetsEscrow')).deploy(owner.address, token.target);
    const startBlock = escrow.deploymentTransaction().blockNumber;
    await token.mint(owner.address, 20_000_000);
    await token.approve(escrow.target, 20_000_000);
    await nft.mint(owner.address, 75, 1);
    await nft.setApprovalForAll(escrow.target, true);
    let checkpoint;
    const now = Number((await ethers.provider.getBlock('latest')).timestamp);
    const start = now + 3600, end = start + 1200;
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone:'America/New_York', year:'numeric',
      month:'2-digit', day:'2-digit' }).format(new Date(start * 1000));
    const service = createLiveBookings({
      provider:ethers.provider, ownerWallet:owner.address, assetEscrowAddress:escrow.target,
      assetEscrowStartBlock:startBlock, assetBookingsEnabled:true, giftTreasuryAddress:market.target, now:() => now * 1000,
      save:async value => { checkpoint = structuredClone(value); return 'ipfs://checkpoint'; },
      restore:async () => checkpoint,
      getSchedule:async () => ({ ready:true,events:[],weeklySchedule:[] }), saveSchedule:async () => {},
    });
    const id = 'fixture:actual', input = {
      performer:performer.address, displayName:'Fixture', title:'Set', eventId:`friday-live-performance:${localDate}`,
      startUtc:new Date(start * 1000).toISOString(), endUtc:new Date(end * 1000).toISOString(), airtimeMinutes:20,
      mode:'phase1', escrowVersion:shared.LIVE_ASSET_VERSION, payoutPolicy:shared.LIVE_ASSET_POLICY,
      assetAddress:token.target, assetDecimals:6, assetSymbol:'ASSET', amountUnits:'20000000',
      gift:{ collection:nft.target, tokenId:'75', quantity:'1', treasury:market.target },
      termsVersion:'LIVE PERFORMANCE ASSETS v1', termsUri:'ipfs://terms', termsHash:ethers.id('fixture terms'),
      stewardApproved:true, reviewWindow:3600, cancellationWindow:0, killFeeBps:0,
      claimDeadline:new Date((end + 86400) * 1000).toISOString(),
    };
    const state = await service.getState();
    let booking = (await service.execute({ action:'create',id,booking:input,revision:state.revision })).bookings[0];
    await service.acknowledgePerformer({ id,address:performer.address,
      signature:await performer.signMessage(shared.liveAcknowledgement(booking)) });
    booking = (await service.getState()).bookings[0];
    const fundingReceipt = await (await escrow.createBooking(ethers.id(id), shared.assetBookingTerms(booking), booking.termsUri)).wait();
    await ethers.provider.send('evm_mine', []);
    let indexed = (await service.getState()).bookings[0];
    expect(indexed.status).to.equal('funded');
    expect(indexed.giftStatus).to.equal('reserved');
    const readTipBooking = createHistoricalTipBookingReader({ provider:ethers.provider,
      assetEscrowAddress:escrow.target, resolveBookingIdentity:bookingId => service.getBookingIdentity(bookingId) });
    const tipBooking = await readTipBooking(id, fundingReceipt.blockNumber);
    expect(tipBooking.eligible).to.equal(true);
    expect(tipBooking.performer.toLowerCase()).to.equal(performer.address.toLowerCase());
    await ethers.provider.send('evm_setNextBlockTimestamp', [end]);
    await escrow.approvePerformance(ethers.id(id), 'ipfs://report');
    await ethers.provider.send('evm_mine', []);
    indexed = (await service.getState()).bookings[0];
    expect(indexed.status).to.equal('approved');
    expect(indexed.giftStatus).to.equal('approved');
    await escrow.connect(performer).claim(ethers.id(id));
    await ethers.provider.send('evm_mine', []);
    indexed = (await service.getState()).bookings[0];
    expect(indexed.status).to.equal('paid');
    expect(indexed.giftStatus).to.equal('approved');
    await escrow.releaseGift(ethers.id(id));
    await ethers.provider.send('evm_mine', []);
    indexed = (await service.getState()).bookings[0];
    expect(indexed.giftStatus).to.equal('received');
    expect(await nft.balanceOf(performer.address, 75)).to.equal(1);
  });
});
