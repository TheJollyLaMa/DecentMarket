pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Multicall.sol";

interface IDJukeFundRouter {
    function fundToken(bytes32 fundId, address asset, uint256 amount) external;
}

contract DecentJukeBox_v0_1_v04 is AccessControl, ReentrancyGuard, Pausable, Multicall {
    using SafeERC20 for IERC20;

    bytes32 public constant FULFILLER_ROLE = keccak256("FULFILLER_ROLE");
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    uint256 public constant BASE_PRICE = 250000;
    uint256 public constant TIER_SIZE = 8;
    uint256 public constant LISTEN_PRICE = 250000;
    uint256 public constant MAX_LISTEN_BATCH = 50;
    uint16 public constant PINNER_SHARE_BPS = 800;
    uint16 public constant REPO_DEV_SHARE_BPS = 200;
    IERC20 public immutable paymentToken;
    IDJukeFundRouter public immutable fundRouter;
    bytes32 public immutable repoFundId;
    bytes32 public immutable pinnerFundId;
    uint256 public nextRequestId;
    uint256 public headRequestId;
    uint256 public nextPurchaseId;
    mapping(address => uint256) public artistCredits;
    mapping(bytes32 => bool) public usedPlaybackProofs;

    struct Song {
        string audioURI;
        bool enabled;
        address[] recipients;
        uint16[] sharesBps;
    }

    struct Request {
        bytes32 songId;
        address payer;
        uint256 amount;
        bool fulfilled;
        uint256 revision;
        address[] recipients;
        uint16[] sharesBps;
    }

    mapping(bytes32 => Song) internal _songs;
    mapping(uint256 => Request) internal _requests;

    event SongConfigured(bytes32 indexed songId, string audioURI, address[] recipients, uint16[] sharesBps);
    event SongStatusChanged(bytes32 indexed songId, bool enabled);
    event PlayRequested(uint256 indexed requestId, bytes32 indexed songId, address indexed payer, uint256 amount);
    event RequestReplaced(uint256 indexed requestId, bytes32 indexed previousSongId, bytes32 indexed songId, uint256 revision);
    event PlayFulfilled(uint256 indexed requestId, bytes32 indexed songId, bytes32 playbackProof, uint256 fundAmount);
    event RequestRefunded(uint256 indexed requestId, bytes32 indexed songId, address indexed payer, uint256 amount);
    event ArtistWithdrawal(address indexed artist, uint256 amount);
    event ListensPurchased(uint256 indexed purchaseId, address indexed listener, bytes32[] songIds, uint256 amount);
    event PinnerFundContribution(bytes32 indexed source, uint256 amount);

    constructor(address token, address router, bytes32 fundId, bytes32 pinnerFundId_, address admin) {
        require(token.code.length > 0 && router.code.length > 0 && admin != address(0));
        require(fundId != bytes32(0) && pinnerFundId_ != bytes32(0) && fundId != pinnerFundId_ && IERC20Metadata(token).decimals() == 6);
        paymentToken = IERC20(token);
        fundRouter = IDJukeFundRouter(router);
        repoFundId = fundId;
        pinnerFundId = pinnerFundId_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function pendingCount() public view returns (uint256) {
        return nextRequestId - headRequestId;
    }

    function quote() public view virtual returns (uint256) {
        uint256 tier = pendingCount() / TIER_SIZE;
        require(tier <= 238);
        return BASE_PRICE * (uint256(1) << tier);
    }

    function configureSong(bytes32 songId, string calldata audioURI, address[] calldata recipients, uint16[] calldata sharesBps)
        external virtual onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _setSong(songId, audioURI, recipients, sharesBps);
    }

    /// @notice Registrars may add songs but never alter an existing song's audio or payees.
    function registerSong(bytes32 songId, string calldata audioURI, address[] calldata recipients, uint16[] calldata sharesBps)
        external onlyRole(REGISTRAR_ROLE)
    {
        require(bytes(_songs[songId].audioURI).length == 0);
        _setSong(songId, audioURI, recipients, sharesBps);
    }

    function _setSong(bytes32 songId, string memory audioURI, address[] memory recipients, uint16[] memory sharesBps) internal {
        require(songId != bytes32(0) && bytes(audioURI).length > 0);
        require(recipients.length > 0 && recipients.length <= 16 && recipients.length == sharesBps.length);
        uint256 total;
        for (uint256 index = 0; index < recipients.length; index++) {
            require(recipients[index] != address(0) && sharesBps[index] > 0);
            for (uint256 previous = 0; previous < index; previous++) {
                require(recipients[previous] != recipients[index]);
            }
            total += sharesBps[index];
        }
        require(total == 10000);
        Song storage song = _songs[songId];
        require(bytes(song.audioURI).length == 0 || keccak256(bytes(song.audioURI)) == keccak256(bytes(audioURI)));
        song.audioURI = audioURI;
        song.enabled = true;
        song.recipients = recipients;
        song.sharesBps = sharesBps;
        emit SongConfigured(songId, audioURI, recipients, sharesBps);
    }

    function setSongEnabled(bytes32 songId, bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(bytes(_songs[songId].audioURI).length > 0);
        _songs[songId].enabled = enabled;
        emit SongStatusChanged(songId, enabled);
    }

    function requestPlay(bytes32 songId, uint256 maxPrice) external virtual whenNotPaused nonReentrant returns (uint256 requestId) {
        return _requestPlay(songId, maxPrice);
    }

    function _requestPlay(bytes32 songId, uint256 maxPrice) internal returns (uint256 requestId) {
        uint256 amount = quote();
        require(amount <= maxPrice);
        return _requestPlayAtPrice(songId, amount);
    }

    function _requestPlayAtPrice(bytes32 songId, uint256 amount) internal returns (uint256 requestId) {
        uint256 balanceBefore = paymentToken.balanceOf(address(this));
        paymentToken.safeTransferFrom(msg.sender, address(this), amount);
        require(paymentToken.balanceOf(address(this)) - balanceBefore == amount);
        return _enqueuePaidRequest(songId, amount, msg.sender);
    }

    function _enqueuePaidRequest(bytes32 songId, uint256 amount, address payer) internal returns (uint256 requestId) {
        Song storage song = _songs[songId];
        require(song.enabled);
        requestId = nextRequestId++;
        Request storage request = _requests[requestId];
        request.songId = songId;
        request.payer = payer;
        request.amount = amount;
        request.recipients = song.recipients;
        request.sharesBps = song.sharesBps;
        emit PlayRequested(requestId, songId, msg.sender, amount);
    }

    function replaceRequest(uint256 requestId, bytes32 songId) external nonReentrant {
        require(requestId >= headRequestId && requestId < nextRequestId);
        Request storage request = _requests[requestId];
        require(msg.sender == request.payer);
        Song storage song = _songs[songId];
        require(song.enabled && songId != request.songId);
        bytes32 previousSongId = request.songId;
        request.songId = songId;
        request.recipients = song.recipients;
        request.sharesBps = song.sharesBps;
        request.revision++;
        emit RequestReplaced(requestId, previousSongId, songId, request.revision);
    }

    function fulfill(uint256 requestId, bytes32 expectedSongId, uint256 expectedRevision, bytes32 playbackProof) external onlyRole(FULFILLER_ROLE) nonReentrant {
        require(requestId == headRequestId && requestId < nextRequestId);
        require(playbackProof != bytes32(0) && !usedPlaybackProofs[playbackProof]);
        Request storage request = _requests[requestId];
        require(request.songId == expectedSongId && request.revision == expectedRevision);
        request.fulfilled = true;
        headRequestId++;
        usedPlaybackProofs[playbackProof] = true;
        uint256 artistAmount = request.amount * (10000 - PINNER_SHARE_BPS - REPO_DEV_SHARE_BPS) / 10000;
        uint256 repoDevAmount = request.amount * REPO_DEV_SHARE_BPS / 10000;
        _creditArtists(request.recipients, request.sharesBps, artistAmount);
        _depositRepoFund(repoDevAmount, request.amount * PINNER_SHARE_BPS / 10000, playbackProof);
        _afterRequestResolved(requestId, request, true);
        emit PlayFulfilled(requestId, request.songId, playbackProof, repoDevAmount);
    }

    function _afterRequestResolved(uint256, Request storage, bool) internal virtual {}

    function _refundRequestAtHead(uint256 requestId) internal {
        require(requestId == headRequestId && requestId < nextRequestId);
        Request storage request = _requests[requestId];
        require(!request.fulfilled);
        request.fulfilled = true;
        headRequestId++;
        paymentToken.safeTransfer(request.payer, request.amount);
        _afterRequestResolved(requestId, request, false);
        emit RequestRefunded(requestId, request.songId, request.payer, request.amount);
    }

    /// @notice On-demand personal listens; never touches the radio queue.
    function purchaseListens(bytes32[] calldata songIds, uint256 maxTotal) external whenNotPaused nonReentrant returns (uint256 purchaseId) {
        return _purchaseListens(songIds, maxTotal);
    }

    function _purchaseListens(bytes32[] memory songIds, uint256 maxTotal) internal returns (uint256 purchaseId) {
        require(songIds.length > 0 && songIds.length <= MAX_LISTEN_BATCH);
        uint256 amount;
        for (uint256 index = 0; index < songIds.length; index++) amount += _listenPrice(songIds[index]);
        require(amount <= maxTotal);
        uint256 balanceBefore = paymentToken.balanceOf(address(this));
        paymentToken.safeTransferFrom(msg.sender, address(this), amount);
        require(paymentToken.balanceOf(address(this)) - balanceBefore == amount);
        uint256 repoAmount;
        uint256 pinnerAmount;
        for (uint256 index = 0; index < songIds.length; index++) {
            Song storage song = _songs[songIds[index]];
            require(song.enabled);
            uint256 songPrice = _listenPrice(songIds[index]);
            uint256 songArtist = songPrice * (10000 - PINNER_SHARE_BPS - REPO_DEV_SHARE_BPS) / 10000;
            _creditArtists(song.recipients, song.sharesBps, songArtist);
            repoAmount += songPrice * REPO_DEV_SHARE_BPS / 10000;
            pinnerAmount += songPrice - songArtist - songPrice * REPO_DEV_SHARE_BPS / 10000;
        }
        _depositRepoFund(repoAmount, pinnerAmount,
            keccak256(abi.encode("listen", purchaseId, songIds)));
        purchaseId = nextPurchaseId++;
        emit ListensPurchased(purchaseId, msg.sender, songIds, amount);
    }

    function _listenPrice(bytes32) internal view virtual returns (uint256) { return LISTEN_PRICE; }

    function _creditArtists(address[] storage recipients, uint16[] storage sharesBps, uint256 artistAmount) internal virtual {
        uint256 credited;
        for (uint256 index = 0; index < recipients.length; index++) {
            uint256 share = index + 1 == recipients.length
                ? artistAmount - credited
                : artistAmount * sharesBps[index] / 10000;
            credited += share;
            artistCredits[recipients[index]] += share;
        }
    }

    function _depositRepoFund(uint256 repoAmount, uint256 pinnerAmount, bytes32 source) internal {
        if (repoAmount > 0) {
            paymentToken.forceApprove(address(fundRouter), repoAmount);
            fundRouter.fundToken(repoFundId, address(paymentToken), repoAmount);
            paymentToken.forceApprove(address(fundRouter), 0);
        }
        if (pinnerAmount > 0) {
            paymentToken.forceApprove(address(fundRouter), pinnerAmount);
            fundRouter.fundToken(pinnerFundId, address(paymentToken), pinnerAmount);
            paymentToken.forceApprove(address(fundRouter), 0);
            emit PinnerFundContribution(source, pinnerAmount);
        }
    }

    function withdrawArtistCredit() external nonReentrant {
        uint256 amount = artistCredits[msg.sender];
        require(amount > 0);
        artistCredits[msg.sender] = 0;
        paymentToken.safeTransfer(msg.sender, amount);
        emit ArtistWithdrawal(msg.sender, amount);
    }

    function getSong(bytes32 songId) external view returns (Song memory) { return _songs[songId]; }
    function getRequest(uint256 requestId) external view returns (Request memory) {
        require(requestId < nextRequestId);
        return _requests[requestId];
    }
    function pauseRequests() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function resumeRequests() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }
}