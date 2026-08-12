# ARCHITECTURE.md — Defibro

> The system shape. Reconciled with [Defibro-Validated_Architecture.md](Defibro-Validated_Architecture.md)
> (the validated plan, 2026-06-20). The rules this shape must never break are in
> [INVARIANTS.md](INVARIANTS.md); the locked choices behind it are in [DECISIONS.md](DECISIONS.md);
> the operating summary is in [CLAUDE.md](CLAUDE.md).

---

## 0. The anchor

**The base is not XRPL. The base is Defibro's chain-agnostic core.**

Two distinct "bases":

| | What it is | Single or multi |
|---|---|---|
| **Coordination base** | Defibro core: canonical intent, Capital Map, PolicyGuard, orchestration, audit, UX | **Single** — built once, reused everywhere |
| **Origin / wallet base** | Where capital + signing start | **Multi** — XRPL/Xaman, EVM/MetaMask, Solana/Phantom |

XRPL is the **flagship origin** (the XRP wedge), not the universal base. See
[DECISIONS.md ADR-001](DECISIONS.md).

---

## 1. Observe wide, execute narrow

- **Observe (read-only): wide.** All chains, all assets — the Capital Map.
- **Execute: narrow.** Per ecosystem, via that ecosystem's best partner. The user **always
  signs**; Defibro builds the intent/calldata and is invisible in the execution path.

```
ORIGINS  (multi, user-held)
  XRPL/Xaman        EVM/MetaMask        Solana/Phantom
       │                  │                   │
       ▼                  ▼                   ▼
DEFIBRO CORE  (single, chain-agnostic — THE base)
  Intelligence · Canonical Intent · Capital Map ·
  PolicyGuard · Mandate engine · Orchestration · Audit
       │
       ▼   (thin per-ecosystem adapters)
EXECUTION PARTNERS  (heavy lifting)
  Enso (EVM) · Flare adapters (SparkDEX/Kinetic/Firelight/Ēnosys/Sceptre) ·
  Axelar+Sidechain (Phase 1.5) · Xaman · CoW/ComposableCoW · Keepers (Gelato/Chainlink)
       │
       ▼
CHAINS / PROTOCOLS        ←  user signs every action
```

---

## 2. The five layers (grounded in code)

### 2.1 Intelligence
Claude copilot (NLP → intent only — no execution discretion), MCP Ripple/XRPL, DefiLlama
(`CanonicalBridgeService` streams the pool catalog → Capital Map), GoPlus / Hypernative (risk),
Tenderly (pre-sign simulation), oracles (Flare FTSO under `backend/src/flare/ftso/`).

### 2.2 Canonical Intent (the moat, built once)
`DEFIBRO_ACTION.*` engine (closed core), PolicyGuard (P1–P27 + KYC P38), Goals / Strategies /
Moneyflows, the mandate engine, and the multi-wallet connection layer. Prepare-only:
- `control-plane/IntentPreparationEngine` + `CalldataBuilder` build **unsigned** payloads.
- `partners/RegulatedRelayBoundary` is the explicit prep↔hand-off boundary: it creates an
  authorization session, records the user's `authorizationProof` (**not** a txHash), and after
  hand-off **stops** — no txHash tracking, no broadcast, no execution guarantee.
- `engines/automation/AutomationEngine` is **prepare-only**: triggers create a pending
  authorization session for the user to review; it never signs or broadcasts.

The intent spec + XRPL adapter are intended to be open-source; the engine is not.

### 2.3 Translation (per-ecosystem execution)
- **PATH A — Enso (EVM canonical).** `integrations/providers/defi/EnsoProvider` builds unsigned
  calldata for single actions and atomic bundles across chains **1, 137, 42161, 10, 8453, 56,
  43114, 250** (+ more as enabled). **Flare (14) is explicitly excluded.**
- **PATH B — SDKs** where a direct SDK beats the aggregator (Aave ✅, Morpho, Spark sUSDS).
- **PATH C — Flare direct adapters.** `connectors/protocols/adapters/`:
  `SparkDEXAdapter`, `KineticAdapter`, `FirelightAdapter`, `EnosysAdapter`, `SceptreAdapter`.
  Entry via Flare Smart Accounts + FAssets (FXRP).
