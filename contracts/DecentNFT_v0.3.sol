pragma solidity ^0.8.26;

import "./DecentNFT_v0.2.sol";
import "@openzeppelin/contracts/utils/Multicall.sol";
import "@openzeppelin/contracts/utils/Address.sol";

contract DecentNFT_v0_3 is DecentNFT_v0_2, Multicall {
    struct ProductMint {
        address recipient;
        uint256 amount;
        uint256 maxSupply;
        string tokenURI;
        address royaltyReceiver;
        uint96 royaltyFeeBps;
    }

    error EmptyProductBatch();

    constructor(string memory baseURI_, address royaltyReceiver, uint96 royaltyFeeBps)
        DecentNFT_v0_2(baseURI_, royaltyReceiver, royaltyFeeBps)
    {}

    function registerAndMintProductsBatch(ProductMint[] calldata products)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        returns (uint256[] memory tokenIds)
    {
        if (products.length == 0) revert EmptyProductBatch();
        tokenIds = new uint256[](products.length);
        for (uint256 index = 0; index < products.length; index++) {
            ProductMint calldata product = products[index];
            bytes memory registration = Address.functionDelegateCall(
                address(this),
                abi.encodeCall(this.registerToken, (
                    product.maxSupply,
                    product.tokenURI,
                    TokenKind.Product,
                    product.royaltyReceiver,
                    product.royaltyFeeBps
                ))
            );
            uint256 tokenId = abi.decode(registration, (uint256));
            tokenIds[index] = tokenId;
            Address.functionDelegateCall(
                address(this),
                abi.encodeCall(this.mintProduct, (product.recipient, tokenId, product.amount))
            );
        }
    }
}