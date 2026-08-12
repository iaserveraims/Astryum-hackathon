# Astryum — Vision, Objectives and Milestones

**How to read this document.** It states direction, not schedule. There are no dates here, and
there are no commitments about what will exist by when. Anything described below as a horizon is
an intention that will be shaped by what we learn, what the ecosystem ships, and what a regulator
says. Where something is already built, this document says so plainly; everywhere else, it
describes where we are pointed and nothing more.

Nothing in this document is an offer, a solicitation, or a promise of return.

---

## The vision

**Capital should be controllable without being surrendered.**

Today the two are bundled. A user who wants a single view of their money, a single place to act on
it, and someone to handle the complexity, is almost always asked to hand over custody in
exchange. A user who insists on keeping their keys is left to assemble the tooling themselves —
across wallets, chains, protocol interfaces and spreadsheets — and to notice a liquidation before
it happens.

Astryum exists to break that trade. One interface that sees everything, composes anything, and
holds nothing.

The long-term shape of that is a control plane that is **indifferent to where capital lives**. The
user works in one place, in their own language, with their own keys. Underneath, Astryum speaks to
whatever ecosystem the asset happens to sit in — and the user does not need to know which one that
is, or learn a new mental model each time the answer changes.

XRPFi is where we start, because it is where the gap is widest: a large, patient holder base whose
assets have only recently become usable, and almost no tooling that treats them as capital rather
than as a balance.

---

## What we believe

**The bottleneck in this space is not yield. It is operation.**
Most people who lose money on-chain do not lose it to a bad rate. They lose it to a missed
liquidation, an unclear exit, a wrong address, a bridge they did not understand, or a position
they forgot they had. Astryum optimises for the operating layer, not the return layer.

**Comprehension and capability are different problems.**
Teaching someone what an interoperable asset is does not give them a way to use it. Giving them a
way to use it does not teach them what it is. Both are needed, and they are not the same product.
We build the second and we actively want the first to exist alongside us.

**Custody is a design failure, not a feature.**
Every convenience that requires custody has a non-custodial construction available if you are
willing to build it. It is harder. It is the whole point.

**A guarantee that only exists in the marketing is a lie with a delay on it.**
If a rule matters, it belongs in code that enforces it, in a test that defends it, and in a
document that admits where it does not hold.

---

## Objectives

These are the outcomes we measure ourselves against. They are qualitative on purpose.

1. **A user can see all of their capital in one place without granting anyone a key.**
2. **A user can act on that capital without learning the ecosystem it lives in** — one signature,
   in a wallet they already trust, with the fee and the risk shown before they sign.
3. **A user is never surprised by a position.** Risk is visible before it becomes urgent, and the
   exit is documented at the same moment as the entry.
4. **A family can pass on capital under rules that outlive every party involved** — including us.
5. **Everything we claim can be checked by someone who does not trust us**, on-chain and in the
   open.
6. **Astryum's own survival is never a condition of the user's.** If the company disappeared, every
   user would still control their assets and every family would still govern their structure.

---

## Milestones

Horizons, not a calendar. Each one describes what would have to be true to consider it reached.

### Horizon 1 — Foundation *(substantially reached)*

A non-custodial rail that works with real capital on a live network: capital visible across
ecosystems, an entry and a full exit proven end-to-end, our own contracts deployed with verified
sources, and governance that a family council actually exercised.

**Reached when** a stranger can verify the whole claim on-chain without asking us anything.
That part is done; the surfaces that show it are still being widened.

### Horizon 2 — Trust

Independent review of the contracts before capital that is not our own goes anywhere near them.
Wider read-only access, so people can see their situation before they are asked to trust anything
with a signature. Completing the paths that are currently deliberately narrow — most importantly,
a governed way for long-held capital to be released under conditions its own rules define.

**Reached when** the honest answer to "should someone other than the founder use this with
meaningful money?" becomes yes, and it is backed by someone other than us saying so.

### Horizon 3 — Breadth

More assets, more venues, more ecosystems — behind the same single interface, each one gated
behind its own risk assessment rather than added because it was easy. Growth here is measured by
how much *does not* change for the user when something new is added.

**Reached when** adding an ecosystem is an internal event that users experience only as more of
their capital appearing on a screen they already know.

### Horizon 4 — Autonomy without custody

Capital that responds to conditions without anyone holding a delegated key. The direction is
deterministic intents the user signs once, executed permissionlessly, with the limits of that
authority enforced on-chain rather than promised off-chain. The user reviews and signs; automated
logic executes strictly inside what was signed; no discretion is ever delegated to us or to a
model.

**Reached when** a user can leave a rule running and the worst case is bounded by something a
contract enforces, not by our good behaviour.

### Horizon 5 — Continuity

Long-horizon capital — inheritance, family structures, capital meant to outlast its owner — as an
ordinary product rather than an exotic one. Verifiable eligibility and identity handled without
Astryum ever holding personal data.

**Reached when** a family can set this up, understand it, verify it, and hand it to the next
generation without needing us to still be here.

---

## Permanent commitments

These are the only forward-looking statements in this document that are absolute, because they are
restrictions on ourselves rather than predictions about the world. They are enforced in the
codebase today and they are not subject to a roadmap.

- **Astryum never signs for user funds, never custodies them, and never executes with discretion.**
- **No private key of a user ever reaches our backend or our client.**
- **Fees are disclosed before a signature, always.**
- **Yield figures are protocol data with a named source — never an offer, a recommendation or a
  guarantee from us.**
- **Nothing gets connected without its risk assessment and its feature flag.**
- **Where a guarantee does not hold, we say so in the product, not only in a document.**

If a future feature can only be built by breaking one of these, we do not build that feature.

---

## What this document does not do

It does not commit to a release date, a supported asset, a partnership, a jurisdiction, or a
number. It does not describe a token — Astryum does not have one, and the business model does not
require one. It does not promise that any horizon above will be reached, in this order, or at all.

Direction is a commitment to a heading, not to an arrival.
