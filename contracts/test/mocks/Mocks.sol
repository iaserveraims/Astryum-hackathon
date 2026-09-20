// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

/// FXRP stand-in (6 decimals like the real one; the vault is decimals-agnostic).
contract MockFXRP is ERC20 {
    constructor() ERC20("Mock FXRP", "FXRP") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// Simplified ERC-4626 venue (Firelight-shaped). Share price = totalAssets /
/// totalShares, so a plain token donation simulates yield and `simulateLoss`
/// simulates a venue losing money.
contract Mock4626Venue {
    IERC20 public immutable ASSETTOKEN;
    mapping(address => uint256) public balanceOf;
    uint256 public totalShares;

    constructor(IERC20 asset_) {
        ASSETTOKEN = asset_;
    }

    /// ERC-4626 `asset()` — the v2 pote checks it before letting a venue in.
    function asset() external view returns (address) {
        return address(ASSETTOKEN);
    }

    function totalAssets() public view returns (uint256) {
        return ASSETTOKEN.balanceOf(address(this));
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        if (totalShares == 0) return shares;
        return (shares * totalAssets()) / totalShares;
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        shares = totalShares == 0 ? assets : (assets * totalShares) / totalAssets();
        ASSETTOKEN.transferFrom(msg.sender, address(this), assets);
        balanceOf[receiver] += shares;
        totalShares += shares;
    }

    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares) {
        shares = (assets * totalShares + totalAssets() - 1) / totalAssets(); // ceil
        balanceOf[owner] -= shares;
        totalShares -= shares;
        ASSETTOKEN.transfer(receiver, assets);
    }

    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets) {
        assets = convertToAssets(shares);
        balanceOf[owner] -= shares;
        totalShares -= shares;
        ASSETTOKEN.transfer(receiver, assets);
    }

    /// The venue loses money (exploit, bad debt): assets leave, shares stay.
    function simulateLoss(uint256 amount, address sink) external {
        ASSETTOKEN.transfer(sink, amount);
    }
}

/// Compound-v2-fork venue (Kinetic-shaped): mint/redeemUnderlying/redeem
/// return 0 on success; exchangeRateStored is manipulable to simulate yield.
contract MockCompoundVenue {
    IERC20 public immutable ASSETTOKEN;
    mapping(address => uint256) public balanceOf; // cTokens
    uint256 public exchangeRateStored = 1e18;

    constructor(IERC20 asset_) {
        ASSETTOKEN = asset_;
    }

    /// Compound-v2 `underlying()` — the v2 pote checks it before letting a venue in.
    function underlying() external view returns (address) {
        return address(ASSETTOKEN);
    }

    function setExchangeRate(uint256 rate) external {
        exchangeRateStored = rate;
    }

    function mint(uint256 mintAmount) external returns (uint256) {
        ASSETTOKEN.transferFrom(msg.sender, address(this), mintAmount);
        balanceOf[msg.sender] += (mintAmount * 1e18) / exchangeRateStored;
        return 0;
    }

    function redeemUnderlying(uint256 redeemAmount) external returns (uint256) {
        uint256 tokens = (redeemAmount * 1e18 + exchangeRateStored - 1) / exchangeRateStored; // ceil
        if (tokens > balanceOf[msg.sender]) return 9; // Compound-style error code
        balanceOf[msg.sender] -= tokens;
        ASSETTOKEN.transfer(msg.sender, redeemAmount);
        return 0;
    }

    function redeem(uint256 redeemTokens) external returns (uint256) {
        if (redeemTokens > balanceOf[msg.sender]) return 9;
        balanceOf[msg.sender] -= redeemTokens;
        ASSETTOKEN.transfer(msg.sender, (redeemTokens * exchangeRateStored) / 1e18);
        return 0;
    }
}

