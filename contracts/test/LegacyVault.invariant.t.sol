// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {LegacyVault} from "../src/LegacyVault.sol";
import {MockFXRP, Mock4626Venue} from "./mocks/Mocks.sol";

/**
 * Invariant fuzzing: the fuzzer plays arbitrary interleavings of every
 * economic action (deposit, direct, yield, loss, harvest, recall, move,
 * evacuate, claim) and after EVERY sequence the defining properties must hold:
 *
 *  I1  the vault's balance always covers idle principal + every claim
 *      (the books are never hollow);
 *  I2  people (payees + treasury) never receive, in total, more than the
 *      yield that ever entered the system — the principal is unreachable;
 *  I3  the allocation ledger matches the per-venue books.
 */
contract Handler is Test {
    LegacyVault public vault;
    MockFXRP public fxrp;
    Mock4626Venue public venueA;
    Mock4626Venue public venueB;

    address public council;
    address[3] public family;
    address public sink = address(0xdead);

    bytes32 constant REF = keccak256("constitucion-serra-v1");

    uint256 public ghostYieldInjected;
    uint256 public ghostClaimed;

    constructor(LegacyVault vault_, MockFXRP fxrp_, Mock4626Venue a, Mock4626Venue b, address council_) {
        vault = vault_;
        fxrp = fxrp_;
        venueA = a;
        venueB = b;
        council = council_;
        family = [makeAddr("laia"), makeAddr("pau"), makeAddr("fundacion")];

        address[] memory accounts = new address[](3);
        uint16[] memory bps = new uint16[](3);
        accounts[0] = family[0];
        bps[0] = 5000;
        accounts[1] = family[1];
        bps[1] = 4500;
        accounts[2] = family[2];
        bps[2] = 500;
        vm.prank(council);
        vault.setPayees(accounts, bps, REF);
    }

    function deposit(uint96 amount) external {
        uint256 amt = bound(uint256(amount), 1e6, 100_000e6);
        fxrp.mint(address(this), amt);
        fxrp.approve(address(vault), amt);
        vault.deposit(amt);
    }

    function direct(uint96 amount, bool toB) external {
        uint256 idle = vault.idlePrincipal();
        if (idle == 0) return;
        uint256 amt = bound(uint256(amount), 1, idle);
        vm.prank(council);
        vault.directTo(toB ? 1 : 0, amt, REF);
    }

    function addYield(uint96 amount, bool toB) external {
        Mock4626Venue v = toB ? venueB : venueA;
        if (v.totalShares() == 0) return; // yield needs a position to accrue on
        uint256 amt = bound(uint256(amount), 1, 5_000e6);
        fxrp.mint(address(v), amt);
        ghostYieldInjected += amt;
    }

    function loseMoney(uint96 amount, bool toB) external {
        Mock4626Venue v = toB ? venueB : venueA;
        uint256 held = fxrp.balanceOf(address(v));
        if (held == 0) return;
        uint256 amt = bound(uint256(amount), 1, held);
        v.simulateLoss(amt, sink);
    }

    function harvest(bool toB) external {
        vault.harvest(toB ? 1 : 0);
    }

    function recall(uint96 amount, bool toB) external {
        uint256 id = toB ? 1 : 0;
        uint256 basis = vault.venueBasis(id);
        if (basis == 0) return;
        uint256 amt = bound(uint256(amount), 1, basis);
        // The venue may be under water and unable to pay: an honest revert,
        // not an invariant break (fail_on_revert = false).
        vm.prank(council);
        vault.recall(id, amt, REF);
    }

    function move(uint96 amount, bool fromB) external {
        uint256 fromId = fromB ? 1 : 0;
        uint256 basis = vault.venueBasis(fromId);
        if (basis == 0) return;
        uint256 amt = bound(uint256(amount), 1, basis);
        vm.prank(council);
        vault.moveToVenue(fromId, fromB ? 0 : 1, amt, REF);
    }

    function evacuate(bool toB) external {
        vm.prank(council);
        vault.evacuate(toB ? 1 : 0, REF);
    }

    function claimAs(uint8 who) external {
        address account = family[who % 3];
        uint256 c = vault.claimable(account);
        if (c == 0) return;
        vm.prank(account);
        vault.claim();
        ghostClaimed += c;
    }
}

contract LegacyVaultInvariantTest is Test {
    LegacyVault vault;
    MockFXRP fxrp;
    Mock4626Venue venueA;
    Mock4626Venue venueB;
    Handler handler;

    address council = makeAddr("council");
    address treasury = makeAddr("astryumTreasury");
    bytes32 constant REF = keccak256("constitucion-serra-v1");

    function setUp() public {
        fxrp = new MockFXRP();
        venueA = new Mock4626Venue(fxrp);
        venueB = new Mock4626Venue(fxrp);

        LegacyVault.InitialVenue[] memory init = new LegacyVault.InitialVenue[](2);
        init[0] = LegacyVault.InitialVenue(address(venueA), LegacyVault.VenueKind.ERC4626);
        init[1] = LegacyVault.InitialVenue(address(venueB), LegacyVault.VenueKind.ERC4626);
        vault = new LegacyVault(fxrp, council, REF, treasury, 3000, init);

        handler = new Handler(vault, fxrp, venueA, venueB, council);
        targetContract(address(handler));
    }

    /// I1 — the books are never hollow: what the vault owes in idle principal
    /// and claims is always physically there.
    function invariant_BalanceCoversBooks() public view {
        assertGe(fxrp.balanceOf(address(vault)), vault.idlePrincipal() + vault.totalClaimable());
    }

    /// I2 — THE product invariant: across any action sequence, everything
    /// people ever received plus everything still claimable is at most the
    /// yield that entered the system. The principal cannot leak out.
    function invariant_PeopleNeverGetMoreThanYield() public view {
        assertLe(handler.ghostClaimed() + vault.totalClaimable(), handler.ghostYieldInjected());
    }

    /// I3 — the allocation ledger matches the per-venue books.
    function invariant_AllocationLedgerConsistent() public view {
        assertEq(vault.allocatedPrincipal(), vault.venueBasis(0) + vault.venueBasis(1));
        assertLe(vault.allocatedPrincipal(), vault.totalPrincipal());
    }
}
