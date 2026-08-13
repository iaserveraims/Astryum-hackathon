# How Astryum Uses Flare

**Read this first if you are evaluating the depth of our Flare integration.**

This document does not list features. It answers one question, primitive by primitive:
**if you removed this piece of Flare, what would stop working?**

Everything below is live on **Flare Mainnet (chain ID 14)** with real capital. Testnet is
rejected by the code itself — `backend/src/config/chainConfigs.ts:50` throws
`CRITICAL: Astryum Private Beta requires Flare Mainnet. Testnet is not allowed.`

---

## 1. The counterfactual

| Flare primitive | Verdict | Status | If you removed it |
|---|---|---|---|
| **Smart Accounts** (Personal Account resolution) | `ESSENTIAL` | live on mainnet | There is no XRPL-native product. Every user would need FLR and a second wallet before doing anything. |
| **FAssets / FXRP direct minting** | `ESSENTIAL` | live on mainnet | Every entry dies. There is no other way for XRP to become working collateral. |
| **FDC** — an XRPL signature becoming an action on Flare | `ESSENTIAL` | live on mainnet, on both rails | There is no product. Every signature in Astryum — the entry, the exit, the council's order — is made on XRPL, and the attestation is what proves it happened *and* what carries the order it committed to. Without it nothing crosses: no mint, no position, no governance. |
| **FTSO** — decision layer (sizing, trigger price, alerts) | `ESSENTIAL` | live | Leverage sizing, liquidation triggers and rule evaluation all break. The system fails hard rather than guessing. |
| **FTSO** — display layer | `USEFUL BUT REPLACEABLE` | live | USD figures become estimates from an off-chain source. |
| **FTSO rewards + WNAT delegation** | `MEANINGFUL` | live | The autonomous FLR flow disappears. |
| **FCC / TEE** | absent | no code | Nothing — we are not competing in that bounty and we do not claim it. |

Three primitives are load-bearing to the point that removing any one of them leaves no product.
That is the honest summary.

---

## 2. Integration depth, with the strongest evidence for each

| Technology | Depth | Strongest evidence |
|---|---|---|
| **FDC** | DEEP | Our own contract verifies Merkle proofs through `FdcVerification`, resolved from the Flare Contract Registry on **every** call — `contracts/src/XrplCouncilBridge.sol:140-141`. Six independent guards, double anti-replay, 18 tests written one per guard. Two complete relayers with paid-attestation caching and an anti-grief guard. |
| **FAssets / FXRP** | DEEP | Direct minting via the `0xFE` opcode, with mint parameters read on-chain and an anti-drift buffer. Redemption registers our executor as the FAssets `_executor` so a default can be claimed **without asking the user for a second signature** (`backend/src/connectors/protocols/flare/FlareDirectMintService.ts`). Full round trip proven on mainnet. |
| **Smart Accounts** | DEEP | The official SDK, plus something we have not seen elsewhere: **a Personal Account used as an authorization gate inside Solidity.** `contracts/src/LegacyStackFactory.sol:229-231` resolves the council's Personal Account from `MasterAccountController` and reverts unless `msg.sender` is that exact account. An XRPL quorum is therefore the only caller that can bring its own vault into existence. |
| **Own contracts on mainnet** | DEEP | ~1,175 lines of Solidity, no proxy, no upgrade path, sources verified on the explorer. 58 Foundry tests (22 vault + 18 bridge + 15 factory + 3 fuzzed invariants), with Foundry broadcast receipts for chain 14. |
| **Own executor** | DEEP | Persisted daily fee budget, per-rail reserve, executability verified **before** paying for an attestation, and auto-refuel FXRP→WFLR through SparkDEX V3. |
| **Protocol adapters** (6) | MEDIUM/DEEP | Kinetic alone is ~1,095 lines, covering the isolated market and a restore-repay computed at FTSO price. |
| **FTSO** | MEDIUM(+) | FtsoV2 resolved through the registry, `bytes21` feed IDs, staleness checks feeding a policy guard. No contract of ours consumes it directly — see attack #2 below. |