- **XRPL** — xrpl.js + MCP Ripple, signed in Xaman.
- **Fallback** — "Go to the protocol →" deep link.
- **XRP→EVM yield (Phase 1.5)** — XRPL EVM Sidechain + Axelar + Enso/CoW. *Not built yet.*

### 2.4 Wallet Coordination
Connect (WalletConnect / Xaman / MetaMask / Ledger) · **create (embedded — Turnkey, passkey-only,
LOCKED)** · watch-only · binding-by-signature · smart accounts (ERC-4337 / EIP-7702 session keys
with on-chain bounds). Cross-ecosystem moves use `services/walletRouting/` (`WalletRouter`
resolves which wallet signs; `BundleBuilder` persists a 2-step bridge→execute bundle). The router
is **read-only**; it never builds calldata, broadcasts, or custodies. **Cross-ecosystem bridges
go source→destination directly (LI.FI/Squid/Across) — never through an XRPL hop.**

### 2.5 Partner Coordination
MoonPay + Transak (fiat, CASP/MiCA), Crossmint / Persona (KYC), Circle (USDC/EURC), CoW /
ComposableCoW (conditional EVM orders, permissionless WatchTower), Gelato / Chainlink (keepers —
⚠ Gelato double-role, do not concentrate), Axelar (Phase 1.5). All in `partners/PartnerRegistry`.

---

## 3. The agentic stack (the custody line)

"AI compiles, user signs once, trustless logic executes within signed bounds."

- **EVM conditional / agentic** = **ComposableCoW** (1 signature, permissionless WatchTower) and/
  or **ERC-4337 / EIP-7702 session keys with on-chain enforced bounds** (scoped via ERC-7715).
- **Turnkey** = embedded-wallet UX where the **user authorizes via passkey only** for user funds.
- The agent has **zero unilateral discretion**; Defibro never executes, broadcasts, or custodies.

See [INVARIANTS.md](INVARIANTS.md) #2–#5.

---

## 4. Isolated / gated modules (do not couple into core)

- **Flare PMW / FCC** (Q3 2026, XRP/BTC only, TEE-managed custody = delegated signing). **V1.1,
  MiCA-gated.** Keep any adapter as a **separate, isolated module**; do **not** couple it into
  core and do **not** gate V1 on it. PMW does **not** reach a user's own MetaMask/Phantom assets.
  *No PMW/FCC code exists today — build the live Smart Accounts flow now instead.*
- **Turnkey delegated-agent-signing** (off-chain policy). **V1.1, MiCA-gated.** If ever used,
  compose with ERC-4337 so bounds are on-chain. (Distinct from the V1 passkey-only embedded
  wallet, which is LOCKED.)
- **Treasury signing.** `services/wallet/TurnkeyTreasuryService` signs **Defibro's own revenue**
  (fees/affiliate) inside Turnkey's TEE under org policy. This is Defibro's **own money**, not
  user custody — it must **never** be extended to user funds (that would cross the custody line).

---

## 5. Resistance Layer — disclosures per route

Every adapter inherits partner risk; disclose it (`ResistanceLayerService`):
Axelar bridge trust + hops · the XRPL EVM Sidechain (new, PoA, modest liquidity) · FAssets · PMW
(TEE consortium + Core Vault → Ripple-connected custodian in emergencies) · Flare TVL is thin
(~$160M) so deep yield lives on the EVM majors. Maintenance + partner uptime (Enso/Axelar) are
inherited risks.

---

## 6. Competitive boundary

Luminite / SparkDEX = Flare-centric wallet + DEX. Defibro **integrates SparkDEX as an execution
venue**; it does not compete as a wallet or DEX. Differentiation = multi-wallet coordination
across ecosystems, not a better single-chain wallet. See [DECISIONS.md ADR-006](DECISIONS.md).

---

*Phasing lives in [DECISIONS.md](DECISIONS.md) §Phasing. When this doc and an older
`/docs/context/` plan disagree, this doc + DECISIONS.md win.*
