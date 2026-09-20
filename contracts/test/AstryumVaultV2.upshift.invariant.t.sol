// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AstryumVault} from "../src/AstryumVault.sol";
import {AstryumVaultV2} from "../src/AstryumVaultV2.sol";
import {PoteParams} from "../src/PoteParams.sol";
import {AstryumRegistry} from "../src/AstryumRegistry.sol";
import {MockFXRP, Mock4626Venue, MockUpshiftVault} from "./mocks/Mocks.sol";

/**
 * Invariant fuzzing de la rama Upshift. El fuzzer intercala todo lo que puede
 * pasar en la vida de un pote con un vault Upshift dentro — depósitos, salidas,
 * dirección, recalls, harvests, el curador sacando y devolviendo dinero de sus
 * subcuentas, el NAV subiendo y bajando, días que pasan, cobros del pote Y
 * cobros de TERCEROS por el pote — y tras cada secuencia exige:
 *
 *  U1  nada se olvida ni se cuenta dos veces: el valor del pote es exactamente
 *      su colchón + lo vivo en cada venue + lo que Upshift le debe en cola,
 *      calculado este último por el HARNESS desde todas las fechas que tocó
 *      (independiente de la lista del pote). Si el pote perdiera una fecha con
 *      participaciones dentro, o contara un cobro de tercero en la cola y en el
 *      colchón a la vez, esto se rompe.
 *  U2  toda participación en cola vive en una fecha que el pote tiene abierta.
 *  U3  el operador jamás cobra más que el corte máximo del rendimiento que
 *      entró (I1): harvest es no-op en Upshift, así que su rendimiento no le da
 *      nada, y el del venue síncrono está acotado como siempre.
 */
