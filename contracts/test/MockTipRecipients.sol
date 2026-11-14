// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IMockTipRouter {
    function tip(address recipient, uint8 sourceKind, string calldata contextRef) external payable;
}

/// Test-only recipients for DecentBuskingTipRouter. Never deployed outside tests.

contract RejectingTipRecipient {
    receive() external payable {
        revert("tips refused");
    }
}

/// Behaves like a proxy wallet whose receive hook needs far more than the 2300-gas transfer stipend.
contract GasHungryTipRecipient {
    uint256[4] public slots;
    uint256 public received;

    receive() external payable {
        for (uint256 i = 0; i < 4; ++i) slots[i] = msg.value + i;
        received += msg.value;
    }
}

/// Keeps half of each tip and tips the other half onward, re-entering the router once.
contract ReentrantTipRecipient {
    IMockTipRouter public immutable router;
    address public onward;
    uint8 public kind;
    string public ref;
    bool private armed;

    constructor(IMockTipRouter router_) {
        router = router_;
    }

    function arm(address onward_, uint8 kind_, string calldata ref_) external {
        onward = onward_;
        kind = kind_;
        ref = ref_;
        armed = true;
    }

    receive() external payable {
        if (!armed) return;
        armed = false;
        router.tip{value: msg.value / 2}(onward, kind, ref);
    }
}
