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
