# Astryum — Build details

**Non-custodial capital control for XRPFi — one interface that turns understanding into action, and every action into a transaction you sign yourself.**

**Bounty 1 — Interoperable Asset Products.** Companion docs in the repo: `FLARE_INTEGRATION.md`, `VISION.md`, `regulatory/MICA_BOUNDARIES.md`.

## The problem, the user, and why Flare

**The user.** Someone holding XRP in Xaman who wants that capital to do something. There are millions of them and almost nothing built for them.

**The problem.** For that person to earn on their XRP today, they must learn a second chain, install a second wallet, acquire a gas token they do not own, trust a bridge, find a lending market, judge for themselves whether it is safe, sign approvals they cannot read, and then notice a liquidation before it happens. Tools exist for parts of it: non-custodial dashboards show the picture but stop short of acting, and the products that remove the most work — exchanges — do it by taking the keys. Nobody removes the whole burden, security included, while leaving the user in control. **That is the gap Astryum fills.**

**Why Flare, specifically.** Because this product cannot exist anywhere else. FAssets is what turns XRP into working collateral; the FDC is what turns an XRPL signature into a proof a contract can act on; Smart Accounts are what let an XRPL user operate on Flare **without ever holding FLR**; FTSO is what prices the risk. Remove any one of those four and there is no product left — not a degraded one, none.

## What Astryum solves, and how we approached this BUIDL

**What Astryum solves.** One place where a person has everything they need to control on-chain capital — not a wallet, not a dashboard, but the layer above both that does the work: earn markets inside the app, strategies signed once that execute only within signed bounds, and family wealth held under rules a contract enforces. Capital management at a level normally reserved for private banking, available to anyone with a wallet, without ever asking for their keys.

**Where this came from.** Astryum began as a tool we built for ourselves — one screen to see our own capital and a way to act on it without six tabs open. It became a product when it was obvious that the gap we were closing for ourselves is the same one in front of millions of XRP holders. That origin is why it is opinionated about the things that actually annoy a user.

**Why we submitted this kind of BUIDL.** This hackathon was not on our roadmap. We were already building, already deployed on mainnet. We entered because **Bounty 1 is precisely our ground** — FXRP as an interoperable asset a person can hold, deploy, protect, inherit and unwind. Had the bounty been anything else, we would not be here. And where most entries are a broad demonstration of one layer, we did the opposite: a narrow vertical slice cutting through **every** layer — wallet, capital view, entry, risk, exit and family governance — thin but complete, with no placeholder in the path.

**On dogfooding, precisely.** Our own capital runs through the rail, in small amounts, and we are deliberately not scaling that up yet. Two reasons, both honest. The contracts are unaudited, so we cap our own exposure exactly as we would ask anyone else to. And while the product is being judged partly on traction, putting our full balance to work would inflate the very counters we are asking you to read. **The numbers on our proof page are small because they are real, not because the product cannot do more.**

**The path we are taking.** Two things earn traction, sequenced deliberately. First, arrival: interface and onboarding have to be one motion — a user who must understand the system before seeing their own money has already left. Second, action in one place: moving capital has to be simple, and every tool they need has to be there.

**Where this goes.** Abstraction without amputation. Most products that hide DeFi's complexity also take away its power — a simple screen, and no way left to automate or compose. We want the complexity gone and the capability intact: the first capital control plane operable with a single XRPL wallet. Personal and Legacy are the same wallet and the same interface — what changes is not the technology but the **governance**: one person deciding, or a family quorum deciding.

**Principles.** *Free to see, paid to act.* We do not charge users to view, aggregate or monitor their capital — sight of your own money should never sit behind a paywall. Astryum earns two ways, both disclosed: a fee when it **composes** a transaction, on screen before anything is signed; and a share of the fees that volume generates at the venues users reach through us. **We are paid for volume, never for placement** — no protocol can buy a position or a ranking, because we do not rank and we do not recommend: we show protocol data with its source named, and the user decides. *Custody is a design failure, not a feature* — every convenience that seems to require it has a non-custodial construction available to anyone willing to build it. It is harder. It is the point.

|  |  |
|---|---|
| **Where it runs** | **Flare Mainnet (chain 14) + XRPL Mainnet**, with real capital. Testnet is refused by the code at boot. |
| **The one flow to watch** | XRP in Xaman → FXRP → collateral on Kinetic → monitored position → unwound back to XRP. One signature in, one signature out. Proven on mainnet. |
| **The line** | Astryum never signs, never custodies, never executes. Every backend route is prepare-only. |
| **New work** | 682 commits inside the program window — 70% of the repository's entire history. |

