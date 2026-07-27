// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IXRPPayment} from "./interfaces/IXRPPayment.sol";
import {IXRPPaymentVerification} from "./interfaces/IXRPPaymentVerification.sol";

/// The Flare Contract Registry — same address on every Flare network
/// (flare / songbird / coston / coston2). Resolved fresh on every execute so
/// verifier upgrades by Flare governance are followed automatically.
interface IFlareContractRegistry {
    function getContractAddressByName(string calldata _name) external view returns (address);
}

/**
 * @title XrplCouncilBridge — "XRPL governs" made literal (roadmap Pieza 1)
 *
 * @notice This contract IS the `council` of a LegacyVault. It holds no funds and
 * has no owner with power: its only capability is to forward to the vault an
 * order that the XRPL council's QUORUM already signed on the XRP Ledger, after
 * verifying an FDC `XRPPayment` proof of that signed transaction.
 *
 * The authority chain (zero discretion at every link):
 *   1. The council multi-signs a 1-drop XRPL Payment whose first Memo commits
 *      `keccak256(orderData)` — the exact bytes of the vault call (0xFE pattern,
 *      proven on mainnet by the direct-minting rail).
 *   2. FDC data providers attest that validated XRPL transaction; only the
 *      Merkle root lives on-chain.
 *   3. Anyone (a keeper, a member, a stranger) delivers {proof, orderData} here.
 *      The messenger has no power: the proof either verifies or it does not,
 *      and the orderData either matches the committed hash or it does not.
 *   4. The bridge calls the vault with EXACTLY the committed calldata. The
 *      vault's own cage decides what that call may do — this bridge adds no
 *      rights the council address would not have.
 *
 * TRUST-MODEL LIMIT (stated, never hidden): FDC attests transactions, not
 * ledger state. This contract cannot prove on-chain that the council account
 * has its master key disabled and no RegularKey. That is a ceremony fact —
 * auditable by anyone on XRPL, enforced by the constitution ritual, outside
 * Solidity's reach. If the account is multisig-only, the validity of the
 * attested transaction IS the proof of quorum.
 *
 * Replay & ordering: a consumed `transactionId` can never execute again, and
 * orders carry a sequential nonce — two in-flight orders cannot land crossed.
 *
 * @dev `proofOwner` binds each attestation to THIS consumer: a proof prepared
 * for another contract does not verify here, and vice versa.
 */
