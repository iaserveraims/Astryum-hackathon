// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title AstryumRegistry — el scanner, hecho contrato
 *
 * @notice Invariante #10 del proyecto, en su forma on-chain: *«nada se enchufa sin
 * su scanner»*. Dos listas, ambas gobernadas por Astryum con timelock y evento
 * público, y ambas **enforced por contratos que Astryum no controla**:
 *
 *  · **Venues aprobados** por `(chainId, target, kind)`. El pote los comprueba en
 *    `_addVenue` (además de la jaula): aunque una jaula sucesora fuera maliciosa
 *    o tuviera un bug, no puede meter en un pote un destino fuera de esta lista.
 *  · **Códigos de jaula aprobados** (`extcodehash`). La sucesión de una jaula solo
 *    acepta un sucesor cuyo código esté aquí: implementaciones auditadas. Aprobar
 *    un código de jaula aprueba también el bytecode de pote que fabrica.
 *
 * ── POR QUÉ ESTO NO ES ASESORAMIENTO ───────────────────────────────────────
 *
 * Es un filtro TÉCNICO, igual para todos y verificable on-chain: código
 * verificado, sin liquidación, interfaz conforme, ciclo depósito→retirada probado
 * en fork. Sin ranking, sin default, sin opinión. Añadir un venue no mueve capital
 * de nadie (el manager sigue teniendo que proponer, esperar 30 días y dirigir).
 *
 * Y quitarlo hace MENOS de lo que suena, dicho aquí para que nadie asuma una
 * protección que el código no da: esta lista se consulta en `_addVenue` y en
 * ningún sitio más — `_allocate` no la mira. Así que una baja cierra la puerta a
 * los potes que aún NO tienen ese venue, pero no corta el capital hacia un venue
 * que YA está dentro de un pote: ahí la salida es el `recall` de su manager. Lo
 * que la baja nunca hace es atrapar capital (ni `recall` ni la salida del holder
 * dependen de esta lista). Que la baja cortase también la entrada exigiría
 * consultar el registro en `_allocate`, y eso le daría a Astryum un veto EN VIVO
 * sobre cada movimiento — superficie de confianza que hoy no tiene, y por eso no
 * está. Tripwire: `AstryumVaultV2.fork.t.sol`.
 *
 * ── LA ASIMETRÍA A PROPÓSITO ───────────────────────────────────────────────
 *
 * Alta con TIMELOCK (nadie puede colar un destino de la noche a la mañana; el
 * evento se ve antes de que entre en vigor). Baja INMEDIATA (un protocolo roto
 * no espera). Lo mismo para los códigos de jaula.
 *
 * Astryum gobierna esta lista y nada más: jamás dirige capital, jamás ocupa el
 * asiento de director ni el de consejo de ningún pote.
 */
