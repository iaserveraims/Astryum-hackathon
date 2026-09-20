# DECISIONS.md — Astryum

> Locked architecture decisions, ADR-style. This file is **authoritative** where it conflicts
> with older internal working notes (historical context, not published in this repo).
> The hard rules these decisions must respect live in [INVARIANTS.md](INVARIANTS.md); the system
> shape they produce is in [ARCHITECTURE.md](ARCHITECTURE.md).

Status legend: **LOCKED** (decided, build to it) · **GATED** (decided, but blocked behind a flag
/ legal review / phase) · **OPEN** (not yet decided).

---

## ADR-001 — The base is Astryum's chain-agnostic core, not XRPL · LOCKED · 2026-06-20

**Context.** Earlier framing risked treating XRPL as the universal base. Routing all capital
through XRPL would mean bridging a user's Base USDC / Arbitrum ETH / Solana SOL into XRPL first —
more hops, more bridges, more code, more dependency. That is the opposite of "minimum
construction, partners do the work."

**Decision.** The unified base is **Astryum's core** (canonical intent, Capital Map, PolicyGuard,
orchestration, audit), built once and chain-agnostic. **Origins are multi by necessity**
(XRPL/Xaman, EVM/MetaMask, Solana/Phantom) because users hold capital in different places. XRPL
is the **flagship origin** — the XRP wedge — not the base.

**Consequences.** Coordinating existing multi-wallet capital **is** the differentiation (vs a
single Flare-centric wallet). The multi-wallet connection layer is real engineering, not trivial.
See [INVARIANTS.md](INVARIANTS.md) #7–#8.

---

## ADR-002 — Execution: observe wide, execute narrow, per ecosystem via the best partner · LOCKED · 2026-06-20

**Decision.** Observe (read-only) is **wide** — all chains, all assets (the Capital Map). Execute
is **narrow**, per ecosystem:

| Ecosystem | Execution path | Notes |
|---|---|---|
| **EVM** | **Enso** — one integration ≈ 26 EVM chains + Aave/Morpho/Spark/Pendle/Plume | **Enso does NOT support Flare.** MEV-protected swaps & conditional orders via CoW/ComposableCoW. |
| **Flare** | **Direct adapters**: SparkDEX, Kinetic, Firelight, Ēnosys, Sceptre | Entry via Flare Smart Accounts + FAssets (FXRP). |
| **XRP → EVM yield** | XRPL EVM Sidechain + Axelar + Enso/CoW | **Phase 1.5** — buildable today, sequenced after the direct flows. |
| **Solana** | Phantom → Jupiter | Later phase. |

**Code grounding.** `EnsoProvider` enumerates EVM chains and **excludes 14 (Flare)** by design;
Flare adapters live in `backend/src/connectors/protocols/adapters/` (one per protocol above).

