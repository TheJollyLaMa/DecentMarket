// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

/// Test-only helpers for DecentSupporterListings_v0_1. Never deployed outside tests.

interface IListings {
    function list(address, uint256, uint256, address, uint256) external returns (uint256);
    function delist(uint256) external;
    function withdraw(address) external;
    function purchaseWithETH(uint256, uint256) external payable;
}

contract MockListingsUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// Plain ERC-1155 with no ERC-2981 support.
contract MockPlain1155 is ERC1155 {
    constructor() ERC1155("") {}

    function mint(address to, uint256 id, uint256 amount) external {
        _mint(to, id, amount, "");
    }

    /// Credits `to` without the receiver hook, to simulate stray editions.
    function forceMint(address to, uint256 id, uint256 amount) external {
        uint256[] memory ids = new uint256[](1);
        uint256[] memory values = new uint256[](1);
        ids[0] = id;
        values[0] = amount;
        _update(address(0), to, ids, values);
    }
}

/// Claims ERC-2981 but reverts on royaltyInfo.
contract MockBrokenRoyalty1155 is ERC1155 {
    constructor() ERC1155("") {}

    function mint(address to, uint256 id, uint256 amount) external {
        _mint(to, id, amount, "");
    }

    function royaltyInfo(uint256, uint256) external pure returns (address, uint256) {
        revert("broken royalty");
    }

    function supportsInterface(bytes4 id) public view override returns (bool) {
        return id == 0x2a55205a || super.supportsInterface(id);
    }
}

/// Seller wallet contract: can reject editions and re-enter withdraw from its ETH hook.
contract MockListingSeller is ERC1155Holder {
    IListings public immutable listings;
    bool public rejectEditions;
    bool public reenterOnEth;
    bytes public lastError;

    constructor(IListings listings_) {
        listings = listings_;
    }

    function setRejectEditions(bool v) external {
        rejectEditions = v;
    }

    function setReenterOnEth(bool v) external {
        reenterOnEth = v;
    }

    function listFrom(address collection, uint256 id, uint256 qty, address payToken, uint256 price)
        external
        returns (uint256)
    {
        IERC1155(collection).setApprovalForAll(address(listings), true);
        return listings.list(collection, id, qty, payToken, price);
    }

    function delist(uint256 listingId) external {
        listings.delist(listingId);
    }

    function withdraw(address token) external {
        listings.withdraw(token);
    }

    function onERC1155Received(address a, address b, uint256 c, uint256 d, bytes memory e)
        public
        override
        returns (bytes4)
    {
        require(!rejectEditions, "seller rejects editions");
        return super.onERC1155Received(a, b, c, d, e);
    }

    receive() external payable {
        if (reenterOnEth) {
            reenterOnEth = false;
            listings.withdraw(address(0));
        }
    }
}

/// Buyer that re-enters purchaseWithETH when it receives an edition.
contract MockReentrantBuyer is ERC1155Holder {
    IListings public immutable listings;
    uint256 public listingId;
    bool public armed;

    constructor(IListings listings_) {
        listings = listings_;
    }

    function buy(uint256 id, uint256 qty, bool reenter) external payable {
        listingId = id;
        armed = reenter;
        listings.purchaseWithETH{value: msg.value}(id, qty);
    }

    function onERC1155Received(address a, address b, uint256 c, uint256 d, bytes memory e)
        public
        override
        returns (bytes4)
    {
        if (armed) {
            armed = false;
            listings.purchaseWithETH{value: 0}(listingId, 1);
        }
        return super.onERC1155Received(a, b, c, d, e);
    }

    receive() external payable {}
}
