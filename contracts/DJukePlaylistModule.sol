// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

library PlaylistLaneStorage {
    bytes32 internal constant SLOT = keccak256("decentbusking.djuke.playlists.v1");

    struct Batch {
        address payer;
        uint256 fee;
        uint256 itemCount;
        uint256 resolvedCount;
        bool failed;
        bool feeSettled;
        bool feeRefunded;
    }

    struct Item {
        uint256 batchId;
        bytes32 songId;
        address payer;
        uint256 amount;
        uint8 status;
        address[] recipients;
        uint16[] sharesBps;
    }

    struct State {
        uint256 playlistHeadId;
        uint256 playlistNextId;
        uint256 playlistPendingCount;
        uint256 nextBatchId;
        mapping(uint256 => Batch) batches;
        mapping(uint256 => Item) items;
        mapping(uint256 => uint256) batchFirstLane;
        mapping(uint256 => uint256) batchLaneCount;
        uint256 nextPrivatePurchaseId;
        mapping(uint256 => uint256) releasedFee;
    }

    function state() internal pure returns (State storage s) {
        bytes32 slot = SLOT;
        assembly ("memory-safe") { s.slot := slot }
    }
}

interface IDJukePlaylistHost {
    struct Song { string audioURI; bool enabled; address[] recipients; uint16[] sharesBps; }
    function paymentToken() external view returns (IERC20);
    function usedPlaybackProofs(bytes32 proof) external view returns (bool);
    function playbackFundId() external view returns (bytes32);
    function topTenFundId() external view returns (bytes32);
    function fundRouter() external view returns (address);
    function repoFundId() external view returns (bytes32);
    function pinnerFundId() external view returns (bytes32);
    function gasWorker() external view returns (address payable);
    function maxGasContributionWei() external view returns (uint256);
    function getSong(bytes32 songId) external view returns (Song memory);
    function playlistListenPrice(bytes32 songId) external view returns (uint256);
    function consumePlaylistNonce(address listener) external returns (uint256);
    function settlePlaylistSong(address[] calldata recipients, uint16[] calldata sharesBps, uint256 amount, bytes32 proof) external;
}

interface IDJukePlaylistRouter {
    function fundToken(bytes32 fundId, address asset, uint256 amount) external;
}

