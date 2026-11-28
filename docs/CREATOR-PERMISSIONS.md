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
| Creator authorization | `authorizeCreator(creator, maxEditionsPerProduct)` grants `CREATOR_ROLE` and a per-series supply limit. A bare `grantRole` has a zero registration limit and does not approve any projects. |
| Project approval | An admin separately calls `setCreatorProjectApproval(creator, projectId, true)` after steward review. The ID must be `decent-project:<lowercase creator wallet>:<project key>`, with a 1-50 character ASCII letter, digit, `_` or `-` key. Approval is scoped to the creator and project; multiple series may use the same project. Each creator starts with an allowance of 10 distinct projects over their lifetime, adjustable by an admin with `setCreatorProjectLimit`. Revocation does not free a place; reapproval of the same project does not use another. Lowering the limit does not revoke existing approvals. |
| Self-service | `registerAndMintProduct(amount, maxSupply, tokenURI, royaltyReceiver, royaltyBps, projectHash)` registers a Product and mints it to the caller. `projectHash` is `keccak256(bytes(projectId))`. `mintCreatorProduct(tokenId, amount)` mints more of the caller's own product while its project remains approved. |
| Optional edition gift | The separate `registerAndMintProductWithGift` and `mintCreatorProductWithGift` methods require an explicit expected Agency recipient. They gift `floor(amount / 10)` editions from the requested amount; fewer than 10 gives zero. The ordinary methods never gift. Rounding is per mint transaction. |
| Gift recipient | An admin sets `setEditionGiftRecipient` to the verified Agency recipient; the initial zero address disables gifts. A changed or disabled recipient causes an opt-in transaction to revert rather than sending to a different address. The recipient must be able to receive ERC-1155 editions. |
| Provenance | `creatorOf`, `TokenRegistered.creator` and `EditionMinted.minter` are the creator. `productCreator(tokenId)` and `CreatorProductRegistered` identify creator-lane products. `productProject(tokenId)` and `CreatorProjectLinked` bind each series to the approved project hash; `CreatorProjectApproval` includes the readable canonical ID. Agency products have no project binding. |
| Supply | Finite supply is required: `1 ≤ maxSupply ≤ maxEditionsPerProduct`. There is no contributor-wide series count. An edition-limit change applies to new series, not the immutable cap of an existing series. |
| Royalties | A per-token ERC-2981 royalty pays the creator wallet. The creator chooses and can update the rate using `setCreatorProductRoyalty`, within `creatorRoyaltyCapBps` (admin-set, hard ceiling 1,000 bps). The intended Studio starting choice is 5%; it is not forced by the contract. Other marketplaces may choose whether to honor ERC-2981. A separate seller-listings draft must enforce the agreed 10% combined resale cap; this collection does not enforce marketplace fees. |
| Creator cannot | Grant or revoke roles, register tokens directly or register Achievements. They cannot mint Agency or other creators' products or change URIs and royalties beyond their own royalty. |
| Admin cannot | Mint editions of a creator product (including through `multicall` or the batch). The admin also cannot change its royalty or URI. `setDefaultRoyalty` does not affect it because every creator product has its own royalty. |
| Revocation | Project revocation stops new registrations and further minting for that project. Creator revocation, including direct `revokeRole` or `renounceRole`, clears the supply limit and invalidates **all** that creator's project approvals, even if the role is later re-granted. Approve projects again to resume. Existing editions remain transferable, creator products stay locked against the admin, and the original creator retains control over their royalty rate. |
| Pause | `PAUSER_ROLE` or the admin pauses; only the admin unpauses. Pause stops **all** minting (Agency, creator, Achievement) and creator registration. Transfers and creator royalty updates are never paused. |
| Atomic batches | Owner: inherited `registerAndMintProductsBatch` and `multicall`, with the owner as `msg.sender`. Creators: `multicall` of `registerAndMintProduct`, with the creator as `msg.sender`. One failure rolls back the whole batch. |
| Recovery | The contract holds no funds by design (no payable entry points; it cannot receive ERC-1155). The admin can recover stray ERC-20s and ERC-721s and force-sent ETH. Recovery refuses the collection's own address and cannot mint or reassign anything. |

