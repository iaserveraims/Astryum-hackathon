<div align="center">

# Astryum

**Your capital. Your control. Your signature.**

A **non-custodial financial control plane** on Flare + XRPL. Astryum observes capital across
wallets, aggregates it into one dashboard, and **prepares unsigned transactions** for the user
to sign in their own wallet (Xaman for XRPL, MetaMask/WalletConnect for EVM).

**Astryum never signs, never custodies funds, never executes with discretion.**
That line is enforced in code — see [INVARIANTS.md](INVARIANTS.md) and the boot guards in
`backend/src/config/bootGuards.ts`.

### 🚀 [**Try it live → astryum.xyz**](https://astryum.xyz)

*The product runs on **Flare Mainnet**. Everything below is best experienced from the page —
request early access there; this repository is for reading the code, not for running it.*

<br>

[![Landing — Your capital. Your control. Your signature.](docs/media/landing-hero.png)](https://astryum.xyz)

</div>

> This repository is the **public snapshot** of the Astryum monorepo (`main`): the full product
> code with its canonical docs. Internal working notes (`docs/context/`, `legal/`) and the
> pruned demo build live in the private repository and are occasionally referenced by name for
> traceability. Built for **Flare Summer Signal** and **XRPL Commons · Make Waves**.

---

## The flagship flow — Carry FXRP, one signature in Xaman

An XRP holder enters DeFi on Flare **without an EVM wallet and without gas**: one XRPL Payment,
signed in Xaman, carries a Smart Account instruction (`0xFE`) whose hash pins exactly what may
execute — nothing else can.

```mermaid
sequenceDiagram
    autonumber
    actor U as User (Xaman)
    participant A as Astryum (prepare-only)
    participant X as XRPL
    participant F as Flare · FDC
    participant SA as Flare Smart Account
    participant K as Kinetic ISO

    U->>A: "Put my XRP to work" (NLP → parameters)
    A->>A: Build UNSIGNED payload + dry-run preflight
    A-->>U: Review: fees, prices, risks — all disclosed before signing
    U->>X: Sign ONE Payment (memo = hash of the exact operation)
    X-->>F: FDC attests the payment (90s voting rounds)
    F->>SA: Direct-mint XRP → FXRP, delivered to the user's Smart Account
    SA->>K: Supply FXRP collateral + borrow USDT0 — exactly what was signed
    K-->>U: Position live — green only on real on-chain confirmation
```

Every `/prepare` response carries a fee/price disclosure with `disclosedToUser: true` and
`defibroSigns: false` — and the backend refuses to boot if any environment variable looks
like a user signing key (`backend/src/config/bootGuards.ts`).

## Truth before and after the signature

The two halves of the product's honesty, both machine-enforced:

```mermaid
flowchart LR
    subgraph BEFORE["Before signing — invariant #11"]
        P[Prepare] --> DR{Dry-run<br/>preflight}
        DR -->|would succeed| R[Review:<br/>fees + risks disclosed]
        DR -->|would revert| W[Warn with the<br/>decoded reason]
    end
    subgraph AFTER["After signing — the settlement machine"]
        S[Signed] --> PEN[Pending<br/>persisted per-ref]
        PEN -->|on-chain confirmation| OK[✅ Settled]
        PEN -->|proven failure| KO[❌ Failed, with reason]
        PEN -->|taking longer| ST[⏳ Stalled —<br/>keeps watching]
        PEN -.->|page reload| PEN
    end
    R --> S
```

- **Preflight on all six flagship `/prepare` routes** (`e1`, `e1-borrow`, `supply-usdt0`, `a1`,
  `pa-repay`, `pa-withdraw-transfer`): each operation is simulated against live chain state
  before the wallet ever opens — a doomed transaction warns *before* it costs anything.
- **The UI cannot fabricate success**: the settled state is produced only by the settlement
  machine from real confirmations (a branded type makes a hand-built "green" impossible), a
  signed operation **survives a page reload**, and the "taking longer than usual" threshold is
  **calibrated against 166 real mainnet direct-mint executions** (median 129s, max 239s —
  measured from the FDC proofs themselves, see `frontend/src/lib/settlement/settlement.ts`).

## Protection is part of the strategy, not an afterthought

```mermaid
flowchart TD
    POS[Live position:<br/>FXRP collateral · USDT0 debt] --> HF{Health factor<br/>watched via FTSO price}
    HF -->|price drops to trigger| A1["A1 stop-loss — unsigned<br/>approve + repayBorrowBehalf<br/>prepared for YOUR signature"]
    HF -->|user decides to exit| DR2["DERISK — unwind:<br/>withdraw · repay in full · exit"]
    A1 --> SIGN[You review and sign.<br/>Always.]
    DR2 --> SIGN
```

Automation only ever **prepares**; triggers compile to deterministic intents the user signed
policies for. No agent, no operator, and no Astryum key can move capital on its own.

## What Flare does here (and why it is load-bearing)

| Primitive | Role in Astryum | If you removed it |
|---|---|---|
| **Flare Smart Accounts** (`0xFE` custom instruction) | An XRPL signature controls DeFi actions on Flare — no EVM wallet, no gas for the user | The walletless XRP user stops existing |
| **FAssets / FXRP** (direct-mint) | Native XRP becomes productive collateral on Flare in the same signed flow | No XRP entry path at all |
| **FDC** | Attests the XRPL payment; the mint executes only against that proof | The trustless rail collapses |
| **FTSO** | Live prices size the borrow and drive the stop-loss math (`FTSO_PRICE_UNAVAILABLE` fails closed) | Protection would run on stale numbers |

## See it

<div align="center">

| The trust page — verifiable claims, not promises | The journey |
|:---:|:---:|
| [![About — we don't ask for trust, we prove it](docs/media/about.png)](https://astryum.xyz/about) | [![Landing journey](docs/media/landing-journey.png)](https://astryum.xyz) |

</div>

Every surface ships in English and Spanish (Spanish-first at home, by design).

## What existed vs. what is new (for judges)

- **Pre-hackathon:** the canonical intent core (PolicyGuard, CalldataBuilder, IntentEngine),
  the multi-wallet read layer, auth (SIWE + passkey), i18n, the adapter registry.
- **Built for this demo:** the Carry FXRP strategy end-to-end (FlareDirectMintService,
  Flare Smart Account `0xFE` userOps, Kinetic ISO builders + math, the flare-demo prepare
  routes, the Strategy screen with the NLP compile), the unified dashboard, the DERISK
  shortfall disclosure, the settlement machine and the preflight layer.
- Runs on **Flare Mainnet** (chain 14) with verified contract addresses
  (`backend/.env.example`). Covered by **1,400+ automated tests** (backend Jest + frontend
  Vitest) with TypeScript strict typechecks at zero errors on both sides.

## Repo map

- `frontend/src/app` — the app surfaces (Summary · Strategy · Portfolio · Wallets · Intents ·
  Legacy · Admin · Settings…) plus landing and auth.
  `frontend/src/components/earn/FlareDemoEarn.tsx` is the Strategy UI;
  `frontend/src/lib/settlement/` is the post-signature settlement machine.
- `backend/src/routes` — the API routers; `flareDemo.ts` holds the prepare endpoints above.
- `backend/src/connectors/protocols/flare` — FAssets direct-mint, Smart Accounts, Kinetic math.
- `backend/src/control-plane` — PolicyGuard + CalldataBuilder (the invariant tree).
- Canonical docs: [ARCHITECTURE.md](ARCHITECTURE.md) · [DECISIONS.md](DECISIONS.md) ·
  [INVARIANTS.md](INVARIANTS.md) ·
  [Astryum_Strategy_Carry_FXRP_Spec.md](Astryum_Strategy_Carry_FXRP_Spec.md) ·
  [docs/regulatory/MICA_BOUNDARIES.md](docs/regulatory/MICA_BOUNDARIES.md).

---

<div align="center">

**[astryum.xyz](https://astryum.xyz)** — your capital, your control, your signature.

</div>
