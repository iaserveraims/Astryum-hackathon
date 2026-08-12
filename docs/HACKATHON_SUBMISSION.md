# Astryum — Flare Summer Signal 2026 · BUILD DETAILS

Single source of truth for the DoraHacks BUIDL. If the BUIDL page and this file disagree, this file
is wrong and should be corrected — never the other way around.

Deep technical companion: [FLARE_INTEGRATION.md](./FLARE_INTEGRATION.md) ·
Direction beyond the hackathon: [VISION.md](./VISION.md)

---

## Form fields

**Vision (max 256 chars — 250 used):**

> We put every DeFi position you hold across XRPL and Flare on one screen, open access to DeFi protocols, compose the hard transactions for you, guard against liquidation, and keep family patrimony in yield-bearing assets. Astryum never signs — you do.

**Bounty:** 1 — Interoperable Asset Products
**Categories:** DeFi · Wallet · Account Abstraction · Chain Abstraction · Infra / API
**Sub-categories:** Non-custodial control plane · Cross-chain yield coordination · Liquidation
protection · Inheritance & patrimony · Intent-based execution · FAssets / FXRP
**L1s:** Flare · XRP Ledger — **L2s:** none — **Appchains:** none
**Other open source ecosystems:** FAssets · FTSO · FDC · Flare Smart Accounts · Xaman · Kinetic ·
Firelight · Sceptre · SparkDEX · DefiLlama

---

# Astryum

**Non-custodial capital control for XRPFi — one interface that turns understanding into action, and
every action into a transaction you sign yourself.**

## The problem, the user, and why Flare — in fifteen seconds

**The user.** Someone holding XRP in Xaman who wants that capital to do something. There are
millions of them and almost nothing built for them.

**The problem.** For that person to earn on their XRP today, they must learn a second chain, install
a second wallet, acquire a gas token they do not own, trust a bridge, find a lending market, and
then notice a liquidation before it happens. Every tool that offers to remove that work asks for
custody in exchange. **Astryum removes the work without removing the keys.**

**Why Flare, specifically.** Because this product cannot exist anywhere else. FAssets is what turns
XRP into working collateral; the FDC is what turns an XRPL signature into a proof a contract can
act on; Smart Accounts are what let an XRPL user operate on Flare **without ever holding FLR**; FTSO
is what prices the risk. Remove any one of those four and there is no product left — not a degraded
one, none. The full counterfactual, primitive by primitive, is the next section.

|  |  |
|---|---|
| **Where it runs** | **Flare Mainnet (chain 14) + XRPL Mainnet**, with real capital. Testnet is refused by the code at boot. |
| **Bounty** | 1 — Interoperable Asset Products. FXRP is the working asset, not a demo asset. |
| **The one flow to watch** | XRP in Xaman → FXRP → collateral on Kinetic → monitored position → unwound back to XRP. One signature in, one signature out. Proven on mainnet with real funds. |
| **Proof** | Our own contracts deployed and verified on Flare mainnet, a family council that has executed real orders on-chain, and an FXRP round trip completed with real XRP. Addresses and verification commands below. |
| **The line** | Astryum never signs, never custodies, never executes. Every backend route is prepare-only. |
| **New work** | 682 commits inside the program window — 70% of the repository's entire history. |

## Why XRPL and Flare specifically

The honest test is the counterfactual — remove a primitive and see what stops working. Full version
with the strongest evidence for each, in [FLARE_INTEGRATION.md](./FLARE_INTEGRATION.md).

| Primitive | Verdict | If you removed it |
|---|---|---|
| **Smart Accounts** | `ESSENTIAL` | No XRPL-native product — every user would need FLR first |
| **FAssets / FXRP** direct minting | `ESSENTIAL` | Every entry dies; XRP never becomes working collateral |
| **FDC** — direct-mint rail | `ESSENTIAL` | The mint is never released |
| **FDC** — council bridge | `MEANINGFUL` | Astryum Legacy loses its whole governance model |
| **FTSO** — sizing, trigger price, alerts | `ESSENTIAL` | Leverage sizing and liquidation triggers break |
| **FCC / TEE** | absent | Nothing — we are not competing in that bounty and do not claim it |

