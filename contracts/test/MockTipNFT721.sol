// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// Test-only ERC-721 for DecentBuskingTipRouter NFT gifts.
contract MockTipNFT721 is ERC721 {
    constructor() ERC721("Mock gift", "GIFT") {}
    function mint(address to, uint256 tokenId) external { _mint(to, tokenId); }
}
