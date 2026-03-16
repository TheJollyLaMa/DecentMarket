// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

/**
 * @title DecentEscrow v0.1
 * @notice DNFT Escrow + Community Treasury for Decent Agency products.
 *
 * Core capabilities
 * -----------------
 *   1. DNFT Marketplace — Owner deposits ERC-1155 DNFTs, sets a price in ETH and/or
 *      an ERC-20 token (e.g. USDC).  Buyers call purchaseWithETH or purchaseWithToken
 *      and immediately receive the DNFT in their wallet.
 *
 *   2. Treasury — Accepts plain ETH/ERC-20 deposits with an on-chain note.
 *      Owner withdrawals require a documented `reason` string for accountability.
 *
 *   3. Subscriptions (v0.1 skeleton) — Owner defines Plans with a price, payment
 *      token, and period length.  Users subscribe; the escrow tracks expiry on-chain
 *      so dapps can gate features by calling `isSubscribed(planId, user)`.
 *
 * Ownership upgrade path
 * ----------------------
 *   Phase 1: deployer wallet — simple, auditable MVP
 *   Phase 2: transferOwnership(gnosisSafe) — Gnosis Safe multi-sig
 *   Phase 3: DAO governance via BigNuten ($BNUT) integration
 *
 * Deployment
 * ----------
 *   Deploy via Remix IDE on Optimism Mainnet.
 *   Constructor argument: `initialOwner` — the wallet that controls the escrow.
 *   After deployment update `js/config/contracts.js` → `addresses.ESCROW`.
 */
