/**
 * xrplTxTypeLabel — XRPL TransactionTypes in words a family understands
 * (Fase 1, 2026-07-30). Before this, the proposal inbox titled decisions with
 * `EscrowCreate` / `AccountSet` / `SignerListSet` — a member was asked to sign
 * something named after a ledger opcode. The raw type stays available as the
 * technical marker; this is the sentence a person reads.
 */

export function xrplTxTypeLabel(type: string | null | undefined, t: (s: string) => string): string {
  const MAP: Record<string, string> = {
    Payment: 'Payment — sends XRP',
    EscrowCreate: 'Set XRP aside until a date',
    EscrowFinish: 'Release money that was set aside',
    EscrowCancel: 'Recover money that was set aside',
    AccountSet: 'Account settings — moves no funds',
    SignerListSet: 'Change who signs for this account',
    TrustSet: 'Allow the account to hold a token',
    DIDSet: 'Anchor a document to the account',
    Batch: 'Several operations in one signature',
    OfferCreate: 'Exchange order on the ledger',
    OfferCancel: 'Cancel an exchange order',
    CheckCreate: 'Write a cheque another account can cash',
    CheckCash: 'Cash a cheque',
    CheckCancel: 'Cancel a cheque',
  };
  const key = String(type ?? '');
  return MAP[key] ? t(MAP[key]) : key || '—';
}
