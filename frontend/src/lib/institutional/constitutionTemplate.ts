/**
 * constitutionTemplate — la constitución de un vehículo agrupado gestionado,
 * COMPLETA. Antes eran cuatro líneas; esto son doce artículos que el gestor
 * edita antes de anclar su huella (SHA-256 → DID XLS-40 de su cuenta).
 *
 * Lo que este texto puede prometer es SOLO lo que el contrato hace cumplir o
 * lo que el gestor se obliga a sí mismo. Líneas rojas de la casa: ninguna
 * cifra de rentabilidad, Astryum no es parte (no firma, no custodia, no
 * gestiona, no recomienda), y nada que sugiera que un depositante deba
 * aprobar al gestor sobre sus participaciones (invariante #18).
 *
 * Los corchetes [ … ] son huecos que el gestor rellena. Se traduce clausula a
 * clausula con t(): el documento sale en el idioma de la interfaz.
 */

export function buildConstitution(t: (s: string) => string, account: string, dateISO = new Date().toISOString().slice(0, 10)): string {
  const art = (n: number, title: string, clauses: string[]) =>
    [`${t('Article')} ${n} — ${title}`, ...clauses.map((c, i) => `${n}.${i + 1} ${c}`)].join('\n');

  return [
    t('CONSTITUTION OF A MANAGED GROUPED VEHICLE'),
    '',
    `${t('Managing XRPL account')}: ${account}`,
    `${t('Manager (name or entity)')}: [ … ]`,
    `${t('Jurisdiction of the manager')}: [ … ]`,
    `${t('Contact')}: [ … ]`,
    `${t('Date')}: ${dateISO}`,
    '',
    t('PREAMBLE'),
    t('This document sets the rules under which the account named above manages capital that other people deposit in the grouped vaults it governs. The parts the smart contract enforces are stated as facts; the rest are commitments the manager makes and can be held to. Only the fingerprint of this text is anchored on the XRP Ledger; the text itself lives off-chain and anyone can verify it against that fingerprint.'),
    '',
    art(1, t('Object and nature'), [
      t('The vehicle is a set of grouped, pro-rata vaults deployed on Flare and governed from the XRPL account above (the “manager”). Each vault issues standard shares to whoever deposits; each share represents a proportional part of the vault’s assets.'),
      t('The vehicle is non-custodial. Depositors hold their shares in their own wallets at all times. Neither the manager nor Astryum ever holds, moves or can move a depositor’s shares.'),
      t('Astryum is the interface that lists the vault and composes the transactions the manager signs. It is not a party to this constitution: it does not sign, does not custody, does not manage capital and does not recommend this vehicle to anyone.'),
    ]),
    '',
    art(2, t('The manager'), [
      t('The manager is identified by the XRPL account above. Every order to the vaults carries that account’s signature and is public on the ledger.'),
      t('The manager holds, and keeps in force, the credentials the ledger requires to run grouped vaults (identity and licence, XLS-70), issued by an accredited third party — never by Astryum and never by the manager itself.'),
      t('The manager acts with the diligence of a professional entrusted with other people’s capital, and in the sole interest of the depositors as a whole.'),
    ]),
    '',
    art(3, t('Limits of the mandate — the cage'), [
      t('The manager may direct capital ONLY inside the cage: to destinations listed in the venue registry, within the per-destination cap, above the liquidity floor and respecting the exit window. These limits bind the manager by construction; the contract refuses any order outside them.'),
      t('Adding a destination is a public proposal that waits at least 30 days before a single token can go there. Retiring a destination is immediate and only stops NEW capital from entering it.'),
      t('The manager does not borrow against the vault, does not pledge its assets, does not lend them outside the cage and does not use them for any purpose other than the destinations allowed.'),
      t('The manager never asks a depositor to approve the manager, a director or any third party over the depositor’s shares. Any such request is outside this mandate and must be treated as an attack.'),
    ]),
    '',
    art(4, t('Depositors’ rights'), [
      t('Exits are never blocked, never gated and never capped. A depositor who asks to leave receives the pro-rata value of their shares after the exit window fixed at the vault’s birth.'),
      t('The exit window and the liquidity floor are fixed when the vault is born and cannot be changed afterwards — not by the manager, not by any council, not by an amendment to this document.'),
      t('The liquidity floor exists for depositors: redemptions may draw on it; the manager may not.'),
      t('Every rule that governs a vault is readable on-chain by anyone, at any time, without asking the manager.'),
    ]),
    '',
    art(5, t('Fees'), [
      t('The manager’s fee applies to yield only — never to principal. A vault that produced nothing charges nothing.'),
      t('The ceiling of the fee is fixed at the vault’s birth and cannot be raised. The rate actually applied is published on-chain and is always at or below that ceiling.'),
      t('No entry fee, no exit fee, no hidden fee. Whatever the network itself charges (gas, crossing tolls) is disclosed before the depositor signs.'),
    ]),
    '',
    art(6, t('Transparency and reporting'), [
      t('Capital, destinations, floor, window, fee and every order are facts on the chain. The manager’s reporting consists of those facts and never of projections.'),
      t('The manager makes no promise of return, guarantees nothing and describes past results, if at all, as what happened — never as what will happen.'),
      t('The manager publishes a public profile (name, entity, contact) tied to this account and keeps it truthful.'),
    ]),
    '',
    art(7, t('Conflicts of interest'), [
      t('The manager discloses any interest it holds in a destination before proposing it, and never proposes a destination it controls without saying so in the proposal.'),
      t('The manager does not front-run, does not trade against the vault and does not use information from the vault for its own account.'),
    ]),
    '',
    art(8, t('Delegation'), [
      t('The manager may name a director — an EVM address allowed to move capital inside the cage — for a fixed term that expires by itself and never renews on its own. The manager remains responsible for everything the director does.'),
      t('The manager can revoke a director at any time. A director cannot change any rule, add a destination, touch fees or affect a depositor’s exit.'),
    ]),
    '',
    art(9, t('Amendments'), [
      t('This document may be amended by anchoring a new fingerprint from the same account. The previous fingerprint remains on the ledger’s history: amendments are visible, not silent.'),
      t('No amendment can change what the contract fixed at birth (exit window, liquidity floor, fee ceiling) nor weaken Article 4.'),
      t('The manager announces an amendment to depositors before anchoring it, with enough time for anyone who disagrees to exit under the current rules.'),
    ]),
    '',
    art(10, t('Wind-down'), [
      t('The manager may wind a vault down by retiring all destinations and recalling capital to the vault, so every depositor can exit at pro-rata value. The manager cannot seize, sweep or redirect that capital.'),
      t('If the manager’s credentials lapse, the ledger stops accepting its orders; depositors’ exits remain unaffected.'),
    ]),
    '',
    art(11, t('Applicable law'), [
      t('This constitution is governed by the law of the manager’s jurisdiction stated above. Nothing in it limits the rights depositors have under the law that protects them.'),
      t('Disputes between the manager and a depositor are between them. Astryum is not a party and does not arbitrate.'),
    ]),
    '',
    art(12, t('Anchoring'), [
      t('This document is anchored by its SHA-256 fingerprint on the XRP Ledger, in the DID of the managing account (XLS-40). The text itself never goes on-chain.'),
      t('The canonical copy of the text lives at the URI recorded next to the fingerprint. Any copy that does not match the fingerprint is not this constitution.'),
    ]),
    '',
    `${t('Signed by anchoring from the managing account')}: ${account}`,
  ].join('\n');
}
