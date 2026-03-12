// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title DecentNFT_v0.2
 * @notice ERC-1155 editionable NFT contract for DecentMarket product and user NFTs.
 *         Supports multiple editions per token ID, per-token supply caps, ERC-2981
 *         royalties, and per-token IPFS metadata URIs.
 *
 * Token ID semantics
 * ------------------
 *   - Product NFTs  (e.g. DecentHead_v1.0 → tokenId 1): registered by the owner,
 *     minted with `mintEdition`.
 *   - User / submission NFTs: any holder can self-mint via `mintUser`, up to the
 *     configured supply cap.
 *
 * URI scheme
 * ----------
 *   Pass a base URI such as `ipfs://<rootCID>/` to the constructor.
 *   Each token's full metadata URI is then `<baseURI><tokenId>.json`.
 *   Override individual URIs with `setTokenURI`.
 */
contract DecentNFT_v0_2 is ERC1155, Ownable, ERC2981 {
    using Strings for uint256;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /// @notice Emitted when a new token ID is registered.
    event TokenRegistered(
        uint256 indexed tokenId,
        address indexed creator,
        uint256 maxSupply,
        string uri
    );

    /// @notice Emitted when editions of a token are minted.
    event EditionMinted(
        uint256 indexed tokenId,
        address indexed to,
        uint256 amount,
        address indexed minter
    );

    // -------------------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------------------

    struct TokenInfo {
        address creator;   // Original creator / product origin
        uint256 maxSupply; // 0 = unlimited
        uint256 minted;    // Total editions minted so far
        string  tokenURI;  // Per-token URI override (empty → use base URI pattern)
    }

    /// @notice Base URI applied when no per-token override is set.
    string private _baseTokenURI;

    /// @notice Per-token metadata and supply information.
    mapping(uint256 => TokenInfo) private _tokenInfo;

    /// @notice Auto-incrementing counter for the next token ID.
    uint256 private _nextTokenId;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /**
     * @param baseURI_       Base URI for all tokens, e.g. `ipfs://<rootCID>/`.
     *                       Append `{id}.json` manually per ERC-1155 convention.
     * @param royaltyReceiver Address that receives secondary-sale royalties.
     * @param royaltyFeeBps  Royalty expressed in basis points (e.g. 500 = 5 %).
     */
    constructor(
        string memory baseURI_,
        address royaltyReceiver,
        uint96  royaltyFeeBps
    )
        ERC1155(baseURI_)
        Ownable(msg.sender)
    {
        _baseTokenURI = baseURI_;
        _setDefaultRoyalty(royaltyReceiver, royaltyFeeBps);
    }

    // -------------------------------------------------------------------------
    // URI helpers
    // -------------------------------------------------------------------------

    /**
     * @notice Returns the metadata URI for `tokenId`.
     *         Uses the per-token override when available; otherwise constructs
     *         `<baseURI><tokenId>.json`.
     */
    function uri(uint256 tokenId) public view override returns (string memory) {
        string memory override_ = _tokenInfo[tokenId].tokenURI;
        if (bytes(override_).length > 0) {
            return override_;
        }
        return string(abi.encodePacked(_baseTokenURI, tokenId.toString(), ".json"));
    }

    /**
     * @notice Update the base URI. Only callable by the owner.
     * @param baseURI_ New base URI string.
     */
    function setBaseURI(string calldata baseURI_) external onlyOwner {
        _baseTokenURI = baseURI_;
        emit URI(baseURI_, type(uint256).max); // signal global change
    }

    /**
     * @notice Set a per-token metadata URI override. Only callable by the owner.
     * @param tokenId  Token ID to update.
     * @param tokenURI New full URI string (e.g. `ipfs://<CID>`).
     */
    function setTokenURI(uint256 tokenId, string calldata tokenURI) external onlyOwner {
        require(_tokenInfo[tokenId].creator != address(0), "DecentNFT: token not registered");
        _tokenInfo[tokenId].tokenURI = tokenURI;
        emit URI(tokenURI, tokenId);
    }

    // -------------------------------------------------------------------------
    // Token registration
    // -------------------------------------------------------------------------

    /**
     * @notice Register a new token ID (product NFT). Only callable by the owner.
     * @param maxSupply_     Maximum editions allowed (0 = unlimited).
     * @param tokenURI_  Optional per-token URI override. Pass empty string to
     *                   use the base URI pattern.
     * @param royaltyReceiver  Per-token royalty receiver (address(0) = use default).
     * @param royaltyFeeBps    Per-token royalty in basis points (0 = use default).
     * @return tokenId   The newly registered token ID.
     */
    function registerToken(
        uint256 maxSupply_,
        string  calldata tokenURI_,
        address royaltyReceiver,
        uint96  royaltyFeeBps
    )
        external
        onlyOwner
        returns (uint256 tokenId)
    {
        tokenId = _nextTokenId++;

        _tokenInfo[tokenId] = TokenInfo({
            creator:   msg.sender,
            maxSupply: maxSupply_,
            minted:    0,
            tokenURI:  tokenURI_
        });

        if (royaltyReceiver != address(0)) {
            _setTokenRoyalty(tokenId, royaltyReceiver, royaltyFeeBps);
        }

        emit TokenRegistered(tokenId, msg.sender, maxSupply_, uri(tokenId));
    }

    // -------------------------------------------------------------------------
    // Minting — product editions (onlyOwner)
    // -------------------------------------------------------------------------

    /**
     * @notice Mint one or more editions of a registered token. Only callable by
     *         the owner (for product NFTs).
     * @param to       Recipient address.
     * @param tokenId  Token ID to mint.
     * @param amount   Number of editions to mint.
     */
    function mintEdition(
        address to,
        uint256 tokenId,
        uint256 amount
    )
        external
        onlyOwner
    {
        _mintChecked(to, tokenId, amount);
    }

    // -------------------------------------------------------------------------
    // Minting — user / self-mint (open)
    // -------------------------------------------------------------------------

    /**
     * @notice Mint editions of a token as a user. The token must have been
     *         registered and must not exceed its supply cap (if any).
     *         This is the open / user-mint path.
     * @param tokenId  Token ID to mint.
     * @param amount   Number of editions to mint.
     */
    function mintUser(uint256 tokenId, uint256 amount) external {
        _mintChecked(msg.sender, tokenId, amount);
    }

    // -------------------------------------------------------------------------
    // Internal mint helper
    // -------------------------------------------------------------------------

    function _mintChecked(
        address to,
        uint256 tokenId,
        uint256 amount
    ) internal {
        TokenInfo storage info = _tokenInfo[tokenId];
        require(info.creator != address(0), "DecentNFT: token not registered");
        require(amount > 0, "DecentNFT: amount must be > 0");

        if (info.maxSupply > 0) {
            require(
                info.minted + amount <= info.maxSupply,
                "DecentNFT: exceeds supply cap"
            );
        }

        info.minted += amount;
        _mint(to, tokenId, amount, "");

        emit EditionMinted(tokenId, to, amount, msg.sender);
    }

    // -------------------------------------------------------------------------
    // Royalty management
    // -------------------------------------------------------------------------

    /**
     * @notice Update the default royalty. Only callable by the owner.
     * @param receiver  Royalty receiver address.
     * @param feeBps    Fee in basis points.
     */
    function setDefaultRoyalty(address receiver, uint96 feeBps) external onlyOwner {
        _setDefaultRoyalty(receiver, feeBps);
    }

    /**
     * @notice Update the per-token royalty. Only callable by the owner.
     * @param tokenId   Token ID.
     * @param receiver  Royalty receiver address.
     * @param feeBps    Fee in basis points.
     */
    function setTokenRoyalty(
        uint256 tokenId,
        address receiver,
        uint96  feeBps
    ) external onlyOwner {
        _setTokenRoyalty(tokenId, receiver, feeBps);
    }

    // -------------------------------------------------------------------------
    // Read helpers
    // -------------------------------------------------------------------------

    /**
     * @notice Returns the total number of editions minted for `tokenId`.
     */
    function totalMinted(uint256 tokenId) external view returns (uint256) {
        return _tokenInfo[tokenId].minted;
    }

    /**
     * @notice Returns the maximum supply for `tokenId` (0 = unlimited).
     */
    function maxSupply(uint256 tokenId) external view returns (uint256) {
        return _tokenInfo[tokenId].maxSupply;
    }

    /**
     * @notice Returns the creator address recorded for `tokenId`.
     */
    function creatorOf(uint256 tokenId) external view returns (address) {
        return _tokenInfo[tokenId].creator;
    }

    /**
     * @notice Returns the next token ID that will be assigned on `registerToken`.
     */
    function nextTokenId() external view returns (uint256) {
        return _nextTokenId;
    }

    // -------------------------------------------------------------------------
    // ERC-165 interface detection
    // -------------------------------------------------------------------------

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC1155, ERC2981)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
