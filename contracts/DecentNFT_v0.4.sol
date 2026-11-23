// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./DecentNFT_v0.3.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import "@openzeppelin/contracts/utils/TransientSlot.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/**
 * @title DecentNFT_v0.4
 * @notice DecentNFT v0.3 (Product/Achievement lanes, Multicall, owner batch) plus
 *         self-service creator permissions for community Supporter releases.
 *
 * Creator lane
 * ------------
 *   CREATOR_ROLE wallets, authorized by the admin with per-creator limits, can
 *   register and mint their OWN Product tokens. Each creator product:
 *     - records the creator in `creatorOf`, `TokenRegistered.creator` and
 *       `EditionMinted.minter`;
 *     - is minted to the creator, except for an explicitly selected gift to
 *       the configured Agency recipient (no arbitrary recipients);
 *     - has a finite supply within the creator's edition limit;
 *     - has a mandatory per-token ERC-2981 royalty capped by `creatorRoyaltyCapBps`
 *       (the receiver may be a split contract for multi-artist payouts);
 *     - is locked against admin minting, admin royalty changes and admin URI
 *       changes, so the admin cannot mint as or impersonate the creator.
 *   Creators cannot grant/revoke roles, register Achievement tokens or mint any
 *   product they did not register. Atomic creator batches use `multicall`.
 *
 * Emergency controls
 * ------------------
 *   PAUSER_ROLE (or the admin) can pause all minting and creator self-service.
 *   Only the admin unpauses. Transfers of existing tokens are never paused.
 *   The contract has no payable entry points, but stray ERC-20/ERC-721 tokens or
 *   forced ETH can be recovered by the admin. Recovery cannot touch this
 *   collection's own tokens.
 */
