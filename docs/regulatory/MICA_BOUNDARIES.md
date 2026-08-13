# Astryum — MiCA Regulatory Boundaries

**Document version**: 1.0
**Date**: 2026-06-02
**Status**: Internal — for legal review
**Audience**: Legal counsel, compliance, founding team

---

## 1. Purpose of this document

This document maps every code path in Astryum that touches user capital, signing, broadcasting, fee attribution, or advisory output **against the requirements of Regulation (EU) 2023/1114 (MiCA)**, with specific attention to:

- Article 3(1)(15) — definition of CASP
- Article 3(1)(16) — list of crypto-asset services
- Article 2(2) — fully decentralized services carve-out
- Article 3(1)(16)(7) — Reception and Transmission of Orders (RTO)
- Article 3(1)(16)(8) — Providing advice on crypto-assets
- Article 3(1)(16)(1) — Custody and administration on behalf of clients
- Article 3(1)(16)(5) — Execution of orders on behalf of clients

The document is the source of truth a regulator or external counsel can read to understand how Astryum's technical architecture maps to its non-CASP positioning. If you change anything in the code that affects one of these boundaries, you MUST update the relevant section here in the same PR.

---

## 2. The seven non-negotiable boundaries

Every claim in §3-§8 below traces back to one of these seven boundaries. Internally, these are the "red lines" — code that violates them is a CASP exposure regardless of any other architecture choices.

| # | Boundary | Where enforced |
|---|---|---|
| 1 | Astryum never signs transactions on behalf of users | Compile-time guard in `IntentPreparationEngine.ts`; `_BROADCAST_FORBIDDEN` type. WalletManager + service-side signing deleted 2026-06-01 (audit Cat 6.1). |
| 2 | Astryum never broadcasts transactions | `FlareProvider.sendTransaction()` removed 2026-06-01. `ExecutionEngine.submitSigned()` removed. `/api/execution/submit` returns 410 Gone. Non-EVM chain providers throw `BROADCAST_FORBIDDEN`. Scope: USER transactions — operator-owned zero-discretion txs are the narrow carve-out documented in §9-bis. |
| 3 | Astryum never custodies user funds | No service holds keys; no smart contract address belonging to Astryum receives user assets; the BundleStatusWatcher only POLLS partner status, never moves funds. |
| 4 | Astryum never exercises discretion over user capital | Every state transition that affects user assets requires explicit user authorization through their wallet partner. AutomationEngine is prepare-only (V2 design, `setInterval` only creates `IntentAuthorizationSession` records). |
| 5 | Astryum never collects a fee from a flow that does not pass through a registered regulated partner | `buildReferralAttribution(allowsReferralFee)` in CalldataBuilder; partner.allowsReferralFee gates the entire referralCode/referrerWallet emission. |
| 6 | Astryum never executes in background without explicit just-in-time user confirmation | No session-key delegation; no MPC; no relay queue; the only background services that exist (`PoolIngestionService`, `BundleStatusWatcher`, `AutomationEngine.tick`) are explicitly prepare-only or read-only. |
| 7 | Astryum never produces output that constitutes investment advice under Art. 3(1)(16)(8) | Endpoint `/api/ai/v1/recommend-actions` renamed to `/contextual-signals`; `recommendations` field renamed to `signals`; every AI response carries a mandatory `disclaimer` field; copy reframed from "X actions recommended" to "X contextual signals detected". |

If a code change violates any of these, the audit's job is to either remove the code or relocate the responsibility to a regulated partner.

---

## 3. Architecture at a glance

```
USER WALLET                  ASTRYUM BACKEND                  ON-CHAIN
(MetaMask, Phantom,         (Express + Prisma)
Xaman, Petra, ...)

  signs                  ──► PartnerRegistry.resolveFor()       ──► smart
   only                       │                                       contract
                              ▼                                       executes
  broadcasts             ◄── CalldataBuilder.prepare()                autonomously
   only                       │  (unsigned calldata only)
                              │
                              ▼
                          PolicyGuard.evaluate()
                              │  (P1-P38 incl. KYC)
                              │
                              ▼
                          RegulatedRelayBoundary
                              │  (audit log only, no relay)
                              ▼
                          Frontend gets payload
                              │
  user reviews       ◄────────┘
  user signs in
  wallet
  wallet broadcasts ──────────────────────────────────────────────────►
```

Astryum produces unsigned calldata. The user's wallet partner shows it, the user signs, the wallet partner broadcasts. The backend never sees the signature operationally.

---

## 4. Three-tier partner model (Block B, refactored Block G)

Astryum classifies every partner into one of three tiers. The classification is enforced at the `PartnerRegistry.resolveForOperation()` level.