## Who it serves — both ends of the curve

- **The XRP holder who has never used DeFi.** One screen instead of six, one signature instead of a bridge sequence, every fee disclosed before the QR appears, and the exit shown at the same time as the entry.
- **The experienced user who has lost the thread.** Unsigned calldata they can inspect, addresses resolved live on-chain, risk math computed rather than eyeballed, and a proof page that reads from the chain, not our database.
- **The family with capital and no structure.** Inheritance that does not depend on a lawyer's goodwill, a custodian's solvency or an heir's discipline — Astryum Legacy, below.

The beginner is protected by defaults; the expert is respected by transparency. **Astryum never becomes a counterparty.**

## Why XRPL and Flare specifically

The honest test is the counterfactual — remove a primitive and see what stops working. Full version in [FLARE_INTEGRATION.md](./FLARE_INTEGRATION.md).

| Primitive | Verdict | If you removed it |
|---|---|---|
| **Smart Accounts** | `ESSENTIAL` | No XRPL-native product — every user would need FLR first |
| **FAssets / FXRP** direct minting | `ESSENTIAL` | Every entry dies; XRP never becomes working collateral |
| **FDC** — an XRPL signature becoming an action on Flare | `ESSENTIAL` | There is no product. Every signature in Astryum, Personal or Legacy, is made on XRPL; the attestation is what proves it happened and what carries the order it committed to. Without it nothing crosses — no mint, no position, no governance |
| **FTSO** — sizing, trigger price, alerts | `ESSENTIAL` | Leverage sizing and liquidation triggers break |
| **FCC / TEE** | absent | Nothing — we are not competing in that bounty and do not claim it |

**One primitive, two rails.** The same attestation type (`XRPPayment`, `0x08`) carries a user's mint on the Personal side and a council's order on the Legacy side, through different contracts and different relayers. And none of it is a superficial REST call: the only HTTP requests in the whole Flare path go to the FDC verifier and DA layer, which have no on-chain alternative, and they end in a Merkle verification inside a contract we wrote and deployed.

Remove XRPL and the council disappears too: the quorum, the master-key-off ceremony and the DID-anchored constitution are XRPL primitives, and there is no cheaper place to turn "N people agreed" into a fact a contract can verify.

## How the working model operates

An XRPL user who has never held FLR can act on Flare. The mechanism is **Flare Smart Accounts + FAssets direct minting** (memo opcode `0xFE`):

1. Astryum encodes the batch of Flare calls the user asked for into `userOpData`.
2. It returns an **unsigned XRPL Payment** whose memo commits `keccak256(userOpData)`. The user signs that single Payment in Xaman.
3. Astryum's executor watches the FAssets Core Vault, requests an **FDC `XRPPayment` attestation** (type `0x08`), and calls `AssetManagerFXRP.executeDirectMintingWithData(proof, data)`.
4. The contract accepts **only** the exact bytes the memo committed — hash, sender and nonce all have to match. XRP becomes FXRP and the committed calls run inside the user's Personal Account, atomically.

The executor is a dispatcher, not an authority — the piece that does the most and decides the least. It pays gas and the attestation fee from Astryum's own wallet, keeps itself funded by swapping its disclosed fee through one allowlisted venue on fixed parameters, and has **zero discretion**: it either executes the exact bytes the user signed, or the transaction reverts. Its key is environment-only and never touches user funds. Full anatomy in `FLARE_INTEGRATION.md`.

## The assistant layer — the AI compiles, the user signs

Astryum has five conversational surfaces, and none of them can move money. That is not a policy we promise; it is how they are built.

- **Product assistant** — a conversational manual and GPS of the app for people new to crypto. Public, no login, explains concepts and navigation. **It has no tools**, so it structurally cannot build a payload.
- **Legacy discovery assistant** — helps a non-expert work out which inheritance setup fits what they want to protect. Public and stateless; the family's real names and constitution text never leave the browser.
- **Portfolio assistant** — answers questions about the user's own data: positions, rules, tax events, capital summary. Forbidden by its own system contract from giving investment advice, naming a "best" protocol, or claiming it can execute anything.
- **Strategy assistant** — turns natural language into strategy parameters. The model interprets intent; it does **not** compute the numbers — those come from tested, deterministic risk math with live rates — and it never builds or signs the payload.
- **Agent workspace** — conversations, documents and rules, with MCP connectors.

