// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {XrplCouncilBridge} from "../src/XrplCouncilBridge.sol";
import {XrplCouncilBridgeV2} from "../src/XrplCouncilBridgeV2.sol";
import {IXRPPayment} from "../src/interfaces/IXRPPayment.sol";
import {IXRPPaymentVerification} from "../src/interfaces/IXRPPaymentVerification.sol";

/// Doble del verificador de Flare: la inclusión Merkle es código auditado de
/// Flare; lo que hay que probar aquí es cada guardia alrededor.
contract MockFdcVerifierV2 is IXRPPaymentVerification {
    bool public result = true;

    function set(bool r) external {
        result = r;
    }

    function verifyXRPPayment(IXRPPayment.Proof calldata) external view returns (bool) {
        return result;
    }
}

/// El contrato atado: solo cuenta cuántas órdenes le llegaron.
contract Target {
    uint256 public hits;

    function ping(bytes32) external {
        hits++;
    }
}

/**
 * El bridge v2 y lo que añade sobre el v1: el DESTINO.
 *
 * La v1 valida origen, memo, estado y nonce, pero no a quién se pagó. Eso deja
 * de valer cuando el ancla es una PUERTA (DepositAuth + AuthorizeCredentials):
 * una orden pagada a otra cuenta se saltaría la puerta. Aquí, la orden solo
 * cuenta si ATERRIZÓ en el ancla — y como FDC pone `receivingAddressHash` a
 * cero cuando el pago falló, un rechazo del ledger nunca pasa de aquí.
 */
contract XrplCouncilBridgeV2Test is Test {
    address constant REGISTRY = 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019;
    bytes32 constant SOURCE = bytes32("XRP");
    string constant COUNCIL_R = "r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG";
    string constant ANCHOR_R = "rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm";
    bytes32 COUNCIL_HASH = keccak256(bytes(COUNCIL_R));
    bytes32 ANCHOR_HASH = keccak256(bytes(ANCHOR_R));

    MockFdcVerifierV2 verifier;
    XrplCouncilBridgeV2 bridge;
    Target target;

    address stranger = makeAddr("stranger");

    function setUp() public {
        verifier = new MockFdcVerifierV2();
        vm.etch(REGISTRY, hex"00");
        vm.mockCall(
            REGISTRY,
            abi.encodeWithSignature("getContractAddressByName(string)", "FdcVerification"),
            abi.encode(address(verifier))
        );

        bridge = new XrplCouncilBridgeV2(COUNCIL_HASH, SOURCE, ANCHOR_HASH);
        target = new Target();
        bridge.bind(address(target));
    }

    function _orderData(uint64 nonce) internal pure returns (bytes memory) {
        return abi.encode(nonce, abi.encodeWithSelector(Target.ping.selector, bytes32(uint256(1))));
    }

    /// Una prueba de un pago que LLEGÓ al ancla con éxito.
    function _proof(bytes memory orderData, bytes32 txId, bytes32 receivingHash, uint8 status)
        internal
        view
        returns (IXRPPayment.Proof memory p)
    {
        p.data.attestationType = bytes32("XRPPayment");
        p.data.sourceId = SOURCE;
        p.data.requestBody = IXRPPayment.RequestBody({transactionId: txId, proofOwner: address(bridge)});
        p.data.responseBody.sourceAddress = COUNCIL_R;
        p.data.responseBody.sourceAddressHash = COUNCIL_HASH;
        p.data.responseBody.receivingAddressHash = receivingHash;
        p.data.responseBody.status = status;
        p.data.responseBody.hasMemoData = true;
        p.data.responseBody.firstMemoData = abi.encodePacked(keccak256(orderData));
        p.data.responseBody.spentAmount = 1;
    }

    // ═══ EL DESTINO ═══

    function test_an_order_that_landed_on_the_anchor_executes() public {
        bytes memory od = _orderData(0);
        vm.prank(stranger); // cualquiera la lleva: el mensajero no tiene autoridad
        bridge.execute(_proof(od, keccak256("tx-1"), ANCHOR_HASH, 0), od);

        assertEq(target.hits(), 1);
        assertEq(bridge.nextNonce(), 1);
    }

    function test_an_order_paid_to_ANOTHER_account_is_refused() public {
        // El ataque: el gestor manda su orden a una cuenta sin puerta.
        bytes memory od = _orderData(0);
        bytes32 elsewhere = keccak256(bytes("rSomeoneElse"));

        vm.expectRevert(XrplCouncilBridgeV2.WrongAnchor.selector);
        bridge.execute(_proof(od, keccak256("tx-1"), elsewhere, 0), od);
        assertEq(target.hits(), 0, "nada se ejecuto");
        assertEq(bridge.nextNonce(), 0, "el nonce no se movio");
    }

    function test_a_payment_the_ledger_rejected_never_executes() public {
        // DepositAuth sin título válido → tecNO_PERMISSION → FDC lo atestigua con
        // estado ≠ 0 y receivingAddressHash = 0. Se para en la primera guardia.
        bytes memory od = _orderData(0);

        vm.expectRevert(XrplCouncilBridgeV2.WrongAnchor.selector);
        bridge.execute(_proof(od, keccak256("tx-1"), bytes32(0), 2), od);
        assertEq(target.hits(), 0);
    }

    function test_the_anchor_is_immutable_and_never_zero() public {
        assertEq(bridge.ANCHOR_ADDRESS_HASH(), ANCHOR_HASH);
        vm.expectRevert(XrplCouncilBridgeV2.ZeroAnchor.selector);
        new XrplCouncilBridgeV2(COUNCIL_HASH, SOURCE, bytes32(0));
    }

    // ═══ LO QUE SIGUE IGUAL QUE EN LA V1 ═══

    function test_the_v1_guards_still_hold() public {
        bytes memory od = _orderData(0);

        // otra cuenta de origen
        IXRPPayment.Proof memory p = _proof(od, keccak256("tx-1"), ANCHOR_HASH, 0);
        p.data.responseBody.sourceAddressHash = keccak256(bytes("rImpostor"));
        vm.expectRevert(XrplCouncilBridge.WrongCouncil.selector);
        bridge.execute(p, od);

        // prueba inválida
        verifier.set(false);
        vm.expectRevert(XrplCouncilBridge.InvalidProof.selector);
        bridge.execute(_proof(od, keccak256("tx-1"), ANCHOR_HASH, 0), od);
        verifier.set(true);

        // ejecuta, y luego el replay y el nonce
        bridge.execute(_proof(od, keccak256("tx-1"), ANCHOR_HASH, 0), od);
        vm.expectRevert(XrplCouncilBridge.TxAlreadyExecuted.selector);
        bridge.execute(_proof(od, keccak256("tx-1"), ANCHOR_HASH, 0), od);

        bytes memory stale = _orderData(0);
        vm.expectRevert(abi.encodeWithSelector(XrplCouncilBridge.NonceMismatch.selector, uint64(1), uint64(0)));
        bridge.execute(_proof(stale, keccak256("tx-2"), ANCHOR_HASH, 0), stale);
    }

    // ═══ REBIND ═══

    function test_only_the_bound_contract_can_rebind() public {
        vm.prank(stranger);
        vm.expectRevert(XrplCouncilBridgeV2.NotBoundVault.selector);
        bridge.rebind(stranger);

        address next = makeAddr("next");
        vm.prank(address(target));
        bridge.rebind(next);
        assertEq(bridge.vault(), next);
    }
}
