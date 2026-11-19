// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockBookingToken is ERC20 {
    uint8 private immutable _decimals;
    constructor(uint8 decimals_) ERC20("Booking asset", "ASSET") { _decimals = decimals_; }
    function decimals() public view override returns (uint8) { return _decimals; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockBookingNFT is ERC1155 {
    constructor() ERC1155("") {}
    function mint(address to, uint256 id, uint256 amount) external { _mint(to, id, amount, ""); }
}

contract MockBookingRecipient is ERC1155Holder {
    bool public rejectNFT;
    bool public rejectETH;
    bool public reenter;
    bool public reentrySucceeded;
    address public escrow;
    bytes32 public bookingId;

    function configure(address target, bytes32 id, bool nft, bool eth, bool attack) external {
        escrow = target; bookingId = id; rejectNFT = nft; rejectETH = eth; reenter = attack;
    }
    function claim() external {
        (bool ok,) = escrow.call(abi.encodeWithSignature("claim(bytes32)", bookingId));
        require(ok, "claim failed");
    }
    receive() external payable {
        require(!rejectETH, "reject ETH");
        if (reenter) (reentrySucceeded,) = escrow.call(abi.encodeWithSignature("claim(bytes32)", bookingId));
    }
    function onERC1155Received(address operator, address from, uint256 id, uint256 value, bytes memory data)
        public override returns (bytes4)
    {
        require(!rejectNFT, "reject NFT");
        if (reenter) (reentrySucceeded,) = escrow.call(abi.encodeWithSignature("releaseGift(bytes32)", bookingId));
        return super.onERC1155Received(operator, from, id, value, data);
    }
}
