// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "openzeppelin-contracts/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

/// Synchronous ERC-4626 venue surface (assets move in the same tx).
interface ISyncVenue {
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function balanceOf(address) external view returns (uint256);
}

/// Compound-v2-fork surface (Kinetic ISO kFXRP: 0 = success, code otherwise).
interface ICompoundVenue {
    function mint(uint256 mintAmount) external returns (uint256);
    function redeemUnderlying(uint256 redeemAmount) external returns (uint256);
    function redeem(uint256 redeemTokens) external returns (uint256);
    function exchangeRateStored() external view returns (uint256);
    function balanceOf(address) external view returns (uint256);
}

/// The exchange's on-chain user gate (ExchangeKycRegistry). If a pote points at
/// one, only receivers it approves may take shares — the users of the pote are
/// exactly the exchange's KYC'd clients. Entry only; exit is never gated.
interface IUserGate {
    function isApproved(address user) external view returns (bool);
}

/// Queued ERC-4626 venue (Firelight stXRP, verified on-chain 2026-08-20 via
/// verify-firelight: redeem burns shares NOW, fixes assets at request price and
/// queues them into currentPeriod()+1; NO assets move in the redeem tx;
/// claimWithdraw(period) releases them once that period ends (~24h periods).
/// withdrawalsOf returns ASSETS, not shares.
interface IQueuedVenue {
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function convertToShares(uint256 assets) external view returns (uint256);
    function balanceOf(address) external view returns (uint256);
    function currentPeriod() external view returns (uint256);
    function claimWithdraw(uint256 period) external returns (uint256);
    function withdrawalsOf(uint256 period, address owner) external view returns (uint256);
}

/**
 * @title AstryumVault — the institutional pote (one policy, one exit speed)
 *
 * @notice The thesis (Astryum Institutional, canonical doc 2026-08-18): the
 * manager may WORK the capital; it can never decide whether you may leave.
 * Clients hold ERC-4626 shares of the pote directly (one layer, never a claim
 * against the operator). The director moves capital ONLY between allowlisted,
 * typed venues. Redemption belongs to the holder alone and unwinds venue
 * positions BY ITSELF — no director cooperation, ever.
 *
 * WHAT DOES NOT EXIST IN THIS CODE (Z-decisions, doc 2026-08-20):
 *  - No function pays principal to an arbitrary address (I1).
 *  - No successor/migrate (Z5): with third-party holders, a council-driven
 *    relocation would be custody reintroduced. Wind-down = retire venues +
 *    holders redeem.
 *  - No protocol fee hook (fee de Astryum = 0 is enforced by absence).
 *  - No principal ledger (Z2): ERC-4626 totalAssets IS the accounting; venue
 *    losses surface as share price, honestly and automatically.
 *
 * The exit shape is fixed at birth by COOLDOWN (Z3):
 *  - COOLDOWN == 0  → plain synchronous ERC-4626 redeem/withdraw; _withdraw
 *    unwinds sync venues in deterministic order (ascending venueId). Queued
 *    venues CANNOT be added to this pote (I4, kind-level, enforced here).
 *  - COOLDOWN > 0   → two steps: requestRedeem burns shares NOW and fixes the
 *    assets at request price (mirror of the queued venue's own model), fires
 *    the venue unwind in the same tx when the buffer cannot cover, and mints a
 *    ticket with maturity = now + COOLDOWN. claimRedeem pays after maturity.
 *    Governance must size COOLDOWN ≥ the slowest venue queue (72h for the
 *    Firelight pote; period measured on-chain = 86400s, firelight.runtime.json).
 *
 * Operator compensation (Z2): harvest() is permissionless and skims ONLY the
 * council-set public payee bps of realized yield above the venue's high-water
 * basis; everything else keeps compounding inside the venue for the holders.
 *
 * Every governance mutation presents the CURRENT constitutionRef (anchored on
 * XRPL via DIDSet) — parameters stay chained to the rules they implement. The
 * council of this vault is an XrplCouncilBridge: "XRPL governs" is literal.
 */