The rule across all of them: **the AI compiles, the user signs, deterministic logic executes.** The agent has zero unilateral discretion, and the public assistants are given no tools at all, so the constraint is enforced by construction rather than by prompt.

## Astryum Personal — the flagship flow, end to end

**This is the one flow to follow if you only have time for one.** It is complete in both directions, it has run on mainnet with real funds, and it is what the demo video shows.

**A:** XRP in Xaman, never having touched Flare. **B:** a working, monitored Flare position that can be unwound back to XRP in the user's own wallet.

1. **Connect.** Two doors only: Xaman for XRPL, MetaMask pinned to Flare (chain 14). Binding is read-only, by signature. Nothing moves.
2. **See.** The Capital Map puts balances and DeFi positions from both ecosystems on one screen, priced live from FTSO. Watch-only works with any r-address.
3. **Choose an entry.** The legs that are actually built: **E1** — XRP → FXRP → supplied as collateral, USDT0 borrowed on Kinetic ISO, one Xaman signature · **E3** — XRP → FXRP → yield-bearing ERC-4626 vaults (Firelight stXRP / earnXRP) · **E2** — FLR → WFLR → vote power delegated to an FTSO data provider, EVM direct.
4. **Disclose and simulate.** Before the QR appears: live mint fee, executor fee, price source, and a preflight simulation of every call. Fees visible before signing is an invariant, not a setting.
5. **Sign once, in Xaman.** The intent shows as *To sign → In flight* and is tracked to settlement.
6. **Live.** The position appears with its health factor, and the risk math computes the **trigger price** — the FXRP/USD level at which it gets liquidated — plus the exact repayment that restores a target health factor.
7. **Protect.** `A1` builds the unsigned `[approve, repayBorrowBehalf]` the user signs to lift the health factor. The shortfall is computed, not estimated.
8. **Exit, step by step.** Withdraw USDT0 → repay in full → withdraw FXRP collateral → unmint FXRP back to XRP at the user's own XRPL address. Proven on mainnet with real funds: ~10 XRP returned in about two minutes.

Every step returns unsigned calldata. The user's key signs; ours never does.

### Proof of the rail — one operation, two chains

A single real operation, published live on our proof page and verifiable on both ledgers:

| | |
|---|---|
| **XRPL Payment the user signed** | `B196DA6ED1C575DB3311A8F8268F8D50A174E372A635BFB7830C1A3FE95F470F` |
| **Its memo** | `FE00000000000003 0D40 C49FA9F1…A529` — opcode `FE`, then the `keccak256` of the exact Flare calls |
| **The Flare transaction that executed it** | `0xa03bed993626b924c18f0267f54d5d91d53637ae7b12bccfadbe1fc299d13ac5` |
| **Executor that delivered the proof** | `0xD8767C3C4dC0A1E13F23368B172a5ff78B54CecE` |

Open the XRPL transaction, read the memo, hash the `userOpData` we publish, confirm it matches — then open the Flare transaction and watch those exact bytes execute. **That is the entire trust model in two clicks:** the user's signature commits the bytes, and nothing else can ever run.

## Astryum Legacy — A to B

**A:** a family with capital and no structure.
**B:** an on-chain estate whose principal cannot be sold — not by the founder, not by Astryum, not by a future heir — while its yield flows to named people under a constitution the family wrote.

Six gated steps:

1. **Account** — the family's XRPL account.
2. **Council** — a `SignerList` multisig. Astryum prepares the unsigned `SignerListSet`; the members sign.
3. **Rehearsal** — the council signs a real, harmless transaction. A quorum that cannot act in a rehearsal will not act in a crisis.
4. **Door closed** — `lsfDisableMaster` set, no RegularKey. From here, **a valid transaction from that account is proof of quorum.** Everything downstream rests on this.
5. **Constitution** — the family's text, SHA-256'd and anchored on XRPL via `DIDSet`, becoming `constitutionRef`. No anchor, no cage: the text precedes the code.
6. **Capital** — the council signs **one** XRPL Payment whose memo commits a batch that creates the cage (`LegacyStackFactory.create`), approves, and deposits FXRP into a vault whose address is knowable before it exists (CREATE2). The factory verifies `msg.sender` is the council's own Personal Account — only a quorum can create its own cage.

