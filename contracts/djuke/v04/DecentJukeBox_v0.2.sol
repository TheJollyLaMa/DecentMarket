pragma solidity ^0.8.26;

import "./DecentJukeBox_v0.1.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

contract DecentJukeBox_v0_2_v04 is DecentJukeBox_v0_1_v04, EIP712 {
    using SafeERC20 for IERC20;
    bytes32 public constant GAS_QUOTE_TYPEHASH = keccak256("GasQuote(address listener,bytes32 songId,uint256 maxPrice,uint256 fulfillmentCostWei,uint256 nonce,uint256 deadline)");
    bytes32 public constant SPLIT_TYPEHASH = keccak256("AlbumSplit(bytes32 albumId,uint256 revision,bytes32 recipientsHash,bytes32 sharesHash,bytes32 positionsHash)");
    address payable public immutable gasWorker;
    uint256 public immutable maxGasContributionWei;
    mapping(address => uint256) public gasQuoteNonces;

    struct Album {
        address mainOwner;
        string title;
        string manifestURI;
        uint256 revision;
        uint256 listenPrice;
        uint256 albumPrice;
        address[] recipients;
        uint16[] sharesBps;
        string[] positions;
        bytes32[] songIds;
    }

    mapping(bytes32 => Album) private _albums;
    mapping(bytes32 => bytes32) public songAlbum;
    mapping(bytes32 => uint256) public songSplitRevision;

    event AlbumCreated(bytes32 indexed albumId, address indexed mainOwner, string title, string manifestURI);
    event AlbumManagementTransferred(bytes32 indexed albumId, address indexed previousOwner, address indexed nextOwner);
    event AlbumSplitUpdated(bytes32 indexed albumId, uint256 revision, address[] recipients, uint16[] sharesBps, string[] positions);
    event AlbumManifestUpdated(bytes32 indexed albumId, string manifestURI);
    event AlbumFeesUpdated(bytes32 indexed albumId, uint256 listenPrice, uint256 albumPrice);
    event AlbumSongRegistered(bytes32 indexed albumId, bytes32 indexed songId, uint256 revision);
    event SongSplitUpdated(bytes32 indexed songId, bytes32 indexed albumId, uint256 revision);
    event WorkerGasFunded(uint256 indexed requestId, address indexed listener, address indexed worker, uint256 amount);
    event AlbumPurchased(bytes32 indexed albumId, address indexed listener, uint256 purchaseId, uint256 amount);

    constructor(address token, address router, bytes32 repoId, bytes32 pinnerId, address admin,
        address payable worker, uint256 gasContributionCap)
        DecentJukeBox_v0_1_v04(token, router, repoId, pinnerId, admin) EIP712("DecentJukeBox", "0.2") {
        require(worker != address(0) && gasContributionCap > 0);
        gasWorker = worker;
        maxGasContributionWei = gasContributionCap;
    }

    function createAlbum(bytes32 albumId, string calldata title, string calldata manifestURI,
        address[] calldata recipients, uint16[] calldata sharesBps, string[] calldata positions,
        uint256 listenPrice, uint256 albumPrice) external whenNotPaused {
        require(albumId != bytes32(0) && _albums[albumId].mainOwner == address(0));
        require(bytes(title).length > 0 && bytes(title).length <= 120 && bytes(manifestURI).length > 0);
        _validateSplit(recipients, sharesBps, positions);
        require(listenPrice > 0 && albumPrice > 0);
        Album storage album = _albums[albumId];
        album.mainOwner = msg.sender;
        album.title = title;
        album.manifestURI = manifestURI;
        album.revision = 1;
        album.listenPrice = listenPrice;
        album.albumPrice = albumPrice;
        album.recipients = recipients;
        album.sharesBps = sharesBps;
        for (uint256 index = 0; index < positions.length; index++) album.positions.push(positions[index]);
        emit AlbumCreated(albumId, msg.sender, title, manifestURI);
        emit AlbumSplitUpdated(albumId, 1, recipients, sharesBps, positions);
    }

    function albumSplitDigest(bytes32 albumId, address[] calldata recipients, uint16[] calldata sharesBps,
        string[] calldata positions) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(SPLIT_TYPEHASH, albumId, _albums[albumId].revision,
            keccak256(abi.encode(recipients)), keccak256(abi.encode(sharesBps)), keccak256(abi.encode(positions)))));
    }

    function updateAlbumOwners(bytes32 albumId, address[] calldata recipients, uint16[] calldata sharesBps,
        string[] calldata positions, bytes[] calldata approvals) external {
        Album storage album = _ownedAlbum(albumId);
        _validateSplit(recipients, sharesBps, positions);
        require(approvals.length == album.recipients.length);
        bytes32 digest = albumSplitDigest(albumId, recipients, sharesBps, positions);
        for (uint256 index = 0; index < album.recipients.length; index++) {
            require(SignatureChecker.isValidSignatureNow(album.recipients[index], digest, approvals[index]));
        }
        album.recipients = recipients;
        album.sharesBps = sharesBps;
        delete album.positions;
        for (uint256 index = 0; index < positions.length; index++) album.positions.push(positions[index]);
        album.revision++;
        emit AlbumSplitUpdated(albumId, album.revision, recipients, sharesBps, positions);
    }

    function transferAlbumManagement(bytes32 albumId, address nextOwner) external {
        Album storage album = _ownedAlbum(albumId);
        require(nextOwner != address(0));
        address previousOwner = album.mainOwner;
        album.mainOwner = nextOwner;
        emit AlbumManagementTransferred(albumId, previousOwner, nextOwner);
    }

    function updateAlbumManifest(bytes32 albumId, string calldata manifestURI) external {
        Album storage album = _ownedAlbum(albumId);
        require(bytes(manifestURI).length > 0);
        album.manifestURI = manifestURI;
        emit AlbumManifestUpdated(albumId, manifestURI);
    }

    function updateAlbumFees(bytes32 albumId, uint256 listenPrice, uint256 albumPrice) external {
        Album storage album = _ownedAlbum(albumId);
        require(listenPrice > 0 && albumPrice > 0);
        album.listenPrice = listenPrice;
        album.albumPrice = albumPrice;
        emit AlbumFeesUpdated(albumId, listenPrice, albumPrice);
    }

    function registerAlbumSong(bytes32 albumId, bytes32 songId, string calldata audioURI) external onlyRole(REGISTRAR_ROLE) {
        Album storage album = _albums[albumId];
        require(album.mainOwner != address(0));
        require(bytes(_songs[songId].audioURI).length == 0 && album.songIds.length < MAX_LISTEN_BATCH);
        _setSong(songId, audioURI, album.recipients, album.sharesBps);
        songAlbum[songId] = albumId;
        songSplitRevision[songId] = album.revision;
        album.songIds.push(songId);
        emit AlbumSongRegistered(albumId, songId, album.revision);
    }

    function syncAlbumSongSplits(bytes32 albumId, bytes32[] calldata songIds) external {
        Album storage album = _ownedAlbum(albumId);
        require(songIds.length > 0 && songIds.length <= MAX_LISTEN_BATCH);
        for (uint256 index = 0; index < songIds.length; index++) {
            bytes32 songId = songIds[index];
            require(songAlbum[songId] == albumId);
            Song storage song = _songs[songId];
            song.recipients = album.recipients;
            song.sharesBps = album.sharesBps;
            songSplitRevision[songId] = album.revision;
            emit SongSplitUpdated(songId, albumId, album.revision);
        }
    }

    function getAlbum(bytes32 albumId) external view returns (Album memory) { return _albums[albumId]; }

    function configureSong(bytes32 songId, string calldata audioURI, address[] calldata recipients, uint16[] calldata sharesBps)
        external override onlyRole(DEFAULT_ADMIN_ROLE) {
        require(songAlbum[songId] == bytes32(0));
        _setSong(songId, audioURI, recipients, sharesBps);
    }

    function quoteListens(bytes32[] calldata songIds) external view returns (uint256 amount) {
        require(songIds.length > 0 && songIds.length <= MAX_LISTEN_BATCH);
        for (uint256 index = 0; index < songIds.length; index++) {
            require(_songs[songIds[index]].enabled);
            amount += _listenPrice(songIds[index]);
        }
    }

    function purchaseAlbum(bytes32 albumId, uint256 maxTotal) external whenNotPaused nonReentrant returns (uint256 purchaseId) {
        Album storage album = _albums[albumId];
        require(album.mainOwner != address(0) && album.songIds.length > 0);
        require(album.albumPrice <= maxTotal);
        for (uint256 index = 0; index < album.songIds.length; index++) require(_songs[album.songIds[index]].enabled);
        uint256 beforeBalance = paymentToken.balanceOf(address(this));
        paymentToken.safeTransferFrom(msg.sender, address(this), album.albumPrice);
        require(paymentToken.balanceOf(address(this)) - beforeBalance == album.albumPrice);
        uint256 artistAmount = album.albumPrice * 9000 / 10000;
        uint256 repoAmount = album.albumPrice * REPO_DEV_SHARE_BPS / 10000;
        _creditArtists(album.recipients, album.sharesBps, artistAmount);
        purchaseId = nextPurchaseId++;
        _depositRepoFund(repoAmount, album.albumPrice - artistAmount - repoAmount, keccak256(abi.encode("album", purchaseId)));
        emit ListensPurchased(purchaseId, msg.sender, album.songIds, album.albumPrice);
        emit AlbumPurchased(albumId, msg.sender, purchaseId, album.albumPrice);
    }

    function gasQuoteDigest(address listener, bytes32 songId, uint256 maxPrice, uint256 fulfillmentCostWei,
        uint256 nonce, uint256 deadline) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(GAS_QUOTE_TYPEHASH, listener, songId, maxPrice, fulfillmentCostWei, nonce, deadline)));
    }

    function requestPlay(bytes32, uint256) external override returns (uint256) {
        revert("Signed gas quote required");
    }

    function requestPlayWithGas(bytes32 songId, uint256 maxPrice, uint256 fulfillmentCostWei,
        uint256 deadline, bytes calldata signature) external payable virtual whenNotPaused nonReentrant returns (uint256 requestId) {
        require(deadline >= block.timestamp && deadline <= block.timestamp + 5 minutes);
        require(fulfillmentCostWei > 0 && fulfillmentCostWei <= maxGasContributionWei / 2);
        require(msg.value == fulfillmentCostWei * 2);
        uint256 nonce = gasQuoteNonces[msg.sender]++;
        bytes32 digest = gasQuoteDigest(msg.sender, songId, maxPrice, fulfillmentCostWei, nonce, deadline);
        require(SignatureChecker.isValidSignatureNow(gasWorker, digest, signature));
        requestId = _requestPlay(songId, maxPrice);
        (bool sent,) = gasWorker.call{value: msg.value}("");
        require(sent);
        emit WorkerGasFunded(requestId, msg.sender, gasWorker, msg.value);
    }

    function _listenPrice(bytes32 songId) internal view override returns (uint256) {
        bytes32 albumId = songAlbum[songId];
        return albumId == bytes32(0) ? LISTEN_PRICE : _albums[albumId].listenPrice;
    }

    function _ownedAlbum(bytes32 albumId) internal view returns (Album storage album) {
        album = _albums[albumId];
        require(album.mainOwner == msg.sender);
    }

    function _validateSplit(address[] calldata recipients, uint16[] calldata sharesBps, string[] calldata positions) internal pure {
        require(recipients.length > 0 && recipients.length <= 16 && recipients.length == sharesBps.length && recipients.length == positions.length);
        uint256 total;
        for (uint256 index = 0; index < recipients.length; index++) {
            require(recipients[index] != address(0) && sharesBps[index] > 0 && bytes(positions[index]).length <= 80);
            for (uint256 previous = 0; previous < index; previous++) require(recipients[index] != recipients[previous]);
            total += sharesBps[index];
        }
        require(total == 10000);
    }
}