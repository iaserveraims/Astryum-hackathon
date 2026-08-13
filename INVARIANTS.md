# INVARIANTS.md — Astryum

> The rules the **code** never violates. If a task can only be implemented by breaking one
> of these, the task is wrong — stop, choose the interpretation that preserves the invariant,
> and leave a note in the PR. These are the hard floor under [ARCHITECTURE.md](ARCHITECTURE.md)
> and [DECISIONS.md](DECISIONS.md).

Astryum is a **non-custodial Universal Financial Control Plane**: it observes, aggregates and
coordinates multichain DeFi capital, builds calldata/intents, and hands them to the **user's
wallet to sign**. **Astryum never signs, never custodies, never executes.** The regulatory
posture (MiCA) holds only because the code respects that on every line.

---

## Custody & signing

1. **No user private key ever touches the backend or the client.** Astryum builds **unsigned**
   payloads; the signature is always produced by the user's wallet. Embedded wallets (Turnkey)
   generate the key inside the provider's TEE under the **user's own passkey** as the sole root
   authenticator — the backend never sees the key.

2. **The agent has zero unilateral discretion.** "AI compiles, user signs once, trustless logic
   executes within signed bounds." The AI only compiles NLP → intent; the **user reviews and
   signs**. No delegated keys to Astryum, no AI with discretion in execution.

3. **Automation = deterministic, user-signed intents only.** Conditional/triggered execution is
   permissionless and runs **within bounds the user signed**: CoW/ComposableCoW conditional
   orders (one signature, permissionless WatchTower) and/or ERC-4337 / EIP-7702 session keys
   with **on-chain enforced** bounds (scope via ERC-7715). No standing approvals, no signature
   reuse, no background execution Astryum controls.

4. **Astryum never broadcasts.** It prepares the intent, the user authorizes, the payload is
   handed off; after hand-off Astryum stops — it does not select mempools, track the txHash
   operationally, or guarantee execution. Every provider that builds calldata sets
   `authorization.astryumRelays: false` and `canBroadcast: false`.

5. **Delegated / off-chain-policy signing is V1.1, MiCA-gated — never V1.** Turnkey's
   delegated-agent-signing pattern, and any TEE-managed custody (Flare PMW/FCC), require a MiCA
   legal review before production and live in **isolated, flag-gated modules**. If ever used,
   they must compose with ERC-4337 so the bounds are **on-chain**, not merely off-chain policy.

6. **Embedded wallets: user-exportable keys, exclusive user control.** Sovereignty test — if the
   provider disappears tomorrow, the user recovers alone. An implementation that fails this test
   does not merge.

## Routing & origins

7. **The base is Astryum's chain-agnostic core, not any single chain.** Origins (XRPL/Xaman,
   EVM/MetaMask, Solana/Phantom) are **multi by necessity**. XRPL is the flagship *origin*, not
   the universal base.

8. **Never route non-XRP capital through XRPL.** Act on each asset where it lives, via that
   ecosystem's best partner. EVM capital executes **directly** (Enso); it is never bridged
   into XRPL first. Cross-ecosystem moves bridge source→destination directly (LI.FI/Squid/
   Across), never via an XRPL hop.

## Assets & data honesty

9. **EU-facing strategies: EMTs only** (USDC, EURC, RLUSD). USDT is read-only. Distinguish native
   vs bridged stable per chain (on Flare, USDC is bridged).

10. **APYs are always protocol data with a source** ("Current Aave supply rate: X%"), never a
    Astryum promise or offer. Forbidden copy: "we recommend", "guaranteed", "earn X% with us",
    "the agent decides".

11. **`receiptTokenAddress` ≠ `executionContractAddress`.** DefiLlama returns receipt tokens
    (e.g. aToken); the execution contract is resolved on-chain (e.g. `POOL()`). Never conflate
    them.

## Disclosure, safety & gating

12. **Fees are always visible before signing** — `disclosedToUser: true` is invariant.

13. **Nothing is plugged in without its scanner** (risk + KWYH) and **its feature flag**. Flare
    DeFi stays behind `FLARE_DEFI_ENABLED`.

14. **Per-jurisdiction kill-switch.** The in-app DeFi execution module lives behind its own
    geofenceable border/flag, decoupled from the rest (monitoring, fiat, tax — always available).

15. **Simulate before signing (Tenderly), ExecutionReceipt after settlement.** Every action
    leaves proof in the audit trail.

## Secrets & repo

16. **No secret in client code or in the repo.** `NEXT_PUBLIC_*` for secrets is forbidden.
    Partner HMAC (MoonPay, Xaman) is always server-side. Found an exposed secret: **stop, rotate,
    report.**

17. **The repo is a due-diligence document** (grant reviewers have access). Quality, tests and
    zero secrets are not optional.

## Candidates (NOT yet invariants — do not enforce as rules)

- **Informative neutrality** — *"the agent composes information; the human composes decision"*:
  the signing invariant extended to the cognitive layer (comparative, never imperative; numbers
  from tested math only; the user's market view is an input, never the agent's). Already partially
  encoded as prompt cages + deterministic calculators. Formalize when the LP-educativo piece is
  built (spec'd in an internal working note, not published in this repo).

---

*When in doubt: the most conservative reading that preserves these invariants is the
correct one.*
