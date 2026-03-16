// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title DecentEscrow
 * @notice Community Treasury v1 — on-chain escrow for Decent Agency DNFT sale proceeds.
 *
 * Accepts ETH and ERC-20 tokens (e.g. USDC on Optimism) from supporters purchasing early
 * DNFT editions of DecentHead, BigNuten, and future Decent products.
 *
 * All deposits emit a `Deposited` event with a human-readable `note` (e.g. "DecentHead v1.0
 * DNFT sale") and all withdrawals emit a `Withdrawn` event with a required `reason` string
 * (e.g. "Bounty payout — DecentMarket TheJollyLaMa/DecentMarket#45") for full on-chain
 * accountability.
 *
 * Ownership upgrade path
 * ----------------------
 *   Phase 1: deployer wallet (TheJollyLaMa) — simple, auditable MVP
 *   Phase 2: transferOwnership(gnosisSafe)  — Gnosis Safe multi-sig
 *   Phase 3: DAO governance via BigNuten ($BNUT) integration
 *
 * Related contracts
 * -----------------
 *   DecentNFT_v0_2 — ERC-1155 DNFT contract whose sale proceeds flow here
 *   BigNutenTreasury (#39) — $BNUT-specific payout contract (separate concern)
 */
contract DecentEscrow is Ownable {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /**
     * @notice Emitted when ETH or ERC-20 tokens are deposited into the escrow.
     * @param sender  Address originating the deposit.
     * @param token   Token address; address(0) denotes ETH.
     * @param amount  Deposited amount (wei for ETH, token-native decimals for ERC-20).
     * @param note    Human-readable label, e.g. "DecentHead v1.0 DNFT sale".
     */
    event Deposited(
        address indexed sender,
        address indexed token,
        uint256 amount,
        string note
    );

    /**
     * @notice Emitted when the owner withdraws ETH or ERC-20 tokens.
     * @param token   Token address; address(0) denotes ETH.
     * @param to      Recipient of the withdrawal.
     * @param amount  Withdrawn amount.
     * @param reason  On-chain reason, e.g. "Bounty payout — DecentMarket TheJollyLaMa/DecentMarket#45".
     */
    event Withdrawn(
        address indexed token,
        address indexed to,
        uint256 amount,
        string reason
    );

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /**
     * @param initialOwner Wallet that receives ownership on deployment.
     *                     Set to the Decent Agency deployer wallet; transfer to
     *                     Gnosis Safe in Phase 2.
     */
    constructor(address initialOwner) Ownable(initialOwner) {}

    // -------------------------------------------------------------------------
    // Receive ETH (anonymous deposit)
    // -------------------------------------------------------------------------

    /**
     * @notice Accepts plain ETH transfers (e.g. from a frontend without calldata).
     *         Emits `Deposited` with an empty note.
     *         Use `depositETH(note)` for a labelled deposit.
     */
    receive() external payable {
        emit Deposited(msg.sender, address(0), msg.value, "");
    }

    // -------------------------------------------------------------------------
    // Deposit functions
    // -------------------------------------------------------------------------

    /**
     * @notice Deposit ETH with a descriptive note.
     * @param note  Human-readable label, e.g. "DecentHead v1.0 DNFT sale".
     */
    function depositETH(string calldata note) external payable {
        require(msg.value > 0, "DecentEscrow: zero ETH deposit");
        emit Deposited(msg.sender, address(0), msg.value, note);
    }

    /**
     * @notice Deposit ERC-20 tokens (e.g. USDC) with a descriptive note.
     *         Caller must approve this contract for at least `amount` before calling.
     * @param token   ERC-20 token contract address (e.g. USDC on Optimism).
     * @param amount  Amount in token-native decimals (e.g. 100_000_000 for 100 USDC).
     * @param note    Human-readable label, e.g. "BigNuten v1.0 DNFT sale".
     */
    function deposit(
        address token,
        uint256 amount,
        string calldata note
    ) external {
        require(token != address(0), "DecentEscrow: use depositETH for ETH");
        require(amount > 0, "DecentEscrow: zero token deposit");
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, token, amount, note);
    }

    // -------------------------------------------------------------------------
    // Withdrawal functions (owner only)
    // -------------------------------------------------------------------------

    /**
     * @notice Withdraw ETH from the escrow. Requires a documented reason.
     * @param amount  Amount in wei to withdraw.
     * @param reason  On-chain reason string, e.g. "Bounty payout — DecentMarket TheJollyLaMa/DecentMarket#45".
     */
    function withdrawETH(uint256 amount, string calldata reason) external onlyOwner {
        require(amount > 0, "DecentEscrow: zero amount");
        require(address(this).balance >= amount, "DecentEscrow: insufficient ETH balance");
        emit Withdrawn(address(0), msg.sender, amount, reason);
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "DecentEscrow: ETH transfer failed");
    }

    /**
     * @notice Withdraw ERC-20 tokens from the escrow. Requires a documented reason.
     * @param token   ERC-20 token contract address.
     * @param amount  Amount in token-native decimals.
     * @param reason  On-chain reason string.
     */
    function withdraw(
        address token,
        uint256 amount,
        string calldata reason
    ) external onlyOwner {
        require(token != address(0), "DecentEscrow: use withdrawETH for ETH");
        require(amount > 0, "DecentEscrow: zero amount");
        emit Withdrawn(token, msg.sender, amount, reason);
        IERC20(token).safeTransfer(msg.sender, amount);
    }

    // -------------------------------------------------------------------------
    // View functions
    // -------------------------------------------------------------------------

    /**
     * @notice Returns the escrow's current ETH balance in wei.
     */
    function getETHBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /**
     * @notice Returns the escrow's balance of an ERC-20 token.
     * @param token  ERC-20 token contract address.
     */
    function getBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
}