contract DecentNFT_v0_4 is DecentNFT_v0_3, Pausable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;
    using TransientSlot for *;

    bytes32 public constant CREATOR_ROLE = keccak256("CREATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Hard ceiling for the admin-configurable creator royalty cap (25 %).
    uint96 public constant MAX_CREATOR_ROYALTY_BPS = 2_500;

    // Transient authorization windows are consumed before any receiver callback.
    bytes32 private constant REGISTERING_CREATOR_SLOT =
        keccak256("decentnft.v0_4.registeringCreator");
    bytes32 private constant MINTING_CREATOR_SLOT =
        keccak256("decentnft.v0_4.mintingCreator");

    struct CreatorLimits {
        uint64 maxProducts;           // Products this creator may register
        uint64 maxEditionsPerProduct; // Upper bound for each product's maxSupply
        uint64 productsRegistered;    // Lifetime count (not refunded on revoke)
    }

    /// @notice Royalty cap (basis points) applied to new creator products.
    uint96 public creatorRoyaltyCapBps;

    /// @notice Approved recipient for optional edition gifts; zero disables gifts.
    address public editionGiftRecipient;

    mapping(address => CreatorLimits) private _creatorLimits;
    mapping(uint256 => address) private _productCreator;

    event CreatorAuthorized(address indexed creator, uint64 maxProducts, uint64 maxEditionsPerProduct);
    event CreatorRevoked(address indexed creator);
    event CreatorProductRegistered(
        uint256 indexed tokenId,
        address indexed creator,
        address indexed royaltyReceiver,
        uint96 royaltyFeeBps,
        uint256 maxSupply
    );
    event CreatorRoyaltyCapUpdated(uint96 capBps);
    event EditionGiftRecipientUpdated(address indexed recipient);
    event CreatorEditionsGifted(
        uint256 indexed tokenId,
        address indexed creator,
        address indexed recipient,
        uint256 amount
    );
    event Recovered(address indexed asset, address indexed to, uint256 amountOrTokenId);

    error CreatorProductLocked(uint256 tokenId);
    error NotProductCreator(uint256 tokenId, address account);
    error CreatorLimitReached(address creator);
    error InvalidCreatorSupply(uint256 maxSupply, uint256 limit);
    error InvalidCreatorRoyalty(address receiver, uint96 feeBps, uint96 capBps);
    error RoyaltyCapTooHigh(uint96 capBps);
    error MetadataURIRequired();
    error ZeroAmount();
    error ZeroAddress();
    error InvalidGiftRecipient();
    error GiftRecipientMismatch(address expected, address configured);
    error CannotRecoverCollectionTokens();

    constructor(
        string memory baseURI_,
        address royaltyReceiver,
        uint96 royaltyFeeBps,
        uint96 creatorRoyaltyCapBps_
    ) DecentNFT_v0_3(baseURI_, royaltyReceiver, royaltyFeeBps) {
        _setCreatorRoyaltyCap(creatorRoyaltyCapBps_);
        _grantRole(PAUSER_ROLE, msg.sender);
    }

    // -------------------------------------------------------------------------
    // Creator administration (DEFAULT_ADMIN_ROLE)
    // -------------------------------------------------------------------------

    /**
     * @notice Grant CREATOR_ROLE and set per-creator limits. Calling again updates
     *         the limits; the lifetime registered count is preserved.
     *         A creator granted the role via `grantRole` alone has zero limits.
     */
    function authorizeCreator(address creator, uint64 maxProducts, uint64 maxEditionsPerProduct)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (creator == address(0)) revert ZeroAddress();
        CreatorLimits storage limits = _creatorLimits[creator];
        limits.maxProducts = maxProducts;
        limits.maxEditionsPerProduct = maxEditionsPerProduct;
        _grantRole(CREATOR_ROLE, creator);
        emit CreatorAuthorized(creator, maxProducts, maxEditionsPerProduct);
    }

    /// @notice Revoke a creator. Their existing products stay theirs and stay locked.
    function revokeCreator(address creator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        CreatorLimits storage limits = _creatorLimits[creator];
        limits.maxProducts = 0;
        limits.maxEditionsPerProduct = 0;
        _revokeRole(CREATOR_ROLE, creator);
        emit CreatorRevoked(creator);
    }

    function setCreatorRoyaltyCap(uint96 capBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setCreatorRoyaltyCap(capBps);
    }

    /// @notice Set the Agency gift recipient, or zero to disable edition gifts.
    function setEditionGiftRecipient(address recipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (recipient == address(this)) revert InvalidGiftRecipient();
        editionGiftRecipient = recipient;
        emit EditionGiftRecipientUpdated(recipient);
    }

    function pause() external {
        if (!hasRole(PAUSER_ROLE, _msgSender())) _checkRole(DEFAULT_ADMIN_ROLE);
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // -------------------------------------------------------------------------
    // Creator self-service (CREATOR_ROLE)
    // -------------------------------------------------------------------------

    /**
     * @notice Register a new Product owned by the caller and mint `amount`
     *         editions to the caller.
     * @param amount          Editions minted now (> 0).
     * @param maxSupply_      Finite supply, 1..maxEditionsPerProduct.
     * @param tokenURI_       Required per-token metadata URI (e.g. `ipfs://<CID>`).
     * @param royaltyReceiver Non-zero ERC-2981 receiver (wallet or split contract).
     * @param royaltyFeeBps   Royalty, at most `creatorRoyaltyCapBps`.
     */
    function registerAndMintProduct(
        uint256 amount,
        uint256 maxSupply_,
        string calldata tokenURI_,
        address royaltyReceiver,
        uint96 royaltyFeeBps
    ) external whenNotPaused nonReentrant onlyRole(CREATOR_ROLE) returns (uint256 tokenId) {
        return _registerAndMintProduct(amount, maxSupply_, tokenURI_, royaltyReceiver, royaltyFeeBps, address(0));
    }

    /**
     * @notice Register and mint with an explicit gift of floor(amount / 10) editions.
     *         The gift is included in `amount`, not added to it.
     * @param expectedRecipient The configured Agency recipient shown to the creator.
     *         Reverts if the recipient was changed or disabled.
     */
    function registerAndMintProductWithGift(
        uint256 amount,
        uint256 maxSupply_,
        string calldata tokenURI_,
        address royaltyReceiver,
        uint96 royaltyFeeBps,
        address expectedRecipient
    ) external whenNotPaused nonReentrant onlyRole(CREATOR_ROLE) returns (uint256 tokenId) {
        _checkGiftRecipient(expectedRecipient);
        return _registerAndMintProduct(amount, maxSupply_, tokenURI_, royaltyReceiver, royaltyFeeBps, expectedRecipient);
    }

    function _registerAndMintProduct(
        uint256 amount,
        uint256 maxSupply_,
        string calldata tokenURI_,
        address royaltyReceiver,
        uint96 royaltyFeeBps,
        address giftRecipient
    ) private returns (uint256 tokenId) {
        address creator = _msgSender();
        if (amount == 0) revert ZeroAmount();
        if (bytes(tokenURI_).length == 0) revert MetadataURIRequired();
        _checkCreatorRoyalty(royaltyReceiver, royaltyFeeBps);

        CreatorLimits storage limits = _creatorLimits[creator];
        if (limits.productsRegistered >= limits.maxProducts) revert CreatorLimitReached(creator);
        if (maxSupply_ == 0 || maxSupply_ > limits.maxEditionsPerProduct) {
            revert InvalidCreatorSupply(maxSupply_, limits.maxEditionsPerProduct);
        }
        limits.productsRegistered += 1;

        // Delegatecall preserves msg.sender, so v0.2's registerToken records the
        // creator in storage and in TokenRegistered. The admin check is bypassed
        // only for this exact selector, caller and (external-call-free) window.
        REGISTERING_CREATOR_SLOT.asAddress().tstore(creator);
        bytes memory registration = Address.functionDelegateCall(
            address(this),
            abi.encodeCall(this.registerToken, (
                maxSupply_, tokenURI_, TokenKind.Product, royaltyReceiver, royaltyFeeBps
            ))
        );
        REGISTERING_CREATOR_SLOT.asAddress().tstore(address(0));
        tokenId = abi.decode(registration, (uint256));
        _productCreator[tokenId] = creator;
        emit CreatorProductRegistered(tokenId, creator, royaltyReceiver, royaltyFeeBps, maxSupply_);

        _creatorMint(creator, tokenId, amount, giftRecipient);
    }

    /// @notice Mint more editions of the caller's own product, to the caller.
    function mintCreatorProduct(uint256 tokenId, uint256 amount)
        external
        whenNotPaused
        nonReentrant
        onlyRole(CREATOR_ROLE)
    {
        address creator = _msgSender();
        if (_productCreator[tokenId] != creator) revert NotProductCreator(tokenId, creator);
        _creatorMint(creator, tokenId, amount, address(0));
    }

    /// @notice Mint more of the caller's own product with an explicit edition gift.
    function mintCreatorProductWithGift(uint256 tokenId, uint256 amount, address expectedRecipient)
        external
        whenNotPaused
        nonReentrant
        onlyRole(CREATOR_ROLE)
    {
        address creator = _msgSender();
        if (_productCreator[tokenId] != creator) revert NotProductCreator(tokenId, creator);
        _checkGiftRecipient(expectedRecipient);
        _creatorMint(creator, tokenId, amount, expectedRecipient);
    }

    /// @notice Move the caller's own product royalty (e.g. to a split contract), within the cap.
    function setCreatorProductRoyalty(uint256 tokenId, address receiver, uint96 feeBps)
        external
        nonReentrant
        onlyRole(CREATOR_ROLE)
    {
        address creator = _msgSender();
        if (_productCreator[tokenId] != creator) revert NotProductCreator(tokenId, creator);
        _checkCreatorRoyalty(receiver, feeBps);
        REGISTERING_CREATOR_SLOT.asAddress().tstore(creator);
        _setTokenRoyalty(tokenId, receiver, feeBps);
        REGISTERING_CREATOR_SLOT.asAddress().tstore(address(0));
    }

    // -------------------------------------------------------------------------
    // Admin recovery of stray assets (never this collection's tokens)
    // -------------------------------------------------------------------------

    function recoverERC20(address token, address to, uint256 amount)
        external
        nonReentrant
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _checkRecovery(token, to);
        IERC20(token).safeTransfer(to, amount);
        emit Recovered(token, to, amount);
    }

    function recoverERC721(address token, uint256 tokenId, address to)
        external
        nonReentrant
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _checkRecovery(token, to);
        IERC721(token).transferFrom(address(this), to, tokenId);
        emit Recovered(token, to, tokenId);
    }

    /// @notice Recover ETH force-sent to the contract (it has no payable entry points).
    function recoverETH(address payable to, uint256 amount)
        external
        nonReentrant
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (to == address(0)) revert ZeroAddress();
        Address.sendValue(to, amount);
        emit Recovered(address(0), to, amount);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /// @notice Creator for creator-lane products; zero for admin-registered tokens.
    function productCreator(uint256 tokenId) external view returns (address) {
        return _productCreator[tokenId];
    }

    function creatorLimits(address creator)
        external
        view
        returns (uint64 maxProducts, uint64 maxEditionsPerProduct, uint64 productsRegistered)
    {
        CreatorLimits memory limits = _creatorLimits[creator];
        return (limits.maxProducts, limits.maxEditionsPerProduct, limits.productsRegistered);
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    function _creatorMint(address creator, uint256 tokenId, uint256 amount, address giftRecipient) private {
        uint256 gifted = giftRecipient == address(0) ? 0 : amount / 10;
        _mintCreatorEdition(creator, creator, tokenId, amount - gifted);
        if (gifted > 0) _mintCreatorEdition(creator, giftRecipient, tokenId, gifted);
        if (giftRecipient != address(0)) emit CreatorEditionsGifted(tokenId, creator, giftRecipient, gifted);
    }

    function _mintCreatorEdition(address creator, address to, uint256 tokenId, uint256 amount) private {
        MINTING_CREATOR_SLOT.asAddress().tstore(creator);
        _mintChecked(to, tokenId, amount);
        MINTING_CREATOR_SLOT.asAddress().tstore(address(0));
    }

    function _checkGiftRecipient(address expected) private view {
        address configured = editionGiftRecipient;
        if (expected == address(0) || expected != configured) revert GiftRecipientMismatch(expected, configured);
    }

    function _checkCreatorRoyalty(address receiver, uint96 feeBps) private view {
        if (receiver == address(0) || feeBps > creatorRoyaltyCapBps) {
            revert InvalidCreatorRoyalty(receiver, feeBps, creatorRoyaltyCapBps);
        }
    }

    function _checkRecovery(address token, address to) private view {
        if (to == address(0) || token == address(0)) revert ZeroAddress();
        if (token == address(this)) revert CannotRecoverCollectionTokens();
    }

    function _setCreatorRoyaltyCap(uint96 capBps) private {
        if (capBps > MAX_CREATOR_ROYALTY_BPS) revert RoyaltyCapTooHigh(capBps);
        creatorRoyaltyCapBps = capBps;
        emit CreatorRoyaltyCapUpdated(capBps);
    }

    /// @dev Admin-gated v0.2 functions are not virtual, so creator locks live in hooks.
    function _checkRole(bytes32 role, address account) internal view override {
        if (role == DEFAULT_ADMIN_ROLE) {
            if (
                msg.sig == this.registerToken.selector &&
                account != address(0) &&
                account == REGISTERING_CREATOR_SLOT.asAddress().tload()
            ) return;
            super._checkRole(role, account);
            // Inside multicall the delegatecalled frame sees the inner calldata.
            if (msg.sig == this.setTokenURI.selector && msg.data.length >= 36) {
                uint256 tokenId = uint256(bytes32(msg.data[4:36]));
                if (_productCreator[tokenId] != address(0)) revert CreatorProductLocked(tokenId);
            }
            return;
        }
        super._checkRole(role, account);
    }

    function _setTokenRoyalty(uint256 tokenId, address receiver, uint96 feeNumerator)
        internal
        override
    {
        address creator = _productCreator[tokenId];
        if (creator != address(0) && creator != REGISTERING_CREATOR_SLOT.asAddress().tload()) {
            revert CreatorProductLocked(tokenId);
        }
        super._setTokenRoyalty(tokenId, receiver, feeNumerator);
    }

    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override
    {
        if (from == address(0)) {
            _requireNotPaused();
            address minting = MINTING_CREATOR_SLOT.asAddress().tload();
            for (uint256 i = 0; i < ids.length; i++) {
                address creator = _productCreator[ids[i]];
                if (creator != address(0) && (creator != minting || _msgSender() != creator)) {
                    revert CreatorProductLocked(ids[i]);
                }
            }
            if (minting != address(0)) MINTING_CREATOR_SLOT.asAddress().tstore(address(0));
        }
        super._update(from, to, ids, values);
    }
}