**Nothing here is a superficial REST call.** The only HTTP requests in the entire Flare path go to
the FDC verifier and DA layer, which have no on-chain alternative — and they terminate in a Merkle
verification inside a contract we wrote and deployed.

Remove XRPL and the council disappears: the quorum, the master-key-off ceremony and the DID-anchored
constitution are XRPL primitives, and there is no cheaper place to turn "N people agreed" into a
fact a contract can verify. Neither chain is decoration.

## What Is Astryum?

Astryum is a control plane for on-chain capital, built for XRP holders and for the XRPFi ecosystem
forming around FAssets.

It reads your positions across XRPL and Flare, shows them on one screen, composes the transactions
those positions need, and hands them to your wallet unsigned. Every backend route is
**prepare-only**: it returns an unsigned payload plus a fee and price disclosure, and stops.

Instead of forcing a user across disconnected wallets, bridges, protocol front-ends, explorers and
spreadsheets, Astryum connects every step inside one continuous surface:

**See → Understand → Decide → Sign once → Verify → Unwind**

Two products sit on the same engine:

- **Astryum Personal** — one person, one account, capital that works.
- **Astryum Legacy** — a family council, capital that cannot be sold.

## The Problem We Solve

Blockchain ecosystems ship strong infrastructure and leave the user holding the integration work.

An XRP holder who wants to put capital to work faces:

- Positions scattered across chains with no single view
- A second chain to learn, a second wallet to install, a gas token they do not own
- Bridges with their own trust assumptions
- Protocol interfaces that assume you already know what a health factor is
- Liquidation risk that is visible only if you go looking for it
- Exit paths that are undocumented until you need one
- Inheritance that has no on-chain answer at all

Understanding the ecosystem is necessary. It is not sufficient. A user who has learned what FXRP is
still cannot act on that knowledge without a tool that composes the transaction for them — and most
tools that offer to do that ask for custody in exchange.

**Astryum removes the integration work without removing the keys.**

## Who It Serves — Both Ends of the Curve

Astryum is deliberately built for two users at once, because in XRPFi they are the same person at
different moments.

**The XRP holder who has never used DeFi.** Holds XRP in Xaman, knows what yield is, and has been
stopped by the fact that using it means learning a second chain, a second wallet and a bridge. They
get one screen instead of six, one signature instead of a bridge sequence, plain-language
disclosure of every fee before the QR appears, a security scan of the destination they did not have
to request, and an exit path shown at the same time as the entry.

**The experienced user who has lost the thread.** Positions across XRPL and Flare, spread over
wallets, with no single place showing what they own or what is at risk. They get unsigned calldata
they can inspect, contract addresses resolved live on-chain rather than copied from a document,
receipt tokens never conflated with execution contracts, health-factor and trigger-price math
computed rather than eyeballed, a preflight simulation of every call, and a public proof page that
reads state from the chain instead of from our database.

**The family with capital and no structure.** Wants inheritance that does not depend on a lawyer's
goodwill, a custodian's solvency, or an heir's discipline. Astryum Legacy makes the rules something
a contract enforces and a council governs.

Neither user gives up their keys. The beginner is protected by defaults; the expert is respected by
transparency. **In both cases the user's life in XRPFi gets measurably better, and in neither case
does Astryum become a counterparty.**

## How the Working Model Operates

An XRPL user who has never held FLR can act on Flare. The mechanism is **Flare Smart Accounts +
FAssets direct minting** (memo opcode `0xFE`):

1. Astryum encodes the batch of Flare calls the user asked for into `userOpData`.
2. It returns an **unsigned XRPL Payment** whose memo commits `keccak256(userOpData)`. The user
   signs that single Payment in Xaman.
3. Astryum's executor watches the FAssets Core Vault, requests an **FDC `XRPPayment` attestation**
   (type `0x08`) for the validated transaction, and calls
   `AssetManagerFXRP.executeDirectMintingWithData(proof, data)`.
4. The contract accepts **only** the exact bytes the memo committed — `keccak256(_data)`, sender and
   nonce all have to match. XRP becomes FXRP and the committed calls run inside the user's Personal
   Account, atomically.

