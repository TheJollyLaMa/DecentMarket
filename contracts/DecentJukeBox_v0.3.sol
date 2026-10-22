// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./DecentJukeBox_v0.2.sol";
import "./DJukePlaylistModule.sol";

/// @notice DJuke candidate preserving v0.2 behavior with capability-gated named playlist checkout.
contract DecentJukeBox_v0_3 is DecentJukeBox_v0_2 {
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
        DecentJukeBox_v0_2(token, router, repoId, pinnerId, admin, worker, gasContributionCap) {
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

    function creditPlaylistArtists(address[] calldata recipients, uint16[] calldata shares, uint256 amount) external {
        require(msg.sender == address(this) && recipients.length > 0 && recipients.length == shares.length, "Playlist module only");
        uint256 credited;
        for (uint256 i; i < recipients.length; ++i) {
            uint256 share = i + 1 == recipients.length ? amount - credited : amount * shares[i] / 10000;
            credited += share;
            artistCredits[recipients[i]] += share;
        }
    }

    function refundPlaylistRequest(uint256 requestId) external {
        require(msg.sender == address(this), "Playlist module only");
        _refundRequestAtHead(requestId);
    }

    function consumePlaylistNonce(address listener) external returns (uint256 nonce) {
        require(msg.sender == address(this), "Playlist module only");
        nonce = gasQuoteNonces[listener]++;
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