That signature deliberately does **not** put the capital to work. Locking family capital away and deciding where it works are two decisions, and they get two signatures.

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

The bridge holds no funds and has no owner with power. Double anti-replay: consumed transaction id **and** a sequential nonce.

### What the code enforces — not the policy, the code

| Rule | Enforced by |
|---|---|
| Principal moves only vault ↔ approved venues, or to a successor vessel | the code — no `withdrawPrincipal()`, no `transferTo(arbitrary)`, no proxy |
| Only realized yield reaches people, after the lineage cut | the code (fuzzed invariant) |
| Adding a venue takes 30 days and is announced on-chain | the code |
| Rescue (`recall` / `moveToVenue` / `evacuate`) is immediate and uncapped | the code |
| Migration only to a successor with the same council and the same constitution | the code |
| Who is a payee, which venue gets approved, when direction is ceded | the council's quorum |

Every governance mutation must present the current `constitutionRef` and emits it, so parameters stay chained to the version of the text they implement.

### Proof of the council circuit

| | |
|---|---|
| **Council anchor (XRPL)** | `rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm` |
| **Constitution hash on-chain** | `0x7884821f6b8c52495ba5fa8a0970550b1964a33c6e7b7564428bc860e40efc36` |
| **Orders executed through the FDC circuit** | **4** |
| **A real order — the quorum's XRPL signature** | `720C2D1D8EC2DC79B413F8FF28E6B3F3662F84B09AC47FC2AAE73A9206B898D4` |
| **The same order executing on Flare** | `0x241c4efd4f97b026f32167ad0989bb1223ca0f917df3d1ec139295356ab38e1b` |

## A regulatory architecture, chosen on purpose

Astryum's architecture was designed to stay outside the CASP perimeter under MiCA — not discovered to be outside it afterwards. Prepare-only is the reason: the system composes unsigned payloads and stops, so custody (Art. 3(1)(16)(1)) and execution of orders on behalf of clients (Art. 3(1)(16)(5)) never arise, because Astryum never holds a user asset and never transmits a signed order. The assistants return factual, deterministic context with a mandatory disclaimer, keeping them clear of investment advice (Art. 3(1)(16)(8)). The only place a regulated CASP touches user capital is the fiat on-ramp, where a licensed third party runs its own flow.

Those boundaries are written down as red lines in the repository, mapped article by article, and code that changes one must update that document in the same pull request. It is not a disclaimer bolted on at the end — it is a constraint the codebase is built against.

## Bounty 1 — Interoperable Asset Products

FXRP is not a demonstration asset in Astryum. It is the working asset: minted from real XRP through FAssets direct minting, supplied as collateral on Kinetic, deposited into ERC-4626 vaults, locked inside an inheritance vessel a family council governs from XRPL, and redeemed back to XRP at the user's own r-address. The interoperability *is* the product — the user never leaves Xaman, never holds FLR, and never stops owning their keys.

Our contribution is the **utility layer** for interoperable assets.

## What existed before the program, and what was built during it

We brought an existing project and we say so plainly.

**Before June 29.** The chain-agnostic core — intent engine, policy guard, capital aggregation, multi-wallet coordination, the prepare-only boundary — plus a first Flare layer we had built and then parked: WFLR wrapping, FTSO delegation and reward claiming, the Sceptre adapter, and the connector path they ran through. What did not exist was the part that mattered: no FAssets, no Smart Accounts, no FDC — and so no way for an XRP holder to act on Flare at all.

**What the program changed** was not that we started building on Flare, but that FAssets, the FDC and Smart Accounts turned out to be exactly the tools Astryum needed. That is when the parked work became a product.

**Built during Flare Summer Signal — 682 commits between June 29 and August 14, 70% of the repository's entire history:**