contract XrplCouncilBridge {
    // ── Immutable identity ───────────────────────────────────────────────────

    /// @notice FDC standard address hash of the XRPL council account:
    /// keccak256(bytes(rAddress)) — no lowercasing (FDC spec).
    bytes32 public immutable COUNCIL_ADDRESS_HASH;

    /// @notice Expected FDC source: bytes32("XRP") on mainnet,
    /// bytes32("testXRP") on Coston2. Defense-in-depth next to the verifier.
    bytes32 public immutable SOURCE_ID;

    /// @notice The Flare Contract Registry (identical across Flare networks).
    IFlareContractRegistry public constant REGISTRY =
        IFlareContractRegistry(0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019);

    bytes32 private constant ATTESTATION_TYPE_XRP_PAYMENT = bytes32("XRPPayment");

    /// @notice Deployer — its ONLY power is the one-shot bind() below.
    address public immutable DEPLOYER;

    // ── State ────────────────────────────────────────────────────────────────

    /// @notice The one target this bridge can ever call. Set once, then frozen.
    address public vault;

    /// @notice Sequential order nonce (next expected).
    uint64 public nextNonce;

    /// @notice XRPL transactionIds already executed — one signed tx, one effect.
    mapping(bytes32 => bool) public consumedTxId;

    // ── Events ───────────────────────────────────────────────────────────────

    event Bound(address indexed vault);
    event OrderExecuted(bytes32 indexed transactionId, uint64 indexed nonce, bytes4 selector);

    // ── Errors ───────────────────────────────────────────────────────────────

    error NotDeployer();
    error AlreadyBound();
    error NotBound();
    error ZeroAddress();
    error InvalidProof();
    error WrongAttestationType();
    error WrongSource();
    error WrongProofOwner();
    error WrongCouncil();
    error PaymentFailedOnXrpl(uint8 status);
    error NoMemo();
    error MemoMismatch();
    error TxAlreadyExecuted();
    error NonceMismatch(uint64 expected, uint64 actual);
    error EmptyOrder();

    // ── Birth ────────────────────────────────────────────────────────────────

    /// @param councilAddressHash keccak256 of the council's r-address bytes
    ///        (FDC standard address hash — computed off-chain, checked twice).
    /// @param sourceId bytes32("XRP") or bytes32("testXRP").
    constructor(bytes32 councilAddressHash, bytes32 sourceId) {
        if (councilAddressHash == bytes32(0) || sourceId == bytes32(0)) revert ZeroAddress();
        COUNCIL_ADDRESS_HASH = councilAddressHash;
        SOURCE_ID = sourceId;
        DEPLOYER = msg.sender;
    }

    /// @notice One-shot: point this bridge at its vault. Done right after the
    /// vault is deployed with THIS bridge as `council_` (the EVM mirror never
    /// exists). After bind, the deployer holds no power at all.
    function bind(address vault_) external {
        if (msg.sender != DEPLOYER) revert NotDeployer();
        if (vault != address(0)) revert AlreadyBound();
        if (vault_ == address(0)) revert ZeroAddress();
        vault = vault_;
        emit Bound(vault_);
    }

    // ── The single entry point ───────────────────────────────────────────────

    /**
     * @notice Execute a quorum-signed council order. Permissionless: the proof
     * is the authority, whoever carries it.
     * @param proof FDC XRPPayment proof of the council's XRPL transaction.
     * @param orderData abi.encode(uint64 nonce, bytes vaultCalldata) — the
     *        exact bytes whose keccak256 the council committed in the memo.
     */
    function execute(IXRPPayment.Proof calldata proof, bytes calldata orderData) external {
        address vault_ = vault;
        if (vault_ == address(0)) revert NotBound();

        // 1. The proof is genuine (Merkle inclusion against FDC's on-chain root).
        IXRPPaymentVerification verifier =
            IXRPPaymentVerification(REGISTRY.getContractAddressByName("FdcVerification"));
        if (!verifier.verifyXRPPayment(proof)) revert InvalidProof();

        // 2. Defense-in-depth on the attested envelope.
        if (proof.data.attestationType != ATTESTATION_TYPE_XRP_PAYMENT) revert WrongAttestationType();
        if (proof.data.sourceId != SOURCE_ID) revert WrongSource();
        if (proof.data.requestBody.proofOwner != address(this)) revert WrongProofOwner();

        // 3. The order comes from THE council account and succeeded on XRPL.
        if (proof.data.responseBody.sourceAddressHash != COUNCIL_ADDRESS_HASH) revert WrongCouncil();
        if (proof.data.responseBody.status != 0) revert PaymentFailedOnXrpl(proof.data.responseBody.status);

        // 4. The delivered bytes are EXACTLY what the quorum committed to.
        if (!proof.data.responseBody.hasMemoData || proof.data.responseBody.firstMemoData.length != 32) {
            revert NoMemo();
        }
        if (
            keccak256(proof.data.responseBody.firstMemoData)
                != keccak256(abi.encodePacked(keccak256(orderData)))
        ) revert MemoMismatch();

        // 5. Replay (per-tx) + ordering (sequential nonce).
        bytes32 txId = proof.data.requestBody.transactionId;
        if (consumedTxId[txId]) revert TxAlreadyExecuted();
        consumedTxId[txId] = true;

        (uint64 nonce, bytes memory vaultCalldata) = abi.decode(orderData, (uint64, bytes));
        if (nonce != nextNonce) revert NonceMismatch(nextNonce, nonce);
        nextNonce = nonce + 1;
        if (vaultCalldata.length < 4) revert EmptyOrder();

        // 6. Forward the committed call to the ONE target. The vault's cage
        //    (no withdrawPrincipal, whitelists, delays) rules what it may do.
        (bool ok, bytes memory ret) = vault_.call(vaultCalldata);
        if (!ok) {
            // Bubble the vault's own revert reason — honest errors upstream.
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }

        emit OrderExecuted(txId, nonce, bytes4(vaultCalldata));
    }
}