The executor is a dispatcher, not an authority. It pays gas and the FDC attestation fee from
Astryum's own wallet, and has **zero discretion**: it either executes what the user signed, or the
transaction reverts. Its key is environment-only and never touches user funds.

## Astryum Personal — the flagship flow, end to end

**This is the one flow to follow if you only have time for one.** It is complete in both
directions, it has run on mainnet with real funds, and it is what the demo video shows.

**A:** the user holds XRP in Xaman and has never touched Flare.
**B:** the user holds a working, monitored Flare position and can unwind it back to XRP in their own
wallet.

1. **Connect.** Two doors only: Xaman for XRPL, MetaMask pinned to Flare (chain 14). Binding is
   read-only, by signature. Nothing moves.
2. **See.** The Capital Map puts balances and DeFi positions from both ecosystems on one screen,
   priced live from FTSO. Watch-only works with any r-address.
3. **Choose an entry.** The legs that are actually built:
   - **E1** — XRP → FXRP → supplied as collateral, USDT0 borrowed on Kinetic ISO. One Xaman
     signature.
   - **E3** — XRP → FXRP → yield-bearing vaults (Firelight stXRP / earnXRP, ERC-4626).
   - **E2** — FLR → WFLR → vote power delegated to an FTSO data provider. MetaMask, EVM direct.
4. **Disclose and simulate.** Before the QR appears: live mint fee, executor fee, price source, the
   borrow's disclosed exception, a KWYH/GoPlus scan of the target, and a preflight simulation of
   every call. Fees visible before signing is an invariant, not a setting.
5. **Sign once, in Xaman.** The intent shows as *To sign → In flight* and is tracked to settlement.
6. **Live.** The position appears with its health factor, and the risk math computes the **trigger
   price** — the FXRP/USD level at which it gets liquidated — plus the exact USDT0 repayment that
   restores a target health factor.
7. **Protect.** `A1` builds the unsigned `[approve, repayBorrowBehalf]` the user signs in MetaMask
   to lift the health factor. The shortfall is computed, not estimated.
8. **Exit, step by step.** Withdraw USDT0 → repay in full → withdraw FXRP collateral → unmint FXRP
   back to XRP at the user's own XRPL address. Proven end-to-end on mainnet with real funds:
   ~10 XRP returned in about two minutes.

Every step returns unsigned calldata. The user's key signs; Astryum's never does.

## Astryum Legacy — A to B

**A:** a family with capital and no structure.
**B:** an on-chain estate whose principal cannot be sold — not by the founder, not by Astryum, not
by a future heir — while its yield flows to named people under a constitution the family wrote.

Six gated steps:

1. **Account** — the family's XRPL account.
2. **Council** — a `SignerList` multisig. Astryum prepares the unsigned `SignerListSet`; the members
   sign.
3. **Rehearsal** — the council signs a real, harmless transaction. A quorum that cannot act in a
   rehearsal will not act in a crisis.
4. **Door closed** — `lsfDisableMaster` set, no RegularKey. From here, **a valid transaction from
   that account is proof of quorum.** Everything downstream rests on this.
5. **Constitution** — the family's text, SHA-256'd and anchored on XRPL via `DIDSet`. The hash
   becomes `constitutionRef`. No anchor, no cage: the text precedes the code.
6. **Capital** — the council signs **one** XRPL Payment whose memo commits a batch that creates the
   cage (`LegacyStackFactory.create`), approves, and deposits FXRP into a vault whose address is
   knowable before it exists (CREATE2). The factory verifies `msg.sender` is the council's own
   Personal Account — only a quorum can bring its own cage into the world. One Legacy, one cage.

That signature deliberately does **not** put the capital to work. Locking family capital away and
deciding where it works are two decisions, and they get two signatures.

### Governing it afterwards — "XRPL governs" made literal

