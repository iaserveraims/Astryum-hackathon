// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {LegacyVault} from "../src/LegacyVault.sol";
import {XrplCouncilBridge} from "../src/XrplCouncilBridge.sol";
import {MockFXRP, Mock4626Venue} from "../test/mocks/Mocks.sol";

/**
 * Deploy the FULL governed stack in the roadmap's birth order (Pieza 1 ⭐):
 *   1. XrplCouncilBridge(councilHash, sourceId)
 *   2. LegacyVault(asset, council = THE BRIDGE, ref, treasury, linaje, venues)
 *   3. bridge.bind(vault)   ← after this the deployer holds no power at all
 * The EVM mirror council never exists.
 *
 * Env:
 *   COUNCIL_R_ADDRESS   the XRPL council account (r…) — hashed here with
 *                       keccak256(bytes(r)) (FDC standard address hash)
 *   FDC_SOURCE_ID       "testXRP" (Coston2 demo) | "XRP" (mainnet)
 *   CONSTITUTION_REF    bytes32 (0x + 64 hex) — SHA-256 anchored via DIDSet
 *   PROTOCOL_TREASURY   fixed fee recipient (D6)
 *   LINAJE_FEE_BPS      [1000, 4000], e.g. 3000
 *   DEMO_ASSETS=true    Coston2 demo: deploys MockFXRP + a Mock4626 venue and
 *                       mints 1,000,000 demo-FXRP to the deployer. Otherwise:
 *   FXRP_ADDRESS + VENUE1_TARGET/VENUE1_KIND (resolve FXRP LIVE via
 *                       AssetManagerFXRP.fAsset(), never from a doc)
 *
 * Coston2:  forge script script/DeployLegacyStack.s.sol --rpc-url coston2 \
 *             --broadcast --private-key $DEPLOYER_KEY
 * Mainnet:  founder gate + external audit first (contracts/README.md).
 */
contract DeployLegacyStack is Script {
    function run() external {
        string memory councilR = vm.envString("COUNCIL_R_ADDRESS");
        bytes32 councilHash = keccak256(bytes(councilR));
        bytes32 sourceId = bytes32(bytes(vm.envString("FDC_SOURCE_ID")));
        bytes32 constitutionRef = vm.envBytes32("CONSTITUTION_REF");
        address treasury = vm.envAddress("PROTOCOL_TREASURY");
        uint16 linajeBps = uint16(vm.envUint("LINAJE_FEE_BPS"));
        bool demo = vm.envOr("DEMO_ASSETS", false);

        console.log("=== Legacy stack deploy -- PARAMS ARE ETERNAL, read twice ===");
        console.log("council (XRPL):    %s", councilR);
        console.logBytes32(councilHash);
        console.log("FDC source:        %s", vm.envString("FDC_SOURCE_ID"));
        console.log("protocol treasury: %s", treasury);
        console.log("linaje fee (bps):  %s", linajeBps);
        console.logBytes32(constitutionRef);

        vm.startBroadcast();

        IERC20 asset;
        LegacyVault.InitialVenue[] memory venues;
        if (demo) {
            MockFXRP demoFxrp = new MockFXRP();
            Mock4626Venue demoVenue = new Mock4626Venue(demoFxrp);
            demoFxrp.mint(msg.sender, 1_000_000e6);
            asset = demoFxrp;
            venues = new LegacyVault.InitialVenue[](1);
            venues[0] = LegacyVault.InitialVenue(address(demoVenue), LegacyVault.VenueKind.ERC4626);
            console.log("DEMO asset (MockFXRP):    %s", address(demoFxrp));
            console.log("DEMO venue (Mock4626):    %s", address(demoVenue));
        } else {
            asset = IERC20(vm.envAddress("FXRP_ADDRESS"));
            venues = new LegacyVault.InitialVenue[](1);
            venues[0] = LegacyVault.InitialVenue(
                vm.envAddress("VENUE1_TARGET"), LegacyVault.VenueKind(vm.envUint("VENUE1_KIND"))
            );
        }

        // The birth order that makes "XRPL governs" literal from block one.
        XrplCouncilBridge bridge = new XrplCouncilBridge(councilHash, sourceId);
        LegacyVault vault = new LegacyVault(asset, address(bridge), constitutionRef, treasury, linajeBps, venues);
        bridge.bind(address(vault));

        vm.stopBroadcast();

        console.log("XrplCouncilBridge: %s", address(bridge));
        console.log("LegacyVault:       %s  (council = the bridge)", address(vault));
        console.log("Next: verify sources on the explorer; set LEGACY_BRIDGE_ADDRESS /");
        console.log("LEGACY_VAULT_ADDRESS in backend/.env; anchor the addresses in the");
        console.log("constitution (DIDSet v+1 signed by the quorum).");
    }
}
