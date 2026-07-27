// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {LegacyVault} from "../src/LegacyVault.sol";

/**
 * Deploy script — run BY THE FOUNDER, never from a shared environment.
 * Constructor params are ETERNAL (no proxy): the runbook's checklist in
 * contracts/README.md is mandatory before broadcasting.
 *
 * Env (see runbook for the double-check ritual):
 *   FXRP_ADDRESS         FXRP token (resolve LIVE via AssetManagerFXRP.fAsset(),
 *                        never from a chat or a doc)
 *   COUNCIL_ADDRESS      the council multisig (or the founder EOA for the dry run)
 *   CONSTITUTION_REF     bytes32 — SHA-256 of the constitution version anchored
 *                        on XRPL via DIDSet (0x + 64 hex)
 *   PROTOCOL_TREASURY    fee recipient, fixed forever (D6). address(0) = the
 *                        hook is unusable in this vessel, forever.
 *   LINAJE_FEE_BPS       initial linaje rate, in [1000, 4000] (D5 — e.g. 3000)
 *   VENUE1_TARGET / VENUE1_KIND   optional first venue (KIND: 0 = ERC4626,
 *                        1 = CompoundV2). VENUE2_* likewise.
 */
contract DeployLegacyVault is Script {
    function run() external {
        IERC20 fxrp = IERC20(vm.envAddress("FXRP_ADDRESS"));
        address council = vm.envAddress("COUNCIL_ADDRESS");
        bytes32 constitutionRef = vm.envBytes32("CONSTITUTION_REF");
        address treasury = vm.envAddress("PROTOCOL_TREASURY");
        uint16 linajeBps = uint16(vm.envUint("LINAJE_FEE_BPS"));

        LegacyVault.InitialVenue[] memory venues = _readVenues();

        console.log("=== LegacyVault deploy -- PARAMS ARE ETERNAL, read them twice ===");
        console.log("asset (FXRP):      %s", address(fxrp));
        console.log("council:           %s", council);
        console.log("protocol treasury: %s", treasury);
        console.log("linaje fee (bps):  %s  [floor 1000 / ceil 4000]", linajeBps);
        console.logBytes32(constitutionRef);
        for (uint256 i = 0; i < venues.length; i++) {
            console.log("venue %s: %s (kind %s)", i, venues[i].target, uint256(venues[i].kind));
        }

        vm.startBroadcast();
        LegacyVault vault = new LegacyVault(fxrp, council, constitutionRef, treasury, linajeBps, venues);
        vm.stopBroadcast();

        console.log("LegacyVault deployed at: %s", address(vault));
        console.log("Next: verify source on the explorer, read feeSchedule(),");
        console.log("anchor the vault address into the constitution (DIDSet v+1).");
    }

    function _readVenues() internal view returns (LegacyVault.InitialVenue[] memory venues) {
        address v1 = vm.envOr("VENUE1_TARGET", address(0));
        address v2 = vm.envOr("VENUE2_TARGET", address(0));
        uint256 n = (v1 != address(0) ? 1 : 0) + (v2 != address(0) ? 1 : 0);
        venues = new LegacyVault.InitialVenue[](n);
        uint256 i;
        if (v1 != address(0)) {
            venues[i++] = LegacyVault.InitialVenue(v1, LegacyVault.VenueKind(vm.envUint("VENUE1_KIND")));
        }
        if (v2 != address(0)) {
            venues[i++] = LegacyVault.InitialVenue(v2, LegacyVault.VenueKind(vm.envUint("VENUE2_KIND")));
        }
    }
}
