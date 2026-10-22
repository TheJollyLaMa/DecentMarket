// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

interface IDJukePlaylistHost {
    struct Song { string audioURI; bool enabled; address[] recipients; uint16[] sharesBps; }
    function paymentToken() external view returns (IERC20);
    function fundRouter() external view returns (address);
    function repoFundId() external view returns (bytes32);
    function pinnerFundId() external view returns (bytes32);
    function gasWorker() external view returns (address payable);
    function maxGasContributionWei() external view returns (uint256);
    function getSong(bytes32 songId) external view returns (Song memory);
    function enqueuePlaylistSong(bytes32 songId, address payer) external returns (uint256);
    function creditPlaylistArtists(address[] calldata recipients, uint16[] calldata shares, uint256 amount) external;
    function refundPlaylistRequest(uint256 requestId) external;
    function consumePlaylistNonce(address listener) external returns (uint256);
}

interface IDJukePlaylistRouter {
    function fundToken(bytes32 fundId, address asset, uint256 amount) external;
}

/// @dev Delegate-called by the DJuke candidate so its payout/queue logic remains below EIP-170 size.
contract DJukePlaylistModule {
    using SafeERC20 for IERC20;

    bytes32 public constant PLAYLIST_GAS_QUOTE_TYPEHASH = keccak256(
        "PlaylistGasQuote(address listener,bytes32 songIdsHash,uint256 maxTotal,uint256 fulfillmentCostWei,uint256 nonce,uint256 deadline)"
    );
    uint256 public constant MAX_PLAYLIST_SONGS = 10;
    uint256 public constant PLAYLIST_BASE_RATE = 250_000;
    uint256 public constant RADIO_PLAYLIST_FEE = 5_000_000;
    bytes32 private constant MODULE_STORAGE_SLOT = keccak256("decentbusking.djuke.playlists.v1");

    struct Batch {
        address payer;
        uint256 fee;
        uint256 itemCount;
        uint256 resolvedCount;
        bool failed;
        bool feeSettled;
        bool feeRefunded;
    }
    struct State {
        uint256 nextBatchId;
        mapping(uint256 => Batch) batches;
        mapping(uint256 => uint256) batchForRequest;
        uint256 nextPrivatePurchaseId;
    }

    event PlaylistBatchRequested(uint256 indexed batchId, address indexed payer, bytes32[] songIds,
        uint256 baseSubtotal, uint256 radioFee, uint256 firstRequestId);
    event PlaylistBatchFeeSettled(uint256 indexed batchId, uint256 fee, uint256 playback, uint256 topTen,
        uint256 pinners, uint256 repoDev);
    event PlaylistBatchFeeRefunded(uint256 indexed batchId, address indexed payer, uint256 fee);
    event WorkerGasFunded(uint256 indexed requestId, address indexed listener, address indexed worker, uint256 amount);
    event PlaylistPrivatePurchased(uint256 indexed purchaseId, address indexed listener, bytes32[] songIds, uint256 amount);

    function state() private pure returns (State storage s) {
        bytes32 slot = MODULE_STORAGE_SLOT;
        assembly ("memory-safe") { s.slot := slot }
    }

    function quotePlaylist(bytes32[] calldata songIds, bool radio) external pure returns (uint256 subtotal, uint256 fee, uint256 total) {
        _validate(songIds);
        subtotal = PLAYLIST_BASE_RATE * songIds.length;
        fee = radio ? RADIO_PLAYLIST_FEE : 0;
        total = subtotal + fee;
    }

    function requestPlaylistWithGas(bytes32[] calldata songIds, uint256 maxTotal, uint256 fulfillmentCostWei,
        uint256 deadline, bytes calldata signature) external payable returns (uint256 batchId) {
        _validate(songIds);
        uint256 subtotal = PLAYLIST_BASE_RATE * songIds.length;
        uint256 total = subtotal + RADIO_PLAYLIST_FEE;
        require(total <= maxTotal, "Price exceeds approval");
        require(deadline >= block.timestamp && deadline <= block.timestamp + 5 minutes, "Expired or invalid gas quote");
        IDJukePlaylistHost host = IDJukePlaylistHost(address(this));
        uint256 maxGas = host.maxGasContributionWei();
        require(fulfillmentCostWei > 0 && fulfillmentCostWei <= maxGas / 2, "Gas contribution exceeds cap");
        require(msg.value == fulfillmentCostWei * 2 * songIds.length, "Exact batch gas contribution required");
        for (uint256 i; i < songIds.length; ++i) {
            IDJukePlaylistHost.Song memory song = host.getSong(songIds[i]);
            require(song.enabled, "Song unavailable");
        }
        State storage s = state();
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
        batchId = s.nextBatchId++;
        s.batches[batchId] = Batch(msg.sender, RADIO_PLAYLIST_FEE, songIds.length, 0, false, false, false);
        uint256 firstRequestId = _nextRequestId(host);
        for (uint256 i; i < songIds.length; ++i) {
            uint256 requestId = host.enqueuePlaylistSong(songIds[i], msg.sender);
            s.batchForRequest[requestId] = batchId + 1;
        }
        (bool sent,) = host.gasWorker().call{value: msg.value}("");
        require(sent, "Worker funding failed");
        emit WorkerGasFunded(firstRequestId, msg.sender, host.gasWorker(), msg.value);
        emit PlaylistBatchRequested(batchId, msg.sender, songIds, subtotal, RADIO_PLAYLIST_FEE, firstRequestId);
    }

    function purchasePlaylistPrivate(bytes32[] calldata songIds, uint256 maxTotal) external returns (uint256 purchaseId) {
        _validate(songIds);
        uint256 total = PLAYLIST_BASE_RATE * songIds.length;
        require(total <= maxTotal, "Price exceeds approval");
        IDJukePlaylistHost host = IDJukePlaylistHost(address(this));
        IERC20 token = host.paymentToken();
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), total);
        require(token.balanceOf(address(this)) - beforeBalance == total, "Exact payment required");
        uint256 repoAmount;
        uint256 pinnerAmount;
        for (uint256 i; i < songIds.length; ++i) {
            IDJukePlaylistHost.Song memory song = host.getSong(songIds[i]);
            require(song.enabled && bytes(song.audioURI).length > 0, "Song unavailable");
            uint256 artistAmount = PLAYLIST_BASE_RATE * 9000 / 10000;
            host.creditPlaylistArtists(song.recipients, song.sharesBps, artistAmount);
            uint256 repoShare = PLAYLIST_BASE_RATE * 200 / 10000;
            repoAmount += repoShare;
            pinnerAmount += PLAYLIST_BASE_RATE - artistAmount - repoShare;
        }
        _fund(host, host.repoFundId(), repoAmount);
        _fund(host, host.pinnerFundId(), pinnerAmount);
        purchaseId = state().nextPrivatePurchaseId++;
        emit PlaylistPrivatePurchased(purchaseId, msg.sender, songIds, total);
    }

    function refundUndeliveredPlaylist(uint256 batchId) external {
        State storage s = state();
        Batch storage batch = s.batches[batchId];
        require(batch.itemCount > 0 && !batch.feeSettled && !batch.feeRefunded, "Playlist refund unavailable");
        uint256 remaining = batch.itemCount - batch.resolvedCount;
        require(remaining > 0, "Playlist already resolved");
        batch.failed = true;
        IDJukePlaylistHost host = IDJukePlaylistHost(address(this));
        for (uint256 i; i < remaining; ++i) {
            uint256 requestId = _headRequestId(host);
            require(s.batchForRequest[requestId] == batchId + 1, "Playlist must be FIFO head");
            host.refundPlaylistRequest(requestId);
        }
        batch.feeRefunded = true;
        host.paymentToken().safeTransfer(batch.payer, batch.fee);
        emit PlaylistBatchFeeRefunded(batchId, batch.payer, batch.fee);
    }

    function afterRequestResolved(uint256 requestId, bool delivered, bytes32 playbackFundId, bytes32 topTenFundId) external {
        State storage s = state();
        uint256 encodedBatch = s.batchForRequest[requestId];
        if (encodedBatch == 0) return;
        Batch storage batch = s.batches[encodedBatch - 1];
        batch.resolvedCount++;
        if (!delivered) batch.failed = true;
        if (delivered && batch.resolvedCount == batch.itemCount && !batch.failed && !batch.feeSettled) {
            batch.feeSettled = true;
            uint256 playback = batch.fee * 4500 / 10000;
            uint256 topTen = batch.fee * 4500 / 10000;
            uint256 pinners = batch.fee * 800 / 10000;
            uint256 repoDev = batch.fee - playback - topTen - pinners;
            IDukeRouter router = IDukeRouter(IDJukePlaylistHost(address(this)).fundRouter());
            IERC20 token = IDJukePlaylistHost(address(this)).paymentToken();
            token.forceApprove(address(router), batch.fee);
            router.fundToken(playbackFundId, address(token), playback);
            router.fundToken(topTenFundId, address(token), topTen);
            router.fundToken(IDJukePlaylistHost(address(this)).pinnerFundId(), address(token), pinners);
            router.fundToken(IDJukePlaylistHost(address(this)).repoFundId(), address(token), repoDev);
            token.forceApprove(address(router), 0);
            emit PlaylistBatchFeeSettled(encodedBatch - 1, batch.fee, playback, topTen, pinners, repoDev);
        }
    }

    function _fund(IDJukePlaylistHost host, bytes32 fundId, uint256 amount) private {
        if (amount == 0) return;
        IERC20 token = host.paymentToken();
        IDukeRouter router = IDukeRouter(host.fundRouter());
        token.forceApprove(address(router), amount);
        router.fundToken(fundId, address(token), amount);
        token.forceApprove(address(router), 0);
    }

    function _nextRequestId(IDJukePlaylistHost host) private view returns (uint256) {
        (bool ok, bytes memory data) = address(host).staticcall(abi.encodeWithSignature("nextRequestId()"));
        require(ok, "Could not read queue");
        return abi.decode(data, (uint256));
    }

    function _headRequestId(IDJukePlaylistHost host) private view returns (uint256) {
        (bool ok, bytes memory data) = address(host).staticcall(abi.encodeWithSignature("headRequestId()"));
        require(ok, "Could not read queue");
        return abi.decode(data, (uint256));
    }

    function _validate(bytes32[] calldata songIds) private pure {
        require(songIds.length > 0 && songIds.length <= MAX_PLAYLIST_SONGS, "Playlist must contain 1-10 songs");
        for (uint256 i; i < songIds.length; ++i) {
            require(songIds[i] != bytes32(0), "Invalid song");
            for (uint256 j; j < i; ++j) require(songIds[i] != songIds[j], "Duplicate playlist song");
        }
    }
}

interface IDukeRouter { function fundToken(bytes32 fundId, address asset, uint256 amount) external; }
