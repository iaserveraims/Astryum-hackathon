// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {AstryumVault} from "./AstryumVault.sol";

/**
 * @title ManagerLegacy — la jaula del gestor: manda, y no puede tocar el capital
 *
 * @notice Misma base que `LegacyVault` (consejo eterno, director cedido y
 * caducable, allowlist con espera, toda mutación atada al `constitutionRef`
 * vigente), con la diferencia que le da su razón de existir: **este contrato no
 * guarda capital, MANDA.** Envía órdenes acotadas y recibe pruebas de ejecución.
 *
 * ── POR QUÉ EL LegacyVault NO PODÍA HACER ESTO ─────────────────────────────
 *
 * `LegacyVault` es una vasija: guarda principal y lo mueve entre SUS venues por
 * índice. No tiene forma de mandarle nada a otro contrato. Este sí, y solo eso.
 * El capital —el de los usuarios y el del propio gestor si quiere invertir— vive
 * SIEMPRE en los potes ERC-4626, y se entra y se sale directamente contra ellos.
 * Un gestor que quiera poner dinero suyo entra por la misma puerta que todos.
 *
 * Consecuencia, y es la propiedad que sostiene el diseño: **si este contrato se
 * rompe, el gestor pierde la capacidad de mandar y nadie pierde la de salir.**
 *
 * ── EL CANDADO ─────────────────────────────────────────────────────────────
 *
 * `AstryumVault` no paga principal a una dirección arbitraria, pero su consejo
 * decide QUÉ es un venue, y el propio vault lo dice sin adornos:
 *
 *     uint32 public constant VENUE_DELAY = 30 days; // adding a venue IS the power to extract
 *
 * Aquí esa puerta está cerrada: los destinos salen de una lista fijada en el
 * constructor que ninguna función amplía. El gestor elige DÓNDE, nunca CÓMO ni
 * HACIA QUÉ COSA NUEVA. Es el mismo principio que ya rige el vault — conjunto
 * cerrado de acciones tipadas, sin un solo `call` genérico (invariante I3).
 *
 * ── ENVIAR Y RECIBIR: LA FORMA QUE PMW VA A NECESITAR ──────────────────────
 *
 * Los destinos se despachan por TIPO, que es el punto de extensión que el
 * análisis de forward-compatibility ya identificó: *«un brazo PMW remoto es,
 * estructuralmente, otro tipo cuya valoración llega atestiguada»*.
 *
 *  · `ERC4626_LOCAL` — un pote en esta cadena. La orden se ejecuta EN EL ACTO.
 *  · `REMOTE_PMW`    — un vault en otra cadena. La orden no se ejecuta aquí: se
 *    EMITE como instrucción con nonce, unas TEE la firman fuera, y la prueba de
 *    ejecución vuelve por FDC. Es el modelo literal de Protocol Managed Wallets.
 *
 * El tipo remoto está DECLARADO y su contabilidad existe, pero `_dispatchRemote`
 * revierte hoy: PMW no está disponible públicamente todavía. Es una puerta con
 * marco y sin hoja — deliberado, porque el invariante del proyecto dice que PMW
 * se compone, jamás se depende de él, y V1 no puede quedar condicionada a algo
 * que aún no existe. Quitar ese revert es el día 1 de un módulo aparte, con su
 * propia auditoría, sin tocar una línea de lo que aquí ya funciona.
 *
 * ── LO QUE ESTE CONTRATO NO TIENE, Y ES DELIBERADO ─────────────────────────
 *
 * No hay `transferCouncil` hacia los potes: con ella el gestor pasaría el
 * consejo de un pote a una llave suya y saldría de esta jaula sin tocar código.
 * No hay `call` genérico: cada orden es una función escrita y auditable. Y no
 * hay ninguna función que mueva participaciones de nadie.
 */
