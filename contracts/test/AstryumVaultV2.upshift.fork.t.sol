// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {AstryumVault} from "../src/AstryumVault.sol";
import {AstryumVaultV2, IUpshiftVault} from "../src/AstryumVaultV2.sol";
import {PoteParams} from "../src/PoteParams.sol";
import {AstryumRegistry} from "../src/AstryumRegistry.sol";

/**
 * La rama Upshift contra los vaults REALES de Flare mainnet: earnXRP (Clearstar,
 * espera 1 día) y Monarq (espera 7 días). Lo que el mock no puede probar: que la
 * ABI tomada del código verificado responde, que la conversión de fechas del pote
 * coincide con la del venue, y que el ciclo depósito → cola → cobro cierra con el
 * dinero de verdad.
 *
 * Necesita red ([rpc_endpoints] flare). Sin conexión: `--no-match-contract Fork`.
 */
contract AstryumVaultV2UpshiftForkTest is Test {
    IERC20 constant FXRP = IERC20(0xAd552A648C74D49E10027AB8a618A3ad4901c5bE);
    address constant EARNXRP = 0x373D7d201C8134D4a2f7b5c63560da217e3dEA28;
    address constant MONARQ = 0x2439D4bb753A0f3777d4C9011AFacc475ba6B951;
    address constant KINETIC_KFXRP_ISO = 0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3; // la ballena del test

    address governor = makeAddr("governor");
    address council = makeAddr("council");
    address operator = makeAddr("operator");
    address client = makeAddr("client");
    address stranger = makeAddr("stranger");

    bytes32 constant REF = keccak256("politica-upshift-fork");
    uint48 constant COOLDOWN = 8 days; // ≥ la espera de Monarq (7 d)

    AstryumRegistry registry;
    AstryumVaultV2 pote; // venue 0 = earnXRP, venue 1 = Monarq

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("flare"));
        registry = new AstryumRegistry(governor, 0);
        _list(EARNXRP);
        _list(MONARQ);

        AstryumVault.InitialVenue[] memory v = new AstryumVault.InitialVenue[](2);
        v[0] = AstryumVault.InitialVenue(EARNXRP, AstryumVault.VenueKind.UpshiftQueued);
        v[1] = AstryumVault.InitialVenue(MONARQ, AstryumVault.VenueKind.UpshiftQueued);
        pote = new AstryumVaultV2(
            FXRP,
            council,
            REF,
            registry,
            PoteParams({
                name: "Astryum Pote Upshift",
                symbol: "apU-FXRP",
                cooldown: COOLDOWN,
                bufferFloorBps: 1000,
                maxPayeeBps: 2000,
                maxDepositPerUser: 0,
                initialGate: address(0),
                initialVenues: v
            })
        );

        vm.prank(KINETIC_KFXRP_ISO);
        FXRP.transfer(client, 20_000e6);
        vm.prank(client);
        FXRP.approve(address(pote), type(uint256).max);
        vm.prank(council);
        pote.cede(operator, uint64(block.timestamp + 60 days), REF);
    }

    function _list(address target) internal {
        vm.prank(governor);
        registry.proposeVenue(uint32(block.chainid), target, uint8(AstryumVault.VenueKind.UpshiftQueued));
        registry.activateVenue(uint32(block.chainid), target);
    }

    function _split(uint256 date) internal pure returns (uint256 y, uint256 m, uint256 d) {
        return (date / 10_000, (date / 100) % 100, date % 100);
    }

    // ── La sonda: la ABI del código verificado responde en los dos ────────────

    function test_Fork_Upshift_RealVaultsAnswerTheProbe() public view {
        assertEq(IUpshiftVault(EARNXRP).asset(), address(FXRP), "earnXRP asset");
        assertEq(IUpshiftVault(MONARQ).asset(), address(FXRP), "Monarq asset");
        assertEq(IUpshiftVault(EARNXRP).lagDuration(), 1 days, "earnXRP: espera de 1 dia");
        assertEq(IUpshiftVault(MONARQ).lagDuration(), 7 days, "Monarq: espera de 7 dias");
        assertEq(pote.venueShareToken(0), IUpshiftVault(EARNXRP).lpTokenAddress());
        assertEq(pote.venueShareToken(1), IUpshiftVault(MONARQ).lpTokenAddress());
        (uint256 gross, uint256 net) = IUpshiftVault(EARNXRP).previewRedemption(1e6, false);
        assertGt(gross, 1e6, "earnXRP: la participacion vale mas de 1 FXRP");
        assertLe(net, gross);
    }

    /// Un pote con cooldown de 3 días no puede llevar Monarq (7 días de espera).
    function test_Fork_Upshift_MonarqNeedsAWeekOfCooldown() public {
        AstryumVault.InitialVenue[] memory v = new AstryumVault.InitialVenue[](1);
        v[0] = AstryumVault.InitialVenue(MONARQ, AstryumVault.VenueKind.UpshiftQueued);
        vm.expectRevert(abi.encodeWithSelector(AstryumVaultV2.CooldownBelowVenueLag.selector, 7 days));
        new AstryumVaultV2(
            FXRP,
            council,
            REF,
            registry,
            PoteParams({
                name: "x",
                symbol: "x",
                cooldown: 3 days,
                bufferFloorBps: 1000,
                maxPayeeBps: 2000,
                maxDepositPerUser: 0,
                initialGate: address(0),
                initialVenues: v
            })
        );
    }

    // ── Entrar y valorar con el precio real ──────────────────────────────────

    function test_Fork_Upshift_DirectToIntoBothAndValueAtTheRealPrice() public {
        vm.prank(client);
        pote.deposit(10_000e6, client);
        vm.startPrank(operator);
        pote.directTo(0, 4_000e6, REF);
        pote.directTo(1, 4_000e6, REF);
        vm.stopPrank();

        // El redondeo de Upshift (floor al entrar y al valorar) cuesta polvo, no más.
        assertApproxEqAbs(pote.venueValue(0), 4_000e6, 5);
        assertApproxEqAbs(pote.venueValue(1), 4_000e6, 5);
        assertApproxEqAbs(pote.totalAssets(), 10_000e6, 10);
    }

    // ── El ciclo entero con cada vault real ──────────────────────────────────

    function test_Fork_Upshift_EarnXrpFullHolderExitCycle() public {
        _fullCycle(0);
    }

    function test_Fork_Upshift_MonarqFullHolderExitCycle() public {
        _fullCycle(1);
    }

    function _fullCycle(uint256 venueId) internal {
        vm.prank(client);
        uint256 shares = pote.deposit(10_000e6, client);
        vm.prank(operator);
        pote.directTo(venueId, 9_000e6, REF);

        vm.prank(client);
        uint256 ticketId = pote.requestRedeem(shares, client);

        uint256[] memory dates = pote.openExitDates(venueId);
        assertEq(dates.length, 1, "una fecha en cola");
        (uint256 y, uint256 m, uint256 d) = _split(dates[0]);
        (address target,,,) = pote.venues(venueId);
        assertGt(
            IUpshiftVault(target).getBurnableAmountByReceiver(y, m, d, address(pote)),
            0,
            "el venue tiene la salida del pote en esa fecha"
        );

        vm.warp(block.timestamp + COOLDOWN);
        AstryumVault.VenueClaim[] memory claims = new AstryumVault.VenueClaim[](1);
        claims[0] = AstryumVault.VenueClaim(venueId, dates[0]);
        vm.prank(stranger);
        pote.claimRedeem(ticketId, claims);

        (, uint256 owed,,) = pote.redeemTickets(ticketId);
        assertEq(FXRP.balanceOf(client), 10_000e6 + owed, "el titular cobra lo que fijo al pedir");
        assertApproxEqAbs(owed, 10_000e6, 10);
        assertEq(pote.openExitDates(venueId).length, 0);
        assertEq(pote.earmarkedAssets(), 0);
    }
}
