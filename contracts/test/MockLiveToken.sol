// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockLiveToken is ERC20 {
    address public escrow;
    bytes32 public bookingId;
    bool public attack;
    bool public reentrySucceeded;
    uint256 public fee;
    constructor() ERC20("Mock USDC", "USDC") {}
    function mint(address account, uint256 amount) external { _mint(account, amount); }
    function setFee(uint256 value) external { fee = value; }
    function configureAttack(address target, bytes32 booking) external { escrow = target; bookingId = booking; attack = true; }
    function triggerClaim() external {
        (bool ok,) = escrow.call(abi.encodeWithSignature("claim(bytes32)", bookingId));
        require(ok, "outer claim failed");
    }
    function _update(address from, address to, uint256 amount) internal override {
        if (fee > 0 && from != address(0) && to != address(0)) {
            super._update(from, address(0), fee);
            super._update(from, to, amount - fee);
        } else super._update(from, to, amount);
        if (attack && to == address(this)) {
            (reentrySucceeded,) = escrow.call(abi.encodeWithSignature("claim(bytes32)", bookingId));
        }
    }
}
