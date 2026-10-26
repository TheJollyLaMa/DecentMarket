import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ethers, BASE, STEPS, NFT_ABI, ESCROW_ABI, validateRelease, validateMetadata, newSession, releaseKey, transactionFor, verifyTransaction, verifyReceipt, buildEvidence, SupporterMint } from '../js/supporter-mint.mjs';
const manifest = JSON.parse(readFileSync(new URL('../releases/decenthead-v2.0.0/supporter-release.json', import.meta.url)));
const metadata = JSON.parse(readFileSync(new URL('../releases/decenthead-v2.0.0/supporter-metadata.json', import.meta.url)));
const account = manifest.creatorAddress;
const nft = new ethers.Interface(NFT_ABI), escrow = new ethers.Interface(ESCROW_ABI);
function fixture() {
  const saved = new Map(), transactions = new Map(), receipts = new Map();
  const storage = { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) };
  let nonce = 0, rejected = false, interrupted = false, readInterrupted = false;
  const provider = {
    chain: '0x2105', account,
    async send(method) { assert.equal(method, 'eth_chainId'); return this.chain; },
    async getSigner() {
      return {
        getAddress: async () => provider.account,
        sendTransaction: async request => {
          if (rejected) throw Object.assign(new Error('rejected'), { code: 'ACTION_REJECTED' });
          const pending = JSON.parse(storage.getItem(releaseKey(manifest))).pending;
          assert.equal(pending.nonce, request.nonce, 'claim persisted before broadcast');
          const hash = '0x' + (++nonce).toString(16).padStart(64, '0');
          const tx = { ...request, hash, from: account, chainId: 8453n };
          const log = eventFor(pending.step);
          const receipt = { status: 1, hash, blockNumber: 100 + nonce, logs: [log] };
          transactions.set(hash, tx); receipts.set(hash, receipt);
          if (interrupted) throw new Error('broadcast reply lost');
          return { hash, wait: async () => receipt };
        },
      };
    },
    async getTransactionCount() { return nonce; },
    async estimateGas() { return 100000n; },
    async getTransaction(hash) { return readInterrupted ? null : transactions.get(hash); },
    async getTransactionReceipt(hash) { return receipts.get(hash); },
    async call(tx) {
      const iface = tx.to.toLowerCase() === BASE.DNFT.toLowerCase() ? nft : escrow;
      const call = iface.parseTransaction(tx);
      const results = {
        hasRole: [!provider.denyRole], owner: [provider.otherOwner ? ethers.ZeroAddress : account], paused: [!!provider.paused], uri: [manifest.metadataURI],
        royaltyInfo: [account, 1000], registerToken: [7], listDNFT: [9],
      };
      return iface.encodeFunctionResult(call.name, results[call.name] || []);
    },
  };
  function eventFor(step) {
    let event, args, address = BASE.DNFT, iface = nft;
    if (step === 'register') { event = 'TokenRegistered'; args = [7, account, 1000, 0, manifest.metadataURI]; }
    if (step === 'mint') { event = 'TransferSingle'; args = [account, ethers.ZeroAddress, account, 7, 1000]; }
    if (step === 'transfer') { event = 'TransferSingle'; args = [account, account, BASE.ESCROW, 7, 1000]; }
    if (step === 'list') { address = BASE.ESCROW; iface = escrow; event = 'Listed'; args = [9, BASE.DNFT, 7, 0, BASE.USDC, 10000000, 1000, 'Supporter']; }
    return { address, ...iface.encodeEventLog(iface.getEvent(event), args) };
  }
  return { storage, provider, transactions, receipts, eventFor, reject: value => { rejected = value; }, interrupt: value => { interrupted = value; }, interruptRead: value => { readInterrupted = value; }, get sends() { return nonce; } };
}
test('actual release validates without changing its pinned metadata or explicit royalty terms', () => {
  assert.equal(validateRelease(manifest), manifest);
  assert.equal(validateMetadata(manifest, metadata), metadata);
  const tx = transactionFor(manifest, newSession(manifest, account), 'register');
  const args = nft.parseTransaction(tx).args;
  assert.equal(args[1], manifest.metadataURI);
  assert.equal(args[3], account);
  assert.equal(args[4], 1000n);
});
test('100 editions at 100 USDC bind metadata, exact calldata, all receipt events and purchase evidence', () => {
  const m = { ...manifest, quantity: '100', priceUSDC: '100000000' };
  const md = { ...metadata, properties: { ...metadata.properties, supply: 100, price: '100 USDC' } };
  validateMetadata(m, md);
  assert.throws(() => validateMetadata(m, metadata), /edition, price/);
  const session = newSession(m, account);
  const register = nft.parseTransaction(transactionFor(m, session, 'register'));
  assert.equal(register.args[0], 100n);
  assert.equal(register.args[4], 1000n);
  const events = {
    register: ['TokenRegistered', [7, account, 100, 0, m.metadataURI]],
    mint: ['TransferSingle', [account, ethers.ZeroAddress, account, 7, 100]],
    transfer: ['TransferSingle', [account, account, BASE.ESCROW, 7, 100]],
    list: ['Listed', [9, BASE.DNFT, 7, 0, BASE.USDC, 100000000, 100, 'Supporter']],
  };
  for (const step of STEPS) {
    const iface = step === 'list' ? escrow : nft;
    const transaction = iface.parseTransaction(transactionFor(m, session, step));
    if (step === 'mint') assert.equal(transaction.args[2], 100n);
    if (step === 'transfer') assert.equal(transaction.args[3], 100n);
    if (step === 'list') { assert.equal(transaction.args[4], 100000000n); assert.equal(transaction.args[5], 100n); }
    const [name, args] = events[step];
    const receipt = { status: 1, hash: '0x' + 'a'.repeat(64), blockNumber: 100,
      logs: [{ address: step === 'list' ? BASE.ESCROW : BASE.DNFT, ...iface.encodeEventLog(iface.getEvent(name), args) }] };
    session.completed[step] = verifyReceipt(m, session, step, receipt);
    if (step === 'list') {
      const wrongArgs = [...args]; wrongArgs[5] = 10000000;
      assert.throws(() => verifyReceipt(m, session, step, { ...receipt, logs: [{ address: BASE.ESCROW,
        ...iface.encodeEventLog(iface.getEvent(name), wrongArgs) }] }), /frozen Supporter terms/);
    }
  }
  const url = new URL(buildEvidence(m, session, 'https://thejollylama.github.io/DecentHead/supporter/buy.html').purchaseUrl);
  assert.equal(url.searchParams.get('priceUSDC'), '100000000');
});
for (const [key, value] of Object.entries({ chainId: 1, quantity: '999', priceUSDC: '1', metadataURI: 'https://example.org', front: 'ipfs://bad', creatorAddress: ethers.ZeroAddress, commit: 'HEAD', releaseDate: 'yesterday' })) {
  test(`rejects unsupported manifest ${key}`, () => assert.throws(() => validateRelease({ ...manifest, [key]: value })));
}
test('metadata must match both provenance and fixed edition terms', () => {
  assert.throws(() => validateMetadata(manifest, { ...metadata, animation_url: 'ipfs://other' }), /artwork/);
  assert.throws(() => validateMetadata(manifest, { ...metadata, properties: { ...metadata.properties, royalty_bps: 0 } }), /royalty/);
  assert.throws(() => newSession(manifest, ethers.ZeroAddress), /creator wallet/);
});
test('four separately confirmed steps resume after every reload and produce exact evidence', async () => {
  const f = fixture();
  for (const step of STEPS) {
    const studio = new SupporterMint(manifest, f);
    await studio.execute();
    assert.ok(studio.session.completed[step]);
    assert.equal(studio.session.pending, null);
    assert.equal(f.sends, STEPS.indexOf(step) + 1);
  }
  const restored = new SupporterMint(manifest, f);
  await restored.verifyProgress();
  const evidence = buildEvidence(manifest, restored.session, 'https://thejollylama.github.io/DecentHead/supporter/buy.html');
  assert.equal(evidence.tokenId, '7'); assert.equal(evidence.listingId, '9');
  assert.equal(evidence.mintTxHash, restored.session.completed.mint.hash);
  assert.match(evidence.purchaseUrl, /listingId=9/);
  await assert.rejects(restored.execute(), /already complete/);
  assert.equal(f.sends, 4);
});
test('user rejection clears only the unsigned claim and preserves prior registration', async () => {
  const f = fixture(), studio = new SupporterMint(manifest, f);
  await studio.execute(); f.reject(true);
  await assert.rejects(studio.execute(), /rejected/);
  assert.equal(studio.session.pending, null);
  assert.equal(studio.session.completed.register.tokenId, '7');
  f.reject(false); await studio.execute();
  assert.ok(studio.session.completed.mint); assert.equal(f.sends, 2);
});
test('lost broadcast reply blocks duplicate sends and accepts only the matching recovery hash', async () => {
  const f = fixture(); f.interrupt(true);
  const studio = new SupporterMint(manifest, f);
  await assert.rejects(studio.execute(), /reply lost/);
  const restored = new SupporterMint(manifest, f);
  await assert.rejects(restored.execute(), /transaction hash/);
  assert.equal(f.sends, 1);
  const hash = [...f.transactions.keys()][0];
  await restored.reconcile(hash);
  assert.equal(restored.session.completed.register.tokenId, '7');
  assert.equal(f.sends, 1);
});
test('unconfirmed or reverted receipts never advance progress', async () => {
  const f = fixture(); f.interrupt(true);
  const studio = new SupporterMint(manifest, f);
  await assert.rejects(studio.execute());
  const hash = [...f.transactions.keys()][0], receipt = f.receipts.get(hash);
  f.receipts.delete(hash);
  await assert.rejects(studio.reconcile(hash), /still pending/);
  assert.equal(studio.session.completed.register, undefined);
  f.receipts.set(hash, { ...receipt, status: 0 });
  await assert.rejects(studio.reconcile(hash), /reverted on chain/);
  assert.equal(studio.session.pending, null);
});
test('wrong wallet, chain, transaction data, value or nonce is rejected', async () => {
  const f = fixture(), studio = new SupporterMint(manifest, f);
  f.provider.chain = '0x1';
  await assert.rejects(studio.execute(), /Switch your wallet to Base/);
  f.provider.chain = '0x2105'; f.provider.account = ethers.ZeroAddress;
  await assert.rejects(studio.execute(), /creator wallet/);
  assert.equal(f.sends, 0);
  const expected = transactionFor(manifest, newSession(manifest, account), 'register');
  const tx = { ...expected, from: account, nonce: 0, chainId: 8453n };
  for (const patch of [{ data: '0x' }, { value: 1n }, { nonce: 1 }, { chainId: 1n }, { to: BASE.ESCROW }, { from: ethers.ZeroAddress }]) {
    assert.throws(() => verifyTransaction({ ...tx, ...patch }, expected, account, 0), /does not match/);
  }
});
test('storage failure prevents any broadcast and altered saved receipts cannot authorize another step', async () => {
  const f = fixture();
  await assert.rejects(new SupporterMint(manifest, { provider: f.provider, storage: { getItem: () => null, setItem() { throw new Error('storage unavailable'); } } }).execute(), /storage unavailable/);
  assert.equal(f.sends, 0);
  const studio = new SupporterMint(manifest, f); await studio.execute();
  studio.session.completed.register.tokenId = '8'; studio.save();
  await assert.rejects(new SupporterMint(manifest, f).execute(), /Saved IDs/);
  assert.equal(f.sends, 1);
});
test('failed receipt read or chain reorg preserves records and refuses fresh registration', async () => {
  const f = fixture(), studio = new SupporterMint(manifest, f);
  await studio.execute(); f.interruptRead(true);
  await assert.rejects(new SupporterMint(manifest, f).execute(), /unavailable/);
  assert.equal(f.sends, 1);
});
for (const [flag, message] of [['denyRole', /administrator permission/], ['otherOwner', /own this escrow/], ['paused', /paused/]]) {
  test(`preflight rejects ${flag} before any wallet transaction`, async () => {
    const f = fixture(); f.provider[flag] = true;
    await assert.rejects(new SupporterMint(manifest, f).execute(), message);
    assert.equal(f.sends, 0);
  });
}
test('stale second-tab state cannot register the same release again', async () => {
  const f = fixture();
  const first = new SupporterMint(manifest, f);
  first.session = newSession(manifest, account); first.save();
  const stale = new SupporterMint(manifest, f);
  await first.execute();
  await assert.rejects(stale.execute(), /another tab/);
  assert.equal(f.sends, 1);
});
test('a same-calldata speed-up replacement can be reconciled without another send', async () => {
  const f = fixture(); f.interrupt(true);
  const studio = new SupporterMint(manifest, f);
  await assert.rejects(studio.execute());
  const original = [...f.transactions.keys()][0], replacement = '0x' + 'b'.repeat(64);
  f.transactions.set(replacement, { ...f.transactions.get(original), hash: replacement });
  f.receipts.set(replacement, { ...f.receipts.get(original), hash: replacement });
  await studio.reconcile(replacement);
  assert.equal(studio.session.completed.register.hash, replacement);
  assert.equal(f.sends, 1);
});
test('mismatched registration logs and log contract addresses are rejected', () => {
  const f = fixture(), s = newSession(manifest, account);
  const log = f.eventFor('register');
  assert.throws(() => verifyReceipt(manifest, s, 'register', { status: 1, logs: [{ ...log, address: BASE.ESCROW }] }), /Registration event/);
  assert.throws(() => buildEvidence(manifest, s, 'https://example.org'), /all four/);
});