v0.2's admin-gated functions are not `virtual`. The creator rules therefore sit
in four hooks:

- `_checkRole`: allows the `registerToken` selector only for the creator, during
  a transient window that makes no external calls. It also blocks
  `setTokenURI` on creator products.
- `_setTokenRoyalty`: locks creator royalties.
- `_update`: pauses mints and allows only the product's creator to mint it. The
  transient mint permission is consumed before any ERC-1155 receiver callback.
- `_revokeRole`: invalidates project approvals and supply authorization on every
  creator-role revocation path.
- `_grantRole`: initializes the lifetime project limit without resetting a previously
  configured limit or lifetime count.

The registration runs as a delegatecall into v0.2's `registerToken`, as in
the v0.3 batch. This preserves `msg.sender` and v0.2's events. A contract creator's receive
hook cannot re-enter with elevated rights; the tests cover this.

Approval is a **manual admin attestation**, not an on-chain proof of publication
or independent ownership. Before approving, a steward must inspect the current
public Canopy index and verify the wallet-signed record and project membership.
Canopy's existing [creator record verifier](https://github.com/TheJollyLaMa/DecentCanopy/blob/main/scripts/creator-records.js)
checks canonical signatures. A companion [read-only preparation tool](https://github.com/TheJollyLaMa/DecentCanopy/pull/77)
is in a separate draft PR and returns the canonical ID, hash and proposed call
arguments; it does not sign or send a transaction. The index may change after
any check. Recheck before approval and manually revoke when a project is removed
or no longer eligible. Project keys are case-sensitive. A receiving wallet
declared inside a project is not the profile's signing wallet.

Do not enable self-service until the approval process, contract and integration
are reviewed and deployment is explicitly authorized. Batch payout settlement
and seller-scoped listings (#84), the Studio UI (#83), and Canopy/Lobby
announcements (#72) remain separate work.

## Validation

- `npx hardhat test test/DecentNFT_v04.test.js`: authorization boundaries,
  project IDs, approvals and role-revocation paths, multiple series, admin
  lock-out, re-entrancy, royalties and cap, limits and supply, revocation,
  optional gift rounding and recipient changes, pause, atomic rollback,
  token-ID sequencing, event provenance and recovery.
  The v0.2/v0.3 suites still pass.
- `npm run rehearse:nft-v04:fork` runs on an in-process Base fork with Hardhat
  test accounts. It refuses any network but the local fork. It snapshots the
  live v0.2 Supporter and v0.3 music collections (code hash, `nextTokenId`, Agency admin
  role), deploys v0.4 locally and exercises two creators, then recovers stray
  fork USDC. It asserts the live collections are unchanged. It broadcasts
  nothing.

## Deployment and migration (after review and approval gate A only)

1. Deploy v0.4 on Base with constructor arguments `("", <agency royalty receiver>,
   <default bps>, <creator royalty cap bps>)`. Set `setContractURI`. Verify the
   source. Record a new `deployments/decentnft-v04-base.json` with the start
   block. Do not overwrite the v0.2/v0.3 records.
2. Authorize approved creators and, separately, approve each reviewed canonical
   Canopy project ID. Configure a verified `editionGiftRecipient` before
   offering gifts; do not assume a wallet address or enable gifts while it is
   unset.
3. Add the address as a separate collection (keep `DNFT` v0.2) in Market
   `js/config/contracts.js`, the Supporter Studio and the seller-scoped listing
   allowlist (#84). Use `abis/DecentNFT_v0.4.json`.
4. Add the address, ABI and start block to the Canopy `scripts/supporter-dnfts.js`
   discovery/holdings indexers and the Busking indexers/ABIs (DecentBusking#71).
   Index `CreatorProductRegistered`, `CreatorProjectApproval` and
   `CreatorProjectLinked` and read `productCreator` / `productProject` to label
   community products and their project associations.
5. Order: deploy and verify, then update indexers to read the new collection,
   then enable the Studio creator flow. Existing v0.2/v0.3 tokens remain
   readable throughout.
