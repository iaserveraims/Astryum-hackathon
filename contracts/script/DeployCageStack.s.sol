// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AstryumRegistry} from "../src/AstryumRegistry.sol";
import {AstryumCageFactory} from "../src/AstryumCageFactory.sol";
import {PoteDeployer} from "../src/AstryumCage.sol";

/**
 * Despliega la infraestructura de la jaula v2 — lo ÚNICO que Astryum despliega.
 * Las jaulas y los potes nacen después, cada uno desde su propia cuenta XRPL,
 * sin llave de Astryum en ningún sitio.
 *
 * Tres contratos, en orden:
 *   1. AstryumRegistry(governor, timelock) — el scanner on-chain: venues,
 *      destinos remotos y códigos de jaula aprobados. Alta con timelock, baja
 *      inmediata. Astryum gobierna esto y nada más.
 *   2. PoteDeployer() — el bytecode del pote v2, compartido por todas las
 *      jaulas (EIP-170). Sin dueño.
 *   3. AstryumCageFactory(sourceId, macFallback, registry, treasury, fee,
 *      poteDeployer) — una cuenta XRPL, una jaula. Sin dueño, sin fondos, sin
 *      pausa, sin upgrade. Nace con su CageDeployer.
 *
 * Después, con la llave del GOVERNOR (fuera de este script, con timelock):
 *   registry.proposeVenue(14, KINETIC_KFXRP_ISO, 1)   // CompoundV2
 *   … y los demás venues sin liquidación; activateVenue() tras el timelock.
 *   (El código de jaula solo hace falta aprobarlo para una SUCESIÓN.)
 *
 * Env:
 *   FDC_SOURCE_ID        "XRP" (mainnet) | "testXRP" (Coston2) — inmutable en cada bridge
 *   MAC_FALLBACK         MasterAccountController de respaldo (el registry de Flare manda)
 *   REGISTRY_GOVERNOR    quién gobierna el scanner (multisig/tesorería de Astryum)
 *   REGISTRY_TIMELOCK    segundos que espera un alta (p. ej. 172800 = 48 h)
 *   TREASURY             a quién va la fee de creación de potes (directa, sin pasar por la jaula)
 *   CREATION_FEE_UBA     fee por pote en unidades base del activo (FXRP: 6 decimales)
 *   MAX_PAYEE_BPS_ALLOWED tope de payees que una jaula puede dar a sus potes (2000 hoy:
 *                        exchanges y managers; un pote con puerta KYC tiene terceros)
 *   ORDER_ANCHOR         la r-address del ANCLA donde toda orden tiene que aterrizar
 *                        (DepositAuth + AuthorizeCredentials la hacen puerta). Su
 *                        keccak256 queda inmutable en cada bridge de esta generación.
 *
 * Coston2:  forge script script/DeployCageStack.s.sol --rpc-url coston2 --broadcast --private-key $DEPLOYER_KEY
 * Mainnet:  igual con --rpc-url flare, tras la puerta del fundador (contracts/README.md).
 *
 * Después: ASTRYUM_CAGE_FACTORY_ADDRESS en el backend, y verificar en el explorador
 * los CINCO fuentes (registry, poteDeployer, factory, cageDeployer, y el primer
 * bridge/jaula cuando nazcan). El deployer de la tx no conserva poder alguno sobre
 * la factory; sobre el registro, solo el governor que aquí se nombra.
 */
contract DeployCageStack is Script {
    function run() external {
        string memory source = vm.envString("FDC_SOURCE_ID");
        bytes32 sourceId = bytes32(bytes(source));
        address macFallback = vm.envAddress("MAC_FALLBACK");
        address governor = vm.envAddress("REGISTRY_GOVERNOR");
        uint64 timelock = uint64(vm.envUint("REGISTRY_TIMELOCK"));
        address treasury = vm.envAddress("TREASURY");
        uint256 creationFee = vm.envUint("CREATION_FEE_UBA");
        // Política de cobro de esta generación: 2000 para exchanges y managers (un
        // pote con puerta KYC tiene depositantes terceros). Una factory de familias
        // futura podrá fijar 10000.
        uint16 maxPayeeBpsAllowed = uint16(vm.envUint("MAX_PAYEE_BPS_ALLOWED"));
        // Los primeros N potes de cada jaula solo cuestan el gas; del siguiente en
        // adelante, CREATION_FEE_UBA a la tesorería (decisión 27-ago: 3).
        uint16 freePotesPerCage = uint16(vm.envUint("FREE_POTES_PER_CAGE"));
        // El ancla: la cuenta XRPL donde toda orden tiene que aterrizar. Su hash
        // (keccak256 de la r-address, sin lowercasing — spec FDC) queda inmutable en
        // cada bridge nacido de esta factory. Verificar la r-address ese mismo día.
        string memory orderAnchor = vm.envString("ORDER_ANCHOR");
        bytes32 anchorHash = keccak256(bytes(orderAnchor));

        console.log("=== Jaula v2: infraestructura de Astryum ===");
        console.log("FDC source (IMMUTABLE for every bridge born here): %s", source);
        console.log("Registry governor: %s  timelock: %s s", governor, timelock);
        console.log("Treasury: %s  creation fee (UBA): %s", treasury, creationFee);
        console.log("Free potes per cage: %s", freePotesPerCage);

        vm.startBroadcast();
        AstryumRegistry registry = new AstryumRegistry(governor, timelock);
        PoteDeployer poteDeployer = new PoteDeployer();
        AstryumCageFactory factory = new AstryumCageFactory(
            sourceId, macFallback, registry, treasury, creationFee, maxPayeeBpsAllowed, freePotesPerCage, anchorHash, poteDeployer
        );
        vm.stopBroadcast();

        console.log("AstryumRegistry:    %s", address(registry));
        console.log("PoteDeployer:       %s  (shared; salt binds the caller)", address(poteDeployer));
        console.log("AstryumCageFactory: %s", address(factory));
        console.log("CageDeployer:       %s  (born with the factory, callable only by it)", address(factory.CAGE_DEPLOYER()));
        console.log("Next: ASTRYUM_CAGE_FACTORY_ADDRESS in the backend env; with the governor key, proposeVenue()");
        console.log("for every no-liquidation venue and activateVenue() after the timelock; verify all sources.");
    }
}