/// Firelight-shaped QUEUED venue (verified mechanics, verify-firelight):
/// redeem burns shares NOW, fixes assets at request price and
/// queues them into currentPeriod+1 — NO assets move in the redeem tx.
/// claimWithdraw(period) pays once the period has ENDED (period < current).
/// withdrawalsOf returns ASSETS. `advancePeriod()` is the test's clock.
contract MockQueuedVenue {
    IERC20 public immutable ASSETTOKEN;
    mapping(address => uint256) public balanceOf; // shares
    uint256 public totalShares;
    uint256 public currentPeriod = 100;
    mapping(uint256 => mapping(address => uint256)) public withdrawalsOf; // ASSETS
    uint256 public queuedAssetsTotal;

    constructor(IERC20 asset_) {
        ASSETTOKEN = asset_;
    }

    /// ERC-4626 `asset()` — the v2 pote checks it before letting a venue in.
    function asset() external view returns (address) {
        return address(ASSETTOKEN);
    }

    function totalAssets() public view returns (uint256) {
        return ASSETTOKEN.balanceOf(address(this)) - queuedAssetsTotal;
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        if (totalShares == 0) return shares;
        return (shares * totalAssets()) / totalShares;
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 ta = totalAssets();
        if (totalShares == 0 || ta == 0) return assets;
        return (assets * totalShares) / ta;
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        shares = totalShares == 0 ? assets : (assets * totalShares) / totalAssets();
        ASSETTOKEN.transferFrom(msg.sender, address(this), assets);
        balanceOf[receiver] += shares;
        totalShares += shares;
    }

    /// Burns now, queues into currentPeriod+1, moves NOTHING.
    function redeem(uint256 shares, address, address owner) external returns (uint256 assets) {
        assets = convertToAssets(shares);
        balanceOf[owner] -= shares;
        totalShares -= shares;
        withdrawalsOf[currentPeriod + 1][owner] += assets;
        queuedAssetsTotal += assets;
    }

    function claimWithdraw(uint256 period) external returns (uint256 amount) {
        require(period < currentPeriod, "period not ended");
        amount = withdrawalsOf[period][msg.sender];
        require(amount > 0, "nothing queued");
        withdrawalsOf[period][msg.sender] = 0;
        queuedAssetsTotal -= amount;
        ASSETTOKEN.transfer(msg.sender, amount);
    }

    /// The test's clock: one call = one 24h period boundary.
    function advancePeriod() external {
        currentPeriod += 1;
    }

    function simulateLoss(uint256 amount, address sink) external {
        ASSETTOKEN.transfer(sink, amount);
    }
}

/// Upshift LP token: a plain 6-decimal ERC-20 only its vault mints and burns.
contract MockUpshiftLp is ERC20 {
    address public immutable VAULT;

    constructor() ERC20("Mock Upshift LP", "upLP") {
        VAULT = msg.sender;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == VAULT, "only vault");
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        require(msg.sender == VAULT, "only vault");
        _burn(from, amount);
    }
}

