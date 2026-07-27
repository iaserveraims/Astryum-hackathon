# Astryum — Strategy Spec: "Carry FXRP Protegido" (Track 1)

**Living reference for the strategy. Update as you build.**
**Last updated:** 2026-07-25 (rev 3 — Cable 1 BUILT + PA-native repay) · **Build spec (source of truth):** [docs/context/Astryum_BuildSpec_Carry_FXRP_2026-06-30.md](docs/context/Astryum_BuildSpec_Carry_FXRP_2026-06-30.md)
**Read with:** [INVARIANTS.md](INVARIANTS.md) · [DECISIONS.md](DECISIONS.md)

> **Scope:** only up to FXRP. No redeem to native XRP (roadmap). Everything inside the Kinetic **ISO** market (FXRP-USDT0-STFXRP, isolated comptroller — distinct contracts from the primary Kinetic market).

> **⚠ EXEC-PATH VERDICT (rev 2, sourced):** an earlier draft flagged the PA-side legs as "blocked on a 0x99 register path." That was **wrong.** **`0x99` is not a Flare opcode** (encoder `instructions.js` defines only `UserOp=0xFE` and `MemoFieldUserOp=0xFF`; the `'99'` in our code is a project-internal label for the *older register path*). **`0xFE` executes an arbitrary `executeUserOp(Call[])` on the PA** — the exact mechanism E1 uses — confirmed by [dev.flare.network/smart-accounts/custom-instruction](https://dev.flare.network/smart-accounts/custom-instruction), the encoder's `UserOpCustomInstructionInput` (no mint fields), and `e1-vault-prepare.ts` ("the ONLY difference is the inner batch"). **So the PA-side legs are executable today — no Flare dependency, no 10-Jul gate.** The one real property: **0xFE dispatch is mint-coupled** (`executeDirectMintingWithData` mints FXRP from the XRP paid, then runs the Call[]). Send the minimum XRP; the mint is disclosed. A truly *mint-free* PA dispatch would need the parked register path — not required for this strategy.

---

## 0. Invariant (confirmed in every flow below)

Astryum/Defibro **never signs, never broadcasts.** Every action produces an **UNSIGNED** payload the user signs in their own wallet (**Interpretation A**: the user signs the exact pre-built tx; zero delegated discretion). The `defibroSigns: false` / `disclosedToUser: true` fields on every prepare response are the machine-checkable proof. Confirmed per cable in §2.

---

## 1. The strategy — every step, asset, protocol, signer

### Opening (`E1`, user signs step by step in Xaman)

| # | Action | Asset | Protocol / contract | Signer | Status |
|---|--------|-------|---------------------|--------|--------|
| 1 | Mint FXRP + supply as collateral + borrow USDT0 (1 atomic userOp) | XRP→FXRP, USDT0 | Kinetic ISO via Flare Smart Account `0xFE` direct-mint | **Xaman** (XRPL Payment) | ✅ built & tested (`buildE1Handoff`) |
| 2 | Supply the borrowed USDT0 back into the ISO market (~14% APY) | USDT0 | `kUSDT0_ISO.mint` | **Xaman** (separate 0xFE PA userOp) | ✅ builder + route built & tested (`buildIsoSupplyUsdt0Batch`, `/supply-usdt0/prepare`) |

### Protection (fires when the HF trigger hits)

| # | Action | Asset | Protocol / contract | Signer | Status |
|---|--------|-------|---------------------|--------|--------|
| 3+4 | Withdraw X USDT0 from ISO supply **and** transfer PA→EVM (one atomic 0xFE userOp) | USDT0 | `kUSDT0_ISO.redeemUnderlying` + ERC-20 `transfer` | **Xaman** (0xFE PA userOp) | ✅ builders + route built & tested (`buildIsoWithdrawUsdt0`, `buildErc20TransferCall`, `/pa-withdraw-transfer/prepare`) |
| 5 | `repayBorrowBehalf(PA, amount)` → lifts HF | USDT0 | `kUSDT0_ISO.repayBorrowBehalf` | **MetaMask** (EVM direct) | ✅ built & tested (Cable 2, `/a1/prepare`) |
| 5-alt | **PA-native repay** — `[redeemUnderlying(shortfall)?, approve, repayBorrowBehalf]` in ONE atomic 0xFE userOp, funded from the PA's free USDT0 then its carry supply (walletless leg — no EVM wallet, executor-paid gas) | USDT0 | same ISO contracts | **Xaman** (0xFE PA userOp) | ✅ built & tested 2026-07-25 (`buildIsoPaRepayBatch`, `/pa-repay/prepare`; modal offers both rails; Intents card deep-links; payload composed FRESH at act time — an XRPL Payment can't be pre-baked at trigger time) |

