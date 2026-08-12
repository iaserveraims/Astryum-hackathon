// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {LegacyVault} from "./LegacyVault.sol";
import {XrplCouncilBridge} from "./XrplCouncilBridge.sol";

/// The Flare Contract Registry — same address on every Flare network.
interface IFlareContractRegistry {
    function getContractAddressByName(string calldata _name) external view returns (address);
}

/// The Flare Smart Accounts surface used here: the Personal Account an XRPL
/// address controls. It acts ONLY when that XRPL account signs a payment whose
/// memo commits the calls — on a council account, that means the quorum.
interface IMasterAccountController {
    function getPersonalAccount(string calldata _xrplAddress) external view returns (address);
}

/**
 * @notice The params that are ETERNAL in a vault, in one place.
 *
 * Grouped deliberately: this is the exact list a quorum must read before it
 * signs, and the exact list the composer must get right. Nothing here can be
 * changed afterwards except the linaje rate (inside its band) and the
 * constitution pointer — both by quorum order.
 *
 * @param asset the cage's single asset (FXRP), resolved LIVE from
 *        AssetManagerFXRP.fAsset() by whoever composes the call.
 * @param constitutionRef SHA-256 of the constitution version already anchored
 *        on XRPL (DIDSet) — the text these params implement.
 * @param protocolTreasury fee recipient (D6). address(0) makes the protocol fee
 *        hook unusable in this vault FOR EVER, which is a valid choice.
 * @param linajeFeeBps initial linaje rate; the vault's own constructor enforces
 *        the [10%, 40%] band (D5).
 * @param initialVenues the birth set — active immediately, exactly as in the
 *        hand-run deploy (venues added later wait 30 days, D1a).
 */
struct CageParams {
    IERC20 asset;
    bytes32 constitutionRef;
    address protocolTreasury;
    uint16 linajeFeeBps;
    LegacyVault.InitialVenue[] initialVenues;
}

/**
 * @title LegacyVaultDeployer — the vault's bytecode, kept out of the factory
 *
 * @notice Pure plumbing, born with the factory and useful to nobody else: it
 * exists because a factory that embeds BOTH contracts lands at 24,176 bytes of
 * runtime, 400 short of the EIP-170 ceiling. A contract meant to be eternal
 * must not sit at 98% of a hard limit.
 *
 * @dev Created by the factory IN ITS CONSTRUCTOR, so `FACTORY` is its creator
 * and can never be anyone else, and the pairing needs no configuration step.
 * The caller check is not decoration: without it, anyone could CREATE2 a vault
 * into the address a council's cage is predicted at, with parameters of their
 * choosing, before the council's own transaction lands.
 */
contract LegacyVaultDeployer {
    /// @notice The one contract that may ask for a vault.
    address public immutable FACTORY;

    error NotFactory();

    constructor() {
        FACTORY = msg.sender;
    }

    /// @notice Deploy a vault at the council's deterministic address.
    function deploy(bytes32 salt, address bridge, CageParams calldata p) external returns (address) {
        if (msg.sender != FACTORY) revert NotFactory();
        return address(
            new LegacyVault{salt: salt}(
                p.asset, bridge, p.constitutionRef, p.protocolTreasury, p.linajeFeeBps, p.initialVenues
            )
        );
    }

    /// @notice The initcode hash the factory needs to predict that address.
    function vaultInitCodeHash(address bridge, CageParams calldata p) external pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                type(LegacyVault).creationCode,
                abi.encode(
                    p.asset, bridge, p.constitutionRef, p.protocolTreasury, p.linajeFeeBps, p.initialVenues
                )
            )
        );
    }
}

/**
 * @title LegacyStackFactory — one Legacy, one cage, born from XRPL
 *
 * @notice Until now a cage was deployed by hand, once, and the product read it
 * from configuration — so every Legacy in the install pointed at the SAME
 * vault. Reading it was cosmetic damage. Funding it was not: the funding rail
 * composes a mint that deposits into the vault, and no function in the vault
 * pays principal to an address. A second council would have signed its own
 * capital into the first council's cage, permanently (founder, 2026-08-05).
 *
 * The deployed code already stated the rule — XrplCouncilBridge holds
 * COUNCIL_ADDRESS_HASH as `immutable`, so one bridge obeys one XRPL council for
 * ever. This factory makes that rule the only way a cage can be born.
 *
 * WHO MAY CREATE (the whole security model in one line): only the Personal
 * Account of the council itself. A Flare Smart Account acts on the strength of
 * an XRPL payment whose memo commits the exact calls; on a multisig-only
 * council account, producing that payment IS the quorum. So the params that are
 * eternal — asset, constitution, linaje rate, birth venues — are chosen by the
 * same quorum that will live under them, and nobody can squat, front-run or
 * mis-parameterize another Legacy's cage.
 *
 * WHAT THE FACTORY KEEPS: nothing. It has no owner, holds no funds, cannot
 * pause, upgrade or migrate anything. It deploys the pair in the roadmap's
 * birth order (bridge → vault(council = the bridge) → bind), and `bind` is
 * one-shot and restricted to the bridge's DEPLOYER, which is this factory and
 * only inside that same transaction. After `create` returns, the factory's only
 * remaining role is as a public REGISTRY: `vaultOf(councilHash)` is how the
 * product answers "which cage is this Legacy's?" without trusting a database.
 *
 * @dev CREATE2 with the council hash as salt: the addresses are computable
 * off-chain BEFORE the quorum signs, so one signed payment can create the cage
 * and deposit into it in the same batch (the calls that follow `create` in the
 * batch can already name the vault). The salt does not make the address
 * council-only by itself — the caller check does — it makes it predictable.
 */
