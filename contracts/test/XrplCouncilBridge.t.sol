// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {LegacyVault} from "../src/LegacyVault.sol";
import {XrplCouncilBridge} from "../src/XrplCouncilBridge.sol";
import {IXRPPayment} from "../src/interfaces/IXRPPayment.sol";
import {IXRPPaymentVerification} from "../src/interfaces/IXRPPaymentVerification.sol";
import {MockFXRP, Mock4626Venue} from "./mocks/Mocks.sol";

/// Settable stand-in for Flare's FdcVerification (the Merkle check itself is
/// Flare's audited code — what WE must test is every guard around it).
contract MockFdcVerifier is IXRPPaymentVerification {
    bool public result = true;

    function set(bool r) external {
        result = r;
    }

    function verifyXRPPayment(IXRPPayment.Proof calldata) external view returns (bool) {
        return result;
    }
}

contract XrplCouncilBridgeTest is Test {
    // The council's XRPL account (the rehearsed one) and its FDC standard hash.
    string constant COUNCIL_R = "rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf";
    bytes32 immutable COUNCIL_HASH = keccak256(bytes(COUNCIL_R));
    bytes32 constant SOURCE = bytes32("testXRP");

    address constant REGISTRY = 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019;

    MockFXRP fxrp;
    Mock4626Venue venue;
    LegacyVault vault;
    XrplCouncilBridge bridge;
    MockFdcVerifier verifier;

    address treasury = makeAddr("astryumTreasury");
    address stranger = makeAddr("stranger");
    address payee = makeAddr("payee");

    bytes32 constant REF = keccak256("constitucion-v1");

    function setUp() public {
        // Flare's registry is a fixed address on every network; in tests we
        // plant code there and mock the one read the bridge performs.
        verifier = new MockFdcVerifier();
        vm.etch(REGISTRY, hex"00");
        vm.mockCall(
            REGISTRY,
            abi.encodeWithSignature("getContractAddressByName(string)", "FdcVerification"),
            abi.encode(address(verifier))
        );

        fxrp = new MockFXRP();
        venue = new Mock4626Venue(fxrp);

        // Birth order (roadmap ⭐): bridge first, vault with bridge as council,
        // then the one-shot bind. The EVM mirror council never exists.
        bridge = new XrplCouncilBridge(COUNCIL_HASH, SOURCE);
        LegacyVault.InitialVenue[] memory init = new LegacyVault.InitialVenue[](1);
        init[0] = LegacyVault.InitialVenue(address(venue), LegacyVault.VenueKind.ERC4626);
        vault = new LegacyVault(fxrp, address(bridge), REF, treasury, 3000, init);
        bridge.bind(address(vault));

        fxrp.mint(address(this), 1_000_000e6);
        fxrp.approve(address(vault), type(uint256).max);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _orderData(uint64 nonce, bytes memory vaultCalldata) internal pure returns (bytes memory) {
        return abi.encode(nonce, vaultCalldata);
    }

    /// A well-formed proof for `orderData`, as the council's XRPL tx would attest.
    function _proof(bytes memory orderData, bytes32 txId) internal view returns (IXRPPayment.Proof memory p) {
        p.data.attestationType = bytes32("XRPPayment");
        p.data.sourceId = SOURCE;
        p.data.requestBody = IXRPPayment.RequestBody({transactionId: txId, proofOwner: address(bridge)});
        p.data.responseBody.sourceAddress = COUNCIL_R;
        p.data.responseBody.sourceAddressHash = COUNCIL_HASH;
        p.data.responseBody.status = 0;
        p.data.responseBody.hasMemoData = true;
        p.data.responseBody.firstMemoData = abi.encodePacked(keccak256(orderData));
        p.data.responseBody.spentAmount = 1; // 1 drop — the value never matters
    }

    function _exec(uint64 nonce, bytes memory call_, bytes32 txId) internal {
        bytes memory od = _orderData(nonce, call_);
        // Anyone relays — the messenger has no authority.
        vm.prank(stranger);
        bridge.execute(_proof(od, txId), od);
    }

    /* ═══════════════════════════════════════════════════════════════════════
       THE DEFINING TEST: a quorum-signed XRPL order moves capital inside the
       cage — and NO order, however signed, can extract the principal.
       ═══════════════════════════════════════════════════════════════════════ */

    function test_QuorumOrder_DirectsCapital_EndToEnd() public {
        vault.deposit(100_000e6);

        _exec(0, abi.encodeWithSelector(LegacyVault.directTo.selector, 0, 60_000e6, REF), keccak256("xrpl-tx-1"));

        assertEq(vault.venueBasis(0), 60_000e6, "order did not allocate");
        assertEq(bridge.nextNonce(), 1, "nonce did not advance");
        assertTrue(bridge.consumedTxId(keccak256("xrpl-tx-1")));
    }

    function test_DefiningInvariant_NoOrderExtractsPrincipal() public {
        vault.deposit(100_000e6);
        _exec(0, abi.encodeWithSelector(LegacyVault.directTo.selector, 0, 100_000e6, REF), keccak256("t1"));
        _exec(1, abi.encodeWithSelector(LegacyVault.recall.selector, 0, 40_000e6, REF), keccak256("t2"));
        _exec(2, abi.encodeWithSelector(LegacyVault.evacuate.selector, 0, REF), keccak256("t3"));

        // Whatever the quorum orders, nothing lands with the bridge, and the
        // vault still covers the whole principal.
        assertEq(fxrp.balanceOf(address(bridge)), 0, "bridge holds funds");
        assertEq(vault.totalPrincipal(), 100_000e6, "principal shrank");
        assertGe(vault.totalValue(), vault.totalPrincipal(), "principal not covered");
    }

    function test_FullGovernanceCycle_PayeesAndHarvest() public {
        vault.deposit(100_000e6);
        _exec(0, abi.encodeWithSelector(LegacyVault.directTo.selector, 0, 100_000e6, REF), keccak256("t1"));

        // Quorum order: name the payee (arrays abi-encode fine through the memo hash).
        address[] memory accounts = new address[](1);
        accounts[0] = payee;
        uint16[] memory bps = new uint16[](1);
        bps[0] = 10_000;
        _exec(1, abi.encodeWithSelector(LegacyVault.setPayees.selector, accounts, bps, REF), keccak256("t2"));

        // The venue yields; anyone harvests; the payee claims fruit only.
        fxrp.mint(address(venue), 10_000e6);
        vm.prank(stranger);
        vault.harvest(0);
        uint256 c = vault.claimable(payee);
        assertGt(c, 0, "no fruit accrued");
        assertLe(c, 7_000e6, "more than yield-after-linaje accrued");
    }

    // ── every guard, one by one ──────────────────────────────────────────────

    function test_RevertsWhenNotBound() public {
        XrplCouncilBridge unbound = new XrplCouncilBridge(COUNCIL_HASH, SOURCE);
        bytes memory od = _orderData(0, abi.encodeWithSelector(LegacyVault.evacuate.selector, 0, REF));
        vm.expectRevert(XrplCouncilBridge.NotBound.selector);
        unbound.execute(_proof(od, keccak256("t")), od);
    }

    function test_RevertsOnInvalidProof() public {
        verifier.set(false);
        bytes memory od = _orderData(0, abi.encodeWithSelector(LegacyVault.evacuate.selector, 0, REF));
        vm.expectRevert(XrplCouncilBridge.InvalidProof.selector);
        bridge.execute(_proof(od, keccak256("t")), od);
    }

    function test_RevertsOnWrongAttestationType() public {
        bytes memory od = _orderData(0, abi.encodeWithSelector(LegacyVault.evacuate.selector, 0, REF));
        IXRPPayment.Proof memory p = _proof(od, keccak256("t"));
        p.data.attestationType = bytes32("Payment"); // the generic 0x01 — not ours
        vm.expectRevert(XrplCouncilBridge.WrongAttestationType.selector);
        bridge.execute(p, od);
    }

    function test_RevertsOnWrongSource() public {
        bytes memory od = _orderData(0, abi.encodeWithSelector(LegacyVault.evacuate.selector, 0, REF));
        IXRPPayment.Proof memory p = _proof(od, keccak256("t"));
        p.data.sourceId = bytes32("XRP"); // mainnet proof against a testnet bridge
        vm.expectRevert(XrplCouncilBridge.WrongSource.selector);
        bridge.execute(p, od);
    }

    function test_RevertsOnWrongProofOwner() public {
        bytes memory od = _orderData(0, abi.encodeWithSelector(LegacyVault.evacuate.selector, 0, REF));
        IXRPPayment.Proof memory p = _proof(od, keccak256("t"));
        p.data.requestBody.proofOwner = stranger; // prepared for another consumer
        vm.expectRevert(XrplCouncilBridge.WrongProofOwner.selector);
        bridge.execute(p, od);
    }

    function test_RevertsOnWrongCouncil() public {
        bytes memory od = _orderData(0, abi.encodeWithSelector(LegacyVault.evacuate.selector, 0, REF));
        IXRPPayment.Proof memory p = _proof(od, keccak256("t"));
        p.data.responseBody.sourceAddressHash = keccak256("rSomeoneElse"); // not the council
        vm.expectRevert(XrplCouncilBridge.WrongCouncil.selector);
        bridge.execute(p, od);
    }

    function test_RevertsWhenXrplTxFailed() public {
        bytes memory od = _orderData(0, abi.encodeWithSelector(LegacyVault.evacuate.selector, 0, REF));
        IXRPPayment.Proof memory p = _proof(od, keccak256("t"));
        p.data.responseBody.status = 1; // tec on XRPL: attested, but it FAILED
        vm.expectRevert(abi.encodeWithSelector(XrplCouncilBridge.PaymentFailedOnXrpl.selector, 1));
        bridge.execute(p, od);
    }

    function test_RevertsOnMissingOrMalformedMemo() public {
        bytes memory od = _orderData(0, abi.encodeWithSelector(LegacyVault.evacuate.selector, 0, REF));
        IXRPPayment.Proof memory p = _proof(od, keccak256("t"));
        p.data.responseBody.hasMemoData = false;
        vm.expectRevert(XrplCouncilBridge.NoMemo.selector);
        bridge.execute(p, od);

        p = _proof(od, keccak256("t"));
        p.data.responseBody.firstMemoData = hex"deadbeef"; // not 32 bytes
        vm.expectRevert(XrplCouncilBridge.NoMemo.selector);
        bridge.execute(p, od);
    }

    function test_RevertsOnMemoMismatch_TheCommitmentIsTheAuthority() public {
        // The quorum committed to evacuate(0); a hostile relayer delivers
        // different bytes. The hash does not match — nothing happens.
        bytes memory committed = _orderData(0, abi.encodeWithSelector(LegacyVault.evacuate.selector, 0, REF));
        bytes memory tampered = _orderData(0, abi.encodeWithSelector(LegacyVault.retireVenue.selector, 0, REF));
        vm.expectRevert(XrplCouncilBridge.MemoMismatch.selector);
        bridge.execute(_proof(committed, keccak256("t")), tampered);
    }

    function test_RevertsOnReplay_SameXrplTx() public {
        vault.deposit(10_000e6);
        bytes memory call_ = abi.encodeWithSelector(LegacyVault.directTo.selector, 0, 1_000e6, REF);
        _exec(0, call_, keccak256("t1"));

        // Same XRPL tx again (even with the correct next nonce inside).
        bytes memory od = _orderData(1, call_);
        vm.expectRevert(XrplCouncilBridge.TxAlreadyExecuted.selector);
        bridge.execute(_proof(od, keccak256("t1")), od);
    }

    function test_RevertsOnNonceOutOfOrder_NoCrossedOrders() public {
        vault.deposit(10_000e6);
        bytes memory od = _orderData(5, abi.encodeWithSelector(LegacyVault.directTo.selector, 0, 1_000e6, REF));
        vm.expectRevert(abi.encodeWithSelector(XrplCouncilBridge.NonceMismatch.selector, uint64(0), uint64(5)));
        bridge.execute(_proof(od, keccak256("t")), od);
    }

    function test_VaultRevertBubblesUp_HonestErrors() public {
        vault.deposit(10_000e6);
        // Stale constitutionRef inside the committed call → the VAULT's own
        // error surfaces through the bridge, name intact.
        bytes memory od =
            _orderData(0, abi.encodeWithSelector(LegacyVault.directTo.selector, 0, 1_000e6, keccak256("stale-ref")));
        vm.expectRevert(LegacyVault.RefMismatch.selector);
        bridge.execute(_proof(od, keccak256("t")), od);
        // And a failed order consumes NOTHING: same tx can retry after fixing.
        assertEq(bridge.nextNonce(), 0);
        assertFalse(bridge.consumedTxId(keccak256("t")));
    }

    function test_Bind_OneShotAndDeployerOnly() public {
        XrplCouncilBridge b = new XrplCouncilBridge(COUNCIL_HASH, SOURCE);
        vm.prank(stranger);
        vm.expectRevert(XrplCouncilBridge.NotDeployer.selector);
        b.bind(address(vault));

        b.bind(address(vault));
        vm.expectRevert(XrplCouncilBridge.AlreadyBound.selector);
        b.bind(address(vault));
    }

    function test_EmptyOrderRejected() public {
        bytes memory od = _orderData(0, hex"");
        vm.expectRevert(XrplCouncilBridge.EmptyOrder.selector);
        bridge.execute(_proof(od, keccak256("t")), od);
    }

    /// The A3 operational scenario, proven end-to-end: a bad order at the HEAD of
    /// the queue (a DIFFERENT vault revert than RefMismatch — here overspending
    /// the idle principal) must roll back EVERYTHING (nonce + txId untouched), and
    /// the queue must recover with a FRESH valid order at the SAME nonce carrying a
    /// NEW txId. This is the "unearned success" trap closed at the most critical
    /// link: a failed order can never leave the council believing it executed.
    function test_BadHeadOrder_RollsBackAndRecoversAtSameNonce() public {
        vault.deposit(10_000e6);

        // (a) Head order at nonce 0 directs more than the idle principal → the
        //     vault reverts; the bridge bubbles it (any revert, not a named one).
        bytes memory bad = _orderData(0, abi.encodeWithSelector(LegacyVault.directTo.selector, 0, 1_000_000e6, REF));
        vm.prank(stranger);
        vm.expectRevert();
        bridge.execute(_proof(bad, keccak256("bad-tx")), bad);
        assertEq(bridge.nextNonce(), 0, "a reverted order advanced the nonce");
        assertFalse(bridge.consumedTxId(keccak256("bad-tx")), "a reverted order consumed its txId");

        // (b) A fresh valid order at the SAME nonce with a NEW txId recovers the
        //     queue — the bad order can never land afterwards.
        _exec(0, abi.encodeWithSelector(LegacyVault.directTo.selector, 0, 1_000e6, REF), keccak256("good-tx"));
        assertEq(vault.venueBasis(0), 1_000e6, "recovery order did not allocate");
        assertEq(bridge.nextNonce(), 1, "recovery order did not advance the nonce");
        assertTrue(bridge.consumedTxId(keccak256("good-tx")));
        assertFalse(bridge.consumedTxId(keccak256("bad-tx")), "the bad order must never land");
    }
}
