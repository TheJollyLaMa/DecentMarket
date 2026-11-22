// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

/// @title DecentBuskingTipRouter v0.2
/// @notice Tips performers and song co-owners in native ETH or an allowed ERC-20 (USDC at launch), and
///         gifts ERC-721/ERC-1155 NFTs, recording where each tip came from (a live show, a radio play or
///         an archived recording).
/// @dev Custody-free by design: every tip and gift moves straight from the tipper to its recipients in
///      the same transaction. There is no receive/fallback and no NFT receiver hook, so ordinary
///      transfers to this address revert. If any recipient refuses its payment or NFT the whole call
///      reverts, so a TipSent / TokenTipSent / NftGiftSent event always means that delivery happened.
///
///      Splits match DJuke `configureSong`: 1-16 distinct nonzero recipients with nonzero shares
///      totalling 10000 basis points. Each recipient gets `amount * share / 10000` and the last also
///      receives the rounding remainder, matching DJuke artist credits.
///
///      The owner (admin) can only allow/disallow ERC-20 tokens. There is no recovery or withdrawal
///      function: the owner can never move any asset, and transfers always use msg.sender as the source.
contract DecentBuskingTipRouter_v0_2 is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 public constant SOURCE_LIVE = 0;
    uint8 public constant SOURCE_RADIO = 1;
    uint8 public constant SOURCE_ARCHIVE = 2;
    uint8 public constant NFT_ERC721 = 0;
    uint8 public constant NFT_ERC1155 = 1;
    uint256 public constant MAX_CONTEXT_BYTES = 256;
    uint256 public constant MAX_SPLIT_RECIPIENTS = 16;
    uint256 public constant MAX_NFT_GIFTS = 32;
    uint256 public constant TOTAL_SHARE_BPS = 10000;
    string public constant CONTRACT_VERSION = "0.2";

    struct NftGift {
        address collection;
        uint8 standard;
        uint256 tokenId;
        uint256 amount;
        address recipient;
    }

    mapping(address token => bool) public allowedTokens;

    /// @notice Native ETH delivered to `recipient`. Same event as v0.1.
    event TipSent(
        address indexed sender,
        address indexed recipient,
        bytes32 indexed contextId,
        uint8 sourceKind,
        uint256 amount,
        string contextRef
    );

    /// @notice `amount` of the allowed ERC-20 `token` transferred from `sender` to `recipient`.
    event TokenTipSent(
        address indexed sender,
        address indexed recipient,
        bytes32 indexed contextId,
        address token,
        uint8 sourceKind,
        uint256 amount,
        string contextRef
    );

    /// @notice An NFT transferred from `sender` to `recipient`. `amount` is 1 for ERC-721.
    event NftGiftSent(
        address indexed sender,
        address indexed recipient,
        bytes32 indexed contextId,
        address collection,
        uint8 standard,
        uint256 tokenId,
        uint256 amount,
        uint8 sourceKind,
        string contextRef
    );

    event TokenAllowed(address indexed token, bool allowed);

    error InvalidRecipient();
    error InvalidAmount();
    error InvalidSourceKind();
    error InvalidContext();
    error InvalidSplit();
    error InvalidToken();
    error InvalidGift();
    error TokenNotAllowed();
    error TransferFailed();

    constructor(address initialOwner, address[] memory initialTokens) Ownable(initialOwner) {
        for (uint256 index; index < initialTokens.length; ++index) _setTokenAllowed(initialTokens[index], true);
    }

    // ── Native ETH ───────────────────────────────────────────────────────

    /// @notice Tips `recipient` the full `msg.value` and records the source of the tip.
    function tip(address recipient, uint8 sourceKind, string calldata contextRef) external payable nonReentrant {
        if (recipient == address(0)) revert InvalidRecipient();
        if (msg.value == 0) revert InvalidAmount();
        bytes32 contextId = _checkContext(sourceKind, contextRef);
        _sendEth(recipient, msg.value, contextId, sourceKind, contextRef);
    }

    /// @notice Splits `msg.value` among a song's co-owners by basis-point shares and records the source.
    function tipSplit(address[] calldata recipients, uint16[] calldata sharesBps, uint8 sourceKind, string calldata contextRef)
        external payable nonReentrant
    {
        _checkSplit(recipients, sharesBps);
        if (msg.value == 0) revert InvalidAmount();
        bytes32 contextId = _checkContext(sourceKind, contextRef);
        uint256 remaining = msg.value;
        uint256 count = recipients.length;
        for (uint256 index; index < count; ++index) {
            uint256 part = index == count - 1 ? remaining : msg.value * sharesBps[index] / TOTAL_SHARE_BPS;
            if (part == 0) revert InvalidAmount();
            remaining -= part;
            _sendEth(recipients[index], part, contextId, sourceKind, contextRef);
        }
    }

    // ── Allowed ERC-20 tokens ─────────────────────────────────────────────

    /// @notice Transfers `amount` of `token` from the caller to `recipient`. Requires a prior approval.
    function tipToken(address token, address recipient, uint256 amount, uint8 sourceKind, string calldata contextRef)
        external nonReentrant
    {
        if (!allowedTokens[token]) revert TokenNotAllowed();
        if (recipient == address(0)) revert InvalidRecipient();
        if (amount == 0) revert InvalidAmount();
        bytes32 contextId = _checkContext(sourceKind, contextRef);
        _sendToken(token, recipient, amount, contextId, sourceKind, contextRef);
    }

    /// @notice Splits `amount` of `token` from the caller among a song's co-owners by basis-point shares.
    function tipTokenSplit(address token, address[] calldata recipients, uint16[] calldata sharesBps, uint256 amount,
        uint8 sourceKind, string calldata contextRef) external nonReentrant
    {
        if (!allowedTokens[token]) revert TokenNotAllowed();
        _checkSplit(recipients, sharesBps);
        if (amount == 0) revert InvalidAmount();
        bytes32 contextId = _checkContext(sourceKind, contextRef);
        uint256 remaining = amount;
        uint256 count = recipients.length;
        for (uint256 index; index < count; ++index) {
            uint256 part = index == count - 1 ? remaining : amount * sharesBps[index] / TOTAL_SHARE_BPS;
            if (part == 0) revert InvalidAmount();
            remaining -= part;
            _sendToken(token, recipients[index], part, contextId, sourceKind, contextRef);
        }
    }

    // ── NFT gifts ─────────────────────────────────────────────────────────

    /// @notice Transfers up to 32 NFTs from the caller, each to its own recipient (any one or all of a
    ///         song's owners). Requires the caller to have approved this contract on each collection.
    function giftNfts(NftGift[] calldata gifts, uint8 sourceKind, string calldata contextRef) external nonReentrant {
        uint256 count = gifts.length;
        if (count == 0 || count > MAX_NFT_GIFTS) revert InvalidGift();
        bytes32 contextId = _checkContext(sourceKind, contextRef);
        for (uint256 index; index < count; ++index) {
            NftGift calldata gift = gifts[index];
            if (gift.recipient == address(0) || gift.recipient == msg.sender) revert InvalidRecipient();
            if (gift.collection.code.length == 0) revert InvalidGift();
            uint256 amount;
            if (gift.standard == NFT_ERC721) {
                if (gift.amount != 1) revert InvalidGift();
                amount = 1;
                IERC721(gift.collection).safeTransferFrom(msg.sender, gift.recipient, gift.tokenId);
            } else if (gift.standard == NFT_ERC1155) {
                if (gift.amount == 0) revert InvalidGift();
                amount = gift.amount;
                IERC1155(gift.collection).safeTransferFrom(msg.sender, gift.recipient, gift.tokenId, amount, "");
            } else {
                revert InvalidGift();
            }
            emit NftGiftSent(msg.sender, gift.recipient, contextId, gift.collection, gift.standard, gift.tokenId,
                amount, sourceKind, contextRef);
        }
    }

    // ── Admin ─────────────────────────────────────────────────────────────

    /// @notice Allows or disallows an ERC-20 token for tips (for example OMMM once it exists on Base).
    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        _setTokenAllowed(token, allowed);
    }

    // ── Internals ─────────────────────────────────────────────────────────

    function _setTokenAllowed(address token, bool allowed) private {
        if (token.code.length == 0) revert InvalidToken();
        allowedTokens[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    function _checkSplit(address[] calldata recipients, uint16[] calldata sharesBps) private pure {
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
    }

    function _checkContext(uint8 sourceKind, string calldata contextRef) private pure returns (bytes32) {
        if (sourceKind > SOURCE_ARCHIVE) revert InvalidSourceKind();
        uint256 length = bytes(contextRef).length;
        if (length == 0 || length > MAX_CONTEXT_BYTES) revert InvalidContext();
        return keccak256(bytes(contextRef));
    }

    function _sendEth(address recipient, uint256 amount, bytes32 contextId, uint8 sourceKind, string calldata contextRef) private {
        emit TipSent(msg.sender, recipient, contextId, sourceKind, amount, contextRef);
        (bool delivered, ) = recipient.call{value: amount}("");
        if (!delivered) revert TransferFailed();
    }

    function _sendToken(address token, address recipient, uint256 amount, bytes32 contextId, uint8 sourceKind,
        string calldata contextRef) private
    {
        IERC20(token).safeTransferFrom(msg.sender, recipient, amount);
        emit TokenTipSent(msg.sender, recipient, contextId, token, sourceKind, amount, contextRef);
    }
}