/// Upshift-shaped venue, modeled on the VERIFIED source of both mainnet
/// implementations (TokenizedVault: earnXRP 0xc689…59b2, Monarq 0x8aa8…bd48,
/// read). What it reproduces, because the pote's accounting depends
/// on each one:
///  - shares live in a SEPARATE LP token; `requestRedeem` pulls them (allowance)
///    and books them on the calendar day of now + 5 min + lagDuration;
///  - `claim` pays at the CLAIM-day price net of `withdrawalFee`, anyone may run
///    it for any receiver, and it reverts before the day or without liquidity;
///  - `requestRedeem` reverts with lagDuration == 0 (VaultNotTimelocked);
///  - gross above `maxWithdrawalAmount` reverts, per call;
///  - the NAV = FXRP on the contract + `externalAssets` the operator reports
///    (funds moved to sub-accounts are NOT on the contract).
contract MockUpshiftVault {
    IERC20 public immutable ASSETTOKEN;
    MockUpshiftLp public immutable LP;

    uint256 public lagDuration = 7 days;
    uint256 public withdrawalFee; // bps, lagged exits
    uint256 public instantRedemptionFee = 30; // bps
    uint256 public maxWithdrawalAmount = type(uint256).max;
    uint256 public maxDepositAmount = type(uint256).max;
    uint256 public depositCap = type(uint256).max;
    uint256 public externalAssets;
    uint256 public totalCollectableFees;
    bool public withdrawalsPaused;

    mapping(bytes32 => mapping(address => uint256)) internal _burnable;
    mapping(bytes32 => address[]) internal _receivers;

    constructor(IERC20 asset_) {
        ASSETTOKEN = asset_;
        LP = new MockUpshiftLp();
    }

    function asset() external view returns (address) {
        return address(ASSETTOKEN);
    }

    function lpTokenAddress() external view returns (address) {
        return address(LP);
    }

    // ── test knobs (owner/operator powers of the real vault) ────────────────
    function setLagDuration(uint256 v) external {
        lagDuration = v;
    }

    function setWithdrawalFee(uint256 v) external {
        withdrawalFee = v;
    }

    function setMaxWithdrawalAmount(uint256 v) external {
        maxWithdrawalAmount = v;
    }

    function setWithdrawalsPaused(bool v) external {
        withdrawalsPaused = v;
    }

    /// Operator `depositToSubaccount`: FXRP leaves the contract, the NAV keeps it.
    function moveToSubaccount(uint256 amount, address subaccount) external {
        externalAssets += amount;
        ASSETTOKEN.transfer(subaccount, amount);
    }

    /// Operator `withdrawFromSubaccount`: the caller brings FXRP back.
    function returnFromSubaccount(uint256 amount) external {
        externalAssets -= amount;
        ASSETTOKEN.transferFrom(msg.sender, address(this), amount);
    }

    /// Operator `updateTotalAssets`: the reported value of what is outside.
    function reportExternalAssets(uint256 v) external {
        externalAssets = v;
    }

    // ── the real surface ────────────────────────────────────────────────────
    function getTotalAssets() public view returns (uint256) {
        uint256 valuation = ASSETTOKEN.balanceOf(address(this)) + externalAssets;
        return totalCollectableFees < valuation ? valuation - totalCollectableFees : 0;
    }

    function _convertToAssets(uint256 shares) internal view returns (uint256) {
        uint256 supply = LP.totalSupply();
        return supply < 1 ? shares : (shares * getTotalAssets()) / supply;
    }

    function getSharePrice() external view returns (uint256) {
        return _convertToAssets(1e6);
    }

    function previewRedemption(uint256 shares, bool isInstant)
        public
        view
        returns (uint256 assetsAmount, uint256 assetsAfterFee)
    {
        uint256 fee = isInstant ? instantRedemptionFee : withdrawalFee;
        assetsAmount = _convertToAssets(shares);
        assetsAfterFee = assetsAmount - (fee * assetsAmount) / 1e4;
    }

    function deposit(address assetIn, uint256 amountIn, address receiverAddr) external returns (uint256 shares) {
        require(assetIn == address(ASSETTOKEN), "AssetNotWhitelisted");
        require(amountIn > 0 && amountIn <= maxDepositAmount, "MaxDepositAmountReached");
        uint256 ta = getTotalAssets();
        require(ta + amountIn <= depositCap, "DepositCapReached");
        uint256 supply = LP.totalSupply();
        shares = supply == 0 ? amountIn : (amountIn * supply) / ta;
        require(shares > 0, "InsufficientShares");
        ASSETTOKEN.transferFrom(msg.sender, address(this), amountIn);
        LP.mint(receiverAddr, shares);
    }

    function requestRedeem(uint256 shares, address receiverAddr)
        external
        returns (uint256 claimableEpoch, uint256 year, uint256 month, uint256 day)
    {
        require(!withdrawalsPaused, "WithdrawalsPaused");
        require(shares > 0, "InvalidAmount");
        (uint256 gross, uint256 net) = previewRedemption(shares, false);
        require(gross <= maxWithdrawalAmount, "WithdrawalLimitReached");
        require(net > 0, "AmountTooLow");
        require(lagDuration > 0, "VaultNotTimelocked");
        (year, month, day) = timestampToDate(block.timestamp + 5 minutes + lagDuration);
        claimableEpoch = daysFromDate(year, month, day) * 1 days;
        bytes32 key = keccak256(abi.encode(year, month, day));
        if (_burnable[key][receiverAddr] == 0) _receivers[key].push(receiverAddr);
        _burnable[key][receiverAddr] += shares;
        LP.transferFrom(msg.sender, address(this), shares);
    }

    function claim(uint256 year, uint256 month, uint256 day, address receiverAddr)
        public
        returns (uint256 shares, uint256 net)
    {
        require(!withdrawalsPaused, "WithdrawalsPaused");
        bytes32 key = keccak256(abi.encode(year, month, day));
        shares = _burnable[key][receiverAddr];
        require(shares > 0, "NoSharesForReceiver");
        require(block.timestamp + 5 minutes >= daysFromDate(year, month, day) * 1 days, "TooEarly");
        uint256 gross;
        (gross, net) = previewRedemption(shares, false);
        _burnable[key][receiverAddr] = 0;
        totalCollectableFees += gross - net;
        LP.burn(address(this), shares);
        ASSETTOKEN.transfer(receiverAddr, net); // reverts without liquidity on the contract
    }

    /// Anyone may settle a whole day (real: processAllClaimsByDate).
    function processAllClaimsByDate(uint256 year, uint256 month, uint256 day) external {
        address[] storage rs = _receivers[keccak256(abi.encode(year, month, day))];
        for (uint256 i = 0; i < rs.length; i++) {
            if (_burnable[keccak256(abi.encode(year, month, day))][rs[i]] > 0) claim(year, month, day, rs[i]);
        }
    }

    function instantRedeem(uint256 shares, address receiverAddr) external {
        require(!withdrawalsPaused, "WithdrawalsPaused");
        (uint256 gross, uint256 net) = previewRedemption(shares, true);
        require(gross <= maxWithdrawalAmount, "WithdrawalLimitReached");
        totalCollectableFees += gross - net;
        LP.burn(msg.sender, shares);
        ASSETTOKEN.transfer(receiverAddr, net);
    }

    function getBurnableAmountByReceiver(uint256 year, uint256 month, uint256 day, address receiverAddr)
        external
        view
        returns (uint256)
    {
        return _burnable[keccak256(abi.encode(year, month, day))][receiverAddr];
    }

    // Civil calendar (Fliegel & Van Flandern), same arithmetic as Upshift's DateUtils.
    function timestampToDate(uint256 ts) public pure returns (uint256 year, uint256 month, uint256 day) {
        int256 x = int256(ts / 1 days) + 68569 + 2440588;
        int256 n = (4 * x) / 146097;
        x = x - (146097 * n + 3) / 4;
        int256 y = (4000 * (x + 1)) / 1461001;
        x = x - (1461 * y) / 4 + 31;
        int256 m = (80 * x) / 2447;
        int256 d = x - (2447 * m) / 80;
        x = m / 11;
        m = m + 2 - 12 * x;
        y = 100 * (n - 49) + y + x;
        return (uint256(y), uint256(m), uint256(d));
    }

    function daysFromDate(uint256 year, uint256 month, uint256 day) public pure returns (uint256) {
        int256 y = int256(year);
        int256 m = int256(month);
        int256 d = int256(day);
        return uint256(d - 32075 + (1461 * (y + 4800 + (m - 14) / 12)) / 4 + (367 * (m - 2 - ((m - 14) / 12) * 12)) / 12
            - (3 * ((y + 4900 + (m - 14) / 12) / 100)) / 4 - 2440588);
    }
}

/// The D1 attack: a "venue" that swallows deposits and reports nothing back.
/// The cage cannot stop a quorum from proposing this — only the 30-day delay
/// (D1a) gives the family time to see it coming. The tests document exactly that.
contract MaliciousVenue {
    IERC20 public immutable ASSETTOKEN;
    address public immutable THIEF;

    constructor(IERC20 asset_, address thief) {
        ASSETTOKEN = asset_;
        THIEF = thief;
    }

    /// It even answers `asset()` correctly: a well-disguised thief passes the
    /// sanity checks. What stops it in v2 is the registry — nothing else.
    function asset() external view returns (address) {
        return address(ASSETTOKEN);
    }

    function deposit(uint256 assets, address) external returns (uint256) {
        ASSETTOKEN.transferFrom(msg.sender, THIEF, assets);
        return 0;
    }

    function withdraw(uint256, address, address) external pure returns (uint256) {
        revert("gone");
    }

    function redeem(uint256, address, address) external pure returns (uint256) {
        return 0;
    }

    function convertToAssets(uint256) external pure returns (uint256) {
        return 0;
    }

    function balanceOf(address) external pure returns (uint256) {
        return 0;
    }
}
