pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

contract RejectingNFTReceiver is ERC1155Holder {
    function onERC1155Received(address, address, uint256, uint256, bytes memory)
        public pure override returns (bytes4)
    {
        revert("Receiver rejected mint");
    }
}

contract MockDJukeToken is ERC20 {
    constructor() ERC20("Test USDC", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address recipient, uint256 amount) external { _mint(recipient, amount); }
}

contract MockDJukeRouter {
    mapping(bytes32 => uint256) public received;
    bool public rejectDeposits;
    function setRejectDeposits(bool reject) external { rejectDeposits = reject; }
    function fundToken(bytes32 fundId, address asset, uint256 amount) external {
        require(!rejectDeposits, "Fund unavailable");
        require(IERC20(asset).transferFrom(msg.sender, address(this), amount), "Deposit transfer failed");
        received[fundId] += amount;
    }
}