/// @dev Delegate-called by the DJuke candidate so playlist logic remains below EIP-170 size.
contract DJukePlaylistModule {
    using SafeERC20 for IERC20;

    bytes32 public constant PLAYLIST_GAS_QUOTE_TYPEHASH = keccak256(
        "PlaylistGasQuote(address listener,bytes32 songIdsHash,uint256 maxTotal,uint256 fulfillmentCostWei,uint256 nonce,uint256 deadline)"
    );
    uint256 public constant MAX_PLAYLIST_SONGS = 24;
    uint256 public constant PLAYLIST_BASE_RATE = 250_000;
    uint256 public constant RADIO_PLAYLIST_FEE = 3_000_000;
    bytes32 private constant ARTIST_LEDGER_SLOT = keccak256("decentmarket.djuke.v0.4.artist-ledger.v1");

    event PlaylistBatchRequested(uint256 indexed batchId, address indexed payer, bytes32[] songIds,
        uint256 subtotal, uint256 fee, uint256 firstLaneId);
    event PlaylistSongDelivered(uint256 indexed laneId, uint256 indexed batchId, bytes32 indexed songId,
        uint256 amount, bytes32 playbackProof);
    event PlaylistSongRefunded(uint256 indexed laneId, uint256 indexed batchId, uint256 amount);
    event PlaylistBatchFeeSettled(uint256 indexed batchId, uint256 fee, uint256 playback, uint256 topTen,
        uint256 pinners, uint256 repoDev);
    event PlaylistBatchFeeRefunded(uint256 indexed batchId, address indexed payer, uint256 fee);
    event WorkerGasFunded(uint256 indexed laneId, address indexed listener, address indexed worker, uint256 amount);
    event PlaylistPrivatePurchased(uint256 indexed purchaseId, address indexed listener, bytes32[] songIds, uint256 amount);
    event ArtistPaid(address indexed artist, uint256 amount, uint256 cumulativePaid);

    function quotePlaylist(address hostAddress, bytes32[] calldata songIds, bool radio)
        external view returns (uint256 subtotal, uint256 fee, uint256 total)
    {
        _validate(songIds);
        if (radio) {
            for (uint256 i; i < songIds.length; ++i) subtotal += PLAYLIST_BASE_RATE << (i / 8);
            fee = RADIO_PLAYLIST_FEE * ((songIds.length + 11) / 12);
        } else {
            IDJukePlaylistHost host = IDJukePlaylistHost(hostAddress);
            for (uint256 i; i < songIds.length; ++i) subtotal += host.playlistListenPrice(songIds[i]);
        }
        total = subtotal + fee;
    }

    function requestPlaylistWithGas(bytes32[] calldata songIds, uint256 maxTotal, uint256 fulfillmentCostWei,
        uint256 deadline, bytes calldata signature) external payable returns (uint256 batchId)
    {
        _validate(songIds);
        uint256 subtotal;
        for (uint256 i; i < songIds.length; ++i) subtotal += PLAYLIST_BASE_RATE << (i / 8);
        uint256 fee = RADIO_PLAYLIST_FEE * ((songIds.length + 11) / 12);
        uint256 total = subtotal + fee;
        require(total <= maxTotal, "Price exceeds approval");
        require(deadline >= block.timestamp && deadline <= block.timestamp + 5 minutes, "Expired or invalid gas quote");
        IDJukePlaylistHost host = IDJukePlaylistHost(address(this));
        _validateContribution(host, fulfillmentCostWei, songIds.length);
        for (uint256 i; i < songIds.length; ++i) require(host.getSong(songIds[i]).enabled, "Song unavailable");

        uint256 nonce = host.consumePlaylistNonce(msg.sender);
        bytes32 structHash = keccak256(abi.encode(PLAYLIST_GAS_QUOTE_TYPEHASH, msg.sender,
            keccak256(abi.encode(songIds)), maxTotal, fulfillmentCostWei, nonce, deadline));
        bytes32 domain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("DecentJukeBox"), keccak256("0.2"), block.chainid, address(this)));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        require(SignatureChecker.isValidSignatureNow(host.gasWorker(), digest, signature), "Invalid playlist gas quote signature");

        IERC20 token = host.paymentToken();
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), total);
        require(token.balanceOf(address(this)) - beforeBalance == total, "Exact payment required");

        PlaylistLaneStorage.State storage s = PlaylistLaneStorage.state();
        batchId = s.nextBatchId++;
        uint256 firstLaneId = s.playlistNextId;
        s.batches[batchId] = PlaylistLaneStorage.Batch(msg.sender, fee, songIds.length, 0, false, false, false);
        s.batchFirstLane[batchId] = firstLaneId;
        s.batchLaneCount[batchId] = songIds.length;
        for (uint256 i; i < songIds.length; ++i) {
            IDJukePlaylistHost.Song memory song = host.getSong(songIds[i]);
            uint256 amount = PLAYLIST_BASE_RATE << (i / 8);
            uint256 laneId = s.playlistNextId++;
            PlaylistLaneStorage.Item storage item = s.items[laneId];
            item.batchId = batchId;
            item.songId = songIds[i];
            item.payer = msg.sender;
            item.amount = amount;
            item.recipients = song.recipients;
            item.sharesBps = song.sharesBps;
        }
        s.playlistPendingCount += songIds.length;
        if (msg.value > 0) {
            (bool sent,) = host.gasWorker().call{value: msg.value}("");
            require(sent, "Worker funding failed");
            emit WorkerGasFunded(firstLaneId, msg.sender, host.gasWorker(), msg.value);
        }
        emit PlaylistBatchRequested(batchId, msg.sender, songIds, subtotal, fee, firstLaneId);
    }

    function fulfillPlaylistSong(uint256 laneId, bytes32 expectedSongId, uint256 expectedRevision, bytes32 playbackProof) external {
        require(expectedRevision == 0, "Playlist revision mismatch");
        PlaylistLaneStorage.State storage s = PlaylistLaneStorage.state();
        require(_mainPendingCount() == 0, "Main lane is not empty");
        require(laneId == s.playlistHeadId && laneId < s.playlistNextId, "Playlist lane is not head");
        PlaylistLaneStorage.Item storage item = s.items[laneId];
        require(item.status == 0 && item.songId == expectedSongId, "Playlist song mismatch");
        require(playbackProof != bytes32(0) && !IDJukePlaylistHost(address(this)).usedPlaybackProofs(playbackProof), "Invalid playback proof");
        item.status = 1;
        s.batches[item.batchId].resolvedCount++;
        s.playlistPendingCount--;
        IDJukePlaylistHost(address(this)).settlePlaylistSong(item.recipients, item.sharesBps, item.amount, playbackProof);
        _advanceHead(s);
        emit PlaylistSongDelivered(laneId, item.batchId, item.songId, item.amount, playbackProof);
        _settleFee(s, item.batchId);
    }

    function refundUndeliveredPlaylist(uint256 batchId) external {
        PlaylistLaneStorage.State storage s = PlaylistLaneStorage.state();
        PlaylistLaneStorage.Batch storage batch = s.batches[batchId];
        require(batch.itemCount > 0 && !batch.feeSettled && !batch.feeRefunded, "Playlist refund unavailable");
        uint256 first = s.batchFirstLane[batchId];
        uint256 end = first + s.batchLaneCount[batchId];
        uint256 remaining;
        IERC20 token = IDJukePlaylistHost(address(this)).paymentToken();
        for (uint256 laneId = first; laneId < end; ++laneId) {
            PlaylistLaneStorage.Item storage item = s.items[laneId];
            if (item.status == 0) {
                item.status = 2;
                batch.resolvedCount++;
                remaining++;
                s.playlistPendingCount--;
                token.safeTransfer(item.payer, item.amount);
                emit PlaylistSongRefunded(laneId, batchId, item.amount);
            }
        }
        require(remaining > 0, "Playlist already resolved");
        batch.failed = true;
        batch.feeRefunded = true;
        uint256 refundableFee = batch.fee - s.releasedFee[batchId];
        token.safeTransfer(batch.payer, refundableFee);
        _advanceHead(s);
        emit PlaylistBatchFeeRefunded(batchId, batch.payer, refundableFee);
    }

    function purchasePlaylistPrivate(bytes32[] calldata songIds, uint256 maxTotal) external returns (uint256 purchaseId) {
        _validate(songIds);
        IDJukePlaylistHost host = IDJukePlaylistHost(address(this));
        uint256 total;
        for (uint256 i; i < songIds.length; ++i) total += host.playlistListenPrice(songIds[i]);
        require(total <= maxTotal, "Price exceeds approval");
        for (uint256 i; i < songIds.length; ++i) require(host.getSong(songIds[i]).enabled, "Song unavailable");
        IERC20 token = host.paymentToken();
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), total);
        require(token.balanceOf(address(this)) - beforeBalance == total, "Exact payment required");

        uint256 repoAmount;
        uint256 pinnerAmount;
        for (uint256 i; i < songIds.length; ++i) {
            IDJukePlaylistHost.Song memory song = host.getSong(songIds[i]);
            uint256 price = host.playlistListenPrice(songIds[i]);
            uint256 artistAmount = price * 9000 / 10000;
            _creditArtists(song.recipients, song.sharesBps, artistAmount);
            uint256 repoShare = price * 200 / 10000;
            repoAmount += repoShare;
            pinnerAmount += price - artistAmount - repoShare;
        }
        _fund(host, host.repoFundId(), repoAmount);
        _fund(host, host.pinnerFundId(), pinnerAmount);
        purchaseId = PlaylistLaneStorage.state().nextPrivatePurchaseId++;
        emit PlaylistPrivatePurchased(purchaseId, msg.sender, songIds, total);
    }

    function creditArtists(address[] calldata recipients, uint16[] calldata shares, uint256 amount) external {
        _creditArtists(recipients, shares, amount);
    }

    function _creditArtists(address[] memory recipients, uint16[] memory shares, uint256 amount) private {
        require(recipients.length > 0 && recipients.length == shares.length, "Invalid artist split");
        uint256 paid;
        IDJukePlaylistHost host = IDJukePlaylistHost(address(this));
        for (uint256 i; i < recipients.length; ++i) {
            uint256 share = i + 1 == recipients.length ? amount - paid : amount * shares[i] / 10000;
            paid += share;
            if (share > 0) {
                bytes32 slot = keccak256(abi.encode(recipients[i], ARTIST_LEDGER_SLOT));
                uint256 cumulative;
                assembly ("memory-safe") {
                    cumulative := add(sload(slot), share)
                    sstore(slot, cumulative)
                    sstore(add(slot, 1), add(sload(add(slot, 1)), 1))
                }
                IERC20(host.paymentToken()).safeTransfer(recipients[i], share);
                emit ArtistPaid(recipients[i], share, cumulative);
            }
        }
    }

    function _validateContribution(IDJukePlaylistHost host, uint256 cost, uint256 count) internal view virtual {
        require(cost > 0 && cost <= host.maxGasContributionWei() / 2, "Gas contribution exceeds cap");
        require(msg.value == cost * 2 * count, "Exact batch gas contribution required");
    }

    function _settleFee(PlaylistLaneStorage.State storage s, uint256 batchId) internal virtual {
        PlaylistLaneStorage.Batch storage batch = s.batches[batchId];
        if (batch.resolvedCount != batch.itemCount || batch.failed || batch.feeSettled || batch.feeRefunded) return;
        batch.feeSettled = true;
        s.releasedFee[batchId] = batch.fee;
        _routeFee(batch.fee);
        emit PlaylistBatchFeeSettled(batchId, batch.fee, batch.fee / 4, batch.fee / 4,
            batch.fee / 4, batch.fee - 3 * (batch.fee / 4));
    }

    function _routeFee(uint256 fee) internal {
        uint256 playback = fee / 4;
        uint256 topTen = fee / 4;
        uint256 pinners = fee / 4;
        uint256 repoDev = fee - playback - topTen - pinners;
        IDJukePlaylistHost host = IDJukePlaylistHost(address(this));
        IERC20 token = host.paymentToken();
        IDJukePlaylistRouter router = IDJukePlaylistRouter(host.fundRouter());
        token.forceApprove(address(router), fee);
        router.fundToken(host.playbackFundId(), address(token), playback);
        router.fundToken(host.topTenFundId(), address(token), topTen);
        router.fundToken(host.pinnerFundId(), address(token), pinners);
        router.fundToken(host.repoFundId(), address(token), repoDev);
        token.forceApprove(address(router), 0);
    }

    function _fund(IDJukePlaylistHost host, bytes32 fundId, uint256 amount) private {
        if (amount == 0) return;
        IERC20 token = host.paymentToken();
        IDJukePlaylistRouter router = IDJukePlaylistRouter(host.fundRouter());
        token.forceApprove(address(router), amount);
        router.fundToken(fundId, address(token), amount);
        token.forceApprove(address(router), 0);
    }

    function _advanceHead(PlaylistLaneStorage.State storage s) private {
        while (s.playlistHeadId < s.playlistNextId && s.items[s.playlistHeadId].status != 0) ++s.playlistHeadId;
    }

    function _mainPendingCount() private view returns (uint256) {
        (bool ok, bytes memory data) = address(this).staticcall(abi.encodeWithSignature("pendingCount()"));
        require(ok, "Could not read main lane");
        return abi.decode(data, (uint256));
    }

    function _validate(bytes32[] calldata songIds) private pure {
        require(songIds.length > 0 && songIds.length <= MAX_PLAYLIST_SONGS, "Playlist must contain 1-24 songs");
        for (uint256 i; i < songIds.length; ++i) {
            require(songIds[i] != bytes32(0), "Invalid song");
            for (uint256 j; j < i; ++j) require(songIds[i] != songIds[j], "Duplicate playlist song");
        }
    }
}
