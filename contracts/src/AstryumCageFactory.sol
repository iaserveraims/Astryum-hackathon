// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {AstryumCage, PoteDeployer} from "./AstryumCage.sol";
import {AstryumRegistry} from "./AstryumRegistry.sol";
import {XrplCouncilBridgeV2} from "./XrplCouncilBridgeV2.sol";

/// The Flare Contract Registry — same address on every Flare network.
interface IFlareContractRegistry {
    function getContractAddressByName(string calldata _name) external view returns (address);
}

/// The Flare Smart Accounts surface used here: the Personal Account an XRPL
/// address controls. It acts ONLY when that XRPL account signs a payment whose
/// memo commits the calls — on a multisig-only account, that means the quorum.
interface IMasterAccountController {
    function getPersonalAccount(string calldata _xrplAddress) external view returns (address);
}

/**
 * @title CageDeployer — el bytecode de la jaula, fuera de la factory
 *
 * @notice Misma razón que los deployers del Legacy y del pote: una factory que
 * llevara dentro el bytecode de la jaula se acercaría al techo de EIP-170.
 * Nace con la factory y solo ella puede llamarlo — sin ese control, cualquiera
 * podría plantar una jaula en la dirección predicha de una cuenta XRPL ajena
 * con parámetros de su elección.
 */
contract CageDeployer {
    address public immutable FACTORY;

    error NotFactory();

    constructor() {
        FACTORY = msg.sender;
    }

    function deploy(
        bytes32 salt,
        address authority,
        IERC20 asset,
        AstryumRegistry registry,
        bytes32 constitutionRef,
        address treasury,
        uint256 creationFee,
        uint16 maxPayeeBpsAllowed,
        uint16 freePotes,
        PoteDeployer poteDeployer,
        AstryumCage.Target[] calldata allowedTargets
    ) external returns (address) {
        if (msg.sender != FACTORY) revert NotFactory();
        return address(
            new AstryumCage{salt: salt}(
                authority,
                asset,
                registry,
                constitutionRef,
                treasury,
                creationFee,
                maxPayeeBpsAllowed,
                freePotes,
                poteDeployer,
                allowedTargets
            )
        );
    }

    function cageInitCodeHash(
        address authority,
        IERC20 asset,
        AstryumRegistry registry,
        bytes32 constitutionRef,
        address treasury,
        uint256 creationFee,
        uint16 maxPayeeBpsAllowed,
        uint16 freePotes,
        PoteDeployer poteDeployer,
        AstryumCage.Target[] calldata allowedTargets
    ) external pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                type(AstryumCage).creationCode,
                abi.encode(
                    authority,
                    asset,
                    registry,
                    constitutionRef,
                    treasury,
                    creationFee,
                    maxPayeeBpsAllowed,
                    freePotes,
                    poteDeployer,
                    allowedTargets
                )
            )
        );
    }
}

/**
 * @title AstryumCageFactory — una cuenta XRPL, una jaula, nacida desde XRPL
 *
 * @notice Clon del patrón probado en mainnet (LegacyStackFactory;
 * AstryumStackFactory) para la jaula v2. Las factories anteriores no
 * se tocan.
 *
 * QUIÉN PUEDE CREAR (todo el modelo de seguridad en una línea): solo la Personal
 * Account de la propia cuenta XRPL. Producir ese pago en una cuenta multisig ES
 * el quórum — así que la lista eterna de destinos la elige la misma autoridad
 * que vivirá bajo ella, y nadie puede ocupar, adelantarse ni mal-parametrizar la
 * jaula de otro.
 *
 * UNA CUENTA, UNA JAULA. Una jaula abre los potes que necesite; no hace falta
 * más de una por cuenta.
 *
 * LO QUE LA FACTORY FIJA DE PARTE DE ASTRYUM, al nacer cada jaula: el scanner
 * (`REGISTRY`), la tesorería y la fee de creación de pote, y el deployer de
 * potes compartido. Lo que el manager fija: el activo, la constitución y su
 * lista eterna (⊆ registro).
 *
 * LO QUE LA FACTORY GUARDA: nada. Sin dueño, sin fondos, sin pausa, sin
 * upgrade. Tras `create` es solo un REGISTRO público: `cageOf(councilHash)`.
 */
