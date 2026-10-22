// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./djuke/v04/DecentJukeBox_v0.2.sol";
import "./DJukePlaylistModule.sol";

/// @notice DJuke candidate preserving v0.2 behavior with a separately scheduled playlist lane.
contract DecentJukeBox_v0_4 is DecentJukeBox_v0_2_v04 {
    string public constant CONTRACT_VERSION = "0.4";

    struct ArtistLedger { uint256 totalPaid; uint256 payoutCount; }
    bytes32 private constant ARTIST_LEDGER_SLOT = keccak256("decentmarket.djuke.v0.4.artist-ledger.v1");
    event ArtistPaid(address indexed artist, uint256 amount, uint256 cumulativePaid);
    address public immutable playlistModule;
    bytes32 public immutable playbackFundId;
    bytes32 public immutable topTenFundId;

    event PlaylistBatchRequested(uint256 indexed batchId, address indexed payer, bytes32[] songIds,
        uint256 subtotal, uint256 fee, uint256 firstLaneId);
    event PlaylistSongDelivered(uint256 indexed laneId, uint256 indexed batchId, bytes32 indexed songId,
        uint256 amount, bytes32 playbackProof);
    event PlaylistSongRefunded(uint256 indexed laneId, uint256 indexed batchId, uint256 amount);
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

    function quote() public view override returns (uint256) {
        uint256 tier = (pendingCount() + playlistPendingCount()) / TIER_SIZE;
        require(tier <= 238);
        return BASE_PRICE * (uint256(1) << tier);
    }

    function playlistPendingCount() public view returns (uint256) {
        return PlaylistLaneStorage.state().playlistPendingCount;
    }

    function totalPendingCount() external view returns (uint256) {
        return pendingCount() + playlistPendingCount();
    }

    function playlistHeadId() external view returns (uint256) {
        return PlaylistLaneStorage.state().playlistHeadId;
    }

    function playlistNextId() external view returns (uint256) {
        return PlaylistLaneStorage.state().playlistNextId;
    }

    function getPlaylistItem(uint256 laneId) external view returns (uint256 batchId, bytes32 songId, address payer, uint256 amount, uint8 status) {
        require(laneId < PlaylistLaneStorage.state().playlistNextId, "Unknown playlist item");
        PlaylistLaneStorage.Item storage item = PlaylistLaneStorage.state().items[laneId];
        return (item.batchId, item.songId, item.payer, item.amount, item.status);
    }

    function quotePlaylist(bytes32[] calldata songIds, bool radio) external view returns (uint256 subtotal, uint256 fee, uint256 total) {
        return DJukePlaylistModule(playlistModule).quotePlaylist(address(this), songIds, radio);
    }

    function purchasePlaylistPrivate(bytes32[] calldata songIds, uint256 maxTotal) external whenNotPaused nonReentrant returns (uint256) {
        return abi.decode(_delegate(abi.encodeCall(DJukePlaylistModule.purchasePlaylistPrivate, (songIds, maxTotal))), (uint256));
    }

    function requestPlaylistWithGas(bytes32[] calldata songIds, uint256 maxTotal, uint256 fulfillmentCostWei,
        uint256 deadline, bytes calldata signature) external payable whenNotPaused nonReentrant returns (uint256) {
        return abi.decode(_delegate(abi.encodeCall(DJukePlaylistModule.requestPlaylistWithGas,
            (songIds, maxTotal, fulfillmentCostWei, deadline, signature))), (uint256));
    }

    function fulfillPlaylistSong(uint256 laneId, bytes32 expectedSongId, uint256 expectedRevision, bytes32 playbackProof)
        external onlyRole(FULFILLER_ROLE) nonReentrant {
        _delegate(abi.encodeCall(DJukePlaylistModule.fulfillPlaylistSong,
            (laneId, expectedSongId, expectedRevision, playbackProof)));
    }

    function refundUndeliveredPlaylist(uint256 batchId) external onlyRole(FULFILLER_ROLE) nonReentrant {
        _delegate(abi.encodeCall(DJukePlaylistModule.refundUndeliveredPlaylist, (batchId)));
    }

    function consumePlaylistNonce(address listener) external returns (uint256 nonce) {
        require(msg.sender == address(this), "Playlist module only");
        nonce = gasQuoteNonces[listener]++;
    }

    function playlistListenPrice(bytes32 songId) external view returns (uint256) {
        return _listenPrice(songId);
    }

    function settlePlaylistSong(address[] calldata recipients, uint16[] calldata sharesBps, uint256 amount, bytes32 proof) external {
        require(msg.sender == address(this), "Playlist module only");
        require(proof != bytes32(0) && !usedPlaybackProofs[proof], "Invalid playback proof");
        usedPlaybackProofs[proof] = true;
        uint256 artistAmount = amount * 9000 / 10000;
        uint256 repoAmount = amount * REPO_DEV_SHARE_BPS / 10000;
        address[] memory payees = recipients;
        uint16[] memory shares = sharesBps;
        _delegate(abi.encodeCall(DJukePlaylistModule.creditArtists, (payees, shares, artistAmount)));
        _depositRepoFund(repoAmount, amount - artistAmount - repoAmount, proof);
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

    function _delegate(bytes memory data) private returns (bytes memory result) {
        (bool ok, bytes memory returned) = playlistModule.delegatecall(data);
        if (!ok) assembly ("memory-safe") { revert(add(returned, 32), mload(returned)) }
        return returned;
    }
}