contract AstryumVault is ERC4626, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Immutable shape (the cage — nothing changes these) ──────────────────

    /// @notice Exit shape of the pote. 0 = synchronous redeem; >0 = request/claim.
    uint48 public immutable COOLDOWN;
    /// @notice Idle-liquidity floor (bps of totalAssets) allocation cannot cross (I4).
    uint16 public immutable BUFFER_FLOOR_BPS;

    uint32 public constant VENUE_DELAY = 30 days; // adding a venue IS the power to extract
    uint48 public constant MAX_COOLDOWN = 30 days;
    uint16 public constant MAX_BUFFER_FLOOR_BPS = 5000;
    /// @notice Hard ceiling on the operator's total yield cut, forever (20%).
    uint16 public constant PAYEE_BPS_CAP = 2000;
    uint16 internal constant BPS = 10_000;

    // ── Governance state (quorum-modifiable, always with constitutionRef) ───

    address public council;
    address public pendingCouncil;
    bytes32 public constitutionRef;

    address public director;
    uint64 public directorUntil; // I5: the cession expires by itself

    /// @notice The exchange's user gate (0 = open). Council-governed: only the
    /// exchange's KYC'd clients may receive shares while it is set. Entry only.
    IUserGate public userGate;

    uint16 public maxVenueBps = BPS; // entry-concentration cap

    struct Payee {
        address account;
        uint16 bps; // share of realized yield (NOT of principal), public
    }

    Payee[] public payees;
    mapping(address => uint256) public claimable; // pull-pattern payouts
    uint256 public totalClaimable;

    // ── Venues ───────────────────────────────────────────────────────────────

    enum VenueKind {
        ERC4626, // synchronous
        CompoundV2, // synchronous (Kinetic ISO)
        ERC4626Queued, // Firelight-shaped: exit queues, claim later
        UpshiftQueued // Upshift-shaped: shares in a separate LP token, dated exit priced at claim.
            // Only the V2 generation implements it; this contract refuses it at _addVenue.
    }

    struct Venue {
        address target;
        VenueKind kind;
        uint64 readyAt;
        bool retired; // closed to NEW entries; exits always work
    }

    Venue[] public venues;
    /// @notice High-water basis per venue: allocated capital + kept yield marks.
    /// Used ONLY to compute the payee cut in harvest (Z2).
    mapping(uint256 => uint256) public venueBasis;

    /// @notice Assets sitting in a queued venue's withdrawal queue, ours,
    /// per (venueId, period). They never disappear from the books (the exact
    /// corruption the LegacyVault types would have suffered — audit §5).
    mapping(uint256 => mapping(uint256 => uint256)) public venueQueued;
    mapping(uint256 => uint256) public venueQueuedTotal;

    // ── Redemption tickets (COOLDOWN > 0) ────────────────────────────────────

    struct RedeemTicket {
        address receiver; // fixed by the holder at request — nobody redirects it
        uint256 assets; // fixed at request price — the pote owes exactly this
        uint48 maturity;
        bool claimed;
    }

    RedeemTicket[] public redeemTickets;
    /// @notice Σ assets owed to unclaimed tickets. Excluded from totalAssets the
    /// moment the shares burn, so remaining holders are isolated from leavers.
    uint256 public earmarkedAssets;

    // ── Events ───────────────────────────────────────────────────────────────

    event Allocated(uint256 indexed venueId, uint256 amount, address indexed by);
    event Recalled(uint256 indexed venueId, uint256 amount, address indexed by);
    event Moved(uint256 indexed fromId, uint256 indexed toId, uint256 amount, address indexed by);
    event Evacuated(uint256 indexed venueId, uint256 received, uint256 queued);
    event VenueLossRealised(uint256 indexed venueId, uint256 expected, uint256 received);
    event VenueExitQueued(uint256 indexed venueId, uint256 indexed period, uint256 assets);
    event VenueQueueClaimed(uint256 indexed venueId, uint256 indexed period, uint256 assets);
    event Harvested(uint256 indexed venueId, uint256 grossYield, uint256 payeeCut, uint256 keptCompounding);
    event Claimed(address indexed account, uint256 amount);
    event RedeemRequested(
        uint256 indexed ticketId, address indexed owner, address receiver, uint256 shares, uint256 assets, uint48 maturity
    );
    event RedeemClaimed(uint256 indexed ticketId, address indexed receiver, uint256 assets);
    event VenueProposed(uint256 indexed venueId, address target, VenueKind kind, uint64 readyAt, bytes32 constitutionRef);
    event VenueRetired(uint256 indexed venueId, bytes32 constitutionRef);
    event MaxVenueCapSet(uint16 bps, bytes32 constitutionRef);
    event PayeesSet(uint256 count, uint256 totalBps, bytes32 constitutionRef);
    event CessionGranted(address indexed director, uint64 until, bytes32 constitutionRef);
    event CessionEnded(bytes32 constitutionRef);
    event UserGateSet(address indexed gate, bytes32 constitutionRef);
    event ConstitutionRefUpdated(bytes32 indexed oldRef, bytes32 indexed newRef);
    event CouncilTransferStarted(address indexed current, address indexed pending, bytes32 constitutionRef);
    event CouncilTransferred(address indexed oldCouncil, address indexed newCouncil);

    // ── Errors ───────────────────────────────────────────────────────────────

    error NotCouncil();
    error NotDirectorOrCouncil();
    error RefMismatch();
    error VenueUnknown();
    error VenueNotReady();
    error VenueRetiredError();
    error VenueKindMismatch();
    error QueuedVenueNeedsCooldown(); // I4 at kind level
    error EntryCapExceeded();
    error BufferFloorCrossed(); // I4 at liquidity level
    error InsufficientIdle();
    error CompoundCallFailed(uint256 code);
    error ReceiverNotApproved(); // the user gate refused this receiver (not the exchange's KYC'd client)
    error UseRequestRedeem(); // this pote has a cooldown
    error UseSyncRedeem(); // this pote has none
    error TicketUnknown();
    error TicketNotMature(uint48 maturity);
    error TicketAlreadyClaimed();
    error UnwindShortfall(uint256 missing);
    error PayeeBpsOverCap();
    error ZeroAddress();
    error ZeroAmount();
    error NothingToClaim();
    error BpsOutOfBounds();
    error CooldownOutOfBounds();
    error DuplicateVenue();

    // ── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyCouncil() {
        if (msg.sender != council) revert NotCouncil();
        _;
    }

    modifier onlyDirectorOrCouncil() {
        if (!(msg.sender == council || (msg.sender == director && block.timestamp < directorUntil))) {
            revert NotDirectorOrCouncil();
        }
        _;
    }

    /// Every governance mutation states WHICH constitution version it acts under.
    modifier withRef(bytes32 ref) {
        if (ref != constitutionRef) revert RefMismatch();
        _;
    }

    // ── Birth ────────────────────────────────────────────────────────────────

    struct InitialVenue {
        address target;
        VenueKind kind;
    }

    /// @param asset_ the pote's single asset (FXRP).
    /// @param name_/symbol_ the share token identity (e.g. "Astryum Pote A", "apA-FXRP").
    /// @param council_ the XrplCouncilBridge of this pote's XRPL council.
    /// @param constitutionRef_ SHA-256 of the constitution anchored via DIDSet.
    /// @param cooldown_ 0 = synchronous pote; >0 = request/claim with this delay.
    /// @param bufferFloorBps_ idle floor allocation cannot cross (I4).
    /// @param initialVenues reviewed at deploy — ready immediately; later ones
    ///        wait VENUE_DELAY. A queued-kind venue requires cooldown_ > 0.
    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address council_,
        bytes32 constitutionRef_,
        uint48 cooldown_,
        uint16 bufferFloorBps_,
        InitialVenue[] memory initialVenues
    ) ERC20(name_, symbol_) ERC4626(asset_) {
        if (address(asset_) == address(0) || council_ == address(0)) revert ZeroAddress();
        if (cooldown_ > MAX_COOLDOWN) revert CooldownOutOfBounds();
        if (bufferFloorBps_ > MAX_BUFFER_FLOOR_BPS) revert BpsOutOfBounds();
        council = council_;
        constitutionRef = constitutionRef_;
        COOLDOWN = cooldown_;
        BUFFER_FLOOR_BPS = bufferFloorBps_;
        for (uint256 i = 0; i < initialVenues.length; i++) {
            _addVenue(initialVenues[i].target, initialVenues[i].kind, uint64(block.timestamp));
        }
    }

    /// @dev Inflation defense on a 6-decimal asset (Z10): virtual shares plus a
    /// genesis deposit by the operator in the same batch as creation.
    function _decimalsOffset() internal view virtual override returns (uint8) {
        return 3;
    }

    /// @dev The user gate (I3-bis / Z-decision 22-ago): if this pote points at
    /// an exchange registry, the RECEIVER of the shares must be one of that
    /// exchange's KYC'd clients. Covers both entry modes — the client depositing
    /// (mode A) and the operator depositing for the client (mode B) — because
    /// both name a `receiver`. Exit paths never call this: gating is entry-only.
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares)
        internal
        virtual
        override
    {
        IUserGate gate = userGate;
        if (address(gate) != address(0) && !gate.isApproved(receiver)) revert ReceiverNotApproved();
        super._deposit(caller, receiver, assets, shares);
    }

    // ── Accounting (Z2: ERC-4626 IS the ledger) ─────────────────────────────

    /// @notice Idle + every venue's live value + everything queued at venues,
    /// minus what is already owed (payee claims + unclaimed redeem tickets).
    function totalAssets() public view virtual override returns (uint256) {
        uint256 gross = IERC20(asset()).balanceOf(address(this));
        for (uint256 i = 0; i < venues.length; i++) {
            gross += _venueLiveValue(i) + _venueQueuedValue(i);
        }
        uint256 owed = totalClaimable + earmarkedAssets;
        return gross > owed ? gross - owed : 0;
    }

    /// @notice What a venue holds for the pote right now, live + queued.
    function venueValue(uint256 venueId) public view returns (uint256) {
        if (venueId >= venues.length) revert VenueUnknown();
        return _venueLiveValue(venueId) + _venueQueuedValue(venueId);
    }

    /// @notice Physical asset balance not owed to anyone — the working buffer.
    function freeBalance() public view returns (uint256) {
        uint256 bal = IERC20(asset()).balanceOf(address(this));
        uint256 owed = totalClaimable + earmarkedAssets;
        return bal > owed ? bal - owed : 0;
    }

    function venueCount() external view returns (uint256) {
        return venues.length;
    }

    function payeeCount() external view returns (uint256) {
        return payees.length;
    }

    function redeemTicketCount() external view returns (uint256) {
        return redeemTickets.length;
    }

    // ── Exit, shape 1: synchronous pote (COOLDOWN == 0) ─────────────────────

    /// @dev I2 made mechanical: before paying out, unwind sync venues in
    /// ascending venueId order until the assets are physically here. Nobody
    /// authorizes this — it happens inside the holder's own redeem tx.
    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares)
        internal
        virtual
        override
    {
        uint256 bal = IERC20(asset()).balanceOf(address(this));
        uint256 owedOthers = totalClaimable + earmarkedAssets;
        uint256 free = bal > owedOthers ? bal - owedOthers : 0;
        if (assets > free) {
            _unwindSync(assets - free);
        }
        super._withdraw(caller, receiver, owner, assets, shares);
    }

    function withdraw(uint256 assets, address receiver, address owner)
        public
        virtual
        override
        nonReentrant
        returns (uint256)
    {
        if (COOLDOWN != 0) revert UseRequestRedeem();
        return super.withdraw(assets, receiver, owner);
    }

    function redeem(uint256 shares, address receiver, address owner)
        public
        virtual
        override
        nonReentrant
        returns (uint256)
    {
        if (COOLDOWN != 0) revert UseRequestRedeem();
        return super.redeem(shares, receiver, owner);
    }

    /// @dev In a cooldown pote the synchronous doors are closed — say so in the
    /// standard 4626 way too, not only by reverting.
    function maxWithdraw(address owner) public view virtual override returns (uint256) {
        return COOLDOWN == 0 ? super.maxWithdraw(owner) : 0;
    }

    function maxRedeem(address owner) public view virtual override returns (uint256) {
        return COOLDOWN == 0 ? super.maxRedeem(owner) : 0;
    }

    // ── Exit, shape 2: cooldown pote (COOLDOWN > 0) ─────────────────────────

    /**
     * @notice Burn shares NOW, fix the assets at the current share price, and
     * open a ticket that matures at now + COOLDOWN. Mirror of the queued
     * venue's own model: the leaver stops compounding at request, and the
     * remaining holders are isolated from the exit. If the buffer cannot cover
     * every open ticket, the venue unwind fires INSIDE this same tx — sync
     * venues first, queued venues after — so the assets always arrive before
     * the holder does (COOLDOWN ≥ the slowest venue queue, governance-sized).
     *
     * Owner-only by design: no allowance path exists, so "the director is
     * never approved" is not a rule — it is unrepresentable.
     */
    function requestRedeem(uint256 shares, address receiver)
        external
        nonReentrant
        returns (uint256 ticketId)
    {
        if (COOLDOWN == 0) revert UseSyncRedeem();
        if (receiver == address(0)) revert ZeroAddress();
        if (shares == 0) revert ZeroAmount();

        uint256 assets = previewRedeem(shares);
        _burn(msg.sender, shares);
        earmarkedAssets += assets;

        // Cover ALL outstanding obligations, counting what is already on its
        // way from venue queues.
        uint256 bal = IERC20(asset()).balanceOf(address(this));
        uint256 incoming = 0;
        for (uint256 i = 0; i < venues.length; i++) {
            incoming += _venueQueuedValue(i);
        }
        uint256 owed = totalClaimable + earmarkedAssets;
        if (owed > bal + incoming) {
            _unwindAny(owed - bal - incoming);
        }

        uint48 maturity = uint48(block.timestamp) + COOLDOWN;
        redeemTickets.push(RedeemTicket({receiver: receiver, assets: assets, maturity: maturity, claimed: false}));
        ticketId = redeemTickets.length - 1;
        emit RedeemRequested(ticketId, msg.sender, receiver, shares, assets, maturity);
    }

    struct VenueClaim {
        uint256 venueId;
        uint256 period;
    }

    /**
     * @notice Pay a matured ticket. Permissionless: anyone may complete an
     * exit (a keeper, the holder, the operator's UI) — the receiver was fixed
     * by the holder at request and cannot be changed. `venueClaims` lets the
     * caller collect matured venue queues in the same tx when the physical
     * assets are still sitting there.
     */
    function claimRedeem(uint256 ticketId, VenueClaim[] calldata venueClaims) external nonReentrant {
        if (ticketId >= redeemTickets.length) revert TicketUnknown();
        RedeemTicket storage t = redeemTickets[ticketId];
        if (t.claimed) revert TicketAlreadyClaimed();
        if (block.timestamp < t.maturity) revert TicketNotMature(t.maturity);

        for (uint256 i = 0; i < venueClaims.length; i++) {
            _claimVenue(venueClaims[i].venueId, venueClaims[i].period);
        }

        uint256 bal = IERC20(asset()).balanceOf(address(this));
        uint256 reservedForPayees = totalClaimable;
        uint256 available = bal > reservedForPayees ? bal - reservedForPayees : 0;
        if (available < t.assets) revert UnwindShortfall(t.assets - available);

        t.claimed = true;
        earmarkedAssets -= t.assets;
        IERC20(asset()).safeTransfer(t.receiver, t.assets);
        emit RedeemClaimed(ticketId, t.receiver, t.assets);
    }

    /// @notice Collect a matured withdrawal queue from a queued venue into the
    /// pote. Permissionless — it only ever moves assets from the venue to the
    /// pote itself. The venue reverts if the period has not ended.
    function claimVenue(uint256 venueId, uint256 period) external nonReentrant {
        _claimVenue(venueId, period);
    }

    // ── Direction (the cession: work it, never touch it) ────────────────────

    /// @notice Put idle assets to work in a whitelisted venue. Entry cap and
    /// buffer floor enforced. Director (live cession) or council.
    function directTo(uint256 venueId, uint256 amount, bytes32 ref)
        external
        nonReentrant
        onlyDirectorOrCouncil
        withRef(ref)
    {
        _allocate(venueId, amount, true);
        emit Allocated(venueId, amount, msg.sender);
    }

    /// @notice Pull assets back from a venue into the buffer. Immediate, never
    /// capped. On a queued venue this STARTS the exit (assets arrive via
    /// claimVenue when the period ends).
    function recall(uint256 venueId, uint256 amount, bytes32 ref)
        external
        nonReentrant
        onlyDirectorOrCouncil
        withRef(ref)
    {
        if (amount == 0) revert ZeroAmount();
        Venue storage v = _venue(venueId);
        if (_isQueuedKind(v.kind)) {
            _queuedExit(venueId, amount);
        } else {
            uint256 received = _withdrawExactSync(venueId, amount);
            _reduceBasis(venueId, amount);
            if (received < amount) emit VenueLossRealised(venueId, amount, received);
        }
        emit Recalled(venueId, amount, msg.sender);
    }

    /// @notice Move venue→venue in one call (sync source only; a queued source
    /// goes recall → claimVenue → directTo, the queue cannot be skipped).
    function moveToVenue(uint256 fromId, uint256 toId, uint256 amount, bytes32 ref)
        external
        nonReentrant
        onlyDirectorOrCouncil
        withRef(ref)
    {
        if (amount == 0) revert ZeroAmount();
        Venue storage from = _venue(fromId);
        if (_isQueuedKind(from.kind)) revert VenueKindMismatch();
        uint256 received = _withdrawExactSync(fromId, amount);
        _reduceBasis(fromId, amount);
        if (received < amount) emit VenueLossRealised(fromId, amount, received);
        _allocate(toId, received, true);
        emit Moved(fromId, toId, received, msg.sender);
    }

    /// @notice Council emergency: pull EVERYTHING a venue holds. On a queued
    /// venue the live shares are queued for exit and NO loss is booked for
    /// assets that are merely waiting (Z9 — the Firelight case).
    function evacuate(uint256 venueId, bytes32 ref) external nonReentrant onlyCouncil withRef(ref) {
        Venue storage v = _venue(venueId);
        uint256 received = 0;
        uint256 queued = 0;
        if (_isQueuedKind(v.kind)) {
            queued = _evacuateQueued(venueId);
        } else {
            uint256 raw = _venueRawBalance(venueId);
            if (raw > 0) {
                uint256 before = IERC20(asset()).balanceOf(address(this));
                if (v.kind == VenueKind.ERC4626) {
                    ISyncVenue(v.target).redeem(raw, address(this), address(this));
                } else {
                    uint256 code = ICompoundVenue(v.target).redeem(raw);
                    if (code != 0) revert CompoundCallFailed(code);
                }
                received = IERC20(asset()).balanceOf(address(this)) - before;
            }
            venueBasis[venueId] = 0;
        }
        emit Evacuated(venueId, received, queued);
    }

    // ── The fruit (Z2: harvest skims the public payee cut, nothing else) ────

    /**
     * @notice Realize the operator's cut of a venue's yield above its
     * high-water basis, and mark the rest to basis so it is never charged
     * twice. Permissionless: the split is fixed by code, the bps are public.
     * With no payees, harvest simply raises the mark (all yield stays with
     * the holders — the safe default).
     */
    function harvest(uint256 venueId) external nonReentrant {
        Venue storage v = _venue(venueId);

        // A QUEUED venue cannot be harvested synchronously: its assets are
        // locked inside the venue's own withdrawal queue, so the cut would have
        // to be paid from the shared buffer while the yield stays in the venue
        // — that both charges the common principal and (because live does not
        // fall) lets the NEXT harvest re-charge the rebated basis as phantom
        // yield (fuzzer counterexample, invariant P2, 2026-08-22). The honest
        // rule: the operator's cut on a queued venue realizes only when the
        // capital is liquid again (recall → claim → a synchronous venue or the
        // buffer). No-op here, and it favors the holders. Same rule for every
        // queued kind (Upshift included).
        if (_isQueuedKind(v.kind)) {
            emit Harvested(venueId, 0, 0, 0);
            return;
        }

        uint256 live = _venueLiveValue(venueId);
        uint256 basis = venueBasis[venueId];
        if (live <= basis) {
            emit Harvested(venueId, 0, 0, 0);
            return;
        }
        uint256 gross = live - basis;
        uint256 cutBps = 0;
        for (uint256 i = 0; i < payees.length; i++) {
            cutBps += payees[i].bps;
        }
        uint256 cutTotal = (gross * cutBps) / BPS;

        if (cutTotal > 0) {
            uint256 received = _withdrawExactSync(venueId, cutTotal);
            if (received < cutTotal) cutTotal = received;
            uint256 assigned = 0;
            for (uint256 i = 0; i < payees.length; i++) {
                uint256 share = (gross * payees[i].bps) / BPS;
                if (share == 0) continue;
                uint256 capped = assigned + share > cutTotal ? cutTotal - assigned : share;
                claimable[payees[i].account] += capped;
                totalClaimable += capped;
                assigned += capped;
            }
            cutTotal = assigned;
        }

        // High-water mark: what stays in the venue is the holders' from now on.
        venueBasis[venueId] = live - cutTotal;
        emit Harvested(venueId, gross, cutTotal, gross - cutTotal);
    }

    /// @notice Pull what harvests assigned to you.
    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        totalClaimable -= amount;
        IERC20(asset()).safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    // ── Governance (always with constitutionRef) ────────────────────────────

    function proposeVenue(address target, VenueKind kind, bytes32 ref) external onlyCouncil withRef(ref) {
        _addVenue(target, kind, uint64(block.timestamp + VENUE_DELAY));
    }

    function retireVenue(uint256 venueId, bytes32 ref) external onlyCouncil withRef(ref) {
        _venue(venueId).retired = true;
        emit VenueRetired(venueId, ref);
    }

    function setMaxVenueBps(uint16 bps, bytes32 ref) external onlyCouncil withRef(ref) {
        if (bps == 0 || bps > BPS) revert BpsOutOfBounds();
        maxVenueBps = bps;
        emit MaxVenueCapSet(bps, ref);
    }

    /// @notice The operator's compensation, public and hard-capped (Z2): the
    /// payee bps apply to realized YIELD only, never to principal, and their
    /// sum can never exceed PAYEE_BPS_CAP.
    function setPayees(address[] calldata accounts, uint16[] calldata bps, bytes32 ref)
        external
        virtual
        onlyCouncil
        withRef(ref)
    {
        if (accounts.length != bps.length) revert BpsOutOfBounds();
        delete payees;
        uint256 sum = 0;
        for (uint256 i = 0; i < accounts.length; i++) {
            if (accounts[i] == address(0)) revert ZeroAddress();
            if (bps[i] == 0) revert BpsOutOfBounds();
            sum += bps[i];
            payees.push(Payee({account: accounts[i], bps: bps[i]}));
        }
        if (sum > PAYEE_BPS_CAP) revert PayeeBpsOverCap();
        emit PayeesSet(accounts.length, sum, ref);
    }

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

    /// @notice Point this pote at the exchange's user gate (ExchangeKycRegistry),
    /// or 0 to open it. From then on, only receivers the gate approves may take
    /// shares — the users of this pote become exactly this exchange's KYC'd
    /// clients. Council-governed (the exchange chooses its own registry). Entry
    /// only: this never affects a holder's exit.
    function setUserGate(address gate, bytes32 ref) external virtual onlyCouncil withRef(ref) {
        userGate = IUserGate(gate);
        emit UserGateSet(gate, ref);
    }

    function setConstitutionRef(bytes32 newRef, bytes32 oldRef) external onlyCouncil {
        if (oldRef != constitutionRef) revert RefMismatch();
        emit ConstitutionRefUpdated(constitutionRef, newRef);
        constitutionRef = newRef;
    }

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

    // ── Internals ────────────────────────────────────────────────────────────

    function _venue(uint256 venueId) internal view returns (Venue storage) {
        if (venueId >= venues.length) revert VenueUnknown();
        return venues[venueId];
    }

    /// @dev `virtual` desde la generación v2 (AstryumVaultV2): la v2 antepone el
    ///      scanner on-chain (AstryumRegistry) y las comprobaciones de cordura del
    ///      target. Aquí no cambia nada — ni semántica ni bytecode desplegado.
    function _addVenue(address target, VenueKind kind, uint64 readyAt) internal virtual {
        if (target == address(0)) revert ZeroAddress();
        if (!_kindSupported(kind)) revert VenueKindMismatch();
        if (_isQueuedKind(kind) && COOLDOWN == 0) revert QueuedVenueNeedsCooldown();
        for (uint256 i = 0; i < venues.length; i++) {
            if (venues[i].target == target && !venues[i].retired) revert DuplicateVenue();
        }
        venues.push(Venue({target: target, kind: kind, readyAt: readyAt, retired: false}));
        emit VenueProposed(venues.length - 1, target, kind, readyAt, constitutionRef);
    }

    // ── Kind hooks (the V2 generation extends them with UpshiftQueued) ───────
    //
    // Every kind-dependent step goes through one of these. In this contract
    // they are exactly the behavior it always had; making an internal function
    // virtual does not change the code of a contract that does not override it.

    /// Exits that queue instead of paying in the same tx: they need a cooldown
    /// pote, they are skipped by the synchronous unwind, and harvest is a no-op.
    function _isQueuedKind(VenueKind kind) internal pure returns (bool) {
        return kind == VenueKind.ERC4626Queued || kind == VenueKind.UpshiftQueued;
    }

    /// The kinds this generation can operate. Here: the original three.
    function _kindSupported(VenueKind kind) internal pure virtual returns (bool) {
        return kind != VenueKind.UpshiftQueued;
    }

    /// What a venue owes the pote through its exit queue, on top of the live
    /// position. Here: the assets fixed at request (Firelight model).
    function _venueQueuedValue(uint256 venueId) internal view virtual returns (uint256) {
        return venueQueuedTotal[venueId];
    }

    /// Put `amount` of the asset into a venue (the caller already checked the
    /// venue, the buffer floor and the amount).
    function _enterVenue(uint256 venueId, uint256 amount) internal virtual {
        Venue storage v = venues[venueId];
        IERC20 a = IERC20(asset());
        a.forceApprove(v.target, amount);
        if (v.kind == VenueKind.CompoundV2) {
            uint256 code = ICompoundVenue(v.target).mint(amount);
            if (code != 0) revert CompoundCallFailed(code);
        } else if (v.kind == VenueKind.ERC4626) {
            ISyncVenue(v.target).deposit(amount, address(this));
        } else {
            IQueuedVenue(v.target).deposit(amount, address(this));
        }
    }

    /// Queue the whole position of a queued venue for exit (evacuate).
    function _evacuateQueued(uint256 venueId) internal virtual returns (uint256 queued) {
        uint256 raw = IQueuedVenue(venues[venueId].target).balanceOf(address(this));
        if (raw > 0) queued = _queuedExitShares(venueId, raw);
    }

    /// The holder's unwind asking a queued venue for `take`. Here: exactly that.
    function _unwindQueued(uint256 venueId, uint256 take) internal virtual returns (uint256 queued) {
        return _queuedExit(venueId, take);
    }

    function _venueLiveValue(uint256 venueId) internal view virtual returns (uint256) {
        Venue storage v = venues[venueId];
        if (v.kind == VenueKind.CompoundV2) {
            return (ICompoundVenue(v.target).balanceOf(address(this)) * ICompoundVenue(v.target).exchangeRateStored())
                / 1e18;
        }
        return ISyncVenue(v.target).convertToAssets(ISyncVenue(v.target).balanceOf(address(this)));
    }

    function _venueRawBalance(uint256 venueId) internal view returns (uint256) {
        Venue storage v = venues[venueId];
        if (v.kind == VenueKind.CompoundV2) return ICompoundVenue(v.target).balanceOf(address(this));
        return ISyncVenue(v.target).balanceOf(address(this));
    }

    /// Entry of assets into a venue: maturity, retirement, buffer floor (I4)
    /// and concentration cap all enforced here.
    function _allocate(uint256 venueId, uint256 amount, bool enforceCap) internal {
        Venue storage v = _venue(venueId);
        if (v.retired) revert VenueRetiredError();
        if (block.timestamp < v.readyAt) revert VenueNotReady();
        if (amount == 0) revert ZeroAmount();

        uint256 free = freeBalance();
        if (amount > free) revert InsufficientIdle();
        // I4: the buffer floor is measured against the pote's whole value and
        // the director cannot cross it. (Redemptions may — the holder's exit
        // outranks the buffer, which exists to serve it.)
        if (free - amount < (totalAssets() * BUFFER_FLOOR_BPS) / BPS) revert BufferFloorCrossed();

        venueBasis[venueId] += amount;

        _enterVenue(venueId, amount);

        if (enforceCap) {
            // Concentration cap, checked post-move on real values.
            if (venueValue(venueId) * BPS > totalAssets() * maxVenueBps) revert EntryCapExceeded();
        }
    }

    /// Withdraw an exact amount from a SYNC venue; returns what actually
    /// arrived (balance delta — the venue's word is never taken for it).
    function _withdrawExactSync(uint256 venueId, uint256 amount) internal returns (uint256 received) {
        Venue storage v = venues[venueId];
        uint256 before = IERC20(asset()).balanceOf(address(this));
        if (v.kind == VenueKind.ERC4626) {
            ISyncVenue(v.target).withdraw(amount, address(this), address(this));
        } else if (v.kind == VenueKind.CompoundV2) {
            uint256 code = ICompoundVenue(v.target).redeemUnderlying(amount);
            if (code != 0) revert CompoundCallFailed(code);
        } else {
            revert VenueKindMismatch();
        }
        received = IERC20(asset()).balanceOf(address(this)) - before;
    }

    /// Start an exit of `amount` assets from a queued venue: burns venue shares
    /// now, records the queue ticket, books nothing as lost (Z9).
    function _queuedExit(uint256 venueId, uint256 amount) internal virtual returns (uint256 queuedAssets) {
        Venue storage v = venues[venueId];
        uint256 shares = IQueuedVenue(v.target).convertToShares(amount);
        uint256 held = IQueuedVenue(v.target).balanceOf(address(this));
        // convertToShares floors; round up one share so the queued assets
        // cover the requested amount instead of missing it by dust.
        if (shares < held && IQueuedVenue(v.target).convertToAssets(shares) < amount) shares += 1;
        if (shares > held) shares = held;
        if (shares == 0) revert ZeroAmount();
        queuedAssets = _queuedExitShares(venueId, shares);
    }

    function _queuedExitShares(uint256 venueId, uint256 shares) internal returns (uint256 queuedAssets) {
        Venue storage v = venues[venueId];
        uint256 period = IQueuedVenue(v.target).currentPeriod() + 1;
        queuedAssets = IQueuedVenue(v.target).redeem(shares, address(this), address(this));
        venueQueued[venueId][period] += queuedAssets;
        venueQueuedTotal[venueId] += queuedAssets;
        _reduceBasis(venueId, queuedAssets);
        emit VenueExitQueued(venueId, period, queuedAssets);
    }

    function _claimVenue(uint256 venueId, uint256 period) internal virtual {
        Venue storage v = _venue(venueId);
        if (v.kind != VenueKind.ERC4626Queued) revert VenueKindMismatch();
        uint256 recorded = venueQueued[venueId][period];
        if (recorded == 0) revert ZeroAmount();
        uint256 before = IERC20(asset()).balanceOf(address(this));
        IQueuedVenue(v.target).claimWithdraw(period); // reverts at venue if not ended
        uint256 received = IERC20(asset()).balanceOf(address(this)) - before;
        venueQueued[venueId][period] = 0;
        venueQueuedTotal[venueId] -= recorded;
        if (received < recorded) emit VenueLossRealised(venueId, recorded, received);
        emit VenueQueueClaimed(venueId, period, received);
    }

    function _reduceBasis(uint256 venueId, uint256 amount) internal {
        uint256 basis = venueBasis[venueId];
        venueBasis[venueId] = amount >= basis ? 0 : basis - amount;
    }

    /// Deterministic unwind over SYNC venues only (the synchronous pote's
    /// redeem path): ascending venueId, capped by each venue's live value.
    function _unwindSync(uint256 deficit) internal {
        uint256 remaining = deficit;
        for (uint256 i = 0; i < venues.length && remaining > 0; i++) {
            if (_isQueuedKind(venues[i].kind)) continue;
            uint256 live = _venueLiveValue(i);
            if (live == 0) continue;
            uint256 take = remaining > live ? live : remaining;
            uint256 received = _withdrawExactSync(i, take);
            _reduceBasis(i, take);
            remaining = received >= remaining ? 0 : remaining - received;
        }
        if (remaining > 0) revert UnwindShortfall(remaining);
    }

    /// Deterministic unwind for the cooldown pote: liquid venues first, queued
    /// venues after (their assets arrive before the ticket matures — that is
    /// what COOLDOWN sizing is FOR). Written order, no discretion (I2).
    function _unwindAny(uint256 deficit) internal {
        uint256 remaining = deficit;
        for (uint256 i = 0; i < venues.length && remaining > 0; i++) {
            if (_isQueuedKind(venues[i].kind)) continue;
            uint256 live = _venueLiveValue(i);
            if (live == 0) continue;
            uint256 take = remaining > live ? live : remaining;
            uint256 received = _withdrawExactSync(i, take);
            _reduceBasis(i, take);
            remaining = received >= remaining ? 0 : remaining - received;
        }
        for (uint256 i = 0; i < venues.length && remaining > 0; i++) {
            if (!_isQueuedKind(venues[i].kind)) continue;
            uint256 live = _venueLiveValue(i);
            if (live == 0) continue;
            uint256 take = remaining > live ? live : remaining;
            uint256 queued = _unwindQueued(i, take);
            remaining = queued >= remaining ? 0 : remaining - queued;
        }
        if (remaining > 0) revert UnwindShortfall(remaining);
    }
}