contract PoteUpshiftHandler is Test {
    AstryumVaultV2 public pote;
    MockFXRP public fxrp;
    Mock4626Venue public sync; // venueId 0
    MockUpshiftVault public upshift; // venueId 1

    address public operator;
    address[3] public holders;
    address public sink = address(0xdead);
    bytes32 constant REF = keccak256("politica-upshift-inv");

    uint256 public ghostYieldInjected;
    uint256 public ghostOperatorReceived;
    uint256[] public touchedDates;
    mapping(uint256 => bool) seenDate;
    uint256 public nextTicket;

    constructor(AstryumVaultV2 pote_, MockFXRP fxrp_, Mock4626Venue sync_, MockUpshiftVault up_, address council) {
        pote = pote_;
        fxrp = fxrp_;
        sync = sync_;
        upshift = up_;
        operator = makeAddr("operator");
        holders = [makeAddr("h1"), makeAddr("h2"), makeAddr("h3")];

        address[] memory accounts = new address[](1);
        uint16[] memory bps = new uint16[](1);
        accounts[0] = operator;
        bps[0] = 2000; // el corte en el tope: la cota más dura para U3
        vm.prank(council);
        pote.setPayees(accounts, bps, REF);
        vm.prank(council);
        pote.cede(operator, type(uint64).max, REF);

        for (uint256 i = 0; i < 3; i++) {
            fxrp.mint(holders[i], 10_000_000e6);
            vm.prank(holders[i]);
            fxrp.approve(address(pote), type(uint256).max);
        }
        fxrp.approve(address(upshift), type(uint256).max); // el harness hace de subcuenta
    }

    /// La fecha en la que Upshift apuntaría una salida pedida AHORA.
    function _touchToday() internal {
        (uint256 y, uint256 m, uint256 d) = upshift.timestampToDate(block.timestamp + 5 minutes + upshift.lagDuration());
        uint256 date = y * 10_000 + m * 100 + d;
        if (!seenDate[date]) {
            seenDate[date] = true;
            touchedDates.push(date);
        }
    }

    function touchedDateCount() external view returns (uint256) {
        return touchedDates.length;
    }

    // ── titulares ────────────────────────────────────────────────────────────

    function deposit(uint8 who, uint96 amount) external {
        address h = holders[who % 3];
        vm.prank(h);
        pote.deposit(bound(uint256(amount), 1e6, 200_000e6), h);
    }

    function requestRedeem(uint8 who, uint96 sharesSeed) external {
        address h = holders[who % 3];
        uint256 bal = pote.balanceOf(h);
        if (bal == 0) return;
        _touchToday();
        vm.prank(h);
        pote.requestRedeem(bound(uint256(sharesSeed), 1, bal), h);
    }

    function finishNextTicket() external {
        if (nextTicket >= pote.redeemTicketCount()) return;
        (,,, bool claimed) = pote.redeemTickets(nextTicket);
        if (claimed) {
            nextTicket++;
            return;
        }
        uint256[] memory open = pote.openExitDates(1);
        AstryumVault.VenueClaim[] memory claims = new AstryumVault.VenueClaim[](open.length > 0 ? 1 : 0);
        if (open.length > 0) claims[0] = AstryumVault.VenueClaim(1, open[0]);
        try pote.claimRedeem(nextTicket, claims) {
            nextTicket++;
        } catch {}
    }

    // ── el operador del pote ─────────────────────────────────────────────────

    function direct(uint96 amount, bool toUpshift) external {
        uint256 free = pote.freeBalance();
        if (free < 2e6) return;
        vm.prank(operator);
        try pote.directTo(toUpshift ? 1 : 0, bound(uint256(amount), 1e6, free), REF) {} catch {}
    }

    function recall(uint96 amount, bool fromUpshift) external {
        uint256 live = pote.venueValue(fromUpshift ? 1 : 0);
        if (live == 0) return;
        if (fromUpshift) _touchToday();
        vm.prank(operator);
        try pote.recall(fromUpshift ? 1 : 0, bound(uint256(amount), 1, live), REF) {} catch {}
    }

    function harvest(bool upshiftVenue) external {
        try pote.harvest(upshiftVenue ? 1 : 0) {} catch {}
    }

    function claimAsOperator() external {
        uint256 c = pote.claimable(operator);
        if (c == 0) return;
        vm.prank(operator);
        pote.claim();
        ghostOperatorReceived += c;
    }

    // ── el curador de Upshift y el mundo ─────────────────────────────────────

    function curatorMovesOut(uint96 amount) external {
        uint256 onContract = fxrp.balanceOf(address(upshift));
        if (onContract == 0) return;
        upshift.moveToSubaccount(bound(uint256(amount), 1, onContract), address(this));
    }

    function curatorReturnsAll() external {
        uint256 ext = upshift.externalAssets();
        if (ext == 0) return;
        uint256 have = fxrp.balanceOf(address(this));
        if (have < ext) fxrp.mint(address(this), ext - have); // el rendimiento reportado, hecho efectivo
        upshift.returnFromSubaccount(ext);
    }

    function addYield(uint96 amount, bool toUpshift) external {
        uint256 amt = bound(uint256(amount), 1, 5_000e6);
        if (toUpshift) {
            if (upshift.LP().totalSupply() == 0 || upshift.externalAssets() == 0) return;
            upshift.reportExternalAssets(upshift.externalAssets() + amt);
        } else {
            if (sync.totalShares() == 0) return;
            fxrp.mint(address(sync), amt);
        }
        ghostYieldInjected += amt;
    }

    /// El NAV de Upshift baja como mucho 10 pb por llamada (maxChangePercent de Monarq).
    function upshiftNavDown(uint16 bps) external {
        uint256 ext = upshift.externalAssets();
        if (ext == 0) return;
        upshift.reportExternalAssets(ext - (ext * bound(uint256(bps), 0, 10)) / 10_000);
    }

    function loseMoneySync(uint96 amount) external {
        uint256 held = fxrp.balanceOf(address(sync));
        if (held == 0) return;
        sync.simulateLoss(bound(uint256(amount), 1, held), sink);
    }

    function advanceDay() external {
        vm.warp(block.timestamp + 1 days);
    }

    /// Un tercero cualquiera ejecuta los cobros de un día, para el pote incluido.
    function thirdPartySettlesADay(uint8 idx) external {
        if (touchedDates.length == 0) return;
        uint256 date = touchedDates[idx % touchedDates.length];
        try upshift.processAllClaimsByDate(date / 10_000, (date / 100) % 100, date % 100) {} catch {}
    }

    function poteClaimsADate(uint8 idx) external {
        uint256[] memory open = pote.openExitDates(1);
        if (open.length == 0) return;
        try pote.claimVenue(1, open[idx % open.length]) {} catch {}
    }

    // ── vistas para las invariantes ──────────────────────────────────────────

    /// Lo que Upshift debe al pote en cola, desde TODAS las fechas tocadas.
    function upshiftQueueOwedIndependently() public view returns (uint256 total) {
        for (uint256 i = 0; i < touchedDates.length; i++) {
            uint256 date = touchedDates[i];
            uint256 s = upshift.getBurnableAmountByReceiver(date / 10_000, (date / 100) % 100, date % 100, address(pote));
            if (s > 0) {
                (, uint256 net) = upshift.previewRedemption(s, false);
                total += net;
            }
        }
    }

    function queuedSharesOutsideOpenDates() external view returns (uint256 orphan) {
        uint256[] memory open = pote.openExitDates(1);
        for (uint256 i = 0; i < touchedDates.length; i++) {
            uint256 date = touchedDates[i];
            bool isOpen = false;
            for (uint256 j = 0; j < open.length; j++) {
                if (open[j] == date) isOpen = true;
            }
            if (!isOpen) {
                orphan += upshift.getBurnableAmountByReceiver(date / 10_000, (date / 100) % 100, date % 100, address(pote));
            }
        }
    }
}

