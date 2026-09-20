// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AstryumVault} from "../src/AstryumVault.sol";
import {MockFXRP, Mock4626Venue, MockQueuedVenue} from "./mocks/Mocks.sol";

/**
 * Invariant fuzzing of the COOLDOWN pote — the novel machine (queued venue,
 * tickets, earmarks). The fuzzer interleaves every economic action (deposits,
 * exit requests, venue yield and loss, direction, harvests, period boundaries,
 * claims) and after EVERY sequence the canon must hold:
 *
 *  P1  ticket money is never hollow: what the pote owes (payee claims +
 *      unclaimed tickets) is physically in the buffer or already queued at a
 *      venue — a later venue loss can hit the HOLDERS' share price, never the
 *      leavers' fixed tickets;
 *  P2  the operator, in total and forever, receives at most the payee cap of
 *      the yield that ever entered — the principal is unreachable (I1);
 *  P3  the queued-exit ledger matches the venue's own queue, period by period
 *      (the Firelight books can never silently diverge).
 *
 * The queued venue's losses are bounded to its UNQUEUED assets — that models
 * Firelight's contract guarantee (withdrawAssets is fixed at request), which
 * verify-firelight reads from the real impl.
 */
contract PoteBHandler is Test {
    AstryumVault public pote;
    MockFXRP public fxrp;
    MockQueuedVenue public firelight; // venueId 1
    Mock4626Venue public sync; // venueId 0

    address public council;
    address public operator;
    address[3] public holders;
    address public sink = address(0xdead);

    bytes32 constant REF = keccak256("politica-rendimiento-v1");

    uint256 public ghostYieldInjected;
    uint256 public ghostOperatorReceived;
    uint256[] public touchedPeriods;
    mapping(uint256 => bool) seenPeriod;
    uint256 public nextTicket;

    constructor(AstryumVault pote_, MockFXRP fxrp_, Mock4626Venue sync_, MockQueuedVenue fl, address council_) {
        pote = pote_;
        fxrp = fxrp_;
        sync = sync_;
        firelight = fl;
        council = council_;
        operator = makeAddr("operator");
        holders = [makeAddr("h1"), makeAddr("h2"), makeAddr("h3")];

        // The operator's cut sits AT the hard cap — the tightest bound P2 can face.
        address[] memory accounts = new address[](1);
        uint16[] memory bps = new uint16[](1);
        accounts[0] = operator;
        bps[0] = 2000;
        vm.prank(council);
        pote.setPayees(accounts, bps, REF);

        vm.prank(council);
        pote.cede(operator, type(uint64).max, REF);

        for (uint256 i = 0; i < 3; i++) {
            fxrp.mint(holders[i], 10_000_000e6);
            vm.prank(holders[i]);
            fxrp.approve(address(pote), type(uint256).max);
        }
    }

    function _trackPeriod(uint256 p) internal {
        if (!seenPeriod[p]) {
            seenPeriod[p] = true;
            touchedPeriods.push(p);
        }
    }

    function touchedPeriodCount() external view returns (uint256) {
        return touchedPeriods.length;
    }

    // ── holder actions ───────────────────────────────────────────────────────

    function deposit(uint8 who, uint96 amount) external {
        address h = holders[who % 3];
        uint256 amt = bound(uint256(amount), 1e6, 200_000e6);
        vm.prank(h);
        pote.deposit(amt, h);
    }

    function requestRedeem(uint8 who, uint96 sharesSeed) external {
        address h = holders[who % 3];
        uint256 bal = pote.balanceOf(h);
        if (bal == 0) return;
        uint256 shares = bound(uint256(sharesSeed), 1, bal);
        _trackPeriod(firelight.currentPeriod() + 1); // where an unwind would queue
        // An honest revert (e.g. dust unwind shortfall) is tolerated by the
        // harness (fail_on_revert = false); the invariants must hold anyway.
        vm.prank(h);
        pote.requestRedeem(shares, h);
    }

    function finishNextTicket() external {
        if (nextTicket >= pote.redeemTicketCount()) return;
        AstryumVault.VenueClaim[] memory none = new AstryumVault.VenueClaim[](0);
        (, , , bool claimed) = pote.redeemTickets(nextTicket);
        if (claimed) {
            nextTicket++;
            return;
        }
        try pote.claimRedeem(nextTicket, none) {
            nextTicket++;
        } catch {
            // not mature, or assets still queued at the venue — fine
        }
    }

    // ── operator actions ─────────────────────────────────────────────────────

    function direct(uint96 amount, bool toQueued) external {
        uint256 free = pote.freeBalance();
        if (free < 2e6) return;
        uint256 amt = bound(uint256(amount), 1e6, free);
        if (toQueued) _trackPeriod(firelight.currentPeriod() + 1);
        vm.prank(operator);
        try pote.directTo(toQueued ? 1 : 0, amt, REF) {} catch {}
    }

    function recallSync(uint96 amount) external {
        uint256 live = sync.convertToAssets(sync.balanceOf(address(pote)));
        if (live == 0) return;
        uint256 amt = bound(uint256(amount), 1, live);
        vm.prank(operator);
        try pote.recall(0, amt, REF) {} catch {}
    }

    function recallQueued(uint96 amount) external {
        uint256 live = firelight.convertToAssets(firelight.balanceOf(address(pote)));
        if (live == 0) return;
        uint256 amt = bound(uint256(amount), 1, live);
        _trackPeriod(firelight.currentPeriod() + 1);
        vm.prank(operator);
        try pote.recall(1, amt, REF) {} catch {}
    }

    function harvest(bool queued) external {
        try pote.harvest(queued ? 1 : 0) {} catch {}
    }

    function claimAsOperator() external {
        uint256 c = pote.claimable(operator);
        if (c == 0) return;
        vm.prank(operator);
        pote.claim();
        ghostOperatorReceived += c;
    }

    // ── the world ────────────────────────────────────────────────────────────

    function addYield(uint96 amount, bool toQueued) external {
        uint256 amt = bound(uint256(amount), 1, 5_000e6);
        if (toQueued) {
            if (firelight.totalShares() == 0) return;
            fxrp.mint(address(firelight), amt);
        } else {
            if (sync.totalShares() == 0) return;
            fxrp.mint(address(sync), amt);
        }
        ghostYieldInjected += amt;
    }

    function loseMoneySync(uint96 amount) external {
        uint256 held = fxrp.balanceOf(address(sync));
        if (held == 0) return;
        sync.simulateLoss(bound(uint256(amount), 1, held), sink);
    }

    /// Bounded to the UNQUEUED assets — Firelight's fixed-at-request guarantee.
    function loseMoneyQueued(uint96 amount) external {
        uint256 unqueued = firelight.totalAssets();
        if (unqueued == 0) return;
        firelight.simulateLoss(bound(uint256(amount), 1, unqueued), sink);
    }

    /// One 24h boundary: the venue's clock and the chain's clock move together.
    function advancePeriod() external {
        firelight.advancePeriod();
        vm.warp(block.timestamp + 1 days);
    }

    function claimVenuePeriod(uint8 idx) external {
        if (touchedPeriods.length == 0) return;
        uint256 p = touchedPeriods[idx % touchedPeriods.length];
        try pote.claimVenue(1, p) {} catch {}
    }

    // ── views for the invariants ─────────────────────────────────────────────

    function sumRecordedQueue() external view returns (uint256 total) {
        for (uint256 i = 0; i < touchedPeriods.length; i++) {
            total += pote.venueQueued(1, touchedPeriods[i]);
        }
    }

    function sumVenueSideQueue() external view returns (uint256 total) {
        for (uint256 i = 0; i < touchedPeriods.length; i++) {
            total += firelight.withdrawalsOf(touchedPeriods[i], address(pote));
        }
    }
}

