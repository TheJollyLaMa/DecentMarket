// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Experimental Base booking custody. An administrator can recover every
/// booking's assets, including reserved assets; this is not trustless custody.
contract LivePerformanceAssetsEscrow is AccessControl, ERC1155Holder, ReentrancyGuard {
    using SafeERC20 for IERC20;
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    enum FeeStatus { None, Funded, Approved, Paid, Refunding, Refunded, Recovered }
    enum GiftStatus { None, Reserved, Approved, Returning, Received, Returned, Recovered }

    struct Terms {
        address performer;
        address asset; // address(0) is Base ETH
        uint256 amount;
        uint64 showStart;
        uint64 showEnd;
        uint32 reviewWindow;
        bytes32 termsHash;
        address collection;
        uint256 tokenId;
        uint256 quantity;
        address giftTreasury;
    }
    struct Booking {
        Terms terms;
        address funder;
        FeeStatus feeStatus;
        GiftStatus giftStatus;
    }
    mapping(bytes32 => Booking) private _bookings;
    mapping(address => bool) public approvedTokens;
    mapping(address => uint256) public feeLiability;
    mapping(address => mapping(uint256 => uint256)) public giftLiability;
    event TokenApproval(address indexed token, bool approved);
    event Funded(bytes32 indexed bookingId, address indexed performer, address indexed funder, Terms terms, string termsUri);
    event FeeDecision(bytes32 indexed bookingId, FeeStatus status, string reasonUri);
    event FeeSettled(bytes32 indexed bookingId, FeeStatus status, address indexed recipient, uint256 amount);
    event GiftDecision(bytes32 indexed bookingId, GiftStatus status, string reasonUri);
    event GiftSettled(bytes32 indexed bookingId, GiftStatus status, address indexed recipient, address collection, uint256 tokenId, uint256 quantity);
    event Recovery(bytes32 indexed bookingId, address indexed recipient, bool fee, bool gift, string reasonUri);
    event SurplusRecovered(address indexed asset, uint256 indexed tokenId, address indexed recipient, uint256 amount, bool nft, string reasonUri);

    error InvalidBooking();
    error InvalidState();
    error InvalidTime();
    error UnsupportedToken();
    error TransferFailed();

    constructor(address admin, address usdc) {
        if (block.chainid != 8453 || admin == address(0) || usdc.code.length == 0) revert InvalidBooking();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        approvedTokens[usdc] = true;
        emit TokenApproval(usdc, true);
    }

    function bookings(bytes32 id) external view returns (Booking memory) { return _bookings[id]; }

    function setTokenApproval(address token, bool allowed) external onlyRole(ADMIN_ROLE) {
        if (token == address(0) || (allowed && token.code.length == 0)) revert InvalidBooking();
        approvedTokens[token] = allowed;
        emit TokenApproval(token, allowed);
    }

    /// @dev The gift is physically transferred from the funder, never counted
    /// from a marketplace's listed balance or an unsolicited vault deposit.
    function createBooking(bytes32 id, Terms calldata t, string calldata termsUri)
        external payable onlyRole(ADMIN_ROLE) nonReentrant
    {
        if (id == bytes32(0) || _bookings[id].feeStatus != FeeStatus.None ||
            t.performer == address(0) || t.amount == 0 || t.termsHash == bytes32(0) ||
            bytes(termsUri).length == 0 || bytes(termsUri).length > 2048 ||
            t.showStart <= block.timestamp || t.showEnd <= t.showStart || t.reviewWindow == 0 ||
            (t.collection == address(0) ? (t.quantity != 0 || t.tokenId != 0 || t.giftTreasury != address(0)) :
                (t.collection.code.length == 0 || t.quantity == 0 || t.giftTreasury == address(0)))) revert InvalidBooking();
        if (t.asset == address(0)) {
            if (msg.value != t.amount) revert InvalidBooking();
        } else {
            if (msg.value != 0 || !approvedTokens[t.asset]) revert UnsupportedToken();
            uint256 beforeBalance = IERC20(t.asset).balanceOf(address(this));
            IERC20(t.asset).safeTransferFrom(msg.sender, address(this), t.amount);
            if (IERC20(t.asset).balanceOf(address(this)) - beforeBalance != t.amount) revert UnsupportedToken();
        }
        Booking storage b = _bookings[id];
        b.terms = t;
        b.funder = msg.sender;
        b.feeStatus = FeeStatus.Funded;
        feeLiability[t.asset] += t.amount;
        if (t.collection != address(0)) {
            b.giftStatus = GiftStatus.Reserved;
            uint256 beforeBalance = IERC1155(t.collection).balanceOf(address(this), t.tokenId);
            IERC1155(t.collection).safeTransferFrom(msg.sender, address(this), t.tokenId, t.quantity, "");
            if (IERC1155(t.collection).balanceOf(address(this), t.tokenId) - beforeBalance != t.quantity) revert InvalidBooking();
            giftLiability[t.collection][t.tokenId] += t.quantity;
        }
        emit Funded(id, t.performer, msg.sender, t, termsUri);
    }

    /// @notice Explicit performance approval unlocks the gift, not payment delivery.
    function approvePerformance(bytes32 id, string calldata reportUri) external onlyRole(ADMIN_ROLE) nonReentrant {
        Booking storage b = _bookings[id];
        _reason(reportUri);
        if (block.timestamp < b.terms.showEnd ||
            (b.feeStatus != FeeStatus.Funded && !(b.feeStatus == FeeStatus.Paid && b.giftStatus == GiftStatus.Reserved))) revert InvalidState();
        if (b.feeStatus == FeeStatus.Funded) {
            b.feeStatus = FeeStatus.Approved;
            emit FeeDecision(id, b.feeStatus, reportUri);
        }
        if (b.giftStatus == GiftStatus.Reserved) {
            b.giftStatus = GiftStatus.Approved;
            emit GiftDecision(id, b.giftStatus, reportUri);
        }
    }

    /// @notice A platform or rehearsal fault does not reduce the guaranteed fee.
    function platformFault(bytes32 id, string calldata reasonUri) external onlyRole(ADMIN_ROLE) nonReentrant {
        Booking storage b = _bookings[id];
        _reason(reasonUri);
        if (b.feeStatus != FeeStatus.Funded) revert InvalidState();
        b.feeStatus = FeeStatus.Approved;
        emit FeeDecision(id, b.feeStatus, reasonUri);
        _returnGift(id, b, reasonUri);
    }

    function performerCancel(bytes32 id, string calldata reasonUri) external nonReentrant {
        Booking storage b = _bookings[id];
        _reason(reasonUri);
        if (msg.sender != b.terms.performer || b.feeStatus != FeeStatus.Funded) revert InvalidState();
        if (block.timestamp >= b.terms.showStart) revert InvalidTime();
        _refundDecision(id, b, reasonUri);
    }

    function noShow(bytes32 id, string calldata reasonUri) external onlyRole(ADMIN_ROLE) nonReentrant {
        Booking storage b = _bookings[id];
        _reason(reasonUri);
        if (b.feeStatus != FeeStatus.Funded) revert InvalidState();
        if (block.timestamp < b.terms.showEnd || block.timestamp >= uint256(b.terms.showEnd) + b.terms.reviewWindow) revert InvalidTime();
        _refundDecision(id, b, reasonUri);
    }

    /// @notice An unperformed gift can be returned only after the review boundary
    /// (showEnd + reviewWindow) without undoing an already vested or paid monetary
    /// fee. During review, use approvePerformance, noShow or platformFault.
    function markUnperformedGift(bytes32 id, string calldata reasonUri) external onlyRole(ADMIN_ROLE) nonReentrant {
        Booking storage b = _bookings[id];
        _reason(reasonUri);
        if (b.giftStatus != GiftStatus.Reserved) revert InvalidState();
        if (block.timestamp < uint256(b.terms.showEnd) + b.terms.reviewWindow) revert InvalidTime();
        _returnGift(id, b, reasonUri);
    }

    function _refundDecision(bytes32 id, Booking storage b, string calldata reasonUri) private {
        b.feeStatus = FeeStatus.Refunding;
        emit FeeDecision(id, b.feeStatus, reasonUri);
        _returnGift(id, b, reasonUri);
    }
    function _returnGift(bytes32 id, Booking storage b, string calldata reasonUri) private {
        if (b.giftStatus == GiftStatus.Reserved) {
            b.giftStatus = GiftStatus.Returning;
            emit GiftDecision(id, b.giftStatus, reasonUri);
        }
    }

    function claim(bytes32 id) external nonReentrant {
        Booking storage b = _bookings[id];
        if (msg.sender != b.terms.performer) revert InvalidState();
        if (block.timestamp < b.terms.showEnd) revert InvalidTime();
        if (b.feeStatus == FeeStatus.Funded) {
            if (block.timestamp < uint256(b.terms.showEnd) + b.terms.reviewWindow) revert InvalidTime();
        } else if (b.feeStatus != FeeStatus.Approved) revert InvalidState();
        b.feeStatus = FeeStatus.Paid;
        feeLiability[b.terms.asset] -= b.terms.amount;
        _pay(b.terms.asset, b.terms.performer, b.terms.amount);
        emit FeeSettled(id, b.feeStatus, b.terms.performer, b.terms.amount);
    }
    function refund(bytes32 id) external nonReentrant {
        Booking storage b = _bookings[id];
        if (b.feeStatus != FeeStatus.Refunding) revert InvalidState();
        b.feeStatus = FeeStatus.Refunded;
        feeLiability[b.terms.asset] -= b.terms.amount;
        _pay(b.terms.asset, b.funder, b.terms.amount);
        emit FeeSettled(id, b.feeStatus, b.funder, b.terms.amount);
    }
    function releaseGift(bytes32 id) external onlyRole(ADMIN_ROLE) nonReentrant {
        Booking storage b = _bookings[id];
        if (b.giftStatus != GiftStatus.Approved) revert InvalidState();
        b.giftStatus = GiftStatus.Received;
        giftLiability[b.terms.collection][b.terms.tokenId] -= b.terms.quantity;
        _gift(id, b, b.terms.performer);
    }
    function returnGift(bytes32 id) external nonReentrant {
        Booking storage b = _bookings[id];
        if (b.giftStatus != GiftStatus.Returning) revert InvalidState();
        b.giftStatus = GiftStatus.Returned;
        giftLiability[b.terms.collection][b.terms.tokenId] -= b.terms.quantity;
        _gift(id, b, b.terms.giftTreasury);
    }

    /// @notice Administrator can recover reserved or earned assets; events and
    /// terminal statuses expose the resulting shortfall rather than hiding it.
    function recover(bytes32 id, address recipient, bool fee, bool gift, string calldata reasonUri)
        external onlyRole(ADMIN_ROLE) nonReentrant
    {
        Booking storage b = _bookings[id];
        _reason(reasonUri);
        if (recipient == address(0) || (!fee && !gift)) revert InvalidBooking();
        if (fee) {
            if (b.feeStatus != FeeStatus.Funded && b.feeStatus != FeeStatus.Approved && b.feeStatus != FeeStatus.Refunding) revert InvalidState();
            b.feeStatus = FeeStatus.Recovered;
            feeLiability[b.terms.asset] -= b.terms.amount;
            _pay(b.terms.asset, recipient, b.terms.amount);
        }
        if (gift) {
            if (b.giftStatus != GiftStatus.Reserved && b.giftStatus != GiftStatus.Approved && b.giftStatus != GiftStatus.Returning) revert InvalidState();
            b.giftStatus = GiftStatus.Recovered;
            giftLiability[b.terms.collection][b.terms.tokenId] -= b.terms.quantity;
            _gift(id, b, recipient);
        }
        emit Recovery(id, recipient, fee, gift, reasonUri);
    }
    function recoverSurplus(address asset, uint256 tokenId, address recipient, uint256 amount, bool nft, string calldata reasonUri)
        external onlyRole(ADMIN_ROLE) nonReentrant
    {
        _reason(reasonUri);
        if (recipient == address(0) || amount == 0) revert InvalidBooking();
        if (nft) {
            if (asset == address(0) || IERC1155(asset).balanceOf(address(this), tokenId) < giftLiability[asset][tokenId] + amount) revert InvalidState();
            IERC1155(asset).safeTransferFrom(address(this), recipient, tokenId, amount, "");
        } else {
            if (tokenId != 0) revert InvalidBooking();
            uint256 balance = asset == address(0) ? address(this).balance : IERC20(asset).balanceOf(address(this));
            if (balance < feeLiability[asset] + amount) revert InvalidState();
            _pay(asset, recipient, amount);
        }
        emit SurplusRecovered(asset, tokenId, recipient, amount, nft, reasonUri);
    }
    function _pay(address asset, address recipient, uint256 amount) private {
        if (asset == address(0)) {
            (bool ok,) = payable(recipient).call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else IERC20(asset).safeTransfer(recipient, amount);
    }
    function _gift(bytes32 id, Booking storage b, address recipient) private {
        Terms storage t = b.terms;
        IERC1155(t.collection).safeTransferFrom(address(this), recipient, t.tokenId, t.quantity, "");
        emit GiftSettled(id, b.giftStatus, recipient, t.collection, t.tokenId, t.quantity);
    }
    function _reason(string calldata reasonUri) private pure {
        if (bytes(reasonUri).length == 0 || bytes(reasonUri).length > 2048) revert InvalidBooking();
    }
    function supportsInterface(bytes4 interfaceId) public view override(AccessControl, ERC1155Holder) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
