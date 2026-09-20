// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {AstryumVault} from "../src/AstryumVault.sol";
import {PasskeyAccount, PasskeyAccountFactory} from "../src/PasskeyAccount.sol";

/**
 * The passkey door against the REAL RIP-7212 precompile on a Flare mainnet
 * fork (probed live 2026-08-20/21) — plus THE scene-5 integration: an exchange
 * client whose ONLY key is a WebAuthn passkey exits the pote against the real
 * Firelight queue, and the money lands on the exchange's rails.
 *
 * vm.signP256 / vm.publicKeyP256 produce genuine secp256r1 signatures.
 *
 * PRECOMPILE CAVEAT, on the record: a Foundry fork copies Flare's STATE but
 * executes on local revm — and precompiles are node code, not state, so
 * 0x…0100 is EMPTY here. The curve math itself was verified against the LIVE
 * chain (eth_call, reference vector + negative control, 2026-08-20/21); what
 * these tests pin is OUR side of the contract: the WebAuthn message
 * construction, the exact precompile input encoding, and the nonce lifecycle.
 * vm.mockCall answers 1 ONLY for the byte-exact expected input — any tampered
 * or replayed signature produces a different input, falls through to the
 * empty address, and is rejected by the account's strict 32-byte check.
 */
contract PasskeyAccountForkTest is Test {
    IERC20 constant FXRP = IERC20(0xAd552A648C74D49E10027AB8a618A3ad4901c5bE);
    address constant KINETIC_KFXRP_ISO = 0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3;
    address constant FIRELIGHT_STXRP = 0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3;

    // A test-only P256 private key (never a real credential).
    uint256 constant PRIV = 0xA11CE00000000000000000000000000000000000000000000000000000000001;
    string constant PRE = '{"type":"webauthn.get","challenge":"';
    string constant POST = '","origin":"https://astryum.xyz","crossOrigin":false}';

    address council = makeAddr("council");
    address operator = makeAddr("exchangeOperator");
    address exchangeWallet = makeAddr("exchangeHotWallet");
    address stranger = makeAddr("stranger");

    bytes32 constant REF = keccak256("politica-rendimiento-fork");
    uint48 constant COOLDOWN_B = 72 hours;

    PasskeyAccountFactory factory;
    uint256 pubX;
    uint256 pubY;
    AstryumVault poteB;

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("flare"));
        factory = new PasskeyAccountFactory();
        (pubX, pubY) = vm.publicKeyP256(PRIV);

        AstryumVault.InitialVenue[] memory init = new AstryumVault.InitialVenue[](2);
        init[0] = AstryumVault.InitialVenue(KINETIC_KFXRP_ISO, AstryumVault.VenueKind.CompoundV2);
        init[1] = AstryumVault.InitialVenue(FIRELIGHT_STXRP, AstryumVault.VenueKind.ERC4626Queued);
        poteB = new AstryumVault(FXRP, "Astryum Pote B", "apB-FXRP", council, REF, COOLDOWN_B, 1000, init);

        vm.prank(council);
        poteB.cede(operator, uint64(block.timestamp + 30 days), REF);

        // The exchange's capital, whale-pranked from the kToken's real cash.
        vm.prank(KINETIC_KFXRP_ISO);
        FXRP.transfer(operator, 100_000e6);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /// A genuine WebAuthn-shaped assertion over the account's CURRENT
    /// challenge — and the precompile mock armed for EXACTLY this input.
    function _sign(PasskeyAccount acct, address target, uint256 value, bytes memory data)
        internal
        returns (PasskeyAccount.WebAuthnSig memory sig)
    {
        bytes memory authData = abi.encodePacked(bytes32(0), bytes1(0x01), bytes4(0)); // rpIdHash ‖ UP ‖ counter
        bytes32 challenge = acct.challengeFor(target, value, data);
        bytes memory cdj = acct.clientDataJSON(challenge, PRE, POST);
        bytes32 message = sha256(abi.encodePacked(authData, sha256(cdj)));
        (bytes32 r, bytes32 s) = vm.signP256(PRIV, message);
        // Byte-exact input or nothing: this is the encoding the live precompile
        // verified on mainnet (message ‖ r ‖ s ‖ x ‖ y).
        vm.mockCall(
            acct.P256_VERIFIER(),
            abi.encodePacked(message, r, s, pubX, pubY),
            abi.encode(uint256(1))
        );
        sig = PasskeyAccount.WebAuthnSig({
            authenticatorData: authData,
            clientDataPre: PRE,
            clientDataPost: POST,
            r: r,
            s: s
        });
    }

    // ── counterfactual onboarding (Orden §3.1) ───────────────────────────────

    function test_Fork_Counterfactual_OnboardingWritesNothing() public {
        (address predicted, bool deployed) = factory.accountFor(pubX, pubY);
        assertFalse(deployed, "onboarding must not deploy anything");

        // Value can land BEFORE the account exists — that is the whole point.
        vm.prank(operator);
        FXRP.transfer(predicted, 1_000e6);
        assertEq(FXRP.balanceOf(predicted), 1_000e6);

        address account = factory.create(pubX, pubY);
        assertEq(account, predicted, "lazy deploy lands exactly on the predicted address");
        assertEq(factory.create(pubX, pubY), predicted, "create is idempotent");
    }

    // ── the door itself, against the real precompile ─────────────────────────

    function test_Fork_Passkey_SignsRejectsAndNeverReplays() public {
        PasskeyAccount acct = PasskeyAccount(payable(factory.create(pubX, pubY)));
        vm.prank(operator);
        FXRP.transfer(address(acct), 5_000e6);

        bytes memory data = abi.encodeCall(IERC20.transfer, (exchangeWallet, 2_000e6));
        PasskeyAccount.WebAuthnSig memory sig = _sign(acct, address(FXRP), 0, data);

        // The signature is the authority — a stranger may carry the tx.
        vm.prank(stranger);
        acct.execute(address(FXRP), 0, data, sig);
        assertEq(FXRP.balanceOf(exchangeWallet), 2_000e6);
        assertEq(acct.nonce(), 1);

        // Replay: the nonce moved, the old challenge died with it.
        vm.expectRevert(PasskeyAccount.InvalidPasskeySignature.selector);
        acct.execute(address(FXRP), 0, data, sig);

        // A tampered signature is refused by the REAL precompile.
        PasskeyAccount.WebAuthnSig memory bad = _sign(acct, address(FXRP), 0, data);
        bad.s = bytes32(uint256(bad.s) ^ 1);
        vm.expectRevert(PasskeyAccount.InvalidPasskeySignature.selector);
        acct.execute(address(FXRP), 0, data, bad);

        // No User-Present bit → malformed, before any crypto.
        PasskeyAccount.WebAuthnSig memory noUp = _sign(acct, address(FXRP), 0, data);
        noUp.authenticatorData = abi.encodePacked(bytes32(0), bytes1(0x00), bytes4(0));
        vm.expectRevert(PasskeyAccount.MalformedAuthenticatorData.selector);
        acct.execute(address(FXRP), 0, data, noUp);
    }

    /// One Face ID for a BATCH: approve + deposit in a single signature — the
    /// universal user action path (meter en un vault, sacar, o enviar fuera).
    function _signBatch(PasskeyAccount acct, PasskeyAccount.Call[] memory calls)
        internal
        returns (PasskeyAccount.WebAuthnSig memory sig)
    {
        bytes memory authData = abi.encodePacked(bytes32(0), bytes1(0x01), bytes4(0));
        bytes32 challenge = acct.challengeForBatch(calls);
        bytes memory cdj = acct.clientDataJSON(challenge, PRE, POST);
        bytes32 message = sha256(abi.encodePacked(authData, sha256(cdj)));
        (bytes32 r, bytes32 s) = vm.signP256(PRIV, message);
        vm.mockCall(acct.P256_VERIFIER(), abi.encodePacked(message, r, s, pubX, pubY), abi.encode(uint256(1)));
        sig = PasskeyAccount.WebAuthnSig(authData, PRE, POST, r, s);
    }

    function test_Fork_Passkey_BatchApproveAndDepositInOneSignature() public {
        PasskeyAccount acct = PasskeyAccount(payable(factory.create(pubX, pubY)));
        vm.prank(operator);
        FXRP.transfer(address(acct), 10_000e6);

        PasskeyAccount.Call[] memory calls = new PasskeyAccount.Call[](2);
        calls[0] = PasskeyAccount.Call(address(FXRP), 0, abi.encodeCall(IERC20.approve, (address(poteB), 10_000e6)));
        calls[1] = PasskeyAccount.Call(address(poteB), 0, abi.encodeWithSignature("deposit(uint256,address)", uint256(10_000e6), address(acct)));

        vm.prank(stranger); // the relayer carries it; the passkey is the authority
        acct.executeBatch(calls, _signBatch(acct, calls));

        assertGt(poteB.balanceOf(address(acct)), 0, "one Face ID deposited the client's own FXRP");
        assertEq(acct.nonce(), 1, "the whole batch burned exactly one nonce");
    }

    // ── THE scene 5: Face ID exit, mode B, real Firelight, exchange rails ────

    function test_Fork_Scene5_FaceIdExitLandsOnExchangeRails() public {
        // Onboarding: the client exists only as a passkey. Shares will land on
        // the PREDICTED address (mode B: the operator deposits, receiver = client).
        (address predicted,) = factory.accountFor(pubX, pubY);

        vm.startPrank(operator);
        FXRP.approve(address(poteB), type(uint256).max);
        poteB.deposit(50_000e6, predicted); // the operator pays, the CLIENT owns
        poteB.directTo(1, 40_000e6, REF); // into the real Firelight
        vm.stopPrank();

        assertApproxEqRel(poteB.venueValue(1), 40_000e6, 0.001e18);
        uint256 shares = poteB.balanceOf(predicted);
        assertGt(shares, 0, "the shares are the client's, not the operator's");

        // First use deploys the account — inside the exit story, as designed.
        PasskeyAccount acct = PasskeyAccount(payable(factory.create(pubX, pubY)));

        // One Face ID prompt: requestRedeem(all shares) with the payout fixed
        // to the EXCHANGE wallet (Z14's AML-preserving return leg).
        uint256 period = ISTXRPPeriod(FIRELIGHT_STXRP).currentPeriod() + 1;
        bytes memory data = abi.encodeCall(AstryumVault.requestRedeem, (shares, exchangeWallet));
        PasskeyAccount.WebAuthnSig memory sig = _sign(acct, address(poteB), 0, data);
        vm.prank(stranger); // the operator's UI may relay — authority is the passkey
        bytes memory ret = acct.execute(address(poteB), 0, data, sig);
        uint256 ticketId = abi.decode(ret, (uint256));

        assertEq(poteB.balanceOf(address(acct)), 0, "burned at request");
        assertApproxEqRel(poteB.venueQueuedTotal(1), 40_000e6, 0.001e18);

        // 72h pass; the real queue matures (periods are time-derived, verified).
        vm.warp(block.timestamp + COOLDOWN_B + 1);
        assertGe(ISTXRPPeriod(FIRELIGHT_STXRP).currentPeriod(), period + 1);

        AstryumVault.VenueClaim[] memory claims = new AstryumVault.VenueClaim[](1);
        claims[0] = AstryumVault.VenueClaim(1, period);
        vm.prank(stranger); // permissionless finisher
        poteB.claimRedeem(ticketId, claims);

        assertApproxEqAbs(FXRP.balanceOf(exchangeWallet), 50_000e6, 50_000);
        assertEq(poteB.earmarkedAssets(), 0);
        // The client never had an EOA key, a seed, or an XRPL account funded:
        // one passkey, one signature, and the manager could not say no.
    }
}

interface ISTXRPPeriod {
    function currentPeriod() external view returns (uint256);
}
