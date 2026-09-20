// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {AstryumCage, PoteDeployer} from "../src/AstryumCage.sol";
import {PoteParams} from "../src/PoteParams.sol";
import {AstryumVault} from "../src/AstryumVault.sol";
import {AstryumVaultV2} from "../src/AstryumVaultV2.sol";
import {AstryumRegistry} from "../src/AstryumRegistry.sol";
import {XrplCouncilBridgeV2} from "../src/XrplCouncilBridgeV2.sol";
import {MockFXRP, Mock4626Venue, MockCompoundVenue, MaliciousVenue} from "./mocks/Mocks.sol";

/// Una puerta que deja pasar a todos: para probar la REGLA del gate (que existe y
/// no se puede quitar), no la política de una lista concreta.
contract AllowAllGate {
    function isApproved(address) external pure returns (bool) {
        return true;
    }
}

/**
 * La jaula v2, y las propiedades por las que existe.
 *
 * La premisa «el principal no se puede retirar» NO vive aquí: vive en el pote
 * (eterno) y en el registro de Astryum, que el propio pote consulta. Esta suite
 * lo demuestra por el camino más duro: reproduce el ataque del vault falso
 * contra el pote v1 (funciona) y lo lanza contra el v2 por las dos vías — por la
 * jaula y saltándosela — y en las dos se estrella contra el registro.
 */