### TIER 1 — WALLET_PARTNER

The user's own wallet IS a registered partner. For all self-custody DeFi operations (lending, borrowing, staking, LP, vault, swap on the same chain) the resolver returns either:
- A **value-add aggregator** (Enso, CoW, 1inch, MoonPay Trade, Jupiter, UniswapX, Swaps.xyz) when one is enabled — they construct better calldata (atomic bundles, MEV protection, optimal routing) but still hand the unsigned tx to the user's wallet.
- The **ecosystem-default wallet partner** (`wallet-evm-defi`, `wallet-solana-defi`, `wallet-xrpl-defi`, `wallet-aptos-defi`) as a guaranteed fallback. Always enabled.

Regulatory framing: self-custody software (MetaMask, Phantom, Xaman) is not a CASP under MiCA — it's user-operated tooling. Astryum routing a calldata to the user's own wallet is comparable to a tax software auto-filling a return — the user still signs and submits.

### TIER 2 — BRIDGE_PARTNER

For operations that cross architecturally incompatible ecosystems (EVM ↔ XRPL, EVM ↔ Solana, EVM ↔ Aptos, EVM ↔ Cosmos). Registered: LI.FI, Squid, Across. These are aggregators that compose bridge routes; they themselves operate as non-custodial relayers.

Regulatory framing: similar to TIER 1 — Astryum hands unsigned bridge calldata to the user's source-chain wallet. The bridge protocol settles autonomously. Astryum NEVER moves funds.

### TIER 3 — REGULATED_CASP

ONLY for fiat on/off-ramp (`onramp`, `offramp`). Registered: MoonPay, Transak, Meld. These ARE CASPs in their jurisdictions — they hold the user's fiat, run KYC, settle the crypto leg. Astryum hands the user to their flow.

Regulatory framing: this is the only tier where a CASP touches user capital. Astryum is the front-end that integrates a third-party CASP — clearly out of the CASP definition itself.

### Resolver invariant

For onramp / offramp / bridge → no fallback. If no enabled partner matches, the resolver returns `null` and the route refuses with `NO_REGULATED_PARTNER_FOR_OPERATION` (HTTP 403). For self-custody DeFi → the resolver ALWAYS returns at least the ecosystem-default wallet partner. Tested in `PartnerRegistry.test.ts` (15 tests).

---

## 5. Article 3(1)(16)(7) RTO analysis — the riskiest classification

The MiCA service most likely to be argued against Astryum is "Reception and Transmission of Orders on behalf of clients". The architecture is structured to fall outside this definition.

### What RTO requires (ESMA interpretation)

Per ESMA's draft technical standards (CP-MiFID-2024 referenced for analogy under MiCA): RTO involves (a) receiving an order from a client, (b) transmitting it to a third party for execution, (c) on behalf of the client.

### Why Astryum's architecture doesn't fit RTO

| RTO element | Traditional broker | Astryum |
|---|---|---|
| (a) Receives an order from client | Client says "buy 100 AAPL" | User clicks "Supply on Aave V3" — but this is a UI action, not an order. Astryum produces unsigned calldata for the user to evaluate. The user can reject. |
| (b) Transmits to a third party for execution | Broker sends order to exchange | Astryum hands unsigned calldata to the USER'S OWN WALLET. The wallet is not a "third party" — it's the user's tool. The user, via their wallet, transmits to the protocol. |
| (c) On behalf of the client | Broker acts as agent | Astryum acts as software author. The user retains every decision. No agency relationship is created. |

### Defensive code patterns supporting this position

1. **No persistence of signed transactions** — `RegulatedRelayBoundary` stores only the `payloadHash` and `signedPayloadHash` (the authorization proof), never the signed raw tx. After `exportToPartnerRelay`, Astryum forgets the transaction operationally.
2. **No tx-hash operational tracking** — `submitByHash` was reduced 2026-06-01 to an AuditLog write only. No `TransactionRecord` row; no `trackTransaction()` polling. Astryum registers that the user reported a hash, then stops.
3. **PolicyGuard rejects orders Astryum can't audit** — every intent passes `policyGuard.evaluate()` with `requiresKyc: true` and the user's actual KYC state from the DB.

### Residual risk

The strongest counter-argument an aggressive regulator could mount: by constructing calldata with embedded fees and routing to a chosen partner, Astryum effectively makes the routing decision FOR the user. The mitigations are: explicit fee disclosure on every intent (literal `true` field), user override via `preferred: 'wallet-evm-defi'`, and the resolver returning the user's own wallet as a default for self-custody (not an aggregator) so no third party is "chosen".

The strongest defensive move on top of architecture: a legal opinion from a top-tier MiCA-savvy firm (Allen & Overy, Linklaters, Hogan Lovells, or an Andorra AFA specialist) framing the architecture as software-publisher, not service-provider.