- The whole `0xFE` rail: encoder, handoff store, and an automated executor with FDC attestation caching, a persisted daily fee budget, fuel checks, permanent-abort detection, and parking of operations that can never succeed
- The venue adapters the product actually runs on: Kinetic ISO (supply, borrow, repay, withdraw) and Firelight / earnXRP ERC-4626 vaults, plus exit-queue accounting so capital sitting in a 14-day unstake window is visible instead of invisible
- Liquidation protection: health-factor math, trigger price, derisk shortfall, and the unsigned repay leg
- The full FXRP round trip — mint proven, and **unmint back to XRP proven end-to-end on mainnet**
- All of Astryum Legacy: vault, XRPL council bridge, factory, the six-step ceremony, constitution anchoring, the disclosure gate and the governance surface — plus two mainnet deployments with verified sources and real council orders executed on-chain
- The assistant layer: five conversational surfaces, none with the ability to sign
- Production operations: a sentinel running 18 automated checks every five minutes that alerts only on state transitions, a public proof page reading contract state live, and an admin surface for every operational gauge
- Bilingual Spanish/English product surface, and an open beta

**Ported and improved:** the generic intent engine now emits Flare Smart Account userOps; the price layer, previously vendor-fed, now reads FTSO on-chain and refuses to proceed on a stale price.

## Deployments and proof of operation

**Flare Mainnet — chain ID 14.** Mainnet is enforced by the code: the backend throws at boot rather than start against a testnet.

| Contract | Address | Creation transaction | Block |
|---|---|---|---|
| `LegacyStackFactory` | `0xF93A8A0bd93e95514fF02285349b0b1c1a5a3e0a` | `0x65b3cc8e888c5063edb9fe95204a9dc71fbe6af97f26226ff3ff35ae209acb23` | 66707923 |
| `LegacyVaultDeployer` | `0x2717A6Aa5162f8c5e5D7574F112eFC9438Cb66f6` | born inside the factory's constructor | 66707923 |
| `XrplCouncilBridge` | `0x02aE9FcB76768e42B8d3ED9fe842238A6616b26F` | `0xde33f4d1b2f26d3857c2f48c25ca4459f3707b5cd7fcd39b24e5b2328228da39` | 65664695 |
| `LegacyVault` | `0xc8379C79779cCe3B738424892709fE0d4339E3b1` | `0x5614c15ef49fa454f9af6eec2e522b05357243eb09cbad2ef38558d7cb7302c7` | 65664695 |

Sources verified on the explorer. No proxy, no upgrade path, every constructor parameter eternal.

**Verify it live, in thirty seconds, trusting nobody:**

```bash
cast call 0xF93A8A0bd93e95514fF02285349b0b1c1a5a3e0a "SOURCE_ID()(bytes32)" \
  --rpc-url https://flare-api.flare.network/ext/C/rpc
```

It returns `0x5852500000…` — ASCII **`XRP`**. That immutable value proves this is the mainnet factory: a testnet one would read `testXRP`. It cannot be changed, and every bridge born from this factory inherits it.

**Live application state**, read from the chain rather than from a database: **https://astryum.xyz/proof**

## Verify every claim

We would rather be checked than believed.

| Claim | How to check it, without asking us |
|---|---|
| The rail really works end to end | Follow the two transaction hashes above across XRPL and Flare, and hash the memo yourself |
| The executor is real and active | `getTransactionCount` on `0xD876…CecE` — **325 transactions signed on Flare** |
| The bridge really verifies FDC proofs | `XrplCouncilBridge.sol:140-141` resolves `FdcVerification` from the Flare Contract Registry on every call. 18 tests, one per guard |
| Only an XRPL quorum can create its own vault | `LegacyStackFactory.sol:229-231` reverts unless `msg.sender` is the council's own Personal Account, resolved from `MasterAccountController` |
| The cage cannot release principal | Read `LegacyVault` on the explorer: no `withdrawPrincipal()`, no `transferTo(arbitrary)`, no proxy |
| Astryum does not sign for users | Every `/prepare` route returns unsigned payloads; `assertNoCustodialKeys()` refuses to boot if a user key is in the environment |
| The work was done in the program window | `git log --since=2026-06-29 --until=2026-08-15 --oneline \| wc -l` → 682 of 976. `forge test` → 58 |

## What is real, what is trusted, and what is not finished

**Real — exercised on mainnet with real value:** the `0xFE` rail end to end (XRP → FXRP → position), FXRP redemption back to XRP at the user's own r-address, and the council circuit in full — quorum signature → FDC attestation → bridge → vault call. Our executor has signed 325 transactions on Flare, all checkable on-chain.

**Built and tested, not all of it exercised on mainnet yet.** Every operation on the `0xFE` rail costs real XRP and a real FDC attestation fee, so we prioritised proving the paths that matter — entry, protection, exit, redemption and the council circuit — rather than touching every route once for show. What has not run is not disguised: settlement state is machine-gated against on-chain confirmation, so the product cannot paint a green check it has not earned.