contract AstryumCageTest is Test {
    uint32 constant CHAIN = 31337; // foundry
    uint32 constant CHAIN_ETH = 1;
    bytes32 constant REF = bytes32(uint256(0x11));
    bytes32 constant NEW_REF = bytes32(uint256(0x22));
    uint256 constant FEE = 1e6; // 1 FXRP por pote

    MockFXRP fxrp;
    MockCompoundVenue kinetic;
    Mock4626Venue upshift;
    MaliciousVenue attacker;

    AstryumRegistry registry;
    PoteDeployer poteDeployer;
    XrplCouncilBridgeV2 bridge;
    AstryumCage cage;

    address astryum = makeAddr("astryum"); // gobierna el registro, nada más
    address treasury = makeAddr("treasury");
    address councilPA = makeAddr("councilPA"); // paga la fee de creación
    address client = makeAddr("client");
    address heir = makeAddr("heir");
    address thief = makeAddr("thief");
    address stranger = makeAddr("stranger");
    address remoteVault = makeAddr("remoteVault"); // un pote en Ethereum, permitido

    function setUp() public {
        fxrp = new MockFXRP();
        kinetic = new MockCompoundVenue(fxrp);
        upshift = new Mock4626Venue(fxrp);
        attacker = new MaliciousVenue(fxrp, thief);

        // El scanner de Astryum, sin timelock para ir rápido (el timelock tiene su test).
        registry = new AstryumRegistry(astryum, 0);
        _approveVenue(CHAIN, address(kinetic), uint8(AstryumVault.VenueKind.CompoundV2));
        _approveVenue(CHAIN, address(upshift), uint8(AstryumVault.VenueKind.ERC4626));
        _approveVenue(CHAIN_ETH, remoteVault, uint8(AstryumVault.VenueKind.ERC4626));

        poteDeployer = new PoteDeployer();
        bridge = new XrplCouncilBridgeV2(keccak256("rCouncil"), bytes32("XRP"), keccak256("rAnchor"));
        cage = new AstryumCage(address(bridge), fxrp, registry, REF, treasury, FEE, 2000, 0, poteDeployer, _allowed());
        bridge.bind(address(cage));

        fxrp.mint(client, 1_000_000e6);
        fxrp.mint(councilPA, 100e6);
        vm.prank(councilPA);
        fxrp.approve(address(cage), type(uint256).max);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _approveVenue(uint32 chainId, address target, uint8 kind) internal {
        vm.prank(astryum);
        registry.proposeVenue(chainId, target, kind);
        registry.activateVenue(chainId, target);
    }

    function _allowed() internal view returns (AstryumCage.Target[] memory list) {
        list = new AstryumCage.Target[](3);
        list[0] = AstryumCage.Target({chainId: CHAIN, target: address(kinetic)});
        list[1] = AstryumCage.Target({chainId: CHAIN, target: address(upshift)});
        list[2] = AstryumCage.Target({chainId: CHAIN_ETH, target: remoteVault});
    }

    function _kineticOnly() internal view returns (AstryumVault.InitialVenue[] memory v) {
        v = new AstryumVault.InitialVenue[](1);
        v[0] = AstryumVault.InitialVenue({target: address(kinetic), kind: AstryumVault.VenueKind.CompoundV2});
    }

    /// La ficha de nacimiento de un pote, en una línea.
    function _p(
        string memory name,
        string memory symbol,
        uint48 cooldown,
        uint16 floorBps,
        uint16 maxPayeeBps,
        uint256 maxDepositPerUser,
        address gate,
        AstryumVault.InitialVenue[] memory venues
    ) internal pure returns (PoteParams memory) {
        return PoteParams({
            name: name,
            symbol: symbol,
            cooldown: cooldown,
            bufferFloorBps: floorBps,
            maxPayeeBps: maxPayeeBps,
            maxDepositPerUser: maxDepositPerUser,
            initialGate: gate,
            initialVenues: venues
        });
    }

    /// Un pote ABIERTO de esta jaula: Kinetic dentro, payees ≤ 20%, sin puerta.
    function _openPote() internal returns (AstryumVaultV2 pote) {
        vm.prank(address(bridge));
        pote = AstryumVaultV2(cage.createPote(_p("Open", "op-FXRP", 0, 1000, 2000, 0, address(0), _kineticOnly()), REF, councilPA));
    }

    function _deposit(AstryumVaultV2 pote, uint256 amount) internal returns (uint256 shares) {
        vm.startPrank(client);
        fxrp.approve(address(pote), amount);
        shares = pote.deposit(amount, client);
        vm.stopPrank();
    }

    // ═══ 1. EL ATAQUE DEL VAULT FALSO — reproducido en v1, bloqueado en v2 ═══

    function test_v1_the_robbery_that_WAS_possible() public {
        // El pote v1, con este test como consejo. Sin registro: cualquier target entra.
        AstryumVault v1 = new AstryumVault(fxrp, "v1", "v1", address(this), REF, 0, 1000, _kineticOnly());
        v1.proposeVenue(address(attacker), AstryumVault.VenueKind.ERC4626, REF);
        vm.warp(block.timestamp + 31 days); // el único freno de la v1: la espera

        vm.startPrank(client);
        fxrp.approve(address(v1), 100e6);
        uint256 shares = v1.deposit(100e6, client);
        vm.stopPrank();

        v1.directTo(1, 50e6, REF); // venue #1 = el ladrón

        assertEq(fxrp.balanceOf(thief), 50e6, "la mitad del capital se fue con el ladron");
        assertLt(v1.previewRedeem(shares), 100e6, "y las participaciones del cliente ya valen menos");
    }

    function test_v2_the_same_robbery_through_the_cage_is_impossible() public {
        AstryumVaultV2 pote = _openPote();

        // El ladrón responde bien a asset(): pasa la cordura. Lo que lo para es la lista.
        vm.prank(address(bridge));
        vm.expectRevert(abi.encodeWithSelector(AstryumCage.TargetNotAllowed.selector, CHAIN, address(attacker)));
        cage.proposeVenue(address(pote), address(attacker), AstryumVault.VenueKind.ERC4626, REF);
    }

    function test_v2_the_same_robbery_BYPASSING_the_cage_is_impossible_too() public {
        // Un consejo malicioso que no pasa por ninguna jaula: este test, directo.
        AstryumVaultV2 rogue = new AstryumVaultV2(fxrp, address(this), REF, registry, _p("rogue", "rg", 0, 1000, 2000, 0, address(0), new AstryumVault.InitialVenue[](0)));

        // El pote pregunta al registro él mismo. El ladrón no está. Se acabó.
        vm.expectRevert(abi.encodeWithSelector(AstryumVaultV2.VenueNotInRegistry.selector, address(attacker)));
        rogue.proposeVenue(address(attacker), AstryumVault.VenueKind.ERC4626, REF);
    }

    function test_a_cage_cannot_even_be_BORN_with_a_target_outside_the_registry() public {
        AstryumCage.Target[] memory dirty = new AstryumCage.Target[](1);
        dirty[0] = AstryumCage.Target({chainId: CHAIN, target: address(attacker)});

        vm.expectRevert(abi.encodeWithSelector(AstryumCage.TargetNotInRegistry.selector, CHAIN, address(attacker)));
        new AstryumCage(address(bridge), fxrp, registry, REF, treasury, FEE, 2000, 0, poteDeployer, dirty);
    }

    function test_a_venue_removed_from_the_registry_cannot_receive_NEW_capital() public {
        AstryumVaultV2 pote = _openPote();

        // Astryum retira Upshift (p. ej. incidente). Estaba en la lista eterna de la
        // jaula — y aun así ya no entra: el registro se re-comprueba al proponer.
        vm.prank(astryum);
        registry.removeVenue(CHAIN, address(upshift));

        vm.prank(address(bridge));
        vm.expectRevert(abi.encodeWithSelector(AstryumCage.TargetNotInRegistry.selector, CHAIN, address(upshift)));
        cage.proposeVenue(address(pote), address(upshift), AstryumVault.VenueKind.ERC4626, REF);
    }

    // ═══ 2. CORDURA DEL TARGET, en el pote ═══

    function test_the_pote_rejects_a_wallet_as_venue_even_if_the_registry_slipped() public {
        address eoa = makeAddr("eoa");
        _approveVenue(CHAIN, eoa, uint8(AstryumVault.VenueKind.ERC4626)); // error humano en el registro

        AstryumVault.InitialVenue[] memory v = new AstryumVault.InitialVenue[](1);
        v[0] = AstryumVault.InitialVenue({target: eoa, kind: AstryumVault.VenueKind.ERC4626});

        vm.expectRevert(abi.encodeWithSelector(AstryumVaultV2.VenueHasNoCode.selector, eoa));
        new AstryumVaultV2(fxrp, address(this), REF, registry, _p("x", "x", 0, 1000, 2000, 0, address(0), v));
    }

    function test_the_pote_rejects_a_venue_of_another_asset() public {
        MockFXRP other = new MockFXRP();
        Mock4626Venue wrong = new Mock4626Venue(other);
        _approveVenue(CHAIN, address(wrong), uint8(AstryumVault.VenueKind.ERC4626));

        AstryumVault.InitialVenue[] memory v = new AstryumVault.InitialVenue[](1);
        v[0] = AstryumVault.InitialVenue({target: address(wrong), kind: AstryumVault.VenueKind.ERC4626});

        vm.expectRevert(abi.encodeWithSelector(AstryumVaultV2.VenueAssetMismatch.selector, address(wrong)));
        new AstryumVaultV2(fxrp, address(this), REF, registry, _p("x", "x", 0, 1000, 2000, 0, address(0), v));
    }

    // ═══ 3. LA SALIDA NO DEPENDE DE LA JAULA ═══

    function test_the_client_exits_alone_even_with_capital_working_in_a_venue() public {
        AstryumVaultV2 pote = _openPote();
        uint256 shares = _deposit(pote, 100e6);

        vm.prank(address(bridge));
        cage.directTo(address(pote), 0, 50e6, REF); // la mitad trabajando en Kinetic

        // Nadie manda nada más: la jaula podría estar rota. El cliente sale igual —
        // el pote deshace el venue él solo dentro del redeem.
        vm.prank(client);
        uint256 got = pote.redeem(shares, client, client);

        assertEq(got, 100e6, "vuelve entero: lo del colchon y lo del venue");
        assertEq(fxrp.balanceOf(client), 1_000_000e6);
    }

    function test_the_cage_never_holds_shares_nor_is_approved_over_anyones() public {
        AstryumVaultV2 pote = _openPote();
        _deposit(pote, 100e6);
        assertEq(pote.balanceOf(address(cage)), 0);
        assertEq(pote.allowance(client, address(cage)), 0);
    }

    // ═══ 4. LA JAULA NO RECIBE ACTIVOS — y no tiene puertas traseras ═══

    function test_the_cage_refuses_native_and_has_no_sweep() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(cage).call{value: 1}("");
        assertFalse(ok, "sin receive ni fallback");

        bytes4[5] memory forbidden = [
            bytes4(keccak256("sweep(address)")),
            bytes4(keccak256("sweep(address,address)")),
            bytes4(keccak256("addAllowedTarget(uint32,address)")),
            bytes4(keccak256("setAllowedTargets((uint32,address)[])")),
            bytes4(keccak256("transferCouncil(address,address,bytes32)"))
        ];
        for (uint256 i = 0; i < forbidden.length; i++) {
            (bool exists,) = address(cage).call(abi.encodeWithSelector(forbidden[i], address(0), address(0)));
            assertFalse(exists, "puerta trasera");
        }
    }

    function test_the_creation_fee_goes_straight_to_the_treasury_never_through_the_cage() public {
        _openPote();
        assertEq(fxrp.balanceOf(treasury), FEE, "la tesoreria cobra");
        assertEq(fxrp.balanceOf(address(cage)), 0, "la jaula no toca un token ni un bloque");
        assertEq(fxrp.balanceOf(councilPA), 100e6 - FEE);
    }

    function test_no_fee_approval_no_pote() public {
        address broke = makeAddr("broke");
        vm.prank(address(bridge));
        vm.expectRevert();
        cage.createPote(_p("x", "x", 0, 1000, 2000, 0, address(0), _kineticOnly()), REF, broke);
    }

    // ═══ 5. EL CAP DE PAYEES VIVE EN EL POTE, según abierto/privado ═══

    function test_an_open_pote_caps_payees_at_20_percent() public {
        AstryumVaultV2 pote = _openPote();
        address[] memory a = new address[](1);
        a[0] = heir;
        uint16[] memory bps = new uint16[](1);

        bps[0] = 2500;
        vm.prank(address(bridge));
        vm.expectRevert(AstryumVault.PayeeBpsOverCap.selector);
        cage.setPayees(address(pote), a, bps, REF);

        bps[0] = 2000;
        vm.prank(address(bridge));
        cage.setPayees(address(pote), a, bps, REF);
    }

    /// La jaula que una factory de FAMILIAS fabricaría: política 10000. La de hoy
    /// (exchanges y managers) nace con 2000 y no puede abrir potes así.
    function _familyCage() internal returns (AstryumCage fam) {
        fam = new AstryumCage(address(bridge), fxrp, registry, REF, treasury, FEE, 10_000, 0, poteDeployer, _allowed());
        vm.prank(councilPA);
        fxrp.approve(address(fam), type(uint256).max);
    }

    function test_a_private_pote_must_be_born_with_a_gate() public {
        AstryumCage fam = _familyCage();
        vm.prank(address(bridge));
        vm.expectRevert(AstryumVaultV2.PrivatePoteNeedsGate.selector);
        fam.createPote(_p("fam", "fam", 0, 1000, 10_000, 0, address(0), _kineticOnly()), REF, councilPA);
    }

    function test_a_private_pote_pays_up_to_100_percent_and_its_gate_is_forever() public {
        AstryumCage famCage = _familyCage();
        AllowAllGate gate = new AllowAllGate();
        vm.prank(address(bridge));
        AstryumVaultV2 fam = AstryumVaultV2(
            famCage.createPote(_p("fam", "fam", 0, 1000, 10_000, 0, address(gate), _kineticOnly()), REF, councilPA)
        );
        assertTrue(fam.GATE_PERMANENT());

        address[] memory a = new address[](1);
        a[0] = heir;
        uint16[] memory bps = new uint16[](1);
        bps[0] = 10_000;
        vm.prank(address(bridge));
        famCage.setPayees(address(fam), a, bps, REF); // el 100% a los herederos

        // Abrirla a terceros: nunca.
        vm.prank(address(bridge));
        vm.expectRevert(AstryumVaultV2.GateIsPermanent.selector);
        famCage.setUserGate(address(fam), address(0), REF);

        // Cambiar de registro: sí.
        AllowAllGate other = new AllowAllGate();
        vm.prank(address(bridge));
        famCage.setUserGate(address(fam), address(other), REF);
        assertEq(address(fam.userGate()), address(other));
    }

    function test_an_exchange_cage_cannot_open_a_pote_that_pays_more_than_its_policy() public {
        // La jaula de esta generación nace con 2000. Un pote con puerta KYC tiene
        // depositantes terceros: sin este tope, un exchange se fijaría el 100%.
        AllowAllGate kyc = new AllowAllGate();
        vm.prank(address(bridge));
        vm.expectRevert(abi.encodeWithSelector(AstryumCage.PayeeCapAboveCagePolicy.selector, uint16(10_000), uint16(2000)));
        cage.createPote(_p("ex", "ex", 0, 1000, 10_000, 0, address(kyc), _kineticOnly()), REF, councilPA);
    }

    function test_a_successor_that_would_charge_more_is_refused() public {
        AstryumCage looser = _familyCage();
        vm.prank(astryum);
        registry.proposeCageCode(address(looser).codehash);
        registry.activateCageCode(address(looser).codehash);

        vm.prank(address(bridge));
        vm.expectRevert(abi.encodeWithSelector(AstryumCage.ContinuityBroken.selector, "payees"));
        cage.proposeSuccessor(address(looser), REF);
    }

    // ═══ 6. GOBIERNO: misma forma que el Legacy ═══

    function test_a_new_constitution_travels_to_every_pote_in_the_same_tx() public {
        AstryumVaultV2 p1 = _openPote();
        AstryumVaultV2 p2 = _openPote();
        _deposit(p1, 100e6);

        vm.prank(address(bridge));
        cage.setConstitutionRef(NEW_REF, REF);

        assertEq(p1.constitutionRef(), NEW_REF);
        assertEq(p2.constitutionRef(), NEW_REF);

        // La vieja ya no manda; la nueva sí, y llega hasta el pote.
        vm.prank(address(bridge));
        vm.expectRevert(AstryumCage.RefMismatch.selector);
        cage.directTo(address(p1), 0, 10e6, REF);

        vm.prank(address(bridge));
        cage.directTo(address(p1), 0, 10e6, NEW_REF);
    }

    function test_the_director_runs_the_day_to_day_and_expires_alone() public {
        AstryumVaultV2 pote = _openPote();
        _deposit(pote, 100e6);
        address desk = makeAddr("desk");

        vm.prank(address(bridge));
        cage.cede(desk, uint64(block.timestamp + 1 days), REF);

        vm.prank(desk);
        cage.directTo(address(pote), 0, 10e6, REF);

        // El director NO decide el catálogo — ni dentro de lo permitido.
        vm.prank(desk);
        vm.expectRevert(AstryumCage.NotAuthority.selector);
        cage.proposeVenue(address(pote), address(upshift), AstryumVault.VenueKind.ERC4626, REF);

        vm.warp(block.timestamp + 2 days);
        vm.prank(desk);
        vm.expectRevert(AstryumCage.NotDirectorOrAuthority.selector);
        cage.directTo(address(pote), 0, 10e6, REF);
    }

    function test_only_the_authority_commands() public {
        AstryumVaultV2 pote = _openPote();
        vm.prank(stranger);
        vm.expectRevert(AstryumCage.NotAuthority.selector);
        cage.createPote(_p("x", "x", 0, 1000, 2000, 0, address(0), _kineticOnly()), REF, councilPA);
        vm.prank(stranger);
        vm.expectRevert(AstryumCage.NotDirectorOrAuthority.selector);
        cage.directTo(address(pote), 0, 1, REF);
    }

    function test_orders_never_reach_a_pote_from_another_cage() public {
        AstryumVaultV2 foreign = new AstryumVaultV2(fxrp, address(cage), REF, registry, _p("f", "f", 0, 1000, 2000, 0, address(0), new AstryumVault.InitialVenue[](0)));
        vm.prank(address(bridge));
        vm.expectRevert(abi.encodeWithSelector(AstryumCage.NotMyPote.selector, address(foreign)));
        cage.directTo(address(foreign), 0, 1, REF);
    }

    function test_a_pote_revert_bubbles_up_with_its_real_reason() public {
        AstryumVaultV2 pote = _openPote();
        _deposit(pote, 100e6);
        vm.prank(address(bridge));
        vm.expectRevert(AstryumVault.BufferFloorCrossed.selector);
        cage.directTo(address(pote), 0, 100e6, REF);
    }

    // ═══ 7. REMOTO: el marco de la puerta, sin la hoja ═══

    function test_remote_instructions_are_declared_and_revert_until_PMW_exists() public {
        AstryumVaultV2 pote = _openPote();
        vm.startPrank(address(bridge));
        cage.registerRemoteWallet(CHAIN_ETH, bytes32("wallet-1"), REF);

        vm.expectRevert(AstryumCage.RemoteNotSupportedYet.selector);
        cage.mintIntoPote(0, address(pote), 1e6, REF);

        vm.expectRevert(AstryumCage.RemoteNotSupportedYet.selector);
        cage.redeemToOwnWallet(0, address(pote), 1e6, REF);
        vm.stopPrank();
    }

    function test_a_remote_payment_only_goes_to_a_registry_destination() public {
        bytes32 agent = keccak256("rFAssetsAgent");
        vm.startPrank(address(bridge));
        cage.registerRemoteWallet(CHAIN_ETH, bytes32("wallet-1"), REF);

        vm.expectRevert(abi.encodeWithSelector(AstryumCage.DestinationNotInRegistry.selector, CHAIN_ETH, agent));
        cage.payRegistryDestination(0, agent, 1e6, REF);
        vm.stopPrank();

        vm.prank(astryum);
        registry.proposeDestination(CHAIN_ETH, agent);
        registry.activateDestination(CHAIN_ETH, agent);

        vm.prank(address(bridge));
        vm.expectRevert(AstryumCage.RemoteNotSupportedYet.selector); // ahora sí pasa el registro; falta la hoja
        cage.payRegistryDestination(0, agent, 1e6, REF);
    }

    function test_a_remote_pote_must_be_an_allowed_target_on_its_chain() public {
        vm.startPrank(address(bridge));
        cage.registerRemotePote(CHAIN_ETH, remoteVault, REF);
        assertEq(cage.remotePoteCount(), 1);

        vm.expectRevert(abi.encodeWithSelector(AstryumCage.TargetNotAllowed.selector, CHAIN_ETH, address(attacker)));
        cage.registerRemotePote(CHAIN_ETH, address(attacker), REF);
        vm.stopPrank();
    }

    function test_settling_an_unknown_instruction_cannot_invent_one() public {
        vm.prank(address(bridge));
        vm.expectRevert(abi.encodeWithSelector(AstryumCage.UnknownInstruction.selector, uint64(0)));
        cage.settleRemoteInstruction(0, true, 1);
    }

    // ═══ 8. SUCESIÓN: la única vía de upgrade, con las cinco continuidades ═══

    function _newCage(AstryumCage.Target[] memory list, address authority) internal returns (AstryumCage) {
        return new AstryumCage(authority, fxrp, registry, REF, treasury, FEE, 2000, 0, poteDeployer, list);
    }

    function test_succession_hands_over_potes_and_rebinds_the_bridge() public {
        AstryumVaultV2 pote = _openPote();
        _deposit(pote, 100e6);
        AstryumCage next = _newCage(_allowed(), address(bridge));

        // 1. Sin código aprobado, no hay sucesor.
        vm.prank(address(bridge));
        vm.expectRevert(abi.encodeWithSelector(AstryumCage.ContinuityBroken.selector, "code"));
        cage.proposeSuccessor(address(next), REF);

        // Astryum aprueba la implementación (misma bytecode que la jaula actual).
        vm.prank(astryum);
        registry.proposeCageCode(address(next).codehash);
        registry.activateCageCode(address(next).codehash);

        vm.prank(address(bridge));
        cage.proposeSuccessor(address(next), REF);

        // 2. Los 30 días son de verdad.
        vm.prank(address(bridge));
        vm.expectRevert(AstryumCage.SuccessorNotMature.selector);
        cage.executeSuccession(REF);

        vm.warp(block.timestamp + 30 days);
        vm.prank(address(bridge));
        cage.executeSuccession(REF);

        // 3. El bridge ya habla con la nueva; la vieja ya no manda; el pote espera a la nueva.
        assertEq(bridge.vault(), address(next), "el bridge se re-ato solo");
        assertTrue(cage.succeeded());
        assertEq(pote.pendingCouncil(), address(next));

        vm.prank(address(bridge));
        vm.expectRevert(AstryumCage.AlreadySucceeded.selector);
        cage.directTo(address(pote), 0, 1, REF);

        // 4. El consejo de la nueva jaula completa el traspaso ya decidido —
        //    por su bridge, que ya apunta a ella. Adoptar es un acto de GOBIERNO:
        //    cuando era permissionless, cualquiera metía un contrato que decía
        //    esperarnos y brickeaba los bucles para siempre (AstryumCage.poison.t.sol).
        vm.prank(stranger);
        vm.expectRevert(AstryumCage.NotAuthority.selector);
        next.acceptPote(address(pote));

        vm.prank(address(bridge));
        next.acceptPote(address(pote));
        assertEq(pote.council(), address(next));
        assertTrue(next.isMyPote(address(pote)));

        // 5. La nueva manda por el mismo bridge, y el cliente sigue entero.
        vm.prank(address(bridge));
        next.directTo(address(pote), 0, 10e6, REF);
        assertEq(pote.balanceOf(client), 100e6 * 1e3, "las participaciones de nadie se movieron");
    }

    function test_a_successor_with_a_WIDER_allowlist_is_refused() public {
        // Un venue nuevo, aprobado por Astryum, que la jaula actual NO tiene.
        Mock4626Venue extra = new Mock4626Venue(fxrp);
        _approveVenue(CHAIN, address(extra), uint8(AstryumVault.VenueKind.ERC4626));
        AstryumCage.Target[] memory wider = new AstryumCage.Target[](2);
        wider[0] = AstryumCage.Target({chainId: CHAIN, target: address(kinetic)});
        wider[1] = AstryumCage.Target({chainId: CHAIN, target: address(extra)});
        AstryumCage next = _newCage(wider, address(bridge));

        vm.prank(astryum);
        registry.proposeCageCode(address(next).codehash);
        registry.activateCageCode(address(next).codehash);

        vm.prank(address(bridge));
        vm.expectRevert(abi.encodeWithSelector(AstryumCage.ContinuityBroken.selector, "allowlist"));
        cage.proposeSuccessor(address(next), REF);
    }

    function test_a_successor_under_another_authority_is_refused() public {
        XrplCouncilBridgeV2 otherBridge = new XrplCouncilBridgeV2(keccak256("rOther"), bytes32("XRP"), keccak256("rAnchor"));
        AstryumCage next = _newCage(_allowed(), address(otherBridge));
        vm.prank(astryum);
        registry.proposeCageCode(address(next).codehash);
        registry.activateCageCode(address(next).codehash);

        vm.prank(address(bridge));
        vm.expectRevert(abi.encodeWithSelector(AstryumCage.ContinuityBroken.selector, "authority"));
        cage.proposeSuccessor(address(next), REF);
    }

    function test_only_the_bound_cage_can_rebind_the_bridge() public {
        vm.prank(stranger);
        vm.expectRevert(XrplCouncilBridgeV2.NotBoundVault.selector);
        bridge.rebind(stranger);
    }

    // ═══ 9. EL REGISTRO: alta con timelock, baja inmediata, gobierno en dos pasos ═══

    function test_registry_additions_wait_and_removals_do_not() public {
        AstryumRegistry slow = new AstryumRegistry(astryum, 2 days);
        vm.prank(astryum);
        slow.proposeVenue(CHAIN, address(kinetic), 1);

        vm.expectRevert(abi.encodeWithSelector(AstryumRegistry.NotYetActive.selector, uint64(block.timestamp + 2 days)));
        slow.activateVenue(CHAIN, address(kinetic));

        vm.warp(block.timestamp + 2 days);
        slow.activateVenue(CHAIN, address(kinetic));
        assertTrue(slow.isApprovedVenue(CHAIN, address(kinetic), 1));

        vm.prank(astryum);
        slow.removeVenue(CHAIN, address(kinetic));
        assertFalse(slow.isApprovedTarget(CHAIN, address(kinetic)));
    }

    function test_registry_governance_is_two_step_and_nobody_else_writes() public {
        vm.prank(stranger);
        vm.expectRevert(AstryumRegistry.NotGovernor.selector);
        registry.proposeVenue(CHAIN, address(attacker), 0);

        address next = makeAddr("nextGovernor");
        vm.prank(astryum);
        registry.transferGovernor(next);
        assertEq(registry.governor(), astryum, "hasta que acepte, no cambia");
        vm.prank(next);
        registry.acceptGovernor();
        assertEq(registry.governor(), next);
    }

    // ═══ 10. SPOKE DESDE EL DÍA UNO ═══

    function test_publishNav_emits_the_pote_own_state() public {
        AstryumVaultV2 pote = _openPote();
        _deposit(pote, 100e6);
        vm.expectEmit(false, false, false, true);
        emit AstryumVaultV2.NavPublished(pote.totalAssets(), pote.totalSupply(), block.timestamp);
        pote.publishNav();
    }

    // ═══ 27-AGO: LISTA OPCIONAL, POTES SIN FEE, TOPE POR CUENTA, WHITELIST ENUMERABLE ═══

    function _newCageFree(AstryumCage.Target[] memory list, uint16 free) internal returns (AstryumCage c) {
        c = new AstryumCage(address(bridge), fxrp, registry, REF, treasury, FEE, 2000, free, poteDeployer, list);
        vm.prank(councilPA);
        fxrp.approve(address(c), type(uint256).max);
    }

    function _approveCode(address c) internal {
        vm.startPrank(astryum);
        registry.proposeCageCode(c.codehash);
        registry.activateCageCode(c.codehash);
        vm.stopPrank();
    }

    function test_the_first_FREE_POTES_cost_only_gas_and_the_next_one_pays_the_treasury() public {
        AstryumCage c = _newCageFree(_allowed(), 2);
        assertEq(c.FREE_POTES(), 2);
        assertEq(c.freePotesLeft(), 2);
        uint256 before = fxrp.balanceOf(treasury);
        vm.startPrank(address(bridge));
        c.createPote(_p("a", "a", 0, 1000, 2000, 0, address(0), _kineticOnly()), REF, councilPA);
        c.createPote(_p("b", "b", 0, 1000, 2000, 0, address(0), _kineticOnly()), REF, councilPA);
        vm.stopPrank();
        assertEq(fxrp.balanceOf(treasury), before, "dos potes, cero fee");
        assertEq(c.freePotesLeft(), 0);
        vm.prank(address(bridge));
        c.createPote(_p("c", "c", 0, 1000, 2000, 0, address(0), _kineticOnly()), REF, councilPA);
        assertEq(fxrp.balanceOf(treasury), before + FEE, "el tercero paga a la tesoreria");
        assertEq(fxrp.balanceOf(address(c)), 0, "la jaula sigue sin tocar un token");
    }

    function test_a_cage_born_WITHOUT_a_list_follows_the_registry_as_it_grows_and_shrinks() public {
        AstryumCage c = _newCageFree(new AstryumCage.Target[](0), 0);
        assertTrue(c.registryOnly());
        assertEq(c.allowedTargetCount(), 0);
        assertTrue(c.isAllowedTarget(CHAIN, address(kinetic)), "lo que esta en el registro entra");
        assertFalse(c.isAllowedTarget(CHAIN, address(attacker)), "lo que no, no - ni con lista vacia");

        vm.prank(address(bridge));
        AstryumVaultV2 pote =
            AstryumVaultV2(c.createPote(_p("r", "r", 0, 1000, 2000, 0, address(0), _kineticOnly()), REF, councilPA));

        // Manana Astryum aprueba un venue nuevo: disponible sin tocar la jaula.
        Mock4626Venue extra = new Mock4626Venue(fxrp);
        _approveVenue(CHAIN, address(extra), uint8(AstryumVault.VenueKind.ERC4626));
        vm.prank(address(bridge));
        c.proposeVenue(address(pote), address(extra), AstryumVault.VenueKind.ERC4626, REF);

        // Y si lo retira, deja de entrar en el acto.
        vm.prank(astryum);
        registry.removeVenue(CHAIN, address(extra));
        assertFalse(c.isAllowedTarget(CHAIN, address(extra)));
        vm.prank(address(bridge));
        vm.expectRevert(abi.encodeWithSelector(AstryumCage.TargetNotAllowed.selector, CHAIN, address(extra)));
        c.proposeVenue(address(pote), address(extra), AstryumVault.VenueKind.ERC4626, REF);
    }

    function test_a_registry_only_cage_accepts_a_registry_only_or_NARROWER_successor() public {
        AstryumCage c = _newCageFree(new AstryumCage.Target[](0), 0);
        AstryumCage next = _newCageFree(new AstryumCage.Target[](0), 0);
        AstryumCage narrower = _newCageFree(_allowed(), 0);
        _approveCode(address(next)); // mismos immutables = mismo codehash para las tres

        vm.prank(address(bridge));
        c.proposeSuccessor(address(next), REF);
        vm.prank(address(bridge));
        c.cancelSuccessor(REF);
        vm.prank(address(bridge));
        c.proposeSuccessor(address(narrower), REF);
    }

    function test_a_cage_WITH_a_list_refuses_a_registry_only_successor_that_would_widen_it() public {
        AstryumCage wide = _newCageFree(new AstryumCage.Target[](0), 0);
        _approveCode(address(wide));
        vm.prank(address(bridge));
        vm.expectRevert(abi.encodeWithSelector(AstryumCage.ContinuityBroken.selector, "allowlist"));
        cage.proposeSuccessor(address(wide), REF);
    }

    function test_max_deposit_per_user_caps_the_position_of_a_receiver_never_the_exit() public {
        vm.prank(address(bridge));
        AstryumVaultV2 pote =
            AstryumVaultV2(cage.createPote(_p("cap", "cap", 0, 1000, 2000, 100e6, address(0), _kineticOnly()), REF, councilPA));
        assertEq(pote.maxDepositPerUser(), 100e6);
        assertEq(pote.maxDeposit(client), 100e6);

        _deposit(pote, 60e6);
        assertEq(pote.maxDeposit(client), 40e6, "el hueco descuenta lo que ya tiene");

        vm.startPrank(client);
        fxrp.approve(address(pote), 200e6);
        vm.expectRevert(); // ERC4626ExceededMaxDeposit: lo aplica el propio ERC-4626
        pote.deposit(50e6, client);
        pote.deposit(40e6, client); // justo hasta el tope, si
        assertEq(pote.maxDeposit(client), 0);
        // Otra cuenta receptora tiene su propio hueco: es un tope por CUENTA.
        pote.deposit(100e6, heir);
        vm.stopPrank();
        assertEq(pote.maxDeposit(heir), 0);
        assertEq(pote.maxMint(heir), 0);

        // Salir jamas se bloquea: el que esta al tope redime lo que quiera.
        uint256 half = pote.balanceOf(client) / 2;
        vm.prank(client);
        pote.redeem(half, client, client);
        assertGt(pote.maxDeposit(client), 0, "y al salir vuelve a tener hueco");

        // El consejo lo quita (0) por orden, y deja de haber tope.
        vm.prank(address(bridge));
        cage.setMaxDepositPerUser(address(pote), 0, REF);
        assertEq(pote.maxDeposit(client), type(uint256).max);
        assertEq(pote.maxMint(client), type(uint256).max);
    }

    function test_the_cap_order_is_governance_not_a_director_move() public {
        AstryumVaultV2 pote = _openPote();
        vm.prank(address(bridge));
        cage.cede(heir, uint64(block.timestamp + 1 days), REF);
        vm.prank(heir);
        vm.expectRevert(AstryumCage.NotAuthority.selector);
        cage.setMaxDepositPerUser(address(pote), 1e6, REF);
    }

    function test_the_pote_initcode_lives_in_a_data_contract_behind_a_STOP() public view {
        address code = poteDeployer.POTE_CODE();
        assertGt(code.code.length, 20_000);
        assertEq(uint8(code.code[0]), 0x00);
    }

    function test_a_pote_constructor_revert_bubbles_up_through_the_deployer() public {
        // Una jaula de familias (cobro hasta 100%) que pide un pote privado SIN puerta:
        // la jaula lo deja pasar, el constructor del pote revierte, y el motivo
        // llega entero a traves del create2 en assembly del deployer.
        AstryumCage fam = new AstryumCage(address(bridge), fxrp, registry, REF, treasury, FEE, 10_000, 0, poteDeployer, _allowed());
        vm.prank(councilPA);
        fxrp.approve(address(fam), type(uint256).max);
        vm.prank(address(bridge));
        vm.expectRevert(AstryumVaultV2.PrivatePoteNeedsGate.selector);
        fam.createPote(_p("fam", "fam", 0, 1000, 10_000, 0, address(0), _kineticOnly()), REF, councilPA);
    }

    function test_the_registry_enumerates_its_whitelist_with_live_state() public {
        assertEq(registry.venueCount(), 3, "setUp listo tres");
        (uint32 chainId, address target, AstryumRegistry.VenueEntry memory e) = registry.venueAt(0);
        assertEq(chainId, CHAIN);
        assertEq(target, address(kinetic));
        assertTrue(e.active);

        vm.prank(astryum);
        registry.removeVenue(CHAIN, address(kinetic));
        (,, e) = registry.venueAt(0);
        assertFalse(e.active);
        assertEq(e.activeAt, 0);
        assertEq(registry.venueCount(), 3, "retirar no borra de la lista: se ensena como retirada");

        vm.prank(astryum);
        registry.proposeVenue(CHAIN, address(kinetic), uint8(AstryumVault.VenueKind.CompoundV2));
        assertEq(registry.venueCount(), 3, "volver a proponerla no la duplica");
    }
}
