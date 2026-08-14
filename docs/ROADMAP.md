# Astryum — Roadmap and next steps

**How to read this.** [VISION.md](./VISION.md) states direction: where Astryum is pointed, in
horizons, without dates. This document is its concrete counterpart — the actual work, grouped by
**dependency rather than calendar**, with what "done" means for each item and what it unblocks.

There are no dates here, and that is deliberate. And the phases are **not a queue**: several
advance in parallel, and work is picked up when its dependencies allow, not when its number comes
up. What is strict is the **gates** — the conditions under which something ships — never the
sequence.

---

## Where we are now

Astryum is live on Flare Mainnet and XRPL Mainnet with real capital. The `0xFE` rail works end to
end — XRP becomes FXRP, enters a position, is monitored, and comes back out as FXRP at the user's own
address, the user can at any moment unmint his FXRP to XRP again from the wallets menu. 
Our own contracts are deployed with verified sources, and a family council has governed
them from XRPL through the FDC. Our executor has signed hundreds of transactions on Flare.

What is not true yet: the contracts are unaudited, principal cannot leave the Legacy cage except by
migrating to a successor, and the product depends on our executor being alive to deliver signed
operations.

The honest map of what is real, what is trusted and what is unfinished lives in
[HACKATHON_SUBMISSION.md](./HACKATHON_SUBMISSION.md); this document is what we do about it.

---

## The shape of the product this roadmap serves