```
Council signs a 1-drop XRPL Payment (memo = keccak256(orderData))
    ↓   master key off + no RegularKey  ⇒  a valid tx IS the quorum's proof
FDC providers attest the validated transaction (only the Merkle root lives on-chain)
    ↓
XrplCouncilBridge.execute(proof, orderData)   ← permissionless: the authority is the proof
    verify → proofOwner → council source hash → status → memo == keccak256(orderData)
           → txId not consumed → sequential nonce
    ↓
LegacyVault.<councilFunction>(...)            ← the cage decides what that call may do
```

The bridge holds no funds and has no owner with power. Double anti-replay: consumed transaction id
**and** a sequential nonce.

### What the code enforces — not the policy, the code

| Rule | Enforced by |
|---|---|
| Principal moves only vault ↔ approved venues, or to a successor vessel | the code — no `withdrawPrincipal()`, no `transferTo(arbitrary)`, no proxy |
| Only realized yield reaches people, after the lineage cut | the code (fuzzed invariant) |
| Adding a venue takes 30 days and is announced on-chain | the code |
| Rescue (`recall` / `moveToVenue` / `evacuate`) is immediate and uncapped | the code |
| Migration only to a successor with the same council and the same constitution | the code |
| Who is a payee, which venue gets approved, when direction is ceded | the council's quorum |

Every governance mutation must present the current `constitutionRef` and emits it, so parameters
stay chained to the version of the text they implement.

### Limits stated, not hidden

The FDC attests *transactions, not ledger state*: no contract can prove on-chain that the council
account is multisig-only. That is a **ceremony fact** — publicly auditable on XRPL, re-verified at
every rehearsal. And the stack is immutable: a deployed bug is not patched, it is migrated away
from, under a 30-day timelock with verified continuity. The product says both out loud, and the
cage's irreversibility sits behind an explicit four-checkbox acceptance enforced server-side, with
the accepted text hashed into the audit log.

## Bounty 1 — Interoperable Asset Products

FXRP is not a demonstration asset in Astryum. It is the working asset.

It is minted from real XRP through FAssets direct minting, supplied as collateral on Kinetic,
deposited into ERC-4626 vaults, locked inside an inheritance vessel a family council governs from
XRPL, and redeemed back to XRP at the user's own r-address. The interoperability *is* the product:
the user never leaves Xaman, never holds FLR, and never stops owning their keys.

Our contribution to the bounty is the **utility layer** for interoperable assets — the tooling that
makes an FAsset something you can hold, deploy, monitor, protect, inherit and unwind, with every
step composed for you and signed by you.

## What existed before the program, and what was built during it

We brought an existing project and we say so plainly.

**Before June 29:** the chain-agnostic core — canonical intent engine, policy guard, capital
aggregation, multi-wallet coordination, the prepare-only boundary. Read-heavy, EVM-and-XRPL
generic, with **no Flare execution path**.

**Built during Flare Summer Signal — 682 commits between June 29 and August 14, 70% of the
repository's entire history:**

- The whole `0xFE` rail: encoder, handoff store, and an automated executor with FDC attestation
  caching, a persisted daily fee budget, fuel checks, permanent-abort detection, and parking of
  operations that can never succeed
- Every Flare venue adapter that ships: Kinetic ISO (supply, borrow, repay, withdraw),
  Firelight / earnXRP ERC-4626 vaults, Sceptre, plus exit-queue accounting so capital sitting in a
  14-day unstake window is visible instead of invisible
- Liquidation protection: health-factor math, trigger price, derisk shortfall, and the unsigned
  repay leg
- The full FXRP round trip — mint proven, and **unmint back to XRP proven end-to-end on mainnet**
- All of Astryum Legacy: the vault, the XRPL council bridge, the factory, the six-step ceremony,
  constitution anchoring, the disclosure gate, and the governance surface
- Two mainnet contract deployments with verified sources, and a real council ceremony executed
  on-chain
- Production operations: a sentinel running 13 checks every five minutes that alerts only on state
  transitions, a public proof page reading contract state live, and an admin surface for every
  operational gauge
- Bilingual Spanish/English product surface, and a private beta with an approval gate

**Ported and improved:** the generic intent engine now emits Flare Smart Account userOps; the price
layer, previously vendor-fed, now reads FTSO on-chain and refuses to proceed on a stale price.

## Deployments and proof of operation

