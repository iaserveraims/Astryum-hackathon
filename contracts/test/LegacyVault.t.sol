// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {LegacyVault} from "../src/LegacyVault.sol";
import {MockFXRP, Mock4626Venue, MockCompoundVenue, MaliciousVenue} from "./mocks/Mocks.sol";

contract LegacyVaultTest is Test {
    MockFXRP fxrp;
    Mock4626Venue firelight; // ERC-4626-shaped (venue 0)
    MockCompoundVenue kinetic; // Compound-shaped (venue 1)
    LegacyVault vault;

    address council = makeAddr("council");
    address treasury = makeAddr("astryumTreasury");
    address laia = makeAddr("laia"); // director / payee
    address pau = makeAddr("pau"); // payee
    address fundacion = makeAddr("fundacion"); // payee
    address stranger = makeAddr("stranger");

    bytes32 constant REF = keccak256("constitucion-serra-v1");
    uint16 constant LINAJE = 3000; // 30% initial (D5)

    function setUp() public {
        fxrp = new MockFXRP();
        firelight = new Mock4626Venue(fxrp);
        kinetic = new MockCompoundVenue(fxrp);

        LegacyVault.InitialVenue[] memory init = new LegacyVault.InitialVenue[](2);
        init[0] = LegacyVault.InitialVenue(address(firelight), LegacyVault.VenueKind.ERC4626);
        init[1] = LegacyVault.InitialVenue(address(kinetic), LegacyVault.VenueKind.CompoundV2);
        vault = new LegacyVault(fxrp, council, REF, treasury, LINAJE, init);

        fxrp.mint(address(this), 1_000_000e6);
        fxrp.approve(address(vault), type(uint256).max);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _depositAndDirect(uint256 amount, uint256 venueId) internal {
        vault.deposit(amount);
        vm.prank(council);
        vault.directTo(venueId, amount, REF);
    }

    function _setFamilyPayees() internal {
        address[] memory accounts = new address[](3);
        uint16[] memory bps = new uint16[](3);
        accounts[0] = laia;
        bps[0] = 5000;
        accounts[1] = pau;
        bps[1] = 4500;
        accounts[2] = fundacion;
        bps[2] = 500;
        vm.prank(council);
        vault.setPayees(accounts, bps, REF);
    }

    /* ═══════════════════════════════════════════════════════════════════════
       EL TEST QUE DEFINE EL PRODUCTO: nadie, por ninguna vía, saca del vault
       más que el yield. Si esto pasa, hay Legacy; si falla, hay puerta trasera.
       ═══════════════════════════════════════════════════════════════════════ */

    function test_DefiningInvariant_NothingButYieldEverLeavesToPeople() public {
        _setFamilyPayees();
        _depositAndDirect(100_000e6, 0);

        // The venue produces 10% yield.
        fxrp.mint(address(firelight), 10_000e6);

        // Anyone harvests (permissionless — D3).
        vm.prank(stranger);
        vault.harvest(0);

        // Everything claimable, across every account, is at most the yield
        // minus the linaje cut. The principal is not reachable.
        uint256 yieldRealized = 10_000e6;
        uint256 linajeCut = (yieldRealized * LINAJE) / 10_000;
        uint256 distributable = yieldRealized - linajeCut;

        uint256 totalOut;
        address[4] memory everyone = [laia, pau, fundacion, treasury];
        for (uint256 i = 0; i < everyone.length; i++) {
            uint256 c = vault.claimable(everyone[i]);
            if (c > 0) {
                vm.prank(everyone[i]);
                vault.claim();
                totalOut += c;
            }
        }
        assertLe(totalOut, distributable, "more than yield left the vault");
        // The linaje grew: principal absorbed its cut (plus rounding dust).
        assertGe(vault.totalPrincipal(), 100_000e6 + linajeCut, "linaje cut did not capitalize");
        // And the vault still covers the whole principal.
        assertGe(vault.totalValue(), vault.totalPrincipal(), "principal not covered");
    }

    function test_DefiningInvariant_CouncilCannotExtractPrincipal() public {
        _depositAndDirect(50_000e6, 0);

        // 1. There is no withdraw function — the council can only recall to
        //    the vault itself, where the only exits are venues and yield.
        vm.prank(council);
        vault.recall(0, 50_000e6, REF);
        assertEq(fxrp.balanceOf(council), 0);
        assertEq(vault.idlePrincipal(), 50_000e6);

        // 2. Council names itself sole payee and harvests: no yield, nothing.
        address[] memory accounts = new address[](1);
        uint16[] memory bps = new uint16[](1);
        accounts[0] = council;
        bps[0] = 10_000;
        vm.startPrank(council);
        vault.setPayees(accounts, bps, REF);
        vault.directTo(0, 50_000e6, REF);
        vm.stopPrank();
        vault.harvest(0);
        vm.prank(council);
        vm.expectRevert(LegacyVault.NothingToClaim.selector);
        vault.claim();

        // 3. Even with yield, the council-as-payee only ever gets the yield.
        fxrp.mint(address(firelight), 1_000e6);
        vault.harvest(0);
        uint256 c = vault.claimable(council);
        assertLe(c, (uint256(1_000e6) * (10_000 - uint256(LINAJE))) / 10_000);
    }

    function test_DefiningInvariant_DirectorCannotTouchPrincipal() public {
        _depositAndDirect(10_000e6, 0);
        vm.prank(council);
        vault.cede(laia, uint64(block.timestamp + 365 days), REF);

        // The director directs between venues' ENTRY only via directTo of idle
        // principal — she cannot recall, move, evacuate, migrate or claim it.
        vm.startPrank(laia);
        vm.expectRevert(LegacyVault.NotCouncil.selector);
        vault.recall(0, 1e6, REF);
        vm.expectRevert(LegacyVault.NotCouncil.selector);
        vault.moveToVenue(0, 1, 1e6, REF);
        vm.expectRevert(LegacyVault.NotCouncil.selector);
        vault.evacuate(0, REF);
        vm.expectRevert(LegacyVault.NothingToClaim.selector);
        vault.claim();
        vm.stopPrank();
        assertEq(fxrp.balanceOf(laia), 0);
    }

    /* ── D1a — the surgical delay on addVenue ─────────────────────────────── */

    function test_D1a_NewVenueWaitsThirtyDays_TheAttackNeedsAWarning() public {
        vault.deposit(10_000e6);
        MaliciousVenue evil = new MaliciousVenue(fxrp, stranger);

        // A captured quorum CAN propose the thief — but the cage announces it
        // on-chain and refuses entry for 30 days. That window is the defense.
        vm.startPrank(council);
        vault.proposeVenue(address(evil), LegacyVault.VenueKind.ERC4626, REF);
        uint256 evilId = vault.venueCount() - 1;
        vm.expectRevert(LegacyVault.VenueNotReady.selector);
        vault.directTo(evilId, 10_000e6, REF);

        // Rescue paths stay immediate meanwhile.
        vault.directTo(0, 10_000e6, REF);
        vault.moveToVenue(0, 1, 10_000e6, REF); // no delay, no cap (D2)
        vm.stopPrank();

        // After the delay the theft is possible — the code documents honestly
        // that the LAST line of defense on venue addition is the family
        // watching the 30-day window, not the code.
        vm.warp(block.timestamp + 30 days);
        vm.startPrank(council);
        vault.moveToVenue(1, 0, 10_000e6, REF);
        vault.recall(0, 10_000e6, REF);
        vault.directTo(evilId, 10_000e6, REF);
        vm.stopPrank();
        assertEq(fxrp.balanceOf(stranger), 10_000e6); // stolen — after 30 loud days
    }

    function test_D1a_ConstructorVenuesAreReadyImmediately() public {
        vault.deposit(1_000e6);
        vm.prank(council);
        vault.directTo(0, 1_000e6, REF); // no revert: birth set is pre-reviewed
    }

    /* ── D2 — the cap limits entry, never rescue ──────────────────────────── */

    function test_D2_EntryCapBlocksConcentration_ButNeverRescue() public {
        vm.prank(council);
        vault.setMaxVenueBps(5000, REF); // max 50% per venue at entry

        vault.deposit(10_000e6);
        vm.startPrank(council);
        vault.directTo(0, 5_000e6, REF); // exactly 50% — fine
        vm.expectRevert(LegacyVault.EntryCapExceeded.selector);
        vault.directTo(0, 4_000e6, REF); // would be 90% in venue 0

        // Rescue ignores the cap completely: kinetic gets 100% if needed.
        vault.directTo(1, 5_000e6, REF);
        vault.moveToVenue(0, 1, 5_000e6, REF); // venue 1 now 100% — allowed
        vm.stopPrank();
        assertEq(vault.venueBasis(1), 10_000e6);
    }

    function test_D2_CapBoundsAreEnforced() public {
        vm.startPrank(council);
        vm.expectRevert(LegacyVault.BpsOutOfBounds.selector);
        vault.setMaxVenueBps(999, REF); // below MIN_VENUE_CAP_BPS
        vm.expectRevert(LegacyVault.BpsOutOfBounds.selector);
        vault.setMaxVenueBps(10_001, REF);
        vm.stopPrank();
    }

    /* ── D3 — harvest permissionless; payees are the single source of truth ─ */

    function test_D3_HarvestSplitsToPayees_DirectorEarnsNothingByRole() public {
        _setFamilyPayees();
        _depositAndDirect(100_000e6, 0);
        vm.prank(council);
        vault.cede(laia, uint64(block.timestamp + 30 days), REF);

        fxrp.mint(address(firelight), 1_000e6); // yield
        vm.prank(stranger);
        vault.harvest(0); // anyone

        uint256 distributable = (uint256(1_000e6) * (10_000 - uint256(LINAJE))) / 10_000;
        assertEq(vault.claimable(laia), (distributable * 5000) / 10_000); // as PAYEE, not as director
        assertEq(vault.claimable(pau), (distributable * 4500) / 10_000);
        assertEq(vault.claimable(fundacion), (distributable * 500) / 10_000);

        vm.prank(laia);
        vault.claim();
        assertEq(fxrp.balanceOf(laia), (distributable * 5000) / 10_000);
    }

    function test_D3_NoPayees_EverythingCapitalizesToLinaje() public {
        _depositAndDirect(100_000e6, 0);
        fxrp.mint(address(firelight), 1_000e6);
        vault.harvest(0);
        // linaje cut + unassigned remainder = the whole realized yield.
        assertEq(vault.totalPrincipal(), 101_000e6);
        assertEq(vault.totalClaimable(), 0);
    }

    function test_D3_PayeeBpsMustSumExactly() public {
        address[] memory accounts = new address[](2);
        uint16[] memory bps = new uint16[](2);
        accounts[0] = laia;
        accounts[1] = pau;
        bps[0] = 5000;
        bps[1] = 4999;
        vm.prank(council);
        vm.expectRevert(LegacyVault.PayeeBpsSumInvalid.selector);
        vault.setPayees(accounts, bps, REF);
    }

    /* ── D4 — the epochal vessel: governed, verified relocation ───────────── */

    function _newSuccessor() internal returns (LegacyVault) {
        LegacyVault.InitialVenue[] memory none = new LegacyVault.InitialVenue[](0);
        return new LegacyVault(fxrp, council, REF, treasury, LINAJE, none);
    }

    function test_D4_MigrationHappyPath() public {
        _setFamilyPayees();
        _depositAndDirect(100_000e6, 0);
        fxrp.mint(address(firelight), 1_000e6);
        vault.harvest(0); // some earned fruit stays claimable in the old vessel

        LegacyVault v2 = _newSuccessor();
        vm.prank(council);
        vault.proposeSuccessor(address(v2), REF);

        vm.prank(council);
        vm.expectRevert(LegacyVault.SuccessorNotMature.selector);
        vault.migrate(REF);

        vm.warp(block.timestamp + 30 days);
        uint256 claimsBefore = vault.totalClaimable();
        vm.prank(council);
        vault.migrate(REF);

        // Everything but earned fruit moved as principal of the successor.
        assertTrue(vault.migrated());
        assertEq(fxrp.balanceOf(address(vault)), claimsBefore);
        assertGe(v2.totalPrincipal(), 100_000e6);

        // The old vessel is closed to capital but still honors claims.
        vm.expectRevert(LegacyVault.AlreadyMigrated.selector);
        vault.deposit(1e6);
        vm.prank(laia);
        vault.claim();
    }

    function test_D4_ContinuityIsVerified_AtProposeAndAtExecute() public {
        vault.deposit(1_000e6);

        // Different constitution → not the same Legacy → refuse at propose.
        LegacyVault.InitialVenue[] memory none = new LegacyVault.InitialVenue[](0);
        LegacyVault alien = new LegacyVault(fxrp, council, keccak256("otra"), treasury, LINAJE, none);
        vm.prank(council);
        vm.expectRevert(LegacyVault.ContinuityBroken.selector);
        vault.proposeSuccessor(address(alien), REF);

        // Continuity can also break DURING the delay → refuse at execute.
        LegacyVault v2 = _newSuccessor();
        vm.prank(council);
        vault.proposeSuccessor(address(v2), REF);
        vm.warp(block.timestamp + 30 days);
        vm.startPrank(council);
        v2.transferCouncil(stranger, REF);
        vm.stopPrank();
        vm.prank(stranger);
        v2.acceptCouncil();
        vm.prank(council);
        vm.expectRevert(LegacyVault.ContinuityBroken.selector);
        vault.migrate(REF);
    }

    /* ── D5 — the linaje floor and ceiling ────────────────────────────────── */

    function test_D5_LinajeBounds() public {
        LegacyVault.InitialVenue[] memory none = new LegacyVault.InitialVenue[](0);
        vm.expectRevert(LegacyVault.BpsOutOfBounds.selector);
        new LegacyVault(fxrp, council, REF, treasury, 999, none); // under floor
        vm.expectRevert(LegacyVault.BpsOutOfBounds.selector);
        new LegacyVault(fxrp, council, REF, treasury, 4001, none); // over ceiling

        vm.startPrank(council);
        vm.expectRevert(LegacyVault.BpsOutOfBounds.selector);
        vault.setLinajeFeeBps(999, REF);
        vm.expectRevert(LegacyVault.BpsOutOfBounds.selector);
        vault.setLinajeFeeBps(4001, REF);
        vault.setLinajeFeeBps(4000, REF); // the ceiling protects the fruit
        vm.stopPrank();
    }

    /* ── D6 — the fee hook: yield only, hard-capped, default 0 ────────────── */

    function test_D6_ProtocolFee_DefaultZero_CappedForever_YieldOnly() public {
        _setFamilyPayees();
        _depositAndDirect(100_000e6, 0);

        // Default 0: harvest routes nothing to the treasury.
        fxrp.mint(address(firelight), 1_000e6);
        vault.harvest(0);
        assertEq(vault.claimable(treasury), 0);

        // Above the immutable cap: never.
        vm.prank(council);
        vm.expectRevert(LegacyVault.BpsOutOfBounds.selector);
        vault.setProtocolFeeBps(1001, REF);

        // Activated at 5%: takes 5% OF YIELD, principal untouched.
        vm.prank(council);
        vault.setProtocolFeeBps(500, REF);
        fxrp.mint(address(firelight), 1_000e6);
        uint256 principalBefore = vault.totalPrincipal();
        vault.harvest(0);
        assertEq(vault.claimable(treasury), (1_000e6 * 500) / 10_000);
        assertGe(vault.totalPrincipal(), principalBefore); // principal only grows here
    }

    /* ── Losses: honest books, harvest never touches basis ────────────────── */

    function test_VenueLoss_HarvestYieldsZero_EvacuateRealizesLoss() public {
        _setFamilyPayees();
        _depositAndDirect(10_000e6, 0);

        firelight.simulateLoss(4_000e6, stranger); // venue drained 40%

        // Under water: yield is zero, nothing distributes, basis untouched.
        vault.harvest(0);
        assertEq(vault.totalClaimable(), 0);
        assertEq(vault.venueBasis(0), 10_000e6);

        // Evacuation realizes the loss honestly.
        vm.prank(council);
        vault.evacuate(0, REF);
        assertEq(vault.totalPrincipal(), 6_000e6);
        assertEq(vault.idlePrincipal(), 6_000e6);
        assertEq(vault.venueBasis(0), 0);
    }

    function test_CompoundVenue_FullCycle() public {
        _depositAndDirect(10_000e6, 1); // kinetic
        // Yield via exchange rate bump (+10%) with real backing tokens.
        fxrp.mint(address(kinetic), 1_000e6);
        kinetic.setExchangeRate(1.1e18);
        assertApproxEqAbs(vault.venueValue(1), 11_000e6, 2);

        _setFamilyPayees();
        vault.harvest(1);
        assertGt(vault.claimable(laia), 0);

        vm.prank(council);
        vault.evacuate(1, REF);
        assertEq(vault.venueBasis(1), 0);
        assertGe(vault.idlePrincipal(), 10_000e6);
    }

    /* ── Governance guards: ref, cession, council, retire ─────────────────── */

    function test_Ref_StaleConstitutionReverts() public {
        vm.startPrank(council);
        vm.expectRevert(LegacyVault.RefMismatch.selector);
        vault.setMaxVenueBps(8000, keccak256("stale"));

        bytes32 v2ref = keccak256("constitucion-serra-v2");
        vault.setConstitutionRef(v2ref, REF);
        vm.expectRevert(LegacyVault.RefMismatch.selector);
        vault.setMaxVenueBps(8000, REF); // old ref now stale
        vault.setMaxVenueBps(8000, v2ref);
        vm.stopPrank();
    }

    function test_Cession_ExpiresAndEnds() public {
        vault.deposit(1_000e6);
        vm.prank(council);
        vault.cede(laia, uint64(block.timestamp + 10 days), REF);

        vm.prank(laia);
        vault.directTo(0, 400e6, REF); // directing within the whitelist: hers

        vm.warp(block.timestamp + 11 days);
        vm.prank(laia);
        vm.expectRevert(LegacyVault.NotDirectorOrCouncil.selector);
        vault.directTo(0, 100e6, REF); // the right EXPIRED; principal never moved

        vm.prank(council);
        vault.endCession(REF);
        assertEq(vault.director(), address(0));
    }

    function test_Council_TwoStepTransfer() public {
        vm.prank(council);
        vault.transferCouncil(stranger, REF);
        assertEq(vault.council(), council); // nothing yet
        vm.prank(laia);
        vm.expectRevert(LegacyVault.NotCouncil.selector);
        vault.acceptCouncil();
        vm.prank(stranger);
        vault.acceptCouncil();
        assertEq(vault.council(), stranger);
    }

    function test_RetiredVenue_ClosedToEntry_OpenToExit() public {
        _depositAndDirect(1_000e6, 0);
        vm.startPrank(council);
        vault.retireVenue(0, REF);
        vm.expectRevert(LegacyVault.VenueRetiredError.selector);
        vault.directTo(0, 1e6, REF);
        vault.recall(0, 500e6, REF); // exits always work
        vault.evacuate(0, REF);
        vm.stopPrank();
        assertEq(vault.idlePrincipal(), 1_000e6);
    }

    function test_StrangerCannotGovern() public {
        vm.startPrank(stranger);
        vm.expectRevert(LegacyVault.NotCouncil.selector);
        vault.setMaxVenueBps(5000, REF);
        vm.expectRevert(LegacyVault.NotCouncil.selector);
        vault.proposeVenue(address(0xdead), LegacyVault.VenueKind.ERC4626, REF);
        vm.expectRevert(LegacyVault.NotDirectorOrCouncil.selector);
        vault.directTo(0, 1e6, REF);
        vm.stopPrank();
    }

    /* ── Fuzz: accounting stays whole under arbitrary flows ───────────────── */

    function testFuzz_DepositHarvestClaim_BooksAlwaysCover(uint96 dep, uint96 yield_) public {
        uint256 depositAmt = bound(uint256(dep), 1e6, 500_000e6);
        uint256 yieldAmt = bound(uint256(yield_), 0, 100_000e6);

        _setFamilyPayees();
        _depositAndDirect(depositAmt, 0);
        if (yieldAmt > 0) fxrp.mint(address(firelight), yieldAmt);
        vault.harvest(0);

        // The vault's balance always covers idle principal + every claim.
        assertGe(
            fxrp.balanceOf(address(vault)),
            vault.idlePrincipal() + vault.totalClaimable() == 0
                ? 0
                : vault.idlePrincipal() + vault.totalClaimable()
        );
        // People (payees) never hold claims above the distributable yield.
        uint256 distributable = (yieldAmt * (10_000 - LINAJE)) / 10_000;
        assertLe(vault.totalClaimable(), distributable + 3); // rounding dust tolerance
        // Principal never shrinks from yield activity.
        assertGe(vault.totalPrincipal(), depositAmt);
    }
}
