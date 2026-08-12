// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {LegacyStackFactory} from "../src/LegacyStackFactory.sol";

/**
 * Deploy the factory that lets every Legacy be born with its OWN cage.
 *
 * ONE factory per network, and it is the only param that matters: FDC_SOURCE_ID
 * is immutable in the factory and inherited by every bridge born from it. A
 * factory deployed on mainnet with "testXRP" would produce bridges that verify
 * no proof ever, and no function could fix them.
 *
 * Env:
 *   FDC_SOURCE_ID   "XRP" (Flare mainnet) | "testXRP" (Coston2)
 *   MAC_FALLBACK    MasterAccountController for when the registry does not list
 *                   it (mainnet: 0x434936d47503353f06750Db1A444DBDC5F0AD37c —
 *                   verify LIVE against the smart-accounts docs the same day).
 *                   The registry's answer always wins when present.
 *
 * Coston2:  forge script script/DeployLegacyStackFactory.s.sol --rpc-url coston2 \
 *             --broadcast --private-key $DEPLOYER_KEY
 * Mainnet:  same with --rpc-url flare, founder gate first (contracts/README.md).
 *
 * After deploy: set LEGACY_FACTORY_ADDRESS in the backend env and verify the
 * source on the explorer. The deployer keeps NO power over the factory — it has
 * no owner, holds no funds, and cannot touch a cage once born.
 */
contract DeployLegacyStackFactory is Script {
    function run() external {
        string memory source = vm.envString("FDC_SOURCE_ID");
        bytes32 sourceId = bytes32(bytes(source));
        address macFallback = vm.envAddress("MAC_FALLBACK");

        console.log("=== LegacyStackFactory deploy ===");
        console.log("FDC source (IMMUTABLE for every bridge born here): %s", source);
        console.log("MAC fallback (registry wins when it lists the name): %s", macFallback);

        vm.startBroadcast();
        LegacyStackFactory factory = new LegacyStackFactory(sourceId, macFallback);
        vm.stopBroadcast();

        console.log("LegacyStackFactory: %s", address(factory));
        console.log("LegacyVaultDeployer: %s  (born with it, callable only by it)", address(factory.DEPLOYER()));
        console.log("Next: set LEGACY_FACTORY_ADDRESS in the backend env, verify both sources on the");
        console.log("explorer, and check factory.SOURCE_ID() reads what you meant.");
    }
}
