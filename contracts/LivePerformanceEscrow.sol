// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Per-booking USDC custody. Deployment and policy approval are separate operations.
contract LivePerformanceEscrow is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    IERC20 public immutable usdc;
    enum Status { None, Funded, Approved, Paid, Refunded }
    struct Booking {
        address performer;
        address funder;
        uint256 amount;
        uint256 payoutAmount;
        uint64 showStart;
        uint64 showEnd;
        uint64 claimDeadline;
        uint32 reviewWindow;
        uint32 cancellationWindow;
        uint16 killFeeBps;
        bytes32 termsHash;
        Status status;
    }
    mapping(bytes32 => Booking) private _bookings;
    event BookingFunded(bytes32 indexed bookingId, address indexed performer, address indexed funder, uint256 amount, bytes32 termsHash, string termsUri);
    event PerformanceApproved(bytes32 indexed bookingId, uint16 payoutBps, uint256 payoutAmount, uint256 refundAmount, string reportUri, bytes32 termsHash);
    event PerformancePaid(bytes32 indexed bookingId, address indexed performer, uint256 amount, bytes32 termsHash);
    event BookingRefunded(bytes32 indexed bookingId, address indexed funder, uint256 amount, string reasonUri, bytes32 termsHash);
    event BookingCancelled(bytes32 indexed bookingId, uint256 killFee, string reasonUri, bytes32 termsHash);
    error InvalidBooking();
    error InvalidState();
    error InvalidTime();
    error PerformerOnly();
    error InvalidReport();
    error UnsupportedToken();

    constructor(address token, address admin) {
        if (token == address(0) || token.code.length == 0 || admin == address(0)) revert InvalidBooking();
        usdc = IERC20(token);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
    }
    function bookings(bytes32 bookingId) external view returns (Booking memory) { return _bookings[bookingId]; }
    function pause() external onlyRole(ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(ADMIN_ROLE) { _unpause(); }

    function createBooking(bytes32 bookingId, address performer, uint256 amount, uint64 showStart,
        uint64 showEnd, uint64 claimDeadline, bytes32 termsHash, string calldata termsUri,
        uint32 reviewWindow, uint32 cancellationWindow, uint16 killFeeBps)
        external onlyRole(ADMIN_ROLE) whenNotPaused nonReentrant
    {
        if (bookingId == bytes32(0) || _bookings[bookingId].status != Status.None || performer == address(0) ||
            amount == 0 || termsHash == bytes32(0) || bytes(termsUri).length == 0 || killFeeBps > 10000) revert InvalidBooking();
        if (showStart <= block.timestamp || showEnd <= showStart || reviewWindow == 0 ||
            uint256(claimDeadline) <= uint256(showEnd) + reviewWindow) revert InvalidTime();
        _bookings[bookingId] = Booking(performer, msg.sender, amount, 0, showStart, showEnd,
            claimDeadline, reviewWindow, cancellationWindow, killFeeBps, termsHash, Status.Funded);
        uint256 beforeBalance = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        if (usdc.balanceOf(address(this)) - beforeBalance != amount) revert UnsupportedToken();
        emit BookingFunded(bookingId, performer, msg.sender, amount, termsHash, termsUri);
    }
    function approve(bytes32 bookingId, uint16 payoutBps, string calldata reportUri)
        external onlyRole(ADMIN_ROLE) whenNotPaused nonReentrant
    {
        Booking storage b = _bookings[bookingId];
        _reviewable(b);
        _report(reportUri);
        if (payoutBps > 10000) revert InvalidBooking();
        _approve(bookingId, b, payoutBps, reportUri);
    }
    function _approve(bytes32 bookingId, Booking storage b, uint16 payoutBps, string memory reportUri) private {
        b.payoutAmount = b.amount * payoutBps / 10000;
        uint256 refund = b.amount - b.payoutAmount;
        b.status = b.payoutAmount == 0 ? Status.Refunded : Status.Approved;
        emit PerformanceApproved(bookingId, payoutBps, b.payoutAmount, refund, reportUri, b.termsHash);
        if (refund > 0) _refund(bookingId, b, refund, reportUri);
    }
    function claim(bytes32 bookingId) external whenNotPaused nonReentrant {
        Booking storage b = _bookings[bookingId];
        if (msg.sender != b.performer) revert PerformerOnly();
        if (block.timestamp > b.claimDeadline) revert InvalidTime();
        if (b.status == Status.Funded) {
            if (block.timestamp < uint256(b.showEnd) + b.reviewWindow) revert InvalidTime();
            b.payoutAmount = b.amount;
            emit PerformanceApproved(bookingId, 10000, b.amount, 0, "automatic-review-window", b.termsHash);
        } else if (b.status != Status.Approved) revert InvalidState();
        b.status = Status.Paid;
        uint256 amount = b.payoutAmount;
        usdc.safeTransfer(b.performer, amount);
        emit PerformancePaid(bookingId, b.performer, amount, b.termsHash);
    }
    function reject(bytes32 bookingId, string calldata reasonUri) external onlyRole(ADMIN_ROLE) whenNotPaused nonReentrant {
        _reject(bookingId, reasonUri);
    }
    function markNoShow(bytes32 bookingId, string calldata reasonUri) external onlyRole(ADMIN_ROLE) whenNotPaused nonReentrant {
        _reject(bookingId, reasonUri);
    }
    function _reject(bytes32 bookingId, string memory reasonUri) private {
        Booking storage b = _bookings[bookingId];
        _reviewable(b);
        _report(reasonUri);
        b.status = Status.Refunded;
        _refund(bookingId, b, b.amount, reasonUri);
    }
    function cancel(bytes32 bookingId, string calldata reasonUri) external whenNotPaused nonReentrant {
        Booking storage b = _bookings[bookingId];
        if (msg.sender != b.performer && !hasRole(ADMIN_ROLE, msg.sender)) revert PerformerOnly();
        if (b.status != Status.Funded) revert InvalidState();
        if (block.timestamp >= b.showStart) revert InvalidTime();
        _report(reasonUri);
        uint16 feeBps = msg.sender != b.performer && uint256(b.showStart) - block.timestamp < b.cancellationWindow ? b.killFeeBps : 0;
        _approve(bookingId, b, feeBps, reasonUri);
        emit BookingCancelled(bookingId, b.payoutAmount, reasonUri, b.termsHash);
    }
    /// @notice Anyone may return unclaimed funds to the original funder after the agreed deadline.
    function expire(bytes32 bookingId) external whenNotPaused nonReentrant {
        Booking storage b = _bookings[bookingId];
        if (b.status != Status.Funded && b.status != Status.Approved) revert InvalidState();
        if (block.timestamp <= b.claimDeadline) revert InvalidTime();
        uint256 remaining = b.status == Status.Approved ? b.payoutAmount : b.amount;
        b.status = Status.Refunded;
        _refund(bookingId, b, remaining, "expired-claim-deadline");
    }
    function _reviewable(Booking storage b) private view {
        if (b.status != Status.Funded) revert InvalidState();
        // Auto-claim vests at the review boundary: an admin cannot race it with a late rejection.
        if (block.timestamp < b.showEnd || block.timestamp >= uint256(b.showEnd) + b.reviewWindow) revert InvalidTime();
    }
    function _report(string memory reportUri) private pure {
        if (bytes(reportUri).length == 0 || bytes(reportUri).length > 2048) revert InvalidReport();
    }
    function _refund(bytes32 bookingId, Booking storage b, uint256 amount, string memory reasonUri) private {
        usdc.safeTransfer(b.funder, amount);
        emit BookingRefunded(bookingId, b.funder, amount, reasonUri, b.termsHash);
    }
}
