# DecentEscrow — Community Treasury v1

On-chain escrow contract for Decent Agency DNFT supporter sale proceeds.

---

## Contract Address

| Network | Address | Explorer |
|---------|---------|----------|
| Optimism Mainnet | _(pending deployment — fill in after `npm run deploy:escrow:optimism`)_ | [Optimistic Etherscan](https://optimistic.etherscan.io) |

Once deployed, update:
- This file (`docs/ESCROW.md`)
- `js/config/contracts.js` → `addresses.ESCROW`
- `DEPLOYMENTS.md` (new row in the table)

---

## What Are These Funds For?

All ETH and USDC deposited into this contract come from early supporter DNFT sales:

- **DecentHead v1.0** supporter editions — first-ever Decent product release
- **BigNuten v1.0** supporter editions — privacy-first fitness tracker with IPFS + MetaMask
- Future Decent product releases (one escrow serves all)

Funds are used for:

1. **Development bounties** — rewarding contributors via on-chain documented payouts
2. **Infrastructure costs** — IPFS pinning, RPC nodes, hosting
3. **Community experiments** — building in public, funding community-proposed features
4. **Operational reserves** — keeping the lights on while the community grows

These are **community funds**, not personal income. Every withdrawal is documented on-chain with a `reason` string visible to anyone on Etherscan.

---

## Contract Interface

```solidity
// DecentEscrow — Community Treasury v1
// SPDX-License-Identifier: MIT

// ── Deposits (anyone can call) ───────────────────────────────────────────────

// Deposit ETH with a note labelling the sale source
function depositETH(string calldata note) external payable;

// Deposit ERC-20 tokens (e.g. USDC); caller must approve first
function deposit(address token, uint256 amount, string calldata note) external;

// Plain ETH transfer also accepted (note defaults to empty string)
receive() external payable;

// ── Withdrawals (owner only) ─────────────────────────────────────────────────

// Withdraw ETH — reason required for on-chain accountability
function withdrawETH(uint256 amount, string calldata reason) external;

// Withdraw ERC-20 tokens — reason required
function withdraw(address token, uint256 amount, string calldata reason) external;

// ── View functions ────────────────────────────────────────────────────────────

function owner() external view returns (address);
function getETHBalance() external view returns (uint256);
function getBalance(address token) external view returns (uint256);

// ── Events ────────────────────────────────────────────────────────────────────

event Deposited(address indexed sender, address indexed token, uint256 amount, string note);
event Withdrawn(address indexed token, address indexed to, uint256 amount, string reason);
```

---

## Withdrawal Policy

All withdrawals must include a non-empty `reason` string stored on-chain. Examples:

| Type | Example reason |
|------|---------------|
| Bounty | `"Bounty payout — DecentMarket TheJollyLaMa/DecentMarket#45"` |
| Infrastructure | `"IPFS pinning — web3.storage Q1 2025"` |
| Development | `"Dev expenses — DecentHead v1.1 release sprint"` |
| Operational | `"Domain renewal — decentmarket.io 2025"` |

The `reason` is permanently recorded in the `Withdrawn` event log and visible to anyone on Etherscan. This is the accountability mechanism that replaces traditional audits for Phase 1.

---

## Upgrade Roadmap

### Phase 1 — Simple Ownable (Current)

- Single owner (TheJollyLaMa deployer wallet)
- All withdrawals require a documented `reason`
- Contract verified on Optimistic Etherscan
- Source code in `contracts/DecentEscrow.sol`

### Phase 2 — Multi-Sig (Next)

- `transferOwnership(gnosisSafe)` to a Gnosis Safe with 2-of-3 or 3-of-5 signers
- Publish signer list publicly
- Link to Gnosis Safe UI for transparency

### Phase 3 — DAO Governance (Future)

- Integrate with BigNuten governance contract (issue #47)
- `$BNUT` holders vote on treasury disbursements
- Automatic bounty payouts via BigNutenTreasury (issue #39)

---

## Related Contracts

| Contract | Network | Purpose |
|----------|---------|---------|
| `DecentNFT_v0_2` | Optimism `0xe870f7b1D10C41dbc6b75598a5308B9a2Bb52958` | ERC-1155 DNFT — sale proceeds flow to this escrow |
| `BigNutenTreasury` | TBD (issue #39) | $BNUT-specific payout contract (separate concern) |

---

## Source Code

- Contract: [`contracts/DecentEscrow.sol`](../contracts/DecentEscrow.sol)
- Deploy script: [`scripts/deployEscrow.js`](../scripts/deployEscrow.js)
- Tests: [`test/DecentEscrow.test.js`](../test/DecentEscrow.test.js)
