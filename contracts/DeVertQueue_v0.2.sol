// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./DeVertQueue_v0.1.sol";

contract DeVertQueue_v0_2 is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant FULFILLER_ROLE = keccak256("FULFILLER_ROLE");
    uint256 public constant MAX_PENDING = 128;
    uint256 public constant queueVersion = 2;
    IERC20 public immutable paymentToken;
    IDeVertQueueCampaigns public immutable campaigns;
    IDeVertQueueRouter public immutable fundRouter;
    bytes32 public immutable playbackFundId;
    bytes32 public immutable topTenFundId;
    bytes32 public immutable pinnerFundId;
    bytes32 public immutable repoFundId;
    uint256 public headRequestId;
    uint256 public nextRequestId;
    uint256 public pendingCount;

    enum Status { Pending, Fulfilled, Refunded }
    enum Tier { Bump, Immediate }
    struct Request {
        uint256 campaignId;
        address payer;
        uint256 amount;
        Status status;
        string title;
        string audioURI;
        address advertiser;
        Tier tier;
    }
    mapping(uint256 => Request) private _requests;
    mapping(uint256 => bool) public removedCampaigns;
    mapping(uint256 => bool) public approvedCampaigns;
    mapping(bytes32 => bool) public usedPlaybackProofs;

    event AdRequested(uint256 indexed requestId, uint256 indexed campaignId, address indexed payer, uint256 amount);
    event AdFulfilled(uint256 indexed requestId, bytes32 indexed playbackProof);
    event CampaignRemoved(uint256 indexed campaignId);
    event CampaignApproved(uint256 indexed campaignId);
    event AdRefunded(uint256 indexed requestId, address indexed payer, uint256 amount);

    constructor(address token, address campaignContract, address router, bytes32 playbackFund, bytes32 topTenFund,
        bytes32 pinnerFund, bytes32 repoFund, address admin, address fulfiller) {
        require(token.code.length > 0 && campaignContract.code.length > 0 && router.code.length > 0, "Contracts required");
        require(admin != address(0) && fulfiller != address(0), "Roles required");
        require(IERC20Metadata(token).decimals() == 6, "Six decimal USDC required");
        require(playbackFund != 0 && topTenFund != 0 && pinnerFund != 0 && repoFund != 0, "Funds required");
        paymentToken = IERC20(token);
        campaigns = IDeVertQueueCampaigns(campaignContract);
        fundRouter = IDeVertQueueRouter(router);
        playbackFundId = playbackFund;
        topTenFundId = topTenFund;
        pinnerFundId = pinnerFund;
        repoFundId = repoFund;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(FULFILLER_ROLE, fulfiller);
    }

    function quote() public view returns (uint256) {
        return 1_000_000 * (2 ** (pendingCount / 7));
    }

    function quoteForTier(Tier tier) public view returns (uint256) {
        return quote() * (tier == Tier.Immediate ? 2 : 1);
    }

    function getRequest(uint256 requestId) external view returns (Request memory) {
        require(requestId < nextRequestId, "Unknown request");
        return _requests[requestId];
    }

    function headRequestIdForTier(Tier tier) public view returns (uint256) {
        for (uint256 i = headRequestId; i < nextRequestId; i++) {
            Request storage request = _requests[i];
            if (request.status == Status.Pending && !removedCampaigns[request.campaignId] && request.tier == tier) return i;
        }
        return nextRequestId;
    }

    function requestAd(uint256 campaignId, Tier tier, uint256 maxPrice) external whenNotPaused nonReentrant returns (uint256 requestId) {
        require(!campaigns.paused() && !removedCampaigns[campaignId], "Campaign unavailable");
        require(approvedCampaigns[campaignId], "Approved advert required");
        require(pendingCount < MAX_PENDING && nextRequestId - headRequestId < MAX_PENDING, "Queue full");
        IDeVertQueueCampaigns.Campaign memory campaign = campaigns.getCampaign(campaignId);
        require(campaign.advertiser != address(0) && campaign.startedAt <= block.timestamp && block.timestamp < campaign.expiresAt, "Active campaign required");
        bytes memory uri = bytes(campaign.audioURI);
        require(uri.length > 7 && uri.length <= 512 && bytes(campaign.title).length > 0 && bytes(campaign.title).length <= 160, "Invalid approved advert");
        require(uri[0] == "i" && uri[1] == "p" && uri[2] == "f" && uri[3] == "s" && uri[4] == ":" && uri[5] == "/" && uri[6] == "/", "IPFS required");
        uint256 price = quoteForTier(tier);
        require(price <= maxPrice, "Price increased");
        uint256 beforeBalance = paymentToken.balanceOf(address(this));
        paymentToken.safeTransferFrom(msg.sender, address(this), price);
        require(paymentToken.balanceOf(address(this)) == beforeBalance + price, "Exact payment required");
        requestId = nextRequestId++;
        _requests[requestId] = Request(campaignId, msg.sender, price, Status.Pending, campaign.title, campaign.audioURI, campaign.advertiser, tier);
        pendingCount++;
        emit AdRequested(requestId, campaignId, msg.sender, price);
    }

    // Tier priority is selected before playback; a later immediate purchase cannot invalidate a bump already playing.
    function fulfill(uint256 requestId, bytes32 playbackProof) external onlyRole(FULFILLER_ROLE) whenNotPaused nonReentrant {
        require(requestId < nextRequestId, "Unknown request");
        Request storage request = _requests[requestId];
        require(request.status == Status.Pending && !removedCampaigns[request.campaignId], "Request unavailable");
        require(requestId == headRequestIdForTier(request.tier), "Tier FIFO head required");
        require(playbackProof != 0 && !usedPlaybackProofs[playbackProof], "Unique proof required");
        usedPlaybackProofs[playbackProof] = true;
        request.status = Status.Fulfilled;
        pendingCount--;
        _advance();
        uint256 playback = request.amount * 4500 / 10000;
        uint256 topTen = request.amount * 4500 / 10000;
        uint256 pinners = request.amount * 800 / 10000;
        paymentToken.forceApprove(address(fundRouter), request.amount);
        fundRouter.fundToken(playbackFundId, address(paymentToken), playback);
        fundRouter.fundToken(topTenFundId, address(paymentToken), topTen);
        fundRouter.fundToken(pinnerFundId, address(paymentToken), pinners);
        fundRouter.fundToken(repoFundId, address(paymentToken), request.amount - playback - topTen - pinners);
        paymentToken.forceApprove(address(fundRouter), 0);
        emit AdFulfilled(requestId, playbackProof);
    }

    function removeCampaign(uint256 campaignId) external {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender) || hasRole(FULFILLER_ROLE, msg.sender), "Removal role required");
        require(!removedCampaigns[campaignId], "Already removed");
        removedCampaigns[campaignId] = true;
        for (uint256 i = headRequestId; i < nextRequestId; i++) {
            if (_requests[i].status == Status.Pending && _requests[i].campaignId == campaignId) pendingCount--;
        }
        _advance();
        emit CampaignRemoved(campaignId);
    }

    function approveCampaign(uint256 campaignId) external {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender) || hasRole(FULFILLER_ROLE, msg.sender), "Approval role required");
        require(!removedCampaigns[campaignId] && campaigns.getCampaign(campaignId).advertiser != address(0), "Campaign unavailable");
        require(!approvedCampaigns[campaignId], "Already approved");
        approvedCampaigns[campaignId] = true;
        emit CampaignApproved(campaignId);
    }

    function claimRefund(uint256 requestId) external nonReentrant {
        require(requestId < nextRequestId, "Unknown request");
        Request storage request = _requests[requestId];
        require(request.payer == msg.sender && request.status == Status.Pending && removedCampaigns[request.campaignId], "Payer refund unavailable");
        request.status = Status.Refunded;
        paymentToken.safeTransfer(msg.sender, request.amount);
        emit AdRefunded(requestId, msg.sender, request.amount);
    }

    function setPaused(bool value) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (value) _pause(); else _unpause();
    }

    function _advance() private {
        while (headRequestId < nextRequestId &&
            (_requests[headRequestId].status != Status.Pending || removedCampaigns[_requests[headRequestId].campaignId])) headRequestId++;
    }
}
