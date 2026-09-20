// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {XrplCouncilBridge, IFlareContractRegistry} from "./XrplCouncilBridge.sol";
import {IXRPPayment} from "./interfaces/IXRPPayment.sol";
import {IXRPPaymentVerification} from "./interfaces/IXRPPaymentVerification.sol";

/**
 * @title XrplCouncilBridgeV2 — el bridge de la jaula, con las dos lecciones de la v1
 *
 * @notice Idéntico al bridge v1 (verificación FDC, replay, nonce) más DOS cosas:
 *
 * 1. **`rebind`**, solo por la jaula atada. `bind` es one-shot y un bridge atado a
 *    un contrato jamás hablará con su sucesor: por eso el `migrate` del LegacyVault
 *    v1 no puede llevar su capital a ninguna estructura gobernada. Aquí, dentro de
 *    `executeSuccession`, la jaula atada pasa el testigo — nadie más puede.
 *
 * 2. **El DESTINO se comprueba.** La v1 valida origen, memo, estado y nonce, pero no
 *    a quién se pagó — por diseño declarado: «la autoridad es origen + memo, jamás el
 *    destino». Eso valía mientras el ancla solo cobraba la fee. Deja de valer en
 *    cuanto el ancla es una PUERTA: una cuenta con `DepositAuth` +
 *    `DepositPreauth{AuthorizeCredentials}` que solo acepta pagos de quien lleva un
 *    título XLS-70 válido. Sin comprobar el destino, un gestor mandaría su orden a
 *    otra cuenta y se saltaría la puerta. Con `ANCHOR_ADDRESS_HASH` inmutable, la
 *    orden solo cuenta si ATERRIZÓ en el ancla — y si el ledger la rechazó
 *    (`tecNO_PERMISSION`), FDC la atestigua con estado ≠ 0 y el bridge la ignora.
 *
 *    La puerta la pone el consenso de XRPL, antes de llegar a nosotros. Este
 *    contrato solo se niega a ejecutar lo que no pasó por ella.
 *
 * El ancla se fija al nacer y no cambia. Su dueño administra la lista de emisores
 * (`DepositPreauth`), y con eso puede impedir órdenes NUEVAS; no puede mover
 * capital, ni tocar participaciones, ni impedir que un usuario redima — la salida
 * no pasa por el ancla.
 *
 * El bridge v1 de mainnet no se toca: este se despliega solo con jaulas nuevas.
 */
contract XrplCouncilBridgeV2 is XrplCouncilBridge {
    /// @notice keccak256(bytes(r-address)) del ancla — sin lowercasing (spec FDC).
    ///         Fijado al nacer, jamás cambiable.
    bytes32 public immutable ANCHOR_ADDRESS_HASH;

    /// @dev El mismo valor que la constante privada del v1, redeclarado aquí.
    bytes32 private constant ATTESTATION_TYPE_XRP_PAYMENT_V2 = bytes32("XRPPayment");

    event Rebound(address indexed previousVault, address indexed newVault);

    error NotBoundVault();
    error ZeroAnchor();
    error WrongAnchor();

    constructor(bytes32 councilAddressHash, bytes32 sourceId, bytes32 anchorAddressHash)
        XrplCouncilBridge(councilAddressHash, sourceId)
    {
        if (anchorAddressHash == bytes32(0)) revert ZeroAnchor();
        ANCHOR_ADDRESS_HASH = anchorAddressHash;
    }

    /// @notice Solo el contrato atado ahora mismo puede pasar el testigo. Nadie más.
    function rebind(address newVault) external {
        if (msg.sender != vault) revert NotBoundVault();
        if (newVault == address(0)) revert ZeroAddress();
        emit Rebound(vault, newVault);
        vault = newVault;
    }

    /**
     * @notice Ejecutar una orden firmada por la cuenta XRPL. Permissionless: la
     * prueba es la autoridad, la lleve quien la lleve. Mismas comprobaciones que
     * la v1, más el destino.
     */
    function execute(IXRPPayment.Proof calldata proof, bytes calldata orderData) external override {
        address vault_ = vault;
        if (vault_ == address(0)) revert NotBound();

        // 1. La prueba es genuina (inclusión Merkle contra la raíz on-chain de FDC).
        IXRPPaymentVerification verifier =
            IXRPPaymentVerification(REGISTRY.getContractAddressByName("FdcVerification"));
        if (!verifier.verifyXRPPayment(proof)) revert InvalidProof();

        // 2. Defensa en profundidad sobre el sobre atestiguado.
        if (proof.data.attestationType != ATTESTATION_TYPE_XRP_PAYMENT_V2) revert WrongAttestationType();
        if (proof.data.sourceId != SOURCE_ID) revert WrongSource();
        if (proof.data.requestBody.proofOwner != address(this)) revert WrongProofOwner();

        // 3. La orden viene de LA cuenta, ATERRIZÓ EN EL ANCLA, y tuvo éxito en XRPL.
        //    FDC pone receivingAddressHash a cero si el pago falló: un rechazo del
        //    ledger (DepositAuth sin título válido) nunca pasa de aquí.
        if (proof.data.responseBody.sourceAddressHash != COUNCIL_ADDRESS_HASH) revert WrongCouncil();
        if (proof.data.responseBody.receivingAddressHash != ANCHOR_ADDRESS_HASH) revert WrongAnchor();
        if (proof.data.responseBody.status != 0) revert PaymentFailedOnXrpl(proof.data.responseBody.status);

        // 4. Los bytes entregados son EXACTAMENTE lo que la cuenta comprometió.
        if (!proof.data.responseBody.hasMemoData || proof.data.responseBody.firstMemoData.length != 32) {
            revert NoMemo();
        }
        if (
            keccak256(proof.data.responseBody.firstMemoData)
                != keccak256(abi.encodePacked(keccak256(orderData)))
        ) revert MemoMismatch();

        // 5. Replay (por tx) + orden (nonce secuencial).
        bytes32 txId = proof.data.requestBody.transactionId;
        if (consumedTxId[txId]) revert TxAlreadyExecuted();
        consumedTxId[txId] = true;

        (uint64 nonce, bytes memory vaultCalldata) = abi.decode(orderData, (uint64, bytes));
        if (nonce != nextNonce) revert NonceMismatch(nextNonce, nonce);
        nextNonce = nonce + 1;
        if (vaultCalldata.length < 4) revert EmptyOrder();

        // 6. Reenviar la llamada comprometida al ÚNICO destino. La jaula decide
        //    qué puede hacer; el revert real sube entero.
        (bool ok, bytes memory ret) = vault_.call(vaultCalldata);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }

        emit OrderExecuted(txId, nonce, bytes4(vaultCalldata));
    }
}
