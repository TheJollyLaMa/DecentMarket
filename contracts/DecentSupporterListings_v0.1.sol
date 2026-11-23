// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";

/**
 * @title DecentSupporterListings v0.1
 * @notice Seller-scoped ERC-1155 listings for Decent Supporter DNFTs (DecentMarket#84).
 *
 * Runs alongside DecentEscrow_v001 (the Agency's single-seller shop) without migrating it.
 *
 *   - Any holder lists editions of an allowlisted collection. The editions are deposited into
 *     custody and the listing records its seller. Only that seller can update or delist;
 *     delisting returns unsold editions to the seller.
 *   - Buyers pay in ETH (payToken = address(0)) or an allowlisted ERC-20 such as USDC.
 *     Each sale credits the seller, the collection's ERC-2981 royalty (capped) and an optional
 *     platform fee (default 0, capped). Credits are withdrawn by pull payment.
 *   - The owner can pause, curate allowlists and run administrator recovery. Recovery can only
 *     return a listing's editions to its recorded seller, or move tokens and funds that no
 *     listing or owed balance accounts for. It can never take seller stock or owed credits.
 *
 * Sellers can always delist and every creditor can always withdraw, including while paused.
 */
contract DecentSupporterListings_v0_1 is Ownable, ERC1155Holder, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // =========================================================================
    // Constants
    // =========================================================================

    uint256 public constant BPS_DENOMINATOR = 10_000;
    /// @notice Hard cap on the platform fee (5 %).
    uint256 public constant MAX_PLATFORM_FEE_BPS = 500;
    /// @notice Hard cap on the ERC-2981 royalty honoured per sale (10 %). Larger quotes are clipped.
    uint256 public constant MAX_ROYALTY_BPS = 1_000;

    // =========================================================================
    // Data structures
    // =========================================================================

    struct Listing {
        address seller;      // receives proceeds and any unsold editions
        address collection;  // allowlisted ERC-1155 contract
        uint256 tokenId;
        address payToken;    // address(0) = ETH
        uint256 unitPrice;   // per edition, in payToken units (wei for ETH)
        uint256 quantity;    // editions currently held in custody for this listing
        uint16  feeBps;      // platform fee snapshot at listing time; sales use min(snapshot, current)
        bool    active;
    }

    enum CloseReason { Delisted, SoldOut, EmergencyReturn }

    // =========================================================================
    // State
    // =========================================================================

    mapping(uint256 => Listing) private _listings;
    uint256 public nextListingId;
    mapping(address => uint256[]) private _sellerListingIds;

    mapping(address => bool) public allowedCollection;
    mapping(address => bool) public allowedPayToken;

    uint16  public platformFeeBps;
    address public feeRecipient;

    /// @notice Editions held for active listings: collection => tokenId => quantity.
    mapping(address => mapping(uint256 => uint256)) public custodied;
    /// @notice Withdrawable credits: account => token (address(0) = ETH) => amount.
    mapping(address => mapping(address => uint256)) public owed;
    /// @notice Sum of all owed credits per token.
    mapping(address => uint256) public totalOwed;

    // =========================================================================
    // Events
    // =========================================================================

    event ListingCreated(
        uint256 indexed listingId,
        address indexed seller,
        address indexed collection,
        uint256 tokenId,
        address payToken,
        uint256 unitPrice,
        uint256 quantity,
        uint16  feeBps
    );
    event ListingUpdated(uint256 indexed listingId, address indexed seller, uint256 unitPrice, uint256 quantity);
    event ListingClosed(uint256 indexed listingId, address indexed seller, uint256 returnedQuantity, CloseReason reason);
    event Purchased(
        uint256 indexed listingId,
        address indexed buyer,
        address indexed seller,
        uint256 quantity,
        address payToken,
        uint256 totalPaid
    );
    event SaleSettled(
        uint256 indexed listingId,
        uint256 sellerProceeds,
        address royaltyReceiver,
        uint256 royaltyAmount,
        address feeRecipient,
        uint256 platformFee
    );
    event Credited(address indexed account, address indexed token, uint256 amount);
    event Withdrawn(address indexed account, address indexed token, uint256 amount);
    event CollectionAllowed(address indexed collection, bool allowed);
    event PayTokenAllowed(address indexed token, bool allowed);
    event PlatformFeeUpdated(uint16 feeBps, address indexed feeRecipient);
    event EmergencyReturnFailed(uint256 indexed listingId, address indexed seller);
    event StrayERC1155Recovered(address indexed collection, uint256 indexed tokenId, address indexed to, uint256 amount);
    event StrayFundsRecovered(address indexed token, address indexed to, uint256 amount);

    // =========================================================================
    // Errors
    // =========================================================================

    error NotSeller();
    error ListingNotActive();
    error CollectionNotAllowed();
    error PayTokenNotAllowed();
    error ZeroAddress();
    error ZeroQuantity();
    error ZeroPrice();
    error InvalidAmount();
    error IncorrectPayment();
    error PriceAboveMax();
    error FeeTooHigh();
    error DepositMismatch();
    error UnsolicitedTransfer();
    error NothingOwed();
    error ExceedsStray();
    error EthTransferFailed();

    // =========================================================================
    // Constructor
    // =========================================================================

    /**
     * @param initialOwner Administrator (Agency wallet; later a Safe).
     * @param payTokens    ERC-20 payment tokens allowed at deployment (e.g. Base USDC). ETH is always allowed initially.
     * @param collections  ERC-1155 collections allowed at deployment (Decent supporter collections).
     */
    constructor(address initialOwner, address[] memory payTokens, address[] memory collections) Ownable(initialOwner) {
        feeRecipient = initialOwner;
        allowedPayToken[address(0)] = true;
        emit PayTokenAllowed(address(0), true);
        for (uint256 i = 0; i < payTokens.length; i++) _setPayToken(payTokens[i], true);
        for (uint256 i = 0; i < collections.length; i++) _setCollection(collections[i], true);
    }

    // =========================================================================
    // ERC-1155 receiver: only deposits this contract pulls itself are accepted
    // =========================================================================

    function onERC1155Received(address operator, address from, uint256 id, uint256 value, bytes memory data)
        public
        override
        returns (bytes4)
    {
        if (operator != address(this)) revert UnsolicitedTransfer();
        return super.onERC1155Received(operator, from, id, value, data);
    }

    function onERC1155BatchReceived(
        address operator,
        address from,
        uint256[] memory ids,
        uint256[] memory values,
        bytes memory data
    ) public override returns (bytes4) {
        if (operator != address(this)) revert UnsolicitedTransfer();
        return super.onERC1155BatchReceived(operator, from, ids, values, data);
    }

    // =========================================================================
    // Seller actions
    // =========================================================================

    /**
     * @notice List `quantity` editions for sale. The caller must first `setApprovalForAll(this, true)`
     *         on the collection; the editions move into custody.
     */
    function list(address collection, uint256 tokenId, uint256 quantity, address payToken, uint256 unitPrice)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 listingId)
    {
        if (!allowedCollection[collection]) revert CollectionNotAllowed();
        if (!allowedPayToken[payToken]) revert PayTokenNotAllowed();
        if (quantity == 0) revert ZeroQuantity();
        if (unitPrice == 0) revert ZeroPrice();

        listingId = nextListingId++;
        _listings[listingId] = Listing({
            seller: msg.sender,
            collection: collection,
            tokenId: tokenId,
            payToken: payToken,
            unitPrice: unitPrice,
            quantity: quantity,
            feeBps: platformFeeBps,
            active: true
        });
        _sellerListingIds[msg.sender].push(listingId);
        custodied[collection][tokenId] += quantity;

        emit ListingCreated(listingId, msg.sender, collection, tokenId, payToken, unitPrice, quantity, platformFeeBps);
        _pullEditions(collection, tokenId, msg.sender, quantity);
    }

    /**
     * @notice Change the unit price and/or the quantity in custody. Raising the quantity deposits more
     *         editions from the seller; lowering it returns the difference to the seller.
     */
    function update(uint256 listingId, uint256 newUnitPrice, uint256 newQuantity) external whenNotPaused nonReentrant {
        Listing storage l = _sellerListing(listingId);
        if (newUnitPrice == 0) revert ZeroPrice();
        if (newQuantity == 0) revert ZeroQuantity();

        uint256 oldQuantity = l.quantity;
        l.unitPrice = newUnitPrice;
        l.quantity = newQuantity;
        emit ListingUpdated(listingId, msg.sender, newUnitPrice, newQuantity);

        if (newQuantity > oldQuantity) {
            if (!allowedCollection[l.collection]) revert CollectionNotAllowed();
            uint256 added = newQuantity - oldQuantity;
            custodied[l.collection][l.tokenId] += added;
            _pullEditions(l.collection, l.tokenId, msg.sender, added);
        } else if (newQuantity < oldQuantity) {
            uint256 removed = oldQuantity - newQuantity;
            custodied[l.collection][l.tokenId] -= removed;
            IERC1155(l.collection).safeTransferFrom(address(this), msg.sender, l.tokenId, removed, "");
        }
    }

    /// @notice Close the listing and return every unsold edition to the seller. Works while paused.
    function delist(uint256 listingId) external nonReentrant {
        Listing storage l = _sellerListing(listingId);
        uint256 returned = l.quantity;
        _close(listingId, l, CloseReason.Delisted);
        IERC1155(l.collection).safeTransferFrom(address(this), l.seller, l.tokenId, returned, "");
    }

    // =========================================================================
    // Purchase
    // =========================================================================

    /// @notice Buy `quantity` editions of an ETH-priced listing. Send exactly unitPrice * quantity.
    function purchaseWithETH(uint256 listingId, uint256 quantity) external payable whenNotPaused nonReentrant {
        Listing storage l = _listings[listingId];
        if (l.payToken != address(0)) revert PayTokenNotAllowed();
        uint256 total = _beginPurchase(listingId, l, quantity);
        if (msg.value != total) revert IncorrectPayment();
        _finishPurchase(listingId, l, quantity, total);
    }

    /**
     * @notice Buy `quantity` editions of an ERC-20-priced listing. Approve this contract first.
     * @param maxTotal Protects the buyer from a seller price change landing first.
     */
    function purchaseWithToken(uint256 listingId, uint256 quantity, uint256 maxTotal)
        external
        whenNotPaused
        nonReentrant
    {
        Listing storage l = _listings[listingId];
        if (l.payToken == address(0)) revert PayTokenNotAllowed();
        uint256 total = _beginPurchase(listingId, l, quantity);
        if (total > maxTotal) revert PriceAboveMax();

        IERC20 token = IERC20(l.payToken);
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), total);
        if (token.balanceOf(address(this)) - before != total) revert DepositMismatch();

        _finishPurchase(listingId, l, quantity, total);
    }

    // =========================================================================
    // Pull payments
    // =========================================================================

    /// @notice Withdraw the caller's credits in `token` (address(0) = ETH). Works while paused.
    function withdraw(address token) external nonReentrant {
        _withdraw(msg.sender, token);
    }

    /// @notice Pay out `account`'s credits to `account` itself (lets anyone flush a royalty splitter).
    function withdrawFor(address account, address token) external nonReentrant {
        _withdraw(account, token);
    }

    // =========================================================================
    // Administration
    // =========================================================================

    function setCollectionAllowed(address collection, bool allowed) external onlyOwner {
        _setCollection(collection, allowed);
    }

    function setPayTokenAllowed(address token, bool allowed) external onlyOwner {
        _setPayToken(token, allowed);
    }

    /// @notice New listings snapshot this fee. A sale never charges more than its listing's snapshot.
    function setPlatformFee(uint16 feeBps, address recipient) external onlyOwner {
        if (feeBps > MAX_PLATFORM_FEE_BPS) revert FeeTooHigh();
        if (recipient == address(0)) revert ZeroAddress();
        platformFeeBps = feeBps;
        feeRecipient = recipient;
        emit PlatformFeeUpdated(feeBps, recipient);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Emergency path (while paused): return each listing's editions to its recorded seller.
     *         A seller that refuses the transfer keeps its listing and can still delist itself.
     */
    function emergencyReturn(uint256[] calldata listingIds) external onlyOwner whenPaused nonReentrant {
        for (uint256 i = 0; i < listingIds.length; i++) {
            uint256 id = listingIds[i];
            Listing storage l = _listings[id];
            if (!l.active) continue;
            uint256 qty = l.quantity;
            _close(id, l, CloseReason.EmergencyReturn);
            try IERC1155(l.collection).safeTransferFrom(address(this), l.seller, l.tokenId, qty, "") {
            } catch {
                l.active = true;
                l.quantity = qty;
                custodied[l.collection][l.tokenId] += qty;
                emit EmergencyReturnFailed(id, l.seller);
            }
        }
    }

    /// @notice Move ERC-1155 editions that no active listing accounts for.
    function recoverStrayERC1155(address collection, uint256 tokenId, uint256 amount, address to)
        external
        onlyOwner
        nonReentrant
    {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0 || amount > strayERC1155(collection, tokenId)) revert ExceedsStray();
        emit StrayERC1155Recovered(collection, tokenId, to, amount);
        IERC1155(collection).safeTransferFrom(address(this), to, tokenId, amount, "");
    }

    /// @notice Move ETH (token = address(0)) or ERC-20 that no owed credit accounts for.
    function recoverStrayFunds(address token, uint256 amount, address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0 || amount > strayFunds(token)) revert ExceedsStray();
        emit StrayFundsRecovered(token, to, amount);
        _send(token, to, amount);
    }

    // =========================================================================
    // Views
    // =========================================================================

    function getListing(uint256 listingId) external view returns (Listing memory) {
        return _listings[listingId];
    }

    function sellerListingIds(address seller) external view returns (uint256[] memory) {
        return _sellerListingIds[seller];
    }

    /**
     * @notice Sale breakdown for `quantity` editions at current settings (for the Sell/Buy previews).
     */
    function quote(uint256 listingId, uint256 quantity)
        public
        view
        returns (uint256 total, uint256 sellerProceeds, address royaltyReceiver, uint256 royaltyAmount, uint256 platformFee)
    {
        Listing storage l = _listings[listingId];
        total = l.unitPrice * quantity;
        (sellerProceeds, royaltyReceiver, royaltyAmount, platformFee) = _split(l, total);
    }

    /// @notice ERC-2981 royalty honoured for a sale, clipped to MAX_ROYALTY_BPS. Zero if unsupported.
    function royaltyFor(address collection, uint256 tokenId, uint256 salePrice)
        public
        view
        returns (address receiver, uint256 amount)
    {
        if (!ERC165Checker.supportsInterface(collection, type(IERC2981).interfaceId)) return (address(0), 0);
        try IERC2981(collection).royaltyInfo(tokenId, salePrice) returns (address r, uint256 a) {
            if (r == address(0) || a == 0) return (address(0), 0);
            uint256 cap = (salePrice * MAX_ROYALTY_BPS) / BPS_DENOMINATOR;
            return (r, a > cap ? cap : a);
        } catch {
            return (address(0), 0);
        }
    }

    function strayERC1155(address collection, uint256 tokenId) public view returns (uint256) {
        uint256 held = IERC1155(collection).balanceOf(address(this), tokenId);
        uint256 reserved = custodied[collection][tokenId];
        return held > reserved ? held - reserved : 0;
    }

    function strayFunds(address token) public view returns (uint256) {
        uint256 held = token == address(0) ? address(this).balance : IERC20(token).balanceOf(address(this));
        uint256 reserved = totalOwed[token];
        return held > reserved ? held - reserved : 0;
    }

    // =========================================================================
    // Internal
    // =========================================================================

    function _sellerListing(uint256 listingId) private view returns (Listing storage l) {
        l = _listings[listingId];
        if (!l.active) revert ListingNotActive();
        if (l.seller != msg.sender) revert NotSeller();
    }

    function _pullEditions(address collection, uint256 tokenId, address from, uint256 quantity) private {
        uint256 before = IERC1155(collection).balanceOf(address(this), tokenId);
        IERC1155(collection).safeTransferFrom(from, address(this), tokenId, quantity, "");
        if (IERC1155(collection).balanceOf(address(this), tokenId) - before != quantity) revert DepositMismatch();
    }

    function _close(uint256 listingId, Listing storage l, CloseReason reason) private {
        uint256 qty = l.quantity;
        l.active = false;
        l.quantity = 0;
        custodied[l.collection][l.tokenId] -= qty;
        emit ListingClosed(listingId, l.seller, qty, reason);
    }

    function _beginPurchase(uint256 listingId, Listing storage l, uint256 quantity) private returns (uint256 total) {
        if (!l.active) revert ListingNotActive();
        if (!allowedCollection[l.collection]) revert CollectionNotAllowed();
        if (!allowedPayToken[l.payToken]) revert PayTokenNotAllowed();
        if (quantity == 0 || quantity > l.quantity) revert InvalidAmount();

        total = l.unitPrice * quantity;
        l.quantity -= quantity;
        custodied[l.collection][l.tokenId] -= quantity;
        if (l.quantity == 0) {
            l.active = false;
            emit ListingClosed(listingId, l.seller, 0, CloseReason.SoldOut);
        }
    }

    function _finishPurchase(uint256 listingId, Listing storage l, uint256 quantity, uint256 total) private {
        (uint256 sellerProceeds, address royaltyReceiver, uint256 royaltyAmount, uint256 platformFee) =
            _split(l, total);
        address payToken = l.payToken;
        address fees = feeRecipient;

        _credit(l.seller, payToken, sellerProceeds);
        _credit(royaltyReceiver, payToken, royaltyAmount);
        _credit(fees, payToken, platformFee);

        emit Purchased(listingId, msg.sender, l.seller, quantity, payToken, total);
        emit SaleSettled(listingId, sellerProceeds, royaltyReceiver, royaltyAmount, fees, platformFee);

        IERC1155(l.collection).safeTransferFrom(address(this), msg.sender, l.tokenId, quantity, "");
    }

    function _split(Listing storage l, uint256 total)
        private
        view
        returns (uint256 sellerProceeds, address royaltyReceiver, uint256 royaltyAmount, uint256 platformFee)
    {
        (royaltyReceiver, royaltyAmount) = royaltyFor(l.collection, l.tokenId, total);
        uint256 feeBps = l.feeBps < platformFeeBps ? l.feeBps : platformFeeBps;
        platformFee = (total * feeBps) / BPS_DENOMINATOR;
        // Rounding remainders always stay with the seller.
        sellerProceeds = total - royaltyAmount - platformFee;
    }

    function _credit(address account, address token, uint256 amount) private {
        if (amount == 0) return;
        owed[account][token] += amount;
        totalOwed[token] += amount;
        emit Credited(account, token, amount);
    }

    function _withdraw(address account, address token) private {
        uint256 amount = owed[account][token];
        if (amount == 0) revert NothingOwed();
        owed[account][token] = 0;
        totalOwed[token] -= amount;
        emit Withdrawn(account, token, amount);
        _send(token, account, amount);
    }

    function _send(address token, address to, uint256 amount) private {
        if (token == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            if (!ok) revert EthTransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    function _setCollection(address collection, bool allowed) private {
        if (collection == address(0)) revert ZeroAddress();
        allowedCollection[collection] = allowed;
        emit CollectionAllowed(collection, allowed);
    }

    function _setPayToken(address token, bool allowed) private {
        allowedPayToken[token] = allowed;
        emit PayTokenAllowed(token, allowed);
    }
}