**Consequences.** Never route EVM through XRPL ([INVARIANTS.md](INVARIANTS.md) #8). Deep yield is
on the EVM majors (Enso); Flare is the wedge/flagship, not where dev capacity over-concentrates.

---

## ADR-003 — Agentic & the custody line · LOCKED · 2026-06-20

**Decision.** "AI compiles, user signs once, trustless logic executes within signed bounds."

- **EVM agentic / conditional** = **ComposableCoW** (1 signature, permissionless WatchTower)
  and/or **ERC-4337 / EIP-7702 session keys with on-chain enforced bounds**.
- **Turnkey = embedded-wallet UX where the USER authorizes (passkey) ONLY.** Turnkey's
  **delegated-agent-signing** (off-chain policy) is the delegated-signing pattern → see ADR-005.
- **Reaffirmed:** Astryum constructs intent for the user to sign; it never executes, broadcasts,
  or custodies; the agent has **zero unilateral discretion**.

**Consequences.** [INVARIANTS.md](INVARIANTS.md) #2–#4. Triggers are deterministic, user-signed
intents; permissionless execution; never delegated keys to Astryum.

---

## ADR-004 — Embedded-wallet provider: Turnkey · LOCKED

**Context.** The embedded-wallet provider was previously OPEN (Turnkey / Privy / Crossmint /
Gelato). It is now decided.

**Decision.** **Turnkey**, used in **passkey-only** mode for user funds: a sub-organization whose
root authenticator is the user's own passkey; keys generated in Turnkey's TEE, **never** seen by
Astryum, **user-exportable**. Backend `TurnkeyWalletProvider` advertises `canSign: true`,
`canBroadcast: false`, `userControlledKeys: true`.

**Consequences.** Satisfies the sovereignty test ([INVARIANTS.md](INVARIANTS.md) #6). Turnkey's
delegated-signing mode is explicitly out of V1 (ADR-005).

---

## ADR-005 — Delegated / TEE-managed signing is V1.1, MiCA-gated · GATED

**Decision.** Two delegated-signing patterns are recognized and **deferred**:

1. **Turnkey delegated-agent-signing** (off-chain policy) — V1.1. If ever used, **compose with
   ERC-4337** so bounds are enforced **on-chain**, not just by off-chain policy.
2. **Flare PMW / FCC** (TEE-managed custody, delegated signing) — Q3 2026, **XRP/BTC only**.

Both require **MiCA legal review before production** and live behind their own flags.

**Consequences.** Build the **live Smart Accounts flow now**; keep any PMW/FCC adapter as a
**separate, isolated module** — do **not** couple it into core, and do **not** gate V1 on it.
PMW must not reach a user's own MetaMask/Phantom assets. (As of this writing, **no PMW/FCC code
exists** in the repo — only FTSO is implemented under `backend/src/flare/`; FAssets is marked
TODO. Keep it that way until the gated module lands.)

---

## ADR-006 — Competitive positioning: Luminite / SparkDEX · LOCKED

**Decision.** Luminite / SparkDEX are **Flare-centric wallet + DEX** products. Astryum
**integrates SparkDEX as an execution venue**; it does **not** compete as a wallet or a DEX.

**Consequences.** Do **not** build wallet/DEX features to rival them. User-facing copy and venue
routing treat SparkDEX as a venue, not a competitor. Differentiation = multi-wallet coordination
across ecosystems (ADR-001), not a better single-chain wallet.

---

## ADR-007 — Locked provider set · LOCKED

Decided providers (per the validated architecture + project memory). Each is a thin connector;
partners do the heavy lifting.

| Role | Provider(s) |
|---|---|
| EVM execution | **Enso** (Path A canonical) · SDKs where needed (Aave ✅ / Morpho / Spark) |
| Flare DeFi | direct adapters (SparkDEX · Kinetic · Firelight · Ēnosys · Sceptre) |
| Conditional EVM orders / MEV-protected swaps | **CoW / ComposableCoW** (permissionless WatchTower) |
| XRP origin + signing | Flare Smart Accounts + FAssets (FXRP) · **Xaman** · MCP Ripple |
| XRP→EVM bridge (Phase 1.5) | XRPL EVM Sidechain + **Axelar** |
| Embedded wallets | **Turnkey** (passkey-only for user funds — ADR-004) |
| Fiat on/off-ramp (CASP, MiCA) | **MoonPay + Transak** |
| KYC | **Sumsub** (superseded here by ADR-012; was «Crossmint / Persona») |
| Stablecoins | **Circle** (USDC/EURC) |
| Keepers | Gelato / Chainlink (⚠ Gelato double-role — do not concentrate) |
| Portfolio/data | CoinStats · DefiLlama · GoPlus (risk) · Tenderly (simulation) · Hypernative |

---

## ADR-008 — The multisig coordinator is the keystone; build the concrete council first · LOCKED (tax partner GATED) · 2026-07-15

**Context.** The 2026-07-14 mainnet rehearsal of a Legacy council (a 3/3 XRPL multisig) proved two
things. First, **no external tool composes and coordinates an XRPL council transaction** for us:
the Xaman Multisign xApp cannot build an `EscrowCreate`, rebuilds transactions from its own forms
(which would strip our SourceTag), and forces reserve-consuming Tickets — so we had to compose the
txjson, collect the quorum's signatures, and combine them ourselves
(`backend/src/scripts/legacy-multisign.ts`, proven on mainnet: tx `7184BA4B…438612`, SourceTag
intact, 3 signers). Second, that coordinator is not a Legacy detail — **it is the authority
primitive** the whole product stands on (PMW, MoneyFlows, every governance encoding sit on top of
whatever authority the user has). Astryum becomes **the interface that connects the ledger to the
user's wallet** — which is exactly the multi-wallet-coordination differentiation of ADR-001.

**Decision.** Build the multisig coordinator **in-product**, starting with the **concrete Legacy
council** — not a generic "secure account" abstraction. Generalizing before the concrete case is
live is abstracting over the void; the generic version is the *next* pass, after the council works
with real people inside it. "Different products by changing the interior encoding" is **pitch and
positioning, not N products to build** — build one deeply, show the generality.

**The four guardrails (each preserves an invariant; none is optional):**

1. **"Create from zero" is prepare-only and stays within the invariants.** Composing a
   `SignerListSet` (and every council tx) **unsigned** and handing it to the user's wallet is
   calldata composition for the user's **own** account — the core product, not a wallet. This
   revisits ADR-006's link-out (we stop sending users to xrpl.services for setup) **without** making
   us a wallet: we never hold a key, the user's wallet signs. **Hard constraint:** the master-key
   gate stays intact — never let anyone disable their master key before the signing rehearsal has
   passed on-chain, or the account bricks forever. The panel already gates "Door closed" on
   `rehearsalComplete`; that gate is load-bearing.

2. **Coordinate, never custody.** The "secure account" (a multisig whose signers include a physical
   / hardware key) passes invariant #12 ("if Astryum disappears tomorrow, the user recovers alone")
   **if and only if the keys are already the user's and Astryum never touches any of them. The
   moment "secure account" becomes "an Astryum wallet that holds something," it all falls.** It is
   the Capa-0 authority primitive, reusable by PMW and MoneyFlows later — a configuration we help
   compose and a signing we help drive, never a key we hold.

3. **The combined multisig blob is broadcast in the USER's browser**, by fetch to a public XRPL
   node. The server never touches the signed transaction. This is governed by boundary #2 (user
   transactions are never broadcast by us) — **not** the §9-bis executor carve-out, because there is
   no Astryum key involved. The prepare-only frontier stays intact; the browser pushing bytes to a
   node is the user submitting, exactly as xrpl.services would. `RegulatedRelayBoundary` still
   records only the authorization proof and stops. (There would be a defensible server-relay
   argument — the 0xFE logic is "identical whoever relays" — but we do not need it, so we do not
   open that front; see `MICA_BOUNDARIES.md` §11.)