---

## 6. Article 3(1)(16)(8) — Investment advice

This is the second-riskiest classification (after RTO) because of the AI Copilot.

### What advice requires

ESMA interpretation: a personal recommendation to a specific person, made by reference to that person's circumstances, concerning a specific crypto-asset.

### What Astryum's AI does NOT do

- It does NOT recommend specific assets. The system prompt in `routes/aiChat.ts:9-19` and `routes/agent.ts:81-83` explicitly forbids "recommend specific protocols as best", "investment advice", "yield optimization suggestions".
- It does NOT make personal recommendations. The user's portfolio is provided as CONTEXT, but the AI's output is reframed as "contextual signals", not actions to take.
- The endpoint that historically was named `recommend-actions` was renamed 2026-06-01 to `contextual-signals`. The response field `recommendations` was renamed to `signals`. The method `StrategyEngine.recommendDefensive()` was renamed to `detectDefensiveSignals()` (legacy alias deprecated).

### What the AI DOES do

- Explains the user's existing portfolio risk in plain language (Article 3(1)(16)(8) explicitly excludes general factual information).
- Surfaces deterministic computational outputs (e.g. health factor projection given a hypothetical borrow) — these are calculations, not opinions.
- Returns a mandatory `disclaimer` field on every response: *"Astryum AI provides informational context only. This is not investment advice under MiCA Article 3(1)(16)(8). Signals reflect deterministic computations over your portfolio data — they do not constitute a recommendation to buy, sell, or hold any crypto-asset."*

### Code references

- `backend/src/services/AICopilot.ts` — `getContextualSignals`, `MICA_DISCLAIMER` constant.
- `backend/src/routes/aiV1.ts` — `/contextual-signals` endpoint canonical; `/recommend-actions` kept as deprecated alias with HTTP `Deprecation: true` header.
- `backend/src/engines/strategy/StrategyEngine.ts` — `detectDefensiveSignals` canonical; `recommendDefensive` deprecated alias.
- `backend/src/mcp/astryum-mcp-server.ts` — MCP tool renamed `detect_defensive_signals`, description carries the same MiCA disclaimer.

---

## 7. Article 3(1)(16)(1) — Custody

Cleanest carve-out in the architecture. Astryum never holds user keys.

### Evidence

- No `WalletManager.signTransaction` exists (deleted 2026-06-01 along with the 100ms cron that signed+broadcast in a background queue).
- No Turnkey / MPC / Web3Auth / Magic / OAuth-key-derivation service is wired.
- The wallet partner layer (`useWalletPartner`, `useSolanaWalletPartner`, `useXrplWalletPartner`, `useAptosWalletPartner`) only DISPATCHES unsigned tx to the user's installed wallet — never sees private keys.
- The Prisma `Wallet` table stores `address`, `walletType`, `caip2`, `permissions` (which permissions the user granted Astryum to monitor, NOT signing authority), but NEVER private keys or seed phrases.

### Block G cross-ecosystem bundles do not change this

The two-step bundle (bridge + protocol action) requires the user to sign BOTH steps in their own wallets. Astryum's `BundleStatusWatcher` is a read-only poller against the bridge partner's public status endpoint. No custodial relationship is created.

---

## 8. Article 3(1)(16)(5) — Execution of orders

Comparable analysis to RTO. Astryum does not conclude agreements to buy/sell on behalf of clients. The user's wallet partner concludes the agreement when it broadcasts the signed tx.

---

## 9. Code-level enforcement map

A quick reference for legal counsel — every red line above maps to a concrete enforcement point in the repository.

| Red line | Enforcement point | File |
|---|---|---|
| No signing | Compile-time `_BROADCAST_FORBIDDEN` never type | `backend/src/control-plane/IntentPreparationEngine.ts:14-16` |
| No broadcast (FlareProvider) | Method removed, documentation note | `backend/src/services/FlareProvider.ts:286-296` |
| No broadcast (execution route) | HTTP 410 Gone with sunset header | `backend/src/routes/v1Execution.ts:62-92` |
| No background custody | WalletManager.ts file deleted | `backend/src/services/WalletManager.ts` (deleted) |
| Partner required for every intent | `partnerRegistry.resolveForOperation()` + throw `NO_REGULATED_PARTNER_FOR_OPERATION` | `backend/src/routes/intents.ts:V2-path`, `bundles.ts`, `swap.ts` |
| PolicyGuard P1-P38 incl. KYC | `policyGuard.evaluate()` real call (no hardcoded `passed:true`) | `backend/src/control-plane/CalldataBuilder.ts` |
| Fee gating per partner | `buildReferralAttribution(allowsReferralFee)` | `backend/src/control-plane/CalldataBuilder.ts:46-77` |
| No AI advice | `MICA_DISCLAIMER` mandatory on every response | `backend/src/services/AICopilot.ts` |
| Auth always real | `devAuthMiddleware` bifurcation removed | `backend/src/routes/execution.ts:18-21` |
| Bundle orphan-Step-1 impossible | `BundleBuilder.appendStep1` invariant + 3 defensive layers | `backend/src/services/walletRouting/BundleBuilder.ts:139-180` |

