// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title DecentBuskingTipRouter v0.2
/// @notice Pays a native-ETH tip straight to a performer, or splits it among a song's co-owners, and
///         records where the tip came from (a live show, a radio play or an archived recording).
/// @dev Same guarantees as v0.1: stateless and custody-free. 100% of every tip is forwarded in the same
///      transaction. There is no owner, fee, pause, allowlist, upgrade path or storage, and no
///      receive/fallback function, so the contract never holds ETH and needs no recovery path. If any
///      recipient refuses its payment the whole call reverts, so a TipSent event always means that
///      recipient's money was delivered.
///
///      `tipSplit` accepts the same splits as DJuke `configureSong`: 1-16 distinct nonzero recipients
///      with nonzero shares totalling 10000 basis points. Each recipient gets `amount * share / 10000`
///      and the last recipient also receives the rounding remainder, matching DJuke artist credits.
///      One TipSent event is emitted per recipient, all with the same sender and context.
///
///      Reentrancy is deliberately allowed: with no state and no funds held, a reentrant call can only
///      move its own msg.value.
contract DecentBuskingTipRouter_v0_2 {
    uint8 public constant SOURCE_LIVE = 0;
    uint8 public constant SOURCE_RADIO = 1;
    uint8 public constant SOURCE_ARCHIVE = 2;
    uint256 public constant MAX_CONTEXT_BYTES = 256;
    uint256 public constant MAX_SPLIT_RECIPIENTS = 16;
    uint256 public constant TOTAL_SHARE_BPS = 10000;

    /// @param sender The account that paid.
    /// @param recipient The account that received `amount`.
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
    error InvalidSplit();
    error TransferFailed();

    /// @notice Tips `recipient` the full `msg.value` and records the source of the tip.
    function tip(address recipient, uint8 sourceKind, string calldata contextRef) external payable {
        if (recipient == address(0)) revert InvalidRecipient();
        if (msg.value == 0) revert InvalidAmount();
        bytes32 contextId = _checkContext(sourceKind, contextRef);
        _send(recipient, msg.value, contextId, sourceKind, contextRef);
    }

    /// @notice Splits `msg.value` among a song's co-owners by basis-point shares and records the source.
    function tipSplit(address[] calldata recipients, uint16[] calldata sharesBps, uint8 sourceKind, string calldata contextRef)
        external payable
    {
        uint256 count = recipients.length;
        if (count == 0 || count > MAX_SPLIT_RECIPIENTS || count != sharesBps.length) revert InvalidSplit();
        uint256 total;
        for (uint256 index; index < count; ++index) {
            if (recipients[index] == address(0)) revert InvalidRecipient();
            if (sharesBps[index] == 0) revert InvalidSplit();
            for (uint256 previous; previous < index; ++previous) {
                if (recipients[previous] == recipients[index]) revert InvalidSplit();
            }
            total += sharesBps[index];
        }
        if (total != TOTAL_SHARE_BPS) revert InvalidSplit();
        if (msg.value == 0) revert InvalidAmount();
        bytes32 contextId = _checkContext(sourceKind, contextRef);

        uint256 remaining = msg.value;
        for (uint256 index; index < count; ++index) {
            uint256 part = index == count - 1 ? remaining : msg.value * sharesBps[index] / TOTAL_SHARE_BPS;
            if (part == 0) revert InvalidAmount();
            remaining -= part;
            _send(recipients[index], part, contextId, sourceKind, contextRef);
        }
    }

    function _checkContext(uint8 sourceKind, string calldata contextRef) private pure returns (bytes32) {
        if (sourceKind > SOURCE_ARCHIVE) revert InvalidSourceKind();
        uint256 length = bytes(contextRef).length;
        if (length == 0 || length > MAX_CONTEXT_BYTES) revert InvalidContext();
        return keccak256(bytes(contextRef));
    }

    function _send(address recipient, uint256 amount, bytes32 contextId, uint8 sourceKind, string calldata contextRef) private {
        emit TipSent(msg.sender, recipient, contextId, sourceKind, amount, contextRef);
        (bool delivered, ) = recipient.call{value: amount}("");
        if (!delivered) revert TransferFailed();
    }
}