**Nothing here is a superficial REST call.** The only HTTP requests in the whole Flare path go to
the FDC verifier and DA layer, which have no on-chain alternative — and they terminate in a Merkle
verification inside a contract we wrote and deployed.

---

## 3. The two circuits

### 3.1 One Xaman signature, executed on Flare (`0xFE`)

An XRPL user who has never held FLR acts on Flare:

```
Astryum encodes the Flare calls the user asked for  →  userOpData
        ▼
UNSIGNED XRPL Payment, memo = keccak256(userOpData)   ← the user signs this in Xaman
        ▼
Executor requests an FDC XRPPayment attestation (type 0x08) for the validated tx
        ▼
AssetManagerFXRP.executeDirectMintingWithData(proof, data)
   contract accepts ONLY the exact committed bytes: keccak256(_data) + sender + nonce
        ▼
XRP becomes FXRP and the committed calls run inside the user's Personal Account, atomically
```

The executor pays gas and the attestation fee from Astryum's own wallet and has **zero
discretion**: it either executes exactly what the user signed, or the transaction reverts. Its key
is environment-only and never touches user funds — enforced at boot by
`assertNoCustodialKeys()` in `backend/src/config/bootGuards.ts:60`.

### 3.2 XRPL governs a Flare contract (council bridge)

```
Council signs a 1-drop XRPL Payment (memo = keccak256(orderData))
        │  master key disabled + no RegularKey  ⇒  a valid tx IS proof of quorum
        ▼
FDC providers attest the validated transaction (only the Merkle root lives on-chain)
        ▼
XrplCouncilBridge.execute(proof, orderData)     ← permissionless: the authority is the proof
   verify → proofOwner == this → sourceHash == council → status == 0
          → memo == keccak256(orderData) → txId not consumed → sequential nonce
        ▼
LegacyVault.<councilFunction>(...)              ← the cage decides what that call may do
```

The bridge holds no funds and has no owner with power. Its only act is to forward an order a
quorum already signed. This is what we mean by *XRPL governs Flare*: not a message-passing
demo, but a family's inheritance rules enforced by a Flare contract that will only move when an
XRPL quorum says so.

---

## 4. The executor — the piece that does the most and decides the least

The executor is the component a reviewer should scrutinise hardest, because it is the only place
where Astryum has an operational role in a user's transaction. So here is all of it.

### Why it exists at all

FAssets direct minting is a two-actor flow by design: the user signs an XRPL Payment whose memo
commits `keccak256(userOpData)`, and **someone** must then deliver the full bytes to
`AssetManagerFXRP.executeDirectMintingWithData(proof, data)` together with an FDC `XRPPayment`
proof. There is no published channel to a Flare operator that would do this for third parties
today, so Astryum runs its own. It is infrastructure we would rather not own — see the end of this
section.

### What it cannot do — enforced by the contract, not by our policy

The contract accepts **only** the exact bytes the memo committed: `keccak256(_data)` must match, and
so must the sender and the nonce. The executor therefore either delivers precisely what the user
signed, or the transaction reverts. It cannot substitute a destination, change an amount, reorder a
batch, or execute a different operation. This is not a promise about our conduct; it is arithmetic.

Its key (`FLARE_EXECUTOR_PK`, environment-only) signs exactly two things: the attestation request to
the FDC Hub, and the execution call. It never holds, moves or touches user funds. It runs behind a
double flag — `FLARE_EXECUTOR_ENABLED` **and** the presence of the key — and simulates every
transaction before signing it.

### What it actually does

A watcher sweeps the FAssets Core Vault and, for every `0xFE` payment that validated but has not yet
executed, resolves the committed bytes (from the persisted handoff store, or by deterministic
reconstruction matched against the memo hash), requests the FDC attestation, and executes. One pass
at a time, with per-transaction backoff so a failing operation cannot burn gas in a hot loop.

### Its own economy — and why that matters for custody

