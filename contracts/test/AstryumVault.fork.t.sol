// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {AstryumVault} from "../src/AstryumVault.sol";

/**
 * Fork suite: the pote against the REAL venues on Flare mainnet state.
 * Needs network ([rpc_endpoints] flare in foundry.toml). Filter out with
 * `forge test --no-match-contract Fork` when offline.
 *
 * Verified preconditions (2026-08-21, cast against mainnet):
 *  - kFXRP ISO holds ~20.4M FXRP of cash → whale-prank funding works.
 *  - Firelight's currentPeriod() is TIME-DERIVED (260 → 262 across ~2 days of
 *    blocks) → vm.warp advances the withdrawal queue, so the FULL exit cycle
 *    (request → 72h → claim) runs against the real contract.
 */
contract AstryumVaultForkTest is Test {
    // Flare mainnet — same addresses as backend/.env and the verify scripts.
    IERC20 constant FXRP = IERC20(0xAd552A648C74D49E10027AB8a618A3ad4901c5bE);
    address constant KINETIC_KFXRP_ISO = 0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3;
    address constant FIRELIGHT_STXRP = 0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3;

    address council = makeAddr("council");
    address operator = makeAddr("operator");
    address client = makeAddr("client");
    address stranger = makeAddr("stranger");

    bytes32 constant REF = keccak256("politica-fork-v1");
    uint48 constant COOLDOWN_B = 72 hours;
    uint16 constant FLOOR = 1000;

    AstryumVault poteA; // sync: Kinetic ISO only
    AstryumVault poteB; // cooldown: Kinetic ISO + Firelight queued

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("flare"));

        AstryumVault.InitialVenue[] memory initA = new AstryumVault.InitialVenue[](1);
        initA[0] = AstryumVault.InitialVenue(KINETIC_KFXRP_ISO, AstryumVault.VenueKind.CompoundV2);
        poteA = new AstryumVault(FXRP, "Astryum Pote A", "apA-FXRP", council, REF, 0, FLOOR, initA);

        AstryumVault.InitialVenue[] memory initB = new AstryumVault.InitialVenue[](2);
        initB[0] = AstryumVault.InitialVenue(KINETIC_KFXRP_ISO, AstryumVault.VenueKind.CompoundV2);
        initB[1] = AstryumVault.InitialVenue(FIRELIGHT_STXRP, AstryumVault.VenueKind.ERC4626Queued);
        poteB = new AstryumVault(FXRP, "Astryum Pote B", "apB-FXRP", council, REF, COOLDOWN_B, FLOOR, initB);

        // Whale-prank funding: the kToken's own FXRP cash pays the test actor.
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

    /// Pote A against the real Kinetic ISO market: direct in, redeem out in
    /// one holder tx — the unwind hits real redeemUnderlying.
    function test_Fork_PoteA_KineticRoundTripAndSelfServiceRedeem() public {
        vm.prank(client);
        uint256 shares = poteA.deposit(50_000e6, client);

        vm.prank(operator);
        poteA.directTo(0, 40_000e6, REF);

        // Real market: value ≈ what we put in (rate accrual is dust at t=0).
        assertApproxEqRel(poteA.venueValue(0), 40_000e6, 0.001e18);
        assertApproxEqAbs(poteA.totalAssets(), 50_000e6, 50_000); // ±0.05 FXRP

        uint256 before = FXRP.balanceOf(client);
        vm.prank(client);
        uint256 got = poteA.redeem(shares, client, client);

        assertApproxEqAbs(got, 50_000e6, 50_000);
        assertEq(FXRP.balanceOf(client) - before, got);
        assertLe(poteA.venueValue(0), 50_000); // emptied, dust at most
    }

    /// THE demo circuit (scene 5) against the REAL Firelight queue: request
    /// fires the queued exit, time passes, anyone finishes the claim, the
    /// holder gets paid at the receiver they fixed. No director anywhere.
    function test_Fork_PoteB_FirelightFullExitCycle() public {
        vm.prank(client);
        uint256 shares = poteB.deposit(50_000e6, client);

        vm.prank(operator);
        poteB.directTo(1, 40_000e6, REF); // into real stXRP

        assertApproxEqRel(poteB.venueValue(1), 40_000e6, 0.001e18);

        uint256 period = ISTXRPPeriod(FIRELIGHT_STXRP).currentPeriod() + 1;
        vm.prank(client);
        uint256 ticketId = poteB.requestRedeem(shares, client);

        // Burned now; the venue exit queued into period+1 on the real vault.
        assertEq(poteB.balanceOf(client), 0);
        assertApproxEqRel(poteB.venueQueuedTotal(1), 40_000e6, 0.001e18);
        assertApproxEqRel(
            ISTXRPPeriod(FIRELIGHT_STXRP).withdrawalsOf(period, address(poteB)),
            40_000e6,
            0.001e18
        );

        // 72h pass — the real queue matures (time-derived periods, verified).
        vm.warp(block.timestamp + COOLDOWN_B + 1);
        assertGe(ISTXRPPeriod(FIRELIGHT_STXRP).currentPeriod(), period + 1);

        uint256 before = FXRP.balanceOf(client);
        AstryumVault.VenueClaim[] memory claims = new AstryumVault.VenueClaim[](1);
        claims[0] = AstryumVault.VenueClaim(1, period);
        vm.prank(stranger); // permissionless finisher
        poteB.claimRedeem(ticketId, claims);

        assertApproxEqAbs(FXRP.balanceOf(client) - before, 50_000e6, 50_000);
        assertEq(poteB.earmarkedAssets(), 0);
        assertEq(poteB.venueQueuedTotal(1), 0);
    }

    /// The scene-4 moment, against real venues: the operator has NO door that
    /// pays capital anywhere but a listed venue — and governance without the
    /// constitution ref is refused.
    function test_Fork_TheRobberyThatCannotHappen() public {
        vm.prank(client);
        poteB.deposit(50_000e6, client);

        // The director tries to "add" an exit venue of his own: only the
        // council can, only with the current ref, and only with 30 days of
        // public notice — and even then it is a typed venue, never a payout.
        vm.prank(operator);
        vm.expectRevert(AstryumVault.NotCouncil.selector);
        poteB.proposeVenue(operator, AstryumVault.VenueKind.ERC4626, REF);

        vm.prank(council);
        vm.expectRevert(AstryumVault.RefMismatch.selector);
        poteB.proposeVenue(operator, AstryumVault.VenueKind.ERC4626, keccak256("forged-ref"));

        // And after everything the operator CAN do, his balance is zero.
        vm.prank(operator);
        poteB.directTo(0, 10_000e6, REF);
        vm.prank(operator);
        poteB.recall(0, 5_000e6, REF);
        assertEq(FXRP.balanceOf(operator), 0);
    }
}

interface ISTXRPPeriod {
    function currentPeriod() external view returns (uint256);
    function withdrawalsOf(uint256 period, address owner) external view returns (uint256);
}