4. **The tax engine stays RGPD-sovereign.** The backend produces the facts book **anonymous, indexed
   by address**; the identity map (address → person → residence) lives **client-side**; the join
   happens in the browser. A fiscal partner receives **only the package the user assembles and
   chooses to send** — never a server-side dump of personally-mapped data. **GATED:** whether
   producing the report + referral keeps Astryum non-CASP is a question for counsel
   (`MICA_BOUNDARIES.md` §11; fiscal design doc §7).

**Consequences.**
- The XRPL half of invariant #11 ("simulate before signing") gets built with the coordinator: XRPL
  mainnet's `simulate` RPC returns full metadata, and `xrpl.getBalanceChanges()` yields exact deltas
  before any signature — the preflight Tenderly gives EVM, now for XRPL, feeding the disclosure with
  ledger truth, not our estimate.
- Build order: concrete Legacy council coordinator (compose unsigned incl. `SignerListSet`, browser
  broadcast, master-key gate) → then generalize to the "secure account" authority primitive → PMW /
  MoneyFlows / other encodings on top.
- This supersedes the LegacyPanel's link-out-to-xApp hand-off for council accounts (kept only as a
  fallback), and the `Astryum_Legacy_Motor_Trazabilidad_Fiscal` §10 verdict that the tax engine
  "cannot be a hackathon deliverable" (based on a misread deadline).

