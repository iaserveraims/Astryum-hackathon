// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

/// Minimal ERC-4626 surface the vault consumes (Firelight stXRP, earnXRP —
/// verified in-repo 2026-07-10: asset()==FXRP, standard deposit/withdraw/redeem).
interface IERC4626Venue {
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function balanceOf(address) external view returns (uint256);
}

/// Minimal Compound-v2-fork surface (Kinetic kFXRP: mint/redeemUnderlying
/// return 0 on success, error code otherwise — verified in-repo KineticAdapter).
interface ICompoundVenue {
    function mint(uint256 mintAmount) external returns (uint256);
    function redeemUnderlying(uint256 redeemAmount) external returns (uint256);
    function redeem(uint256 redeemTokens) external returns (uint256);
    function exchangeRateStored() external view returns (uint256);
    function balanceOf(address) external view returns (uint256);
}

/// Continuity surface a successor vault must expose (D4).
interface ILegacyVaultContinuity {
    function council() external view returns (address);
    function constitutionRef() external view returns (bytes32);
    function asset() external view returns (address);
    function deposit(uint256 amount) external;
}

/**
 * @title LegacyVault — the cage of code (Astryum Legacy, epochal vessel v1)
 *
 * @notice The thesis (auditoría de la constitución del producto, 2026-07-13 §4):
 * the AUTHORITY is eternal (the council + its constitution, anchored on XRPL);
 * this contract is an EPOCHAL VESSEL where the capital produces without being
 * sellable. The code cages the PRINCIPAL; the fruits are governed by the council.
 *
 * WHAT DOES NOT EXIST IN THIS CODE (the product):
 *  - No withdrawPrincipal(). No transferTo(arbitrary). No proxy, no upgrade.
 *  - Principal can only move: vault <-> whitelisted venues, or — through a
 *    30-day-delayed, continuity-verified migration — to a successor vault
 *    with the SAME council and the SAME constitution (D4).
 *  - Only yield ever leaves to people: harvest() splits realized yield into
 *    the linaje cut (capitalized to principal, D5), the protocol fee (hard-
 *    capped, default 0, D6) and the council-configured payees (D3).
 *
 * Founder decisions wired in:
 *  D1a  addVenue takes effect after VENUE_DELAY (30d, on-chain event at
 *       proposal); moveToVenue/evacuate/recall are IMMEDIATE (rescue).
 *  D2   maxVenueBps caps capital ENTRY only (deposit path / directTo);
 *       rescue moves are never blocked by the cap.
 *  D3   harvest() is permissionless; director directs but does not earn by
 *       role; only payees (council-set bps) receive the distributable yield.
 *  D4   successorVault: single slot, 30d delay, continuity re-verified at
 *       execution (same council, same constitutionRef, same asset).
 *  D5   linaje fee: floor 10% immutable, rate adjustable in [10%, 40%].
 *  D6   protocol fee hook on YIELD only: hard cap 10% immutable, default 0,
 *       recipient fixed at deploy, schedule public (F-2/F-3).
 *  D7   the native XRP reserve lives OUTSIDE this contract by design — the
 *       vault only ever receives the productive-layer allocation.
 *
 * Accounting is in VALUE terms of the asset (FXRP): principal is a book
 * figure (deposits + capitalized linaje cuts − realized venue losses);
 * yield(venue) = venueValue − venueBasis. "The principal never moved" is a
 * value statement and the code makes it true: no call sequence can pay out
 * more than realized yield. Venue risk is NOT eliminated by the cage (a
 * drained venue loses value all the same) — that is what maxVenueBps,
 * immediate rescue moves and the native reserve (D7) are for.
 *
 * Every governance mutation requires the caller to present the CURRENT
 * constitutionRef (the SHA-256 anchored on XRPL via DIDSet) and emits it —
 * parameters stay chained to the version of the rules they implement (P3).
 */
