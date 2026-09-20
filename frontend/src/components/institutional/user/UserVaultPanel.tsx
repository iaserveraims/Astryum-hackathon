'use client';

/**
 * UserVaultPanel — el cliente, con Face ID, de punta a punta: elige un vault,
 * mete FXRP, redime, o envía a una wallet externa suya. Cada acción = UNA
 * firma con la cara (usePasskeyActions.signAndRelay), portada por el relayer
 * del operador. Nunca ve una wallet ni FLR.
 *
 * Las calls se componen aquí (approve+deposit / FXRP.transfer) o en el backend
 * (redeem con el fee-leg de Astryum / desminteo), y el contrato/relayer
 * garantizan que la firma las compromete: el cliente firma exactamente lo que ve.
 *
 * productizer 14-sep (invariante #6): se preparaba y se firmaba de un tirón, y
 * la disclosure del redeem (con la fee de Astryum) y la del desminteo se tiraban
 * antes de firmar. Ahora es preparar → revisar → Face ID sobre las MISMAS calls
 * revisadas (lib/demo-exchange/clientExitPlan · buildVaultActionReview).
 *
 * productizer it. 25 (§1 y §4) — LA NEGATIVA DEL SERVIDOR, EN LA PANTALLA DEL
 * CLIENTE DE EMAIL. Las dos salidas por backend (redeem y desminteo) hacían
 * `throw new Error(res.refusal.detail ?? res.refusal.error)`: el `detail` de este
 * router se compone en castellano y el `error` es el slug crudo
 * (`NOT_REDEEMABLE_NOW`, `BELOW_FASSETS_MINIMUM`, `PROOF_STORE_UNREADABLE`…), así
 * que esa persona — la que entró con email y Face ID, la que NO tiene una wallet
 * probada — leía un identificador o un idioma que la pantalla no habla, y nunca
 * un botón. Ahora el rechazo se guarda entero, la frase la escribe el lector
 * compartido (`refusalHeadline`, que conoce las familias) con el `detail` solo si
 * viene en inglés, y el aviso compartido pone el camino cuando lo hay: reintento
 * sobre un «no pude leer» nuestro, y la puerta de la wallet sobre los dos 409
 * deterministas. Nada de esto gatea la salida: la negativa ya es del servidor.
 */

import { useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import { ArrowDownToLine, ArrowUpFromLine, Loader2, Send, ScanFace, Coins } from 'lucide-react';
import { useT } from '../../../i18n/LanguageProvider';
import { usePasskeyActions } from '../../../lib/institutional/usePasskeyActions';
import { getPoteState, prepareRedeem, preparePoteExitXrp, type PoteState, type Refusal } from '../../../lib/institutional/api';
import { fmtBase, parseAmountToBase, type PolicyCard } from '../../../lib/institutional/policyCatalog';
import { useCatalogPolicies } from '../../../lib/institutional/useCatalogPolicies';
import type { Call } from '../../../lib/institutional/passkey';
import { passkeyRelayFailureAction } from '../../../lib/institutional/passkeyRelayOutcome';
import { applySignAction, type UnconfirmedSignature } from '../../../lib/wallet/signOutcome';
import {
  buildVaultActionReview,
  exitFeeStatement,
  fillParams,
  redemptionFeeSentence,
  vaultFeeSentence,
  type VaultActionReview,
} from '../../../lib/demo-exchange/clientExitPlan';
import { UnconfirmedSignatureNotice } from '../../settlement/UnconfirmedSignatureNotice';
import { refusalHeadline, serverDetailIfEnglish } from '../../../lib/xaman/seatRefusal';
import { SeatRefusalNotice, seatRefusalView } from '../../wallet/SeatRefusalNotice';

// 'unmint' = salir a XRP nativo con el tag del user (round-trip custodial);
// 'send' = mover FXRP a otra wallet de Flare (soberano).
type Verb = 'deposit' | 'redeem' | 'unmint' | 'send';
const XRPL_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

const FXRP_IFACE = new ethers.Interface([
  'function approve(address spender, uint256 amount)',
  'function transfer(address to, uint256 amount)',
]);
const POTE_IFACE = new ethers.Interface([
  'function deposit(uint256 assets, address receiver) returns (uint256)',
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256)',
  'function requestRedeem(uint256 shares, address receiver) returns (uint256)',
]);
const EVM_RE = /^0x[a-fA-F0-9]{40}$/;

