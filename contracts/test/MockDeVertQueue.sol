// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import "../DeVertQueue_v0.1.sol";

contract MockDeVertQueueCampaigns is IDeVertQueueCampaigns {
    mapping(uint256 => Campaign) private _campaigns;
    bool public paused;
    function setPaused(bool value) external { paused = value; }
    function setCampaign(uint256 id, address advertiser, uint64 expiresAt) external {
        _campaigns[id] = Campaign(advertiser, "Approved advert", "ipfs://approved-ad", uint64(block.timestamp), expiresAt, 0, 5000000, 5000000, 0, 0, 0);
    }
    function getCampaign(uint256 id) external view returns (Campaign memory) { return _campaigns[id]; }
}