contract LegacyVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Immutable identity ───────────────────────────────────────────────────

    /// @notice The single asset of this vessel (FXRP).
    IERC20 public immutable ASSET;
    /// @notice Protocol fee recipient, fixed at birth (Astryum treasury).
    address public immutable PROTOCOL_TREASURY;

    // ── Immutable rules (the cage — no function changes these) ──────────────

    uint16 public constant LINAJE_FLOOR_BPS = 1000; // 10% — the linaje always eats (D5)
    uint16 public constant LINAJE_CEIL_BPS = 4000; // 40% — the ceiling protects the fruit (D5)
    uint16 public constant PROTOCOL_FEE_CAP_BPS = 1000; // 10% hard cap, forever (D6)
    uint16 public constant MIN_VENUE_CAP_BPS = 1000; // cap can never brick entry entirely
    uint32 public constant VENUE_DELAY = 30 days; // D1a — adding a venue IS the power to extract
    uint32 public constant SUCCESSOR_DELAY = 30 days; // D4
    uint16 internal constant BPS = 10_000;

    // ── Governance state (quorum-modifiable, always with constitutionRef) ───

    address public council;
    address public pendingCouncil;
    bytes32 public constitutionRef;

    address public director;
    uint64 public directorUntil;

    uint16 public maxVenueBps = BPS; // D2 — entry cap; starts open (1-2 venues at launch)
    uint16 public linajeFeeBps; // within [floor, ceil]
    uint16 public protocolFeeBps; // 0 at birth (D6)

    struct Payee {
        address account;
        uint16 bps;
    }

    Payee[] public payees; // empty ⇒ all distributable yield capitalizes to the linaje

    // ── Venues ───────────────────────────────────────────────────────────────

    enum VenueKind {
        ERC4626,
        CompoundV2
    }

    struct Venue {
        address target;
        VenueKind kind;
        uint64 readyAt; // D1a: entry allowed only from here
        bool retired; // closed to NEW entries; exits always work
    }

    Venue[] public venues;
    mapping(uint256 => uint256) public venueBasis; // principal allocated per venue

    // ── Principal & fruit accounting ─────────────────────────────────────────

    uint256 public totalPrincipal; // deposits + capitalized linaje − realized losses
    uint256 public allocatedPrincipal; // Σ venueBasis
    mapping(address => uint256) public claimable; // payees + protocol treasury (pull)
    uint256 public totalClaimable;

    // ── Succession (D4) ──────────────────────────────────────────────────────

    address public successor;
    uint64 public successorEta;
    bool public migrated;

    // ── Events (the council audits by events; governance carries the ref) ───

    event Deposited(address indexed from, uint256 amount, uint256 totalPrincipal);
    event Allocated(uint256 indexed venueId, uint256 amount, address indexed by);
    event Recalled(uint256 indexed venueId, uint256 amount);
    event Moved(uint256 indexed fromId, uint256 indexed toId, uint256 amount);
    event Evacuated(uint256 indexed venueId, uint256 received, uint256 principalPart, uint256 excessYield);
    event PrincipalLossRealised(uint256 indexed venueId, uint256 loss, uint256 totalPrincipal);
    event Harvested(
        uint256 indexed venueId, uint256 yieldRealized, uint256 linajeCut, uint256 protocolCut, uint256 toPayees
    );
    event Claimed(address indexed account, uint256 amount);
    event VenueProposed(uint256 indexed venueId, address target, VenueKind kind, uint64 readyAt, bytes32 constitutionRef);
    event VenueRetired(uint256 indexed venueId, bytes32 constitutionRef);
    event MaxVenueCapSet(uint16 bps, bytes32 constitutionRef);
    event LinajeFeeSet(uint16 bps, bytes32 constitutionRef);
    event ProtocolFeeSet(uint16 bps, bytes32 constitutionRef);
    event PayeesSet(uint256 count, bytes32 constitutionRef);
    event CessionGranted(address indexed director, uint64 until, bytes32 constitutionRef);
    event CessionEnded(bytes32 constitutionRef);
    event ConstitutionRefUpdated(bytes32 indexed oldRef, bytes32 indexed newRef);
    event CouncilTransferStarted(address indexed current, address indexed pending, bytes32 constitutionRef);
    event CouncilTransferred(address indexed oldCouncil, address indexed newCouncil);
    event SuccessorProposed(address indexed successor, uint64 eta, bytes32 constitutionRef);
    event SuccessorCancelled(address indexed successor, bytes32 constitutionRef);
    event Migrated(address indexed successor, uint256 amountMoved, uint256 leftForClaims);

    // ── Errors ───────────────────────────────────────────────────────────────

    error NotCouncil();
    error NotDirectorOrCouncil();
    error RefMismatch();
    error AlreadyMigrated();
    error VenueNotReady();
    error VenueRetiredError();
    error VenueUnknown();
    error EntryCapExceeded();
    error InsufficientIdlePrincipal();
    error InsufficientVenueBasis();
    error BpsOutOfBounds();
    error PayeeBpsSumInvalid();
    error ZeroAddress();
    error ZeroAmount();
    error NothingToClaim();
    error CompoundCallFailed(uint256 code);
    error ContinuityBroken();
    error SuccessorNotSet();
    error SuccessorNotMature();
    error DuplicateVenue();

    // ── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyCouncil() {
        if (msg.sender != council) revert NotCouncil();
        _;
    }

    /// Every governance mutation states WHICH constitution version it acts
    /// under (P3): a stale ref reverts, and the event chains rule to text.
    modifier withRef(bytes32 ref) {
        if (ref != constitutionRef) revert RefMismatch();
        _;
    }

    modifier notMigrated() {
        if (migrated) revert AlreadyMigrated();
        _;
    }

    // ── Birth ────────────────────────────────────────────────────────────────

    struct InitialVenue {
        address target;
        VenueKind kind;
    }

    /// @param asset_ FXRP.
    /// @param council_ the council (EVM multisig — the canonical authority of
    ///        this vessel until FDC governance makes "XRPL governs" literal).
    /// @param constitutionRef_ SHA-256 of the constitution version in force
    ///        (the same digest anchored on XRPL via DIDSet).
    /// @param protocolTreasury_ fixed fee recipient (D6). May be zero ONLY if
    ///        the fee hook is to be unusable (then setProtocolFeeBps reverts).
    /// @param linajeFeeBps_ initial linaje rate, in [10%, 40%] (D5).
    /// @param initialVenues venues reviewed at deploy — ready immediately
    ///        (the birth set is part of the audited constructor params; venues
    ///        added LATER wait VENUE_DELAY, D1a).
    constructor(
        IERC20 asset_,
        address council_,
        bytes32 constitutionRef_,
        address protocolTreasury_,
        uint16 linajeFeeBps_,
        InitialVenue[] memory initialVenues
    ) {
        if (address(asset_) == address(0) || council_ == address(0)) revert ZeroAddress();
        if (linajeFeeBps_ < LINAJE_FLOOR_BPS || linajeFeeBps_ > LINAJE_CEIL_BPS) revert BpsOutOfBounds();
        ASSET = asset_;
        council = council_;
        constitutionRef = constitutionRef_;
        PROTOCOL_TREASURY = protocolTreasury_;
        linajeFeeBps = linajeFeeBps_;
        for (uint256 i = 0; i < initialVenues.length; i++) {
            _addVenue(initialVenues[i].target, initialVenues[i].kind, uint64(block.timestamp));
        }
    }

    // ── Capital in (permissionless top-up; the 0xFE batch ends here) ────────

    /// @notice Add principal. Anyone may feed the linaje; nobody unfeeds it.
    function deposit(uint256 amount) external nonReentrant notMigrated {
        if (amount == 0) revert ZeroAmount();
        ASSET.safeTransferFrom(msg.sender, address(this), amount);
        totalPrincipal += amount;
        emit Deposited(msg.sender, amount, totalPrincipal);
    }

    // ── Direction (the cession: direct where it produces, never touch it) ───

    /// @notice Put idle principal to work in a whitelisted venue.
    /// Director (during a live cession) or council. Entry cap enforced (D2).
    function directTo(uint256 venueId, uint256 amount, bytes32 ref)
        external
        nonReentrant
        notMigrated
        withRef(ref)
    {
        if (!(msg.sender == council || (msg.sender == director && block.timestamp < directorUntil))) {
            revert NotDirectorOrCouncil();
        }
        _allocate(venueId, amount, true);
        emit Allocated(venueId, amount, msg.sender);
    }

    /// @notice Council: pull principal back from a venue into the vault (idle).
    /// Immediate — exits are never delayed nor capped (D1a/D2).
    function recall(uint256 venueId, uint256 amount, bytes32 ref)
        external
        nonReentrant
        onlyCouncil
        withRef(ref)
    {
        if (amount == 0) revert ZeroAmount();
        if (amount > venueBasis[venueId]) revert InsufficientVenueBasis();
        uint256 received = _withdrawExact(venueId, amount);
        venueBasis[venueId] -= amount;
        allocatedPrincipal -= amount;
        if (received < amount) {
            // The venue paid less than the principal recalled: honest books.
            uint256 loss = amount - received;
            totalPrincipal -= loss;
            emit PrincipalLossRealised(venueId, loss, totalPrincipal);
        } else if (received > amount) {
            _splitYield(venueId, received - amount);
        }
        emit Recalled(venueId, amount);
    }

    /// @notice Council rescue: move principal venue→venue in ONE call.
    /// Never delayed, never capped (D2: a cap that blocks its own emergency
    /// kills what it protects). Destination must be a live, mature venue.
    function moveToVenue(uint256 fromId, uint256 toId, uint256 amount, bytes32 ref)
        external
        nonReentrant
        onlyCouncil
        withRef(ref)
    {
        if (amount == 0) revert ZeroAmount();
        if (amount > venueBasis[fromId]) revert InsufficientVenueBasis();
        uint256 received = _withdrawExact(fromId, amount);
        venueBasis[fromId] -= amount;
        allocatedPrincipal -= amount;
        if (received < amount) {
            uint256 loss = amount - received;
            totalPrincipal -= loss;
            emit PrincipalLossRealised(fromId, loss, totalPrincipal);
        } else if (received > amount) {
            _splitYield(fromId, received - amount);
            received = amount;
        }
        _allocate(toId, received, false); // rescue: no entry cap (D2)
        emit Moved(fromId, toId, received);
    }

    /// @notice Council emergency: redeem EVERYTHING a venue holds back to the
    /// vault. Losses are realized; any excess over basis is yield and goes
    /// through the normal split. The venue keeps nothing.
    function evacuate(uint256 venueId, bytes32 ref) external nonReentrant onlyCouncil withRef(ref) {
        (uint256 received, uint256 principalPart, uint256 excess) = _evacuate(venueId);
        if (excess > 0) _splitYield(venueId, excess);
        emit Evacuated(venueId, received, principalPart, excess);
    }

    // ── The fruit (permissionless harvest; pull-pattern claims) ─────────────

    /// @notice Realize a venue's yield (value above basis) and split it:
    /// linaje cut capitalizes to principal (D5), protocol cut accrues to the
    /// fixed treasury (D6, default 0), the rest accrues to payees (D3).
    /// Permissionless: a keeper, a payee, anyone — the split is fixed by code.
    function harvest(uint256 venueId) external nonReentrant notMigrated {
        uint256 value = venueValue(venueId);
        uint256 basis = venueBasis[venueId];
        if (value <= basis) {
            emit Harvested(venueId, 0, 0, 0, 0);
            return; // venue flat or under water: yield is zero, basis is never touched
        }
        uint256 gross = value - basis;
        uint256 received = _withdrawExact(venueId, gross);
        _splitYield(venueId, received);
    }

    /// @notice Pull what harvests assigned to you (payees + protocol treasury).
    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        totalClaimable -= amount;
        ASSET.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    // ── Governance (council only; every call states the constitution) ───────

    /// @notice D1a — proposing a venue IS the only power equivalent to
    /// extraction, so it is the only delayed one: entry opens after 30 days,
    /// announced on-chain now.
    function proposeVenue(address target, VenueKind kind, bytes32 ref)
        external
        onlyCouncil
        notMigrated
        withRef(ref)
    {
        _addVenue(target, kind, uint64(block.timestamp + VENUE_DELAY));
    }

    /// @notice Close a venue to NEW entries, immediately. Never force-
    /// liquidates: what is inside stays harvestable and rescuable.
    function retireVenue(uint256 venueId, bytes32 ref) external onlyCouncil withRef(ref) {
        if (venueId >= venues.length) revert VenueUnknown();
        venues[venueId].retired = true;
        emit VenueRetired(venueId, ref);
    }

    function setMaxVenueBps(uint16 bps, bytes32 ref) external onlyCouncil withRef(ref) {
        if (bps < MIN_VENUE_CAP_BPS || bps > BPS) revert BpsOutOfBounds();
        maxVenueBps = bps;
        emit MaxVenueCapSet(bps, ref);
    }

    function setLinajeFeeBps(uint16 bps, bytes32 ref) external onlyCouncil withRef(ref) {
        if (bps < LINAJE_FLOOR_BPS || bps > LINAJE_CEIL_BPS) revert BpsOutOfBounds();
        linajeFeeBps = bps;
        emit LinajeFeeSet(bps, ref);
    }

    /// @notice D6 — the now-or-never fee hook. On yield only, hard-capped
    /// forever at 10%, recipient fixed at birth. Activation is a later,
    /// separate, disclosed decision (F-2); the schedule is public (F-3).
    function setProtocolFeeBps(uint16 bps, bytes32 ref) external onlyCouncil withRef(ref) {
        if (PROTOCOL_TREASURY == address(0)) revert ZeroAddress();
        if (bps > PROTOCOL_FEE_CAP_BPS) revert BpsOutOfBounds();
        protocolFeeBps = bps;
        emit ProtocolFeeSet(bps, ref);
    }

    /// @notice D3 — the single source of truth on who receives fruit. Bps must
    /// sum exactly 10000, or the list be empty (then everything capitalizes).
    function setPayees(address[] calldata accounts, uint16[] calldata bps, bytes32 ref)
        external
        onlyCouncil
        withRef(ref)
    {
        if (accounts.length != bps.length) revert PayeeBpsSumInvalid();
        delete payees;
        uint256 sum;
        for (uint256 i = 0; i < accounts.length; i++) {
            if (accounts[i] == address(0)) revert ZeroAddress();
            if (bps[i] == 0) revert BpsOutOfBounds();
            sum += bps[i];
            payees.push(Payee({account: accounts[i], bps: bps[i]}));
        }
        if (accounts.length > 0 && sum != BPS) revert PayeeBpsSumInvalid();
        emit PayeesSet(accounts.length, ref);
    }

    /// @notice The cession (L2): the director gains the right to DIRECT within
    /// the whitelist — never the assets, and no payment by role (D3).
    function cede(address director_, uint64 until, bytes32 ref) external onlyCouncil withRef(ref) {
        if (director_ == address(0)) revert ZeroAddress();
        director = director_;
        directorUntil = until;
        emit CessionGranted(director_, until, ref);
    }

    function endCession(bytes32 ref) external onlyCouncil withRef(ref) {
        director = address(0);
        directorUntil = 0;
        emit CessionEnded(ref);
    }

    /// @notice New constitution version (already anchored on XRPL via a
    /// quorum-signed DIDSet): the caller proves it knows the version it is
    /// replacing. Every later governance call must present the new ref.
    function setConstitutionRef(bytes32 newRef, bytes32 oldRef) external onlyCouncil {
        if (oldRef != constitutionRef) revert RefMismatch();
        emit ConstitutionRefUpdated(constitutionRef, newRef);
        constitutionRef = newRef;
    }

    /// @notice Two-step council handover (a fat-fingered address must not be
    /// able to orphan the vessel).
    function transferCouncil(address newCouncil, bytes32 ref) external onlyCouncil withRef(ref) {
        if (newCouncil == address(0)) revert ZeroAddress();
        pendingCouncil = newCouncil;
        emit CouncilTransferStarted(council, newCouncil, ref);
    }

    function acceptCouncil() external {
        if (msg.sender != pendingCouncil) revert NotCouncil();
        emit CouncilTransferred(council, pendingCouncil);
        council = pendingCouncil;
        pendingCouncil = address(0);
    }

    // ── Succession (D4 — the vessel is epochal; the authority is eternal) ───

    /// @notice Propose the successor vessel. Continuity is checked NOW and
    /// AGAIN at execution: same council, same constitution, same asset.
    function proposeSuccessor(address successor_, bytes32 ref) external onlyCouncil notMigrated withRef(ref) {
        _checkContinuity(successor_);
        successor = successor_;
        successorEta = uint64(block.timestamp + SUCCESSOR_DELAY);
        emit SuccessorProposed(successor_, successorEta, ref);
    }

    function cancelSuccessor(bytes32 ref) external onlyCouncil withRef(ref) {
        emit SuccessorCancelled(successor, ref);
        successor = address(0);
        successorEta = 0;
    }

    /// @notice The governed move: after 30 days, and only into a vessel that
    /// still has the same council and constitution, everything (except what
    /// payees have already earned) becomes principal of the successor.
    /// Not an upgrade — a verified relocation.
    function migrate(bytes32 ref) external nonReentrant onlyCouncil notMigrated withRef(ref) {
        if (successor == address(0)) revert SuccessorNotSet();
        if (block.timestamp < successorEta) revert SuccessorNotMature();
        _checkContinuity(successor);

        // Bring every venue home first (losses realized, excess split).
        for (uint256 i = 0; i < venues.length; i++) {
            if (venueBasis[i] > 0 || _venueRawBalance(i) > 0) {
                (uint256 received, uint256 principalPart, uint256 excess) = _evacuate(i);
                if (excess > 0) _splitYield(i, excess);
                emit Evacuated(i, received, principalPart, excess);
            }
        }

        // Everything except earned-but-unclaimed fruit moves as PRINCIPAL of
        // the successor (unharvested remainders capitalize — favors the linaje).
        uint256 balance = ASSET.balanceOf(address(this));
        uint256 amountToMove = balance - totalClaimable;
        migrated = true;
        if (amountToMove > 0) {
            ASSET.forceApprove(address(successor), amountToMove);
            ILegacyVaultContinuity(successor).deposit(amountToMove);
        }
        emit Migrated(successor, amountToMove, totalClaimable);
    }

    // ── Views (F-3: the schedule is public; the council audits by reads) ────

    function venueCount() external view returns (uint256) {
        return venues.length;
    }

    function payeeCount() external view returns (uint256) {
        return payees.length;
    }

    function asset() external view returns (address) {
        return address(ASSET);
    }

    /// @notice Current value a venue holds for the vault, in asset terms.
    function venueValue(uint256 venueId) public view returns (uint256) {
        if (venueId >= venues.length) revert VenueUnknown();
        Venue storage v = venues[venueId];
        if (v.kind == VenueKind.ERC4626) {
            return IERC4626Venue(v.target).convertToAssets(IERC4626Venue(v.target).balanceOf(address(this)));
        }
        // CompoundV2: stale-by-one-block rate is the standard read (accrual
        // catches up on the next state-changing call).
        return (ICompoundVenue(v.target).balanceOf(address(this)) * ICompoundVenue(v.target).exchangeRateStored()) / 1e18;
    }

    /// @notice Principal sitting in the vault, not yet directed to a venue.
    function idlePrincipal() public view returns (uint256) {
        return totalPrincipal - allocatedPrincipal;
    }

    /// @notice Whole-vessel value in asset terms (idle + every venue).
    function totalValue() public view returns (uint256) {
        uint256 v = ASSET.balanceOf(address(this)) - totalClaimable;
        for (uint256 i = 0; i < venues.length; i++) {
            v += venueValue(i);
        }
        return v;
    }

    /// @notice F-3: the complete fee schedule, one public read.
    function feeSchedule()
        external
        view
        returns (uint16 linajeBps, uint16 linajeFloor, uint16 linajeCeil, uint16 protocolBps, uint16 protocolCap, address protocolRecipient)
    {
        return (linajeFeeBps, LINAJE_FLOOR_BPS, LINAJE_CEIL_BPS, protocolFeeBps, PROTOCOL_FEE_CAP_BPS, PROTOCOL_TREASURY);
    }

    // ── Internals ────────────────────────────────────────────────────────────

    function _addVenue(address target, VenueKind kind, uint64 readyAt) internal {
        if (target == address(0)) revert ZeroAddress();
        for (uint256 i = 0; i < venues.length; i++) {
            if (venues[i].target == target && !venues[i].retired) revert DuplicateVenue();
        }
        venues.push(Venue({target: target, kind: kind, readyAt: readyAt, retired: false}));
        emit VenueProposed(venues.length - 1, target, kind, readyAt, constitutionRef);
    }

    /// Entry of principal into a venue. `enforceCap` is false only for the
    /// council's rescue move (D2).
    function _allocate(uint256 venueId, uint256 amount, bool enforceCap) internal {
        if (venueId >= venues.length) revert VenueUnknown();
        Venue storage v = venues[venueId];
        if (v.retired) revert VenueRetiredError();
        if (block.timestamp < v.readyAt) revert VenueNotReady();
        if (amount == 0) revert ZeroAmount();
        if (amount > idlePrincipal()) revert InsufficientIdlePrincipal();

        venueBasis[venueId] += amount;
        allocatedPrincipal += amount;

        if (v.kind == VenueKind.ERC4626) {
            ASSET.forceApprove(v.target, amount);
            IERC4626Venue(v.target).deposit(amount, address(this));
        } else {
            ASSET.forceApprove(v.target, amount);
            uint256 code = ICompoundVenue(v.target).mint(amount);
            if (code != 0) revert CompoundCallFailed(code);
        }

        if (enforceCap) {
            // D2: cap applies to ENTRY only, checked post-move on real values.
            if (venueValue(venueId) * BPS > totalValue() * maxVenueBps) revert EntryCapExceeded();
        }
    }

    /// Withdraw an exact asset amount from a venue; returns what actually
    /// arrived (balance delta — the venue's word is never taken for it).
    function _withdrawExact(uint256 venueId, uint256 amount) internal returns (uint256 received) {
        Venue storage v = venues[venueId];
        uint256 before = ASSET.balanceOf(address(this));
        if (v.kind == VenueKind.ERC4626) {
            IERC4626Venue(v.target).withdraw(amount, address(this), address(this));
        } else {
            uint256 code = ICompoundVenue(v.target).redeemUnderlying(amount);
            if (code != 0) revert CompoundCallFailed(code);
        }
        received = ASSET.balanceOf(address(this)) - before;
    }

    function _venueRawBalance(uint256 venueId) internal view returns (uint256) {
        Venue storage v = venues[venueId];
        if (v.kind == VenueKind.ERC4626) return IERC4626Venue(v.target).balanceOf(address(this));
        return ICompoundVenue(v.target).balanceOf(address(this));
    }

    /// Redeem ALL the vault holds in a venue. Returns (received, principal
    /// part, excess-over-basis). Basis and allocation are zeroed; losses hit
    /// totalPrincipal honestly.
    function _evacuate(uint256 venueId) internal returns (uint256 received, uint256 principalPart, uint256 excess) {
        if (venueId >= venues.length) revert VenueUnknown();
        Venue storage v = venues[venueId];
        uint256 raw = _venueRawBalance(venueId);
        uint256 before = ASSET.balanceOf(address(this));
        if (raw > 0) {
            if (v.kind == VenueKind.ERC4626) {
                IERC4626Venue(v.target).redeem(raw, address(this), address(this));
            } else {
                uint256 code = ICompoundVenue(v.target).redeem(raw);
                if (code != 0) revert CompoundCallFailed(code);
            }
        }
        received = ASSET.balanceOf(address(this)) - before;

        uint256 basis = venueBasis[venueId];
        venueBasis[venueId] = 0;
        allocatedPrincipal -= basis;

        if (received >= basis) {
            principalPart = basis;
            excess = received - basis;
        } else {
            principalPart = received;
            uint256 loss = basis - received;
            totalPrincipal -= loss;
            emit PrincipalLossRealised(venueId, loss, totalPrincipal);
        }
    }

    /// The one place fruit is divided (D3/D5/D6). The linaje cut becomes
    /// principal (it never leaves); the protocol cut and payee shares become
    /// claimable (pull). With no payees, everything capitalizes.
    function _splitYield(uint256 venueId, uint256 amount) internal {
        if (amount == 0) return;
        uint256 linajeCut = (amount * linajeFeeBps) / BPS;
        uint256 protocolCut = (amount * protocolFeeBps) / BPS;
        uint256 distributable = amount - linajeCut - protocolCut;

        if (protocolCut > 0) {
            claimable[PROTOCOL_TREASURY] += protocolCut;
            totalClaimable += protocolCut;
        }

        uint256 assigned;
        uint256 n = payees.length;
        for (uint256 i = 0; i < n; i++) {
            uint256 share = (distributable * payees[i].bps) / BPS;
            claimable[payees[i].account] += share;
            totalClaimable += share;
            assigned += share;
        }
        // Rounding dust — and everything, when there are no payees —
        // capitalizes to the linaje (safe default).
        uint256 toLinaje = linajeCut + (distributable - assigned);
        totalPrincipal += toLinaje;

        emit Harvested(venueId, amount, toLinaje, protocolCut, assigned);
    }

    function _checkContinuity(address successor_) internal view {
        if (successor_ == address(0) || successor_ == address(this)) revert ZeroAddress();
        ILegacyVaultContinuity s = ILegacyVaultContinuity(successor_);
        if (s.council() != council) revert ContinuityBroken();
        if (s.constitutionRef() != constitutionRef) revert ContinuityBroken();
        if (s.asset() != address(ASSET)) revert ContinuityBroken();
    }
}
