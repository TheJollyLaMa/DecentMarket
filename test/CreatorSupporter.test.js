const { expect } = require('chai');
const { ethers, network } = require('hardhat');

const describeBase = process.env.LOCAL_BASE_REHEARSAL === '1' ? describe : describe.skip;
describeBase('Creator Supporter wallet transaction journal', function () {
  let owner, creator, gift, buyer, nft, listings, provider, storage, values, manifest, sends, sentHash, ambiguous;
  let CreatorSupporter, SupporterPurchase, readCreatorListings;
  before(async function () {
    ({ CreatorSupporter } = await import('../js/creator-supporter.mjs'));
    ({ SupporterPurchase } = await import('../js/supporter-purchase.mjs'));
    ({ readCreatorListings } = await import('../js/supporter-listings.mjs'));
  });
  beforeEach(async function () {
    [owner, creator, gift, buyer] = await ethers.getSigners();
    nft = await (await ethers.getContractFactory('DecentNFT_v0_4')).deploy('', owner.address, 500, 500);
    listings = await (await ethers.getContractFactory('DecentSupporterListings_v0_1')).deploy(owner.address,
      ['0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'], [await nft.getAddress()]);
    await listings.setPlatformFees(1000, 500, gift.address);
    await listings.setCreatorSource(await nft.getAddress(), true);
    await nft.authorizeCreator(creator.address, 100);
    await nft.setCreatorProjectApproval(creator.address, `decent-project:${creator.address.toLowerCase()}:forest`, true);
    await nft.setEditionGiftRecipient(gift.address);
    values = new Map(); sends = 0; ambiguous = false;
    storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
    provider = ethers.provider;
    manifest = { format: 'decentmarket-creator-supporter', version: 1, chainId: 8453,
      creator: creator.address.toLowerCase(), projectKey: 'forest', projectId: `decent-project:${creator.address.toLowerCase()}:forest`,
      collection: await nft.getAddress(), listings: await listings.getAddress(),
      metadataURI: `ipfs://baf${'a'.repeat(40)}`, amount: '10', maxSupply: '100', listQuantity: '9',
      unitPrice: '10000000', royaltyBps: 500, give: true, giftRecipient: gift.address };
  });
  const getWallet = async () => ({
    address: creator.address, check: async () => {},
    signer: { sendTransaction: async expected => {
      sends++;
      expect([...values.values()].some(raw => JSON.parse(raw).pending?.nonce !== undefined)).to.equal(true);
      const tx = await creator.sendTransaction(expected);
      sentHash = tx.hash;
      await network.provider.send('evm_mine');
      if (ambiguous) throw new Error('Wallet response unavailable after broadcast');
      return tx;
    } },
  });
  function client() { return new CreatorSupporter(manifest, { provider, storage, getWallet }); }
  function requireBaseRehearsal() {
    if (process.env.LOCAL_BASE_REHEARSAL !== '1') throw new Error('Run creator journal integration with LOCAL_BASE_REHEARSAL=1; it is a local synthetic Base chain, never a broadcast');
  }
  it('mints an approved project with an explicit gift and lists seller-custodied editions through three verified steps', async function () {
    requireBaseRehearsal();
    const c = client();
    expect((await c.execute()).completed).to.equal('mint');
    expect(await nft.balanceOf(creator.address, c.session.tokenId)).to.equal(9);
    expect(await nft.balanceOf(gift.address, c.session.tokenId)).to.equal(1);
    expect((await c.execute()).completed).to.equal('approve');
    expect((await c.execute()).completed).to.equal('list');
    const listing = await listings.getListing(c.session.listingId);
    expect(listing.seller).to.equal(creator.address);
    expect(listing.creator).to.equal(creator.address);
    expect(listing.quantity).to.equal(9);
    expect(listing.feeBps).to.equal(1000);
    expect(await nft.balanceOf(await listings.getAddress(), c.session.tokenId)).to.equal(9);
    const restored = client(); await restored.verifyProgress();
    expect(restored.nextStep()).to.equal(null);
    await expect(restored.execute()).to.be.rejectedWith('already been minted and listed');
    expect(sends).to.equal(3);
  });
  it('recovers a real mint after an uncertain wallet response without issuing another mint', async function () {
    requireBaseRehearsal();
    const c = client();
    ambiguous = true;
    await expect(c.execute()).to.be.rejectedWith('Wallet response unavailable');
    expect(c.session.pending.hash).to.equal(undefined);
    expect(sends).to.equal(1);
    const restored = client();
    await expect(restored.execute()).to.be.rejectedWith('transaction hash');
    ambiguous = false;
    expect((await restored.reconcile(sentHash)).completed).to.equal('mint');
    expect(sends).to.equal(1);
    await restored.execute(); await restored.execute();
    expect(sends).to.equal(3);
  });
  it('blocks revoked project approval and altered saved mint terms before any wallet broadcast', async function () {
    requireBaseRehearsal();
    const c = client();
    await nft.setCreatorProjectApproval(creator.address, manifest.projectId, false);
    await expect(c.execute()).to.be.rejectedWith('steward must approve');
    expect(sends).to.equal(0);
    expect(() => new CreatorSupporter({ ...manifest, unitPrice: '20000000' }, { provider, storage, getWallet }))
      .to.throw('different mint terms');
  });
  async function buyerFixture() {
    const c = client(); await c.execute(); await c.execute(); await c.execute();
    const mock = await (await ethers.getContractFactory('MockListingsUSDC')).deploy();
    await network.provider.send('hardhat_setCode', ['0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', await provider.getCode(await mock.getAddress())]);
    const usdc = mock.attach('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    await usdc.mint(buyer.address, 100_000_000n);
    const config = { chainId: 8453, collectionAddress: manifest.collection, listingsAddress: manifest.listings };
    let buyerSends = 0, unknown = false, hash;
    const purchase = () => new SupporterPurchase({ config, creator: creator.address, projectKey: 'forest',
      listingId: c.session.listingId, quantity: '2' }, {
      provider, storage, confirm: async () => true,
      getWallet: async () => ({ address: buyer.address, check: async () => {}, signer: {
        sendTransaction: async expected => {
          buyerSends++;
          const tx = await buyer.sendTransaction(expected); hash = tx.hash;
          await network.provider.send('evm_mine');
          if (unknown) throw new Error('Buyer wallet response unavailable after broadcast');
          return tx;
        },
      } }),
    });
    return { c, usdc, config, purchase, sends: () => buyerSends, hash: () => hash, uncertain: () => { unknown = true; } };
  }
  it('discovers project-bound inventory and separately approves then purchases real creator editions', async function () {
    const f = await buyerFixture(), before = await f.usdc.balanceOf(buyer.address);
    const rows = await readCreatorListings(f.config, creator.address, ['forest'], { ethers, provider });
    expect(rows.map(r => [r.projectKey, r.quantity, r.priceUnits])).to.deep.equal([['forest', '9', '10000000']]);
    const p = f.purchase();
    expect((await p.execute()).completed).to.equal('approve');
    expect(await nft.balanceOf(buyer.address, f.c.session.tokenId)).to.equal(0);
    expect((await p.execute()).completed).to.equal('purchase');
    expect(await nft.balanceOf(buyer.address, f.c.session.tokenId)).to.equal(2);
    expect(before - await f.usdc.balanceOf(buyer.address)).to.equal(20_000_000n);
    expect((await listings.getListing(f.c.session.listingId)).quantity).to.equal(7);
    expect(f.sends()).to.equal(2);
  });
  it('reconciles an uncertain real purchase without a duplicate and rejects another wallet’s receipt', async function () {
    const f = await buyerFixture();
    await f.purchase().execute(); f.uncertain();
    await expect(f.purchase().execute()).to.be.rejectedWith('Buyer wallet response unavailable');
    const restored = f.purchase();
    await expect(restored.execute()).to.be.rejectedWith('pending or unknown');
    await expect(restored.reconcile(f.c.session.completed.mint.hash)).to.be.rejectedWith('does not match');
    expect((await restored.reconcile(f.hash())).completed).to.equal('purchase');
    expect(await nft.balanceOf(buyer.address, f.c.session.tokenId)).to.equal(2);
    expect(f.sends()).to.equal(2);
  });
  it('keeps the reviewed price ceiling after approval and blocks a raised-price purchase', async function () {
    const f = await buyerFixture();
    await f.purchase().execute();
    await listings.connect(creator).update(f.c.session.listingId, 20_000_000n, 9);
    await expect(f.purchase().execute()).to.be.rejectedWith('Price or asset changed');
    expect(await nft.balanceOf(buyer.address, f.c.session.tokenId)).to.equal(0);
    expect(f.sends()).to.equal(1);
  });
});
