// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "openzeppelin-contracts/contracts/utils/math/Math.sol";
import {AstryumVault, IUserGate} from "./AstryumVault.sol";
import {AstryumRegistry} from "./AstryumRegistry.sol";
import {PoteParams} from "./PoteParams.sol";

/// Upshift (August Digital) `TokenizedVault`, the surface the pote uses. ABI
/// taken from the VERIFIED source of both mainnet implementations, read:
/// earnXRP 0xc689cc6441146f7c4986ed4f0e1eb6fc382859b2 and Monarq
/// 0x8aa89fad8489ce60628479ca191c3f3ba20ebd48 (TimelockedVault +
/// OraclizedMultiAssetVault). What matters for the accounting:
///  - the shares are a SEPARATE ERC-20 (`lpTokenAddress()`), not the vault;
///  - `requestRedeem` pulls the shares (allowance needed) and books them on a
///    calendar day (date of now + 5 min + lagDuration); NO assets move;
///  - `claim` pays at the CLAIM-day price (not the request price), net of
///    `withdrawalFee`, and ANYONE may run it for any receiver (as may
///    `processAllClaimsByDate`), so the assets can arrive without us calling;
///  - `requestRedeem` reverts when `lagDuration == 0`; then only
///    `instantRedeem` (fee `instantRedemptionFee`, paid from on-contract
///    liquidity) remains;
///  - the NAV (`getTotalAssets`) includes `externalAssets` reported by the
///    venue's operator, bounded per day by `maxChangePercent`.
interface IUpshiftVault {
    function asset() external view returns (address);
    function lpTokenAddress() external view returns (address);
    function lagDuration() external view returns (uint256);
    function withdrawalFee() external view returns (uint256);
    function maxWithdrawalAmount() external view returns (uint256);
    function getTotalAssets() external view returns (uint256);
    function deposit(address assetIn, uint256 amountIn, address receiverAddr) external returns (uint256 shares);
    function requestRedeem(uint256 shares, address receiverAddr)
        external
        returns (uint256 claimableEpoch, uint256 year, uint256 month, uint256 day);
    function claim(uint256 year, uint256 month, uint256 day, address receiverAddr) external returns (uint256, uint256);
    function instantRedeem(uint256 shares, address receiverAddr) external;
    function previewRedemption(uint256 shares, bool isInstant)
        external
        view
        returns (uint256 assetsAmount, uint256 assetsAfterFee);
    function getBurnableAmountByReceiver(uint256 year, uint256 month, uint256 day, address receiverAddr)
        external
        view
        returns (uint256);
}

/// Lo único que un venue ERC-4626 (síncrono o encolado) tiene que responder
/// para entrar: en qué activo trabaja.
interface IVenueAsset {
    function asset() external view returns (address);
}

/// Lo mismo para un mercado Compound V2 (Kinetic).
interface ICompoundUnderlying {
    function underlying() external view returns (address);
}

