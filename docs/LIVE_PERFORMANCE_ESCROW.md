# LivePerformanceEscrow — undeployed proposal

Refs TheJollyLaMa/DecentBusking#210 and TheJollyLaMa/DecentBusking#223.

Sources belong here because DecentMarket already develops DJuke, DVert and settlement-connected contracts with Hardhat/OpenZeppelin. No deployment, verification transaction, funds movement or production configuration is authorized by this PR. Tomorrow uses the deployed settlement router, **earmarked, NOT escrowed**; router admins retain `recoverFund`.

## Agreement / invariants

- Immutable token constructor argument must be Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` for a separately approved Base deployment. Tests use mocks; the constructor is not a chain deployment authorization.
- `ADMIN_ROLE` creates/funds a unique bytes32 booking and reviews it. `DEFAULT_ADMIN_ROLE` administers role membership. Sponsor/funder is the creating admin; refunds always return there, never to an arbitrary destination.
- `createBooking(id, performer, amount, showStart, showEnd, claimDeadline, termsHash, termsUri, reviewWindow, cancellationWindow, killFeeBps)` takes USDC using an exact allowance. Amount is six-decimal USDC units, times are UTC Unix seconds, windows are seconds and basis points range 0–10000.
- All policy parameters are per-booking. **72 hours, 48 hours and 25% are draft examples, not binding defaults.** Off-chain steward approval and both parties’ acknowledgement of the precise hashed agreement precede funding in the companion UI.
- Full/partial approval after show end and strictly before review-end reserves performer payment and immediately refunds the remainder. Every decision, including full approval, requires a nonempty report. Claim is performer-only and cannot repeat.
- At `showEnd + reviewWindow`, full auto-claim vests if undecided. Late admin approval/rejection is blocked, preventing a race to defeat performer protection.
- Before show start, admin cancellation inside the agreed window reserves the agreed kill fee for performer claim and refunds the remainder; earlier cancellation fully refunds. Performer cancellation fully refunds. Exact cancellation-window boundary is early (strictly less than window means late).
- In-progress schedule cancellation is distinct: contract pre-show cancellation is unavailable after start; review/rejection after end handles the financial outcome.
- `claimDeadline` must be later than review-end. After that deadline anyone can `expire`, returning only unpaid liability to the original funder. Claim deadline/expiry must be expressly agreed in the published terms.
- All booking events carry `termsHash`; no arbitrary admin withdrawal or recovery method exists. Reentrancy guard and checks-effects-interactions protect all token-moving paths. Exact received-amount check rejects fee-on-transfer funding.
- Emergency pause blocks all lifecycle operations (including claims/refunds); roles can still be administered and admin can unpause. This liveness/admin-role risk must be disclosed; no claim of immunity from operational pauses is made.

## Validation and future deployment checklist (not execution authorization)

`npx hardhat test test/LivePerformanceEscrow.test.js` and `npx hardhat test test/*.test.js`.

Before any separately authorized deployment: steward finalizes agreement; independent contract review; validate Base USDC/token/admin constructor values; decide review/deadline/pause governance; deploy and verify BaseScan/Sourcify; export ABI; configure worker `LIVE_PERFORMANCE_ESCROW_ADDRESS` and `LIVE_PERFORMANCE_ESCROW_START_BLOCK`; register address in the Alchemy webhook dashboard. Companion worker registers the configured address with its read-only RPC proxy and webhook dispatcher. Rehearse a low-value booking with explicit authorization first. Leave address unset for tomorrow.

## Deployment scripts

- **Local Base-fork rehearsal (no keys, never broadcasts):** `BASE_FORK_RPC=https://mainnet.base.org npx hardhat run scripts/rehearse_live_performance_escrow.js` deploys with real Base USDC as the impersonated owner and walks fund → early cancel → approve + performer claim → reject → stranger-claim block → expiry, asserting the escrow ends with zero USDC.
- **Base mainnet:** put the owner key (`0x807061DF657A7697c04045dA7d16D941861cAABc`) in the ignored `DecentMarket/.env` as `PRIVATE_KEY=0x…` (`BASE_RPC_URL` optional). `npx hardhat run scripts/deploy_live_performance_escrow.js --network base` is a dry run (address check, gas estimate, balance check). Add `CONFIRM_DEPLOY=yes` to broadcast. The script refuses any other deployer, pins token = Base USDC and admin = owner, waits two confirmations, verifies roles and writes `deployments/live-performance-escrow-base.json` including `startBlock`.
- After deploy: `npx hardhat verify --network base <address> 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 0x807061DF657A7697c04045dA7d16D941861cAABc`, then set worker `LIVE_PERFORMANCE_ESCROW_ADDRESS` / `LIVE_PERFORMANCE_ESCROW_START_BLOCK` and add the address to the Alchemy webhook.