### DERISK (unwind — the twin of the stop-loss; order is on-chain-mandatory)

| # | Action | Asset | Contract | Signer | Status / Note |
|---|--------|-------|----------|--------|------|
| 1 | Withdraw supplied USDT0 + transfer PA→EVM | USDT0 | `kUSDT0_ISO.redeemUnderlying` + `transfer` | Xaman (0xFE PA userOp) | ✅ `/pa-withdraw-transfer/prepare` (asset=usdt0) |
| 2 | Repay the USDT0 debt in full | USDT0 | `kUSDT0_ISO.repayBorrowBehalf` | MetaMask (EVM) | ✅ `/a1/prepare` (mode=full). ⚠ spread → withdrawn USDT0 may fall short of debt; user tops up the difference from EVM |
| 3 | Withdraw the FXRP collateral + transfer PA→EVM | FXRP | `kFXRP_ISO.redeemUnderlying` + `transfer` | Xaman (0xFE PA userOp) | ✅ `/pa-withdraw-transfer/prepare` (asset=fxrp). **only after debt fully repaid** — Compound blocks collateral redeem while a borrow is outstanding (`redeemAllowed`), dependency **confirmed** |

**DERISK is inherently sequential** (on-chain order + PA nonce auto-increments per userOp — MCP warns against reusing `getNonce` across concurrent payments). Build/sign step 3's userOp only after step 1+2 land. The two PA legs and the EVM repay are 3 separate signatures (Interpretation A, step by step).

**DERISK scope:** unwinds down to **FXRP + USDT0 back in the wallet.** Redeem FXRP→native XRP is **roadmap, not built.**

### Economics (display only, never a promise — invariant #9)
FXRP supply earns ~2% APY (incl. RFLR) which offsets part of the negative USDT0 carry (borrow ~15.5% vs supply ~14%). The collateral works; it is not dead. All APYs shown are protocol data with source, never a Defibro offer.

---

## 2. Cable status (built / tested / pending) + files & addresses

### CABLE 3 — HF routed to the ISO comptroller ✅ BUILT & TESTED
- **What:** `getMetrics` and `simulateAction` read the health factor against the comptroller that **governs the position** (`position.metadata.comptroller` / `action.inputs.comptroller`), falling back to the primary only when absent. Before, both hardcoded the primary comptroller — so the ISO FXRP position's HF was read from a market it isn't in, mis-firing the stop-loss trigger.
- **Files:** [backend/src/connectors/protocols/adapters/KineticAdapter.ts](backend/src/connectors/protocols/adapters/KineticAdapter.ts) (`getMetrics`, `simulateAction`) · test [KineticAdapter.metrics.test.ts](backend/src/connectors/protocols/adapters/__tests__/KineticAdapter.metrics.test.ts) (3 tests).
- **Invariant:** read-only (metrics + simulation). No signing, no broadcast. ✅

### CABLE 2 — ISO repay builder + restore-HF math + `/a1/prepare` route ✅ BUILT & TESTED
- **What:**
  - `KineticAdapter.buildIsoRepayBehalfBatch({ borrower, repayUsdt0, usdt0Token })` → unsigned `[approve(USDT0→kUSDT0_ISO), kUSDT0_ISO.repayBorrowBehalf(borrower, amount)]`. Selector `0x2608f818` verified in test.
  - `KineticIsoMath.computeRepayToRestoreHF(...)` → how much USDT0 to repay to bring HF back to `targetHF` (`ΔD = D − (C·P·CF)/HF_safe`), CEILed, capped at outstanding debt; `needed:false` when already safe. Repay-in-full supported via `mode:'full'`.
  - Route `POST /api/flare-demo/a1/prepare` — the protection twin of E1; reuses the `e1.a1` precomputed inputs, resolves the USDT0 underlying **on-chain** via `kUSDT0_ISO.underlying()` (invariant #3 — never conflate the receipt kToken with the underlying), returns the unsigned EVM `calls` + disclosure. Behind the same flag+geofence gate as E1/E2.
- **Files:** [KineticAdapter.ts](backend/src/connectors/protocols/adapters/KineticAdapter.ts) (`buildIsoRepayBehalfBatch`) · [KineticIsoMath.ts](backend/src/connectors/protocols/flare/KineticIsoMath.ts) (`computeRepayToRestoreHF`) · [flareDemo.ts](backend/src/routes/flareDemo.ts) (`/a1/prepare` + `resolveIsoUsdt0Underlying`) · tests [KineticAdapter.iso.test.ts](backend/src/connectors/protocols/adapters/__tests__/KineticAdapter.iso.test.ts) (3 new) + [KineticIsoMath.test.ts](backend/src/connectors/protocols/flare/__tests__/KineticIsoMath.test.ts) (4 new).
- **On-chain addresses (mainnet, from `.env`):** ISO comptroller `0x15F69897E6aEBE0463401345543C26d1Fd994abB` · kFXRP_ISO `0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3` · kUSDT0_ISO `0xad7e7989796414c9572da9854DEb1B920724fd09` · FXRP `0xAd552A648C74D49E10027AB8a618A3ad4901c5bE` · USDT0 underlying resolved live via `kUSDT0_ISO.underlying()`.
- **Tests:** 30 green across the Kinetic + ISO-math suites.
- **Pending for full sign-off:** read-only dry-run on mainnet (part of the integration step) + a `/a1/prepare` route test (E1/E2 currently have none — thin orchestration over tested units).
- **Invariant:** returns unsigned calls only, `defibroSigns:false`, USDT0 resolved on-chain not guessed. The **signer is the user's EVM wallet** (repayBorrowBehalf lets the EVM wallet clear the PA's debt). ✅

