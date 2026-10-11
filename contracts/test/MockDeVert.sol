pragma solidity ^0.8.26;

contract MockDeVertDJuke {
    struct Request {
        bytes32 songId;
        address payer;
        uint256 amount;
        bool fulfilled;
        uint256 revision;
        address[] recipients;
        uint16[] sharesBps;
    }

    mapping(uint256 => Request) private _requests;

    function setPaidRequest(uint256 requestId, address payer, uint256 amount) external {
        _requests[requestId].payer = payer;
        _requests[requestId].amount = amount;
    }

    function getRequest(uint256 requestId) external view returns (
        bytes32 songId, address payer, uint256 amount, bool fulfilled, uint256 revision,
        address[] memory recipients, uint16[] memory sharesBps
    ) {
        Request storage request = _requests[requestId];
        return (request.songId, request.payer, request.amount, request.fulfilled,
            request.revision, request.recipients, request.sharesBps);
    }
}