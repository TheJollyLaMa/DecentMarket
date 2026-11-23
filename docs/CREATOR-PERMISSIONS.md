# DecentNFT v0.4 creator permissions (issue #47)

Status: **code and tests only, not deployed.** Base deployment waits for
approval gate A of the community Supporter epic (#85).

## Why a new collection

The live Base Supporter collection is DecentNFT **v0.2** at
`0xe63EC9f8228720bAAC2fD528C0A6d06B3Dc5439B` (Market `js/config/contracts.js`
`DNFT`). The Base DecentNFT **v0.3** at `0x64D5aDc50E5513975EfF7e9ba366B7eE58586fa3`
is the Busking/DJuke music collection; it has the owner batch and `multicall`
but no creator lane. Neither is upgradeable, so roles and creator logic cannot
be added to them. v0.4 is a **new, separate collection**. The v0.2 and v0.3
contracts and all their tokens remain unchanged. Nothing migrates, and existing
token IDs keep their collection address.

## Design

`contracts/DecentNFT_v0.4.sol` inherits `DecentNFT_v0_3` unchanged, so the
v0.2/v0.3 ABI, events, Product/Achievement lanes, owner batch
`registerAndMintProductsBatch` and `multicall` are all preserved.

| Need | v0.4 behavior |
| --- | --- |
| Creator authorization | `CREATOR_ROLE`, granted with limits by `authorizeCreator(creator, maxProducts, maxEditionsPerProduct)`. A bare `grantRole` has zero limits, so it fails closed. |
| Self-service | `registerAndMintProduct(amount, maxSupply, tokenURI, royaltyReceiver, royaltyBps)` registers a Product and mints it **to the caller only**. `mintCreatorProduct(tokenId, amount)` mints more of the caller's own product. |
| Provenance | `creatorOf`, `TokenRegistered.creator` and `EditionMinted.minter` are the creator. `productCreator(tokenId)` and `CreatorProductRegistered` identify creator-lane products (zero for Agency products). |
| Supply | Finite supply is required: `1 ≤ maxSupply ≤ maxEditionsPerProduct`. Lifetime `maxProducts` per creator. |
| Royalties | A per-token ERC-2981 royalty is mandatory. The receiver must be non-zero and can be a split contract. Royalty is capped at `creatorRoyaltyCapBps` (admin-set, hard ceiling 2,500 bps). The creator alone can move it with `setCreatorProductRoyalty`, within the cap. |
| Creator cannot | Grant or revoke roles, register tokens directly or register Achievements. They cannot mint Agency or other creators' products or change URIs and royalties beyond their own royalty. |
| Admin cannot | Mint editions of a creator product (including through `multicall` or the batch). The admin also cannot change its royalty or URI. `setDefaultRoyalty` does not affect it because every creator product has its own royalty. |
| Revocation | `revokeCreator` removes the role and limits. Existing products stay with their creator and remain locked against the admin. |
| Pause | `PAUSER_ROLE` or the admin pauses; only the admin unpauses. Pause stops **all** minting (Agency, creator, Achievement) and creator self-service. Transfers are never paused. |
| Atomic batches | Owner: inherited `registerAndMintProductsBatch` and `multicall`, with the owner as `msg.sender`. Creators: `multicall` of `registerAndMintProduct`, with the creator as `msg.sender`. One failure rolls back the whole batch. |
| Recovery | The contract holds no funds by design (no payable entry points; it cannot receive ERC-1155). The admin can recover stray ERC-20s and ERC-721s and force-sent ETH. Recovery refuses the collection's own address and cannot mint or reassign anything. |

v0.2's admin-gated functions are not `virtual`. The creator rules therefore sit
in three hooks:

- `_checkRole`: allows the `registerToken` selector only for the creator, during
  a transient window that makes no external calls. It also blocks
  `setTokenURI` on creator products.
- `_setTokenRoyalty`: locks creator royalties.
- `_update`: pauses mints and allows only the product's creator to mint it.

The registration runs as a delegatecall into v0.2's `registerToken`, as in
the v0.3 batch. This preserves `msg.sender` and v0.2's events. A contract creator's receive
hook cannot re-enter with elevated rights; the tests cover this.

Out of scope here: batch payout settlement and seller-scoped listings (#84),
the Studio UI (#83), and Canopy/Lobby announcements (#72).

## Validation

- `npx hardhat test test/DecentNFT_v04.test.js`: authorization boundaries,
  admin lock-out, re-entrancy, royalties and cap, limits and supply, revocation,
  pause, atomic rollback, token-ID sequencing, event provenance and recovery.
  The v0.2/v0.3 suites still pass.
- `npm run rehearse:nft-v04:fork` runs on an in-process Base fork with Hardhat
  test accounts. It refuses any network but the local fork. It snapshots the
  live v0.2 Supporter and v0.3 music collections (code hash, `nextTokenId`, Agency admin
  role), deploys v0.4 locally and exercises two creators, then recovers stray
  fork USDC. It asserts the live collections are unchanged. It broadcasts
  nothing.

## Deployment and migration (after approval gate A only)

1. Deploy v0.4 on Base with constructor arguments `("", <agency royalty receiver>,
   <default bps>, <creator royalty cap bps>)`. Set `setContractURI`. Verify the
   source. Record a new `deployments/decentnft-v04-base.json` with the start
   block. Do not overwrite the v0.2/v0.3 records.
2. Authorize the creators approved at the gate with `authorizeCreator`.
3. Add the address as a separate collection (keep `DNFT` v0.2) in Market
   `js/config/contracts.js`, the Supporter Studio and the seller-scoped listing
   allowlist (#84). Use `abis/DecentNFT_v0.4.json`.
4. Add the address, ABI and start block to the Canopy `scripts/supporter-dnfts.js`
   discovery/holdings indexers and the Busking indexers/ABIs (DecentBusking#71).
   Index `CreatorProductRegistered` and `productCreator` to label community products.
5. Order: deploy and verify, then update indexers to read the new collection,
   then enable the Studio creator flow. Existing v0.2/v0.3 tokens remain
   readable throughout.
