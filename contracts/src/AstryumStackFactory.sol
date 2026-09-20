// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {AstryumVault} from "./AstryumVault.sol";
import {XrplCouncilBridge} from "./XrplCouncilBridge.sol";

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
 * @notice The params that are ETERNAL in a pote, in one place — the exact list
 * a quorum must read before it signs (rule 7.4 of the Institutional doc: the
 * OPERATOR deploys, from an immutable factory, with no Astryum key inside).
 *
 * @param asset the pote's single asset (FXRP), resolved LIVE off-chain.
 * @param name/symbol the share-token identity ("Astryum Pote A", "apA-FXRP").
 * @param constitutionRef SHA-256 of the policy constitution anchored on XRPL.
 * @param cooldown the pote's exit shape: 0 = synchronous; >0 = request/claim.
 *        Sized from venue data (verify-firelight → 72h for the Firelight pote),
 *        never from belief.
 * @param bufferFloorBps the idle floor allocation cannot cross (I4).
 * @param initialVenues the birth set — active immediately, part of the audited
 *        constructor params; venues added LATER wait 30 days.
 */
struct AstryumCageParams {
    IERC20 asset;
    string name;
    string symbol;
    bytes32 constitutionRef;
    uint48 cooldown;
    uint16 bufferFloorBps;
    AstryumVault.InitialVenue[] initialVenues;
}

/**
 * @title AstryumVaultDeployer — the pote's bytecode, kept out of the factory
 *
 * @notice Same plumbing as LegacyVaultDeployer, same reason: a factory that
 * embeds both the bridge and the (bigger, ERC-4626) vault would crowd the
 * EIP-170 ceiling. Born with the factory, callable only by it — without the
 * caller check, anyone could CREATE2 a pote into a council's predicted
 * address with parameters of their choosing.
 */
contract AstryumVaultDeployer {
    address public immutable FACTORY;

    error NotFactory();

    constructor() {
        FACTORY = msg.sender;
    }

    function deploy(bytes32 salt, address bridge, AstryumCageParams calldata p) external returns (address) {
        if (msg.sender != FACTORY) revert NotFactory();
        return address(
            new AstryumVault{salt: salt}(
                p.asset, p.name, p.symbol, bridge, p.constitutionRef, p.cooldown, p.bufferFloorBps, p.initialVenues
            )
        );
    }

    function vaultInitCodeHash(address bridge, AstryumCageParams calldata p) external pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                type(AstryumVault).creationCode,
                abi.encode(
                    p.asset, p.name, p.symbol, bridge, p.constitutionRef, p.cooldown, p.bufferFloorBps, p.initialVenues
                )
            )
        );
    }
}

/**
 * @title AstryumStackFactory — one policy, one pote, born from XRPL
 *
 * @notice Clone of the proven LegacyStackFactory pattern (deployed & verified
 * on Flare mainnet), with the institutional pote's eternal params.
 * The Legacy factory stays untouched; this one births AstryumVaults.
 *
 * WHO MAY CREATE (the whole security model in one line): only the Personal
 * Account of the pote's own XRPL council. Producing that payment on a
 * multisig-only account IS the quorum — so the eternal params are chosen by
 * the same authority that will live under them, and nobody can squat,
 * front-run or mis-parameterize another operator's pote.
 *
 * ONE COUNCIL, ONE POTE (Z8): an operator with two policies runs two XRPL
 * council accounts. This keeps the resolver's cache model and the structural
 * separation of §7.3 (contracts, councils and constitutions never shared).
 *
 * WHAT THE FACTORY KEEPS: nothing. No owner, no funds, no pause, no upgrade.
 * After `create` it is only a public REGISTRY: `vaultOf(councilHash)`.
 */