contract AstryumCageFactory {
    IFlareContractRegistry public constant FLARE_REGISTRY =
        IFlareContractRegistry(0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019);

    string private constant MAC_NAME = "MasterAccountController";

    /// @notice bytes32("XRP") en Flare mainnet, bytes32("testXRP") en Coston2.
    bytes32 public immutable SOURCE_ID;
    address public immutable MAC_FALLBACK;

    AstryumRegistry public immutable ASTRYUM_REGISTRY;
    address public immutable TREASURY;
    uint256 public immutable CREATION_FEE;
    /// @notice Política de cobro de esta generación: tope de payees que una jaula
    ///         puede dar a sus potes (2000 para exchanges y managers). Un pote con
    ///         puerta KYC tiene depositantes terceros: sin esto, un exchange podría
    ///         fijarse el 100% de su yield.
    uint16 public immutable MAX_PAYEE_BPS_ALLOWED;
    /// @notice Potes que cada jaula abre sin fee de creación (3 en esta generación).
    uint16 public immutable FREE_POTES_PER_CAGE;
    /// @notice keccak256(bytes(r-address)) del ANCLA: la cuenta XRPL donde toda orden
    ///         de toda jaula de esta generación tiene que aterrizar. Es la puerta
    ///         (DepositAuth + AuthorizeCredentials); cada bridge nacido aquí la lleva
    ///         inmutable y se niega a ejecutar lo que no pasó por ella.
    bytes32 public immutable ANCHOR_ADDRESS_HASH;
    PoteDeployer public immutable POTE_DEPLOYER;
    CageDeployer public immutable CAGE_DEPLOYER;

    struct CageParams {
        IERC20 asset;
        bytes32 constitutionRef;
        AstryumCage.Target[] allowedTargets;
    }

    /// @notice councilAddressHash → la jaula de esa cuenta (0 = ninguna aún).
    mapping(bytes32 => address) public cageOf;
    /// @notice councilAddressHash → el bridge que esa jaula obedece.
    mapping(bytes32 => address) public bridgeOf;
    address[] public allCages;

    event CageCreated(
        bytes32 indexed councilAddressHash,
        string councilAddress,
        address indexed bridge,
        address indexed cage,
        address personalAccount
    );

    error ZeroSourceId();
    error ZeroAnchor();
    error ZeroAddress();
    error EmptyCouncilAddress();
    error NoPersonalAccount(string councilAddress);
    error NotThisCouncilsAccount(address expected, address caller);
    error CageAlreadyExists(address cage);

    constructor(
        bytes32 sourceId,
        address macFallback,
        AstryumRegistry astryumRegistry,
        address treasury,
        uint256 creationFee,
        uint16 maxPayeeBpsAllowed,
        uint16 freePotesPerCage,
        bytes32 anchorAddressHash,
        PoteDeployer poteDeployer
    ) {
        if (sourceId == bytes32(0)) revert ZeroSourceId();
        if (anchorAddressHash == bytes32(0)) revert ZeroAnchor();
        if (
            macFallback == address(0) || address(astryumRegistry) == address(0) || treasury == address(0)
                || address(poteDeployer) == address(0)
        ) revert ZeroAddress();
        SOURCE_ID = sourceId;
        MAC_FALLBACK = macFallback;
        ASTRYUM_REGISTRY = astryumRegistry;
        TREASURY = treasury;
        CREATION_FEE = creationFee;
        MAX_PAYEE_BPS_ALLOWED = maxPayeeBpsAllowed;
        FREE_POTES_PER_CAGE = freePotesPerCage;
        ANCHOR_ADDRESS_HASH = anchorAddressHash;
        POTE_DEPLOYER = poteDeployer;
        CAGE_DEPLOYER = new CageDeployer();
    }

    function masterAccountController() public view returns (address) {
        address mac = FLARE_REGISTRY.getContractAddressByName(MAC_NAME);
        return mac == address(0) ? MAC_FALLBACK : mac;
    }

    /// @notice Desplegar la jaula de ESTA cuenta XRPL: bridge v2, jaula, atados,
    ///         en una tx. La lista eterna la eligió el quórum, porque solo el
    ///         quórum puede hacer que esta llamada ocurra.
    function create(string calldata councilAddress, CageParams calldata p)
        external
        returns (address bridge, address cage)
    {
        if (bytes(councilAddress).length == 0) revert EmptyCouncilAddress();
        bytes32 councilHash = keccak256(bytes(councilAddress));

        address existing = cageOf[councilHash];
        if (existing != address(0)) revert CageAlreadyExists(existing);

        address personalAccount =
            IMasterAccountController(masterAccountController()).getPersonalAccount(councilAddress);
        if (personalAccount == address(0)) revert NoPersonalAccount(councilAddress);
        if (msg.sender != personalAccount) revert NotThisCouncilsAccount(personalAccount, msg.sender);

        // Mismo orden de nacimiento que el Legacy: el consejo EVM espejo no existe
        // ni un bloque.
        XrplCouncilBridgeV2 b = new XrplCouncilBridgeV2{salt: councilHash}(councilHash, SOURCE_ID, ANCHOR_ADDRESS_HASH);
        address c = CAGE_DEPLOYER.deploy(
            councilHash,
            address(b),
            p.asset,
            ASTRYUM_REGISTRY,
            p.constitutionRef,
            TREASURY,
            CREATION_FEE,
            MAX_PAYEE_BPS_ALLOWED,
            FREE_POTES_PER_CAGE,
            POTE_DEPLOYER,
            p.allowedTargets
        );
        b.bind(c);

        cageOf[councilHash] = c;
        bridgeOf[councilHash] = address(b);
        allCages.push(c);

        emit CageCreated(councilHash, councilAddress, address(b), c, personalAccount);
        return (address(b), c);
    }

    // ── Lecturas (la mitad registro) ─────────────────────────────────────────

    /// @notice Alias con la MISMA interfaz que las factories anteriores
    ///         (`vaultOf`/`bridgeOf`): el resolver del backend pregunta a los tres
    ///         registros con un solo ABI, y el relay sirve las órdenes de una jaula
    ///         sin cambiar una línea. Para su bridge, la jaula ES su «vault».
    function vaultOf(bytes32 councilAddressHash) external view returns (address) {
        return cageOf[councilAddressHash];
    }

    function cageOfAddress(string calldata councilAddress) external view returns (address) {
        return cageOf[keccak256(bytes(councilAddress))];
    }

    function bridgeOfAddress(string calldata councilAddress) external view returns (address) {
        return bridgeOf[keccak256(bytes(councilAddress))];
    }

    function cageCount() external view returns (uint256) {
        return allCages.length;
    }

    /// @notice Dónde vivirá la jaula de esta cuenta antes de existir.
    function predictAddresses(string calldata councilAddress, CageParams calldata p)
        external
        view
        returns (address bridge, address cage)
    {
        bytes32 councilHash = keccak256(bytes(councilAddress));
        bridge = _create2Address(
            address(this),
            councilHash,
            keccak256(
                abi.encodePacked(
                    type(XrplCouncilBridgeV2).creationCode, abi.encode(councilHash, SOURCE_ID, ANCHOR_ADDRESS_HASH)
                )
            )
        );
        cage = _create2Address(
            address(CAGE_DEPLOYER),
            councilHash,
            CAGE_DEPLOYER.cageInitCodeHash(
                bridge,
                p.asset,
                ASTRYUM_REGISTRY,
                p.constitutionRef,
                TREASURY,
                CREATION_FEE,
                MAX_PAYEE_BPS_ALLOWED,
                FREE_POTES_PER_CAGE,
                POTE_DEPLOYER,
                p.allowedTargets
            )
        );
    }

    function _create2Address(address creator, bytes32 salt, bytes32 initCodeHash) private pure returns (address) {
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), creator, salt, initCodeHash))))
        );
    }
}