### PA-SIDE LEGS — carry re-supply + protection/DERISK withdraw & transfer ✅ BUILT & TESTED
- **What:** all PA-side actions run as arbitrary `Call[]` inside a **0xFE userOp** (the E1 mechanism), wrapped by the proven `buildDirectMintHandoff`.
  - `KineticAdapter.buildIsoSupplyUsdt0Batch({ amountUsdt0, usdt0Token })` → `[approve, kUSDT0_ISO.mint]` (carry re-supply; **separate** from the E1 batch per user decision — E1 untouched).
  - `KineticAdapter.buildIsoWithdrawUsdt0({ amountUsdt0 })` → `[kUSDT0_ISO.redeemUnderlying]`.
  - `KineticAdapter.buildIsoWithdrawFxrp({ amountFxrp })` → `[kFXRP_ISO.redeemUnderlying]`.
  - `FlareSmartAccountService.buildErc20TransferCall({ token, to, amount })` → `[token.transfer(evmWallet, amount)]` (the PA→EVM move).
  - Routes: `POST /supply-usdt0/prepare` and `POST /pa-withdraw-transfer/prepare` (asset `usdt0`|`fxrp`) — each returns the UNSIGNED XRPL Payment (0xFE) + disclosure.
- **Files:** [KineticAdapter.ts](backend/src/connectors/protocols/adapters/KineticAdapter.ts), [FlareSmartAccountService.ts](backend/src/connectors/protocols/flare/FlareSmartAccountService.ts), [flareDemo.ts](backend/src/routes/flareDemo.ts) · tests in [KineticAdapter.iso.test.ts](backend/src/connectors/protocols/adapters/__tests__/KineticAdapter.iso.test.ts) + [FlareSmartAccountService.test.ts](backend/src/connectors/protocols/flare/__tests__/FlareSmartAccountService.test.ts).
- **Mint-coupling (disclosed):** because 0xFE dispatches via `executeDirectMintingWithData`, each PA userOp also mints a small FXRP into the PA from the `amountXrpForMint` paid. Send the minimum; the mint + fees are in the disclosure. For protection this is benign (extra collateral). This is a property of Flare's userOp dispatch, not a Defibro choice.
- **Coverage note:** `encodeAction` was NOT reusable here — it resolves markets only via `KINETIC_KTOKEN_ENV` (`USDC.E, SFLR, WETH, FLRETH`), no USDT0/ISO awareness — so dedicated ISO sibling builders were the right call.
- **Invariant:** every route returns unsigned payloads, `defibroSigns:false`; the USDT0 underlying is resolved on-chain. ✅

### CABLE 1 — Automation override ✅ BUILT (verified 2026-07-25)
`KineticAdapter.buildTransactionIntent` is overridden for `repay`: on trigger it computes the LIVE restore amount (`computeRepayToRestoreHF` over the user's signed `targetHF`), fills `txData` with `repayBorrowBehalf` and carries the `approve` as `preState.prerequisiteCalls` — the Intents surface batches both into one EVM signature. Degrades honestly: env unconfigured → warning without calldata; HF recovered → "nothing to repay" without payload. The walletless twin is the PA-native repay above (nudge pattern: the trigger's intent card deep-links to the position, where the 0xFE payload is composed fresh and signed in Xaman).