---

## 9-bis. Operator-owned transactions (the executor / keeper carve-out)

**Added 2026-07-13.** Boundaries #1 and #2 ("never signs / never broadcasts") govern **user
transactions** — anything that moves user capital under user authorization. Two backend services
sign and broadcast transactions **from Astryum's own operational accounts**, and are deliberately
OUTSIDE the user-transaction rails (neither touches `XRPLProvider`'s user paths, which still
throw `BROADCAST_FORBIDDEN`; neither ever holds a user key):

| Service | What it signs | Why it is not a CASP service |
|---|---|---|
| `DirectMintExecutorService` (Flare, `0xFE` rail) | Astryum's own Flare txs that dispatch a userOp the user ALREADY signed via Xaman. The contract enforces `keccak256(_data) == memo hash` — the executor has **zero discretion**: it executes the exact bytes the user committed, or the chain reverts. | No order is received or transmitted; the authorization is the user's on-ledger signature, and the outcome is fixed by the contract, identical whoever relays it. Gas is Astryum's. |
| `XrplEscrowKeeper` (XRPL) | Astryum's own `EscrowFinish` / `EscrowCancel` txs (from `XRPL_KEEPER_SEED`, an operational account). Both operations are **permissionless by ledger design**: once the escrow's time window opens, ANY account may send them, and the ledger fixes where the funds go (Finish → the escrow's Destination; Cancel → the escrow's creator). Escrows with a crypto-condition are never finished (the preimage never exists server-side). | There is no client order and no discretion — the keeper triggers an outcome the ledger has already fully determined, exactly as a third-party keeper (e.g. xrpl.services' Escrow Releaser) could. Fees are Astryum's; user funds never pass through the keeper account. |

Rule for future code: a service may sign/broadcast ONLY IF (a) the key is Astryum's own
operational or treasury key, (b) the transaction's effect on user capital is either nil or
fully pre-determined by an on-chain commitment/permissionless rule, and (c) the service is
feature-flagged and isolated from the prepare-only rails. Anything else falls back to
boundaries #1/#2 and does not ship.

Open question for counsel (add to §11): confirm that operating a permissionless keeper and a
zero-discretion executor does not constitute Article 3(1)(16)(5) execution of orders, given the
absence of any client order and of any discretion over outcome.

---

## 10. Jurisdiction

Primary anchor: **Andorra** (MiCA-equivalent regime via Andorran Digital Assets Act). Secondary readiness for **EU MiCA** if/when the architecture is positioned for an EU CASP licence on the on-ramp side only (Transak/MoonPay/Meld are already CASP-licensed in EU under MiCA).

The technology layer (Astryum itself) is intended to qualify as **infrastructure software**, not a regulated service. This document is the technical input to that legal positioning.

---

## 11. Open items for legal counsel

1. Formal opinion on whether the three-tier partner model + Block G bundle architecture suffices to position Astryum outside Article 3(1)(16)(7) RTO.
2. Whether the wallet-as-WALLET_PARTNER framing (the user's own wallet IS a registered partner) is sustainable across EU/Andorra interpretations.
3. Whether the AI Copilot `MICA_DISCLAIMER` + factual-only output suffices to stay outside Article 3(1)(16)(8) — or if the AI should be silent on specific assets entirely.
4. Whether the BundleStatusWatcher polling LI.FI/Squid/Across status endpoints constitutes "tracking" that crosses any custodial threshold (we believe it doesn't — polling is observation, not control).
5. Whether the AuditLog persisted via `RegulatedRelayBoundary` and `ExecutionEngine.submitByHash` could be argued as "operational tracking" — design intent was AUDIT only, but the code stores hashes for compliance traceability.
6. Whether Astryum's planned MoonPay Trade integration (TIER 1 value-add aggregator that happens to also be a CASP for on-ramp) creates regulatory entanglement on the protocol side.

---

## 12. Change control

Any code change that touches any of these red lines requires:
1. A PR description that names the boundary affected.
2. An update to the relevant section in this document IN THE SAME PR.
3. Sign-off from at least one of: founding team, external counsel, or compliance officer (once retained).

Failure to update this document while changing the relevant code is treated as a regression.
