pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IDeVertFundRouter {
    function fundToken(bytes32 fundId, address asset, uint256 amount) external;
}

interface IDeVertDJuke {
    function getRequest(uint256 requestId) external view returns (
        bytes32 songId, address payer, uint256 amount, bool fulfilled, uint256 revision,
        address[] memory recipients, uint16[] memory sharesBps
    );
}

contract DeVert_v0_1 is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant SCHEDULER_ROLE = keccak256("SCHEDULER_ROLE");
    uint64 public constant WEEK_SECONDS = 7 days;
    uint128 public constant MINIMUM_WEEKLY_PRICE = 5_000_000;
    uint128 public constant MINIMUM_BID_INCREMENT = 10_000;
    uint16 public constant PLAYBACK_SHARE_BPS = 4_500;
    uint16 public constant TOP_TEN_SHARE_BPS = 4_500;
    uint16 public constant PINNER_SHARE_BPS = 800;
    uint16 public constant REPO_DEV_SHARE_BPS = 200;
    uint32 public constant MUSIC_PLAYS_PER_AD = 10;
    uint32 public constant MAX_CAMPAIGNS_PER_WEEK = 32;
    uint256 public constant MAX_MUSIC_PLAYS_PER_BATCH = 100;
    uint256 public constant SCHEDULER_GAS_UNITS_PER_CAMPAIGN = 500_000;

    IERC20 public immutable paymentToken;
    IDeVertFundRouter public immutable fundRouter;
    IDeVertDJuke public immutable djuke;
    bytes32 public immutable playbackFundId;
    bytes32 public immutable topTenFundId;
    bytes32 public immutable pinnerFundId;
    bytes32 public immutable repoFundId;
    address payable public immutable schedulerWallet;

    struct Campaign {
        address advertiser;
        string title;
        string audioURI;
        uint64 startedAt;
        uint64 expiresAt;
        uint64 weekId;
        uint128 offerUnits;
        uint128 paidUnits;
        uint32 djukeBoosts;
        uint32 mainRadioPlays;
        uint32 devertPlays;
    }

    struct Market {
        uint64 completedMusicPlays;
        uint32 mainRadioImpressions;
    }

    uint256 public nextCampaignId = 1;
    mapping(uint256 campaignId => Campaign campaign) private _campaigns;
    mapping(uint64 weekId => uint256[] campaignIds) private _weekCampaignIds;
    mapping(uint64 weekId => uint32 count) public campaignsStartedInWeek;
    mapping(uint64 weekId => Market market) public markets;
    mapping(uint64 weekId => mapping(bytes32 playId => bool used)) public usedMusicPlayIds;
    mapping(bytes32 impressionId => bool used) public usedImpressionIds;
    mapping(uint256 djukeRequestId => bool used) public usedDjukeRequests;

    event CampaignCreated(uint256 indexed campaignId, address indexed advertiser, uint64 indexed weekId,
        string title, string audioURI, uint128 offerUnits, uint64 startedAt, uint64 expiresAt);
    event MusicPlayReported(uint64 indexed weekId, bytes32 indexed playId, uint64 completedMusicPlays, uint32 mainRadioSlots);
    event CampaignImpressionRecorded(uint256 indexed campaignId, bytes32 indexed impressionId, bool mainRadio,
        uint32 mainRadioPlays, uint32 devertPlays);
    event DJukeCampaignBoosted(uint256 indexed campaignId, uint256 indexed djukeRequestId, uint32 djukeBoosts);
    event CampaignPaymentsRouted(uint256 indexed campaignId, uint128 amount, uint128 playbackAmount,
        uint128 topTenAmount, uint128 pinnerAmount, uint128 repoDevAmount);
    event SchedulerGasTopUpSent(uint256 indexed campaignId, address indexed scheduler, uint256 amount, uint256 effectiveGasPrice);

    constructor(address token, address router, address djukeAddress, bytes32 playbackId, bytes32 topTenId,
        bytes32 pinnerId, bytes32 repoId, address admin, address scheduler) {
        require(token.code.length > 0 && router.code.length > 0 && djukeAddress.code.length > 0, "Invalid deployment address");
        require(admin != address(0) && scheduler != address(0), "Invalid role address");
        require(IERC20Metadata(token).decimals() == 6, "USDC decimals required");
        require(playbackId != bytes32(0) && topTenId != bytes32(0) && pinnerId != bytes32(0) && repoId != bytes32(0), "Fund IDs required");
        require(playbackId != topTenId && playbackId != pinnerId && playbackId != repoId &&
            topTenId != pinnerId && topTenId != repoId && pinnerId != repoId, "Fund IDs must be unique");
        paymentToken = IERC20(token);
        fundRouter = IDeVertFundRouter(router);
        djuke = IDeVertDJuke(djukeAddress);
        playbackFundId = playbackId;
        topTenFundId = topTenId;
        pinnerFundId = pinnerId;
        repoFundId = repoId;
        schedulerWallet = payable(scheduler);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(SCHEDULER_ROLE, scheduler);
        _pause();
    }

    function campaignWeek(uint256 timestamp) public pure returns (uint64) {
        return uint64(timestamp / WEEK_SECONDS);
    }

    function getWeekCampaignIds(uint64 weekId) external view returns (uint256[] memory) {
        return _weekCampaignIds[weekId];
    }

    function getCampaign(uint256 campaignId) external view returns (Campaign memory) {
        require(_campaigns[campaignId].advertiser != address(0), "Unknown campaign");
        return _campaigns[campaignId];
    }

    function quoteCampaign(uint64 weekId) public view returns (uint128 minimumOfferUnits, uint256 bumpedCampaignId) {
        (uint32 slots, uint32 seated, uint128 lowestOffer, uint256 lowestCampaignId) = _marketSummary(weekId);
        if (slots == 0 || seated < slots) return (MINIMUM_WEEKLY_PRICE, 0);
        uint256 nextOffer = uint256(lowestOffer) + MINIMUM_BID_INCREMENT;
        require(nextOffer <= type(uint128).max, "Campaign offer overflow");
        return (uint128(nextOffer) > MINIMUM_WEEKLY_PRICE ? uint128(nextOffer) : MINIMUM_WEEKLY_PRICE, lowestCampaignId);
    }

    function quoteSchedulerGasTopUp(uint256 maxFeePerGas) public pure returns (uint256) {
        return SCHEDULER_GAS_UNITS_PER_CAMPAIGN * maxFeePerGas;
    }

    function mainRadioMarket(uint64 weekId) external view returns (uint32 slots, uint32 seated,
        uint128 lowestSeatedOfferUnits, uint32 mainRadioImpressions) {
        (slots, seated, lowestSeatedOfferUnits,) = _marketSummary(weekId);
        mainRadioImpressions = markets[weekId].mainRadioImpressions;
    }

    function createCampaign(string calldata title, string calldata audioURI, uint128 offerUnits,
        uint128 maxPaymentUnits) external payable whenNotPaused nonReentrant returns (uint256 campaignId) {
        require(bytes(title).length > 0 && bytes(title).length <= 160, "Invalid campaign title");
        require(bytes(audioURI).length > 7 && bytes(audioURI).length <= 256 &&
            keccak256(bytes(audioURI[:7])) == keccak256(bytes("ipfs://")), "IPFS audio required");
        require(offerUnits >= MINIMUM_WEEKLY_PRICE, "Offer below minimum");
        require(offerUnits <= maxPaymentUnits, "Offer exceeds approval");

        uint64 startedAt = uint64(block.timestamp);
        uint64 weekId = campaignWeek(startedAt);
        require(campaignsStartedInWeek[weekId] < MAX_CAMPAIGNS_PER_WEEK, "Weekly campaign limit reached");
        (uint128 minimumOffer,) = quoteCampaign(weekId);
        require(offerUnits >= minimumOffer, "Offer below current market minimum");
        require(msg.value >= SCHEDULER_GAS_UNITS_PER_CAMPAIGN * tx.gasprice, "Scheduler gas top-up too low");

        uint256 beforeBalance = paymentToken.balanceOf(address(this));
        paymentToken.safeTransferFrom(msg.sender, address(this), offerUnits);
        require(paymentToken.balanceOf(address(this)) - beforeBalance == offerUnits, "Exact payment required");

        campaignId = nextCampaignId++;
        uint64 expiresAt = startedAt + WEEK_SECONDS;
        _campaigns[campaignId] = Campaign({ advertiser: msg.sender, title: title, audioURI: audioURI,
            startedAt: startedAt, expiresAt: expiresAt, weekId: weekId, offerUnits: offerUnits,
            paidUnits: offerUnits, djukeBoosts: 0, mainRadioPlays: 0, devertPlays: 0 });
        _weekCampaignIds[weekId].push(campaignId);
        _weekCampaignIds[weekId + 1].push(campaignId);
        campaignsStartedInWeek[weekId]++;
        _routeCampaignPayment(campaignId, offerUnits);
        _sendSchedulerGasTopUp(campaignId);
        emit CampaignCreated(campaignId, msg.sender, weekId, title, audioURI, offerUnits, startedAt, expiresAt);
    }

    function _sendSchedulerGasTopUp(uint256 campaignId) private {
        uint256 amount = msg.value;
        uint256 effectiveGasPrice = tx.gasprice;
        require(amount >= SCHEDULER_GAS_UNITS_PER_CAMPAIGN * effectiveGasPrice, "Scheduler gas top-up too low");
        (bool sent,) = schedulerWallet.call{ value: amount }("");
        require(sent, "Scheduler gas top-up failed");
        emit SchedulerGasTopUpSent(campaignId, schedulerWallet, amount, effectiveGasPrice);
    }

    function reportCompletedMusicPlays(bytes32[] calldata playIds) external onlyRole(SCHEDULER_ROLE) whenNotPaused {
        require(playIds.length > 0 && playIds.length <= MAX_MUSIC_PLAYS_PER_BATCH, "Invalid music play batch");
        uint64 weekId = campaignWeek(block.timestamp);
        Market storage market = markets[weekId];
        for (uint256 index = 0; index < playIds.length; index++) {
            bytes32 playId = playIds[index];
            require(playId != bytes32(0), "Music play ID required");
            if (usedMusicPlayIds[weekId][playId]) continue;
            usedMusicPlayIds[weekId][playId] = true;
            require(market.completedMusicPlays < type(uint64).max, "Music play count overflow");
            market.completedMusicPlays++;
            emit MusicPlayReported(weekId, playId, market.completedMusicPlays,
                uint32(market.completedMusicPlays / MUSIC_PLAYS_PER_AD));
        }
    }

    function recordCampaignPlay(uint256 campaignId, bool mainRadio, bytes32 impressionId)
        external onlyRole(SCHEDULER_ROLE) whenNotPaused {
        require(impressionId != bytes32(0) && !usedImpressionIds[impressionId], "Impression already recorded");
        Campaign storage campaign = _campaigns[campaignId];
        require(campaign.advertiser != address(0) && block.timestamp >= campaign.startedAt &&
            block.timestamp < campaign.expiresAt, "Campaign inactive");
        usedImpressionIds[impressionId] = true;
        if (mainRadio) {
            uint64 weekId = campaignWeek(block.timestamp);
            (uint32 slots,,,) = _marketSummary(weekId);
            Market storage market = markets[weekId];
            require(market.mainRadioImpressions < slots && _isSeated(weekId, campaignId, slots), "No seated main-radio slot");
            market.mainRadioImpressions++;
            campaign.mainRadioPlays++;
        } else {
            campaign.devertPlays++;
        }
        emit CampaignImpressionRecorded(campaignId, impressionId, mainRadio, campaign.mainRadioPlays, campaign.devertPlays);
    }

    function applyDJukeBoost(uint256 campaignId, uint256 djukeRequestId) external onlyRole(SCHEDULER_ROLE) whenNotPaused {
        require(!usedDjukeRequests[djukeRequestId], "DJuke request already linked");
        Campaign storage campaign = _campaigns[campaignId];
        require(campaign.advertiser != address(0) && block.timestamp < campaign.expiresAt, "Campaign inactive");
        (, address payer, uint256 amount,,,,) = djuke.getRequest(djukeRequestId);
        require(payer == campaign.advertiser && amount > 0, "DJuke request not paid by advertiser");
        usedDjukeRequests[djukeRequestId] = true;
        campaign.djukeBoosts++;
        emit DJukeCampaignBoosted(campaignId, djukeRequestId, campaign.djukeBoosts);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    function _marketSummary(uint64 weekId) internal view returns (uint32 slots, uint32 seated,
        uint128 lowestOffer, uint256 lowestCampaignId) {
        uint256 computedSlots = uint256(markets[weekId].completedMusicPlays) / MUSIC_PLAYS_PER_AD;
        require(computedSlots <= type(uint32).max, "Main-radio slots overflow");
        slots = uint32(computedSlots);
        uint256[] storage ids = _weekCampaignIds[weekId];
        uint256 activeCount;
        for (uint256 index = 0; index < ids.length; index++) {
            Campaign storage campaign = _campaigns[ids[index]];
            if (block.timestamp >= campaign.startedAt && block.timestamp < campaign.expiresAt) activeCount++;
        }
        seated = uint32(activeCount < slots ? activeCount : slots);
        if (seated == 0) return (slots, 0, 0, 0);

        uint256 lowestRank;
        bool foundLowest;
        for (uint256 index = 0; index < ids.length; index++) {
            uint256 candidateId = ids[index];
            Campaign storage candidate = _campaigns[candidateId];
            if (block.timestamp < candidate.startedAt || block.timestamp >= candidate.expiresAt) continue;
            uint256 rank;
            for (uint256 otherIndex = 0; otherIndex < ids.length; otherIndex++) {
                uint256 otherId = ids[otherIndex];
                if (otherId == candidateId) continue;
                Campaign storage other = _campaigns[otherId];
                if (block.timestamp >= other.startedAt && block.timestamp < other.expiresAt && _isBetter(other, otherId, candidate, candidateId)) rank++;
            }
            if (rank >= seated) continue;
            if (!foundLowest || rank > lowestRank) {
                foundLowest = true;
                lowestRank = rank;
                lowestOffer = candidate.offerUnits;
                lowestCampaignId = candidateId;
            }
        }
    }

    function _isSeated(uint64 weekId, uint256 campaignId, uint32 slots) internal view returns (bool) {
        if (slots == 0) return false;
        uint256[] storage ids = _weekCampaignIds[weekId];
        Campaign storage candidate = _campaigns[campaignId];
        uint256 rank;
        for (uint256 index = 0; index < ids.length; index++) {
            uint256 otherId = ids[index];
            if (otherId == campaignId) continue;
            Campaign storage other = _campaigns[otherId];
            if (block.timestamp >= other.startedAt && block.timestamp < other.expiresAt &&
                _isBetter(other, otherId, candidate, campaignId)) rank++;
        }
        return rank < slots;
    }

    function _isBetter(Campaign storage first, uint256 firstId, Campaign storage second, uint256 secondId)
        internal view returns (bool) {
        if (first.djukeBoosts != second.djukeBoosts) return first.djukeBoosts > second.djukeBoosts;
        if (first.mainRadioPlays != second.mainRadioPlays) return first.mainRadioPlays < second.mainRadioPlays;
        if (first.offerUnits != second.offerUnits) return first.offerUnits > second.offerUnits;
        if (first.startedAt != second.startedAt) return first.startedAt < second.startedAt;
        return firstId < secondId;
    }

    function _routeCampaignPayment(uint256 campaignId, uint128 amount) internal {
        uint128 playbackAmount = uint128(uint256(amount) * PLAYBACK_SHARE_BPS / 10_000);
        uint128 topTenAmount = uint128(uint256(amount) * TOP_TEN_SHARE_BPS / 10_000);
        uint128 pinnerAmount = uint128(uint256(amount) * PINNER_SHARE_BPS / 10_000);
        uint128 repoAmount = amount - playbackAmount - topTenAmount - pinnerAmount;
        _fund(playbackFundId, playbackAmount);
        _fund(topTenFundId, topTenAmount);
        _fund(pinnerFundId, pinnerAmount);
        _fund(repoFundId, repoAmount);
        emit CampaignPaymentsRouted(campaignId, amount, playbackAmount, topTenAmount, pinnerAmount, repoAmount);
    }

    function _fund(bytes32 fundId, uint256 amount) internal {
        if (amount == 0) return;
        paymentToken.forceApprove(address(fundRouter), amount);
        fundRouter.fundToken(fundId, address(paymentToken), amount);
        paymentToken.forceApprove(address(fundRouter), 0);
    }
}