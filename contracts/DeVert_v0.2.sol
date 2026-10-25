pragma solidity ^0.8.26;

import "./DeVert_v0.1.sol";

contract DeVert_v0_2 is DeVert_v0_1 {
    string public constant CONTRACT_VERSION = "0.2";

    constructor(address token, address router, address djukeAddress, bytes32 playbackId, bytes32 topTenId,
        bytes32 pinnerId, bytes32 repoId, address admin, address scheduler)
        DeVert_v0_1(token, router, djukeAddress, playbackId, topTenId, pinnerId, repoId, admin, scheduler) {}

    function quoteSchedulerGasTopUp(uint256) public pure override returns (uint256) {
        return 0;
    }

    function _validateSchedulerGasTopUp() internal view override {
        require(msg.value == 0, "Worker ETH is platform-funded");
    }

    function _sendSchedulerGasTopUp(uint256) internal override {}
}
