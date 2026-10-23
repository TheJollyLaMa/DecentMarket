// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./DJukePlaylistModule.sol";

contract DJukeSponsoredPlaylistModule is DJukePlaylistModule {
    bool public constant WORKER_GAS_SPONSORED = true;
    event PlaylistBatchFeeProgress(uint256 indexed batchId, uint256 released, uint256 totalReleased);

    function _validateContribution(IDJukePlaylistHost, uint256 cost, uint256) internal view override {
        require(cost == 0 && msg.value == 0, "USDC payment only");
    }

    function _settleFee(PlaylistLaneStorage.State storage s, uint256 batchId) internal override {
        PlaylistLaneStorage.Batch storage batch = s.batches[batchId];
        if (batch.failed || batch.feeSettled || batch.feeRefunded) return;
        bool complete = batch.resolvedCount == batch.itemCount;
        uint256 target = complete ? batch.fee : (batch.resolvedCount / 4) * 1_000_000;
        if (target > batch.fee) target = batch.fee;
        uint256 released = target - s.releasedFee[batchId];
        if (released == 0) return;
        s.releasedFee[batchId] = target;
        if (complete) batch.feeSettled = true;
        _routeFee(released);
        emit PlaylistBatchFeeProgress(batchId, released, target);
        if (complete) emit PlaylistBatchFeeSettled(batchId, batch.fee, batch.fee / 4, batch.fee / 4,
            batch.fee / 4, batch.fee - 3 * (batch.fee / 4));
    }
}
