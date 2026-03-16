# DecentEscrow v0.1 — DNFT Escrow + Community Treasury

On-chain escrow for Decent Agency DNFT supporter sales, subscription management, and community treasury.

---

## Contract Address

| Network | Address | Explorer |
|---------|---------|----------|
| Optimism Mainnet | `0x23A457AD3C33d68E4fAd2FCa7c5d9a511E0C350e` | [Optimistic Etherscan](https://optimistic.etherscan.io/address/0x23A457AD3C33d68E4fAd2FCa7c5d9a511E0C350e) |

---

## Deploying via Remix IDE

This contract is designed to be deployed through [Remix IDE](https://remix.ethereum.org) — no CLI tooling required.

### Steps

1. **Open Remix** → [remix.ethereum.org](https://remix.ethereum.org)

2. **Load the contract** — paste the contents of `contracts/DecentEscrow.sol` into a new file, or upload the file directly.

3. **Compile**
   - In the Solidity Compiler tab, select compiler version **0.8.26**
   - Enable optimizer: **200 runs**
   - EVM version: **cancun** (or paris if cancun is unavailable)
   - Click **Compile DecentEscrow.sol**

4. **Deploy**
   - In the Deploy & Run Transactions tab, select **Injected Provider — MetaMask**
   - Make sure MetaMask is on **Optimism Mainnet** (chain ID 10)
   - Set the constructor argument: `initialOwner` — paste your wallet address (TheJollyLaMa's)
   - Click **Deploy**

5. **Confirm in MetaMask** — approve the deployment transaction

6. **Copy the deployed address** from the Remix console

### Post-deployment checklist

After deploying, complete these steps to wire the contract into the dapp:

- [x] Copy the deployed address from Remix
- [x] Paste it into `js/config/contracts.js` → `optimism.addresses.ESCROW`
- [x] Update the table above in `docs/ESCROW.md`
- [x] Add a row to `DEPLOYMENTS.md`
- [ ] Verify on Optimistic Etherscan:
  - Go to `https://optimistic.etherscan.io/address/0x23A457AD3C33d68E4fAd2FCa7c5d9a511E0C350e`
  - Click **Contract → Verify and Publish**
  - Compiler: `0.8.26`, Optimizer: enabled 200 runs, EVM: cancun
  - Paste the flattened source (use the **"Flattener"** plugin in Remix — enable it via Plugin Manager, then right-click the file → Flatten)
- [ ] In the 🏦 Escrow panel in the dapp, connect wallet and verify the owner is correct
- [ ] Do a test DNFT listing with 1 edition to confirm the purchase flow

---

## What Are These Funds For?

All ETH and USDC deposited into this contract come from early supporter DNFT sales:

- **DecentHead v1.0** supporter editions
- **BigNuten v1.0** supporter editions
- Future Decent product releases (one escrow serves all)

Funds are used for:

1. **Development bounties** — rewarding contributors via on-chain documented payouts
2. **Infrastructure costs** — IPFS pinning, RPC nodes, hosting
3. **Community experiments** — building in public, funding community-proposed features
4. **Operational reserves** — keeping the lights on while the community grows

Every withdrawal is documented on-chain with a `reason` string visible to anyone on Etherscan.

---

## Contract Capabilities (v0.1)

### 1. DNFT Marketplace

Owner deposits ERC-1155 DNFTs into the contract, then creates listings with ETH and/or USDC prices. Buyers call `purchaseWithETH` or `purchaseWithToken` and receive the DNFT immediately.

**Flow:**
1. Owner calls `safeTransferFrom(owner, escrow, tokenId, qty, "")` on the DNFT contract
2. Owner calls `listDNFT(nftContract, tokenId, priceETH, priceToken, priceAmount, qty, note)`
3. Buyer calls `purchaseWithETH(listingId, 1)` with exact ETH attached → receives DNFT

### 2. Treasury

Accepts plain ETH transfers and labelled `depositETH(note)` / `depositToken(token, amount, note)` calls.  
Owner can withdraw with `withdrawETH(amount, reason)` or `withdrawToken(token, amount, reason)`.

### 3. Subscriptions

Owner creates Plans with a name, payment token, price, and period. Users call `subscribe(planId)` to pay for one period. Dapps call `isSubscribed(planId, user)` to gate features.

---

## Function Reference

### Deposits (anyone can call)

| Function | Description |
|----------|-------------|
| `receive() payable` | Plain ETH transfer → emits `Deposited` with empty note |
| `depositETH(note) payable` | ETH deposit with label |
| `depositToken(token, amount, note)` | ERC-20 deposit (caller must approve first) |

### DNFT Marketplace (owner: listing; anyone: purchase)

| Function | Who | Description |
|----------|-----|-------------|
| `listDNFT(nftContract, tokenId, priceETH, priceToken, priceAmount, qty, note)` | Owner | Create a listing |
| `delistDNFT(listingId)` | Owner | Deactivate a listing |
| `purchaseWithETH(listingId, amount)` | Anyone | Buy with ETH |
| `purchaseWithToken(listingId, amount)` | Anyone | Buy with ERC-20 |
| `withdrawNFT(nftContract, tokenId, amount, to)` | Owner | Reclaim unsold NFTs |

### Withdrawals (owner only)

| Function | Description |
|----------|-------------|
| `withdrawETH(amount, reason)` | Withdraw ETH with on-chain reason |
| `withdrawToken(token, amount, reason)` | Withdraw ERC-20 with on-chain reason |

### Subscriptions (owner: plans; anyone: subscribe)

| Function | Who | Description |
|----------|-----|-------------|
| `createPlan(name, paymentToken, pricePerPeriod, periodSeconds)` | Owner | Define a new plan |
| `deactivatePlan(planId)` | Owner | Stop new subscriptions |
| `subscribe(planId)` | Anyone | Pay for one period |
| `isSubscribed(planId, account)` | Anyone | Check subscription status |

### View functions

| Function | Returns |
|----------|---------|
| `getETHBalance()` | ETH held (wei) |
| `getBalance(token)` | ERC-20 balance |
| `getNFTBalance(nftContract, tokenId)` | ERC-1155 editions held |
| `getListing(listingId)` | Full listing struct |
| `getPlan(planId)` | Full plan struct |
| `owner()` | Current owner address |

---

## Upgrade Roadmap

### Phase 1 — Simple Ownable (Current)
- Single owner (TheJollyLaMa wallet)
- DNFT marketplace + treasury + subscription skeleton
- Verified on Optimistic Etherscan

### Phase 2 — Multi-Sig
- `transferOwnership(gnosisSafe)` to a Gnosis Safe
- 2-of-3 or 3-of-5 signers, list published publicly

### Phase 3 — DAO Governance
- Integrate with BigNuten governance (#47)
- `$BNUT` holders vote on treasury disbursements

---

## Source Code

- Contract: [`contracts/DecentEscrow.sol`](../contracts/DecentEscrow.sol)
- ABI (generated after deploy): `abis/DecentEscrow.json` _(create after Remix deploy)_