contract AstryumVaultV2UpshiftInvariantTest is Test {
    AstryumVaultV2 pote;
    MockFXRP fxrp;
    Mock4626Venue sync;
    MockUpshiftVault upshift;
    PoteUpshiftHandler handler;

    address council = makeAddr("council");
    bytes32 constant REF = keccak256("politica-upshift-inv");

    function setUp() public {
        vm.warp(1_790_000_000);
        fxrp = new MockFXRP();
        sync = new Mock4626Venue(fxrp);
        upshift = new MockUpshiftVault(fxrp);

        address governor = makeAddr("governor");
        AstryumRegistry registry = new AstryumRegistry(governor, 0);
        vm.startPrank(governor);
        registry.proposeVenue(uint32(block.chainid), address(sync), uint8(AstryumVault.VenueKind.ERC4626));
        registry.proposeVenue(uint32(block.chainid), address(upshift), uint8(AstryumVault.VenueKind.UpshiftQueued));
        vm.stopPrank();
        registry.activateVenue(uint32(block.chainid), address(sync));
        registry.activateVenue(uint32(block.chainid), address(upshift));

        AstryumVault.InitialVenue[] memory v = new AstryumVault.InitialVenue[](2);
        v[0] = AstryumVault.InitialVenue(address(sync), AstryumVault.VenueKind.ERC4626);
        v[1] = AstryumVault.InitialVenue(address(upshift), AstryumVault.VenueKind.UpshiftQueued);
        pote = new AstryumVaultV2(
            fxrp,
            council,
            REF,
            registry,
            PoteParams({
                name: "Astryum Pote U",
                symbol: "apU-FXRP",
                cooldown: 8 days,
                bufferFloorBps: 1000,
                maxPayeeBps: 2000,
                maxDepositPerUser: 0,
                initialGate: address(0),
                initialVenues: v
            })
        );

        handler = new PoteUpshiftHandler(pote, fxrp, sync, upshift, council);
        targetContract(address(handler));
    }

    /// U1 — nada se olvida ni se cuenta dos veces.
    function invariant_U1_ValueIsCountedExactlyOnce() public view {
        uint256 gross = fxrp.balanceOf(address(pote)) + sync.convertToAssets(sync.balanceOf(address(pote)));
        uint256 lp = upshift.LP().balanceOf(address(pote));
        if (lp > 0) {
            (, uint256 net) = upshift.previewRedemption(lp, false);
            gross += net;
        }
        gross += handler.upshiftQueueOwedIndependently();
        uint256 owed = pote.totalClaimable() + pote.earmarkedAssets();
        assertEq(pote.totalAssets(), gross > owed ? gross - owed : 0);
    }

    /// U2 — toda participación en cola vive en una fecha abierta del pote.
    function invariant_U2_NoQueuedShareOutsideAnOpenDate() public view {
        assertEq(handler.queuedSharesOutsideOpenDates(), 0);
    }

    /// U3 — el operador nunca pasa del corte máximo del rendimiento que entró.
    function invariant_U3_OperatorNeverExceedsTheCappedCut() public view {
        uint256 cap = (handler.ghostYieldInjected() * 2000) / 10_000;
        assertLe(handler.ghostOperatorReceived() + pote.claimable(handler.operator()), cap + 100);
    }
}
