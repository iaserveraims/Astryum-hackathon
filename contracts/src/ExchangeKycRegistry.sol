// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title ExchangeKycRegistry — la puerta de usuarios de UN exchange, on-chain
 *
 * @notice Cada exchange tiene su registro: la lista de direcciones (las cuentas
 * de sus clientes en Flare) que ha dado de alta con KYC. Un AstryumVault que
 * apunte a este registro solo deja ENTRAR (depositar) a quien esté aprobado
 * aquí — de modo que los users de un vault son SOLO los clientes de su exchange,
 * y solo con KYC. La salida (redeem) nunca pasa por aquí: se gatea lo que entra,
 * jamás lo que sale (canónico §5-bis).
 *
 * El tag/memo con el que el exchange identifica a su cliente vive en SUS libros;
 * lo que este contrato hace cumplir on-chain es la pertenencia: `approved[user]`.
 * Aprobar a alguien ES declararlo cliente-con-KYC de este exchange.
 *
 * Autoridad: el ADMIN (el operador del exchange / su KYC). Puede transferirse en
 * dos pasos. Este contrato no toca fondos ni participaciones — solo dice quién
 * puede entrar.
 */
contract ExchangeKycRegistry {
    address public admin;
    address public pendingAdmin;

    /// @notice user → aprobado (cliente con KYC de este exchange).
    mapping(address => bool) public approved;

    /// @notice user (su cuenta passkey en Flare) → su destination tag XRPL en el
    /// omnibus del exchange. Es la atadura ON-CHAIN passkey↔tag: cuando el user
    /// desmintea (redeemWithTag), el tag sale de AQUÍ, no de lo que él teclee —
    /// así el XRP vuelve exactamente a su casilla en el exchange. 0 es un tag
    /// válido; `approved[user]` dice si la entrada existe. El tag cabe en 32 bits.
    mapping(address => uint256) public tagOf;

    uint256 internal constant XRPL_DEST_TAG_MAX = 4294967295; // 2^32 − 1

    event Approved(address indexed user, bool ok);
    event TagSet(address indexed user, uint256 tag);
    event AdminTransferStarted(address indexed current, address indexed pending);
    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);

    error NotAdmin();
    error ZeroAddress();
    error TagTooLarge();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address admin_) {
        if (admin_ == address(0)) revert ZeroAddress();
        admin = admin_;
    }

    /// @notice The one question a vault asks before letting a receiver in.
    function isApproved(address user) external view returns (bool) {
        return approved[user];
    }

    /// @notice Approve or revoke ONE client (KYC done / undone).
    function setApproved(address user, bool ok) external onlyAdmin {
        if (user == address(0)) revert ZeroAddress();
        approved[user] = ok;
        emit Approved(user, ok);
    }

    /// @notice Approve a client AND bind their XRPL destination tag in one call
    /// (the natural onboarding step: passkey account P ↔ tag T, on-chain).
    function setApprovedWithTag(address user, uint256 tag, bool ok) external onlyAdmin {
        if (user == address(0)) revert ZeroAddress();
        if (tag > XRPL_DEST_TAG_MAX) revert TagTooLarge();
        approved[user] = ok;
        tagOf[user] = tag;
        emit Approved(user, ok);
        emit TagSet(user, tag);
    }

    /// @notice Set/update just the destination tag of an already-known client.
    function setTag(address user, uint256 tag) external onlyAdmin {
        if (user == address(0)) revert ZeroAddress();
        if (tag > XRPL_DEST_TAG_MAX) revert TagTooLarge();
        tagOf[user] = tag;
        emit TagSet(user, tag);
    }

    /// @notice Approve or revoke MANY at once (an onboarding batch).
    function setApprovedBatch(address[] calldata users, bool ok) external onlyAdmin {
        for (uint256 i = 0; i < users.length; i++) {
            if (users[i] == address(0)) revert ZeroAddress();
            approved[users[i]] = ok;
            emit Approved(users[i], ok);
        }
    }

    // ── Two-step admin handover (a fat-fingered address must not orphan it) ──

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        pendingAdmin = newAdmin;
        emit AdminTransferStarted(admin, newAdmin);
    }

    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert NotAdmin();
        emit AdminTransferred(admin, pendingAdmin);
        admin = pendingAdmin;
        pendingAdmin = address(0);
    }
}
