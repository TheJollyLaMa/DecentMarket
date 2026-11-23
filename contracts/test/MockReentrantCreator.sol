// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

interface IDecentNFTCreatorLane {
    enum TokenKind { Product, Achievement }
    function registerAndMintProduct(uint256, uint256, string calldata, address, uint96) external returns (uint256);
    function registerToken(uint256, string calldata, TokenKind, address, uint96) external returns (uint256);
    function mintProduct(address, uint256, uint256) external;
    function mintCreatorProduct(uint256, uint256) external;
}

/// @dev Creator wallet that re-enters the collection from its ERC-1155 receive hook.
contract MockReentrantCreator is ERC1155Holder {
    IDecentNFTCreatorLane public immutable nft;
    uint8 public mode; // 0 none, 1 registerToken, 2 mintProduct, 3 mintCreatorProduct
    bool public attempted;
    bool public reentrySucceeded;
    bytes public reentryError;

    constructor(IDecentNFTCreatorLane nft_) { nft = nft_; }

    function setMode(uint8 mode_) external { mode = mode_; attempted = false; reentrySucceeded = false; }

    function create(uint256 amount, uint256 maxSupply) external returns (uint256) {
        return nft.registerAndMintProduct(amount, maxSupply, "ipfs://reentrant", address(this), 100);
    }

    function onERC1155Received(address, address, uint256 id, uint256, bytes memory)
        public
        override
        returns (bytes4)
    {
        if (mode != 0 && !attempted) {
            attempted = true;
            bytes memory data;
            if (mode == 1) {
                data = abi.encodeCall(nft.registerToken, (0, "ipfs://hijack", IDecentNFTCreatorLane.TokenKind.Achievement, address(this), 9_000));
            } else if (mode == 2) {
                data = abi.encodeCall(nft.mintProduct, (address(this), id, 1));
            } else {
                data = abi.encodeCall(nft.mintCreatorProduct, (id, 1));
            }
            (bool ok, bytes memory err) = address(nft).call(data);
            reentrySucceeded = ok;
            reentryError = err;
        }
        return this.onERC1155Received.selector;
    }
}
