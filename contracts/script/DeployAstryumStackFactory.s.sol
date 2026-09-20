// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AstryumStackFactory} from "../src/AstryumStackFactory.sol";

/**
 * Deploy the institutional factory: every policy pote is born from here, by
 * its OWN XRPL council, with no Astryum key anywhere (rule 7.4).
 *
 * ONE factory per network. FDC_SOURCE_ID is immutable in the factory and
 * inherited by every bridge born from it — a mainnet factory with "testXRP"
 * would produce bridges that verify no proof ever, and nothing could fix them.
 *
 * Env:
 *   FDC_SOURCE_ID   "XRP" (Flare mainnet) | "testXRP" (Coston2)
 *   MAC_FALLBACK    MasterAccountController for when the registry does not list
 *                   it (verify LIVE against the smart-accounts docs the same
 *                   day). The registry's answer always wins when present.
 *
 * Coston2:  forge script script/DeployAstryumStackFactory.s.sol --rpc-url coston2 \
 *             --broadcast --private-key $DEPLOYER_KEY
 * Mainnet:  same with --rpc-url flare, founder gate first (contracts/README.md).
 *
 * After deploy: set ASTRYUM_FACTORY_ADDRESS in the backend env and verify BOTH
 * sources on the explorer (factory + its deployer). The deployer of the tx
 * keeps NO power — the factory has no owner, holds no funds, and cannot touch
 * a pote once born. Pote creation itself is a separate, council-signed XRPL
 * ceremony (create + genesis deposit in one batch, addresses predicted first).
 */
contract DeployAstryumStackFactory is Script {
    function run() external {
        string memory source = vm.envString("FDC_SOURCE_ID");
        bytes32 sourceId = bytes32(bytes(source));
        address macFallback = vm.envAddress("MAC_FALLBACK");

        console.log("=== AstryumStackFactory deploy ===");
        console.log("FDC source (IMMUTABLE for every bridge born here): %s", source);
        console.log("MAC fallback (registry wins when it lists the name): %s", macFallback);

        vm.startBroadcast();
        AstryumStackFactory factory = new AstryumStackFactory(sourceId, macFallback);
        vm.stopBroadcast();

        console.log("AstryumStackFactory: %s", address(factory));
        console.log("AstryumVaultDeployer: %s  (born with it, callable only by it)", address(factory.DEPLOYER()));
        console.log("Next: set ASTRYUM_FACTORY_ADDRESS in the backend env, verify both sources on the");
        console.log("explorer, and check factory.SOURCE_ID() reads what you meant.");
    }
}