/**
 * @title AstryumVaultV2 — la generación de pote que fabrica la jaula
 *
 * @notice El mismo pote (hereda todo el AstryumVault: ERC-4626, colchón, caps,
 * cooldown, cesión, payees, salida del holder) con lo que la jaula v2 exige, y
 * SOLO eso. Los potes no mutan: esta es una generación nueva, y el Pote A de
 * mainnet sigue siendo lo que era.
 *
 * ── DONDE VIVE LA PREMISA ──────────────────────────────────────────────────
 *
 * «El principal no se puede retirar» no está en la jaula — la jaula es lo que
 * se upgradea. Está aquí, en código eterno, y en dos comprobaciones que ninguna
 * jaula, ni siquiera una sucesora maliciosa, puede saltarse:
 *
 *  1. **El pote consulta el registro de Astryum él mismo** en `_addVenue`. Un
 *     consejo (la jaula que sea) solo puede meter aquí destinos que hayan
 *     pasado el scanner. Es el suelo duro; la lista eterna de la jaula es la
 *     auto-restricción del manager por encima de él.
 *  2. **Cordura del target**: tiene código, y trabaja en NUESTRO activo. Caza
 *     wallets y activos equivocados; los contratos maliciosos los caza el
 *     registro.
 *
 * ── EL CAP DE PAYEES DEPENDE DE SI EL POTE ES ABIERTO ──────────────────────
 *
 * `MAX_PAYEE_BPS` es de nacimiento. Un pote ABIERTO a terceros (manager,
 * exchange) no puede pagar a sus payees más del 20% del yield: protege a los
 * depositantes. Un pote PRIVADO (familia) puede pagar hasta el 100% a sus
 * herederos — pero entonces tiene que nacer con puerta (`userGate`) y **esa
 * puerta no puede quitarse jamás**: puede cambiar de registro, nunca abrirse.
 * La regla la aplica el pote; la jaula no la conoce.
 *
 * `publishNav()` hace a este pote un spoke desde el día uno: emite su NAV desde
 * su propio estado, atestiguable por FDC `EVMTransaction`. No tiene efectos.
 *
 * ── LA RAMA UPSHIFT ──────────────────────────────────────────
 *
 * `VenueKind.UpshiftQueued` mete en el pote los vaults de Upshift (earnXRP,
 * Monarq), que no son ERC-4626. Cinco decisiones, cada una forzada por el
 * código verificado del venue (ver `IUpshiftVault`):
 *
 *  1. **Solo en potes con cooldown, y cooldown ≥ `lagDuration()`**. La salida
 *     instantánea paga de la liquidez que el vault tiene en el contrato — medida:
 * 0,18 % de earnXRP y 5,7 % de Monarq, así que el pote NO la
 *     trata como síncrona. `_addVenue` lo comprueba contra el venue vivo.
 *  2. **La cola se valora leyendo al venue, jamás con un apunte propio.** Upshift
 *     paga al precio del día del cobro y cualquiera puede cobrar por el pote; un
 *     apunte propio contaría dos veces el mismo FXRP (en la cola Y en el
 *     colchón). El pote guarda solo las FECHAS abiertas y pregunta, por cada una,
 *     `getBurnableAmountByReceiver(fecha, pote)`: si un tercero ya cobró, vale 0
 *     y el FXRP ya está en el colchón.
 *  3. **Margen del 1 % en el unwind del titular.** El precio puede moverse entre
 *     la solicitud y el cobro; el vault lo acota a `maxChangePercent` al día
 *     (20 pb en earnXRP con 1 día de espera, 10 pb en Monarq con 7). El
 *     margen cubre ese recorrido para que el ticket no se quede corto; lo que
 *     sobre llega al colchón, que es de los titulares. El recall del director
 *     no lleva margen: pide lo que pide.
 *  4. **Si el venue pone `lagDuration` a 0, la salida pasa a `instantRedeem`**:
 *     `requestRedeem` revertiría y un ajuste del curador bloquearía la salida.
 *  5. **harvest sigue siendo no-op** para este tipo, como para Firelight: el
 *     corte del operador solo se realiza cuando el capital vuelve a ser líquido.
 *
 * Lo que el pote NO puede proteger, y la ficha del venue tiene que decir: el
 * owner de Upshift puede pausar retiradas, barrer el vault (`emergencyWithdraw`)
 * y actualizar la implementación (proxy); el operador reporta el NAV. El pote
 * acota la exposición (cap por venue, colchón), no la elimina.
 */
