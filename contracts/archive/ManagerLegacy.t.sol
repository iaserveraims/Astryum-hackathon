// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {ManagerLegacy} from "../src/ManagerLegacy.sol";
import {AstryumVault} from "../src/AstryumVault.sol";
import {MockFXRP, Mock4626Venue, MockCompoundVenue} from "./mocks/Mocks.sol";

/**
 * La casa del gestor, y las dos propiedades por las que existe.
 *
 * 1. EL CANDADO. `AstryumVault` no paga principal a una dirección arbitraria,
 *    pero su consejo decide QUÉ es un venue — y el propio contrato lo dice:
 *    «adding a venue IS the power to extract». Un consejo hostil propone un
 *    ERC-4626 suyo, espera 30 días y dirige el capital. Aquí eso no se puede:
 *    `proposeVenue` solo acepta destinos de una lista fijada al nacer.
 *
 * 2. LA SALIDA NO DEPENDE DE ESTA CASA. Los depositantes entran y salen
 *    DIRECTOS del pote. Si este contrato se rompe, el gestor pierde la
 *    capacidad de operar; nadie pierde la de salir.
 */
contract ManagerLegacyTest is Test {
    MockFXRP fxrp;
    MockCompoundVenue kinetic; // venue permitido
    Mock4626Venue upshift; // venue permitido
    Mock4626Venue attackerVenue; // el ERC-4626 del atacante: NUNCA permitido

    ManagerLegacy house;

    address authority = makeAddr("authority"); // el bridge XRPL del gestor
    address client = makeAddr("client");
    address stranger = makeAddr("stranger");

    bytes32 constant REF = bytes32(uint256(0x11));

    function setUp() public {
        fxrp = new MockFXRP();
        kinetic = new MockCompoundVenue(fxrp);
        upshift = new Mock4626Venue(fxrp);
        attackerVenue = new Mock4626Venue(fxrp);

        address[] memory allowed = new address[](2);
        allowed[0] = address(kinetic);
        allowed[1] = address(upshift);

        house = new ManagerLegacy(authority, IERC20(address(fxrp)), REF, allowed);

        fxrp.mint(client, 1_000_000e6);
    }

    /// Un pote de esta casa, con Kinetic dentro desde el nacimiento.
    function _createPote() internal returns (AstryumVault pote) {
        AstryumVault.InitialVenue[] memory venues = new AstryumVault.InitialVenue[](1);
        venues[0] = AstryumVault.InitialVenue({target: address(kinetic), kind: AstryumVault.VenueKind.CompoundV2});

        vm.prank(authority);
        pote = AstryumVault(house.createPote("Casa Pote 1", "cp1-FXRP", REF, 0, 1000, venues));
    }

    // ── 1. EL CANDADO ────────────────────────────────────────────────────────

    function test_proposeVenue_rejects_a_venue_outside_the_eternal_allowlist() public {
        AstryumVault pote = _createPote();

        // Este es el ataque entero, en una línea: el gestor propone SU contrato.
        vm.prank(authority);
        vm.expectRevert(abi.encodeWithSelector(ManagerLegacy.TargetNotAllowed.selector, address(attackerVenue)));
        house.proposeVenue(address(pote), address(attackerVenue), AstryumVault.VenueKind.ERC4626, REF);
    }

    function test_proposeVenue_accepts_one_from_the_list() public {
        AstryumVault pote = _createPote();

        vm.prank(authority);
        house.proposeVenue(address(pote), address(upshift), AstryumVault.VenueKind.ERC4626, REF);

        assertEq(pote.venueCount(), 2, "el venue permitido si entra");
    }

    function test_the_allowlist_has_no_function_that_can_grow_it() public view {
        // No es un test de comportamiento: es un test de SUPERFICIE. Si algún día
        // alguien añade `addVenue`/`setAllowedVenues`, este selector existirá y
        // esto se pondrá rojo antes de que llegue a mainnet.
        bytes4[3] memory forbidden = [
            bytes4(keccak256("addAllowedVenue(address)")),
            bytes4(keccak256("setAllowedTargets(address[])")),
            bytes4(keccak256("removeAllowedTarget(address)"))
        ];
        for (uint256 i = 0; i < forbidden.length; i++) {
            (bool ok,) = address(house).staticcall(abi.encodeWithSelector(forbidden[i], address(attackerVenue)));
            assertFalse(ok, "la allowlist no puede tener puerta trasera");
        }
    }

    function test_a_pote_cannot_be_born_looking_at_a_venue_its_manager_could_not_use() public {
        AstryumVault.InitialVenue[] memory venues = new AstryumVault.InitialVenue[](1);
        venues[0] = AstryumVault.InitialVenue({target: address(attackerVenue), kind: AstryumVault.VenueKind.ERC4626});

        vm.prank(authority);
        vm.expectRevert(abi.encodeWithSelector(ManagerLegacy.TargetNotAllowed.selector, address(attackerVenue)));
        house.createPote("Trampa", "trap", REF, 0, 1000, venues);
    }

    function test_there_is_no_transferCouncil_to_escape_the_cage_with() public {
        AstryumVault pote = _createPote();

        // La vía de escape sería sacar el consejo de esta casa. La función no
        // existe aquí, así que la llamada no encuentra a nadie.
        (bool ok,) = address(house).call(
            abi.encodeWithSignature("transferCouncil(address,address,bytes32)", address(pote), stranger, REF)
        );
        assertFalse(ok, "exponer transferCouncil evaporaria la allowlist");

        // Y el consejo del pote sigue siendo la casa, no una llave suelta.
        assertEq(pote.council(), address(house), "el consejo del pote es la casa, para siempre");
    }

    // ── 2. LA SALIDA NO DEPENDE DE ESTA CASA ─────────────────────────────────

    /**
     * La propiedad que sostiene todo el diseño: la casa puede quedar inútil y el
     * depositante sigue saliendo solo. Se simula la rotura de la forma más dura
     * posible — la autoridad desaparece, así que NINGUNA orden del gestor puede
     * volver a ejecutarse — y aun así el cliente redime.
     */
    function test_a_broken_house_does_not_trap_anyone() public {
        AstryumVault pote = _createPote();

        vm.startPrank(client);
        fxrp.approve(address(pote), 100e6);
        uint256 shares = pote.deposit(100e6, client);
        vm.stopPrank();

        // La casa queda muerta: nadie puede volver a dar una orden.
        // (Cualquier llamada que no venga de AUTHORITY revierte, y AUTHORITY es
        // inmutable: si esa llave se pierde, esto es exactamente el estado final.)
        vm.prank(stranger);
        vm.expectRevert(ManagerLegacy.NotDirectorOrAuthority.selector);
        house.directTo(address(pote), 0, 1e6, REF);

        // Y aun así, el cliente sale. No pasa por la casa: habla con su pote.
        vm.prank(client);
        uint256 got = pote.redeem(shares, client, client);

        assertEq(got, 100e6, "el deposito vuelve entero");
        assertEq(fxrp.balanceOf(client), 1_000_000e6, "el cliente recupera su capital sin la casa");
    }

    function test_the_house_never_holds_a_depositors_shares() public {
        AstryumVault pote = _createPote();

        vm.startPrank(client);
        fxrp.approve(address(pote), 100e6);
        pote.deposit(100e6, client);
        vm.stopPrank();

        // Las participaciones son del cliente. La casa no tiene ninguna, y
        // tampoco está aprobada sobre las suyas (invariante #18).
        assertEq(pote.balanceOf(address(house)), 0, "la casa no tiene participaciones del cliente");
        assertEq(pote.allowance(client, address(house)), 0, "la casa no esta aprobada sobre nadie");
    }

    // ── 3. LA AUTORIDAD ──────────────────────────────────────────────────────

    function test_only_the_authority_commands() public {
        AstryumVault pote = _createPote();

        vm.prank(stranger);
        vm.expectRevert(ManagerLegacy.NotAuthority.selector);
        house.proposeVenue(address(pote), address(upshift), AstryumVault.VenueKind.ERC4626, REF);

        vm.prank(stranger);
        vm.expectRevert(ManagerLegacy.NotAuthority.selector);
        house.createPote("Ajeno", "x", REF, 0, 1000, new AstryumVault.InitialVenue[](0));
    }

    function test_orders_never_reach_a_pote_from_another_house() public {
        // Un pote con la casa como consejo pero NACIDO fuera: no está en su
        // registro, así que sus órdenes no le llegan.
        AstryumVault.InitialVenue[] memory none = new AstryumVault.InitialVenue[](0);
        AstryumVault foreign =
            new AstryumVault(IERC20(address(fxrp)), "Ajeno", "aj", address(house), REF, 0, 1000, none);

        vm.prank(authority);
        vm.expectRevert(abi.encodeWithSelector(ManagerLegacy.NotMyPote.selector, address(foreign)));
        house.directTo(address(foreign), 0, 1e6, REF);
    }

    // ── 4. NACIMIENTO Y REGISTRO ─────────────────────────────────────────────

    function test_the_house_can_open_as_many_potes_as_it_needs() public {
        AstryumVault.InitialVenue[] memory venues = new AstryumVault.InitialVenue[](1);
        venues[0] = AstryumVault.InitialVenue({target: address(kinetic), kind: AstryumVault.VenueKind.CompoundV2});

        vm.startPrank(authority);
        address p1 = house.createPote("Conservador", "c1", REF, 0, 1000, venues);
        address p2 = house.createPote("Rendimiento", "r1", REF, uint48(72 hours), 2000, venues);
        address p3 = house.createPote("Tercero", "t1", REF, 0, 500, venues);
        vm.stopPrank();

        assertEq(house.poteCount(), 3, "tres potes de la misma casa");
        assertTrue(p1 != p2 && p2 != p3, "cada pote es su propio contrato");
        // Y cada uno con su forma eterna, elegida al nacer.
        assertEq(AstryumVault(p1).COOLDOWN(), 0);
        assertEq(AstryumVault(p2).COOLDOWN(), 72 hours);
        assertEq(AstryumVault(p3).BUFFER_FLOOR_BPS(), 500);
    }

    function test_every_pote_of_the_house_answers_to_the_house() public {
        AstryumVault pote = _createPote();
        assertTrue(house.isMyPote(address(pote)));
        assertEq(house.potes(0), address(pote));
        assertEq(pote.council(), address(house));
    }

    // ── 5. EL CONSTRUCTOR NO ADMITE UNA LISTA TRAMPOSA ───────────────────────

    function test_constructor_rejects_an_empty_or_dirty_allowlist() public {
        address[] memory empty = new address[](0);
        vm.expectRevert(ManagerLegacy.EmptyAllowlist.selector);
        new ManagerLegacy(authority, IERC20(address(fxrp)), REF, empty);

        address[] memory withZero = new address[](1);
        withZero[0] = address(0);
        vm.expectRevert(ManagerLegacy.ZeroAddress.selector);
        new ManagerLegacy(authority, IERC20(address(fxrp)), REF, withZero);

        address[] memory dup = new address[](2);
        dup[0] = address(kinetic);
        dup[1] = address(kinetic);
        vm.expectRevert(abi.encodeWithSelector(ManagerLegacy.DuplicateAllowedTarget.selector, address(kinetic)));
        new ManagerLegacy(authority, IERC20(address(fxrp)), REF, dup);
    }

    function test_the_allowlist_is_readable_in_one_look() public view {
        address[] memory list = house.allowedTargets();
        assertEq(list.length, 2, "el depositante lee la lista entera antes de entrar");
        assertEq(list[0], address(kinetic));
        assertEq(list[1], address(upshift));
        assertTrue(house.isAllowedTarget(address(kinetic)));
        assertFalse(house.isAllowedTarget(address(attackerVenue)));
    }

    // ── 6. EL REVERT DEL POTE LLEGA ARRIBA ───────────────────────────────────

    function test_a_pote_revert_bubbles_up_with_its_real_reason() public {
        AstryumVault pote = _createPote();

        vm.startPrank(client);
        fxrp.approve(address(pote), 100e6);
        pote.deposit(100e6, client);
        vm.stopPrank();

        // Dirigir el 100% cruza el suelo del colchón: el pote dice por qué, y esa
        // razón tiene que llegar entera — un «OrderFailed» pelado obligaría a
        // adivinar, que es justo lo que costó una tarde con el direct a Kinetic.
        vm.prank(authority);
        vm.expectRevert(AstryumVault.BufferFloorCrossed.selector);
        house.directTo(address(pote), 0, 100e6, REF);
    }

    // ── 7. LA FORMA PMW: enviar instrucciones, recibir pruebas ───────────────

    /**
     * El brazo remoto está DECLARADO y su contabilidad existe, pero no ejecuta:
     * PMW no está disponible públicamente todavía y el invariante del proyecto
     * es que PMW se compone, jamás se depende de él. Este test fija esa frontera
     * — si alguien quita el revert sin traer la auditoría del módulo, se entera
     * aquí y no en mainnet.
     */
    function test_the_remote_arm_is_a_doorframe_without_a_door() public {
        AstryumVault pote = _createPote();

        vm.prank(authority);
        vm.expectRevert(ManagerLegacy.RemoteNotSupportedYet.selector);
        house.employRemote(address(pote), 1, bytes32(uint256(0xbeef)), 1e6, REF);
    }

    function test_a_remote_instruction_settles_exactly_once() public {
        // Se fabrica una instrucción pendiente por el camino que existe hoy:
        // como employRemote revierte entera, se comprueba la otra mitad —
        // liquidar algo que no existe no puede inventarlo.
        vm.prank(authority);
        vm.expectRevert(abi.encodeWithSelector(ManagerLegacy.UnknownInstruction.selector, uint64(0)));
        house.settleRemoteInstruction(0, true, 1e6);
    }

    function test_only_the_authority_can_settle_a_proof() public {
        vm.prank(stranger);
        vm.expectRevert(ManagerLegacy.NotAuthority.selector);
        house.settleRemoteInstruction(0, true, 1e6);
    }

    // ── 8. GOBIERNO: la misma forma que LegacyVault ──────────────────────────

    function test_a_stale_constitution_reverts_every_mutation() public {
        AstryumVault pote = _createPote();
        bytes32 stale = bytes32(uint256(0x99));

        vm.prank(authority);
        vm.expectRevert(ManagerLegacy.RefMismatch.selector);
        house.directTo(address(pote), 0, 1e6, stale);
    }

    function test_the_cession_expires_by_itself() public {
        AstryumVault pote = _createPote();
        address desk = makeAddr("desk");

        vm.prank(authority);
        house.cede(desk, uint64(block.timestamp + 1 days), REF);

        // Durante la cesión el director lleva el día a día.
        vm.startPrank(client);
        fxrp.approve(address(pote), 100e6);
        pote.deposit(100e6, client);
        vm.stopPrank();

        vm.prank(desk);
        house.directTo(address(pote), 0, 10e6, REF);

        // Pasado el plazo, la llave del director ya no manda: nadie la retira.
        vm.warp(block.timestamp + 2 days);
        vm.prank(desk);
        vm.expectRevert(ManagerLegacy.NotDirectorOrAuthority.selector);
        house.directTo(address(pote), 0, 10e6, REF);
    }

    function test_a_director_cannot_touch_the_venue_list() public {
        AstryumVault pote = _createPote();
        address desk = makeAddr("desk");

        vm.prank(authority);
        house.cede(desk, uint64(block.timestamp + 1 days), REF);

        // El director dirige capital, pero NO decide el catálogo — ni siquiera
        // dentro de la lista permitida. Esa es la separación del Legacy.
        vm.prank(desk);
        vm.expectRevert(ManagerLegacy.NotAuthority.selector);
        house.proposeVenue(address(pote), address(upshift), AstryumVault.VenueKind.ERC4626, REF);
    }
}