contract AstryumVaultInvariantTest is Test {
    AstryumVault pote;
    MockFXRP fxrp;
    Mock4626Venue sync;
    MockQueuedVenue firelight;
    PoteBHandler handler;

    address council = makeAddr("council");
    bytes32 constant REF = keccak256("politica-rendimiento-v1");

    function setUp() public {
        fxrp = new MockFXRP();
        sync = new Mock4626Venue(fxrp);
        firelight = new MockQueuedVenue(fxrp);

        AstryumVault.InitialVenue[] memory init = new AstryumVault.InitialVenue[](2);
        init[0] = AstryumVault.InitialVenue(address(sync), AstryumVault.VenueKind.ERC4626);
        init[1] = AstryumVault.InitialVenue(address(firelight), AstryumVault.VenueKind.ERC4626Queued);
        pote = new AstryumVault(fxrp, "Astryum Pote B", "apB-FXRP", council, REF, 72 hours, 1000, init);

        handler = new PoteBHandler(pote, fxrp, sync, firelight, council);
        targetContract(address(handler));
    }

    /// P1 — ticket money is never hollow: everything the pote owes is either
    /// in the buffer or already fixed inside a venue queue. Venue losses hit
    /// the holders' share price, never what leavers were promised.
    function invariant_ObligationsAlwaysBacked() public view {
        uint256 backing = fxrp.balanceOf(address(pote)) + pote.venueQueuedTotal(1);
        assertGe(backing + 2, pote.totalClaimable() + pote.earmarkedAssets());
    }

    /// P2 — the operator can NEVER extract more than the capped cut of the
    /// yield that ever entered the system. This is I1 in fuzz form: across any
    /// interleaving, the principal is out of the operator's reach.
    function invariant_OperatorNeverExceedsTheCappedCut() public view {
        uint256 cap = (handler.ghostYieldInjected() * 2000) / 10_000;
        // + one dust unit per possible harvest rounding
        assertLe(handler.ghostOperatorReceived() + pote.claimable(handler.operator()), cap + 100);
    }

    /// P3 — the Firelight books can never silently diverge: our per-period
    /// ledger equals our venue-side queue, and the total matches.
    function invariant_QueuedLedgerMatchesTheVenue() public view {
        assertEq(handler.sumRecordedQueue(), pote.venueQueuedTotal(1));
        assertEq(handler.sumVenueSideQueue(), handler.sumRecordedQueue());
    }
}
