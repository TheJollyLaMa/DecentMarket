// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./DecentJukeBox_v0.4.sol";
import "./DJukeSponsoredPlaylistModule.sol";

/// @notice Platform-funded execution; listeners pay USDC and their own transaction gas only.
contract DecentJukeBox_v0_5 is DecentJukeBox_v0_4 {
    constructor(address token, address router, bytes32 repoId, bytes32 pinnerId, address admin,
        address payable worker, uint256 gasContributionCap, address module, bytes32 playbackFund, bytes32 topTenFund)
        DecentJukeBox_v0_4(token, router, repoId, pinnerId, admin, worker, gasContributionCap, module, playbackFund, topTenFund) {
        require(DJukeSponsoredPlaylistModule(module).WORKER_GAS_SPONSORED(), "Sponsored playlist module required");
    }

    function CONTRACT_VERSION() public pure override returns (string memory) { return "0.5"; }

    function requestPlayWithGas(bytes32 songId, uint256 maxPrice, uint256 fulfillmentCostWei,
        uint256 deadline, bytes calldata signature) external payable override whenNotPaused nonReentrant returns (uint256 requestId) {
        require(fulfillmentCostWei == 0 && msg.value == 0, "Worker gas is platform funded");
        require(deadline >= block.timestamp && deadline <= block.timestamp + 5 minutes, "Expired quote");
        uint256 nonce = gasQuoteNonces[msg.sender]++;
        bytes32 digest = gasQuoteDigest(msg.sender, songId, maxPrice, 0, nonce, deadline);
        require(SignatureChecker.isValidSignatureNow(gasWorker, digest, signature), "Invalid worker quote");
        return _requestPlay(songId, maxPrice);
    }
}
