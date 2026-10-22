pragma solidity ^0.8.26;

import "./DecentJukeBox_v0.2.sol";

/// @notice Direct artist settlement; the inherited EIP-712 signing domain remains version "0.2".
contract DecentJukeBox_v0_3 is DecentJukeBox_v0_2 {
    using SafeERC20 for IERC20;

    string public constant CONTRACT_VERSION = "0.3";

    struct ArtistLedger {
        uint256 totalPaid;
        uint256 payoutCount;
    }

    mapping(address => ArtistLedger) public artistLedger;
    event ArtistPaid(address indexed artist, uint256 amount, uint256 cumulativePaid);

    constructor(address token, address router, bytes32 repoId, bytes32 pinnerId, address admin,
        address payable worker, uint256 gasContributionCap)
        DecentJukeBox_v0_2(token, router, repoId, pinnerId, admin, worker, gasContributionCap) {}

    function _creditArtists(address[] storage recipients, uint16[] storage sharesBps, uint256 artistAmount)
        internal override
    {
        // Freeze settlement terms before external token calls.
        address[] memory payees = recipients;
        uint16[] memory shares = sharesBps;
        uint256 paid;
        for (uint256 index = 0; index < payees.length; index++) {
            uint256 amount = index + 1 == payees.length
                ? artistAmount - paid
                : artistAmount * shares[index] / 10000;
            paid += amount;
            if (amount == 0) continue;
            ArtistLedger storage ledger = artistLedger[payees[index]];
            ledger.totalPaid += amount;
            ledger.payoutCount++;
            paymentToken.safeTransfer(payees[index], amount);
            emit ArtistPaid(payees[index], amount, ledger.totalPaid);
        }
    }
}
