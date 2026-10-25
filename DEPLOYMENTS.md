# DecentMarket — Deployment Log

Single source of truth for all on-chain deployments of DecentMarket smart contracts.

---

## Deployed Contracts

| Network | Contract | Version | Address | ABI | Explorer |
|---------|----------|---------|---------|-----|----------|
| Polygon Mainnet | DecentNFT | v0.1 | `0x4cE20F0bbF7eA38488F9c9555EfD2b502E86A53E` | not tracked in repo | [Polygonscan](https://polygonscan.com/address/0x4cE20F0bbF7eA38488F9c9555EfD2b502E86A53E) |
| Optimism Mainnet | DecentNFT | v0.2 | `0xe870f7b1D10C41dbc6b75598a5308B9a2Bb52958` | `abis/DecentNFT_v0.2.json` | [Optimism Etherscan](https://optimistic.etherscan.io/address/0xe870f7b1D10C41dbc6b75598a5308B9a2Bb52958) |
| Optimism Mainnet | DecentEscrow | v0.1 | `0x23A457AD3C33d68E4fAd2FCa7c5d9a511E0C350e` | `abis/DecentEscrow_v0.1.json` | [Optimism Etherscan](https://optimistic.etherscan.io/address/0x23A457AD3C33d68E4fAd2FCa7c5d9a511E0C350e) |
| Base Mainnet | DecentNFT | v0.2 | `0xe63EC9f8228720bAAC2fD528C0A6d06B3Dc5439B` | legacy app collection | [BaseScan](https://basescan.org/address/0xe63EC9f8228720bAAC2fD528C0A6d06B3Dc5439B) |
| Base Mainnet | DecentNFT | v0.3 | `0x64D5aDc50E5513975EfF7e9ba366B7eE58586fa3` | `abis/DecentNFT_v0.3.json` | [BaseScan](https://basescan.org/address/0x64D5aDc50E5513975EfF7e9ba366B7eE58586fa3) |
| Base Mainnet | DecentJukeBox | v0.1 | `0x153ef59a57C9A88cbB7822252B5d9D0B11E48F0E` | `abis/DecentJukeBox_v0.1.json` | [BaseScan](https://basescan.org/address/0x153ef59a57C9A88cbB7822252B5d9D0B11E48F0E) |
| Base Mainnet | DeVert | v0.1 | `0x135Cbc573F87637158eb3186C87c584fb0B34CD9` | `abis/DeVert_v0.1.json` | [BaseScan](https://basescan.org/address/0x135Cbc573F87637158eb3186C87c584fb0B34CD9) |
| Base Mainnet | DeVertQueue | v0.1 | `0x9ebf98367319E6c8b15b5517d808CCfEb3dddA61` | `abis/DeVertQueue_v0.1.json` | [BaseScan verified source](https://basescan.org/address/0x9ebf98367319E6c8b15b5517d808CCfEb3dddA61#code) |
| Base Mainnet | DeVertQueue | v0.2 | `0xe54609f022A8D760417E7cc0Eea6360b6E1D11Bb` | `abis/DeVertQueue_v0.2.json` | [BaseScan verified source](https://basescan.org/address/0xe54609f022A8D760417E7cc0Eea6360b6E1D11Bb#code) |

### DeVert paid queue v0.1

Deployed October 17, 2026, transaction
[`0x787351b818b6621bd1ced2606d825aab6b8d18fc40c6a455d370c14a5b0706bf`](https://basescan.org/tx/0x787351b818b6621bd1ced2606d825aab6b8d18fc40c6a455d370c14a5b0706bf),
block 52722248. Constructor arguments are recorded in
[`deployments/devert-queue-base.json`](deployments/devert-queue-base.json).
The verified compiler is Solidity 0.8.26, optimizer 200 runs, Cancun EVM.
The admin is `0x807061DF657A7697c04045dA7d16D941861cAABc`; the fulfiller is
`0x4894698f2B5cAF13Fad4Aa8fbaFE3618b960909F`. Roles and dependencies were
independently read back after deployment.

This independent FIFO queue does not replace the campaign source. Requests
require an active explicitly approved campaign and reserve native Base USDC
until the trusted radio fulfiller attests completed audible playback. Starting
price is 1 USDC, doubling per seven pending requests, with a bounded 128-position
window. Expiry does not invalidate purchased playback. Removal authorizes a
full refund to each payer for their unplayed requests, including while paused.
There is no automatic waiting-time refund or administrative withdrawal.
Completed payments route 45% playback, 45% Top 10, 8% pinners and 2% repo
development through the existing settlement router.

Validation: eight contract unit tests plus a Base fork rehearsal purchasing
against the deployed campaign source, settling through the deployed router and
claiming a removed-request refund. Run
`BASE_FORK_RPC=https://mainnet.base.org npx hardhat test test/DeVertQueue_base_fork.test.js`.
The rehearsal mines a local block before calls; no mainnet transaction is sent.
The authorized $1 live test passed on October 17, 2026, with automatic
[settlement](https://basescan.org/tx/0xd3bb497a52c16d3854710e453ffe5f62c4e8a5229cc06b04a6129adf74e936cd).
Public checkout was subsequently disabled because v0.1 does not distinguish
normal-slot bumps from double-price immediate plays. Existing purchases remain
valid; do not reinterpret their purchased priority.
Verification uses `ETHERSCAN_API_KEY` with Etherscan V2.

### DeVert paid queue v0.2 (deployed, checkout disabled)

Deployed October 17, 2026, [transaction](https://basescan.org/tx/0x48e8c5ce12cefc8a735e9af016d5475ac290db50e2924bba9d54fd9fc58b5240),
block 52723789. The [deployment record](deployments/devert-queue-v02-base.json)
includes constructor arguments. Source is verified on Basescan using Solidity
0.8.26, optimizer 200 runs, Cancun EVM. Roles, dependency addresses, 1 USDC bump
quote, 2 USDC immediate quote, zero pending requests and worker gas were
independently read back. The operator authorized deployment and read-only
publication only; no new live paid acceptance request has been submitted.

The campaign contract and $5 USDC/week campaign purchases are unchanged.
`contracts/DeVertQueue_v0.2.sol` adds two separate FIFO tiers:

- `tier=0`: queue bump at the base quote, for the next normal advert-break slot.
- `tier=1`: immediate extra break after the current recording, costing exactly
  twice that quote. Immediate requests take priority before playback starts;
  no request interrupts audio already playing or a protected show.

The shared base quote is $1 times `2 ** floor(pendingCount / 7)` across both
tiers. `quoteForTier` exposes exact quotes and `headRequestIdForTier` exposes
each tier's FIFO head. Settlement enforces FIFO per tier, rather than a global
head that would prevent an immediate play from settling ahead of an older bump.
Escrow, immutable purchased media, moderation roles, payer-only removal refunds,
128-position scan bounds, unique playback proofs and 45/45/8/2 routing are
preserved. The fulfiller still attests naturally completed playback; scheduling
timing is enforced by the radio, not independently proven on-chain.

Validation: six v0.2 unit tests plus the unchanged eight v0.1 unit tests, and
local Base-fork settlement/refund rehearsals for both versions. The fork test
funds an impersonated payer only within Hardhat when necessary; it never sends
a mainnet transaction.

Use `DEVERT_QUEUE_VERSION=2` with `scripts/deploy_devert_queue.js` for a dry run.
Separate authorization and `CONFIRM_DEPLOY=yes` are required to broadcast.
The script checks that the legacy queue's pending count and USDC reserves are
empty and writes a new `deployments/devert-queue-v02-base.json` record rather
than overwriting the verified v0.1 deployment. Configure the worker with the
new address and version 2, retain checkout disabled, and perform separately
authorized live acceptance of both tiers before enabling it.

### DeVert v0.1 (Deployed, Paused)

DeVert v0.1 is deployed on Base but remains paused and is not live. Address:
`0x135Cbc573F87637158eb3186C87c584fb0B34CD9`. Deployment transaction:
`0x4850be6aa2539550b74800eebc47e8636dbd9eac92a71f9fd64a9026427dfeb4`, block
`52453922`. The deployed code and roles were independently verified. The project
owner `0x807061DF657A7697c04045dA7d16D941861cAABc` has the admin role; the
existing DJuke fulfiller `0x4894698f2B5cAF13Fad4Aa8fbaFE3618b960909F` has the
DeVert scheduler role. Deployment metadata is in
`deployments/devert-v01-base.json`.

Each campaign purchase also includes a separate Base ETH scheduler top-up. The
checkout quotes 500,000 scheduler gas units at the current fee cap; the contract
checks that the attached value covers the included transaction's effective gas
price and forwards the full amount to the scheduler wallet. Any fee-cap surplus
stays in that wallet as operating reserve. This does not change the USDC offer,
the 45/45/8/2 split, or the advertiser's separate transaction gas cost. Only set
the public app's DeVert address and unpause after main-radio staging playback,
durable impression recovery, and role/expiry/overbid checks pass. The public
checkout address remains unset; no campaign purchase or ad playback has occurred.

### Supported Escrow Tokens (Optimism Mainnet)

| Token | Symbol | Address | Decimals | Notes |
|-------|--------|---------|----------|-------|
| Ether | ETH | _(native)_ | 18 | Native currency; deposit via `depositETH()` |
| USD Coin | USDC | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` | 6 | Native USDC (Circle) |
| Bridged USDC | USDCe | `0x7F5c764cBc14f9669B88837ca1490cCa17c31607` | 6 | Bridged USDC |
| BigNuten Token | $BNUT | `0x733c4d2Aae900E608147dd89Fa93606f89722823` | 18 | Governance & bounty rewards token; displayed in escrow balance panel |

Base Mainnet is the active deployment target. DecentNFT v0.2 remains the existing
collection; v0.3 is a fresh, empty collection and does not migrate any v0.2 token
IDs. DecentJukeBox v0.1 is deployed with the 90/8/2 artist/pinner/repo allocation.
Its deployer and dedicated fulfiller/registrar roles were verified on Base on
2026-10-10. Deployment transactions: NFT
`0x4d9d38f11eb1c8f4babc4002c488c23d1bbf3663e8ce3cd8e6eaa14345cc1eff`; DJuke
`0xd2e6905a525edb53f1a8a88d683ad8581b0c5f8068d740b26289fac72d2a16ca`. Worker
role grants: FULFILLER
`0x924e3b96405d85ce3500fe8e3dd96c207477eb165012ddd24d7c5fc757dc265a`; REGISTRAR
`0x368159e6601a2ac33631f8fe1023b18bf224971bd9e2bcf8ac791dea4e08b3fb`.
Addresses and receipt metadata are in `deployments/dbusk-base.json`. The deploy
script now writes addresses before worker role setup and refuses a second Base
deployment when the manifest exists. The UI does not provide an in-app network
switch; use MetaMask to change chains.

The fresh Base v0.3 collection currently has no products. Legacy Optimism
metadata CIDs are not assumed available. For the fresh Base collection, store
each token JSON and `collection.json` as separate IPFS objects through the
wallet-authorized Pinata relay and pin the same files with IPFS Desktop. Record
the returned CIDs and use the per-token URI and collection URI setters. Publish
the metadata CIDs as community data so independent BigNuten network nodes can
retrieve and pin them under the community reward workflow. The Render relay
authorizes Pinata uploads; it is not itself a persistent replica. Keep the
deployer's local Kubo node and independent node pins as additional replicas.

---

## How the UI Chooses the Contract

The UI selects the correct contract address based on the user's active MetaMask network.

**Config file:** [`js/config/contracts.js`](js/config/contracts.js)

Each entry in the `CONTRACTS` object maps a network key to its chain ID, RPC, block explorer, and
contract addresses. Example (Optimism):

```js
optimism: {
  chainId: '0xa',         // 10 in decimal
  chainName: 'Optimism Mainnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://mainnet.optimism.io'],
  blockExplorerUrls: ['https://optimistic.etherscan.io'],
  addresses: {
    DNFT: '0xe870f7b1D10C41dbc6b75598a5308B9a2Bb52958',
  },
},
```

The UI component that reads this config and reports the active MetaMask network is:
[`js/components/DecentCanvas/RightToolbar.js`](js/components/DecentCanvas/RightToolbar.js)

### Adding a New Chain or Updating an Address

1. **Update `js/config/contracts.js`** — add a new key under `CONTRACTS` (or update an existing
   address in `addresses.DNFT`).
2. **Update `js/components/DecentCanvas/RightToolbar.js`** — update the active-chain status display.
3. **Update this file** — add a row to the [Deployed Contracts](#deployed-contracts) table above.

---

## Remix Deployment Notes

All contracts are deployed via [Remix IDE](https://remix.ethereum.org) (no Hardhat deploy scripts).

### Constructor Arguments

`DecentNFT_v0_2` takes three constructor arguments:

| Argument | Type | Description |
|----------|------|-------------|
| `baseURI_` | `string` | IPFS base URI including trailing slash, e.g. `ipfs://<rootCID>/`. It may be blank at deployment; then registration is blocked until metadata is set, or each token is registered with its direct IPFS URI. |
| `royaltyReceiver` | `address` | Wallet that receives ERC-2981 royalties |
| `royaltyFeeBps` | `uint96` | Royalty in basis points (e.g. `500` = 5%) |

### Steps

1. Open [Remix](https://remix.ethereum.org), load `contracts/DecentNFT_v0.2.sol`.
2. Compile with Solidity 0.8.26, optimizer enabled (200 runs), EVM target: Cancun.
3. Under **Deploy & Run**, select **Injected Provider** and connect your admin wallet.
4. Fill in the three constructor arguments, then click **Deploy**.
5. Copy the deployed address and update `js/config/contracts.js` and this file.

For standalone JSON pins, set the collection file CID with `setContractURI` and
each token file CID with `setTokenURI` (or pass the URI to `registerToken`).
This avoids requiring a directory/root CID and lets Pinata, local IPFS Desktop,
and community nodes independently pin the same metadata files.

### Verifying Roles After Deployment

1. In the DecentMarket UI, open the right toolbar and paste the new contract address.
2. The panel displays the connected wallet's role (e.g. **ADMIN**). Confirm the deployer wallet
   shows `DEFAULT_ADMIN_ROLE`.
3. To grant `MINTER_ROLE` to another wallet, call `grantRole` from the admin wallet via Remix or
   the contract's block explorer "Write Contract" tab.

---

## Contract Upgrade Process

When a new contract version is deployed:

1. Deploy via Remix (see above).
2. Add a row to the [Deployed Contracts](#deployed-contracts) table with the new address, version,
   network, and ABI file path.
3. Add or update the ABI file in `abis/` (e.g. `abis/DecentNFT_v0.3.json`).
4. Update `js/config/contracts.js` with the new address (and new ABI import if the interface changed).
5. Open a PR referencing this file so the change is reviewed before going live.
# DVert v0.2 platform-funded scheduler

Deployed on Base at blocks 53048694 (campaigns:
`0xc73c9623C6E8E9c43872b1883ae4A290F2BAdD6F`) and 53048696 (replacement queue:
`0x3A771295af7F15B68c53251683916b65440eD8d3`). Both have exact creation/runtime
matches on Sourcify (2026-10-25 UTC). Both were activated on 2026-10-25 UTC
after the Render/site cutover and scheduler readiness verification; legacy
purchases remain paused and the paid lanes were drained.
The deployment manifest records all transaction hashes. Basescan's automatic
source submission hit its daily limit; the independent Sourcify matches succeeded.

`DeVert_v0_2` reuses v0.1 campaign scheduling and 45/45/8/2 settlement, but
accepts zero worker ETH only. Operators manually fund the shared DJuke worker;
advertisers still pay normal Base network gas. `quoteSchedulerGasTopUp` returns
zero. The v0.1 deployed contract retains its original mandatory contribution.

`scripts/deploy_devert_v02.js` performs read-only Base preflight by default.
It refuses a cutover while any legacy campaign's paid term remains, or while
pending paid requests/unclaimed refund reserves remain. Broadcasting requires
the project owner signer and `CONFIRM_DEPLOY=v0.2-base`. It journals each
transaction, pauses the legacy contracts, deploys the campaign and a replacement
v0.2 queue, and leaves the replacements paused. Activation is separate:
`CONFIRM_ACTIVATE=v0.2-base`, after updating the worker and site to matching
addresses/versions. The script verifies worker funding and API identities before
unpausing. The old queue cannot be repointed because its campaign source is
immutable. Preserve all old manifests, journals, NFT ownership and fund receipts.

Deployment output, when authorized, is recorded in
`deployments/devert-v02-base.json`; do not label the release live until that
manifest and the worker/site cutover are verified.
