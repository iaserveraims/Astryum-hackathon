// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AstryumVault} from "../src/AstryumVault.sol";
import {MockFXRP, Mock4626Venue, MockCompoundVenue, MockQueuedVenue} from "./mocks/Mocks.sol";
import {ExchangeKycRegistry} from "../src/ExchangeKycRegistry.sol";

/// Unit suite of the institutional pote. Two potes, one per exit shape:
/// pote A (COOLDOWN = 0, sync venues) and pote B (COOLDOWN = 72h, Firelight-
/// shaped queued venue).
contract AstryumVaultTest is Test {
    MockFXRP fxrp;

    // Pote A world (sync)
    MockCompoundVenue kineticA;
    Mock4626Venue syncA;
    AstryumVault poteA;

    // Pote B world (queued)
    MockQueuedVenue firelightB;
    MockCompoundVenue kineticB;
    AstryumVault poteB;

    address council = makeAddr("council");
    address operator = makeAddr("operator"); // the director (exchange desk)
    address client = makeAddr("client"); // the holder
    address stranger = makeAddr("stranger");

    bytes32 constant REF = keccak256("politica-conservadora-v1");
    uint48 constant COOLDOWN_B = 72 hours; // firelight.runtime.json: 259200
    uint16 constant FLOOR = 1000; // 10% idle buffer

    function setUp() public {
        fxrp = new MockFXRP();

        kineticA = new MockCompoundVenue(fxrp);
        syncA = new Mock4626Venue(fxrp);
        AstryumVault.InitialVenue[] memory initA = new AstryumVault.InitialVenue[](2);
        initA[0] = AstryumVault.InitialVenue(address(kineticA), AstryumVault.VenueKind.CompoundV2);
        initA[1] = AstryumVault.InitialVenue(address(syncA), AstryumVault.VenueKind.ERC4626);
        poteA = new AstryumVault(fxrp, "Astryum Pote A", "apA-FXRP", council, REF, 0, FLOOR, initA);

        firelightB = new MockQueuedVenue(fxrp);
        kineticB = new MockCompoundVenue(fxrp);
        AstryumVault.InitialVenue[] memory initB = new AstryumVault.InitialVenue[](2);
        initB[0] = AstryumVault.InitialVenue(address(kineticB), AstryumVault.VenueKind.CompoundV2);
        initB[1] = AstryumVault.InitialVenue(address(firelightB), AstryumVault.VenueKind.ERC4626Queued);
        poteB = new AstryumVault(fxrp, "Astryum Pote B", "apB-FXRP", council, REF, COOLDOWN_B, FLOOR, initB);

        fxrp.mint(client, 1_000_000e6);
        vm.startPrank(client);
        fxrp.approve(address(poteA), type(uint256).max);
        fxrp.approve(address(poteB), type(uint256).max);
        vm.stopPrank();

        vm.prank(council);
        poteA.cede(operator, uint64(block.timestamp + 30 days), REF);
        vm.prank(council);
        poteB.cede(operator, uint64(block.timestamp + 30 days), REF);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _depositA(uint256 assets) internal returns (uint256 shares) {
        vm.prank(client);
        shares = poteA.deposit(assets, client);
    }

    function _depositB(uint256 assets) internal returns (uint256 shares) {
        vm.prank(client);
        shares = poteB.deposit(assets, client);
    }

    function _setOperatorCut(AstryumVault pote, uint16 bps) internal {
        address[] memory accounts = new address[](1);
        uint16[] memory cut = new uint16[](1);
        accounts[0] = operator;
        cut[0] = bps;
        vm.prank(council);
        pote.setPayees(accounts, cut, REF);
    }

    /* ═══════════════════════════════════════════════════════════════════════
       POTE A — the synchronous shape
       ═══════════════════════════════════════════════════════════════════════ */

    function test_Deposit_MintsSharesAndBooksAssets() public {
        uint256 shares = _depositA(100_000e6);
        assertGt(shares, 0);
        assertEq(poteA.totalAssets(), 100_000e6);
        assertEq(poteA.balanceOf(client), shares);
        // 6 asset decimals + offset 3 (Z10 inflation defense)
        assertEq(poteA.decimals(), 9);
    }

    /// I2 made mechanical: the holder's redeem unwinds the venues BY ITSELF —
    /// no recall, no director, no council anywhere in the tx.
    function test_I2_SyncRedeemUnwindsVenuesWithoutTheDirector() public {
        uint256 shares = _depositA(100_000e6);
        vm.prank(operator);
        poteA.directTo(0, 60_000e6, REF);
        vm.prank(operator);
        poteA.directTo(1, 30_000e6, REF); // buffer left = 10k = exactly the floor

        vm.prank(client);
        uint256 got = poteA.redeem(shares, client, client);

        assertApproxEqAbs(got, 100_000e6, 2);
        assertApproxEqAbs(fxrp.balanceOf(client), 1_000_000e6, 2);
        assertLe(poteA.venueValue(0), 2);
        assertLe(poteA.venueValue(1), 2);
    }

    function test_I4_BufferFloor_TheDirectorCannotCross() public {
        _depositA(100_000e6);
        vm.prank(operator);
        vm.expectRevert(AstryumVault.BufferFloorCrossed.selector);
        poteA.directTo(0, 91_000e6, REF); // would leave 9k < 10% floor
    }

    function test_I4_QueuedVenueCannotEnterASyncPote() public {
        vm.prank(council);
        vm.expectRevert(AstryumVault.QueuedVenueNeedsCooldown.selector);
        poteA.proposeVenue(address(firelightB), AstryumVault.VenueKind.ERC4626Queued, REF);
    }

    function test_EntryCap_CheckedOnRealValues() public {
        _depositA(100_000e6);
        vm.prank(council);
        poteA.setMaxVenueBps(3000, REF);
        vm.prank(operator);
        vm.expectRevert(AstryumVault.EntryCapExceeded.selector);
        poteA.directTo(0, 40_000e6, REF); // 40% > 30% cap
    }

    function test_SyncPote_RequestRedeemIsTheWrongDoor() public {
        _depositA(10_000e6);
        vm.prank(client);
        vm.expectRevert(AstryumVault.UseSyncRedeem.selector);
        poteA.requestRedeem(1, client);
    }

    /// Z2: no principal ledger — a venue loss surfaces as share price, alone.
    function test_Z2_LossSurfacesInSharePriceNotInALedger() public {
        uint256 shares = _depositA(100_000e6);
        vm.prank(operator);
        poteA.directTo(1, 50_000e6, REF);
        syncA.simulateLoss(10_000e6, stranger); // the venue loses 10k

        assertApproxEqAbs(poteA.totalAssets(), 90_000e6, 2);
        assertApproxEqAbs(poteA.previewRedeem(shares), 90_000e6, 2);
    }

    /* ═══════════════════════════════════════════════════════════════════════
       POTE B — the cooldown shape, and THE Firelight accounting case
       ═══════════════════════════════════════════════════════════════════════ */

    function test_CooldownPote_SyncDoorsAreClosed() public {
        uint256 shares = _depositB(10_000e6);
        assertEq(poteB.maxRedeem(client), 0);
        assertEq(poteB.maxWithdraw(client), 0);
        vm.prank(client);
        vm.expectRevert(AstryumVault.UseRequestRedeem.selector);
        poteB.redeem(shares, client, client);
        vm.prank(client);
        vm.expectRevert(AstryumVault.UseRequestRedeem.selector);
        poteB.withdraw(1e6, client, client);
    }

    /// THE test the audit demanded (§5): a queued exit books NO loss and the
    /// position never disappears from the books while the FXRP waits in queue.
    function test_FirelightCase_QueuedExitBooksNoLossAndNothingVanishes() public {
        uint256 shares = _depositB(100_000e6);
        vm.prank(operator);
        poteB.directTo(1, 90_000e6, REF); // into the queued venue

        uint256 taBefore = poteB.totalAssets();
        assertApproxEqAbs(taBefore, 100_000e6, 2);

        vm.prank(client);
        uint256 ticketId = poteB.requestRedeem(shares, client);

        // Shares burned NOW; assets earmarked; venue live value gone but the
        // queued assets are ON the books (venueQueuedTotal), not "lost".
        assertEq(poteB.balanceOf(client), 0);
        (, uint256 owed,,) = poteB.redeemTickets(ticketId);
        assertApproxEqAbs(owed, 100_000e6, 2);
        assertApproxEqAbs(poteB.venueQueuedTotal(1), 90_000e6, 2);
        assertLe(poteB.totalAssets(), 2); // earmarked excluded — leavers isolated
    }

    function test_CooldownPote_ClaimBeforeMaturityReverts() public {
        uint256 shares = _depositB(10_000e6);
        vm.prank(client);
        uint256 ticketId = poteB.requestRedeem(shares, client);
        AstryumVault.VenueClaim[] memory none = new AstryumVault.VenueClaim[](0);
        vm.expectRevert(abi.encodeWithSelector(AstryumVault.TicketNotMature.selector, uint48(block.timestamp + COOLDOWN_B)));
        poteB.claimRedeem(ticketId, none);
    }

    /// The whole circuit of scene 5: request → the venue queue matures inside
    /// the cooldown → claim pays the receiver the holder fixed. Anyone may
    /// carry the final tx; nobody may redirect it.
    function test_CooldownPote_FullExitCycle() public {
        uint256 shares = _depositB(100_000e6);
        vm.prank(operator);
        poteB.directTo(1, 90_000e6, REF);

        uint256 period = firelightB.currentPeriod() + 1; // where the exit queues
        vm.prank(client);
        uint256 ticketId = poteB.requestRedeem(shares, client);

        // Two period boundaries pass (48h worst case), well inside the 72h.
        firelightB.advancePeriod();
        firelightB.advancePeriod();
        vm.warp(block.timestamp + COOLDOWN_B);

        AstryumVault.VenueClaim[] memory claims = new AstryumVault.VenueClaim[](1);
        claims[0] = AstryumVault.VenueClaim(1, period);
        vm.prank(stranger); // permissionless finisher — the receiver is fixed
        poteB.claimRedeem(ticketId, claims);

        assertApproxEqAbs(fxrp.balanceOf(client), 1_000_000e6, 2);
        assertEq(poteB.earmarkedAssets(), 0);
        assertEq(poteB.venueQueuedTotal(1), 0);
    }

    /// The fuzzer's lesson made a rule (invariant P2): harvesting a
    /// QUEUED venue is a no-op — its yield realizes only when the capital is
    /// liquid again. Paying the cut from the buffer would charge the common
    /// principal AND let the next harvest re-charge the rebated basis as
    /// phantom yield, pushing the operator past the 20% cap.
    function test_Harvest_QueuedVenueIsNoOpEvenWithHugeYield() public {
        _setOperatorCut(poteB, 2000); // max cut
        _depositB(100_000e6);
        vm.prank(operator);
        poteB.directTo(1, 90_000e6, REF); // into the queued venue

        // A disproportionate yield lands in the queued venue.
        fxrp.mint(address(firelightB), 50_000e6);

        vm.prank(stranger);
        poteB.harvest(1);
        // The operator gets NOTHING from a queued venue, no matter the yield.
        assertEq(poteB.claimable(operator), 0);

        // A second harvest still yields nothing — no phantom-yield ratchet.
        vm.prank(stranger);
        poteB.harvest(1);
        assertEq(poteB.claimable(operator), 0);
    }

    function test_Evacuate_QueuedVenueBooksNoLoss() public {
        _depositB(100_000e6);
        vm.prank(operator);
        poteB.directTo(1, 80_000e6, REF);

        uint256 taBefore = poteB.totalAssets();
        vm.prank(council);
        poteB.evacuate(1, REF);

        // Everything moved to the queue; the books did not move.
        assertApproxEqAbs(poteB.totalAssets(), taBefore, 2);
        assertApproxEqAbs(poteB.venueQueuedTotal(1), 80_000e6, 2);
    }

    /* ═══════════════════════════════════════════════════════════════════════
       The fruit — harvest skims ONLY the public cut (Z2)
       ═══════════════════════════════════════════════════════════════════════ */

    function test_Harvest_SkimsOnlyThePublicCut() public {
        _setOperatorCut(poteA, 1000); // 10% of yield, public
        _depositA(100_000e6);
        vm.prank(operator);
        poteA.directTo(1, 50_000e6, REF);

        fxrp.mint(address(syncA), 10_000e6); // the venue yields 10k

        vm.prank(stranger); // permissionless
        poteA.harvest(1);

        assertApproxEqAbs(poteA.claimable(operator), 1_000e6, 2); // 10% of 10k
        // The other 9k stays compounding for the holders.
        assertApproxEqAbs(poteA.totalAssets(), 109_000e6, 4);

        // High-water mark: harvesting again with no new yield pays nothing.
        vm.prank(stranger);
        poteA.harvest(1);
        assertApproxEqAbs(poteA.claimable(operator), 1_000e6, 2);

        vm.prank(operator);
        poteA.claim();
        assertApproxEqAbs(fxrp.balanceOf(operator), 1_000e6, 2);
    }

    function test_Harvest_UnderWaterPaysNothing() public {
        _setOperatorCut(poteA, 1000);
        _depositA(100_000e6);
        vm.prank(operator);
        poteA.directTo(1, 50_000e6, REF);
        syncA.simulateLoss(5_000e6, stranger);

        vm.prank(stranger);
        poteA.harvest(1);
        assertEq(poteA.claimable(operator), 0);
    }

    function test_Payees_HardCapForever() public {
        address[] memory accounts = new address[](1);
        uint16[] memory bps = new uint16[](1);
        accounts[0] = operator;
        bps[0] = 2001; // over the 20% cap
        vm.prank(council);
        vm.expectRevert(AstryumVault.PayeeBpsOverCap.selector);
        poteA.setPayees(accounts, bps, REF);
    }

    /* ═══════════════════════════════════════════════════════════════════════
       Authority — I5 and the constitution chain
       ═══════════════════════════════════════════════════════════════════════ */

    function test_I5_TheCessionExpiresByItself() public {
        _depositA(100_000e6);
        vm.prank(operator);
        poteA.directTo(0, 10_000e6, REF); // works while the cession lives

        vm.warp(block.timestamp + 31 days); // past directorUntil

        vm.prank(operator);
        vm.expectRevert(AstryumVault.NotDirectorOrCouncil.selector);
        poteA.directTo(0, 1_000e6, REF);
    }

    function test_I3_OnlyTheCouncilGovernsAndAlwaysWithTheRef() public {
        vm.prank(stranger);
        vm.expectRevert(AstryumVault.NotCouncil.selector);
        poteA.setMaxVenueBps(5000, REF);

        vm.prank(council);
        vm.expectRevert(AstryumVault.RefMismatch.selector);
        poteA.setMaxVenueBps(5000, keccak256("stale-ref"));
    }

    /// The escape-window bound (menú del quórum malicioso §3): the ONE
    /// extraction-shaped council power is proposeVenue, and it waits
    /// VENUE_DELAY in public. As long as no pote's cooldown can exceed that
    /// delay, a holder who reacts to the VenueProposed event ALWAYS gets his
    /// capital to the door before a hostile venue activates.
    function test_EscapeWindow_CooldownNeverExceedsVenueDelay() public view {
        assertLe(poteB.MAX_COOLDOWN(), poteB.VENUE_DELAY());
        assertLe(poteB.COOLDOWN(), poteB.VENUE_DELAY());
    }

    /* ═══════════════════════════════════════════════════════════════════════
       La puerta de usuarios on-chain (Z-decision): solo los clientes
       KYC de ESE exchange pueden entrar; la salida jamás se gatea.
       ═══════════════════════════════════════════════════════════════════════ */

    function test_UserGate_OnlyApprovedReceiversMayEnter() public {
        ExchangeKycRegistry reg = new ExchangeKycRegistry(operator); // el exchange administra
        vm.prank(council);
        poteA.setUserGate(address(reg), REF);

        // El cliente no está aprobado → depositar (recibir shares) REVIERTE.
        vm.prank(client);
        vm.expectRevert(AstryumVault.ReceiverNotApproved.selector);
        poteA.deposit(10_000e6, client);

        // El exchange lo da de alta (KYC) → ahora sí entra.
        vm.prank(operator);
        reg.setApproved(client, true);
        vm.prank(client);
        poteA.deposit(10_000e6, client);
        assertGt(poteA.balanceOf(client), 0);
    }

    function test_UserGate_ExitIsNeverGated() public {
        // Deposita ANTES de poner la puerta.
        _depositA(50_000e6);
        ExchangeKycRegistry reg = new ExchangeKycRegistry(operator);
        vm.prank(council);
        poteA.setUserGate(address(reg), REF);
        // El cliente NO está aprobado, pero la salida no pasa por la puerta.
        uint256 bal = poteA.balanceOf(client); // fuera del prank: es una llamada externa
        vm.prank(client);
        uint256 got = poteA.redeem(bal, client, client);
        assertApproxEqAbs(got, 50_000e6, 2);
    }

    function test_UserGate_ModeB_OperatorCannotSeedANonClient() public {
        ExchangeKycRegistry reg = new ExchangeKycRegistry(operator);
        vm.prank(council);
        poteA.setUserGate(address(reg), REF);
        // Modo B: el operador paga, receiver = un tercero NO aprobado → revierte.
        fxrp.mint(operator, 10_000e6);
        vm.prank(operator);
        fxrp.approve(address(poteA), type(uint256).max);
        vm.prank(operator);
        vm.expectRevert(AstryumVault.ReceiverNotApproved.selector);
        poteA.deposit(10_000e6, stranger);
    }

    function test_UserGate_OnlyCouncilSetsIt() public {
        ExchangeKycRegistry reg = new ExchangeKycRegistry(operator);
        vm.prank(stranger);
        vm.expectRevert(AstryumVault.NotCouncil.selector);
        poteA.setUserGate(address(reg), REF);
    }

    /// El registro ata ON-CHAIN la cuenta passkey del user a su destination tag
    /// XRPL — así el unmint (redeemWithTag) saca el tag de aquí, no de lo tecleado.
    function test_Registry_BindsPasskeyToTag() public {
        ExchangeKycRegistry reg = new ExchangeKycRegistry(operator);
        vm.prank(operator);
        reg.setApprovedWithTag(client, 12345, true);
        assertTrue(reg.isApproved(client));
        assertEq(reg.tagOf(client), 12345);

        // Un tag que no cabe en 32 bits revierte (es un uint32 XRPL).
        vm.prank(operator);
        vm.expectRevert(ExchangeKycRegistry.TagTooLarge.selector);
        reg.setApprovedWithTag(client, uint256(type(uint32).max) + 1, true);

        // Solo el admin del exchange puede tocar el tag.
        vm.prank(stranger);
        vm.expectRevert(ExchangeKycRegistry.NotAdmin.selector);
        reg.setTag(client, 999);
    }

    /// I1 in its bluntest form: after the director works the capital, the only
    /// address that ever received principal is the holder who redeemed.
    function test_I1_NoPathPaysPrincipalToAnyoneButTheHolder() public {
        uint256 shares = _depositA(100_000e6);
        vm.startPrank(operator);
        poteA.directTo(0, 40_000e6, REF);
        poteA.directTo(1, 40_000e6, REF);
        poteA.recall(0, 20_000e6, REF);
        poteA.moveToVenue(1, 0, 10_000e6, REF);
        vm.stopPrank();

        assertEq(fxrp.balanceOf(operator), 0);
        assertEq(fxrp.balanceOf(council), 0);

        vm.prank(client);
        poteA.redeem(shares, client, client);
        assertApproxEqAbs(fxrp.balanceOf(client), 1_000_000e6, 4);
    }
}
