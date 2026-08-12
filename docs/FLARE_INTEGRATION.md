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
| **FDC** — direct-mint rail | `ESSENTIAL` | live on mainnet | The mint is never released. The user's XRP sits in the Core Vault. |
| **FDC** — council bridge | `MEANINGFUL` | deployed, verified, **executed on mainnet** | Astryum Legacy loses its entire governance model. XRPL could no longer govern a Flare contract. |
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

## 4. Three attacks a technical judge will make, answered honestly

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

## 5. Verify it yourself

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

## 6. What we did not do

We are not competing in the Confidential Compute bounty and there is no FCC or TEE code in this
repository. We mention it because the absence is deliberate: a TEE-managed custody model is the
opposite of the architecture we are defending, and adopting one to win a second bounty would
contradict the invariant this entire product rests on — **Astryum never signs, never custodies,
never executes.**
