// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ExchangeKycRegistry} from "../src/ExchangeKycRegistry.sol";

/**
 * Despliega el ExchangeKycRegistry de UN partner/exchange (X2 de la revisión).
 * El admin es SUYO: aprueba/revoca receivers y ata sus destination
 * tags; Astryum ni firma ni administra. Un gestor apunta su pote a este
 * registro con la orden `set-user-gate` — desde entonces el propio pote
 * rechaza depósitos de receivers no aprobados. Las salidas jamás se bloquean.
 *
 * Env:
 *   KYC_ADMIN   la wallet EVM del admin del registro (el exchange/partner;
 *               en la demo, la del fundador)
 *
 * Mainnet:  forge script script/DeployExchangeKycRegistry.s.sol --rpc-url flare --broadcast --private-key $DEPLOYER_KEY
 * (El deployer no conserva ningún poder: todo el gobierno es del admin.)
 */
contract DeployExchangeKycRegistry is Script {
    function run() external {
        address admin = vm.envAddress("KYC_ADMIN");
        console.log("=== ExchangeKycRegistry ===");
        console.log("Admin (the exchange, NOT Astryum): %s", admin);

        vm.startBroadcast();
        ExchangeKycRegistry registry = new ExchangeKycRegistry(admin);
        vm.stopBroadcast();

        console.log("ExchangeKycRegistry: %s", address(registry));
        console.log("Next: the manager points a pote at it (set-user-gate order).");
    }
}