**One signature. N structures. One panel.** The user has a single wallet — where their signature
lives. Everything else is a **structure** that signature creates and governs: the personal account,
a reinforced account (a quorum of the user's own devices, so a stolen seed becomes inert), the
family legacy, and later variants of the same object — each presented as a named dashboard, never as
another wallet. Legacy is not a separate product; **it is a dial on the normal account**: same
object, same interface, different governance. Operating any structure is the same motion — compose,
review, sign with the one wallet.

That is what Astryum charges for: composing the transactions and abstracting the difficulty. The
structure is complex to assemble and administer inside; for the user it is a walk in the park.

---

## The strategy behind the priorities

**The primary objective is the single-wallet path.** A person arrives with XRP in Xaman and nothing
else — no second wallet, no FLR, no bridge account — and from there can see their capital, put it to
work, protect it and take it out. That already works. Sharpening it, and giving it enough DeFi worth
arriving for, is what everything in Phase 1 serves.

**Astryum Legacy comes after depth, and that is a decision rather than an accident.** Not because it matters
less — it is the part of the product nothing else on the market does — but because of two facts. It
cannot responsibly take third-party capital until the contracts have been independently reviewed,
and an audit is a cash cost. And demand is what justifies and funds that review in the first place.
Building depth and users first is what makes Legacy openable, rather than the other way round.

**The gate itself does not move.** Legacy stays closed to capital that is not ours until it has been
audited, exactly as stated. What this ordering changes is what we build while that gate holds —
not the gate.

**Where it leads.** Depth in DeFi creates the demand; demand is what makes a grant application
about growth rather than survival; and volume arriving at money markets across the ecosystem is
what turns integrations into partnerships — which is also where Astryum's own revenue scales,
since we are paid on volume and never on placement.

**And after the on-chain infrastructure is solved, the second part begins:** the capital reaching
the real world — banking through a licensed partner, spending through a self-custody card, payments
that run on signed rules. That is Phase 5, and the whole sequence in one line is:

> on-chain infra solved → demand through deep DeFi → the audit that opens Legacy →
> real-world rails through licensed partners → the economic life of a household, governed from one
> signature.

That last step is the market jump this roadmap is actually pointed at: from *protecting a DeFi
position* to **managing the economic life of a household** — a change in market size, not a feature.

---

## Phase 1 — The single wallet, and enough DeFi to be worth arriving for

### 1.1 The XRPL path, sharpened

**Why first.** This is the thing Astryum already does that nobody else does: one wallet, one
signature, no FLR, no bridge. It works — which means the highest-value work on it is not new
capability but fewer steps, clearer state while an operation is in flight, and every failure mode
explained inside the product instead of in a support message.

Two concrete pieces belong here. The **"use" verb**: FXRP that accumulates idle inside the account
(mint buffers, exit remainders) currently has no path back to work except minting more — supplying
what is already there is the one functional gap of the single account. And the **carrier rebound**:
the user sees one cost, in one asset, inside what they sign — never a second charge that appears
later.

**Done when** someone who has never touched DeFi completes their first position and their first
exit without needing to ask anyone how, and never opens a second wallet to do it.

### 1.2 The interface — abstraction that actually abstracts

**The direction.** The user asks for an outcome. The backend works out the route, the venue and the
sequence; what comes back is a transaction to sign. No chain names to learn, no bridge to choose,
no gas token to acquire first. The dashboard's job is to make a person's whole financial position
legible at a glance — every structure a named card showing what matters: total balance including
capital inside contracts, governance health, what is waiting for a signature, what is in flight.

**And the line that keeps it honest:** that is not the same as hiding. **The mechanics become
invisible; the facts stay visible.** The route taken, its cost, and who has to be trusted for it to
work are on screen before anything is signed — because a user who does not need to understand the
plumbing still has the right to know what they are agreeing to. Frictionless is a property of the
interface, never of the disclosure.

**Done when** a new user can describe what they own and what they just did, in their own words,
without using the word "chain".

### 1.3 Deeper lending — and closing the stablecoin gap

**The nearest piece of new DeFi, and the one with a compliance reason behind it.** Today's flagship
position borrows USDT0, which ships with an explicit disclosed exception because it is not an
e-money token. The obvious next venue fixes that: **lend FXRP and borrow RLUSD**, through Morpho and
the curated vaults built on top of it, so the borrowed leg is a regulated EMT rather than an
exception we have to explain.

**Done when** a user can open and unwind an FXRP-collateralised RLUSD position through the same
single-signature flow as the current one, with the same trigger-price and repay protection, and the
disclosed-exception copy disappears from the product because it is no longer needed.

**Why it matters beyond the feature:** it is the first venue we add where the reason is regulatory
fit rather than yield, which is the order of priorities we intend to keep.

### 1.4 Reaching the rest of the ecosystem — without a detour

**The direction.** XRP-denominated assets already exist beyond Flare — FXRP travels as an omnichain
token, and wrapped forms such as cbXRP live on other ecosystems entirely. A user holding value in
one place should be able to reach liquidity in another without learning where any of it lives.

**How, specifically.** By routing over rails that already exist rather than building a bridge:
origin → destination, directly, using established interoperability infrastructure. **Capital is
never detoured through XRPL to get somewhere else** — that is an invariant, not a preference, and it
rules out the hub-and-spoke design most XRP products reach for. Where a corridor exists but changes
the nature of the asset — a wrapped form that is a custodial IOU rather than the asset itself — the
risk scanner marks it and the disclosure says it with all the letters. What is not live is
monitored, never promised.

**Done when** a user can move value between ecosystems from inside Astryum, with the route, the cost
and the trust assumptions disclosed before they sign — and adding a new destination is a
configuration change gated by its own risk assessment rather than an engineering project.

**What it should feel like.** The user should not have to know that a crossing happened. They ask
for an outcome; the backend works out the route, the venue and the sequence; what comes back is a
transaction to sign.

### 1.5 Watch-only by address — sight without trust

**Why it belongs in this phase.** The cheapest thing we can give someone is a true picture of their
own capital, and it should not cost them a signature. It is also the natural top of the funnel, and
the point at which an education partner can hand a user over.

**Done when** an XRPL address alone produces the full Capital Map, with no account and no wallet
connection, and nothing on that path can write.

### 1.6 Breadth — more FAssets, and cross-chain DeFi

**The rail generalises.** Everything built for FXRP — mint from the native asset, deploy, monitor,
protect, unwind — is machinery, not a one-off: as further FAssets reach mainnet (Bitcoin and the
assets that follow through the same FAssets system), the same single-signature rail extends to
them. And DeFi itself does not stop at one chain: positions are opened **where the liquidity
actually lives**, reached over the existing interoperability rails of 1.4 — lending, vaults and
markets on other ecosystems, composed from the same interface and signed with the same wallet.

Each new asset and each new venue enters the same way, without exception: behind its own risk
assessment and its own feature flag, with its exit documented at the same time as its entry. And
the standing rule applies here more than anywhere: **what is not live is monitored, never
promised.**

**Done when** adding an asset or a cross-chain venue is a configuration change gated by its risk
assessment rather than an engineering project — and the user experiences it only as more of their
capital, and more places for it to work, on a screen they already know.

---

## Phase 2 — What growth obliges us to earn

### 2.1 External audit of the Legacy contracts

**Why here rather than first.** The contracts are immutable: a bug is not patched, it is migrated
away from under a 30-day timelock. That makes independent review the single highest-value thing we
can buy — and it is a cash cost, which is precisely why it follows the work that creates demand
rather than preceding it.

**Done when** an independent firm has reviewed `LegacyVault`, `XrplCouncilBridge` and
`LegacyStackFactory`, the report is public, and every finding is either fixed in a successor vessel
or accepted in writing with the reasoning stated.

**Unblocks:** third-party capital in Legacy. Until then the policy stands — founder capital only, in
small amounts. **This is the gate that does not move.**

### 2.2 Removing the executor liveness dependency

**Why growth forces this.** Our executor cannot steal, redirect or alter anything — the contract
accepts only the bytes the user signed. But if it stops, a signed operation waits instead of
completing. One user can tolerate that. A growing base cannot, and a control plane that calls itself
non-custodial should not have the dependency at all.

**Done when** a signed operation can be delivered by anyone willing to pay the attestation fee, with
our executor a convenience rather than a requirement, and the incentive to relay documented — the
execution fee disclosed and committed inside what the user signs, so whoever delivers the exact
signed bytes is paid by the flow itself, and nobody can be paid for delivering anything else.

**Unblocks:** the last structural reason a user has to depend on our company continuing to exist.

---

## Phase 3 — Legacy, opened

### 3.1 The release vessel — a governed way for principal to leave

Today the cage does exactly what it promises: principal cannot be sold, and the only exit is
migration to a successor with the same council and the same constitution. That is correct, and it is
incomplete as a product. A family should be able to define, in its own constitution, the conditions
under which principal is released — and have code enforce them.

**Done when** a council can move principal out under conditions its own constitution defines,
enforced on-chain, with the same discipline the rest of the vault already has: announced in advance,
timelocked, and impossible to route to an address the constitution did not sanction.

### 3.2 More for the council

With the contracts reviewed and the vessel complete, Legacy stops being a single ceremony and
becomes a product a family lives with: richer payee and venue governance, better instrumentation of
what the cage holds and earns, the surfaces a council needs between one decision and the next — and
the structure presets that generalise it (a reinforced personal account, and the variants a family,
a couple or a foundation would choose), each the same object with the dials in a different position.

**Done when** a family that set up a Legacy can run it for a year without us being involved.

---

## Phase 4 — Autonomy without custody: the ladder

Autonomy is a ladder, and each rung is the technical and legal foundation of the next. The rule on
every rung is the same and never changes: **the AI compiles, the user signs, trustless logic
executes inside signed bounds.** No rung gives anyone unilateral discretion; no rung leaves us a
key or a signed blob.

1. **Button + signature** — today's product.
2. **Trigger → tray** — a rule watches, composes the exact action, and brings it to the user (or
   the quorum) to sign; it expires on its own and can be revoked instantly. Live today. The copy is
   invariable: *sign-at-trigger* — never "automatic payments without signing".
3. **Standing orders — signed once, fired later.** Only as fully closed envelopes: the worst
   acceptable outcome sealed in the signature, the trigger verifiable on-chain, the executor unable
   to make the result worse, and the authorisation waiting somewhere Astryum does not control.
   A signature does not exempt: a signed mandate with residual discretion is exactly what portfolio
   management regulation defines — so open-ended policies ("keep the yield going") are not built,
   and ladders of closed orders deliver the value instead.
4. **Bounded AI agents** — an agent that drafts and a human signs, or an agent that fills the
   pre-authorised envelope of rung 3. Limits enforced on-chain, never only by policy; the tools to
   sign, execute or custody **do not exist in the agent's hands — that absence is the product.**
5. **Protocol-managed wallets** — far horizon, isolated module, regulatory-gated (see the North
   Star below).

**Done when** a user can leave a rule running and the worst case is bounded by something a contract
enforces — not by our good behaviour, and not by a model's judgement.

---

## Phase 5 — When the on-chain infrastructure is solved: capital touches the real world

The second part of the roadmap. Everything above makes capital visible, productive and governed;
this phase makes it **spendable — and a source of income** — and the rule that governs every piece
of it is absolute:
**converting crypto to fiat is the canonical regulated activity, and Astryum never touches it.**
We coordinate up to the door; a licensed partner crosses it, under its licence and its KYC. Each
regulated slot belongs to its partner; the orchestration — intent, routing, policy, audit — is the
only thing that is ours, and it is not outsourced.

### 5.1 Banking, through the on/off-ramp partner

The integrated ramp (MoonPay today, with aggregation as redundancy) covers "I want €X in my bank":
the user signs, funds reach their own account at the partner, the partner converts and settles to
the user's bank under its licence. Redundancy is not optional polish: de-banking is the single most
fragile link in any crypto-to-bank path, and an aggregated ramp model is structurally safer than
any single provider.

### 5.2 Spending, through a self-custody card

The elegant end of the last mile: a card linked to a wallet **the user controls**. The user spends
at any terminal or takes cash at an ATM; the conversion happens invisibly at the moment of spend,
performed by the card's issuer. Astryum's entire role was composing a transfer to an address the
user owns — the cleanest possible hand-off. The category exists and is maturing (self-custody card
issuers, including cards bound to multisig accounts — literally *a family council with a card*);
the partner is chosen by due diligence, not named in advance.

### 5.3 Moving the money — rails without pools

The EU path is **EMT-native end to end**: obtain the e-money token without selling (a borrow, from
Phase 1.3), move it over burn-mint rails that have no pool and no slippage, spend or bank it at the
edge. The chain where capital earns and the chain where the card settles are rarely the same one —
the routing layer is ours, the rails already exist, and the hard prerequisite is stated rather than
assumed: **without a liquid EMT in the corridor, the EU last mile is a demo, not a product.** It is
monitored, not promised.

### 5.4 Payments that run on rules

Recurring payments on top of the same machinery: *"on day X, pay Y."* The governed version already
runs — the council signs the rule once, and each due payment arrives composed in the signing tray
for the quorum to confirm. The personal version follows the same pattern for a single signature.
This is where the stablecoin argument becomes concrete: **a euro cannot be put on a standing rule
signed by a quorum; an e-money token can.** Programmability and settlement speed are the value —
not the peg.

### 5.5 Strategies, running

The closed conditional orders of Phase 4, applied: protection that fires at a threshold, take-profit
ladders, scheduled accumulation — each one a sealed envelope, stacks of them giving the feel of a
continuous strategy without ever becoming a discretionary mandate.

### 5.6 The income layer — living from the capital without selling it

This is what the pieces above add up to, and it is the point of the whole phase: **on-chain capital
as real-world income.**

Two forms of it, both composed by Astryum and signed by the user:

- **Yield as income.** A strategy produces; the realized yield is converted to an e-money token and
  arrives where life happens — the bank account through the ramp partner, or the card. Not a number
  on a dashboard: a recurring arrival the user can live on, with every step disclosed and every
  figure a protocol's own data with its source named.
- **Credit without selling.** A DeFi loan against the user's own collateral — an EMT borrowed on a
  money market, routed over the pool-less rails, delivered by the licensed partner to the user's
  own bank account. **To pay for a house, a renovation, a year of expenses — while the principal
  stays invested and keeps working.** The position never leaves the user's control, and Astryum
  never touches the money: it composed the path.

This is what private banking does for large estates — lombard credit, income from a portfolio that
is never sold — and institutions already borrow dollars against XRP without selling it. Astryum
builds the family-scale, non-custodial version of exactly that.

Two disciplines are non-negotiable companions, not add-ons:

1. **Protection is part of the product, not an option.** A collateralised loan can be liquidated,
   so the trigger-price math and the protection rules of Phase 1 travel with every borrow — and
   crypto collateral has one honest advantage here: it can be de-risked at three in the morning on
   a Sunday, which a portfolio of securities cannot. The sizing question — *does the buffer survive
   a fall of X% for Z days?* — is answered before the user is allowed to spend anything.
2. **We inform about the mechanism; we never advise.** In many jurisdictions a loan is not a
   taxable event while a sale is — that is a fact about the mechanism, stated with its source, and
   the decision is the user's. Astryum gives no tax advice and no financial advice, ever.

**Done when** a user can point at a position and say "this pays my mortgage" — with the yield or
the borrow arriving at their own bank account through a licensed partner, the protection running,
and Astryum never having touched a euro of it.

### 5.7 The multichain ledger — the books underneath it all

No chain can see the whole estate, so the book cannot live on one. The design is an append-only
ledger of settled deltas — every confirmed transaction contributes its exact balance changes,
indexed by chain, address and hash; balances are projections of the log, and the log is auditable
and reconstructible. It is what makes a governed estate usable for a family whose capital lives in
several layers, and the foundation for tax reporting through a licensed professional partner — one
more edge that belongs to a partner, not to us.

### 5.8 Identity that travels with the user

Sign-in that says **who you are, never what you control** — and eligibility that does not need to
be re-proven at every regulated edge. The direction is portable credentials anchored on XRPL,
issued by the verification provider rather than by us: Astryum never issues identity claims and
never holds the personal data behind them. What the user gains is concrete — verify once, and the
proof travels with the account to every partner that accepts it.

---

## Further out

- **A mobile surface.** Capital does not wait for a desk, and this product is already half
  mobile-shaped: signing lives in Xaman, on a phone. **Done when** everything a person can do on the
  desktop surface they can do from a phone, with the same disclosures, the same unsigned hand-off
  and the same keys — no reduced "lite" mode that quietly loosens a guarantee to fit a smaller
  screen.
- **The North Star: the account as pure authority.** The governing account stops holding capital
  and becomes authority alone; capital lives in protocol-managed arms, each on its native chain —
  **capital never travels, orders do.** Why XRPL at the head: not because the capital lives there,
  but because it is the best chain in the world at *being the head* — native multisig, no contracts
  in the layer that commands, negligible fees. Two honest boundaries come with it: the hard cage of
  today is not the draft of this future — it is the product with a structural guarantee (the exit
  function does not exist) that a rules-based future can never give, so the two coexist; and
  protocol-managed wallets solve *one wallet on every chain*, **not** *crypto to euros* — the last
  mile always belongs to a licensed partner. Every piece of this is gated on infrastructure that
  has not shipped; it is direction, not commitment.

---

## Immediate hygiene

Small, unglamorous, and ahead of everything above in effort-to-value:

- A published security disclosure policy: scope, what is unaudited (all of it), how to report, and
  safe harbour for good-faith research.
- Resolving the six known red tests, two of which fail because they make real network calls.
- Licence metadata consistent across the repository.

---

## Why we are applying for a grant, and what it would change

Our objective after Flare Summer Signal is a **Flare ecosystem grant**. We state it plainly rather
than implying it, because the honest answer to "what happens next" is that **we were going to build
this anyway** — the product exists, runs on mainnet, and carries our own capital.

**What a grant would fund.** Phase 1 is a growth application, not a survival
one: depth in DeFi and a sharper single-wallet path are what bring users to Flare protocols through
a non-custodial front end. Phase 2 is what growth obliges us to earn — the audit that opens Legacy
to capital that is not ours, and the removal of our own liveness dependency. Both are cash costs
that make the system trustworthy and sell nothing by themselves, which is exactly the kind of work
that does not get funded by revenue at this stage. Phases 3 through 5 are what the funded
foundation carries: the opened Legacy, the autonomy ladder, and the partner-run rails that let
governed capital reach the real world.

**What it would not change:** the direction, the invariants, or the gate. Astryum never signs, never
custodies, never executes with discretion, and Legacy stays closed to third-party capital until it
is audited. If a funded feature could only be built by breaking one of those, we would not build the
feature.

---

## The regulatory posture — CASP-agnostic by construction

Astryum's architecture was chosen to stay outside the CASP perimeter under MiCA, not found to be
outside it afterwards. Prepare-only is the reason: the system composes unsigned payloads and stops.
Custody (Art. 3(1)(16)(1)) and execution of orders on behalf of clients (Art. 3(1)(16)(5)) never
arise, because Astryum never holds a user asset and never transmits a signed order. Reception and
transmission of orders — the riskiest classification for a product like this — is analysed
explicitly rather than assumed away. The assistants return deterministic, factual context with a
mandatory disclaimer, keeping them clear of investment advice (Art. 3(1)(16)(8)). The only point at
which a regulated CASP touches user capital is the fiat edge — on-ramp, off-ramp, card — where a
licensed third party runs its own flow.

These are written as red lines in [regulatory/MICA_BOUNDARIES.md](./regulatory/MICA_BOUNDARIES.md),
mapped article by article, with the rule that code changing a boundary must update that document in
the same pull request.

**This posture constrains the roadmap, and that is intended.** It is why the autonomy ladder is
built on sealed envelopes and on-chain-enforced limits instead of delegated keys, why a signature
with residual discretion is treated as the *definition* of the regulated service rather than a
defence against it, why routing composes a transaction the user signs rather than transmitting an
order on their behalf, why the AI compiles rather than decides, and why no item on this list ends
with Astryum holding a user's asset or crossing the fiat door. A feature that would move us inside
the perimeter is not one we postpone — it is one we do not build.

---

## What we are deliberately not doing

- **No token.** The business model does not need one and a token would create obligations that
  compete with the user's interest.
- **No custody, in any form, for user funds** — including "temporary", "for convenience", or "just
  for automation".
- **No wallet and no DEX of our own.** We integrate execution venues; we do not compete with them.
  Our differentiation is coordination across ecosystems, not a better single-chain wallet.
- **No delegated signing keys**, and no AI with discretion over execution.
- **No touching fiat conversion, ever** — banking, cards and tax filings are edges run by licensed
  partners; Astryum coordinates up to the door and does not cross it.
- **No yield promises.** Rates are protocol data with a named source, never an offer from us.
- **What is not live is monitored, never promised.**

---

## How to check our progress

Not by asking us:

- **https://astryum.xyz/proof** — contract addresses and operation counters, read live from the
  chain rather than from our database.
- The contracts themselves, with verified sources on the Flare explorer.
- The repository's commit history, which is where every claim in this document either becomes true
  or stays open.