contract AstryumVaultV2 is AstryumVault {
    using SafeERC20 for IERC20;
    /// @notice El scanner. Inmutable: ningún consejo puede cambiar quién vigila.
    AstryumRegistry public immutable REGISTRY;

    /// @notice Tope de nacimiento para `setPayees`. ≤ 2000 si el pote es abierto.
    uint16 public immutable MAX_PAYEE_BPS;

    /// @notice true ⇔ nació privado (payees > 20%): la puerta es eterna.
    bool public immutable GATE_PERMANENT;

    /**
     * @notice Tope de posición por CUENTA receptora, en unidades del activo.
     *         0 = sin tope. Lo aplica el propio ERC-4626 (`maxDeposit`/`maxMint`
     *         → `ERC4626ExceededMaxDeposit`), así que ninguna ruta de entrada lo
     *         esquiva. Es un límite de riesgo por posición, NO un KYC: mide la
     *         cuenta que recibe las participaciones, y nunca toca una salida.
     */
    uint256 public maxDepositPerUser;

    uint16 public constant OPEN_PAYEE_BPS_CAP = 2000;
    uint16 public constant ABSOLUTE_PAYEE_BPS_CAP = 10_000;

    // ── Rama Upshift ──────────────────────────────────────────────────────────

    /// @notice Fechas de salida abiertas por venue. Cota del bucle de
    /// `totalAssets`; al llegar al tope se podan las ya cobradas por terceros.
    uint256 public constant MAX_OPEN_EXIT_DATES = 32;
    /// @notice Margen del unwind del titular sobre un venue Upshift (decisión 3).
    uint16 public constant UPSHIFT_UNWIND_MARGIN_BPS = 100;

    /// @notice El token de participaciones de cada venue Upshift, fijado al
    /// añadirlo (Upshift solo lo escribe en `configure`).
    mapping(uint256 => address) public venueShareToken;
    /// @dev Fechas (yyyymmdd) con una salida del pote pedida y no cobrada.
    mapping(uint256 => uint256[]) internal _openExitDates;

    event NavPublished(uint256 totalAssets, uint256 totalSupply, uint256 timestamp);
    event MaxDepositPerUserSet(uint256 cap, bytes32 ref);

    error VenueNotInRegistry(address target);
    error VenueHasNoCode(address target);
    error VenueAssetMismatch(address target);
    error GateIsPermanent();
    error PrivatePoteNeedsGate();
    error PayeeCapOutOfBounds();
    error CooldownBelowVenueLag(uint256 lag);
    error TooManyOpenExits();
    error ExitDateUnknown(uint256 date);

    /// @param p la ficha de nacimiento (`PoteParams`): la misma que la jaula
    ///        recibe en `createPote` y el deployer codifica — un solo struct, no
    ///        doce argumentos.
    constructor(IERC20 asset_, address council_, bytes32 constitutionRef_, AstryumRegistry registry_, PoteParams memory p)
        // Los venues iniciales NO se pasan al padre: se añaden abajo, cuando el
        // registro ya es legible, para que pasen por el scanner como todos.
        AstryumVault(asset_, p.name, p.symbol, council_, constitutionRef_, p.cooldown, p.bufferFloorBps, new InitialVenue[](0))
    {
        if (address(registry_) == address(0)) revert ZeroAddress();
        if (p.maxPayeeBps > ABSOLUTE_PAYEE_BPS_CAP) revert PayeeCapOutOfBounds();

        bool privatePote = p.maxPayeeBps > OPEN_PAYEE_BPS_CAP;
        if (privatePote && p.initialGate == address(0)) revert PrivatePoteNeedsGate();

        REGISTRY = registry_;
        MAX_PAYEE_BPS = p.maxPayeeBps;
        GATE_PERMANENT = privatePote;
        if (p.maxDepositPerUser != 0) {
            maxDepositPerUser = p.maxDepositPerUser;
            emit MaxDepositPerUserSet(p.maxDepositPerUser, constitutionRef_);
        }

        if (p.initialGate != address(0)) {
            userGate = IUserGate(p.initialGate);
            emit UserGateSet(p.initialGate, constitutionRef_);
        }

        for (uint256 i = 0; i < p.initialVenues.length; i++) {
            _addVenue(p.initialVenues[i].target, p.initialVenues[i].kind, uint64(block.timestamp));
        }
    }

    // ── El suelo duro: el pote pregunta al scanner, no se fía del consejo ────

    function _addVenue(address target, VenueKind kind, uint64 readyAt) internal override {
        if (target.code.length == 0) revert VenueHasNoCode(target);
        if (!REGISTRY.isApprovedVenue(uint32(block.chainid), target, uint8(kind))) {
            revert VenueNotInRegistry(target);
        }
        address want = asset();
        if (kind == VenueKind.CompoundV2) {
            if (ICompoundUnderlying(target).underlying() != want) revert VenueAssetMismatch(target);
        } else {
            if (IVenueAsset(target).asset() != want) revert VenueAssetMismatch(target);
        }
        address shareToken;
        if (kind == VenueKind.UpshiftQueued) {
            // Decisión 1: la cola del venue tiene que caber en la del pote.
            uint256 lag = IUpshiftVault(target).lagDuration();
            if (lag > COOLDOWN) revert CooldownBelowVenueLag(lag);
            shareToken = IUpshiftVault(target).lpTokenAddress();
            if (shareToken.code.length == 0) revert VenueHasNoCode(shareToken);
        }
        super._addVenue(target, kind, readyAt);
        if (shareToken != address(0)) venueShareToken[venues.length - 1] = shareToken;
    }

    // ── La rama Upshift: los ganchos de tipo de la base ──────────────────────

    function _kindSupported(VenueKind) internal pure override returns (bool) {
        return true;
    }

    function _venueLiveValue(uint256 venueId) internal view override returns (uint256) {
        if (venues[venueId].kind != VenueKind.UpshiftQueued) return super._venueLiveValue(venueId);
        uint256 shares = IERC20(venueShareToken[venueId]).balanceOf(address(this));
        return shares == 0 ? 0 : _upshiftNet(venues[venueId].target, shares);
    }

    /// Decisión 2: lo que la cola debe, preguntado al venue fecha a fecha.
    function _venueQueuedValue(uint256 venueId) internal view override returns (uint256 total) {
        if (venues[venueId].kind != VenueKind.UpshiftQueued) return super._venueQueuedValue(venueId);
        address target = venues[venueId].target;
        uint256[] storage dates = _openExitDates[venueId];
        for (uint256 i = 0; i < dates.length; i++) {
            uint256 shares = _burnable(target, dates[i]);
            if (shares > 0) total += _upshiftNet(target, shares);
        }
    }

    function _enterVenue(uint256 venueId, uint256 amount) internal override {
        Venue storage v = venues[venueId];
        if (v.kind != VenueKind.UpshiftQueued) return super._enterVenue(venueId, amount);
        IERC20 a = IERC20(asset());
        a.forceApprove(v.target, amount);
        IUpshiftVault(v.target).deposit(address(a), amount, address(this));
    }

    function _queuedExit(uint256 venueId, uint256 amount) internal override returns (uint256) {
        if (venues[venueId].kind != VenueKind.UpshiftQueued) return super._queuedExit(venueId, amount);
        address target = venues[venueId].target;
        address shareToken = venueShareToken[venueId];
        uint256 held = IERC20(shareToken).balanceOf(address(this));
        uint256 shares = held;
        uint256 ta = IUpshiftVault(target).getTotalAssets();
        uint256 fee = IUpshiftVault(target).withdrawalFee();
        if (ta > 0 && fee < 10_000) {
            // Inverso de previewRedemption (floor(shares·TA/supply) menos la fee),
            // redondeado hacia arriba; +1 si aún se queda corto por polvo.
            uint256 supply = IERC20(shareToken).totalSupply();
            shares = Math.mulDiv(amount, supply * 10_000, ta * (10_000 - fee), Math.Rounding.Ceil);
            if (shares < held && _upshiftNet(target, shares) < amount) shares += 1;
            if (shares > held) shares = held;
        }
        if (shares == 0) revert ZeroAmount();
        return _upshiftExitShares(venueId, shares);
    }

    function _evacuateQueued(uint256 venueId) internal override returns (uint256 queued) {
        if (venues[venueId].kind != VenueKind.UpshiftQueued) return super._evacuateQueued(venueId);
        uint256 shares = IERC20(venueShareToken[venueId]).balanceOf(address(this));
        if (shares > 0) queued = _upshiftExitShares(venueId, shares);
    }

    /// Decisión 3: el titular pide un 1 % de más, sin pasar de lo que hay.
    function _unwindQueued(uint256 venueId, uint256 take) internal override returns (uint256) {
        if (venues[venueId].kind != VenueKind.UpshiftQueued) return super._unwindQueued(venueId, take);
        uint256 padded = take + (take * UPSHIFT_UNWIND_MARGIN_BPS) / BPS;
        uint256 live = _venueLiveValue(venueId);
        return _queuedExit(venueId, padded > live ? live : padded);
    }

    /// Cobra una fecha de salida de un venue Upshift. `period` = yyyymmdd. Si un
    /// tercero ya ejecutó el cobro del venue para el pote, solo cierra la fecha
    /// (received = 0: el FXRP llegó antes y ya está en el colchón).
    function _claimVenue(uint256 venueId, uint256 period) internal override {
        Venue storage v = _venue(venueId);
        if (v.kind != VenueKind.UpshiftQueued) return super._claimVenue(venueId, period);
        uint256[] storage dates = _openExitDates[venueId];
        uint256 n = dates.length;
        uint256 i = 0;
        while (i < n && dates[i] != period) i++;
        if (i == n) revert ExitDateUnknown(period);
        dates[i] = dates[n - 1];
        dates.pop();

        uint256 received = 0;
        if (_burnable(v.target, period) > 0) {
            (uint256 y, uint256 m, uint256 d) = _unpackDate(period);
            uint256 before = IERC20(asset()).balanceOf(address(this));
            IUpshiftVault(v.target).claim(y, m, d, address(this)); // el venue revierte si aún no toca
            received = IERC20(asset()).balanceOf(address(this)) - before;
        }
        emit VenueQueueClaimed(venueId, period, received);
    }

    /// @notice Las fechas (yyyymmdd) con salida pendiente en un venue Upshift —
    /// lo que un keeper o la UI pasan como `period` a `claimVenue`/`claimRedeem`.
    function openExitDates(uint256 venueId) external view returns (uint256[] memory) {
        return _openExitDates[venueId];
    }

    // ── Internos de la rama ──────────────────────────────────────────────────

    /// Pide la salida de `shares`; devuelve el valor de hoy de lo pedido (el
    /// venue pagará al precio del día del cobro).
    function _upshiftExitShares(uint256 venueId, uint256 shares) internal returns (uint256 assets) {
        address target = venues[venueId].target;
        assets = _upshiftNet(target, shares);
        _reduceBasis(venueId, assets);

        // Decisión 4: sin espera no hay cola; la única puerta es la instantánea.
        bool instant = IUpshiftVault(target).lagDuration() == 0;
        if (!instant) IERC20(venueShareToken[venueId]).forceApprove(target, shares);
        uint256 before = IERC20(asset()).balanceOf(address(this));
        uint256 perCall = _maxSharesPerCall(venueId, target);
        uint256 date;
        for (uint256 left = shares; left > 0;) {
            uint256 s = left > perCall ? perCall : left;
            left -= s;
            if (instant) {
                IUpshiftVault(target).instantRedeem(s, address(this));
            } else {
                (, uint256 y, uint256 m, uint256 d) = IUpshiftVault(target).requestRedeem(s, address(this));
                date = y * 10_000 + m * 100 + d; // mismo bloque ⇒ misma fecha en todos los trozos
            }
        }

        if (instant) {
            uint256 received = IERC20(asset()).balanceOf(address(this)) - before;
            if (received < assets) emit VenueLossRealised(venueId, assets, received);
            return received;
        }
        _openExitDate(venueId, target, date);
        emit VenueExitQueued(venueId, date, assets);
    }

    /// Upshift rechaza una salida cuyo bruto pase de `maxWithdrawalAmount`
    /// (5M FXRP en earnXRP, 10M en Monarq), así que se trocea. Con
    /// s ≤ ⌊max·supply/TA⌋ el bruto ⌊s·TA/supply⌋ nunca pasa de max.
    function _maxSharesPerCall(uint256 venueId, address target) internal view returns (uint256 perCall) {
        uint256 ta = IUpshiftVault(target).getTotalAssets();
        if (ta == 0) return type(uint256).max;
        perCall = Math.mulDiv(
            IUpshiftVault(target).maxWithdrawalAmount(), IERC20(venueShareToken[venueId]).totalSupply(), ta
        );
        if (perCall == 0) revert ZeroAmount();
    }

    function _openExitDate(uint256 venueId, address target, uint256 date) internal {
        uint256[] storage dates = _openExitDates[venueId];
        for (uint256 i = 0; i < dates.length; i++) {
            if (dates[i] == date) return;
        }
        if (dates.length >= MAX_OPEN_EXIT_DATES) {
            // Poda lo que un tercero ya cobró por el pote (nada que deber).
            for (uint256 i = dates.length; i > 0; i--) {
                if (_burnable(target, dates[i - 1]) == 0) {
                    dates[i - 1] = dates[dates.length - 1];
                    dates.pop();
                }
            }
            if (dates.length >= MAX_OPEN_EXIT_DATES) revert TooManyOpenExits();
        }
        dates.push(date);
    }

    function _upshiftNet(address target, uint256 shares) internal view returns (uint256 net) {
        (, net) = IUpshiftVault(target).previewRedemption(shares, false);
    }

    function _burnable(address target, uint256 date) internal view returns (uint256) {
        (uint256 y, uint256 m, uint256 d) = _unpackDate(date);
        return IUpshiftVault(target).getBurnableAmountByReceiver(y, m, d, address(this));
    }

    function _unpackDate(uint256 date) internal pure returns (uint256 y, uint256 m, uint256 d) {
        return (date / 10_000, (date / 100) % 100, date % 100);
    }

    // ── El cap de payees, según abierto/privado ──────────────────────────────

    function setPayees(address[] calldata accounts, uint16[] calldata bps, bytes32 ref)
        external
        override
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
        if (sum > MAX_PAYEE_BPS) revert PayeeBpsOverCap();
        emit PayeesSet(accounts.length, sum, ref);
    }

    // ── El tope por cuenta: lo aplica el ERC-4626, no una ruta ───────────────

    /// @notice Solo el consejo (la jaula, por orden de su cuenta XRPL). 0 = sin tope.
    function setMaxDepositPerUser(uint256 cap, bytes32 ref) external onlyCouncil withRef(ref) {
        maxDepositPerUser = cap;
        emit MaxDepositPerUserSet(cap, ref);
    }

    /// @notice Lo que ESTA cuenta puede meter aún: el tope menos lo que ya tiene
    ///         (sus participaciones, al valor de hoy). Sin tope, sin límite.
    function maxDeposit(address receiver) public view override returns (uint256) {
        uint256 cap = maxDepositPerUser;
        if (cap == 0) return super.maxDeposit(receiver);
        uint256 held = convertToAssets(balanceOf(receiver));
        return held >= cap ? 0 : cap - held;
    }

    function maxMint(address receiver) public view override returns (uint256) {
        if (maxDepositPerUser == 0) return super.maxMint(receiver);
        return previewDeposit(maxDeposit(receiver));
    }

    // ── La puerta de un pote privado no se quita nunca ───────────────────────

    function setUserGate(address gate, bytes32 ref) external override onlyCouncil withRef(ref) {
        if (GATE_PERMANENT && gate == address(0)) revert GateIsPermanent();
        userGate = IUserGate(gate);
        emit UserGateSet(gate, ref);
    }

    // ── Spoke desde el día uno ───────────────────────────────────────────────

    /// @notice Publica el NAV desde el propio estado. Sin efectos; cualquiera
    ///         puede llamarlo; FDC `EVMTransaction` lo atestigua en otra chain.
    function publishNav() external {
        emit NavPublished(totalAssets(), totalSupply(), block.timestamp);
    }
}