---

## ADR-009 — The governed wallet: authority is the product primitive · LOCKED (PMW / cross-chain GATED) · 2026-07-15

**Context.** ADR-008 built the multisig coordinator as the authority primitive. This ADR names what
the product became once that keystone existed: Astryum is not a wallet — it is the **governance layer
placed on top of an account whose authority is a quorum**. A normal wallet has one key = one single
point of failure. A governed wallet replaces the key with a quorum: lose a key and you keep operating
(within quorum margin), a stolen key moves nothing, coercion of one signer is not enough. The keys can
be physical (Tangem/Ledger) — a quorum of cold keys Astryum coordinates and never touches. Introduces
no new scope; it makes explicit the product the internal operating summary already described and the pieces built this
week (`d0908b4`, `2f54fee`) already implement without having named it.

**Decision.** Treat authority-as-quorum as the Capa-0 primitive and build every capability on top of
it: protect (governed wallet), produce (Flare via the mint rail), program (governed MoneyFlows),
monitor (health verdict), and — gated on Flare infra — operate cross-chain (PMW). **Positioning: not
"a better wallet"** (that competes with MetaMask/Ledger on distribution) but **"capital governed by
rules no one can break"** — an empty category we create. Same tech, different market. One engine, two
encodings: individual (1 person, N keys) and patrimonial (Legacy council). Build the individual as a
generalization of Legacy **after** Legacy works with real people — not before (no abstracting over the
void). Positioning rule for all comms: **the door is wide, the safe is optional** — never force
multisig as an entry turnstile; the multisig is the destination of serious capital, not the toll to
look.

**Verified against code (2026-07-15) — every "already built" claim holds:**
- Capa-0 coordinator is genuinely **tx-type-agnostic** — `prepareCouncilMultisig` wraps ANY txjson and
  never inspects `TransactionType` (`XrplMultisigCoordinator.ts:73-109`). Reusable by every layer
  above. **Scope caveat:** this holds for the Capa-0 coordinator, **not** for the Capa-1 health
  verdict — the rehearsal gate is Legacy/EscrowCreate-specific (`XrplLegacyRehearsal.ts:180-189`); the
  individual encoding reuses the engine but needs its own health logic.
- `simulate` preflight is real (hits rippled `simulate`, extracts deltas): `XRPLProvider.ts:747-783`.
- Health verdict governs which actions are offered; RED blocks dangerous ones:
  `XrplLegacyRehearsal.ts:94-154`.
- Mint rail commits `keccak256(userOpData)` in the memo: `DirectMintExecutorService.ts:363,372`. Live
  on mainnet.
- MoneyFlow escalones (`level`, unique per flow) already in the canonical language:
  `CanonicalMoneyFlow.ts:109,217-220`.
- `SignerListSet` unsigned builder is **not built yet** (pending — the next pass after this).
- `LegacyVault` compiled, **not deployed** (no `contracts/broadcast/`, no `VAULT_ADDRESS`).

