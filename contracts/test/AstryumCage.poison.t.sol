// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AstryumCage, PoteDeployer} from "../src/AstryumCage.sol";
import {PoteParams} from "../src/PoteParams.sol";
import {AstryumVault} from "../src/AstryumVault.sol";
import {AstryumVaultV2} from "../src/AstryumVaultV2.sol";
import {AstryumRegistry} from "../src/AstryumRegistry.sol";
import {XrplCouncilBridgeV2} from "../src/XrplCouncilBridgeV2.sol";
import {MockFXRP, MockCompoundVenue} from "./mocks/Mocks.sol";

/**
 * Un contrato de cuatro líneas que cualquiera puede desplegar. No roba nada: solo
 * dice ser un pote que espera a esta jaula, y no responde a lo que la jaula le
 * pedirá después. Cuando `acceptPote` era permissionless, eso bastaba.
 */
contract PoisonPote {
    address public immutable CAGE;

    constructor(address cage) {
        CAGE = cage;
    }

    /// Lo ÚNICO que `acceptPote` comprobaba — y lo contesta el propio candidato.
    function pendingCouncil() external view returns (address) {
        return CAGE;
    }

    /// Y lo único que llamaba. No hace nada; no necesitaba hacerlo.
    function acceptCouncil() external {}

    // Deliberadamente NO existen `setConstitutionRef` ni `transferCouncil`:
    // sin fallback, cualquier llamada a ellas revierte.
}

/**
 * El envenenamiento del catálogo de la jaula — y por qué ya no se puede.
 *
 * `AstryumCage.acceptPote` era `external` sin restricción de llamante, con una
 * sola comprobación: `pendingCouncil() == address(this)`. La responde el propio
 * candidato, así que no probaba nada. Y `potes` SOLO CRECE — no existe función
 * de borrado en todo el contrato.
 *
 * Las dos operaciones de las que depende toda la historia de la v2 iteran ese
 * array sin `try/catch`:
 *   · `setConstitutionRef` — enmendar la constitución.
 *   · `executeSuccession`  — el upgrade de la jaula.
 *
 * Así que un extraño metía un contrato que revierte y la jaula quedaba
 * CONGELADA PARA SIEMPRE en su versión actual: sin poder enmendar su
 * constitución y sin poder sucederse. No se robaba capital —los potes y las
 * participaciones seguían intactos— pero se perdía justo la propiedad por la que
 * existe la v2. Coste del ataque: un despliegue. Sin permisos, sin esperar, sin
 * capital.
 *
 * Arreglo: adoptar un pote es un acto de GOBIERNO (`onlyAuthority`). Esta suite
 * es la alarma que salta si alguien vuelve a abrir esa puerta.
 */