**Trusted rather than enforced — the three we cannot code away:**

1. **That a council's XRPL account is genuinely multisig-only.** The FDC attests transactions, not ledger state, so no contract can prove it. Publicly auditable on XRPL and re-verified at every rehearsal — but a ceremony fact, not a code fact.
2. **The FDC's attestation providers.** We verify the Merkle proof; we do not verify the providers.
3. **Our executor being alive.** It cannot steal, redirect or alter anything, but if it stops a signed operation waits instead of completing. A liveness dependency, not a custody one — removing it is on the roadmap.

**Not finished:** the contracts are **unaudited**, and external review before third-party capital is the first item on the roadmap. Principal can leave the cage only by migrating to a successor vessel under a 30-day timelock — the governed release path is designed, not built. Six tests are red across three suites, two because they make real network calls: documented rather than skipped.

**Nothing here is mocked.** Figures come from on-chain reads or from a protocol's own API with the source named; when a value cannot be fetched, the product says so instead of substituting an estimate.

## How Astryum helps Flare

Turning FXRP from a bridged token into working capital with a visible round trip, and bringing XRPL users onto Flare **without requiring them to acquire FLR**. Exercising FAssets, FDC, Smart Accounts and FTSO together in one production flow. Demonstrating that FDC can carry **governance**, not only price and payment data.

## Where FLEC Hub fits — same funnel, opposite end

FLEC Hub, also submitted here, takes a Spanish-speaking newcomer from zero to *understanding* an interoperable asset. Astryum begins where that journey ends — and also serves the user who never took it. **Education without a destination is a lesson; a destination without education is an empty product.**

## Business model

Astryum has **no token**. Revenue is a disclosed service fee — never float, never spread on custody.

- **Composition fee**, shown before the user signs. Fee disclosure is an invariant of the codebase, not a setting. The executor runs at cost: the fee covers the FDC attestation and gas, priced live from FTSO.
- **Venue revenue share** — protocols receiving volume through Astryum share part of the fees that volume generates. Paid for volume, never for placement, and disclosed like every other cost.
- **Protocol fee hook in Astryum Legacy** — capped at 10% of realized yield by the constructor, default 0, eternal once deployed. The family's own lineage cut always comes first.

Astryum's own revenue is the only money Astryum ever signs for.

## Roadmap and next steps

Direction, not dates. Our objective after this program is a **Flare ecosystem grant**, and we are building toward that application rather than toward a prize. We say it plainly because it is the honest answer to "what happens after August": **we were going to build this anyway.** A grant would change the speed, not the direction.

1. **External audit of the Legacy contracts** before any third-party capital enters — non-negotiable
2. **The release vessel** — a governed path for principal to leave the cage under conditions the constitution defines. Today it can only migrate to a successor: deliberate, and not yet complete
3. **Watch-only by r-address**, so anyone can see their capital before trusting anything with a signature
4. **More FAssets and more venues** as they reach mainnet, each gated behind its own risk scanner
5. **Conditional orders with no delegated keys** — the agent compiles, the user signs, trustless logic executes inside signed, on-chain-enforced bounds
6. **Portable credentials on XRPL** — verifiable eligibility without us holding personal data

**Stack:** TypeScript / Node · Next.js · Solidity 0.8.24 + Foundry · Postgres · xrpl.js · ethers v6. Every DeFi surface sits behind a feature flag and a per-jurisdiction geofence.

## Demo and project links

- **Live application:** https://astryum.xyz
- **Public proof page:** https://astryum.xyz/proof
- **Demo video:** *[pending]*
- **Repository:** *[pending]*
- **X:** https://x.com/Astryum_

## Safety notice

Astryum operates on **mainnet with real assets**. It never requests a seed phrase or a private key, never holds user funds, and never signs on a user's behalf. Yield figures are presented as **protocol data with a named source**, never as an offer, a promise or a guarantee by Astryum.

The Legacy contracts are **immutable and unaudited**. Until an external audit, only founder capital in small amounts is in scope, and the cage's irreversibility must be explicitly accepted before any principal enters.

DeFi carries risk of loss, including total loss. Astryum reduces the risk of *operating* — mistakes, blind spots, missed liquidations — not the risk of the underlying markets or protocols.