**Flare Mainnet — chain ID 14.** Mainnet is enforced by the code itself: the backend throws at boot
rather than start against a testnet (`backend/src/config/chainConfigs.ts`).

| Contract | Address | Creation transaction | Block |
|---|---|---|---|
| `LegacyStackFactory` | `0xF93A8A0bd93e95514fF02285349b0b1c1a5a3e0a` | `0x65b3cc8e888c5063edb9fe95204a9dc71fbe6af97f26226ff3ff35ae209acb23` | 66707923 |
| `LegacyVaultDeployer` | `0x2717A6Aa5162f8c5e5D7574F112eFC9438Cb66f6` | born inside the factory's constructor | 66707923 |
| `XrplCouncilBridge` | `0x02aE9FcB76768e42B8d3ED9fe842238A6616b26F` | `0xde33f4d1b2f26d3857c2f48c25ca4459f3707b5cd7fcd39b24e5b2328228da39` | 65664695 |
| `LegacyVault` | `0xc8379C79779cCe3B738424892709fE0d4339E3b1` | `0x5614c15ef49fa454f9af6eec2e522b05357243eb09cbad2ef38558d7cb7302c7` | 65664695 |
| `bind(vault)` — after this call the deployer holds no power | — | `0x98d0a892f685905353ee6e552c7c0062ffb4a629a921aae1d6ccf51d8471fea0` | 65664695 |

Sources verified on the explorer. No proxy, no upgrade path, every constructor parameter eternal.

**Verify it live, in thirty seconds, trusting nobody:**

```bash
RPC=https://flare-api.flare.network/ext/C/rpc
cast call 0xF93A8A0bd93e95514fF02285349b0b1c1a5a3e0a "DEPLOYER()(address)"  --rpc-url $RPC
cast call 0xF93A8A0bd93e95514fF02285349b0b1c1a5a3e0a "SOURCE_ID()(bytes32)" --rpc-url $RPC
```

The second call returns `0x5852500000…` — ASCII **`XRP`**. That immutable value is the proof this is
the mainnet factory: a testnet factory would read `testXRP` and would produce bridges incapable of
verifying a single real proof. It cannot be changed, and every bridge born from this factory
inherits it.

**Live application state** — contract addresses and settled-operation counters read from the chain,
not from a database: **https://astryum.xyz/proof**

**XRPL Mainnet** — councils, constitutions anchored via `DIDSet`, and all user signing through
Xaman. Aggregate proof of operation is published on the proof page; per-transaction ledger
references identify our own accounts and are available to judges on request rather than published.

**Coston2** is used for contract iteration only. Nothing that touches a family's capital ships from
a testnet rehearsal alone.

## Testing and Validation

Astryum was validated with real capital on mainnet, not only in a development environment.

- **21 settled operations** in the public counter — real transactions with real value, not a
  scripted demo
- **4 Legacy council orders executed on-chain** through the FDC circuit
- A real council ceremony run end-to-end on mainnet: quorum signature → FDC attestation → bridge →
  vault call completed
- FXRP mint and unmint both proven end-to-end with real XRP
- **58 Foundry tests** on the contracts — 22 vault, 18 bridge, 15 factory, 3 fuzzed invariants
- **83 tests** across the Flare connectors and adapters
- Private beta with invited users behind an approval gate
- Founder capital only, in small amounts, until an external audit — a stated policy, not a
  discovered limitation

We deployed to mainnet knowing what it costs: every write through the FDC rail carries an
attestation fee, and an early bug burned real FLR retrying operations that could never succeed. The
fix — a pre-payment guard, attestation caching, a persisted daily budget and permanent-abort
parking — is in the repository, and the reason it exists is in the commit history. That is what
running in production looks like.

## Verify every claim

We would rather be checked than believed. Each claim in this document has something you can open.