contract DecentEscrow_v001 is Ownable, ERC1155Holder {
    using SafeERC20 for IERC20;

    // =========================================================================
    // Data structures
    // =========================================================================

    /**
     * @notice A DNFT listing: one or more editions of an ERC-1155 token offered
     *         for purchase at a fixed price.
     */
    struct Listing {
        address nftContract;   // ERC-1155 contract address
        uint256 tokenId;       // ERC-1155 token ID
        uint256 priceETH;      // price per edition in wei (0 = not purchasable with ETH)
        address priceToken;    // ERC-20 token for alternate payment (address(0) = ETH-only)
        uint256 priceAmount;   // price per edition in ERC-20 units (0 = not purchasable with token)
        uint256 available;     // editions still available to buy
        bool    active;        // false once sold out or delisted by owner
        string  note;          // human-readable label, e.g. "DecentHead v1.0 Supporter DNFT"
    }

    /**
     * @notice A subscription plan dapps can use for recurring payments.
     */
    struct Plan {
        string  name;           // e.g. "DecentHead Pro"
        address paymentToken;   // address(0) = ETH
        uint256 pricePerPeriod; // cost per subscription period
        uint256 periodSeconds;  // duration of one period in seconds
        bool    active;
    }

    // =========================================================================
    // State
    // =========================================================================

    /// @notice All DNFT listings. Key = listing ID (auto-incrementing).
    mapping(uint256 => Listing) public listings;
    uint256 public nextListingId;

    /// @notice All subscription plans. Key = plan ID (auto-incrementing).
    mapping(uint256 => Plan) public plans;
    uint256 public nextPlanId;

    /// @notice subscriber → planId → UNIX timestamp when subscription expires.
    mapping(address => mapping(uint256 => uint256)) public subscriptions;

    // =========================================================================
    // Events
    // =========================================================================

    // ── Treasury ──────────────────────────────────────────────────────────────

    /// @notice ETH or ERC-20 deposited into the treasury.
    event Deposited(
        address indexed sender,
        address indexed token,
        uint256 amount,
        string  note
    );

    /// @notice ETH or ERC-20 withdrawn from the treasury by the owner.
    event Withdrawn(
        address indexed token,
        address indexed to,
        uint256 amount,
        string  reason
    );

    // ── DNFT Marketplace ──────────────────────────────────────────────────────

    /// @notice Owner listed DNFTs for sale.
    event Listed(
        uint256 indexed listingId,
        address indexed nftContract,
        uint256 indexed tokenId,
        uint256 priceETH,
        address priceToken,
        uint256 priceAmount,
        uint256 quantity,
        string  note
    );

    /// @notice Listing deactivated by owner (sold out or manually delisted).
    event Delisted(uint256 indexed listingId);

    /// @notice A buyer purchased edition(s) from a listing.
    event Purchased(
        uint256 indexed listingId,
        address indexed buyer,
        uint256 amount,
        address indexed paymentToken,
        uint256 totalPaid
    );

    /// @notice Owner deposited ERC-1155 tokens into the escrow (outside of a listing).
    event NFTDeposited(
        address indexed sender,
        address indexed nftContract,
        uint256 indexed tokenId,
        uint256 amount
    );

    /// @notice Owner reclaimed ERC-1155 tokens from the escrow.
    event NFTWithdrawn(
        address indexed nftContract,
        uint256 indexed tokenId,
        address indexed to,
        uint256 amount
    );

    // ── Subscriptions ────────────────────────────────────────────────────────

    /// @notice New subscription plan created by owner.
    event PlanCreated(
        uint256 indexed planId,
        string  name,
        address paymentToken,
        uint256 pricePerPeriod,
        uint256 periodSeconds
    );

    /// @notice User subscribed or renewed a plan.
    event Subscribed(
        uint256 indexed planId,
        address indexed subscriber,
        uint256 expiresAt
    );

    // =========================================================================
    // Constructor
    // =========================================================================

    /**
     * @param initialOwner Wallet receiving ownership on deployment.
     *                     Typically TheJollyLaMa's wallet for Phase 1.
     *                     Transfer to Gnosis Safe via transferOwnership() for Phase 2.
     */
    constructor(address initialOwner) Ownable(initialOwner) {}

    // =========================================================================
    // ERC-1155 receiver
    // =========================================================================

    /**
     * @notice Called by ERC-1155 contracts when tokens are safeTransferred to this
     *         escrow directly (without using listDNFT).  Emits NFTDeposited so the
     *         deposit is visible on-chain.
     */
    function onERC1155Received(
        address operator,
        address from,
        uint256 id,
        uint256 value,
        bytes memory data
    ) public override returns (bytes4) {
        emit NFTDeposited(from, msg.sender, id, value);
        return super.onERC1155Received(operator, from, id, value, data);
    }

    /**
     * @notice Called by ERC-1155 contracts when batch tokens are safeTransferred here.
     */
    function onERC1155BatchReceived(
        address operator,
        address from,
        uint256[] memory ids,
        uint256[] memory values,
        bytes memory data
    ) public override returns (bytes4) {
        for (uint256 i = 0; i < ids.length; i++) {
            emit NFTDeposited(from, msg.sender, ids[i], values[i]);
        }
        return super.onERC1155BatchReceived(operator, from, ids, values, data);
    }

    // =========================================================================
    // Treasury — ETH deposits
    // =========================================================================

    /**
     * @notice Accepts plain ETH transfers (no calldata).
     *         Emits Deposited with an empty note.
     *         Prefer depositETH(note) for labelled deposits.
     */
    receive() external payable {
        emit Deposited(msg.sender, address(0), msg.value, "");
    }

    /**
     * @notice Deposit ETH with a descriptive note.
     * @param note  e.g. "DecentHead v1.0 DNFT sale proceeds"
     */
    function depositETH(string calldata note) external payable {
        require(msg.value > 0, "DecentEscrow: zero ETH deposit");
        emit Deposited(msg.sender, address(0), msg.value, note);
    }

    /**
     * @notice Deposit ERC-20 tokens (e.g. USDC) with a note.
     *         Caller must approve this contract for at least `amount` tokens first.
     * @param token   ERC-20 contract address.
     * @param amount  Amount in token-native decimals.
     * @param note    Human-readable label.
     */
    function depositToken(
        address token,
        uint256 amount,
        string calldata note
    ) external {
        require(token != address(0), "DecentEscrow: use depositETH for ETH");
        require(amount > 0, "DecentEscrow: zero token deposit");
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, token, amount, note);
    }

    // =========================================================================
    // Treasury — Withdrawals (owner only)
    // =========================================================================

    /**
     * @notice Withdraw ETH. Reason required for on-chain accountability.
     * @param amount  Amount in wei.
     * @param reason  e.g. "Bounty payout — TheJollyLaMa/DecentMarket#45"
     */
    function withdrawETH(uint256 amount, string calldata reason) external onlyOwner {
        require(amount > 0, "DecentEscrow: zero amount");
        require(address(this).balance >= amount, "DecentEscrow: insufficient ETH balance");
        emit Withdrawn(address(0), msg.sender, amount, reason);
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "DecentEscrow: ETH transfer failed");
    }

    /**
     * @notice Withdraw ERC-20 tokens. Reason required.
     * @param token   ERC-20 contract address.
     * @param amount  Amount in token-native decimals.
     * @param reason  On-chain reason string.
     */
    function withdrawToken(
        address token,
        uint256 amount,
        string calldata reason
    ) external onlyOwner {
        require(token != address(0), "DecentEscrow: use withdrawETH for ETH");
        require(amount > 0, "DecentEscrow: zero amount");
        emit Withdrawn(token, msg.sender, amount, reason);
        IERC20(token).safeTransfer(msg.sender, amount);
    }

    /**
     * @notice Reclaim ERC-1155 tokens held by the escrow (e.g. unsold DNFTs).
     * @param nftContract  ERC-1155 contract address.
     * @param tokenId      Token ID.
     * @param amount       Number of editions to reclaim.
     * @param to           Destination address.
     */
    function withdrawNFT(
        address nftContract,
        uint256 tokenId,
        uint256 amount,
        address to
    ) external onlyOwner {
        require(amount > 0, "DecentEscrow: zero amount");
        require(to != address(0), "DecentEscrow: zero address");
        emit NFTWithdrawn(nftContract, tokenId, to, amount);
        IERC1155(nftContract).safeTransferFrom(address(this), to, tokenId, amount, "");
    }

    // =========================================================================
    // DNFT Marketplace — Listing management (owner only)
    // =========================================================================

    /**
     * @notice List editions of an ERC-1155 DNFT for purchase.
     *         The escrow must already hold at least `quantity` editions of the token
     *         (transfer them first with safeTransferFrom on the NFT contract).
     *
     * @param nftContract  ERC-1155 contract address.
     * @param tokenId      Token ID to list.
     * @param priceETH     Price per edition in wei (0 = not purchasable with ETH).
     * @param priceToken   ERC-20 token for alternate payment (address(0) = ETH-only).
     * @param priceAmount  Price per edition in ERC-20 units (0 = not purchasable with token).
     * @param quantity     Number of editions to make available.
     * @param note         Human-readable label, e.g. "DecentHead v1.0 Supporter DNFT".
     * @return listingId   The newly created listing ID.
     */
    function listDNFT(
        address nftContract,
        uint256 tokenId,
        uint256 priceETH,
        address priceToken,
        uint256 priceAmount,
        uint256 quantity,
        string calldata note
    ) external onlyOwner returns (uint256 listingId) {
        require(nftContract != address(0), "DecentEscrow: zero address");
        require(quantity > 0, "DecentEscrow: zero quantity");
        require(priceETH > 0 || priceAmount > 0, "DecentEscrow: no price set");

        listingId = nextListingId++;
        listings[listingId] = Listing({
            nftContract: nftContract,
            tokenId:     tokenId,
            priceETH:    priceETH,
            priceToken:  priceToken,
            priceAmount: priceAmount,
            available:   quantity,
            active:      true,
            note:        note
        });

        emit Listed(listingId, nftContract, tokenId, priceETH, priceToken, priceAmount, quantity, note);
    }

    /**
     * @notice Deactivate a listing (e.g. to change the price or pull it from sale).
     *         Held NFT editions are NOT automatically returned — call withdrawNFT separately.
     * @param listingId  Listing to deactivate.
     */
    function delistDNFT(uint256 listingId) external onlyOwner {
        require(listings[listingId].active, "DecentEscrow: listing not active");
        listings[listingId].active = false;
        emit Delisted(listingId);
    }

    // =========================================================================
    // DNFT Marketplace — Purchase
    // =========================================================================

    /**
     * @notice Purchase `amount` editions of a listed DNFT by paying ETH.
     *         Exact ETH must be sent (msg.value == listing.priceETH * amount).
     *         DNFT is transferred to msg.sender immediately.
     * @param listingId  Listing ID to purchase from.
     * @param amount     Number of editions to buy.
     */
    function purchaseWithETH(uint256 listingId, uint256 amount) external payable {
        Listing storage l = listings[listingId];
        require(l.active, "DecentEscrow: listing not active");
        require(l.priceETH > 0, "DecentEscrow: ETH purchase not available");
        require(amount > 0 && amount <= l.available, "DecentEscrow: invalid amount");

        uint256 totalCost = l.priceETH * amount;
        require(msg.value == totalCost, "DecentEscrow: incorrect ETH amount");

        l.available -= amount;
        if (l.available == 0) l.active = false;

        emit Purchased(listingId, msg.sender, amount, address(0), totalCost);
        IERC1155(l.nftContract).safeTransferFrom(address(this), msg.sender, l.tokenId, amount, "");
    }

    /**
     * @notice Purchase `amount` editions of a listed DNFT by paying an ERC-20 token
     *         (e.g. USDC).  Caller must approve this contract first.
     *         DNFT is transferred to msg.sender immediately.
     * @param listingId  Listing ID to purchase from.
     * @param amount     Number of editions to buy.
     */
    function purchaseWithToken(uint256 listingId, uint256 amount) external {
        Listing storage l = listings[listingId];
        require(l.active, "DecentEscrow: listing not active");
        require(l.priceToken != address(0) && l.priceAmount > 0, "DecentEscrow: token purchase not available");
        require(amount > 0 && amount <= l.available, "DecentEscrow: invalid amount");

        uint256 totalCost = l.priceAmount * amount;

        l.available -= amount;
        if (l.available == 0) l.active = false;

        IERC20(l.priceToken).safeTransferFrom(msg.sender, address(this), totalCost);

        emit Purchased(listingId, msg.sender, amount, l.priceToken, totalCost);
        IERC1155(l.nftContract).safeTransferFrom(address(this), msg.sender, l.tokenId, amount, "");
    }

    // =========================================================================
    // Subscriptions (v0.1 skeleton)
    // =========================================================================

    /**
     * @notice Create a new subscription plan.
     * @param name           Human-readable name, e.g. "DecentHead Pro Monthly".
     * @param paymentToken   ERC-20 token address; address(0) for ETH.
     * @param pricePerPeriod Payment amount per period.
     * @param periodSeconds  Length of one subscription period in seconds.
     * @return planId        The newly created plan ID.
     */
    function createPlan(
        string calldata name,
        address paymentToken,
        uint256 pricePerPeriod,
        uint256 periodSeconds
    ) external onlyOwner returns (uint256 planId) {
        require(pricePerPeriod > 0, "DecentEscrow: zero price");
        require(periodSeconds > 0,  "DecentEscrow: zero period");

        planId = nextPlanId++;
        plans[planId] = Plan({
            name:           name,
            paymentToken:   paymentToken,
            pricePerPeriod: pricePerPeriod,
            periodSeconds:  periodSeconds,
            active:         true
        });

        emit PlanCreated(planId, name, paymentToken, pricePerPeriod, periodSeconds);
    }

    /**
     * @notice Subscribe to a plan for one period (or renew an existing subscription).
     *         Payment is pulled from the caller (ETH sent for ETH plans; token
     *         must be approved for ERC-20 plans).
     *         The expiry timestamp is extended from max(now, current expiry).
     * @param planId  Plan to subscribe to.
     */
    function subscribe(uint256 planId) external payable {
        Plan storage p = plans[planId];
        require(p.active, "DecentEscrow: plan not active");

        if (p.paymentToken == address(0)) {
            // ETH plan
            require(msg.value == p.pricePerPeriod, "DecentEscrow: incorrect ETH amount");
        } else {
            // ERC-20 plan
            require(msg.value == 0, "DecentEscrow: send no ETH for token plan");
            IERC20(p.paymentToken).safeTransferFrom(msg.sender, address(this), p.pricePerPeriod);
        }

        uint256 start = subscriptions[msg.sender][planId];
        if (start < block.timestamp) start = block.timestamp;
        uint256 expiresAt = start + p.periodSeconds;

        subscriptions[msg.sender][planId] = expiresAt;
        emit Subscribed(planId, msg.sender, expiresAt);
    }

    /**
     * @notice Deactivate a subscription plan so no new subscriptions can start.
     * @param planId  Plan to deactivate.
     */
    function deactivatePlan(uint256 planId) external onlyOwner {
        plans[planId].active = false;
    }

    // =========================================================================
    // View helpers
    // =========================================================================

    /**
     * @notice Returns the escrow's current ETH balance in wei.
     */
    function getETHBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /**
     * @notice Returns the escrow's balance of an ERC-20 token.
     * @param token  ERC-20 contract address.
     */
    function getBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    /**
     * @notice Returns the number of ERC-1155 token editions held by the escrow.
     * @param nftContract  ERC-1155 contract address.
     * @param tokenId      Token ID.
     */
    function getNFTBalance(address nftContract, uint256 tokenId) external view returns (uint256) {
        return IERC1155(nftContract).balanceOf(address(this), tokenId);
    }

    /**
     * @notice Returns true if `account` has an active subscription to `planId`.
     * @param planId   Plan ID.
     * @param account  Wallet to check.
     */
    function isSubscribed(uint256 planId, address account) external view returns (bool) {
        return subscriptions[account][planId] > block.timestamp;
    }

    /**
     * @notice Returns full details for a listing.
     */
    function getListing(uint256 listingId) external view returns (Listing memory) {
        return listings[listingId];
    }

    /**
     * @notice Returns full details for a subscription plan.
     */
    function getPlan(uint256 planId) external view returns (Plan memory) {
        return plans[planId];
    }
}