**Guardrails (all inherited, none new).** Prepare-only; coordinate never custody (ADR-008 #2);
non-CASP; invariant #12 (Astryum disappears → user recovers alone); SourceTag `2607090002` on every
XRPL tx. Governed MoneyFlows carry a **mandatory TTL (≤90 days) + two-channel revocation** (instant
individual pause = censorship-only; resuming needs quorum) or they become an autonomous agent with a
budget. **Fee note:** the coordinator computes Fee as `base × (1 + signerCount)` over ALL declared
signers, not the actual signing subset — a conservative overpay (never fails on fee), not the minimum
(`XrplMultisigCoordinator.ts:87-88`).

**Cross-chain (PMW) stays 🔴 NOT BUILDABLE — PMW has not launched.** The council can be a co-signer of
the TEE (the TEE does not sign without data providers AND co-signers), so the invariant survives — but
it is vision with a gate, never a present promise (this is what sank Torch). Full essay + roadmap:
an internal ADR-009 working note. **The same TTL + two-channel-revocation
guardrails extend to XLS-75 governed delegation when it lands (roadmap #8, gated on
`PermissionDelegationV1_1`): the council grants concrete, expiring, revocable permissions — it delegates
permissions, never capital (internal XLS-75 working note).**

---

## ADR-010 — Pure authority + PMW arms: the North Star · VISION WITH GATES (zero build) · 2026-07-17

**Thesis.** The XRPL multisig account stops owning capital and becomes **pure
authority** — the governor. All capital lives in PMW accounts, one per native chain (including one for
XRPL itself). Flow: quorum signs on XRPL → FDC proves it on Flare → the Flare contract (the executable
constitution) validates the order against its rules → PMW executes on the target chain. Capital never
travels; orders do. Answer to "why XRPL?": not because capital lives there — because it is the best
chain in the world to be the head.

**What it buys:** the cage becomes programmable — "principal never leaves" or "leaves with unanimous
quorum + 90-day timelock" is whatever the family writes cold. **The price:** the guarantee changes
nature from structural ("the exit function does not exist", ~700 auditable lines) to rule-based (the
whole validation logic must be audited; TEE dependency). **They are different products in guarantee —
so v1 (hard cage) and the PMW governor COEXIST; v1 is not the draft of the future, it is the product
with the guarantee the future can never give.**

**Gates (never lower them):** PMW launched+stable (voted for Songbird canary, pre-audit); each arm is
its own gate (launch = XRPL only per STP.13, BTC announced, EVM/Solana not even announced); TEEs
decentralized or risk declared (today: Flare Foundation on Google CC); the 5 questions to Flare
(UNSENT — critical here: what if a PMW account is lost = losing a whole arm); output compiler (payload
is EVM-pure, `IntentPayload.ts:7-14`); external audit. `AuthorityAccount.executors[]` (switcher
review, design-only) is the single data-model commitment already taken — PMW accounts and XLS-75
delegations both enter through it without redesign. **Torch line: always told as "where the
architecture goes, with these gates" — never as present.** Full essay + verification file:line:
an internal ADR-010 working note. **XLS-75 governed delegation
(delegates permissions, not capital; hard gate = `PermissionDelegationV1_1` live on mainnet — the V1
was disabled sep-2025 for a fee-drain bug) is specified in
an internal XLS-75 working note (roadmap piece #8, zero build).**

---

## ADR-012 — KYC provider: Sumsub, one verification for the whole fiat perimeter · LOCKED · 2026-08-15 (recorded 2026-08-16)

**Context.** The «Persona vs Sumsub» ADR had been pending since the provider lock (ADR-007
listed «Crossmint / Persona»). Meanwhile the KYC router was pruned from the codebase
(`e8f6f58`) — today nothing sets `kycVerified=true` and PolicyGuard P38 stays fail-closed —
so the choice could still be made cleanly, on facts.

**Decision.** **Sumsub**
is the KYC provider. The deciding fact is reuse across the WHOLE fiat perimeter with ONE
verification: **MoonPay (Shared KYC) and Transak (KYC Reliance) both read the same Sumsub
share token**, and the candidate self-custody card partner (**Gnosis Pay**) also runs on
Sumsub. One user verification serves on-ramp, off-ramp and card — no partner re-onboarding.

**Consequences.**
- Astryum never becomes the verifier of record: Sumsub verifies; partners rely; Astryum
  reads the outcome (prepare-only posture intact — same shape as «Sumsub emite, Xaman
  acepta, Astryum jamás» in the Credentials architecture, post-21-sep).
- P38 remains fail-closed until the Sumsub integration lands (commercial account first); no
  code path may fake `kycVerified`.
- RedotPay also runs Sumsub but is NOT a chosen partner (ADR-002 unchanged: MoonPay +
  Transak; card candidates = Gnosis Pay / Baanx, last-mile partners only).
- ADR-007's KYC row is superseded by this ADR.

---

## ADR-013 — Composition is a separate axis from autonomy: abstract the complexity, never the decision · LOCKED (build POST-21-sep) · 2026-09-13

**Context.** A product thesis was put on the table: the user
states a goal, an AI builds the strategy, and a constrained agent runs it across many venues —
with today's vaults demoted from destination to execution venue. It was
rejected *as a build for now*, for four reasons: it is slow to build and prove; it replaces
the whole DeFi interaction model at once; it removes personalisation and control from the user;
and with a handful of venues the "strategy engine" is artificial, while the AI would have to
know how to act on every class of DeFi product through a canonical language that is not built.
The conclusion was neither "build it" nor "go back to a normal DeFi site" — it was a middle
path.

**Decision.**

1. **Composition and autonomy are two different axes.** Composition is *who designs the
   allocation* (manual → composed → assisted → recommended); autonomy is *who fires and under
   whose authority* (the ROADMAP Phase 4 ladder, unchanged). **We climb composition without
   climbing autonomy.** Every rung of composition ends the same way: the user signs. This is
   what keeps a signed composition outside Art. 3(1)(25) portfolio management — a mandate with
   no residual discretion.
2. **The internal language becomes `Goal → Strategy → Policy → Container → Venues →
   Execution`.** Integrated vaults are **venues** — reusable infrastructure — not the product;
   the **pote** is the container; **policy** lives in the contract (per-venue cap, buffer floor,
   allowlist, ungateable exit) and in the credential (who may order); execution is always a
   user signature. We stop counting venues as product ("we have N vaults"); an integration earns
   its place by serving the composer and the future agent.
3. **The Strategy Composer is the demand surface of the CMF facade** already decided.
   It is built as one package — schema, translators, UI, copilot cage — and it works
   with two venues; it does not wait for breadth.
4. **Astryum compiles and explains; it never proposes "for you".** A personalised proposal is
   advice under Art. 3(1)(16)(h) and belongs to a **licensed occupant on the same rail** (an
   adviser or manager whose credential is verified on the ledger — tomorrow, their designated
   agent), never to Astryum. The composer we build for the user is the same desk that occupant
   would sit at; what changes is who sits there and which credential they carry.
5. **Rejected, explicitly, so they are not reopened:** an ERC-4626 *wrapper* between the pote
   and non-4626 venues — the pote already is the ERC-4626 container and the written direction is
   a new audited `VenueKind` branch per activity, not a second custody surface; "autonomous AI
   DeFi" as a build for now (until limits are enforced on-chain);
   and a general-purpose DeFi site (wallet + protocol list + swaps), already barred by ADR-006.

**Consequences.**
- **Phase 3's "Goals layer"** below now means *the composer*, not a marketplace of AI
  strategies. `GoalParserService` + the `GoalRequest`/`ManagerProposalV1` schema (built,
  migrated, pruned in `e8f6f58`) are the natural parser for it.
- CMF must grow an allocation vocabulary it does not have today: percent-of-portfolio, an
  at-entry trigger, parallel legs at entry, and a rebalance verb (`moveToVenue` exists on-chain,
  not in `CMF_VERBS`).
- The copilot cage gets a new code-enforced violation — an AI draft may not carry weights the
  user did not state, the same shape as the existing `ai_wrote_address` guard.
- Public copy is unchanged: *"A person decides. The code decides what they can't."* Agent-side
  phrasing stays in the future tense with its gates. "AI chooses the strategy", "the agent
  decides", "AI-powered DeFi" are barred.
- Zero code before 21-sep: the feature freeze and the shoot hold.

Full reasoning, code recon with file:line, the ERC-4626 verdict, the CASP boundary and the
ordered post-window queue: an internal working note (not published in this repo).

**Amendment — the queue order changes; the doctrine does not.** An inventory
against the contract, the deploy scripts and the live registry found that **no further venue can
enter a pote today without new Solidity**: only two are wired and live (Kinetic kind 1, Firelight
kind 2), and every other Flare protocol fails the shape, the chain or the asset gate. So the
bottleneck on the rail that serves managers is the contract, not the cost of integrating. With
the objective of attracting managers, **the Upshift branch moves from last in
the queue to the main block**, in parallel with the canonical layer — one audited branch reaches
two venues (earnXRP and Monarq), both FXRP on Flare. Everything else in this ADR stands: no
wrapper, one audited `VenueKind` branch per activity, the pote as container, and Astryum
compiling rather than proposing. Also recorded there: FBTC is **not** live on Flare mainnet, and
when it ships it is a **new pote** (a vault's asset is immutable at construction), not a venue
added to the FXRP ones. Sequence, scope limits and risks:
an internal working note (not published in this repo).

---

## ADR-014 — Production carries only what was tested; the gate is code, never an env var · LOCKED · 2026-09-14

**Context.** «Lend your RLUSD» went live on astryum.xyz without anyone publishing it. The
whole feature branch had been merged into `main` with
the two Ethereum-rail cards (`em-carry`, `em-lend`) inside, hidden behind a backend switch
(`ETH_RLUSD_FXRP_ENABLED`, fail-closed). The production backend had not built for days (its
deployments were SKIPPED), so the switch answered 404 and the cards stayed hidden. Railway
production already carried `ETH_RLUSD_FXRP_ENABLED=true`. At 11:36 a portfolio fix produced
the first deployment that actually built; the variable became effective and two untested vaults
went live. No decision was taken that day — three latent facts lined up.

**Decision.**
- **Production shows only what passed an end-to-end test on the preview.** Code being on `main`
  is not publication.
- **Visibility in production is decided in code, never by an environment variable.** Env vars
  are cloned between environments and take effect on the next deploy on their own. The vault
  allowlist lives in `frontend/src/lib/earn/productionVaults.ts`; publishing a vault means
  adding its `kind` there in a commit to `main` that states what was tested and when. Backend
  flags remain each rail's kill-switch, not its publication gate.
- **Defaults open outside production and close inside it** — `openOutsideProduction()` /
  `isProductionDeploy()` in `frontend/src/lib/nav/hackathonHub.ts` is the single rule. A
  `!== 'false'` default for anything visible is prohibited (it is how the hackathon hub
  switched itself on the day before).
- **Production env vars are never copied from staging.** Each one that enables something is set
  by hand, after the thing is on the allowlist, and named in the publishing commit.
- **No full merges of the branch into `main`.** `main` receives hand-picked subsets verified on
  the candidate (types, tests, build).

**Immediate remediation (same day).** `ETH_RLUSD_FXRP_ENABLED=false` in Railway production;
the allowlist applied before any runtime switch in `FlareDemoEarn`; tests pin the six tested
kinds and exclude the two Ethereum-rail ones.

---

## Phasing (from the validated plan)

- **Phase 0 (now):** Capital Map watch-only across all chains (no KYC on entry); PolicyGuard
  pilot; the **live** XRP→Flare flow (NLP → Xaman → FXRP → Smart Account → Flare DeFi). Code +
  docs = the grant demonstration.
- **Phase 1:** EU incorporation (MiCA); XRP wedge productized + **EVM execution via Enso**; fiat
  via MoonPay/Transak; KYC via partner; public EU launch.
- **Phase 1.5:** XRP→EVM route via XRPL EVM Sidechain + Axelar + Enso/CoW.
- **Phase 2:** Ride Flare Q3 2026 — **PMW + FCC as separate, MiCA-gated modules** (ADR-005).
- **Phase 3:** Goals layer (= **the Strategy Composer**, ADR-013 — not a marketplace of AI
  strategies) · delegated capital marketplace · Solana · more RWA (Plume) · tax-loss
  harvesting (calculate + propose, **user signs**, no fiscal advice).

---

*New decisions append here as ADRs. When one supersedes an older internal working note, say
so explicitly in the ADR rather than editing history.*