| Claim | How to check it, without asking us |
|---|---|
| The contracts are ours, deployed and verified | Addresses and creation transactions in the table above; sources verified on the explorer |
| This is mainnet, not a testnet dressed up | `cast call … "SOURCE_ID()(bytes32)"` returns ASCII `XRP`. It is `immutable`, and every bridge born from the factory inherits it |
| The bridge really verifies FDC proofs | `XrplCouncilBridge.sol:140-141` resolves `FdcVerification` from the Flare Contract Registry on every call. 18 tests, one per guard |
| Only an XRPL quorum can create its own vault | `LegacyStackFactory.sol:229-231` reverts unless `msg.sender` is the council's own Personal Account, resolved from `MasterAccountController` |
| The cage cannot release principal | Read `LegacyVault` on the explorer: there is no `withdrawPrincipal()`, no `transferTo(arbitrary)`, no proxy |
| The vault's rules match the family's text | Read `constitutionRef()` and `feeSchedule()` on-chain and compare them with the anchored constitution |
| Astryum does not sign for users | Every `/prepare` route returns unsigned payloads; `assertNoCustodialKeys()` refuses to boot if a user key is present in the environment |
| Operations really settled | Live counters on https://astryum.xyz/proof, read from the chain rather than from our database |
| The tests exist and pass | `cd contracts && forge test` → 58 |
| The work was done in the program window | `git log --since=2026-06-29 --until=2026-08-15 --oneline \| wc -l` → 682 of 976 total |

## What is real, what is trusted, and what is not finished

The most useful thing we can give a judge is an honest map of our own maturity.

**Real — exercised on mainnet with real value:**

- The `0xFE` rail end to end: XRP → FXRP → position on Flare. Our executor has signed 274
  transactions on Flare across the program.
- FXRP redemption back to XRP at the user's own r-address.
- The council circuit in full: quorum signature → FDC attestation → bridge → vault call. Four
  orders executed on-chain, in both a synchronous ceremony and an asynchronous signing tray.
- 21 settled operations in the public counter.

**Built and tested, but not yet exercised on mainnet.** Of the constructors that have a live surface
in the app, 14 have run with real money and 20 have not. Each `0xFE` operation costs real XRP plus
an FDC attestation fee, with a hard ceiling of roughly four per day across the whole system, so
exercising everything is a question of budget and calendar rather than readiness. The ones that have
not run are not disguised: the product does not paint a green check it has not earned, and
settlement state is machine-gated against on-chain confirmation.

**Trusted rather than enforced — the three dependencies we cannot code away, stated plainly:**

1. **That a council's XRPL account is genuinely multisig-only.** The FDC attests transactions, not
   ledger state, so no contract can prove it. It is publicly auditable on XRPL and re-verified at
   every rehearsal — but it is a ceremony fact, not a code fact.
2. **The FDC's attestation providers.** We verify the Merkle proof; we do not verify the providers.
3. **Our executor being alive.** It cannot steal, redirect or alter anything — the contract accepts
   only the exact bytes the user signed — but if it stops, a signed operation waits instead of
   completing. That is a liveness dependency, not a custody one, and removing it is on the roadmap.

**Not finished:**

- The contracts are **unaudited**. External review before any third-party capital is a stated
  policy, and it is the first item on the roadmap.
- Principal can leave the cage only by migrating to a successor vessel. The governed release path is
  designed, not built.
- Six tests are red across three suites, two of them because they make real network calls. Known
  since before the program window, documented rather than quietly skipped.
- The application is in **private beta** behind an approval gate.

**Nothing here is mocked.** Figures in the product come from on-chain reads or from a protocol's own
API with the source named; when a value cannot be fetched, the product says so instead of
substituting an estimate.

## How Astryum Helps Flare

- Turns FXRP from a bridged token into working capital with a visible round trip
- Brings XRPL users onto Flare **without requiring them to acquire FLR**
- Exercises FAssets, FDC, Smart Accounts and FTSO together in one production flow
- Sends better-informed users to Flare protocols — Kinetic, Firelight, Sceptre — with the risk
  already disclosed
- Demonstrates that FDC can carry **governance**, not only price and payment data
- Makes exit paths and exit queues legible, which raises trust in the whole ecosystem
- Serves the Spanish-speaking market in its own language
- Proves a non-custodial architecture that a regulated European entity can operate

## Where FLEC Hub Fits — Same Funnel, Opposite End