The executor is economically self-sustaining, entirely on Astryum's own funds. It collects its fee
in FXRP — the fee committed in the memo the user signed, and disclosed before they signed it — and
pays the FDC attestation and gas in FLR. When its FLR falls below a threshold, it performs the
`FXRP → WFLR → FLR` swap itself, through a single allowlisted venue (SparkDEX V3) with a maximum
slippage fixed in configuration.

**There is zero discretion here either.** Thresholds, venue and slippage are deterministic config;
the agent applies a formula, it does not choose. Refuelling sits behind its own feature flag, and
approve, swap and unwrap are each simulated before signing. The money involved is Astryum's revenue,
never a user's capital — the same line the treasury respects.

### Three failure modes it is built to close

1. **Gas death spiral.** Refuelling triggers well before the balance is critical, and a hard rescue
   reserve exists: if the remaining FLR would not even cover the gas of the refuel swap itself, the
   executor raises a critical alert instead of burning what is left.
2. **Fee accumulation.** Collected FXRP above a working buffer is swept to the treasury, so the
   executor never sits on a balance larger than its job requires.
3. **A blind operator.** Alerts are pushed to a webhook at info/warn/critical, and the live gauges —
   balances, pending count, oldest pending operation, parked operations, daily fee budget consumed,
   and how many operations today's budget and wallet can still cover — are exposed on a health
   endpoint.

### What it cost us to learn this

On 2026-07-18 the executor burned 244 attestations, at roughly 20 FLR each, retrying three XRPL
payments whose committed bytes were structurally impossible to execute. No amount of retrying could
ever have worked.

The fix is the shape of the code today: aborts are classified as transient or **permanent**, and a
permanent abort fires *before* any attestation is paid for. Structurally unexecutable operations are
parked with a reason rather than retried, and a persisted daily fee budget — shared with the council
relayer — caps the damage any future bug can do in twenty-four hours. That budget, and the number of
operations it still covers, are visible to the operator and to anyone reading the health endpoint.

### The dependency we admit

The executor cannot steal, redirect or alter anything. But if it stops, a signed operation waits
instead of completing. **That is a liveness dependency on Astryum, and we say so plainly.** It is
the last structural reason a user has to care whether our company still exists, and removing it —
making delivery something anyone can perform, with the incentive to do so documented — is on the
roadmap for exactly that reason.

## 5. Three attacks a technical judge will make, answered honestly

**"You only use one FDC attestation type."**
True. We use `XRPPayment` (type `0x08`). It is used in two independent rails, with different
contracts and different relayers, and it is the only type the product needs. We would rather use
one type deeply than five superficially.

**"FTSO never touches your contracts."**
True, and deliberate. The vault accounts in FXRP, not in USD, so putting a price oracle inside it
would add a failure mode without adding a guarantee. FTSO guards margins, sizing and trigger
prices in the backend, and it **fails hard** when no fresh price is available rather than
proceeding on a stale one.

**"You claim the contracts are verified — says who?"**
Says the explorer. The exact verification recipe is committed in `contracts/README.md`, along with
the addresses. Checking it takes about thirty seconds and does not require trusting us.

---

## 6. Verify it yourself

1. Open the public proof page at **astryum.xyz/proof** — contract addresses and settled-operation
   counters, read live from the chain, not from our database.
2. Look up `LegacyStackFactory` at `0xF93A8A0bd93e95514fF02285349b0b1c1a5a3e0a` on a Flare
   explorer. Sources are verified; read `vaultOf()` and see the registry of cages.
3. Read `constitutionRef()` and `feeSchedule()` on the deployed vault and compare them against what
   the product claims.
4. In `contracts/`, run `forge test` — 58 tests, including three fuzzed invariants whose names say
   what they defend: the books are never hollow, people never receive more than the yield that came
   in, and the allocation ledger balances.

---

## 7. What we did not do

We are not competing in the Confidential Compute bounty and there is no FCC or TEE code in this
repository. We mention it because the absence is deliberate: a TEE-managed custody model is the
opposite of the architecture we are defending, and adopting one to win a second bounty would
contradict the invariant this entire product rests on — **Astryum never signs, never custodies,
never executes.**