contract LegacyStackFactory {
    /// @notice The Flare Contract Registry (identical across Flare networks).
    IFlareContractRegistry public constant REGISTRY =
        IFlareContractRegistry(0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019);

    string private constant MAC_NAME = "MasterAccountController";

    /**
     * @notice The FDC source every bridge born here is pinned to:
     * bytes32("XRP") on Flare mainnet, bytes32("testXRP") on Coston2.
     *
     * @dev Deliberately NOT a parameter of `create`. A bridge born expecting
     * "testXRP" on mainnet would verify no proof ever, and nothing could fix
     * it: the field is immutable and the cage it guards has no exit. One
     * factory per network, and the network decides.
     */
    bytes32 public immutable SOURCE_ID;

    /**
     * @notice Fallback MasterAccountController, used ONLY when the registry
     * does not list the name. The registry may not carry
     * "MasterAccountController" (the backend has carried this same documented
     * fallback since the first 0xFE integration for exactly that reason) — and
     * without a resolvable MAC, `create` could authorize nobody, ever. The
     * registry stays the source of truth: when Flare governance registers or
     * upgrades the controller, that address wins automatically.
     */
    address public immutable MAC_FALLBACK;

    /// @notice The helper that carries the vault's bytecode (born with this
    /// factory, callable only by it). Vault addresses are CREATE2'd from HERE.
    LegacyVaultDeployer public immutable DEPLOYER;

    /// @notice councilAddressHash → the cage of that council (0 = none yet).
    mapping(bytes32 => address) public vaultOf;
    /// @notice councilAddressHash → the bridge that cage obeys.
    mapping(bytes32 => address) public bridgeOf;

    /// @notice Every cage ever born here, in order (a public census).
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
        DEPLOYER = new LegacyVaultDeployer();
    }

    /// @notice The MasterAccountController this factory obeys right now:
    /// the registry's answer, or the deploy-time fallback when unlisted.
    function masterAccountController() public view returns (address) {
        address mac = REGISTRY.getContractAddressByName(MAC_NAME);
        return mac == address(0) ? MAC_FALLBACK : mac;
    }

    /**
     * @notice Deploy THIS council's cage: bridge, vault, bound, in one tx.
     *
     * @param councilAddress the council's XRPL r-address, as text. Hashed here
     *        with keccak256(bytes(...)) — the FDC standard address hash — so the
     *        caller cannot supply a hash that does not match the account it
     *        claims to be, which was the classic way to brick a deployment.
     * @param p the eternal params (see {CageParams}).
     *
     * @dev Every field of `p` is ETERNAL in the vault. They are chosen by the
     * quorum because only the quorum can make this call happen.
     */
    function create(string calldata councilAddress, CageParams calldata p)
        external
        returns (address bridge, address vault)
    {
        if (bytes(councilAddress).length == 0) revert EmptyCouncilAddress();
        bytes32 councilHash = keccak256(bytes(councilAddress));

        // One council, one cage. A second one would split a family's capital
        // across two vessels the constitution does not describe; succession is
        // what `migrate` is for.
        address existing = vaultOf[councilHash];
        if (existing != address(0)) revert CageAlreadyExists(existing);

        // The authority check. The Personal Account of an XRPL address acts
        // only when that address signs — and this address is a council.
        address personalAccount =
            IMasterAccountController(masterAccountController()).getPersonalAccount(councilAddress);
        if (personalAccount == address(0)) revert NoPersonalAccount(councilAddress);
        if (msg.sender != personalAccount) revert NotThisCouncilsAccount(personalAccount, msg.sender);

        // Birth order, unchanged from DeployLegacyStack: the EVM mirror council
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

    // ── Reads (the registry half — this is what the product asks) ────────────

    /// @notice The cage of an XRPL council, by its address as text.
    function vaultOfAddress(string calldata councilAddress) external view returns (address) {
        return vaultOf[keccak256(bytes(councilAddress))];
    }

    /// @notice The bridge of an XRPL council, by its address as text.
    function bridgeOfAddress(string calldata councilAddress) external view returns (address) {
        return bridgeOf[keccak256(bytes(councilAddress))];
    }

    /// @notice How many cages were born here.
    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }

    /**
     * @notice Where this council's cage WILL live, before it exists.
     *
     * Lets one signed XRPL payment create the cage and deposit into it in the
     * same batch: the composer computes the address, and the calls that follow
     * `create` name it. Same CREATE2 inputs the deployment uses, so a mismatch
     * is impossible by construction rather than by convention.
     */
    function predictAddresses(string calldata councilAddress, CageParams calldata p)
        external
        view
        returns (address bridge, address vault)
    {
        bytes32 councilHash = keccak256(bytes(councilAddress));
        // The bridge is CREATE2'd by the factory, the vault by the deployer —
        // each address is derived against ITS creator, or it would not match.
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
