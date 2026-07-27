# Astryum

Astryum is a **non-custodial financial control plane** on Flare + XRPL. It observes capital
across wallets, aggregates it into one dashboard, and **prepares unsigned transactions** for the
user to sign in their own wallet (Xaman for XRPL, MetaMask/WalletConnect for EVM).
**Astryum never signs, never custodies funds, never executes with discretion.** That line is
enforced in code — see [INVARIANTS.md](INVARIANTS.md) and the boot guards in
`backend/src/config/bootGuards.ts`.

> **This is `main` — the complete product**: the flagship Carry FXRP flow below plus the
> surfaces around it (intents, automations, legacy/council, admin, savings). A pruned build
> containing only what the hackathon demo runs lives in the `demo/hackathon-mvp` branch —
> what was cut and why is mapped in
> [Astryum_MVP_Branch_Manifest.md](Astryum_MVP_Branch_Manifest.md).
>
> This repository is the **public snapshot** of the Astryum monorepo: the full product code
> with its canonical docs. Internal working notes (`docs/context/`, `legal/`) live in the
> private repository and are occasionally referenced by name for traceability.

## What the flagship demo flow does

1. **Summary / Portfolio / Wallets** — read-only, multi-wallet dashboard. Connected wallets
   (XRPL + EVM) are fanned through `GET /api/portfolio` and merged client-side
   (`frontend/src/lib/portfolioMerge.ts` — single source for every surface). Tabs: Tokens,
   DeFi positions, Capital Map, on-chain Activity (Flarescan).
2. **Strategy (Carry FXRP)** — the flagship flow. A preloaded natural-language phrase compiles
   client-side into real parameters, the backend builds the **unsigned** payloads:
   - **E1** `POST /api/flare-demo/e1/prepare` — XRP → FXRP direct-mint → supply collateral +
     borrow USDT0 on Kinetic ISO (one XRPL Payment signed in Xaman, executed by the user's
     Flare Smart Account).
   - **Carry** `supply-usdt0/prepare` — re-supply the borrowed USDT0 (the carry).
   - **Protection (A1)** `a1/prepare` — stop-loss twin: unsigned `[approve, repayBorrowBehalf]`
     that restores the health factor at a trigger price. Includes the carry-spread **shortfall
     disclosure** (how much USDT0 the wallet must top up when debt outgrew the supply).
   - **DERISK** `pa-withdraw-transfer/prepare` — unwind: withdraw USDT0 → repay in full →
     withdraw FXRP.
   Every response carries a fee/price disclosure with `disclosedToUser: true` and
   `defibroSigns: false`.
3. **E2** — wrap FLR → delegate vote power to an FTSO provider (unsigned EVM calls).

The math lives in `backend/src/connectors/protocols/flare/KineticIsoMath.ts` (one source of
truth for E1/A1) and is covered by the backend suite (1300+ tests, `tsc --noEmit` at 0).
After signing, settlement is machine-gated (`frontend/src/lib/settlement/`): the UI paints
green only on real on-chain confirmation and a signed operation survives a page reload.
Before signing, every flagship-flow `/prepare` (`e1`, `e1-borrow`, `supply-usdt0`, `a1`,
`pa-repay`, `pa-withdraw-transfer`) carries a simulation `preflight` verdict — dry-run
before signature, invariant #11; `a1` attaches it when the request names the signing
wallet (`signerAddress`), the only honest `from` to simulate with.

## What existed vs. what is new (for judges)

- **Pre-hackathon:** the canonical intent core (PolicyGuard, CalldataBuilder, IntentEngine),
  the multi-wallet read layer, auth (SIWE + passkey), i18n, the adapter registry.
- **Built for this demo:** the Carry FXRP strategy end-to-end (FlareDirectMintService,
  Flare Smart Account 0xFE userOps, Kinetic ISO builders + math, the flare-demo prepare
  routes, the Strategy screen with the NLP compile), the unified dashboard, and the DERISK
  shortfall disclosure.
- The demo runs on **Flare Mainnet** (chain 14) with verified contract addresses
  (`backend/.env.example`).

## Run it

Prereqs: Node 20+, a Postgres (local `docker compose up -d postgres` works), and the env files.

```bash
# 1. Install (workspace root)
npm install

# 2. Backend — copy backend/.env.example → backend/.env, set DATABASE_URL and
#    FLARE_DEFI_ENABLED=true (the demo routes sit behind this flag + a geofence)
cd backend
npx prisma generate && npx prisma migrate deploy
npm run dev            # http://localhost:3001  (/health, /api/status)

# 3. Frontend — copy frontend/.env.example → frontend/.env.local
cd ../frontend
npm run dev            # http://localhost:3000
```

Verification commands (what CI runs):

```bash
cd backend  && npx tsc --noEmit && npx jest        # 0 errors; 0 red suites (the RLS suite
                                                   # self-skips without a DATABASE_URL)
cd frontend && npx tsc --noEmit && npx vitest run  # 0 errors; settlement/preflight suite green
cd frontend && NODE_OPTIONS=--max-old-space-size=3072 npx next build
```

## Repo map (`main`)

- `frontend/src/app` — the app surfaces (Summary · Strategy · Portfolio · Wallets · Intents ·
  Legacy · Admin · Settings…) plus landing and auth.
  `frontend/src/components/earn/FlareDemoEarn.tsx` is the Strategy UI;
  `frontend/src/lib/settlement/` is the post-signature settlement machine.
- `backend/src/routes` — the API routers; `flareDemo.ts` holds the prepare
  endpoints above.
- `backend/src/connectors/protocols/flare` — FAssets direct-mint, Smart Accounts, Kinetic math.
- `backend/src/control-plane` — PolicyGuard + CalldataBuilder (the invariant tree).
- [ARCHITECTURE.md](ARCHITECTURE.md) · [DECISIONS.md](DECISIONS.md) ·
  [INVARIANTS.md](INVARIANTS.md) · [Astryum_Strategy_Carry_FXRP_Spec.md](Astryum_Strategy_Carry_FXRP_Spec.md). The demo plan lives in the private repo's working notes.
