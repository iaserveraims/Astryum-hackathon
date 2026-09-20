// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {AstryumVault} from "./AstryumVault.sol";
import {AstryumVaultV2} from "./AstryumVaultV2.sol";
import {AstryumRegistry} from "./AstryumRegistry.sol";
import {XrplCouncilBridgeV2} from "./XrplCouncilBridgeV2.sol";
import {PoteParams} from "./PoteParams.sol";

/**
 * @title PoteDeployer — el bytecode del pote, fuera de la jaula y compartido
 *
 * @notice Un solo deployer por chain, para todas las jaulas. Existe por EIP-170:
 * el bytecode de un ERC-4626 entero no cabe anidado dentro de la jaula, y la
 * jaula no cabe anidada dentro de su factory. Cualquiera puede llamarlo — es
 * inofensivo: el salt lleva al que llama, así que nadie puede ocupar la
 * dirección predicha de un pote ajeno, y el pote que nace tiene como consejo
 * exactamente a quien lo pidió. Un pote fabricado por alguien que no es una
 * jaula es suyo, no está en ningún registro y ningún catálogo lo enseña.
 */
contract PoteDeployer {
    /// @notice Dónde vive el initcode del pote (ver `PoteCode`). Inmutable: el
    ///         código que nace de aquí es siempre el mismo, byte a byte.
    address public immutable POTE_CODE;

    error PoteCodeEmpty();

    constructor() {
        POTE_CODE = address(new PoteCode());
    }

    /// @dev initcode = creationCode del AstryumVaultV2 (leído del contrato-dato,
    ///      sin su STOP) ++ abi.encode(args). Idéntico al que produciría `new`.
    function _initCode(
        IERC20 asset,
        address council,
        bytes32 constitutionRef,
        AstryumRegistry registry,
        PoteParams calldata p
    ) internal view returns (bytes memory) {
        address src = POTE_CODE;
        uint256 size = src.code.length;
        if (size < 2) revert PoteCodeEmpty();
        bytes memory creation = new bytes(size - 1);
        assembly {
            extcodecopy(src, add(creation, 0x20), 1, sub(size, 1))
        }
        return abi.encodePacked(creation, abi.encode(asset, council, constitutionRef, registry, p));
    }

    function deploy(
        bytes32 salt,
        IERC20 asset,
        bytes32 constitutionRef,
        AstryumRegistry registry,
        PoteParams calldata p
    ) external returns (address pote) {
        // El consejo del pote es quien lo pide: la jaula.
        bytes memory code = _initCode(asset, msg.sender, constitutionRef, registry, p);
        bytes32 s = keccak256(abi.encode(msg.sender, salt));
        assembly {
            pote := create2(0, add(code, 0x20), mload(code), s)
            // Si el constructor del pote revierte (venue fuera del registro, pote
            // privado sin puerta…), su motivo sube tal cual: nada se traga.
            if iszero(pote) {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        }
    }

    function poteInitCodeHash(
        IERC20 asset,
        address council,
        bytes32 constitutionRef,
        AstryumRegistry registry,
        PoteParams calldata p
    ) external view returns (bytes32) {
        return keccak256(_initCode(asset, council, constitutionRef, registry, p));
    }
}

/**
 * @title PoteCode — el initcode del AstryumVaultV2, guardado como bytecode
 *
 * @notice Existe por EIP-170, otra vez: el pote creció (tope por cuenta) y su
 * initcode ya no cabe ANIDADO dentro del deployer (24.576 B de techo para el
 * runtime de cada contrato). Aquí el initcode ES el runtime de este contrato
 * (patrón SSTORE2), con un STOP (0x00) delante para que llamarlo no ejecute
 * nada. `PoteDeployer` lo copia con `extcodecopy` y hace el `create2` él mismo.
 * El pote que nace es idéntico al que produciría `new AstryumVaultV2{salt}(…)`.
 */
contract PoteCode {
    constructor() {
        bytes memory runtime = abi.encodePacked(hex"00", type(AstryumVaultV2).creationCode);
        assembly {
            return(add(runtime, 0x20), mload(runtime))
        }
    }
}

/**
 * @title AstryumCage — la jaula v2: el pasillo guiado de lo que se puede hacer
 *
 * @notice Un contrato de mando por autoridad (cuenta XRPL), desplegado una vez y
 * nunca redesplegado. Crea potes ERC-4626 y les envía órdenes acotadas. **No
 * custodia nada, jamás**: el capital vive en los potes, en la chain donde
 * trabaja, y los depositantes entran y salen contra el pote sin pasar por aquí.
 * Un manager que quiera invertir lo suyo entra por la misma puerta que todos.
 *
 * Sirve hoy a exchanges y managers; cuando PMW exista, a familias — mandando
 * wallets XRPL de las que nunca tendrá las llaves.
 *
 * ── DÓNDE VIVE LA PREMISA (y por qué NO aquí) ──────────────────────────────
 *
 * «El principal no se puede retirar» no puede vivir en el contrato que se
 * upgradea. Vive en dos sitios que ninguna jaula, ni una sucesora maliciosa,
 * puede tocar: (1) el pote, eterno, sin `withdrawPrincipal`, donde solo el holder
 * redime lo suyo; (2) el `AstryumRegistry`, que el propio pote consulta en
 * `_addVenue`. Aquí solo hay, OPCIONALMENTE, una auto-restricción del manager por
 * encima de ese suelo: una lista eterna de destinos, ⊆ registro, que ninguna
 * función amplía. Una jaula nacida SIN lista sigue al registro de Astryum tal y
 * como esté cada día.
 *
 * ── LA BASE ES LA DEL LEGACY ───────────────────────────────────────────────
 *
 * Autoridad eterna (el bridge de su cuenta XRPL) · director cedido que caduca
 * solo · el director dirige capital pero NO decide el catálogo ni el cobro ·
 * toda mutación atada al `constitutionRef` vigente · 30 días para todo lo que
 * añade destinos (en el pote) o cambia de jaula (aquí).
 *
 * ── LO QUE ESTE CONTRATO NO TIENE, A PROPÓSITO ─────────────────────────────
 *
 * Ni `receive`, ni `fallback`, ni `sweep`: lo que alguien le mande por error
 * queda bloqueado, porque una función que saque tokens de aquí es exactamente la
 * función que no puede existir. Ninguna función sobre participaciones. Ningún
 * `call` genérico: cada orden es una función escrita. Ninguna lectura del estado
 * del pote para decidir: el pote es el juez, esto es el pasillo. Ninguna
 * atestación: las órdenes llegan verificadas del bridge. Y `transferCouncil`
 * hacia los potes solo dentro de una sucesión con las cinco continuidades.
 *
 * ── ENVIAR Y RECIBIR ÓRDENES REMOTAS (la forma PMW) ────────────────────────
 *
 * Los destinos tienen localidad. Local: la orden se ejecuta en el acto. Remoto:
 * se EMITE una instrucción con nonce único, unas TEE la firman fuera como k-de-n,
 * y la prueba de ejecución vuelve por FDC a `settleRemoteInstruction`, una sola
 * vez. Hoy `_dispatchRemote` REVIERTE: PMW no es público, y PMW se compone,
 * jamás se depende de él. Es el marco de la puerta, sin la hoja. Cuando exista,
 * la jaula compondrá ella misma el memo del 0xFE a partir de parámetros tipados —
 * jamás aceptará uno crudo.
 */
contract AstryumCage {
    using SafeERC20 for IERC20;

    // ── Identidad inmutable ──────────────────────────────────────────────────

    /// @notice El bridge XRPL de esta jaula: la única voz que obedece.
    address public immutable AUTHORITY;
    IERC20 public immutable ASSET;
    /// @notice El scanner de Astryum. Inmutable: nadie cambia quién vigila.
    AstryumRegistry public immutable REGISTRY;
    /// @notice A quién y cuánto se paga por cada pote nuevo. Directo, sin pasar por aquí.
    address public immutable TREASURY;
    uint256 public immutable CREATION_FEE;
    /**
     * @notice El tope de payees que esta jaula puede dar a un pote al nacer.
     *
     * Política de Astryum, fijada por la factory, no del manager. El pote SABE
     * pagar hasta el 100% a sus payees si nace con puerta (el mecanismo de la
     * familia) — pero un pote de exchange también tiene puerta (el KYC) y sus
     * depositantes son terceros. Sin este tope, un exchange podría fijarse el
     * 100% del yield de sus clientes. Para la generación de hoy (exchanges y
     * managers) es 2000; una factory futura para familias podrá fijar 10000.
     * Un sucesor de esta jaula nunca puede tenerlo más alto (continuidad).
     */
    uint16 public immutable MAX_PAYEE_BPS_ALLOWED;
    /// @notice Cuántos potes abre esta jaula sin pagar `CREATION_FEE` (solo el gas).
    ///         A partir del siguiente, la fee va a la tesorería. Política de la
    ///         factory (3 en la generación de hoy), no del manager.
    uint16 public immutable FREE_POTES;
    PoteDeployer public immutable DEPLOYER;
    /// @notice La chain donde vive esta jaula; sus potes locales viven aquí.
    uint32 public immutable CHAIN_ID;

    uint32 public constant SUCCESSION_DELAY = 30 days;

    // ── La lista eterna de destinos, por (chainId, target) ───────────────────

    struct Target {
        uint32 chainId;
        address target;
    }

    /// @dev Array privado sin un solo `push` fuera del constructor: inmutable de un
    ///      vistazo, que es el vistazo que un auditor y un depositante tienen que
    ///      poder dar. El mapping es solo el índice. VACÍO = «sin auto-restricción»:
    ///      la jaula sigue al registro de Astryum (`isAllowedTarget` lo consulta).
    Target[] private _allowedTargets;
    mapping(bytes32 => bool) private _isAllowed;

    // ── Gobierno (misma forma que LegacyVault) ───────────────────────────────

    bytes32 public constitutionRef;
    address public director;
    uint64 public directorUntil;

    // ── Potes locales ────────────────────────────────────────────────────────

    address[] public potes;
    mapping(address => bool) public isMyPote;

    // ── Potes y wallets remotos (PMW) ────────────────────────────────────────

    struct RemotePote {
        uint32 chainId;
        address pote;
    }

    struct RemoteWallet {
        uint32 chainId;
        bytes32 walletId;
    }

    // La ficha de nacimiento de un pote es `PoteParams` (src/PoteParams.sol):
    // la comparten esta jaula, el deployer y el constructor del pote.

    RemotePote[] public remotePotes;
    RemoteWallet[] public remoteWallets;

    // ── Instrucciones remotas ────────────────────────────────────────────────

    enum InstructionKind {
        MINT_INTO_POTE, // XRP de la wallet → 0xFE → FXRP a su PA → deposit en el pote
        REDEEM_TO_OWN_WALLET, // shares de la PA → redeem → unmint → la MISMA wallet
        PAY_REGISTRY_DESTINATION, // pago a un destino del registro (agente FAssets, AMM…)
        POTE_ORDER // una orden tipada para un pote remoto (proposeVenue, directTo…)
    }

    enum InstructionState {
        NONE,
        PENDING,
        EXECUTED,
        FAILED
    }

    struct RemoteInstruction {
        uint64 nonce;
        InstructionKind kind;
        uint32 chainId;
        bytes32 walletId;
        address pote;
        bytes32 target;
        uint256 amount;
        bytes32 dataHash;
        InstructionState state;
    }

    uint64 public nextInstructionNonce;
    mapping(uint64 => RemoteInstruction) public instructions;

    // ── Sucesión ─────────────────────────────────────────────────────────────

    address public successor;
    uint64 public successorEta;
    bool public succeeded;

    // ── Eventos ──────────────────────────────────────────────────────────────

    event PoteCreated(address indexed pote, uint256 indexed index, string name, uint48 cooldown, uint16 maxPayeeBps);
    event CreationFeePaid(address indexed payer, address indexed treasury, uint256 amount);
    event PoteOrder(address indexed pote, bytes4 indexed selector, bytes32 ref);
    event PoteAdopted(address indexed pote);
    event CessionGranted(address indexed director, uint64 until, bytes32 ref);
    event CessionEnded(bytes32 ref);
    event ConstitutionRefUpdated(bytes32 oldRef, bytes32 newRef);
    event RemotePoteRegistered(uint32 indexed chainId, address indexed pote);
    event RemoteWalletRegistered(uint32 indexed chainId, bytes32 indexed walletId);
    event RemoteInstructionIssued(
        uint64 indexed nonce,
        InstructionKind indexed kind,
        uint32 chainId,
        bytes32 walletId,
        address pote,
        bytes32 target,
        uint256 amount,
        bytes data
    );
    event RemoteInstructionSettled(uint64 indexed nonce, bool executed, uint256 observedValue);
    event SuccessorProposed(address indexed successor, uint64 eta, bytes32 ref);
    event SuccessorCancelled(address indexed successor, bytes32 ref);
    event SuccessionExecuted(address indexed successor, uint256 potesHandedOver);

    // ── Errores ──────────────────────────────────────────────────────────────

    error NotAuthority();
    error NotDirectorOrAuthority();
    error ZeroAddress();
    error PayeeCapAboveCagePolicy(uint16 requested, uint16 allowed);
    error DuplicateAllowedTarget(uint32 chainId, address target);
    error TargetNotInRegistry(uint32 chainId, address target);
    error TargetNotAllowed(uint32 chainId, address target);
    error DestinationNotInRegistry(uint32 chainId, bytes32 destination);
    error NotMyPote(address pote);
    error RefMismatch();
    error OrderFailed(bytes reason);
    error RemoteNotSupportedYet();
    error UnknownInstruction(uint64 nonce);
    error InstructionNotPending(uint64 nonce);
    error UnknownWallet(uint256 index);
    error SuccessorNotSet();
    error SuccessorNotMature();
    error ContinuityBroken(string what);
    error AlreadySucceeded();
    error NotPendingCouncilOf(address pote);

    // ── Modificadores ────────────────────────────────────────────────────────

    modifier onlyAuthority() {
        if (msg.sender != AUTHORITY) revert NotAuthority();
        _;
    }

    /// @notice El día a día lo puede llevar un director cedido; la cesión caduca sola.
    modifier onlyDirectorOrAuthority() {
        if (!(msg.sender == AUTHORITY || (msg.sender == director && block.timestamp < directorUntil))) {
            revert NotDirectorOrAuthority();
        }
        _;
    }

    /// @notice Toda mutación viaja con la constitución vigente: una caducada revierte.
    modifier withRef(bytes32 ref) {
        if (ref != constitutionRef) revert RefMismatch();
        _;
    }

    /// @notice Tras pasar el testigo, esta jaula ya no manda nada.
    modifier notSucceeded() {
        if (succeeded) revert AlreadySucceeded();
        _;
    }

    /**
     * @param authority el XrplCouncilBridgeV2 de la cuenta XRPL dueña de esta jaula.
     * @param registry el scanner de Astryum de esta chain.
     * @param freePotes cuántos potes nacen sin `creationFee` (política de la factory).
     * @param allowedTargets_ la lista ETERNA, OPCIONAL: si viene, es todo lo que
     *        este manager podrá tocar jamás, y cada entrada tiene que estar YA en
     *        el registro — ⊆ al nacer. Si viene vacía, la jaula sigue al registro
     *        de Astryum tal y como esté en cada momento.
     */
    constructor(
        address authority,
        IERC20 asset,
        AstryumRegistry registry,
        bytes32 constitutionRef_,
        address treasury,
        uint256 creationFee,
        uint16 maxPayeeBpsAllowed,
        uint16 freePotes,
        PoteDeployer deployer,
        Target[] memory allowedTargets_
    ) {
        if (maxPayeeBpsAllowed > 10_000) revert PayeeCapAboveCagePolicy(maxPayeeBpsAllowed, 10_000);
        if (
            authority == address(0) || address(asset) == address(0) || address(registry) == address(0)
                || treasury == address(0) || address(deployer) == address(0)
        ) revert ZeroAddress();

        for (uint256 i = 0; i < allowedTargets_.length; i++) {
            Target memory t = allowedTargets_[i];
            if (t.target == address(0)) revert ZeroAddress();
            bytes32 key = _key(t.chainId, t.target);
            if (_isAllowed[key]) revert DuplicateAllowedTarget(t.chainId, t.target);
            if (!registry.isApprovedTarget(t.chainId, t.target)) revert TargetNotInRegistry(t.chainId, t.target);
            _isAllowed[key] = true;
            _allowedTargets.push(t);
        }

        AUTHORITY = authority;
        ASSET = asset;
        REGISTRY = registry;
        TREASURY = treasury;
        CREATION_FEE = creationFee;
        MAX_PAYEE_BPS_ALLOWED = maxPayeeBpsAllowed;
        FREE_POTES = freePotes;
        DEPLOYER = deployer;
        CHAIN_ID = uint32(block.chainid);
        constitutionRef = constitutionRef_;
    }

    // NOTA DELIBERADA: ni receive() ni fallback(). Esta jaula no puede recibir
    // nativo, y no tiene ninguna función que mueva un ERC-20 desde ella.

    // ── Lecturas ─────────────────────────────────────────────────────────────

    function allowedTargets() external view returns (Target[] memory) {
        return _allowedTargets;
    }

    function allowedTargetCount() external view returns (uint256) {
        return _allowedTargets.length;
    }

    /// @notice true ⇔ esta jaula nació sin lista propia y sigue al registro de Astryum.
    function registryOnly() public view returns (bool) {
        return _allowedTargets.length == 0;
    }

    /// @notice El candado, en una función. Con lista propia: solo lo que está en
    ///         ella. Sin lista: lo que el registro de Astryum apruebe HOY — así un
    ///         venue nuevo aprobado mañana queda disponible sin tocar la jaula, y
    ///         uno retirado deja de estarlo en el acto.
    function isAllowedTarget(uint32 chainId, address target) public view returns (bool) {
        if (_allowedTargets.length == 0) return REGISTRY.isApprovedTarget(chainId, target);
        return _isAllowed[_key(chainId, target)];
    }

    function poteCount() external view returns (uint256) {
        return potes.length;
    }

    /// @notice Cuántos potes más nacen sin fee de creación.
    function freePotesLeft() external view returns (uint256) {
        return potes.length >= FREE_POTES ? 0 : FREE_POTES - potes.length;
    }

    function remotePoteCount() external view returns (uint256) {
        return remotePotes.length;
    }

    function remoteWalletCount() external view returns (uint256) {
        return remoteWallets.length;
    }

    // ── Nacimiento de un pote ────────────────────────────────────────────────

    /**
     * @notice Un pote nuevo, con esta jaula como su consejo. Eterno en su forma.
     *
     * Sus venues iniciales pasan por la lista eterna aquí (o por el registro, si
     * la jaula no tiene lista) y por el registro en el propio pote. Los primeros
     * `FREE_POTES` potes solo cuestan el gas; a partir del siguiente, la fee de
     * creación va DIRECTA del pagador a la tesorería — nunca toca esta jaula.
     * `feePayer` aprobó antes; solo la autoridad decide quién paga.
     *
     * `maxDepositPerUser` es el tope de posición por cuenta receptora en el pote
     * (0 = sin tope); el pote lo aplica en `maxDeposit`/`maxMint` y el consejo lo
     * puede cambiar después con `setMaxDepositPerUser`.
     */
    function createPote(PoteParams calldata p, bytes32 ref, address feePayer)
        external
        onlyAuthority
        withRef(ref)
        notSucceeded
        returns (address pote)
    {
        for (uint256 i = 0; i < p.initialVenues.length; i++) {
            if (!isAllowedTarget(CHAIN_ID, p.initialVenues[i].target)) {
                revert TargetNotAllowed(CHAIN_ID, p.initialVenues[i].target);
            }
        }

        // La política de Astryum sobre el cobro, antes que el mecanismo del pote:
        // un exchange tiene puerta (KYC) y depositantes terceros a la vez.
        if (p.maxPayeeBps > MAX_PAYEE_BPS_ALLOWED) revert PayeeCapAboveCagePolicy(p.maxPayeeBps, MAX_PAYEE_BPS_ALLOWED);

        if (CREATION_FEE > 0 && potes.length >= FREE_POTES) {
            ASSET.safeTransferFrom(feePayer, TREASURY, CREATION_FEE);
            emit CreationFeePaid(feePayer, TREASURY, CREATION_FEE);
        }

        pote = DEPLOYER.deploy(bytes32(potes.length), ASSET, ref, REGISTRY, p);

        isMyPote[pote] = true;
        potes.push(pote);
        emit PoteCreated(pote, potes.length - 1, p.name, p.cooldown, p.maxPayeeBps);
    }

    /**
     * @notice Completar un traspaso ya decidido por una jaula anterior.
     *
     * Lo ordena la AUTORIDAD (el consejo), no cualquiera. Nació permissionless
     * con el razonamiento «no se puede adoptar un pote que no nos espera», y ese
     * razonamiento era falso: `pendingCouncil()` lo contesta el propio candidato,
     * así que cualquiera desplegaba un contrato de cuatro líneas que dijera
     * esperarnos, lo metía en `potes` —un array que SOLO CRECE— y a partir de ahí
     * `setConstitutionRef` y `executeSuccession`, que lo iteran entero sin
     * try/catch, revertían para siempre: la jaula quedaba incapaz de enmendar su
     * constitución y de sucederse, que es justo lo que la v2 existe para poder
     * hacer. Coste del ataque: un despliegue. PoC en `AstryumCage.poison.t.sol`.
     *
     * Adoptar un pote es un acto de GOBIERNO, no una tarea de conserje: quien
     * acaba de ordenar la sucesión está, por definición, disponible para ordenar
     * también la adopción. Lo que sigue siendo cierto es que no se puede adoptar
     * un pote que no nos espera — eso lo comprueba el propio pote.
     */
    function acceptPote(address pote) external onlyAuthority notSucceeded {
        AstryumVault v = AstryumVault(pote);
        if (v.pendingCouncil() != address(this)) revert NotPendingCouncilOf(pote);
        v.acceptCouncil();
        if (!isMyPote[pote]) {
            isMyPote[pote] = true;
            potes.push(pote);
        }
        emit PoteAdopted(pote);
    }

    // ── Órdenes locales — el catálogo es solo de la autoridad ────────────────

    /// @notice La función que esta jaula existe para atar: ⊆ lista eterna aquí,
    ///         ⊆ registro en el pote. Un destino retirado del registro ya no entra.
    function proposeVenue(address pote, address target, AstryumVault.VenueKind kind, bytes32 ref)
        external
        onlyAuthority
        withRef(ref)
        notSucceeded
    {
        _mine(pote);
        if (!isAllowedTarget(CHAIN_ID, target)) revert TargetNotAllowed(CHAIN_ID, target);
        if (!REGISTRY.isApprovedVenue(CHAIN_ID, target, uint8(kind))) revert TargetNotInRegistry(CHAIN_ID, target);
        _order(pote, abi.encodeCall(AstryumVault.proposeVenue, (target, kind, ref)), ref);
    }

    function retireVenue(address pote, uint256 venueId, bytes32 ref) external onlyAuthority withRef(ref) notSucceeded {
        _mine(pote);
        _order(pote, abi.encodeCall(AstryumVault.retireVenue, (venueId, ref)), ref);
    }

    function evacuate(address pote, uint256 venueId, bytes32 ref) external onlyAuthority withRef(ref) notSucceeded {
        _mine(pote);
        _order(pote, abi.encodeCall(AstryumVault.evacuate, (venueId, ref)), ref);
    }

    function setMaxVenueBps(address pote, uint16 bps, bytes32 ref) external onlyAuthority withRef(ref) notSucceeded {
        _mine(pote);
        _order(pote, abi.encodeCall(AstryumVault.setMaxVenueBps, (bps, ref)), ref);
    }

    /// @notice El calendario de cobro. El tope vive en el pote (abierto ≤ 20%).
    function setPayees(address pote, address[] calldata accounts, uint16[] calldata bps, bytes32 ref)
        external
        onlyAuthority
        withRef(ref)
        notSucceeded
    {
        _mine(pote);
        _order(pote, abi.encodeCall(AstryumVault.setPayees, (accounts, bps, ref)), ref);
    }

    /// @notice Entry-only en el pote; un pote privado no puede abrirse jamás.
    function setUserGate(address pote, address gate, bytes32 ref) external onlyAuthority withRef(ref) notSucceeded {
        _mine(pote);
        _order(pote, abi.encodeCall(AstryumVault.setUserGate, (gate, ref)), ref);
    }

    /// @notice El tope de posición por cuenta en un pote (0 = sin tope). Política
    ///         del catálogo, no del día a día: solo la autoridad. Nunca toca salidas.
    function setMaxDepositPerUser(address pote, uint256 cap, bytes32 ref)
        external
        onlyAuthority
        withRef(ref)
        notSucceeded
    {
        _mine(pote);
        _order(pote, abi.encodeCall(AstryumVaultV2.setMaxDepositPerUser, (cap, ref)), ref);
    }

    // ── Órdenes locales — el día a día: director o autoridad ────────────────

    function directTo(address pote, uint256 venueId, uint256 amount, bytes32 ref)
        external
        onlyDirectorOrAuthority
        withRef(ref)
        notSucceeded
    {
        _mine(pote);
        _order(pote, abi.encodeCall(AstryumVault.directTo, (venueId, amount, ref)), ref);
    }

    function recall(address pote, uint256 venueId, uint256 amount, bytes32 ref)
        external
        onlyDirectorOrAuthority
        withRef(ref)
        notSucceeded
    {
        _mine(pote);
        _order(pote, abi.encodeCall(AstryumVault.recall, (venueId, amount, ref)), ref);
    }

    function moveToVenue(address pote, uint256 fromId, uint256 toId, uint256 amount, bytes32 ref)
        external
        onlyDirectorOrAuthority
        withRef(ref)
        notSucceeded
    {
        _mine(pote);
        _order(pote, abi.encodeCall(AstryumVault.moveToVenue, (fromId, toId, amount, ref)), ref);
    }

    // ── Gobierno de esta jaula ───────────────────────────────────────────────

    function cede(address director_, uint64 until, bytes32 ref) external onlyAuthority withRef(ref) notSucceeded {
        if (director_ == address(0)) revert ZeroAddress();
        director = director_;
        directorUntil = until;
        emit CessionGranted(director_, until, ref);
    }

    function endCession(bytes32 ref) external onlyAuthority withRef(ref) {
        director = address(0);
        directorUntil = 0;
        emit CessionEnded(ref);
    }

    /**
     * @notice Cambiar la constitución vigente presentando la anterior — y llevar a
     * todos los potes con ella, en la misma transacción. Si la jaula y sus potes
     * divergieran, cada orden revertiría por `RefMismatch` en el pote.
     */
    function setConstitutionRef(bytes32 newRef, bytes32 oldRef) external onlyAuthority notSucceeded {
        if (oldRef != constitutionRef) revert RefMismatch();
        for (uint256 i = 0; i < potes.length; i++) {
            AstryumVault(potes[i]).setConstitutionRef(newRef, oldRef);
        }
        emit ConstitutionRefUpdated(constitutionRef, newRef);
        constitutionRef = newRef;
    }

    // ── Remoto: registro (la forma PMW) ──────────────────────────────────────

    /// @notice Un pote en otra chain, para mandarle órdenes por instrucción. Tiene
    ///         que ser un destino permitido en esa chain.
    function registerRemotePote(uint32 chainId, address pote, bytes32 ref) external onlyAuthority withRef(ref) notSucceeded {
        if (!isAllowedTarget(chainId, pote)) revert TargetNotAllowed(chainId, pote);
        remotePotes.push(RemotePote({chainId: chainId, pote: pote}));
        emit RemotePoteRegistered(chainId, pote);
    }

    /// @notice Una wallet manejada por PMW: llaves generadas dentro del TEE, jamás
    ///         importadas. Una cuenta XRPL puede gobernar N, incluso de la misma red.
    function registerRemoteWallet(uint32 chainId, bytes32 walletId, bytes32 ref)
        external
        onlyAuthority
        withRef(ref)
        notSucceeded
    {
        if (walletId == bytes32(0)) revert ZeroAddress();
        remoteWallets.push(RemoteWallet({chainId: chainId, walletId: walletId}));
        emit RemoteWalletRegistered(chainId, walletId);
    }

    // ── Remoto: las instrucciones tipadas (marco sin hoja) ───────────────────

    /// @notice XRP de la wallet remota → 0xFE → FXRP en su PA → deposit en el pote.
    ///         La jaula compondrá el memo de estos parámetros; jamás aceptará uno crudo.
    function mintIntoPote(uint256 walletIndex, address pote, uint256 amount, bytes32 ref)
        external
        onlyDirectorOrAuthority
        withRef(ref)
        notSucceeded
        returns (uint64)
    {
        RemoteWallet memory w = _wallet(walletIndex);
        _mine(pote);
        return _issue(InstructionKind.MINT_INTO_POTE, w.chainId, w.walletId, pote, bytes32(0), amount, "");
    }

    /// @notice Shares de su PA → redeem → unmint → la MISMA wallet. Nunca otro destino.
    function redeemToOwnWallet(uint256 walletIndex, address pote, uint256 shares, bytes32 ref)
        external
        onlyDirectorOrAuthority
        withRef(ref)
        notSucceeded
        returns (uint64)
    {
        RemoteWallet memory w = _wallet(walletIndex);
        _mine(pote);
        return _issue(InstructionKind.REDEEM_TO_OWN_WALLET, w.chainId, w.walletId, pote, w.walletId, shares, "");
    }

    /// @notice Pago a un destino del registro (agente FAssets, AMM…). Solo la
    ///         autoridad, y solo hacia lo que Astryum aprobó para esa chain.
    function payRegistryDestination(uint256 walletIndex, bytes32 destination, uint256 amount, bytes32 ref)
        external
        onlyAuthority
        withRef(ref)
        notSucceeded
        returns (uint64)
    {
        RemoteWallet memory w = _wallet(walletIndex);
        if (!REGISTRY.isApprovedDestination(w.chainId, destination)) {
            revert DestinationNotInRegistry(w.chainId, destination);
        }
        return _issue(InstructionKind.PAY_REGISTRY_DESTINATION, w.chainId, w.walletId, address(0), destination, amount, "");
    }

    /**
     * @notice La prueba de ejecución vuelve: la instrucción se cierra UNA vez. En
     * PMW llega como atestación FDC de si el pago se ejecutó como se esperaba.
     * Contabilidad y UX — la seguridad de la jaula no depende de esta prueba.
     */
    function settleRemoteInstruction(uint64 nonce, bool executed, uint256 observedValue) external onlyAuthority {
        RemoteInstruction storage ins = instructions[nonce];
        if (ins.state == InstructionState.NONE) revert UnknownInstruction(nonce);
        if (ins.state != InstructionState.PENDING) revert InstructionNotPending(nonce);
        ins.state = executed ? InstructionState.EXECUTED : InstructionState.FAILED;
        emit RemoteInstructionSettled(nonce, executed, observedValue);
    }

    // ── Sucesión con continuidad — la única vía de «upgrade» ─────────────────

    /**
     * @notice Proponer la jaula que tomará el relevo. 30 días y evento público:
     * los usuarios tienen tiempo de salir si no les gusta. Las continuidades se
     * comprueban ahora y otra vez al ejecutar.
     */
    function proposeSuccessor(address newCage, bytes32 ref) external onlyAuthority withRef(ref) notSucceeded {
        _checkContinuity(newCage);
        successor = newCage;
        successorEta = uint64(block.timestamp + SUCCESSION_DELAY);
        emit SuccessorProposed(newCage, successorEta, ref);
    }

    function cancelSuccessor(bytes32 ref) external onlyAuthority withRef(ref) {
        emit SuccessorCancelled(successor, ref);
        successor = address(0);
        successorEta = 0;
    }

    /**
     * @notice Pasar el testigo: cada pote empieza su traspaso a la nueva jaula
     * (que lo completa con `acceptPote`, permissionless), y el bridge se re-ata a
     * ella — solo esta jaula puede pedírselo, y solo aquí. Después, esta jaula ya
     * no manda nada. Las participaciones de nadie se mueven.
     */
    function executeSuccession(bytes32 ref) external onlyAuthority withRef(ref) notSucceeded {
        address newCage = successor;
        if (newCage == address(0)) revert SuccessorNotSet();
        if (block.timestamp < successorEta) revert SuccessorNotMature();
        _checkContinuity(newCage);

        succeeded = true;
        for (uint256 i = 0; i < potes.length; i++) {
            AstryumVault(potes[i]).transferCouncil(newCage, ref);
        }
        XrplCouncilBridgeV2(AUTHORITY).rebind(newCage);
        emit SuccessionExecuted(newCage, potes.length);
    }

    /// Las cinco continuidades: misma autoridad · código aprobado · lista nunca
    /// más ancha · misma constitución · mismo activo y mismo scanner.
    function _checkContinuity(address newCage) internal view {
        if (newCage == address(0) || newCage == address(this)) revert ZeroAddress();
        if (!REGISTRY.isApprovedCageCode(newCage.codehash)) revert ContinuityBroken("code");

        AstryumCage n = AstryumCage(newCage);
        if (n.AUTHORITY() != AUTHORITY) revert ContinuityBroken("authority");
        if (n.constitutionRef() != constitutionRef) revert ContinuityBroken("constitution");
        if (address(n.ASSET()) != address(ASSET)) revert ContinuityBroken("asset");
        if (address(n.REGISTRY()) != address(REGISTRY)) revert ContinuityBroken("registry");
        // Un sucesor jamás puede cobrar más a los depositantes que su antecesora.
        if (n.MAX_PAYEE_BPS_ALLOWED() > MAX_PAYEE_BPS_ALLOWED) revert ContinuityBroken("payees");

        // Lista: un sucesor puede ser igual o MÁS estrecho, nunca más ancho. Si esta
        // jaula sigue al registro (sin lista), cualquier lista del sucesor vale —
        // también ninguna. Si esta jaula tiene lista, la del sucesor no puede estar
        // vacía (sería ensancharla al registro entero) ni salirse de la nuestra.
        if (_allowedTargets.length != 0) {
            Target[] memory theirs = n.allowedTargets();
            if (theirs.length == 0) revert ContinuityBroken("allowlist");
            for (uint256 i = 0; i < theirs.length; i++) {
                if (!_isAllowed[_key(theirs[i].chainId, theirs[i].target)]) revert ContinuityBroken("allowlist");
            }
        }
    }

    // ── Internos ─────────────────────────────────────────────────────────────

    function _mine(address pote) internal view {
        if (!isMyPote[pote]) revert NotMyPote(pote);
    }

    function _wallet(uint256 index) internal view returns (RemoteWallet memory) {
        if (index >= remoteWallets.length) revert UnknownWallet(index);
        return remoteWallets[index];
    }

    function _key(uint32 chainId, address target) internal pure returns (bytes32) {
        return keccak256(abi.encode(chainId, target));
    }

    /// Reenvía la orden y BURBUJEA el revert del pote: la razón real, arriba. Un
    /// «OrderFailed» pelado obligaría a adivinar — lo que costó una tarde entera
    /// con el direct a Kinetic.
    function _order(address pote, bytes memory data, bytes32 ref) internal {
        (bool ok, bytes memory ret) = pote.call(data);
        if (!ok) {
            if (ret.length == 0) revert OrderFailed(ret);
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        emit PoteOrder(pote, bytes4(data), ref);
    }

    function _issue(
        InstructionKind kind,
        uint32 chainId,
        bytes32 walletId,
        address pote,
        bytes32 target,
        uint256 amount,
        bytes memory data
    ) internal returns (uint64 nonce) {
        nonce = nextInstructionNonce++;
        instructions[nonce] = RemoteInstruction({
            nonce: nonce,
            kind: kind,
            chainId: chainId,
            walletId: walletId,
            pote: pote,
            target: target,
            amount: amount,
            dataHash: keccak256(data),
            state: InstructionState.PENDING
        });
        emit RemoteInstructionIssued(nonce, kind, chainId, walletId, pote, target, amount, data);
        _dispatchRemote(nonce);
    }

    /// El brazo remoto, sin construir a propósito. Quitar este revert es el día 1
    /// de un módulo aparte, con su auditoría, sin tocar una línea de lo de arriba.
    function _dispatchRemote(uint64) internal pure {
        revert RemoteNotSupportedYet();
    }
}
