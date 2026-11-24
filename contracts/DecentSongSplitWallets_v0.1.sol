// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// One wallet per exact song split. Payers that can only pay a single address (such as the DMTv
/// escrow) pay this wallet; anyone can then call `distribute` to push the balance to the owners by
/// DJuke `configureSong` share rules. The factory owner can recover stuck assets (prototype rule).
contract DecentSongSplitWallet_v0_1 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant TOTAL_SHARE_BPS = 10_000;

    address public factory;
    address[] private _recipients;
    uint16[] private _sharesBps;

    event Distributed(address indexed token, uint256 amount);
    event Paid(address indexed token, address indexed recipient, uint256 amount);
    event Recovered(address indexed asset, address indexed recipient, uint256 amount);

    error AlreadyInitialized();
    error NothingToDistribute();
    error NotOwner();
    error InvalidRecipient();
    error TransferFailed();

    constructor() {
        // Locks the implementation; clones start with empty storage and are initialized by the factory.
        factory = msg.sender;
    }

    function initialize(address[] calldata recipients, uint16[] calldata sharesBps) external {
        if (factory != address(0)) revert AlreadyInitialized();
        factory = msg.sender;
        _recipients = recipients;
        _sharesBps = sharesBps;
    }

    function split() external view returns (address[] memory recipients, uint16[] memory sharesBps) {
        return (_recipients, _sharesBps);
    }

    function distribute(address token) external nonReentrant returns (uint256 amount) {
        amount = IERC20(token).balanceOf(address(this));
        if (amount == 0) revert NothingToDistribute();
        uint256 count = _recipients.length;
        uint256 paid;
        for (uint256 index; index < count; ++index) {
            uint256 part = index + 1 == count ? amount - paid : amount * _sharesBps[index] / TOTAL_SHARE_BPS;
            paid += part;
            if (part != 0) {
                IERC20(token).safeTransfer(_recipients[index], part);
                emit Paid(token, _recipients[index], part);
            }
        }
        emit Distributed(token, amount);
    }

    function recover(address asset, address payable recipient, uint256 amount) external nonReentrant {
        if (msg.sender != Ownable(factory).owner()) revert NotOwner();
        if (recipient == address(0)) revert InvalidRecipient();
        if (asset == address(0)) {
            (bool ok,) = recipient.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(asset).safeTransfer(recipient, amount);
        }
        emit Recovered(asset, recipient, amount);
    }
}

contract DecentSongSplitWalletFactory_v0_1 is Ownable2Step {
    uint256 public constant MAX_SPLIT_RECIPIENTS = 16;
    uint256 public constant TOTAL_SHARE_BPS = 10_000;

    address public immutable implementation;
    mapping(address => bool) public isWallet;

    event WalletCreated(address indexed wallet, address[] recipients, uint16[] sharesBps);

    error InvalidSplit();
    error InvalidRecipient();

    constructor(address initialOwner) Ownable(initialOwner) {
        implementation = address(new DecentSongSplitWallet_v0_1());
    }

    function walletFor(address[] calldata recipients, uint16[] calldata sharesBps) public view returns (address) {
        _checkSplit(recipients, sharesBps);
        return Clones.predictDeterministicAddress(implementation, _salt(recipients, sharesBps));
    }

    /// Permissionless and idempotent: returns the existing wallet for an identical split.
    function createWallet(address[] calldata recipients, uint16[] calldata sharesBps) external returns (address wallet) {
        wallet = walletFor(recipients, sharesBps);
        if (isWallet[wallet]) return wallet;
        Clones.cloneDeterministic(implementation, _salt(recipients, sharesBps));
        isWallet[wallet] = true;
        DecentSongSplitWallet_v0_1(wallet).initialize(recipients, sharesBps);
        emit WalletCreated(wallet, recipients, sharesBps);
    }

    function _salt(address[] calldata recipients, uint16[] calldata sharesBps) private pure returns (bytes32) {
        return keccak256(abi.encode(recipients, sharesBps));
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
}