contract AstryumCagePoisonTest is Test {
    uint32 constant CHAIN = 31337;
    bytes32 constant REF = bytes32(uint256(0x11));
    bytes32 constant NEW_REF = bytes32(uint256(0x22));
    uint256 constant FEE = 0;

    MockFXRP fxrp;
    MockCompoundVenue kinetic;
    AstryumRegistry registry;
    PoteDeployer poteDeployer;
    XrplCouncilBridgeV2 bridge;
    AstryumCage cage;

    address astryum = makeAddr("astryum");
    address treasury = makeAddr("treasury");
    address councilPA = makeAddr("councilPA");
    address stranger = makeAddr("stranger"); // ni consejo, ni Astryum, ni nada

    function setUp() public {
        fxrp = new MockFXRP();
        kinetic = new MockCompoundVenue(fxrp);

        registry = new AstryumRegistry(astryum, 0);
        vm.prank(astryum);
        registry.proposeVenue(CHAIN, address(kinetic), uint8(AstryumVault.VenueKind.CompoundV2));
        registry.activateVenue(CHAIN, address(kinetic));

        poteDeployer = new PoteDeployer();
        bridge = new XrplCouncilBridgeV2(keccak256("rCouncil"), bytes32("XRP"), keccak256("rAnchor"));
        cage = new AstryumCage(
            address(bridge), fxrp, registry, REF, treasury, FEE, 2000, 0, poteDeployer, _allowed()
        );
        bridge.bind(address(cage));
    }

    function _allowed() internal view returns (AstryumCage.Target[] memory list) {
        list = new AstryumCage.Target[](1);
        list[0] = AstryumCage.Target({chainId: CHAIN, target: address(kinetic)});
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

    function _openPote() internal returns (AstryumVaultV2) {
        vm.prank(address(bridge));
        return AstryumVaultV2(
            cage.createPote(_p("Open", "op-FXRP", 0, 1000, 2000, 0, address(0), _kineticOnly()), REF, councilPA)
        );
    }

    // ── 1. La puerta, cerrada ───────────────────────────────────────────────

    function test_poison_a_stranger_can_NO_LONGER_push_a_junk_pote() public {
        _openPote();
        assertEq(cage.poteCount(), 1);

        PoisonPote poison = new PoisonPote(address(cage));
        vm.prank(stranger);
        vm.expectRevert(AstryumCage.NotAuthority.selector);
        cage.acceptPote(address(poison));

        assertEq(cage.poteCount(), 1, "el catalogo no lo escribe un extrano");
        assertFalse(cage.isMyPote(address(poison)));
    }

    /// Astryum tampoco: el catálogo es del consejo, y de nadie más.
    function test_poison_not_even_astryum_can_push_a_pote() public {
        PoisonPote poison = new PoisonPote(address(cage));
        vm.prank(astryum);
        vm.expectRevert(AstryumCage.NotAuthority.selector);
        cage.acceptPote(address(poison));
    }

    // ── 2. Y por eso la constitución se sigue pudiendo enmendar ─────────────

    function test_poison_constitution_amendment_survives_the_attempt() public {
        _openPote();

        PoisonPote poison = new PoisonPote(address(cage));
        vm.prank(stranger);
        vm.expectRevert(AstryumCage.NotAuthority.selector);
        cage.acceptPote(address(poison));

        // El bucle solo recorre potes de verdad: enmendar sigue funcionando.
        vm.prank(address(bridge));
        cage.setConstitutionRef(NEW_REF, REF);
        assertEq(cage.constitutionRef(), NEW_REF);
    }

    // ── 3. Y la jaula se sigue pudiendo suceder ────────────────────────────

    function test_poison_succession_survives_the_attempt() public {
        AstryumVaultV2 pote = _openPote();

        AstryumCage next = new AstryumCage(
            address(bridge), fxrp, registry, REF, treasury, FEE, 2000, 0, poteDeployer, _allowed()
        );
        vm.prank(astryum);
        registry.proposeCageCode(address(next).codehash);
        registry.activateCageCode(address(next).codehash);

        vm.prank(address(bridge));
        cage.proposeSuccessor(address(next), REF);
        vm.warp(block.timestamp + 30 days);

        PoisonPote poison = new PoisonPote(address(cage));
        vm.prank(stranger);
        vm.expectRevert(AstryumCage.NotAuthority.selector);
        cage.acceptPote(address(poison));

        vm.prank(address(bridge));
        cage.executeSuccession(REF);

        assertTrue(cage.succeeded());
        assertEq(bridge.vault(), address(next), "el bridge se re-ato: el upgrade sigue vivo");
        assertEq(pote.pendingCouncil(), address(next));
    }

    // ── 4. La adopción legítima sigue siendo posible — por orden del consejo ─

    function test_poison_the_council_still_adopts_its_own_potes() public {
        AstryumVaultV2 pote = _openPote();

        AstryumCage next = new AstryumCage(
            address(bridge), fxrp, registry, REF, treasury, FEE, 2000, 0, poteDeployer, _allowed()
        );
        vm.prank(astryum);
        registry.proposeCageCode(address(next).codehash);
        registry.activateCageCode(address(next).codehash);

        vm.prank(address(bridge));
        cage.proposeSuccessor(address(next), REF);
        vm.warp(block.timestamp + 30 days);
        vm.prank(address(bridge));
        cage.executeSuccession(REF);

        // El bridge ya habla con la nueva jaula: su consejo ordena la adopción.
        vm.prank(address(bridge));
        next.acceptPote(address(pote));

        assertEq(pote.council(), address(next));
        assertTrue(next.isMyPote(address(pote)));
    }
}
