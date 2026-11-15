// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title DecentBuskingTipRouter
/// @notice Pays a native-ETH tip straight to a performer and records where the tip came from
///         (a live show, a radio play or an archived recording), so a ledger can tell it apart
///         from a plain wallet-to-wallet transfer.
/// @dev Stateless and custody-free by design. 100% of every tip is forwarded to the recipient in the
///      same transaction. There is no owner, fee, pause, allowlist, upgrade path or storage, and no
///      receive/fallback function, so ETH cannot be sent here by a normal call. If the recipient
///      refuses the payment the whole call reverts, so a TipSent event always means the money was
///      delivered. The tip path never reads this contract's balance.
///
///      Reentrancy is deliberately allowed: with no state and no tip funds held, a reentrant call can
///      only move its own msg.value, and a recipient such as a splitter may legitimately tip onward.
///
///      The contract validates only the source kind and the size of the context reference. The
///      canonical reference formats are `decentbusking:live:<bookingId>` and
///      `decentbusking:<radio|archive>:<chainId>:<collection>:<tokenId>`; the ledger checks them
///      off-chain and treats any other reference as an unattributed tip.
contract DecentBuskingTipRouter {
    uint8 public constant SOURCE_LIVE = 0;
    uint8 public constant SOURCE_RADIO = 1;
    uint8 public constant SOURCE_ARCHIVE = 2;
    uint256 public constant MAX_CONTEXT_BYTES = 256;

    /// @param sender The account that paid.
    /// @param recipient The account that received the whole amount.
    /// @param contextId keccak256 of the UTF-8 bytes of `contextRef`, indexed so one show or recording can be queried.
    /// @param sourceKind 0 live show, 1 radio play, 2 archived recording.
    /// @param amount Wei delivered to `recipient`.
    /// @param contextRef The source reference the tip is attributed to.
    event TipSent(
        address indexed sender,
        address indexed recipient,
        bytes32 indexed contextId,
        uint8 sourceKind,
        uint256 amount,
        string contextRef
    );

    error InvalidRecipient();
    error InvalidAmount();
    error InvalidSourceKind();
    error InvalidContext();
    error TransferFailed();

    /// @notice Tips `recipient` the full `msg.value` and records the source of the tip.
    function tip(address recipient, uint8 sourceKind, string calldata contextRef) external payable {
        if (recipient == address(0)) revert InvalidRecipient();
        if (msg.value == 0) revert InvalidAmount();
        if (sourceKind > SOURCE_ARCHIVE) revert InvalidSourceKind();
        uint256 length = bytes(contextRef).length;
        if (length == 0 || length > MAX_CONTEXT_BYTES) revert InvalidContext();

        emit TipSent(msg.sender, recipient, keccak256(bytes(contextRef)), sourceKind, msg.value, contextRef);

        (bool delivered, ) = recipient.call{value: msg.value}("");
        if (!delivered) revert TransferFailed();
    }
}
