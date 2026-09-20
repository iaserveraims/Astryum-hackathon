// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PasskeyAccountFactory} from "../src/PasskeyAccount.sol";

/**
 * Deploy the PasskeyAccountFactory — the counterfactual account factory for
 * the user side (Face ID). Onboarding N clients writes nothing; each account
 * deploys lazily on first use (the relayer calls create() before executeBatch).
 *
 * No params, no owner, no keys inside. One per network.
 *
 * Coston2:  forge script script/DeployPasskeyFactory.s.sol --rpc-url coston2 \
 *             --broadcast --private-key $DEPLOYER_KEY
 * Mainnet:  same with --rpc-url flare (needs RIP-7212 live — verified on Flare
 *           mainnet 2026-08-20/21).
 *
 * After deploy: set ASTRYUM_PASSKEY_FACTORY in the backend env and verify the
 * source on the explorer. The relayer (PASSKEY_RELAYER_PK) uses it to lazy-
 * deploy user accounts.
 */
contract DeployPasskeyFactory is Script {
    function run() external {
        vm.startBroadcast();
        PasskeyAccountFactory factory = new PasskeyAccountFactory();
        vm.stopBroadcast();

        console.log("PasskeyAccountFactory: %s", address(factory));
        console.log("Next: set ASTRYUM_PASSKEY_FACTORY in the backend env, verify the source,");
        console.log("and fund PASSKEY_RELAYER_PK with FLR (the operator pays gas for its users).");
    }
}