contract AstryumRegistry {
    // ── Gobierno ─────────────────────────────────────────────────────────────

    address public governor;
    address public pendingGovernor;

    /// @notice Cuánto espera un alta antes de entrar en vigor. Inmutable.
    uint64 public immutable TIMELOCK;

    // ── Venues ───────────────────────────────────────────────────────────────

    struct VenueEntry {
        uint8 kind; // AstryumVault.VenueKind, como uint8
        uint64 activeAt; // 0 = nunca propuesto
        bool active;
    }

    /// @dev key = keccak256(abi.encode(chainId, target))
    mapping(bytes32 => VenueEntry) private _venues;

    struct VenueRef {
        uint32 chainId;
        address target;
    }

    /// @dev La whitelist ENUMERABLE: lo que un gestor ve al elegir dónde puede
    ///      trabajar su pote (decisión 27-ago: elige dentro de la lista de Astryum
    ///      desde el pote). Solo crece; el estado vivo de cada entrada (activa,
    ///      retirada, pendiente) está en `_venues`, y el catálogo filtra por él.
    VenueRef[] private _venueList;
    mapping(bytes32 => bool) private _listed;

    // ── Destinos remotos (PMW): direcciones de OTRA chain, en la forma de esa chain ──
    //
    // Un venue es un contrato EVM. Un destino es cualquier cosa a la que una wallet
    // manejada por PMW pueda pagar: la wallet-operador del MasterAccountController
    // (para el 0xFE), un agente FAssets, un AMM de XRPL. Se guarda como bytes32
    // (keccak256 de la r-address, como hace el bridge) porque no cabe en address.
    // Misma regla: alta con timelock, baja inmediata. Y la misma consecuencia: una
    // jaula solo puede ordenar pagos hacia lo que está aquí — o hacia sí misma.

    struct DestinationEntry {
        uint64 activeAt;
        bool active;
    }

    /// @dev key = keccak256(abi.encode(chainId, destination))
    mapping(bytes32 => DestinationEntry) private _destinations;

    // ── Códigos de jaula ─────────────────────────────────────────────────────

    struct CodeEntry {
        uint64 activeAt;
        bool active;
    }

    mapping(bytes32 => CodeEntry) private _cageCodes;

    // ── Eventos ──────────────────────────────────────────────────────────────

    event VenueProposed(uint32 indexed chainId, address indexed target, uint8 kind, uint64 activeAt);
    event VenueActivated(uint32 indexed chainId, address indexed target, uint8 kind);
    event VenueRemoved(uint32 indexed chainId, address indexed target);
    event DestinationProposed(uint32 indexed chainId, bytes32 indexed destination, uint64 activeAt);
    event DestinationActivated(uint32 indexed chainId, bytes32 indexed destination);
    event DestinationRemoved(uint32 indexed chainId, bytes32 indexed destination);
    event CageCodeProposed(bytes32 indexed codehash, uint64 activeAt);
    event CageCodeActivated(bytes32 indexed codehash);
    event CageCodeRevoked(bytes32 indexed codehash);
    event GovernorTransferStarted(address indexed current, address indexed pending);
    event GovernorTransferred(address indexed previous, address indexed current);

    // ── Errores ──────────────────────────────────────────────────────────────

    error NotGovernor();
    error NotPendingGovernor();
    error ZeroAddress();
    error NotProposed();
    error NotYetActive(uint64 activeAt);
    error AlreadyActive();

    modifier onlyGovernor() {
        if (msg.sender != governor) revert NotGovernor();
        _;
    }

    constructor(address governor_, uint64 timelock_) {
        if (governor_ == address(0)) revert ZeroAddress();
        governor = governor_;
        TIMELOCK = timelock_;
    }

    // ── Lecturas: las dos preguntas que hacen los contratos ──────────────────

    /// @notice ¿Está este destino aprobado, con este tipo, en esta chain?
    function isApprovedVenue(uint32 chainId, address target, uint8 kind) external view returns (bool) {
        VenueEntry storage e = _venues[_key(chainId, target)];
        return e.active && e.kind == kind;
    }

    /// @notice ¿Está este destino aprobado en esta chain, con cualquier tipo?
    function isApprovedTarget(uint32 chainId, address target) external view returns (bool) {
        return _venues[_key(chainId, target)].active;
    }

    function venueEntry(uint32 chainId, address target) external view returns (VenueEntry memory) {
        return _venues[_key(chainId, target)];
    }

    /// @notice ¿Es este código de jaula una implementación aprobada?
    function isApprovedCageCode(bytes32 codehash) external view returns (bool) {
        return _cageCodes[codehash].active;
    }

    function cageCodeEntry(bytes32 codehash) external view returns (CodeEntry memory) {
        return _cageCodes[codehash];
    }

    // ── Venues: alta con timelock, baja inmediata ────────────────────────────

    function proposeVenue(uint32 chainId, address target, uint8 kind) external onlyGovernor {
        if (target == address(0)) revert ZeroAddress();
        bytes32 key = _key(chainId, target);
        if (_venues[key].active) revert AlreadyActive();
        uint64 activeAt = uint64(block.timestamp) + TIMELOCK;
        _venues[key] = VenueEntry({kind: kind, activeAt: activeAt, active: false});
        if (!_listed[key]) {
            _listed[key] = true;
            _venueList.push(VenueRef({chainId: chainId, target: target}));
        }
        emit VenueProposed(chainId, target, kind, activeAt);
    }

    /// @notice Cuántas entradas ha tenido la whitelist alguna vez (activas o no).
    function venueCount() external view returns (uint256) {
        return _venueList.length;
    }

    /// @notice La entrada i-ésima con su estado vivo. `entry.active == false` y
    ///         `entry.activeAt == 0` ⇒ retirada (o nunca activada).
    function venueAt(uint256 i) external view returns (uint32 chainId, address target, VenueEntry memory entry) {
        VenueRef memory r = _venueList[i];
        return (r.chainId, r.target, _venues[_key(r.chainId, r.target)]);
    }

    /// @notice Permissionless: el timelock ya lo decidió todo; activar es un trámite.
    function activateVenue(uint32 chainId, address target) external {
        bytes32 key = _key(chainId, target);
        VenueEntry storage e = _venues[key];
        if (e.activeAt == 0) revert NotProposed();
        if (e.active) revert AlreadyActive();
        if (block.timestamp < e.activeAt) revert NotYetActive(e.activeAt);
        e.active = true;
        emit VenueActivated(chainId, target, e.kind);
    }

    /// @notice Inmediata y solo protectora: bloquea capital NUEVO, no toca posiciones.
    function removeVenue(uint32 chainId, address target) external onlyGovernor {
        bytes32 key = _key(chainId, target);
        delete _venues[key];
        emit VenueRemoved(chainId, target);
    }

    // ── Destinos remotos: alta con timelock, baja inmediata ──────────────────

    function isApprovedDestination(uint32 chainId, bytes32 destination) external view returns (bool) {
        return _destinations[keccak256(abi.encode(chainId, destination))].active;
    }

    function proposeDestination(uint32 chainId, bytes32 destination) external onlyGovernor {
        if (destination == bytes32(0)) revert ZeroAddress();
        bytes32 key = keccak256(abi.encode(chainId, destination));
        if (_destinations[key].active) revert AlreadyActive();
        uint64 activeAt = uint64(block.timestamp) + TIMELOCK;
        _destinations[key] = DestinationEntry({activeAt: activeAt, active: false});
        emit DestinationProposed(chainId, destination, activeAt);
    }

    function activateDestination(uint32 chainId, bytes32 destination) external {
        DestinationEntry storage e = _destinations[keccak256(abi.encode(chainId, destination))];
        if (e.activeAt == 0) revert NotProposed();
        if (e.active) revert AlreadyActive();
        if (block.timestamp < e.activeAt) revert NotYetActive(e.activeAt);
        e.active = true;
        emit DestinationActivated(chainId, destination);
    }

    function removeDestination(uint32 chainId, bytes32 destination) external onlyGovernor {
        delete _destinations[keccak256(abi.encode(chainId, destination))];
        emit DestinationRemoved(chainId, destination);
    }

    // ── Códigos de jaula: alta con timelock, baja inmediata ──────────────────

    function proposeCageCode(bytes32 codehash) external onlyGovernor {
        if (_cageCodes[codehash].active) revert AlreadyActive();
        uint64 activeAt = uint64(block.timestamp) + TIMELOCK;
        _cageCodes[codehash] = CodeEntry({activeAt: activeAt, active: false});
        emit CageCodeProposed(codehash, activeAt);
    }

    function activateCageCode(bytes32 codehash) external {
        CodeEntry storage e = _cageCodes[codehash];
        if (e.activeAt == 0) revert NotProposed();
        if (e.active) revert AlreadyActive();
        if (block.timestamp < e.activeAt) revert NotYetActive(e.activeAt);
        e.active = true;
        emit CageCodeActivated(codehash);
    }

    function revokeCageCode(bytes32 codehash) external onlyGovernor {
        delete _cageCodes[codehash];
        emit CageCodeRevoked(codehash);
    }

    // ── Gobierno en dos pasos ────────────────────────────────────────────────

    function transferGovernor(address next) external onlyGovernor {
        if (next == address(0)) revert ZeroAddress();
        pendingGovernor = next;
        emit GovernorTransferStarted(governor, next);
    }

    function acceptGovernor() external {
        if (msg.sender != pendingGovernor) revert NotPendingGovernor();
        emit GovernorTransferred(governor, pendingGovernor);
        governor = pendingGovernor;
        pendingGovernor = address(0);
    }

    // ── Interno ──────────────────────────────────────────────────────────────

    function _key(uint32 chainId, address target) internal pure returns (bytes32) {
        return keccak256(abi.encode(chainId, target));
    }
}