---

## 3. Execution reality (what was "estimate", now resolved & built)

### 3A. Supply / withdraw USDT0 in the ISO market — ✅ BUILT
Sibling ISO builders (`buildIsoSupplyUsdt0Batch`, `buildIsoWithdrawUsdt0`, `buildIsoWithdrawFxrp`) + routes. Supply is the carry re-supply (separate PA userOp, E1 untouched); withdraw feeds protection + DERISK. All unsigned, tested.

### 3B. PA→EVM USDT0 transfer — ✅ BUILT (NOT blocked — earlier flag refuted)
`buildErc20TransferCall` produces the unsigned `transfer` and it rides a **0xFE userOp** (arbitrary `Call[]` on the PA — the E1 mechanism), so it is **executable today**, bundled atomically with the withdraw in `/pa-withdraw-transfer/prepare`. The only property is the **mint-coupling** (0xFE mints a small FXRP as it dispatches). No Flare-coordination dependency; the "0x99 blocker" was a phantom.

### 3C. DERISK unwind — ✅ BUILT (composition of the above)
Sequence: `/pa-withdraw-transfer` (usdt0) → `/a1/prepare` (mode=full) → `/pa-withdraw-transfer` (fxrp). Collateral redeem after full repay — Compound `redeemAllowed` dependency confirmed. **Shortfall:** borrow rate > supply rate, so withdrawn USDT0 can be < debt; the user tops up the difference from their EVM wallet at the repay step (Cable 2 path). Sequential by nonce (see §1 note).

---

## 4. Preparation mode (users) vs full mode (judges)
- **Users (hackathon):** connect wallet **read-only**. Every route returns the unsigned payload + calldata + disclosure and **stops before signing** — nothing touches the chain. The prepare routes (`/e1/prepare`, `/e2/prepare`, `/a1/prepare`) already embody this: they build and disclose, they never sign. Exploration + feedback, zero risk.
- **Judges:** run the real flow on a **team-controlled, funded** wallet (Turnkey passkey / prepared wallet) on mainnet over the same tested code — sign in Xaman/MetaMask and watch it execute.
- **Implication:** the "mode" is a **frontend gate on whether the returned unsigned payload is handed to a wallet for signing** — the backend is identical (always prepare-only). No backend branch needed; the invariant holds for both audiences by construction.

---

## 5. Out of scope (roadmap / grant) — and why
- **Swap / SparkDEX / looping / reinvest-with-swap** → USDT0 works in the ISO; no swap needed. Roadmap/grant.
- **Atomic bundle / single signature** → depends on the `0xFE` executor coordination (Flare devs, 10 Jul) → grant. (This is the same dependency surfaced in 3B/3C.)
- **stXRP / Firelight / Upshift, Enosys / BlazeSwap** → no wired adapters → roadmap.
- **Morpho / Aave** → other chains → irrelevant here.
- **Redeem FXRP→native XRP** → roadmap; DERISK stops at FXRP+USDT0 in wallet.
- **Turnkey delegated signing / session keys / Interpretation B** → future regulatory decision, outside hackathon & grant.
- **Sceptre shape-mismatch caveat** → independent of the FXRP path; only if time remains.

---

## 6. Invariant confirmation per flow
- **E1 open (built):** unsigned XRPL Payment; user signs in Xaman; Defibro reads fees/price live and discloses. ✅
- **A1 repay (Cable 2, built):** unsigned EVM `[approve, repayBorrowBehalf]`; user signs in MetaMask; USDT0 underlying resolved on-chain; `defibroSigns:false`. ✅
- **Carry re-supply + protection/DERISK PA legs (built):** unsigned XRPL Payment wrapping a 0xFE userOp `Call[]`; user signs in Xaman (Interpretation A); mint + fees disclosed. Defibro builds, never signs. ✅
- **Test coverage:** 83 tests green across the Flare connectors + adapters (Kinetic adapter/ISO/metrics/encode, KineticIsoMath, FlareSmartAccountService, FlareDirectMintService, etc.). Route layer mirrors the E1/E2 pattern (thin orchestration over tested units); mainnet read-only dry-run is the remaining sign-off step.

---

*Base: on-chain verification (`repayBorrowBehalf` selector `0x2608f818` in `kUSDT0_ISO` bytecode) + MCP Flare custom-instruction docs + encoder source + code. **The earlier "PA-side blocker" was refuted:** 0xFE runs arbitrary `Call[]` on the PA (mint-coupled), so no Flare-coordination dependency remains for this strategy. The only mint-free alternative (register path) is parked and not needed.*