contract AstryumStackFactory {
    IFlareContractRegistry public constant REGISTRY =
        IFlareContractRegistry(0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019);

    string private constant MAC_NAME = "MasterAccountController";

    /// @notice bytes32("XRP") on Flare mainnet, bytes32("testXRP") on Coston2.
    /// Deliberately NOT a create() parameter — one factory per network.
    bytes32 public immutable SOURCE_ID;

    /// @notice Fallback MasterAccountController when the registry does not
    /// list the name (same documented fallback the backend has carried since
    /// the first 0xFE integration). The registry stays the source of truth.
    address public immutable MAC_FALLBACK;

    AstryumVaultDeployer public immutable DEPLOYER;

    /// @notice councilAddressHash → this council's pote (0 = none yet).
    mapping(bytes32 => address) public vaultOf;
    /// @notice councilAddressHash → the bridge that pote obeys.
    mapping(bytes32 => address) public bridgeOf;

    address[] public allVaults;

    event StackCreated(
        bytes32 indexed councilAddressHash,
        string councilAddress,
        address indexed bridge,
        address indexed vault,
        address personalAccount
    );

    error ZeroSourceId();
    error ZeroAddress();
    error EmptyCouncilAddress();
    error NoPersonalAccount(string councilAddress);
    error NotThisCouncilsAccount(address expected, address caller);
    error CageAlreadyExists(address vault);

    constructor(bytes32 sourceId, address macFallback) {
        if (sourceId == bytes32(0)) revert ZeroSourceId();
        if (macFallback == address(0)) revert ZeroAddress();
        SOURCE_ID = sourceId;
        MAC_FALLBACK = macFallback;
        DEPLOYER = new AstryumVaultDeployer();
    }

    function masterAccountController() public view returns (address) {
        address mac = REGISTRY.getContractAddressByName(MAC_NAME);
        return mac == address(0) ? MAC_FALLBACK : mac;
    }

    /// @notice Deploy THIS council's pote: bridge, vault, bound, in one tx.
    /// Every field of `p` is ETERNAL; they are chosen by the quorum because
    /// only the quorum can make this call happen.
    function create(string calldata councilAddress, AstryumCageParams calldata p)
        external
        returns (address bridge, address vault)
    {
        if (bytes(councilAddress).length == 0) revert EmptyCouncilAddress();
        bytes32 councilHash = keccak256(bytes(councilAddress));

        address existing = vaultOf[councilHash];
        if (existing != address(0)) revert CageAlreadyExists(existing);

        address personalAccount =
            IMasterAccountController(masterAccountController()).getPersonalAccount(councilAddress);
        if (personalAccount == address(0)) revert NoPersonalAccount(councilAddress);
        if (msg.sender != personalAccount) revert NotThisCouncilsAccount(personalAccount, msg.sender);

        // Birth order unchanged from the Legacy stack: the EVM mirror council
        // never exists, not for one block.
        XrplCouncilBridge b = new XrplCouncilBridge{salt: councilHash}(councilHash, SOURCE_ID);
        address v = DEPLOYER.deploy(councilHash, address(b), p);
        b.bind(v);

        vaultOf[councilHash] = v;
        bridgeOf[councilHash] = address(b);
        allVaults.push(v);

        emit StackCreated(councilHash, councilAddress, address(b), v, personalAccount);
        return (address(b), v);
    }

    // ── Reads (the registry half) ────────────────────────────────────────────

    function vaultOfAddress(string calldata councilAddress) external view returns (address) {
        return vaultOf[keccak256(bytes(councilAddress))];
    }

    function bridgeOfAddress(string calldata councilAddress) external view returns (address) {
        return bridgeOf[keccak256(bytes(councilAddress))];
    }

    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }

    /// @notice Where this council's pote WILL live, before it exists — so one
    /// signed XRPL payment can create the pote AND make the genesis deposit
    /// (Z10) in the same batch.
    function predictAddresses(string calldata councilAddress, AstryumCageParams calldata p)
        external
        view
        returns (address bridge, address vault)
    {
        bytes32 councilHash = keccak256(bytes(councilAddress));
        bridge = _create2Address(
            address(this),
            councilHash,
            keccak256(abi.encodePacked(type(XrplCouncilBridge).creationCode, abi.encode(councilHash, SOURCE_ID)))
        );
        vault = _create2Address(address(DEPLOYER), councilHash, DEPLOYER.vaultInitCodeHash(bridge, p));
    }

    function _create2Address(address creator, bytes32 salt, bytes32 initCodeHash) private pure returns (address) {
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), creator, salt, initCodeHash))))
        );
    }
}