/** What was reviewed: the exact calls Face ID will sign, and what was said about them. */
interface PreparedAction {
  calls: Call[];
  review: VaultActionReview;
}

/**
 * A refusal the backend sent, carried as an error so `compose()` keeps its one
 * exit path — with the whole refusal attached, because the sentence is only
 * half of what a person needs: the other half is the button, and only the
 * refusal itself knows whether there is one.
 */
class VaultRefusalError extends Error {
  readonly refusal: Refusal;
  constructor(refusal: Refusal, message: string) {
    super(message);
    this.name = 'VaultRefusalError';
    this.refusal = refusal;
  }
}

/**
 * The refusal in ONE English sentence: the shared reader's (it knows the seat
 * codes, the retryable read failures and the two deterministic 409s), plus the
 * server's own `detail` only when it is English. Never the slug, never the
 * Spanish paragraph, and never an empty line — a gap explains nothing either.
 */
function refusalSentence(refusal: Refusal, t: (s: string) => string): string {
  const head =
    refusalHeadline(refusal, t) ??
    t('The server refused this operation. Nothing was prepared and nothing was signed.');
  // `?? ''` y no un hueco: sin frase inglesa del servidor queda la nuestra, que
  // es el patrón de las demás superficies de salida (PoteExitCard, it. 23).
  const detail = serverDetailIfEnglish(refusal.detail) ?? '';
  return detail && detail !== head ? `${head} ${detail}` : head;
}

