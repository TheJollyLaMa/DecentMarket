# DecentMarket — Deployment Log

Single source of truth for all on-chain deployments of DecentMarket smart contracts.

---

## Deployed Contracts

| Network | Contract | Version | Address | ABI | Explorer |
|---------|----------|---------|---------|-----|----------|
| Polygon Mainnet | DecentNFT | v0.1 | `0x4cE20F0bbF7eA38488F9c9555EfD2b502E86A53E` | not tracked in repo | [Polygonscan](https://polygonscan.com/address/0x4cE20F0bbF7eA38488F9c9555EfD2b502E86A53E) |
| Optimism Mainnet | DecentNFT | v0.2 | `0xe870f7b1D10C41dbc6b75598a5308B9a2Bb52958` | `abis/DecentNFT_v0.2.json` | [Optimism Etherscan](https://optimistic.etherscan.io/address/0xe870f7b1D10C41dbc6b75598a5308B9a2Bb52958) |
| Optimism Mainnet | DecentEscrow | v0.1 | `0x23A457AD3C33d68E4fAd2FCa7c5d9a511E0C350e` | `abis/DecentEscrow_v0.1.json` | [Optimism Etherscan](https://optimistic.etherscan.io/address/0x23A457AD3C33d68E4fAd2FCa7c5d9a511E0C350e) |

### Supported Escrow Tokens (Optimism Mainnet)

| Token | Symbol | Address | Decimals | Notes |
|-------|--------|---------|----------|-------|
| Ether | ETH | _(native)_ | 18 | Native currency; deposit via `depositETH()` |
| USD Coin | USDC | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` | 6 | Native USDC (Circle) |
| Bridged USDC | USDCe | `0x7F5c764cBc14f9669B88837ca1490cCa17c31607` | 6 | Bridged USDC |
| BigNuten Token | $BNUT | `0x733c4d2Aae900E608147dd89Fa93606f89722823` | 18 | Governance & bounty rewards token; displayed in escrow balance panel |

Base Mainnet is the current deployment target. Base DecentNFT and DecentEscrow
addresses remain blank until deployment and verification are complete. The UI
does not provide an in-app network switch; use MetaMask to change chains.

The Base redeployment is prepared but has not been sent. Legacy Optimism
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