FLEC Hub, also submitted to this hackathon, takes a Spanish-speaking newcomer from zero to
*understanding* an interoperable asset: learn what FAssets and FXRP are, prepare a wallet safely,
obtain test FXRP, use it inside a real application, verify the result on-chain.

Astryum begins where that journey ends — and also serves the user who never took it.

FLEC Hub's evidence is that the barrier to FAssets adoption is comprehension, not capital.
Astryum's evidence is that comprehension alone does not move capital: the tooling on the other side
has to be worth arriving at, and it has to work for people who arrive without the lesson.

**Education without a destination is a lesson. A destination without education is an empty
product.** Flare needs both, and the handoff is a concrete, buildable path: *learn on Coston2 → act
on mainnet.* Two independent teams, from opposite ends of the same funnel, arrived at the same
conclusion about what XRPFi is missing.

## Business Model

Astryum has **no token**. Revenue is a disclosed service fee, never float, never spread on custody.

- **Execution fee**, shown before the user signs. Fee disclosure is an invariant of the codebase,
  not a setting.
- **Executor run at cost** — the fee covers the FDC attestation and gas, priced live from FTSO.
- **Protocol fee hook in Astryum Legacy** — capped at 10% of realized yield by the constructor,
  default 0, and eternal once deployed. The family's own lineage cut (10–40%, chosen by the quorum)
  always comes first.
- **Partner revenue** from venues and fiat on-ramps, disclosed at the point of use.
- **B2B potential**: the same prepare-only control plane serves family offices, wealth advisers and
  protocols that need a non-custodial front end they do not have to build.

Astryum's own revenue is the only money Astryum ever signs for. User funds are never in that path.

## Roadmap

Direction, not dates. Full version in [VISION.md](./VISION.md).

1. **External audit of the Legacy contracts** before any third-party capital enters —
   non-negotiable, already stated in the repository
2. **The release vessel** — a governed path for principal to leave the cage under conditions the
   constitution defines. Today principal can only migrate to a successor; that is deliberate, and
   it is not yet complete as a product
3. **Watch-only by r-address**, so anyone can see their capital before trusting anything with a
   signature
4. **More FAssets and more venues** as they reach mainnet, each gated behind its own risk scanner
5. **Conditional orders with no delegated keys** — deterministic intents the user signs once,
   executed permissionlessly, with limits enforced on-chain. The agent compiles; the user signs;
   trustless logic executes inside signed bounds
6. **Portable credentials on XRPL** for verifiable eligibility without Astryum ever holding personal
   data
7. **Spanish-first onboarding partnerships**, including the FLEC Hub handoff

## Stack

TypeScript / Node (Express) backend · Next.js frontend · Solidity 0.8.24 + Foundry · Prisma /
Postgres · xrpl.js · ethers v6 · Xaman for XRPL signing, MetaMask for EVM. Every DeFi surface sits
behind a feature flag and a per-jurisdiction geofence.

## Demo and Project Links

- **Live application:** https://astryum.xyz
- **Public proof page:** https://astryum.xyz/proof — contract addresses and settled-operation
  counters, read live from the chain
- **Demo video:** *[pending]*
- **Repository:** *[pending]*
- **X:** https://x.com/Astryum_
- **Judge access:** *[pending — the app is in private beta behind an approval gate; a pre-approved
  account or an open-gate window must be stated here or judges cannot get in]*

## Safety Notice

Astryum operates on **mainnet with real assets**. It never requests a seed phrase or a private key,
never holds user funds, and never signs on a user's behalf. Every transaction is signed by the user
in their own wallet.

Yield figures are presented as **protocol data with a named source**, never as an offer, a promise
or a guarantee by Astryum.

The Legacy contracts are **immutable and unaudited**. A deployed bug is not patched — it is migrated
away from, under a 30-day timelock with verified continuity. Until an external audit, only founder
capital in small amounts is in scope, and the cage's irreversibility must be explicitly accepted
before any principal enters, with the accepted text hashed into an audit log.

DeFi carries risk of loss, including total loss. Astryum reduces the risk of *operating* — mistakes,
blind spots, missed liquidations — not the risk of the underlying markets or protocols.