export function UserVaultPanel({ account }: { account: string }) {
  const { t } = useT();
  const { signAndRelay, state } = usePasskeyActions();
  const { policies } = useCatalogPolicies();

  const [policy, setPolicy] = useState<PolicyCard | null>(policies[0] ?? null);
  // El catálogo llega de la cadena después del primer render: la primera
  // tarjeta se elige cuando existe, y solo si el usuario no eligió ya.
  useEffect(() => {
    if (!policy && policies.length > 0) setPolicy(policies[0]);
  }, [policies, policy]);
  const [pote, setPote] = useState<PoteState | null>(null);
  const [verb, setVerb] = useState<Verb>('deposit');
  const [amount, setAmount] = useState('');
  const [dest, setDest] = useState('');
  const [notice, setNotice] = useState('');
  // it. 25 (§4): the refusal itself, not just its sentence — the shared notice
  // reads it to offer the path that exists (a retry over a read of ours that
  // failed; the wallet door over the two deterministic 409s). Null for anything
  // that is not a server refusal: a bad amount is not a refusal.
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [txUrl, setTxUrl] = useState('');
  // A Face ID batch whose relay answer we could not read AFTER it left the
  // browser (a 500 RELAY_FAILED after executeBatch, a proxy 5xx, a dropped
  // connection): the transfer or exit may already be on Flare. The amber notice
  // replaces the action button — a second Face ID would be a second movement.
  const [unconfirmed, setUnconfirmed] = useState<UnconfirmedSignature | null>(null);
  // Closing the notice re-reads the vault, so the balance says what happened.
  const [readSeq, setReadSeq] = useState(0);
  // Step 1's result. Face ID signs exactly these calls — never a recomposition.
  const [prepared, setPrepared] = useState<PreparedAction | null>(null);
  const [preparing, setPreparing] = useState(false);

  // Anything that would change the composition invalidates what was reviewed.
  useEffect(() => {
    setPrepared(null);
  }, [verb, amount, dest, policy?.key, account]);

  useEffect(() => {
    if (!policy) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await getPoteState(policy.poteAddress, account);
        if (!cancelled) setPote(s);
      } catch {
        if (!cancelled) setPote(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [policy, account, txUrl, readSeq]);

  const shares = BigInt(pote?.holder?.shares ?? '0');
  const estValue = useMemo(() => {
    if (!pote || BigInt(pote.totalSupply) === BigInt(0)) return BigInt(0);
    return (shares * BigInt(pote.totalAssets)) / BigInt(pote.totalSupply);
  }, [pote, shares]);

  /** Step 1: compose (here or in the backend) and build what is said before Face ID. */
  async function compose(): Promise<PreparedAction> {
    if (!pote) throw new Error(t('Reading the vault…'));
    const dec = pote.asset.decimals;
    const symbol = pote.asset.symbol;
    if (verb === 'deposit') {
      const amt = parseAmountToBase(amount, dec);
      if (!amt) throw new Error(t('Amount must be greater than 0'));
      return {
        calls: [
          { target: pote.asset.address, value: '0', data: FXRP_IFACE.encodeFunctionData('approve', [pote.pote, amt]) },
          { target: pote.pote, value: '0', data: POTE_IFACE.encodeFunctionData('deposit', [amt, account]) },
        ],
        review: buildVaultActionReview({ verb, amount: fmtBase(amt, dec), symbol }),
      };
    }
    if (verb === 'redeem') {
      if (shares <= BigInt(0)) throw new Error(t('You hold no shares of this vault'));
      // Por el backend → aplica el fee-leg de Astryum y la disclosure. El receiver
      // y el owner son la propia cuenta del cliente.
      const res = await prepareRedeem({ pote: pote.pote, sharesBase: shares.toString(), receiver: account, owner: account });
      if (!res.ok) throw new VaultRefusalError(res.refusal, refusalSentence(res.refusal, t));
      // The figure said is what lands: the backend's fixed amount on a request
      // pote, otherwise the estimate net of the fee tranche it composed.
      const fee = exitFeeStatement(res.data);
      const net = fee.kind === 'charged' ? estValue - (estValue * BigInt(fee.bps)) / BigInt(10000) : estValue;
      const shown = res.data.mode === 'request' && res.data.estAssetsBase ? BigInt(res.data.estAssetsBase) : net;
      return {
        calls: res.data.calls.map((c) => ({ target: c.to, value: c.value, data: c.data })),
        review: buildVaultActionReview({ verb, response: res.data, amount: fmtBase(shown, dec), symbol }),
      };
    }
    if (verb === 'unmint') {
      // Salir a XRP nativo con el tag del user. El backend saca el tag del
      // registro on-chain (pote.userGate → tagOf) — no se teclea. El destino es
      // el omnibus del exchange.
      const to = dest.trim();
      if (!XRPL_RE.test(to)) throw new Error(t('The XRPL destination address is not valid'));
      const amt = parseAmountToBase(amount, dec);
      if (!amt) throw new Error(t('Amount must be greater than 0'));
      const res = await preparePoteExitXrp({ amountFxrpBase: amt.toString(), xrplDestination: to, pote: pote.pote, holder: account });
      if (!res.ok) throw new VaultRefusalError(res.refusal, refusalSentence(res.refusal, t));
      const c = res.data.call;
      const tagged = typeof res.data.tag === 'number' ? `${to} (tag ${res.data.tag})` : to;
      return {
        calls: [{ target: c.to, value: c.value, data: c.data }],
        review: buildVaultActionReview({ verb, response: res.data, amount: fmtBase(amt, dec), symbol, destination: tagged }),
      };
    }
    // send: transferir FXRP de la cuenta del cliente a su wallet externa (Flare)
    const to = dest.trim();
    if (!EVM_RE.test(to)) throw new Error(t('The destination wallet address is not valid'));
    const amt = parseAmountToBase(amount, dec);
    if (!amt) throw new Error(t('Amount must be greater than 0'));
    return {
      calls: [{ target: pote.asset.address, value: '0', data: FXRP_IFACE.encodeFunctionData('transfer', [to, amt]) }],
      review: buildVaultActionReview({ verb, amount: fmtBase(amt, dec), symbol, destination: to }),
    };
  }

  async function prepare() {
    if (unconfirmed) return;
    setNotice('');
    setRefusal(null);
    setTxUrl('');
    setPrepared(null);
    setPreparing(true);
    try {
      // Nothing leaves the browser signed here: every failure is a plain error,
      // said in this screen's language — never the server's slug and never its
      // Spanish paragraph (`refusalSentence`).
      setPrepared(await compose());
    } catch (e) {
      setNotice((e as Error).message);
      // A refusal keeps its body so the notice below can offer its way out.
      setRefusal(e instanceof VaultRefusalError ? e.refusal : null);
    } finally {
      setPreparing(false);
    }
  }

  /** Step 2: the reviewed calls, exactly as shown, signed with Face ID. */
  async function confirm() {
    const pending = prepared;
    if (!pending || unconfirmed) return;
    setNotice('');
    setRefusal(null);
    setTxUrl('');
    // Marked by signAndRelay right before the signed batch is POSTed to the relay.
    let handedOff = false;
    try {
      const res = await signAndRelay(pending.calls, { onHandOff: () => { handedOff = true; } });
      setPrepared(null);
      setTxUrl(`https://flarescan.com/tx/${res.execTxHash}`);
      setNotice(
        pending.review.verb === 'unmint'
          ? t('Burned on Flare — verified on the blockchain. The XRP arrives when the FAssets agent pays it (minutes to hours).')
          : t('Done — verified on the blockchain.'),
      );
    } catch (e) {
      if (!handedOff) {
        // Reading the account or Face ID itself: the signed batch never left the
        // browser. The reviewed calls stay on screen to confirm again.
        setNotice((e as Error).message);
        return;
      }
      // After the hand-off only a relay refusal that PROVES nothing was
      // broadcast (400 / 409) keeps the button; anything else ends amber.
      applySignAction(passkeyRelayFailureAction(e, handedOff, t), {
        setError: setNotice,
        setUnconfirmed: (u) => {
          setUnconfirmed(u);
          // An ending we could not read: the reviewed batch is NOT offered again.
          if (u) setPrepared(null);
        },
        setPhase: () => {},
        // The relay refused it: the composed batch is spent — review again.
        clearPrepared: () => setPrepared(null),
      });
    }
  }

  if (policies.length === 0) {
    return <p className="text-xs text-ink/50">{t('No vaults are available on this environment yet.')}</p>;
  }

  const busy = state.busy || preparing;
  // Does this refusal belong to a family the shared notice can act on?
  const refusalPath = refusal ? seatRefusalView(refusal, t) !== null : false;
  const review = prepared?.review ?? null;
  const feeLine = review ? vaultFeeSentence(review.verb, review.fee) : null;
  const redemptionLine = review?.redemptionFee ? redemptionFeeSentence(review.redemptionFee) : null;

  return (
    <div className="space-y-5 max-w-md">
      <div className="rounded-xl border border-ink/10 bg-surface-2 p-3 text-xs text-ink/70 space-y-1">
        <div className="flex items-center gap-2">
          {t('Your account')}:{' '}
          <span className="font-mono break-all select-all">{account}</span>
          <button
            onClick={() => navigator.clipboard?.writeText(account)}
            className="shrink-0 text-volt underline"
          >
            {t('Copy')}
          </button>
        </div>
        {pote && (
          <div>· {t('you hold')} <span className="font-mono">{fmtBase(estValue, pote.asset.decimals)} {pote.asset.symbol}</span></div>
        )}
      </div>

      <div>
        <div className="text-xs text-ink/50 mb-1">{t('Vault')}</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {policies.map((p) => (
            <button
              key={p.key}
              onClick={() => setPolicy(p)}
              className={`rounded-xl border p-3 text-left ${policy?.key === p.key ? 'border-volt' : 'border-ink/10'}`}
            >
              <div className="text-sm font-semibold text-ink">{t(p.title)}</div>
              <div className="text-xs text-ink/50">{t(p.exitLine)}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        {(
          [
            ['deposit', t('Add'), ArrowDownToLine],
            ['redeem', t('Take out'), ArrowUpFromLine],
            ['unmint', t('To XRP'), Coins],
            ['send', t('Send'), Send],
          ] as Array<[Verb, string, typeof Send]>
        ).map(([v, lbl, Icon]) => (
          <button
            key={v}
            onClick={() => setVerb(v)}
            className={`flex-1 rounded-lg border py-2 text-xs font-semibold inline-flex items-center justify-center gap-1 ${verb === v ? 'border-volt text-volt' : 'border-ink/10 text-ink/60'}`}
          >
            <Icon className="w-3.5 h-3.5" /> {lbl}
          </button>
        ))}
      </div>

      {verb !== 'redeem' && (
        <label className="block text-xs text-ink/60">
          {t('Amount')} ({pote?.asset.symbol ?? 'FXRP'})
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.0" className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink" />
        </label>
      )}
      {verb === 'send' && (
        <label className="block text-xs text-ink/60">
          {t('Your external wallet address')}
          <input value={dest} onChange={(e) => setDest(e.target.value)} placeholder="0x…" className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink font-mono" />
        </label>
      )}
      {verb === 'unmint' && (
        <label className="block text-xs text-ink/60">
          {t('Exchange XRPL address (your XRP comes back here, with your tag)')}
          <input value={dest} onChange={(e) => setDest(e.target.value)} placeholder="r…" className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink font-mono" />
          <span className="mt-1 block text-[10px] text-ink/40">{t('The destination tag comes from the exchange registry on-chain — not typed.')}</span>
        </label>
      )}
      {verb === 'redeem' && pote && (
        <p className="text-xs text-ink/60">
          {pote.cooldownSeconds === 0
            ? t('Immediate exit: the vault unwinds itself inside your transaction.')
            : t('This vault has a cooldown. Your shares burn now and the amount is fixed; you claim it when the clock ends. Nobody can stop it.')}
        </p>
      )}

      {unconfirmed ? (
        <UnconfirmedSignatureNotice
          rail="evm"
          chainId={14}
          unconfirmed={unconfirmed}
          onClose={() => {
            setUnconfirmed(null);
            setReadSeq((n) => n + 1);
          }}
        />
      ) : prepared && review ? (
        <div data-testid="vault-action-review" className="rounded-xl border border-volt/30 bg-surface-2 p-3 space-y-2 text-xs">
          <div className="font-semibold text-ink">{t('Before Face ID — what this signature does')}</div>
          <p className="text-ink/80">{fillParams(t(review.headline), review.headlineParams)}</p>
          {feeLine ? <p className="text-ink/70">{fillParams(t(feeLine.text), feeLine.params)}</p> : null}
          {redemptionLine ? (
            <p className={review.redemptionFee?.kind === 'unreadable' ? 'text-tone-warning' : 'text-ink/70'}>
              {fillParams(t(redemptionLine.text), redemptionLine.params)}
            </p>
          ) : null}
          {review.disclosures.map((d, i) => (
            <div key={`${d.title}-${i}`} className="rounded-lg border border-ink/10 p-2">
              <div className="font-semibold text-ink/90">{d.title}</div>
              <ul className="mt-1 list-disc pl-4 space-y-0.5 text-ink/70">
                {d.lines.map((l, j) => <li key={j}>{l}</li>)}
              </ul>
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <button
              onClick={confirm}
              disabled={busy}
              className="flex-1 rounded-lg bg-volt text-black font-semibold py-2.5 text-sm disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {state.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanFace className="w-4 h-4" />}
              {t('Confirm with Face ID')}
            </button>
            <button
              onClick={() => setPrepared(null)}
              disabled={busy}
              className="rounded-lg border border-ink/10 px-3 text-xs text-ink/60 hover:text-ink disabled:opacity-50"
            >
              {t('Back')}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={prepare}
          disabled={busy}
          className="w-full rounded-lg bg-volt text-black font-semibold py-2.5 text-sm disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanFace className="w-4 h-4" />}
          {verb === 'deposit'
            ? t('Review the deposit')
            : verb === 'redeem'
              ? t('Review the exit')
              : verb === 'unmint'
                ? t('Review the exit to XRP')
                : t('Review the send')}
        </button>
      )}

      {/* it. 25 (§4): when the refusal is one of the families that HAS a path —
          a read of ours that failed (retry) or the two deterministic 409s (the
          wallet door) — the shared notice says it and offers the button, so the
          sentence is not repeated above it. Anything else keeps the plain line. */}
      {refusalPath ? (
        <SeatRefusalNotice refusal={refusal} t={t} onPrepareAgain={() => void prepare()} />
      ) : notice ? (
        <p className="text-xs text-ink/70">{notice}</p>
      ) : null}
      {txUrl && (
        <a href={txUrl} target="_blank" rel="noreferrer" className="text-xs text-volt underline">
          {t('See it on the explorer')}
        </a>
      )}
    </div>
  );
}
