// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {AstryumVault} from "../src/AstryumVault.sol";
import {AstryumVaultV2, IVenueAsset, ICompoundUnderlying} from "../src/AstryumVaultV2.sol";
import {PoteParams} from "../src/PoteParams.sol";
import {AstryumRegistry} from "../src/AstryumRegistry.sol";

/**
 * Fork suite de la generación V2 contra los venues REALES de Flare mainnet.
 *
 * Por qué existe: la v2 añade en `_addVenue` una sonda de cordura que la v1 no
 * tenía — `underlying()` para un mercado Compound, `asset()` para un 4626 — y
 * hasta hoy esa sonda solo se había ejecutado contra mocks. Si la firma real de
 * Kinetic o de Firelight no responde lo que la sonda espera, **el pote no se
 * puede ni construir**: en la jaula eso significa que `createPote` revierte en
 * mainnet DESPUÉS de cobrar la fee de creación. Es un fallo barato de descartar
 * y caro de descubrir en vivo, así que se descarta aquí.
 *
 * Necesita red ([rpc_endpoints] flare en foundry.toml). Filtrar con
 * `forge test --no-match-contract Fork` sin conexión.
 */
contract AstryumVaultV2ForkTest is Test {
    // Flare mainnet — las mismas direcciones que backend/.env y los verify scripts.
    IERC20 constant FXRP = IERC20(0xAd552A648C74D49E10027AB8a618A3ad4901c5bE);
    address constant KINETIC_KFXRP_ISO = 0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3;
    address constant FIRELIGHT_STXRP = 0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3;

    address governor = makeAddr("governor");
    address council = makeAddr("council");
    address operator = makeAddr("operator");
    address client = makeAddr("client");
    address stranger = makeAddr("stranger");

    bytes32 constant REF = keccak256("politica-fork-v2");
    uint48 constant COOLDOWN_B = 72 hours;
    uint16 constant FLOOR = 1000;
    uint16 constant OPEN_CAP = 2000;

    AstryumRegistry registry;
    AstryumVaultV2 poteA; // síncrono: solo el ISO de Kinetic
    AstryumVaultV2 poteB; // cooldown: Kinetic + Firelight encolado

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

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("flare"));

        // El scanner, con timelock 0 para no tener que warpear en cada test: lo
        // que se prueba aquí es la SONDA del pote contra contratos reales, no el
        // timelock (que ya tiene su suite en AstryumCage.t.sol).
        registry = new AstryumRegistry(governor, 0);
        _list(KINETIC_KFXRP_ISO, AstryumVault.VenueKind.CompoundV2);
        _list(FIRELIGHT_STXRP, AstryumVault.VenueKind.ERC4626Queued);

        AstryumVault.InitialVenue[] memory initA = new AstryumVault.InitialVenue[](1);
        initA[0] = AstryumVault.InitialVenue(KINETIC_KFXRP_ISO, AstryumVault.VenueKind.CompoundV2);
        poteA = new AstryumVaultV2(FXRP, council, REF, registry, _p("Astryum Pote A v2", "apA2-FXRP", 0, FLOOR, OPEN_CAP, 0, address(0), initA));

        AstryumVault.InitialVenue[] memory initB = new AstryumVault.InitialVenue[](2);
        initB[0] = AstryumVault.InitialVenue(KINETIC_KFXRP_ISO, AstryumVault.VenueKind.CompoundV2);
        initB[1] = AstryumVault.InitialVenue(FIRELIGHT_STXRP, AstryumVault.VenueKind.ERC4626Queued);
        poteB = new AstryumVaultV2(FXRP, council, REF, registry, _p("Astryum Pote B v2", "apB2-FXRP", COOLDOWN_B, FLOOR, OPEN_CAP, 0, address(0), initB));

        // Whale-prank: el propio efectivo del kToken paga al actor del test.
        vm.prank(KINETIC_KFXRP_ISO);
        FXRP.transfer(client, 100_000e6);

        vm.startPrank(client);
        FXRP.approve(address(poteA), type(uint256).max);
        FXRP.approve(address(poteB), type(uint256).max);
        vm.stopPrank();

        vm.prank(council);
        poteA.cede(operator, uint64(block.timestamp + 30 days), REF);
        vm.prank(council);
        poteB.cede(operator, uint64(block.timestamp + 30 days), REF);
    }

    function _list(address target, AstryumVault.VenueKind kind) internal {
        vm.prank(governor);
        registry.proposeVenue(uint32(block.chainid), target, uint8(kind));
        registry.activateVenue(uint32(block.chainid), target); // permissionless
    }

    // ── LO QUE ESTE FICHERO EXISTE PARA DESCARTAR ────────────────────────────

    /**
     * La sonda de cordura, contra los contratos REALES, aislada de todo lo demás.
     * Si esto falla, `createPote` revierte en mainnet tras cobrar la fee — y el
     * mensaje dice exactamente qué devolvió el venue, para no depurar a ciegas.
     */
    function test_Fork_V2_RealVenuesAnswerTheSanityProbe() public view {
        address want = address(FXRP);

        address kineticUnderlying = ICompoundUnderlying(KINETIC_KFXRP_ISO).underlying();
        assertEq(kineticUnderlying, want, "Kinetic ISO: underlying() no es FXRP");

        address firelightAsset = IVenueAsset(FIRELIGHT_STXRP).asset();
        assertEq(firelightAsset, want, "Firelight stXRP: asset() no es FXRP");
    }

    /// Y la consecuencia: con esos venues reales, el pote V2 SE CONSTRUYE y los
    /// lleva dentro desde el nacimiento (el constructor los pasa por la sonda).
    function test_Fork_V2_BornWithRealVenues() public view {
        assertEq(poteA.venueCount(), 1);
        assertEq(poteB.venueCount(), 2);
        (address t0,,,) = poteB.venues(0);
        (address t1,,,) = poteB.venues(1);
        assertEq(t0, KINETIC_KFXRP_ISO);
        assertEq(t1, FIRELIGHT_STXRP);
        // Nacidos ya listos: el delay de 30 días es para los AÑADIDOS, no para
        // los de nacimiento (que el consejo aceptó al firmar la constitución).
        assertEq(poteA.totalAssets(), 0);
    }

    // ── El circuito completo, ahora en V2 ────────────────────────────────────

    /// Pote A contra el mercado real de Kinetic: entra dirigido, sale en UNA tx
    /// del holder — el desarme pega contra el `redeemUnderlying` de verdad.
    function test_Fork_V2_PoteA_KineticRoundTripAndSelfServiceRedeem() public {
        vm.prank(client);
        uint256 shares = poteA.deposit(50_000e6, client);

        vm.prank(operator);
        poteA.directTo(0, 40_000e6, REF);

        assertApproxEqRel(poteA.venueValue(0), 40_000e6, 0.001e18);
        assertApproxEqAbs(poteA.totalAssets(), 50_000e6, 50_000); // ±0.05 FXRP

        uint256 before = FXRP.balanceOf(client);
        vm.prank(client);
        uint256 got = poteA.redeem(shares, client, client);

        assertApproxEqAbs(got, 50_000e6, 50_000);
        assertEq(FXRP.balanceOf(client) - before, got);
        assertLe(poteA.venueValue(0), 50_000); // vaciado, polvo como mucho
    }

    /// El circuito de la demo contra la cola REAL de Firelight, en V2: pedir la
    /// salida quema las shares, pasa el tiempo, y cualquiera termina el claim.
    function test_Fork_V2_PoteB_FirelightFullExitCycle() public {
        vm.prank(client);
        uint256 shares = poteB.deposit(50_000e6, client);

        vm.prank(operator);
        poteB.directTo(1, 40_000e6, REF); // al stXRP real

        assertApproxEqRel(poteB.venueValue(1), 40_000e6, 0.001e18);

        uint256 period = ISTXRPPeriod(FIRELIGHT_STXRP).currentPeriod() + 1;
        vm.prank(client);
        uint256 ticketId = poteB.requestRedeem(shares, client);

        assertEq(poteB.balanceOf(client), 0);
        assertApproxEqRel(poteB.venueQueuedTotal(1), 40_000e6, 0.001e18);

        vm.warp(block.timestamp + COOLDOWN_B + 1);
        assertGe(ISTXRPPeriod(FIRELIGHT_STXRP).currentPeriod(), period + 1);

        uint256 before = FXRP.balanceOf(client);
        AstryumVault.VenueClaim[] memory claims = new AstryumVault.VenueClaim[](1);
        claims[0] = AstryumVault.VenueClaim(1, period);
        vm.prank(stranger); // el que termina no necesita permiso
        poteB.claimRedeem(ticketId, claims);

        assertApproxEqAbs(FXRP.balanceOf(client) - before, 50_000e6, 50_000);
        assertEq(poteB.earmarkedAssets(), 0);
        assertEq(poteB.venueQueuedTotal(1), 0);
    }

    // ── El suelo duro: el registro manda por encima del consejo ──────────────

    /**
     * El robo que en v1 SÍ era posible: el consejo propone su propio contrato,
     * espera 30 días y dirige el capital. En V2 no llega ni a proponerse — y ojo,
     * el destino de este test es un contrato REAL y legítimo (el propio token
     * FXRP): no hace falta que sea malicioso, basta con que no esté en la lista.
     */
    function test_Fork_V2_RegistryRefusesAnUnlistedRealContract() public {
        vm.prank(council);
        vm.expectRevert(abi.encodeWithSelector(AstryumVaultV2.VenueNotInRegistry.selector, address(FXRP)));
        poteA.proposeVenue(address(FXRP), AstryumVault.VenueKind.ERC4626, REF);
    }

    /// Y si Astryum lo retira, deja de poder añadirse a partir de ese instante
    /// (la baja es inmediata; las posiciones vivas no se tocan).
    function test_Fork_V2_RemovingFromRegistryClosesTheDoorForNewVenues() public {
        AstryumVault.InitialVenue[] memory none = new AstryumVault.InitialVenue[](0);
        AstryumVaultV2 fresh =
            new AstryumVaultV2(FXRP, council, REF, registry, _p("p", "p", 0, FLOOR, OPEN_CAP, 0, address(0), none));

        // Con el venue listado, proponer vale (queda a 30 días).
        vm.prank(council);
        fresh.proposeVenue(KINETIC_KFXRP_ISO, AstryumVault.VenueKind.CompoundV2, REF);

        vm.prank(governor);
        registry.removeVenue(uint32(block.chainid), KINETIC_KFXRP_ISO);

        AstryumVaultV2 after_ =
            new AstryumVaultV2(FXRP, council, REF, registry, _p("p", "p", 0, FLOOR, OPEN_CAP, 0, address(0), none));
        vm.prank(council);
        vm.expectRevert(
            abi.encodeWithSelector(AstryumVaultV2.VenueNotInRegistry.selector, KINETIC_KFXRP_ISO)
        );
        after_.proposeVenue(KINETIC_KFXRP_ISO, AstryumVault.VenueKind.CompoundV2, REF);
    }

    /**
     * El COMPLEMENTO del anterior, y la línea exacta de lo que la baja hace — que
     * es MENOS de lo que suena. El registro se consulta en `_addVenue` y en ningún
     * sitio más: `_allocate` no lo mira. Así que retirar un venue cierra la puerta
     * a los potes que aún no lo tienen, pero **NO corta el capital hacia un venue
     * que ya está dentro de un pote**: su director sigue pudiendo dirigir ahí.
     *
     * Este test está pegado al de arriba a propósito, para que nadie lea «baja
     * inmediata» y asuma una protección que el código no da. Lo que sí es cierto,
     * y se comprueba abajo: la baja nunca ATRAPA capital — `recall` sigue vivo, y
     * la salida del holder también.
     *
     * (Si se quisiera que la baja cortase de verdad la entrada, habría que
     * consultar el registro también en `_allocate` — y eso le daría a Astryum un
     * veto EN VIVO sobre cada movimiento de capital, que es superficie de
     * confianza nueva. Es decisión de producto, no un bug que arreglar a escondidas.)
     */
    function test_Fork_V2_RemovalDoesNOTStopCapitalIntoAVenueAlreadyInside() public {
        vm.prank(client);
        poteA.deposit(50_000e6, client);

        vm.prank(governor);
        registry.removeVenue(uint32(block.chainid), KINETIC_KFXRP_ISO);

        // Retirado del registro — y el director sigue dirigiendo capital ahí.
        vm.prank(operator);
        poteA.directTo(0, 10_000e6, REF);
        assertApproxEqRel(poteA.venueValue(0), 10_000e6, 0.001e18, "la baja NO corto la entrada");

        // Lo que la baja nunca hace es atrapar: recuperar sigue funcionando…
        vm.prank(operator);
        poteA.recall(0, 5_000e6, REF);
        assertApproxEqRel(poteA.venueValue(0), 5_000e6, 0.002e18);

        // …y la salida del holder tampoco depende del registro para nada.
        // (Las lecturas van ANTES del prank: una llamada externa dentro de los
        //  argumentos se comería el prank y redimiría el test, no el cliente.)
        uint256 shares = poteA.balanceOf(client);
        uint256 before = FXRP.balanceOf(client);
        vm.prank(client);
        poteA.redeem(shares, client, client);
        assertApproxEqAbs(FXRP.balanceOf(client) - before, 50_000e6, 50_000);
    }

    /**
     * El tipo importa: el mismo contrato real, listado como CompoundV2, no entra
     * como ERC4626. Cierra la puerta a que un venue aprobado se cuele por una
     * ruta de código que no le corresponde.
     */
    function test_Fork_V2_RegistryIsKindSpecificOnRealVenues() public {
        AstryumVault.InitialVenue[] memory none = new AstryumVault.InitialVenue[](0);
        AstryumVaultV2 fresh =
            new AstryumVaultV2(FXRP, council, REF, registry, _p("p", "p", 0, FLOOR, OPEN_CAP, 0, address(0), none));

        vm.prank(council);
        vm.expectRevert(
            abi.encodeWithSelector(AstryumVaultV2.VenueNotInRegistry.selector, KINETIC_KFXRP_ISO)
        );
        fresh.proposeVenue(KINETIC_KFXRP_ISO, AstryumVault.VenueKind.ERC4626, REF);
    }

    /// Una wallet (sin código) no es un venue, esté o no en el registro.
    function test_Fork_V2_AnEoaIsNeverAVenue() public {
        vm.prank(governor);
        registry.proposeVenue(uint32(block.chainid), stranger, uint8(AstryumVault.VenueKind.ERC4626));
        registry.activateVenue(uint32(block.chainid), stranger);

        AstryumVault.InitialVenue[] memory none = new AstryumVault.InitialVenue[](0);
        AstryumVaultV2 fresh =
            new AstryumVaultV2(FXRP, council, REF, registry, _p("p", "p", 0, FLOOR, OPEN_CAP, 0, address(0), none));

        vm.prank(council);
        vm.expectRevert(abi.encodeWithSelector(AstryumVaultV2.VenueHasNoCode.selector, stranger));
        fresh.proposeVenue(stranger, AstryumVault.VenueKind.ERC4626, REF);
    }
}

interface ISTXRPPeriod {
    function currentPeriod() external view returns (uint256);
    function withdrawalsOf(uint256 period, address owner) external view returns (uint256);
}
