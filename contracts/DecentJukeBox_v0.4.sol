// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./djuke/v04/DecentJukeBox_v0.2.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./DJukePlaylistModule.sol";

/// @notice DJuke candidate preserving v0.2 behavior with capability-gated named playlist checkout.
contract DecentJukeBox_v0_4 is DecentJukeBox_v0_2_v04 {
    using SafeERC20 for IERC20;
    string public constant CONTRACT_VERSION = "0.4";

    struct ArtistLedger { uint256 totalPaid; uint256 payoutCount; }
    bytes32 private constant ARTIST_LEDGER_SLOT = keccak256("decentmarket.djuke.v0.4.artist-ledger.v1");
    event ArtistPaid(address indexed artist, uint256 amount, uint256 cumulativePaid);
    uint256 private constant MAX_PLAYLIST_SONGS = 10;
    uint256 private constant PLAYLIST_BASE_RATE = 250_000;
    uint256 private constant RADIO_PLAYLIST_FEE = 5_000_000;
    address public immutable playlistModule;
    bytes32 public immutable playbackFundId;
    bytes32 public immutable topTenFundId;

    event PlaylistBatchRequested(uint256 indexed batchId, address indexed payer, bytes32[] songIds,
        uint256 baseSubtotal, uint256 radioFee, uint256 firstRequestId);
    event PlaylistBatchFeeSettled(uint256 indexed batchId, uint256 fee, uint256 playback, uint256 topTen,
        uint256 pinners, uint256 repoDev);
    event PlaylistBatchFeeRefunded(uint256 indexed batchId, address indexed payer, uint256 fee);
    event PlaylistPrivatePurchased(uint256 indexed purchaseId, address indexed listener, bytes32[] songIds, uint256 amount);

    constructor(address token, address router, bytes32 repoId, bytes32 pinnerId, address admin,
        address payable worker, uint256 gasContributionCap, address module, bytes32 playbackFund, bytes32 topTenFund)
        DecentJukeBox_v0_2_v04(token, router, repoId, pinnerId, admin, worker, gasContributionCap) {
        require(module.code.length > 0 && playbackFund != bytes32(0) && topTenFund != bytes32(0) && playbackFund != topTenFund,
            "Invalid playlist module or funds");
        playlistModule = module;
        playbackFundId = playbackFund;
        topTenFundId = topTenFund;
    }

    function quotePlaylist(bytes32[] calldata songIds, bool radio) external view returns (uint256, uint256, uint256) {
        return DJukePlaylistModule(playlistModule).quotePlaylist(songIds, radio);
    }

    function purchasePlaylistPrivate(bytes32[] calldata songIds, uint256 maxTotal) external whenNotPaused nonReentrant returns (uint256) {
        return abi.decode(_delegate(abi.encodeCall(DJukePlaylistModule.purchasePlaylistPrivate, (songIds, maxTotal))), (uint256));
    }

    function requestPlaylistWithGas(bytes32[] calldata songIds, uint256 maxTotal, uint256 fulfillmentCostWei,
        uint256 deadline, bytes calldata signature) external payable whenNotPaused nonReentrant returns (uint256) {
        return abi.decode(_delegate(abi.encodeCall(DJukePlaylistModule.requestPlaylistWithGas,
            (songIds, maxTotal, fulfillmentCostWei, deadline, signature))), (uint256));
    }

    function refundUndeliveredPlaylist(uint256 batchId) external onlyRole(FULFILLER_ROLE) {
        _delegate(abi.encodeCall(DJukePlaylistModule.refundUndeliveredPlaylist, (batchId)));
    }

    function enqueuePlaylistSong(bytes32 songId, address payer) external returns (uint256 requestId) {
        require(msg.sender == address(this) && payer != address(0), "Playlist module only");
        Song storage song = _songs[songId];
        require(song.enabled, "Song unavailable");
        requestId = nextRequestId++;
        Request storage request = _requests[requestId];
        request.songId = songId;
        request.payer = payer;
        request.amount = PLAYLIST_BASE_RATE;
        request.recipients = song.recipients;
        request.sharesBps = song.sharesBps;
        emit PlayRequested(requestId, songId, payer, PLAYLIST_BASE_RATE);
    }

    function refundPlaylistRequest(uint256 requestId) external {
        require(msg.sender == address(this), "Playlist module only");
        _refundRequestAtHead(requestId);
    }

    function consumePlaylistNonce(address listener) external returns (uint256 nonce) {
        require(msg.sender == address(this), "Playlist module only");
        nonce = gasQuoteNonces[listener]++;
    }

    function artistLedger(address artist) external view returns (uint256 totalPaid, uint256 payoutCount) {
        bytes32 slot = keccak256(abi.encode(artist, ARTIST_LEDGER_SLOT));
        assembly ("memory-safe") { totalPaid := sload(slot) payoutCount := sload(add(slot, 1)) }
    }

    function _creditArtists(address[] storage recipients, uint16[] storage sharesBps, uint256 artistAmount) internal override {
        address[] memory payees = recipients;
        uint16[] memory shares = sharesBps;
        _delegate(abi.encodeCall(DJukePlaylistModule.creditArtists, (payees, shares, artistAmount)));
    }

    function _afterRequestResolved(uint256 requestId, Request storage, bool delivered) internal override {
        _delegate(abi.encodeCall(DJukePlaylistModule.afterRequestResolved,
            (requestId, delivered, playbackFundId, topTenFundId)));
    }

    function _delegate(bytes memory data) private returns (bytes memory result) {
        (bool ok, bytes memory returned) = playlistModule.delegatecall(data);
        if (!ok) assembly ("memory-safe") { revert(add(returned, 32), mload(returned)) }
        return returned;
    }
}
