const { expect } = require('chai');
const { ethers, network } = require('hardhat');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const Records = require('../../vendor/decent-canopy/e9fceef0/scripts/creator-records.js');

describe('First Project full contract-backed campaign rehearsal', function () {
  it('verifies a signed published profile, project mint and active sale before a reviewed five-USDC payout', async function () {
    if (process.env.LOCAL_BASE_REHEARSAL !== '1' || !process.env.BUSKING_CAMPAIGNS_ROOT || !process.env.ARTFI_ROOT) {
      // Opt-in: LOCAL_BASE_REHEARSAL=1, BUSKING_CAMPAIGNS_ROOT and ARTFI_ROOT enable this local-only cross-app rehearsal.
      this.skip();
    }
    const busking = file => pathToFileURL(resolve(process.env.BUSKING_CAMPAIGNS_ROOT, file)).href;
    const { createPromotions } = await import(busking('discord-bot/promotions.js'));
    const { createFirstProjectVerifier } = await import(busking('discord-bot/first-project.js'));
    const shared = await import(busking('js/promotions.mjs'));
    const [admin, creator, fee] = await ethers.getSigners();
    const usdcAddress = shared.PROMOTIONS_USDC;
    const template = await (await ethers.getContractFactory('MockListingsUSDC')).deploy();
    await network.provider.send('hardhat_setCode', [usdcAddress, await ethers.provider.getCode(await template.getAddress())]);
    const usdc = await ethers.getContractAt('MockListingsUSDC', usdcAddress);
    const routerArtifact = JSON.parse(readFileSync(resolve(process.env.ARTFI_ROOT,
      'artifacts/contracts/ArtFiSettlementRouter.sol/ArtFiSettlementRouter.json'), 'utf8'));
    const router = await new ethers.ContractFactory(routerArtifact.abi, routerArtifact.bytecode, admin).deploy(admin.address);
    const nft = await (await ethers.getContractFactory('DecentNFT_v0_4')).deploy('', admin.address, 500, 500);
    const listings = await (await ethers.getContractFactory('DecentSupporterListings_v0_1')).deploy(
      admin.address, [usdcAddress], [await nft.getAddress()]);
    await listings.setPlatformFees(1000, 500, fee.address);
    await listings.setCreatorSource(await nft.getAddress(), true);
    const projectId = `decent-project:${creator.address.toLowerCase()}:forest`;
    await nft.authorizeCreator(creator.address, 100);
    await nft.setCreatorProjectApproval(creator.address, projectId, true);
    const fund = ethers.id('decentcanopy-promotionals');
    await router.createFund(fund, 'ipfs://local-first-project-terms');
    await router.setAssetApproved(usdcAddress, true);
    await usdc.mint(admin.address, 60000000n);
    await usdc.approve(await router.getAddress(), 60000000n);
    await router.fundToken(fund, usdcAddress, 60000000n);
    const clock = (await ethers.provider.getBlock('latest')).timestamp * 1000;
    const at = new Date(clock).toISOString();
    const record = Records.validate({ format: 'decentcanopy-creator', version: 2, consent: true,
      wallet: creator.address, revision: 1, previousCid: null, updatedAt: at, name: 'Local test agent',
      bio: 'Synthetic signed publication for a local rehearsal', website: '', avatar: '', location: null,
      projects: [{ key: 'forest', name: 'Forest', description: 'Local project', website: '', image: '', status: 'active',
        archiveId: '', wallet: '', related: [] }], funds: [], funding: [], journey: [] });
    const message = Records.message(record);
    const entry = { record, message, signature: await creator.signMessage(message), cid: `baf${'a'.repeat(40)}`, publishedAt: at };
    const fetchImpl = async url => ({ ok: true, text: async () => JSON.stringify(url.includes('/commits/main') ?
      { sha: 'a'.repeat(40) } : { version: 1, creators: [entry] }) });
    let checkpoint;
    const readFirstProject = createFirstProjectVerifier({ provider: ethers.provider, collectionAddress: await nft.getAddress(),
      listingsAddress: await listings.getAddress(), fetchImpl });
    const service = createPromotions({ provider: ethers.provider, routerAddress: await router.getAddress(),
      ownerWallet: admin.address, readFirstProject, now: () => clock,
      restore: async () => checkpoint, save: async data => { checkpoint = structuredClone(data); return 'ipfs://local-rehearsal'; } });
    const origin = 'https://canopy.local.test';
    const command = async (input, signer = admin) => {
      const state = await service.publicState();
      const body = { address: signer.address, origin, issuedAt: at, application: 'decentcanopy',
        command: { revision: state.revision, ...input } };
      body.signature = await signer.signMessage(shared.promotionAuthorization(body));
      return service.execute(body, origin);
    };
    let state = await command({ action: 'save', campaign: {
      application: 'decentcanopy', template: 'first-project', qualificationVersion: 'canopy-first-project-v1',
      fund: 'decentcanopy-promotionals', asset: 'usdc', title: 'First Project local rehearsal',
      criteria: 'Published profile and project; mint and active seller listing', terms: 'Synthetic local reviewed reward, not a live offer',
      maxAwards: 12, rewardUnits: '5000000', budgetUnits: '60000000',
      startsAt: new Date(clock - 1000).toISOString(), endsAt: new Date(clock + 86400000).toISOString(),
      claimDeadline: new Date(clock + 172800000).toISOString(),
    } });
    const campaignId = state.campaigns[0].id;
    await command({ action: 'status', campaignId, status: 'published' });
    await command({ action: 'join', campaignId, acceptTerms: true, termsVersion: 1 }, creator);
    const mint = await nft.connect(creator).registerAndMintProduct(10, 100, `ipfs://baf${'b'.repeat(40)}`, creator.address, 500, ethers.id(projectId));
    await nft.connect(creator).setApprovalForAll(await listings.getAddress(), true);
    await listings.connect(creator).list(await nft.getAddress(), 0, 10, usdcAddress, 10000000n);
    await network.provider.send('evm_mine');
    state = await command({ action: 'claim', campaignId, projectKey: 'forest', mintTxHash: mint.hash, listingId: '0',
      evidence: 'Synthetic current signed project, confirmed mint, active listing' }, creator);
    const claimId = state.claims[0].id;
    expect(state.claims[0].qualification.projectId).to.equal(projectId);
    expect(state.claims[0].qualification.listingId).to.equal('0');
    await command({ action: 'review', claimId, decision: 'approved', reason: 'Local steward reviewed participant and project', confirmParticipantReview: true });
    await router.setContributorApproved(creator.address, ethers.id(`promotions:${creator.address.toLowerCase()}`), true);
    await command({ action: 'prepare-payment', claimId });
    const claim = checkpoint.claims[0], work = ethers.id(shared.promotionWorkReference(claim));
    const payout = await router.payout(fund, usdcAddress, creator.address, 5000000n, work,
      ethers.id('TheJollyLaMa/DecentCanopy'), ethers.id(creator.address), '', ethers.ZeroHash);
    await network.provider.send('evm_mine');
    state = await command({ action: 'reconcile', claimId, txHash: payout.hash });
    expect(state.claims[0].status).to.equal('paid');
    expect(await usdc.balanceOf(creator.address)).to.equal(5000000n);
    expect(await router.fundBalances(fund, usdcAddress)).to.equal(55000000n);
    expect(await router.completedWorkReferences(work)).to.equal(true);
    const verifierRequest = { wallet: creator.address.toLowerCase(), projectKey: 'forest', mintTxHash: mint.hash,
      listingId: '0', campaign: checkpoint.campaigns[0], joinedAt: at };
    await listings.connect(creator).delist(0);
    await expect(readFirstProject(verifierRequest)).to.be.rejectedWith('active');
    entry.record = { ...record, name: 'Unsigned replacement' };
    await expect(readFirstProject(verifierRequest)).to.be.rejectedWith('invalid');
  });
});
