/**
 * exchangeConstitutionTemplate — la constitución de un EXCHANGE custodial
 * sobre el raíl (fundador 13-sep: «en la constitución también debe aparecer la
 * r-address que la cuenta raíz acredita como omnibus donde viven los users»).
 *
 * La pieza clave es el Artículo 3: el omnibus aparece como REGLA + dirección
 * inicial — «la caja es la cuenta que sostenga la designación OMNIBUS vigente
 * emitida por esta raíz» — de modo que ROTAR la caja es un acto de designación
 * (visible en el ledger, anunciado a los clientes), no una enmienda
 * constitucional. La jerarquía hecha derecho.
 *
 * Mismas líneas rojas que la del gestor: nada de rentabilidades, Astryum no es
 * parte, jamás pedir aprobaciones sobre participaciones (inv. #18), y solo se
 * promete lo que el contrato hace cumplir o lo que el exchange se obliga.
 * Reutiliza literalmente las cláusulas del gestor que aplican igual (mismas
 * claves de dict); las específicas del exchange son nuevas.
 */

export function buildExchangeConstitution(
  t: (s: string) => string,
  root: string,
  omnibus: string,
  dateISO = new Date().toISOString().slice(0, 10),
): string {
  const art = (n: number, title: string, clauses: string[]) =>
    [`${t('Article')} ${n} — ${title}`, ...clauses.map((c, i) => `${n}.${i + 1} ${c}`)].join('\n');
  const omni = omnibus || '[ … ]';

  return [
    t('CONSTITUTION OF A CUSTODIAL EXCHANGE ON THE RAIL'),
    '',
    `${t('Root XRPL account (the exchange authority)')}: ${root}`,
    `${t('Operating cash account (omnibus), by on-ledger appointment — initial')}: ${omni}`,
    `${t('Exchange (name or entity)')}: [ … ]`,
    `${t('Company registration (KYB) and licence (CASP), as anchored credentials of the root')}: [ … ]`,
    `${t('Jurisdiction of the exchange')}: [ … ]`,
    `${t('Contact')}: [ … ]`,
    `${t('Date')}: ${dateISO}`,
    '',
    t('PREAMBLE'),
    t('This document sets the rules under which the exchange named above holds its clients’ XRP and puts it to work on their behalf. The parts the smart contracts and the XRP Ledger enforce are stated as facts; the rest are commitments the exchange makes and can be held to. Only the fingerprint of this text is anchored on the XRP Ledger; the text itself lives off-chain and anyone can verify it against that fingerprint.'),
    '',
    art(1, t('Object and nature'), [
      t('The exchange offers its clients custody of XRP and, at their request, puts it to work in a grouped vault on Flare governed from the root account above through its cage. Each client is identified inside the exchange by a destination tag.'),
      t('The shares that working capital produces are NEVER the exchange’s: they are minted directly to each client’s own Flare account, and only that client’s signature can move or redeem them.'),
      t('Astryum is the interface that lists the vault and composes the transactions the manager signs. It is not a party to this constitution: it does not sign, does not custody, does not manage capital and does not recommend this vehicle to anyone.'),
    ]),
    '',
    art(2, t('The root — authority and credentials'), [
      t('The exchange is identified by the root account above. Every act of governance — anchoring this document, giving birth to the cage, opening vaults, directing capital, appointing the cash account — carries that account’s signature and is public on the ledger.'),
      t('The root holds, and keeps in force, its credentials as XLS-70 objects: the licence of its sector (CASP) and the registration of its legal vehicle (KYB), each carrying the public register link as its evidence. Whoever relies on them opens the link and checks the register themselves.'),
      t('If the root’s credentials lapse or are revoked, the ledger stops accepting its governance orders; clients’ exits remain unaffected.'),
    ]),
    '',
    art(3, t('The operating cash account — the omnibus'), [
      t('Clients deposit XRP at the omnibus account, identified by their destination tag. The omnibus signs the payments that put capital to work and the payouts back to clients’ own wallets — and nothing else.'),
      t('The omnibus is defined by APPOINTMENT, not by address: it is the account that holds a live OMNIBUS credential issued by the root, renewed periodically. The account named above is the initial appointee.'),
      t('Changing the omnibus is an appointment act — a revocation and a new credential, both public on the ledger — announced to clients in advance. Deposit instructions always name the currently appointed account.'),
      t('Revoking the appointment, or letting it lapse, halts the cash desk: no new capital is put to work and no payout is signed from that account. It never touches a client’s on-chain exit.'),
    ]),
    '',
    art(4, t('Limits of the mandate — the cage'), [
      t('Capital put to work may go ONLY inside the cage: to destinations listed in the venue registry, within the per-destination cap, above the liquidity floor and respecting the exit window. These limits bind the exchange by construction; the contract refuses any order outside them.'),
      t('Adding a destination is a public proposal that waits at least 30 days before a single token can go there. Retiring a destination is immediate and only stops NEW capital from entering it.'),
      t('The exchange does not borrow against the vault, does not pledge its assets, and does not use clients’ working capital for any purpose other than the destinations allowed.'),
      t('The exchange never asks a client to approve the exchange, an operator or any third party over the client’s shares. Any such request is outside this mandate and must be treated as an attack.'),
    ]),
    '',
    art(5, t('Clients’ rights'), [
      t('A client’s shares live in the client’s own account from the first block. The client exits the vault with their OWN signature, without any key, permission or availability of the exchange — that exit is never blocked, never gated and never capped.'),
      t('The value a client redeems returns to the omnibus tagged as theirs and is credited to their balance; on request, the exchange pays it out to the client’s own XRPL wallet.'),
      t('The exit window and the liquidity floor are fixed when the vault is born and cannot be changed afterwards — not by the exchange, not by any council, not by an amendment to this document.'),
      t('Every rule that governs a vault is readable on-chain by anyone, at any time, without asking the exchange.'),
    ]),
    '',
    art(6, t('Custody and compliance'), [
      t('The exchange custodies the XRP balances at the omnibus and keeps the books that attribute them by tag. Its legal duties as custodian — including any freeze the law requires — apply to what it custodies, and only to that: they never reach a client’s shares or their on-chain exit.'),
      t('The exchange verifies its clients before serving them. Verification stays in the exchange’s books; the ledger carries only what is granted — never a refusal, never a document, never personal data.'),
    ]),
    '',
    art(7, t('Fees'), [
      t('Every fee the exchange charges is published and disclosed to the client before they act. No hidden fee.'),
      t('No entry fee, no exit fee, no hidden fee. Whatever the network itself charges (gas, crossing tolls) is disclosed before the depositor signs.'),
    ]),
    '',
    art(8, t('Transparency and reporting'), [
      t('Capital at work, destinations, floor, window and every governance order are facts on the chain. The exchange’s reporting consists of those facts and never of projections.'),
      t('The manager makes no promise of return, guarantees nothing and describes past results, if at all, as what happened — never as what will happen.'),
      t('The exchange publishes a public profile (name, entity, contact, credential links) tied to the root account and keeps it truthful.'),
    ]),
    '',
    art(9, t('Amendments'), [
      t('This document may be amended by anchoring a new fingerprint from the same account. The previous fingerprint remains on the ledger’s history: amendments are visible, not silent.'),
      t('No amendment can change what the contract fixed at birth (exit window, liquidity floor, fee ceiling) nor weaken Articles 3.4 and 5.'),
      t('The exchange announces an amendment to clients before anchoring it, with enough time for anyone who disagrees to exit under the current rules.'),
    ]),
    '',
    art(10, t('Wind-down'), [
      t('The exchange may wind the vault down by retiring all destinations and recalling capital, so every client can exit at pro-rata value and be paid out. The exchange cannot seize, sweep or redirect a client’s shares.'),
      t('If the manager’s credentials lapse, the ledger stops accepting its orders; depositors’ exits remain unaffected.'),
    ]),
    '',
    art(11, t('Applicable law'), [
      t('This constitution is governed by the law of the exchange’s jurisdiction stated above. Nothing in it limits the rights clients have under the law that protects them.'),
      t('Disputes between the manager and a depositor are between them. Astryum is not a party and does not arbitrate.'),
    ]),
    '',
    art(12, t('Anchoring'), [
      t('This document is anchored by its SHA-256 fingerprint on the XRP Ledger, in the DID of the managing account (XLS-40). The text itself never goes on-chain.'),
      t('The canonical copy of the text lives at the URI recorded next to the fingerprint. Any copy that does not match the fingerprint is not this constitution.'),
    ]),
    '',
    `${t('Signed by anchoring from the root account')}: ${root}`,
  ].join('\n');
}
