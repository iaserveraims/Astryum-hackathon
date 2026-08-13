# Security Policy

Astryum runs on **Flare Mainnet and XRPL Mainnet with real capital**. We take reports seriously
and we answer them.

## The honest baseline

- **Nothing in this repository has been externally audited.** That includes the Solidity contracts
  (`LegacyVault`, `XrplCouncilBridge`, `LegacyStackFactory`), the backend, and the frontend.
  External review of the contracts is the first item on our [roadmap](docs/ROADMAP.md), and until
  it happens our stated policy is founder capital only, in small amounts.
- The deployed contracts are **immutable** — no proxy, no upgrade path. A confirmed vulnerability
  in a deployed contract cannot be patched; it is mitigated operationally and migrated away from.
  That makes your report more valuable, not less.
- Astryum never holds user keys or user funds. The most sensitive assets in scope are the
  integrity of the prepare-only boundary (unsigned payloads only), the executor's own operational
  wallet, and the correctness of what users are shown before they sign.

## Reporting a vulnerability

**Email: astryum@astryum.xyz** — subject line starting with `[SECURITY]`.

Please include what you found, where (file, endpoint, contract address), how to reproduce it, and
what you believe the impact is. If it involves a deployed contract, include the chain and address.

- You will get an acknowledgement within **72 hours**.
- We will tell you what we conclude and what we are doing about it. If we ship a fix, you will
  know before the public does.
- If you want credit, you will be credited. If you want anonymity, you will have it.

**Please do not open a public GitHub issue for a vulnerability**, and do not test against accounts
or capital that are not your own.

## Scope

In scope: this repository's code, the deployed contracts listed in
[docs/HACKATHON_SUBMISSION.md](docs/HACKATHON_SUBMISSION.md), the API surface behind
`astryum.xyz`, and the correctness of any figure or disclosure the product shows before a
signature.

Out of scope: the third-party protocols Astryum composes transactions for (Kinetic, Firelight,
SparkDEX, FAssets, and others — report those upstream), denial-of-service against public
endpoints, and social engineering.

## Safe harbour

If you research in good faith — no access to data that is not yours, no degradation of service for
others, no capital moved that you do not own, and a report to us before any disclosure — we will
not pursue legal action against you and we will work with you. Good-faith research is a service to
our users, and we treat it as one.

## No bug bounty yet

There is currently no paid bounty programme. If that changes it will be announced here first.