contract ManagerLegacy {
    // ── Identidad inmutable (misma base que LegacyVault) ─────────────────────

    /// @notice El bridge XRPL de este gestor: la única voz que este contrato obedece.
    address public immutable AUTHORITY;

    /// @notice El activo único de los potes de esta jaula (FXRP).
    IERC20 public immutable ASSET;

    /// @notice El desplegador auxiliar (EIP-170: el bytecode del pote no cabe aquí).
    PoteDeployer public immutable DEPLOYER;

    /// @notice Igual que en LegacyVault: proponer un destino no lo activa.
    uint32 public constant TARGET_DELAY = 30 days;

    /**
     * @notice Los destinos donde este gestor podrá poner capital a trabajar,
     * FIJADOS EN EL CONSTRUCTOR.
     *
     * Array privado y no mapping a propósito: un mapping se escribe desde
     * cualquier función futura sin que se note al leer el contrato; un array sin
     * un solo `push` es inmutable de un vistazo — y ese vistazo es lo que un
     * auditor y un depositante tienen que poder dar.
     */
    address[] private _allowedTargets;

    // ── Gobierno (misma forma que LegacyVault) ───────────────────────────────

    bytes32 public constitutionRef;
    address public director;
    uint64 public directorUntil;

    // ── Potes de esta jaula ──────────────────────────────────────────────────

    address[] public potes;
    mapping(address => bool) public isMyPote;

    // ── Destinos remotos y sus instrucciones (la forma PMW) ─────────────────

    enum TargetKind {
        ERC4626_LOCAL, // un pote en esta cadena: la orden se ejecuta en el acto
        REMOTE_PMW // un vault en otra cadena: se emite instrucción, vuelve prueba
    }

    /// @notice Estado de una instrucción remota. Nace pendiente y muere una vez.
    enum InstructionState {
        NONE,
        PENDING,
        EXECUTED,
        FAILED
    }

    struct RemoteInstruction {
        uint64 nonce;
        uint32 chainId;
        address pote; // el pote de esta cadena cuyo capital viaja
        bytes32 remoteTarget; // el vault remoto, en la forma de SU cadena
        uint256 amount;
        InstructionState state;
    }

    /// @notice Nonce único por instrucción — PMW lo exige y aquí se lleva la cuenta.
    uint64 public nextInstructionNonce;
    mapping(uint64 => RemoteInstruction) public instructions;

    // ── Eventos ──────────────────────────────────────────────────────────────

    event PoteCreated(address indexed pote, uint256 indexed index, string name, uint48 cooldown);
    event PoteOrder(address indexed pote, bytes4 indexed selector, bytes32 ref);
    event CessionGranted(address indexed director, uint64 until, bytes32 ref);
    event CessionEnded(bytes32 ref);
    event ConstitutionRefUpdated(bytes32 oldRef, bytes32 newRef);

    /// @notice La instrucción que unas TEE recogerán para firmarla fuera.
    event RemoteInstructionIssued(
        uint64 indexed nonce, uint32 indexed chainId, address indexed pote, bytes32 remoteTarget, uint256 amount
    );
    event RemoteInstructionSettled(uint64 indexed nonce, bool executed, uint256 observedValue);

    // ── Errores ──────────────────────────────────────────────────────────────

    error NotAuthority();
    error NotDirectorOrAuthority();
    error ZeroAddress();
    error EmptyAllowlist();
    error DuplicateAllowedTarget(address target);
    error TargetNotAllowed(address target);
    error NotMyPote(address pote);
    error RefMismatch();
    error OrderFailed(bytes reason);
    error RemoteNotSupportedYet();
    error UnknownInstruction(uint64 nonce);
    error InstructionNotPending(uint64 nonce);

    // ── Modificadores (misma forma que LegacyVault) ──────────────────────────

    modifier onlyAuthority() {
        if (msg.sender != AUTHORITY) revert NotAuthority();
        _;
    }

    /// @notice El día a día lo puede llevar un director cedido, y la cesión caduca sola.
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

    constructor(address authority, IERC20 asset, bytes32 constitutionRef_, address[] memory allowedTargets_) {
        if (authority == address(0) || address(asset) == address(0)) revert ZeroAddress();
        if (allowedTargets_.length == 0) revert EmptyAllowlist();

        for (uint256 i = 0; i < allowedTargets_.length; i++) {
            address t = allowedTargets_[i];
            if (t == address(0)) revert ZeroAddress();
            for (uint256 j = 0; j < i; j++) {
                if (allowedTargets_[j] == t) revert DuplicateAllowedTarget(t);
            }
            _allowedTargets.push(t);
        }

        AUTHORITY = authority;
        ASSET = asset;
        constitutionRef = constitutionRef_;
        DEPLOYER = new PoteDeployer();
    }

    // ── Lecturas ─────────────────────────────────────────────────────────────

    /// @notice La lista entera, para que se lea de un vistazo antes de depositar.
    function allowedTargets() external view returns (address[] memory) {
        return _allowedTargets;
    }

    function allowedTargetCount() external view returns (uint256) {
        return _allowedTargets.length;
    }

    /// @notice ¿Está este destino en la lista eterna? El candado, en una función.
    function isAllowedTarget(address target) public view returns (bool) {
        uint256 n = _allowedTargets.length;
        for (uint256 i = 0; i < n; i++) {
            if (_allowedTargets[i] == target) return true;
        }
        return false;
    }

    function poteCount() external view returns (uint256) {
        return potes.length;
    }

    // ── Nacimiento de un pote ────────────────────────────────────────────────

    /**
     * @notice Un pote nuevo de esta jaula, con este contrato como su consejo.
     *
     * Sus venues iniciales se comprueban UNO A UNO contra la lista eterna: un
     * pote no puede nacer mirando a un sitio al que su gestor no podría dirigir
     * capital después.
     *
     * El pote es ERC-4626 y se abre a cualquiera: los depositantes entran y
     * salen contra él, sin pasar por aquí.
     */
    function createPote(
        string calldata name,
        string calldata symbol,
        bytes32 ref,
        uint48 cooldown,
        uint16 bufferFloorBps,
        AstryumVault.InitialVenue[] calldata initialVenues
    ) external onlyAuthority withRef(ref) returns (address pote) {
        for (uint256 i = 0; i < initialVenues.length; i++) {
            if (!isAllowedTarget(initialVenues[i].target)) revert TargetNotAllowed(initialVenues[i].target);
        }

        pote = DEPLOYER.deploy(
            bytes32(potes.length), ASSET, name, symbol, address(this), ref, cooldown, bufferFloorBps, initialVenues
        );

        isMyPote[pote] = true;
        potes.push(pote);
        emit PoteCreated(pote, potes.length - 1, name, cooldown);
    }

    // ── ENVIAR órdenes: al pote, en esta cadena ──────────────────────────────

    /**
     * @notice Proponer un venue en un pote — la función que esta jaula existe
     * para atar. Sin el `isAllowedTarget`, esta línea sería el camino a la
     * extracción del principal: proponer un contrato propio, esperar los 30 días
     * del pote y dirigir el capital. Con él, «añadir un venue» deja de ser un
     * poder abierto y pasa a ser una elección dentro de un conjunto cerrado que
     * el depositante leyó antes de entrar.
     */
    function proposeVenue(address pote, address target, AstryumVault.VenueKind kind, bytes32 ref)
        external
        onlyAuthority
        withRef(ref)
    {
        _mine(pote);
        if (!isAllowedTarget(target)) revert TargetNotAllowed(target);
        _order(pote, abi.encodeCall(AstryumVault.proposeVenue, (target, kind, ref)), ref);
    }

    /// @notice Dirigir capital del pote a un venue suyo ya listo. Día a día: director.
    function directTo(address pote, uint256 venueId, uint256 amount, bytes32 ref)
        external
        onlyDirectorOrAuthority
        withRef(ref)
    {
        _mine(pote);
        _order(pote, abi.encodeCall(AstryumVault.directTo, (venueId, amount, ref)), ref);
    }

    /// @notice Traer capital de vuelta al colchón del pote.
    function recall(address pote, uint256 venueId, uint256 amount, bytes32 ref)
        external
        onlyDirectorOrAuthority
        withRef(ref)
    {
        _mine(pote);
        _order(pote, abi.encodeCall(AstryumVault.recall, (venueId, amount, ref)), ref);
    }

    /// @notice Mover capital entre dos venues del pote.
    function moveToVenue(address pote, uint256 fromId, uint256 toId, uint256 amount, bytes32 ref)
        external
        onlyDirectorOrAuthority
        withRef(ref)
    {
        _mine(pote);
        _order(pote, abi.encodeCall(AstryumVault.moveToVenue, (fromId, toId, amount, ref)), ref);
    }

    /// @notice Retirar un venue del pote (inmediato, sin espera — es un rescate).
    function retireVenue(address pote, uint256 venueId, bytes32 ref) external onlyAuthority withRef(ref) {
        _mine(pote);
        _order(pote, abi.encodeCall(AstryumVault.retireVenue, (venueId, ref)), ref);
    }

    /// @notice Salida de emergencia de un venue: todo lo que se pueda, al colchón.
    function evacuate(address pote, uint256 venueId, bytes32 ref) external onlyAuthority withRef(ref) {
        _mine(pote);
        _order(pote, abi.encodeCall(AstryumVault.evacuate, (venueId, ref)), ref);
    }

    function setMaxVenueBps(address pote, uint16 bps, bytes32 ref) external onlyAuthority withRef(ref) {
        _mine(pote);
        _order(pote, abi.encodeCall(AstryumVault.setMaxVenueBps, (bps, ref)), ref);
    }

    /// @notice El calendario de cobro. El tope duro del 20% vive en el pote y no
    ///         se toca desde aquí: este reenvío reparte por debajo, nunca sube.
    function setPayees(address pote, address[] calldata accounts, uint16[] calldata bps, bytes32 ref)
        external
        onlyAuthority
        withRef(ref)
    {
        _mine(pote);
        _order(pote, abi.encodeCall(AstryumVault.setPayees, (accounts, bps, ref)), ref);
    }

    /// @notice Apuntar el pote a un registro de entrada (KYC), o abrirlo con 0.
    ///         Entry-only en el contrato: jamás afecta a la salida de un holder.
    function setUserGate(address pote, address gate, bytes32 ref) external onlyAuthority withRef(ref) {
        _mine(pote);
        _order(pote, abi.encodeCall(AstryumVault.setUserGate, (gate, ref)), ref);
    }

    // NOTA DELIBERADA: aquí NO hay `transferCouncil` hacia los potes. Con ella el
    // gestor pasaría el consejo de un pote a una llave suya y saldría de esta
    // jaula sin tocar una línea de código: la lista eterna dejaría de aplicar. Al
    // no existir, el consejo de cada pote es este contrato para siempre.

    // ── ENVIAR órdenes: fuera de esta cadena (la forma PMW) ──────────────────

    /**
     * @notice Poner capital a trabajar en un vault de OTRA cadena.
     *
     * Aquí no se ejecuta nada: se EMITE una instrucción con nonce único. En el
     * modelo de Protocol Managed Wallets, unas TEE machines recogen esa
     * instrucción, ensamblan y firman la transacción en la cadena de destino
     * como firmantes k-de-n, y la prueba de ejecución vuelve por FDC a
     * `settleRemoteInstruction`. El nonce permite reemitir con otra comisión o
     * anular consumiéndolo, que es exactamente lo que PMW define.
     *
     * HOY REVIERTE. PMW no está disponible públicamente todavía, y el invariante
     * del proyecto es tajante: PMW se compone, jamás se depende de él, y nada de
     * V1 puede quedar condicionado a su calendario. Esto es el marco de la
     * puerta —la contabilidad, el nonce, el evento, el estado— sin la hoja.
     * Abrirla es un módulo aparte con su propia auditoría, y no tocará una sola
     * línea de lo que arriba ya funciona.
     */
    function employRemote(address pote, uint32 chainId, bytes32 remoteTarget, uint256 amount, bytes32 ref)
        external
        onlyDirectorOrAuthority
        withRef(ref)
        returns (uint64 nonce)
    {
        _mine(pote);
        nonce = nextInstructionNonce++;
        instructions[nonce] = RemoteInstruction({
            nonce: nonce,
            chainId: chainId,
            pote: pote,
            remoteTarget: remoteTarget,
            amount: amount,
            state: InstructionState.PENDING
        });
        emit RemoteInstructionIssued(nonce, chainId, pote, remoteTarget, amount);

        _dispatchRemote(nonce);
    }

    /**
     * @notice La prueba de ejecución vuelve: la instrucción se cierra una vez.
     *
     * En PMW esto llega como atestación FDC de si el pago se ejecutó como se
     * esperaba — el mecanismo que deja a un protocolo mitigar pagos fallidos
     * automáticamente. Una instrucción se liquida UNA sola vez: sin eso, la
     * misma prueba contaría dos veces y el libro mentiría.
     */
    function settleRemoteInstruction(uint64 nonce, bool executed, uint256 observedValue) external onlyAuthority {
        RemoteInstruction storage ins = instructions[nonce];
        if (ins.state == InstructionState.NONE) revert UnknownInstruction(nonce);
        if (ins.state != InstructionState.PENDING) revert InstructionNotPending(nonce);
        ins.state = executed ? InstructionState.EXECUTED : InstructionState.FAILED;
        emit RemoteInstructionSettled(nonce, executed, observedValue);
    }

    /// El brazo remoto, sin construir a propósito. Ver `employRemote`.
    function _dispatchRemote(uint64) internal pure {
        revert RemoteNotSupportedYet();
    }

    // ── Gobierno de esta jaula (misma forma que LegacyVault) ─────────────────

    /// @notice Ceder el día a día a una llave, con caducidad. La cesión expira sola.
    function cede(address director_, uint64 until, bytes32 ref) external onlyAuthority withRef(ref) {
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

    /// @notice Actualizar la constitución vigente presentando la anterior.
    function setConstitutionRef(bytes32 newRef, bytes32 oldRef) external onlyAuthority {
        if (oldRef != constitutionRef) revert RefMismatch();
        emit ConstitutionRefUpdated(constitutionRef, newRef);
        constitutionRef = newRef;
    }

    // ── Internos ─────────────────────────────────────────────────────────────

    function _mine(address pote) internal view {
        if (!isMyPote[pote]) revert NotMyPote(pote);
    }

    /// Reenvía la orden y BURBUJEA el revert del pote: la razón real, arriba.
    /// Un «OrderFailed» pelado obligaría a adivinar, que es lo que costó una
    /// tarde entera con el direct a Kinetic.
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
}

/**
 * @title PoteDeployer — el bytecode del pote, fuera de la jaula
 *
 * @notice Mismo motivo que `AstryumVaultDeployer` y `LegacyVaultDeployer`: una
 * jaula que llevara dentro el bytecode del ERC-4626 se acercaría al techo de
 * EIP-170. Nace con su ManagerLegacy y solo él puede llamarla — sin ese control,
 * cualquiera podría plantar un pote en la dirección predicha de un gestor con
 * los parámetros que quisiera.
 */
contract PoteDeployer {
    address public immutable OWNER;

    error NotOwner();

    constructor() {
        OWNER = msg.sender;
    }

    function deploy(
        bytes32 salt,
        IERC20 asset,
        string calldata name,
        string calldata symbol,
        address council,
        bytes32 constitutionRef,
        uint48 cooldown,
        uint16 bufferFloorBps,
        AstryumVault.InitialVenue[] calldata initialVenues
    ) external returns (address) {
        if (msg.sender != OWNER) revert NotOwner();
        return address(
            new AstryumVault{salt: salt}(
                asset, name, symbol, council, constitutionRef, cooldown, bufferFloorBps, initialVenues
            )
        );
    }
}
