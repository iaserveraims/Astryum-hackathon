// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AstryumVault} from "../src/AstryumVault.sol";
import {AstryumVaultV2} from "../src/AstryumVaultV2.sol";
import {PoteParams} from "../src/PoteParams.sol";
import {AstryumRegistry} from "../src/AstryumRegistry.sol";
import {MockFXRP, MockCompoundVenue, MockUpshiftVault} from "./mocks/Mocks.sol";

/**
 * La rama Upshift del pote (VenueKind.UpshiftQueued), contra un mock fiel al
 * código verificado de los dos vaults de mainnet (earnXRP, Monarq).
 *
 * El mundo: un pote con cooldown de 8 días, un Kinetic (síncrono, venue 0) y un
 * Upshift con espera de 7 días (venue 1, forma Monarq). Cada test nombra la
 * decisión de AstryumVaultV2 que prueba.
 */
contract AstryumVaultV2UpshiftTest is Test {
    MockFXRP fxrp;
    MockCompoundVenue kinetic;
    MockUpshiftVault upshift;
    AstryumRegistry registry;
    AstryumVaultV2 pote;

    address governor = makeAddr("governor");
    address council = makeAddr("council");
    address operator = makeAddr("operator");
    address client = makeAddr("client");
    address stranger = makeAddr("stranger");
    address subaccount = makeAddr("subaccount"); // donde el curador de Upshift pone el dinero

    bytes32 constant REF = keccak256("politica-upshift-v1");
    uint48 constant COOLDOWN = 8 days;
    uint16 constant FLOOR = 1000;
    uint256 constant UP = 1; // venueId del Upshift

    function _params(uint48 cooldown, AstryumVault.InitialVenue[] memory venues)
        internal
        pure
        returns (PoteParams memory)
    {
        return PoteParams({
            name: "Astryum Pote U",
            symbol: "apU-FXRP",
            cooldown: cooldown,
            bufferFloorBps: FLOOR,
            maxPayeeBps: 2000,
            maxDepositPerUser: 0,
            initialGate: address(0),
            initialVenues: venues
        });
    }

    function _venues() internal view returns (AstryumVault.InitialVenue[] memory v) {
        v = new AstryumVault.InitialVenue[](2);
        v[0] = AstryumVault.InitialVenue(address(kinetic), AstryumVault.VenueKind.CompoundV2);
        v[1] = AstryumVault.InitialVenue(address(upshift), AstryumVault.VenueKind.UpshiftQueued);
    }

    function _list(address target, AstryumVault.VenueKind kind) internal {
        vm.prank(governor);
        registry.proposeVenue(uint32(block.chainid), target, uint8(kind));
        registry.activateVenue(uint32(block.chainid), target);
    }

    function setUp() public {
        vm.warp(1_790_000_000); // sep-2026, para que las fechas del venue sean reales
        fxrp = new MockFXRP();
        kinetic = new MockCompoundVenue(fxrp);
        upshift = new MockUpshiftVault(fxrp);
        registry = new AstryumRegistry(governor, 0);
        _list(address(kinetic), AstryumVault.VenueKind.CompoundV2);
        _list(address(upshift), AstryumVault.VenueKind.UpshiftQueued);

        pote = new AstryumVaultV2(fxrp, council, REF, registry, _params(COOLDOWN, _venues()));

        fxrp.mint(client, 1_000_000e6);
        vm.prank(client);
        fxrp.approve(address(pote), type(uint256).max);
        vm.prank(council);
        pote.cede(operator, uint64(block.timestamp + 60 days), REF);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _deposit(uint256 assets) internal returns (uint256 shares) {
        vm.prank(client);
        shares = pote.deposit(assets, client);
    }

    function _toUpshift(uint256 amount) internal {
        vm.prank(operator);
        pote.directTo(UP, amount, REF);
    }

    function _onlyDate() internal view returns (uint256) {
        uint256[] memory d = pote.openExitDates(UP);
        assertEq(d.length, 1, "una sola fecha abierta");
        return d[0];
    }

    function _split(uint256 date) internal pure returns (uint256 y, uint256 m, uint256 d) {
        return (date / 10_000, (date / 100) % 100, date % 100);
    }

    function _lpOfPote() internal view returns (uint256) {
        return upshift.LP().balanceOf(address(pote));
    }

    /* ═══════════════════════════════════════════════════════════════════════
       Decisión 1 — dónde puede entrar
       ═══════════════════════════════════════════════════════════════════════ */

    function test_Upshift_BornInACooldownPoteAtLeastAsLongAsTheVenueLag() public view {
        assertEq(pote.venueCount(), 2);
        (address t, AstryumVault.VenueKind k,,) = pote.venues(UP);
        assertEq(t, address(upshift));
        assertEq(uint8(k), uint8(AstryumVault.VenueKind.UpshiftQueued));
        assertEq(pote.venueShareToken(UP), address(upshift.LP()));
    }

    function test_Upshift_CooldownShorterThanTheVenueLagIsRefused() public {
        vm.expectRevert(abi.encodeWithSelector(AstryumVaultV2.CooldownBelowVenueLag.selector, 7 days));
        new AstryumVaultV2(fxrp, council, REF, registry, _params(3 days, _venues()));
    }

    function test_Upshift_ASyncPoteCannotTakeIt() public {
        vm.expectRevert(abi.encodeWithSelector(AstryumVaultV2.CooldownBelowVenueLag.selector, 7 days));
        new AstryumVaultV2(fxrp, council, REF, registry, _params(0, _venues()));
    }

    /// La generación v1 no sabe operar este tipo y lo rechaza en la puerta.
    function test_Upshift_TheV1GenerationRefusesTheKind() public {
        AstryumVault.InitialVenue[] memory v = new AstryumVault.InitialVenue[](1);
        v[0] = AstryumVault.InitialVenue(address(upshift), AstryumVault.VenueKind.UpshiftQueued);
        vm.expectRevert(AstryumVault.VenueKindMismatch.selector);
        new AstryumVault(fxrp, "v1", "v1", council, REF, COOLDOWN, FLOOR, v);
    }

    /// El registro aprueba (target, kind): el mismo vault listado con otro tipo no entra.
    function test_Upshift_TheRegistryMustListThisKind() public {
        MockUpshiftVault other = new MockUpshiftVault(fxrp);
        _list(address(other), AstryumVault.VenueKind.ERC4626Queued);
        AstryumVault.InitialVenue[] memory v = new AstryumVault.InitialVenue[](1);
        v[0] = AstryumVault.InitialVenue(address(other), AstryumVault.VenueKind.UpshiftQueued);
        vm.expectRevert(abi.encodeWithSelector(AstryumVaultV2.VenueNotInRegistry.selector, address(other)));
        new AstryumVaultV2(fxrp, council, REF, registry, _params(COOLDOWN, v));
    }

    /* ═══════════════════════════════════════════════════════════════════════
       Entrar y valorar
       ═══════════════════════════════════════════════════════════════════════ */

    function test_Upshift_DirectToBooksTheSharesInTheSeparateToken() public {
        _deposit(100_000e6);
        _toUpshift(90_000e6);
        assertGt(_lpOfPote(), 0);
        assertApproxEqAbs(pote.venueValue(UP), 90_000e6, 2);
        assertApproxEqAbs(pote.totalAssets(), 100_000e6, 2);
    }

    /// El dinero que el curador saca a subcuentas sigue en el NAV que él reporta.
    function test_Upshift_FundsInSubaccountsStayInTheValuation() public {
        _deposit(100_000e6);
        _toUpshift(90_000e6);
        upshift.moveToSubaccount(85_000e6, subaccount);
        assertApproxEqAbs(pote.venueValue(UP), 90_000e6, 2);
    }

    function test_Upshift_NavMovesShowInTheSharePrice() public {
        _deposit(100_000e6);
        _toUpshift(90_000e6);
        upshift.moveToSubaccount(90_000e6, subaccount);
        upshift.reportExternalAssets(90_900e6); // +1 %
        assertApproxEqAbs(pote.totalAssets(), 100_900e6, 2);
    }

    function test_Upshift_TheLaggedWithdrawalFeeIsInTheValuation() public {
        _deposit(100_000e6);
        _toUpshift(90_000e6);
        upshift.setWithdrawalFee(50); // 0,5 %
        assertApproxEqAbs(pote.venueValue(UP), 89_550e6, 2);
    }

    /* ═══════════════════════════════════════════════════════════════════════
       Decisión 2 — la cola se lee del venue, jamás de un apunte propio
       ═══════════════════════════════════════════════════════════════════════ */

    function test_Upshift_RecallQueuesAndNothingVanishesFromTheBooks() public {
        _deposit(100_000e6);
        _toUpshift(90_000e6);

        vm.prank(operator);
        pote.recall(UP, 50_000e6, REF);

        uint256 date = _onlyDate();
        (uint256 y, uint256 m, uint256 d) = _split(date);
        assertGt(upshift.getBurnableAmountByReceiver(y, m, d, address(pote)), 0);
        assertApproxEqAbs(pote.venueValue(UP), 90_000e6, 3); // vivo + en cola
        assertApproxEqAbs(pote.totalAssets(), 100_000e6, 3);
    }

    /// THE Upshift test: a third party runs the venue's claim for the pote. The
    /// FXRP lands in the buffer AND the queue reads 0 — counted once, never twice.
    function test_Upshift_AThirdPartyClaimIsNeverCountedTwice() public {
        _deposit(100_000e6);
        _toUpshift(90_000e6);
        vm.prank(operator);
        pote.recall(UP, 50_000e6, REF);
        uint256 date = _onlyDate();
        (uint256 y, uint256 m, uint256 d) = _split(date);

        vm.warp(block.timestamp + 8 days);
        vm.prank(stranger);
        upshift.processAllClaimsByDate(y, m, d);

        assertApproxEqAbs(pote.freeBalance(), 60_000e6, 3); // 10k colchón + 50k que llegaron
        assertApproxEqAbs(pote.totalAssets(), 100_000e6, 3); // NO 150k

        // Cerrar la fecha ya cobrada: no revierte, no mueve nada, deja 0 abiertas.
        vm.prank(stranger);
        pote.claimVenue(UP, date);
        assertEq(pote.openExitDates(UP).length, 0);
        assertApproxEqAbs(pote.totalAssets(), 100_000e6, 3);
    }

    function test_Upshift_ClaimingBeforeTheVenueDayWaits() public {
        _deposit(100_000e6);
        _toUpshift(90_000e6);
        vm.prank(operator);
        pote.recall(UP, 10_000e6, REF);
        uint256 date = _onlyDate();
        vm.expectRevert(bytes("TooEarly"));
        pote.claimVenue(UP, date);
        assertEq(pote.openExitDates(UP).length, 1); // el revert no cierra la fecha
    }

    function test_Upshift_AnUnknownDateReverts() public {
        vm.expectRevert(abi.encodeWithSelector(AstryumVaultV2.ExitDateUnknown.selector, 20_991_231));
        pote.claimVenue(UP, 20_991_231);
    }

    /* ═══════════════════════════════════════════════════════════════════════
       La salida del titular, entera
       ═══════════════════════════════════════════════════════════════════════ */

    /// request → el unwind encola en Upshift → el curador devuelve el dinero de
    /// la subcuenta → un tercero cierra el ticket; el receptor lo fijó el titular.
    function test_Upshift_FullHolderExitCycle() public {
        uint256 shares = _deposit(100_000e6);
        _toUpshift(90_000e6);
        upshift.moveToSubaccount(90_000e6, subaccount); // como en mainnet: casi todo fuera

        vm.prank(client);
        uint256 ticketId = pote.requestRedeem(shares, client);
        uint256 date = _onlyDate();

        vm.warp(block.timestamp + COOLDOWN);
        AstryumVault.VenueClaim[] memory claims = new AstryumVault.VenueClaim[](1);
        claims[0] = AstryumVault.VenueClaim(UP, date);

        // Sin liquidez en el contrato del venue, el cobro espera (no se pierde nada).
        vm.expectRevert();
        pote.claimRedeem(ticketId, claims);

        // El curador trae el dinero de vuelta (su withdrawFromSubaccount).
        vm.startPrank(subaccount);
        fxrp.approve(address(upshift), type(uint256).max);
        upshift.returnFromSubaccount(90_000e6);
        vm.stopPrank();

        vm.prank(stranger);
        pote.claimRedeem(ticketId, claims);

        assertApproxEqAbs(fxrp.balanceOf(client), 1_000_000e6, 3);
        assertEq(pote.earmarkedAssets(), 0);
        assertEq(pote.openExitDates(UP).length, 0);
    }

    /* ═══════════════════════════════════════════════════════════════════════
       Decisión 3 — el margen del 1 % cubre el precio que se mueve en la espera
       ═══════════════════════════════════════════════════════════════════════ */

    function test_Upshift_ANavDropInsideTheMarginStillPaysTheTicketInFull() public {
        uint256 shares = _deposit(100_000e6);
        _toUpshift(90_000e6); // colchón 10k
        // Otro titular deja capital en el pote, así el colchón no lo cubre todo.
        address other = makeAddr("other");
        fxrp.mint(other, 100_000e6);
        vm.startPrank(other);
        fxrp.approve(address(pote), type(uint256).max);
        pote.deposit(100_000e6, other);
        vm.stopPrank();
        _toUpshift(90_000e6); // Upshift 180k, colchón 20k

        vm.prank(client);
        uint256 ticketId = pote.requestRedeem(shares, client); // debe 100k, colchón 20k ⇒ encola ~80,8k
        uint256 date = _onlyDate();

        // Siete días a 10 pb/día (el tope de Monarq): −0,7 % sobre lo que queda en el venue.
        upshift.moveToSubaccount(fxrp.balanceOf(address(upshift)), subaccount);
        upshift.reportExternalAssets((upshift.externalAssets() * 9930) / 10_000);
        vm.startPrank(subaccount);
        fxrp.approve(address(upshift), type(uint256).max);
        upshift.returnFromSubaccount(90_000e6);
        vm.stopPrank();

        vm.warp(block.timestamp + COOLDOWN);
        AstryumVault.VenueClaim[] memory claims = new AstryumVault.VenueClaim[](1);
        claims[0] = AstryumVault.VenueClaim(UP, date);
        pote.claimRedeem(ticketId, claims);

        (, uint256 owed,,) = pote.redeemTickets(ticketId);
        assertEq(fxrp.balanceOf(client), 900_000e6 + owed);
    }

    /* ═══════════════════════════════════════════════════════════════════════
       Decisión 4 — un venue sin espera no bloquea la salida
       ═══════════════════════════════════════════════════════════════════════ */

    function test_Upshift_ZeroLagFallsBackToTheInstantDoor() public {
        _deposit(100_000e6);
        _toUpshift(90_000e6);
        upshift.setLagDuration(0); // requestRedeem revertiría: VaultNotTimelocked

        uint256 freeBefore = pote.freeBalance();
        vm.expectEmit(true, false, false, false, address(pote));
        emit AstryumVault.VenueLossRealised(UP, 0, 0); // la fee instantánea, a la vista
        vm.prank(operator);
        pote.recall(UP, 20_000e6, REF);

        assertEq(pote.openExitDates(UP).length, 0); // nada en cola
        assertApproxEqAbs(pote.freeBalance() - freeBefore, 20_000e6 - 60e6, 10); // 30 pb de fee
    }

    /* ═══════════════════════════════════════════════════════════════════════
       Decisión 5 y el resto del gobierno
       ═══════════════════════════════════════════════════════════════════════ */

    function test_Upshift_HarvestIsANoOp() public {
        address[] memory accounts = new address[](1);
        uint16[] memory bps = new uint16[](1);
        accounts[0] = operator;
        bps[0] = 2000;
        vm.prank(council);
        pote.setPayees(accounts, bps, REF);

        _deposit(100_000e6);
        _toUpshift(90_000e6);
        upshift.moveToSubaccount(90_000e6, subaccount);
        upshift.reportExternalAssets(140_000e6); // rendimiento desproporcionado

        vm.prank(stranger);
        pote.harvest(UP);
        assertEq(pote.claimable(operator), 0);
    }

    function test_Upshift_EvacuateQueuesTheWholePositionAndBooksNoLoss() public {
        _deposit(100_000e6);
        _toUpshift(90_000e6);
        vm.prank(council);
        pote.evacuate(UP, REF);
        assertEq(_lpOfPote(), 0);
        assertEq(pote.openExitDates(UP).length, 1);
        assertApproxEqAbs(pote.totalAssets(), 100_000e6, 3);
    }

    function test_Upshift_MovingOutOfItInOneCallIsRefused() public {
        _deposit(100_000e6);
        _toUpshift(50_000e6);
        vm.prank(operator);
        vm.expectRevert(AstryumVault.VenueKindMismatch.selector);
        pote.moveToVenue(UP, 0, 10_000e6, REF);
    }

    /// Upshift rechaza cada llamada cuyo bruto pase de maxWithdrawalAmount: el
    /// pote trocea, y todos los trozos caen en la misma fecha.
    function test_Upshift_ABigExitIsChunkedUnderTheVenueLimit() public {
        _deposit(100_000e6);
        _toUpshift(90_000e6);
        upshift.setMaxWithdrawalAmount(10_000e6);

        uint256 lpBefore = _lpOfPote();
        vm.prank(council);
        pote.evacuate(UP, REF);

        uint256 date = _onlyDate();
        (uint256 y, uint256 m, uint256 d) = _split(date);
        assertEq(upshift.getBurnableAmountByReceiver(y, m, d, address(pote)), lpBefore);
    }

    /// El bucle de totalAssets está acotado; al tope se podan las fechas que un
    /// tercero ya cobró, y solo si no hay ninguna la nueva salida espera.
    function test_Upshift_OpenExitDatesAreBounded() public {
        _deposit(100_000e6);
        _toUpshift(90_000e6);
        uint256 max = pote.MAX_OPEN_EXIT_DATES();
        // Reloj en variable local: con via_ir, block.timestamp dentro del bucle
        // del test se lee una vez y el warp repetiría el mismo día.
        uint256 t = block.timestamp;
        for (uint256 i = 0; i < max; i++) {
            vm.prank(operator);
            pote.recall(UP, 100e6, REF);
            t += 1 days;
            vm.warp(t);
        }
        assertEq(pote.openExitDates(UP).length, max);

        vm.prank(operator);
        vm.expectRevert(AstryumVaultV2.TooManyOpenExits.selector);
        pote.recall(UP, 100e6, REF);

        // Un tercero cobra la más antigua ⇒ la siguiente salida cabe.
        (uint256 y, uint256 m, uint256 d) = _split(pote.openExitDates(UP)[0]);
        upshift.processAllClaimsByDate(y, m, d);
        vm.prank(operator);
        pote.recall(UP, 100e6, REF);
        assertEq(pote.openExitDates(UP).length, max);
    }
}
