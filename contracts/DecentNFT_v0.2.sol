// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title DecentNFT_v0.2
 * @notice ERC-1155 editionable NFT contract for DecentMarket.
 *
 * Two token "lanes" are enforced on-chain:
 *
 *   Product  – private/admin-controlled (licenses, codebase access, provenance).
 *              Only DEFAULT_ADMIN_ROLE can register and mint these.
 *
 *   Achievement – runtime NFTs issued by authorized dapps (e.g. BigNuten streaks).
 *                 Admin registers the token IDs; MINTER_ROLE wallets issue them to
 *                 users at runtime.
 *
 * Role model
 * ----------
 *   DEFAULT_ADMIN_ROLE  Decent Agency admin (deployer by default).
 *                       Can register tokens, mint Product tokens, manage roles,
 *                       and update URIs / royalties.
 *   MINTER_ROLE         Authorized issuer wallets (e.g. BigNuten backend).
 *                       Can mint Achievement tokens; cannot register new token IDs.
 *
 * URI scheme
 * ----------
 *   Pass a base URI such as `ipfs://<rootCID>/` to the constructor.
 *   Each token's full metadata URI is then `<baseURI><tokenId>.json`.
 *   Override individual URIs with `setTokenURI`.
 */
contract DecentNFT_v0_2 is ERC1155, AccessControl, ERC2981 {
    using Strings for uint256;

    // -------------------------------------------------------------------------
    // Roles
    // -------------------------------------------------------------------------

    /// @notice Role for authorized dapp issuer wallets (Achievement minting).
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // -------------------------------------------------------------------------
    // Token classification
    // -------------------------------------------------------------------------

    /// @notice Classifies a registered token as a Product or Achievement NFT.
    enum TokenKind { Product, Achievement }

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /// @notice Emitted when a new token ID is registered by an admin.
    event TokenRegistered(
        uint256 indexed tokenId,
        address indexed creator,
        uint256 maxSupply,
        TokenKind kind,
        string uri
    );

    /// @notice Emitted whenever editions of any token are minted.
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
        address   creator;   // Original registering admin
        uint256   maxSupply; // 0 = unlimited
        uint256   minted;    // Total editions minted so far
        string    tokenURI;  // Per-token URI override (empty → use base URI pattern)
        TokenKind kind;      // Product or Achievement
    }

    /// @notice Base URI applied when no per-token override is set.
    string private _baseTokenURI;

    /// @notice Per-token metadata, supply, and classification.
    mapping(uint256 => TokenInfo) private _tokenInfo;

    /// @notice Auto-incrementing counter for the next token ID.
    uint256 private _nextTokenId;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /**
     * @param baseURI_        Base URI for all tokens, e.g. `ipfs://<rootCID>/`.
     *                        Each token's URI becomes `<baseURI><tokenId>.json`.
     * @param royaltyReceiver Address that receives secondary-sale royalties.
     * @param royaltyFeeBps   Royalty in basis points (e.g. 500 = 5 %).
     */
    constructor(
        string memory baseURI_,
        address royaltyReceiver,
        uint96  royaltyFeeBps
    )
        ERC1155(baseURI_)
    {
        _baseTokenURI = baseURI_;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
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
     * @notice Update the base URI. Only callable by DEFAULT_ADMIN_ROLE.
     * @param baseURI_ New base URI string.
     */
    function setBaseURI(string calldata baseURI_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _baseTokenURI = baseURI_;
        emit URI(baseURI_, type(uint256).max); // signal global change
    }

    /**
     * @notice Set a per-token metadata URI override. Only callable by DEFAULT_ADMIN_ROLE.
     * @param tokenId  Token ID to update.
     * @param tokenURI New full URI string (e.g. `ipfs://<CID>`).
     */
    function setTokenURI(uint256 tokenId, string calldata tokenURI) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_tokenInfo[tokenId].creator != address(0), "DecentNFT: token not registered");
        _tokenInfo[tokenId].tokenURI = tokenURI;
        emit URI(tokenURI, tokenId);
    }

    // -------------------------------------------------------------------------
    // Token registration (admin-only)
    // -------------------------------------------------------------------------

    /**
     * @notice Register a new token ID. Only DEFAULT_ADMIN_ROLE may call this,
     *         ensuring the token space cannot be polluted by unauthorized actors.
     * @param maxSupply_      Maximum editions allowed (0 = unlimited).
     * @param tokenURI_       Optional per-token URI override. Pass empty string to
     *                        use the base URI pattern.
     * @param kind_           `TokenKind.Product` or `TokenKind.Achievement`.
     * @param royaltyReceiver Per-token royalty receiver (address(0) = use default).
     * @param royaltyFeeBps   Per-token royalty in basis points (0 = use default).
     * @return tokenId        The newly registered token ID.
     */
    function registerToken(
        uint256   maxSupply_,
        string    calldata tokenURI_,
        TokenKind kind_,
        address   royaltyReceiver,
        uint96    royaltyFeeBps
    )
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        returns (uint256 tokenId)
    {
        tokenId = _nextTokenId++;

        _tokenInfo[tokenId] = TokenInfo({
            creator:   msg.sender,
            maxSupply: maxSupply_,
            minted:    0,
            tokenURI:  tokenURI_,
            kind:      kind_
        });

        if (royaltyReceiver != address(0)) {
            _setTokenRoyalty(tokenId, royaltyReceiver, royaltyFeeBps);
        }

        emit TokenRegistered(tokenId, msg.sender, maxSupply_, kind_, uri(tokenId));
    }

    // -------------------------------------------------------------------------
    // Lane A: Product minting (DEFAULT_ADMIN_ROLE only)
    // -------------------------------------------------------------------------

    /**
     * @notice Mint editions of a Product token. Restricted to DEFAULT_ADMIN_ROLE.
     *         Reverts if `tokenId` is not registered or is classified as Achievement.
     * @param to       Recipient address.
     * @param tokenId  Product token ID to mint.
     * @param amount   Number of editions to mint.
     */
    function mintProduct(
        address to,
        uint256 tokenId,
        uint256 amount
    )
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(_tokenInfo[tokenId].creator != address(0), "DecentNFT: token not registered");
        require(
            _tokenInfo[tokenId].kind == TokenKind.Product,
            "DecentNFT: not a Product token"
        );
        _mintChecked(to, tokenId, amount);
    }

    // -------------------------------------------------------------------------
    // Lane B: Achievement minting (MINTER_ROLE only)
    // -------------------------------------------------------------------------

    /**
     * @notice Mint editions of an Achievement token. Restricted to MINTER_ROLE.
     *         Reverts if `tokenId` is not registered or is classified as Product.
     * @param to       Recipient address.
     * @param tokenId  Achievement token ID to mint.
     * @param amount   Number of editions to mint.
     */
    function mintAchievement(
        address to,
        uint256 tokenId,
        uint256 amount
    )
        external
        onlyRole(MINTER_ROLE)
    {
        require(_tokenInfo[tokenId].creator != address(0), "DecentNFT: token not registered");
        require(
            _tokenInfo[tokenId].kind == TokenKind.Achievement,
            "DecentNFT: not an Achievement token"
        );
        _mintChecked(to, tokenId, amount);
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
    // Royalty management (admin-only)
    // -------------------------------------------------------------------------

    /**
     * @notice Update the default royalty. Only DEFAULT_ADMIN_ROLE may call this.
     * @param receiver Royalty receiver address.
     * @param feeBps   Fee in basis points.
     */
    function setDefaultRoyalty(address receiver, uint96 feeBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setDefaultRoyalty(receiver, feeBps);
    }

    /**
     * @notice Update the per-token royalty. Only DEFAULT_ADMIN_ROLE may call this.
     * @param tokenId  Token ID.
     * @param receiver Royalty receiver address.
     * @param feeBps   Fee in basis points.
     */
    function setTokenRoyalty(
        uint256 tokenId,
        address receiver,
        uint96  feeBps
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
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
     * @notice Returns the TokenKind (Product or Achievement) for `tokenId`.
     */
    function kindOf(uint256 tokenId) external view returns (TokenKind) {
        return _tokenInfo[tokenId].kind;
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
        override(ERC1155, ERC2981, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}

