'use client';

/**
 * /proof — "La prueba" (founder 2026-07-29): the trust section that asks for
 * none. One idea told at three depths: (1) the lock — you sign a fingerprint
 * and the chain re-checks it, so nothing you didn't sign can ever run; (2) who
 * is who — the four pieces on the money's path, three of them Flare's, one
 * ours, each with its live address and explorer link; (3) verify it yourself —
 * a real settled operation whose fingerprint the visitor recomputes IN THEIR
 * OWN BROWSER. Closed by the honest block: what we cannot promise.
 *
 * Data: GET /api/platform/trust (public) — addresses resolved live from the
 * chain so this page can never drift from production, plus the latest settled
 * 0xFE operation (bytes already public on-chain). No hardcoded addresses here,
 * ever: a stale proof page would be worse than none.
 *
 * Copy doctrine (GLOSSARY §6): no guarantee language — the page shows the
 * mechanism and lets the visitor conclude; the "what we cannot promise" block
 * is load-bearing, not a disclaimer.
 */

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import SubpageShell from './SubpageShell';
import LiveActivity from './LiveActivity';
import { BORDER, GOLD, MaskLines, Reveal, SpotlightCard } from './interactions';
import { T, type Lang } from './useLang';
import { getApiBase } from '@/lib/env';

const GOLD_SOFT = '#E8C25A';
// Legacy's indigo family — same hexes as the journey's governed palette.
const INDIGO = '#828DF8';
const INDIGO_SOFT = '#A5B1FD';
const CARD_STYLE = { border: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.02)' } as const;
const MONO = { fontFamily: 'var(--font-mono, monospace)' } as const;

const XRPL_ACCOUNT = (a: string) => `https://livenet.xrpl.org/accounts/${a}`;
const XRPL_TX = (h: string) => `https://livenet.xrpl.org/transactions/${h}`;
const FLARE_ADDRESS = (a: string) => `https://flare-explorer.flare.network/address/${a}`;
const FLARE_TX = (h: string) => `https://flare-explorer.flare.network/tx/${h}`;

// ── /api/platform/trust payload ──────────────────────────────────────────────
interface TrustPath {
  coreVaultXrpl: string | null;
  assetManagerFxrp: string | null;
  masterAccountController: string | null;
  executor: string | null;
}
interface TrustSample {
  at: string | null;
  xrp: number | null;
  userOpHash: string;
  userOpData: string;
  memoHex: string;
  xrplTxHash: string | null;
  flareTxHash: string | null;
}
interface TrustLegacy {
  chain: string;
  vault: string;
  bridge: string;
  orderAnchor: string;
  constitutionRef: string | null;
  ordersExecuted: number | null;
  sample: {
    at: string | null;
    action: string | null;
    xrplTxHash: string | null;
    flareTxHash: string | null;
  } | null;
}
interface TrustPayload {
  path: TrustPath;
  sample: TrustSample | null;
  legacy: TrustLegacy | null;
  updatedAt: string;
}

// ── Block 2 · the lock, in four steps ────────────────────────────────────────
const LOCK_STEPS = (lang: Lang) => [
  {
    title: T('Revisas la orden', 'You review the order', lang),
    body: T(
      'Astryum prepara la transacción sin firmar y te la enseña entera: qué hace, a dónde va y qué cuesta. Nada viaja todavía.',
      'Astryum prepares the unsigned transaction and shows you all of it: what it does, where it goes and what it costs. Nothing travels yet.',
      lang,
    ),
  },
  {
    title: T('Firmas una huella', 'You sign a fingerprint', lang),
    body: T(
      'Al firmar en tu wallet, la firma lleva grabada la huella de la orden — su resumen matemático único. Cambiar un solo byte cambia la huella entera.',
      'When you sign in your wallet, the signature carries the order’s fingerprint — its unique mathematical digest. Changing a single byte changes the whole fingerprint.',
      lang,
    ),
  },
  {
    title: T('Flare la recalcula', 'Flare recomputes it', lang),
    body: T(
      'Antes de ejecutar, el contrato de Flare vuelve a calcular la huella de la orden que le llega y la compara con la que tú firmaste.',
      'Before executing, the Flare contract recomputes the fingerprint of the order it receives and compares it with the one you signed.',
      lang,
    ),
  },
  {
    title: T('Si no cuadra, no existe', 'No match, no trade', lang),
    body: T(
      'Un solo byte distinto — también si fuera nuestro — y la red rechaza la operación. Solo se puede entregar exactamente lo que firmaste, o nada.',
      'A single different byte — ours included — and the network rejects the operation. Only exactly what you signed can be delivered, or nothing at all.',
      lang,
    ),
  },
];

// ── Block 3 · who is who on the path ─────────────────────────────────────────
type PathOwner = 'flare' | 'fassets' | 'astryum';
interface PathPieceDef {
  key: keyof TrustPath;
  chain: 'xrpl' | 'flare';
  owner: PathOwner;
  name: string;
  role: (lang: Lang) => string;
}

const PATH_PIECES: PathPieceDef[] = [
  {
    key: 'coreVaultXrpl',
    chain: 'xrpl',
    owner: 'fassets',
    name: 'Core Vault',
    role: (lang) =>
      T(
        'La cuenta XRPL del protocolo FAssets que recibe tu XRP cuando entra en Flare. Su dirección se lee del protocolo en cada operación — nunca la escribimos a mano.',
        'The FAssets protocol’s XRPL account that receives your XRP on its way into Flare. Its address is read from the protocol on every operation — we never type it by hand.',
        lang,
      ),
  },
  {
    key: 'assetManagerFxrp',
    chain: 'flare',
    owner: 'flare',
    name: 'AssetManagerFXRP',
    role: (lang) =>
      T(
        'El contrato del protocolo FAssets que convierte tu XRP en FXRP — su representación en Flare — directamente en tu cuenta. No en la nuestra.',
        'The FAssets protocol contract that turns your XRP into FXRP — its representation on Flare — directly in your account. Not in ours.',
        lang,
      ),
  },
  {
    key: 'masterAccountController',
    chain: 'flare',
    owner: 'flare',
    name: 'MasterAccountController',
    role: (lang) =>
      T(
        'El contrato de Flare que compara la huella que firmaste con la orden recibida. Es el candado: si no cuadran, la operación no pasa.',
        'The Flare contract that compares the fingerprint you signed with the order it receives. It is the lock: if they don’t match, the operation does not pass.',
        lang,
      ),
  },
  {
    key: 'executor',
    chain: 'flare',
    owner: 'astryum',
    name: 'Executor',
    role: (lang) =>
      T(
        'La única pieza nuestra del camino: entrega tu orden ya firmada y paga el gas de la red. No puede editarla ni redirigirla — el candado de la pieza anterior lo impide.',
        'The only piece of the path that is ours: it delivers your already-signed order and pays the network gas. It cannot edit or redirect it — the lock in the previous piece forbids it.',
        lang,
      ),
  },
];

function ownerChip(owner: PathOwner, lang: Lang): { label: string; style: React.CSSProperties } {
  if (owner === 'astryum') {
    return {
      label: T('nuestra', 'ours', lang),
      style: { background: 'rgba(201,162,39,0.14)', color: GOLD_SOFT, border: `1px solid rgba(201,162,39,0.35)` },
    };
  }
  return {
    label: owner === 'flare' ? T('de Flare', 'Flare’s', lang) : T('de FAssets', 'FAssets’', lang),
    style: { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.55)', border: `1px solid ${BORDER}` },
  };
}

/** Address in mono, truncated middle, with copy + explorer link. */
function AddressRow({
  address,
  href,
  lang,
  accent = GOLD,
  accentSoft = GOLD_SOFT,
}: {
  address: string | null;
  href: string | null;
  lang: Lang;
  accent?: string;
  accentSoft?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    if (!address) return;
    void navigator.clipboard?.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }, [address]);

  if (!address) {
    return (
      <p className="mt-3 text-[12px] text-white/35">
        {T('No se ha podido leer ahora mismo — recarga en un momento.', 'Could not be read right now — reload in a moment.', lang)}
      </p>
    );
  }
  const short = address.length > 20 ? `${address.slice(0, 10)}…${address.slice(-8)}` : address;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        onClick={copy}
        title={address}
        className="rounded-md px-2 py-1 text-[12px] transition-colors hover:text-white"
        style={{ ...MONO, border: `1px solid ${BORDER}`, color: copied ? accentSoft : 'rgba(255,255,255,0.6)' }}
      >
        {copied ? T('copiada ✓', 'copied ✓', lang) : short}
      </button>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[12px] underline-offset-2 hover:underline"
          style={{ color: accent }}
        >
          {T('ver en el explorador ↗', 'view on the explorer ↗', lang)}
        </a>
      )}
    </div>
  );
}

// ── Block 5 · the in-browser verifier ────────────────────────────────────────
type VerifyState = 'idle' | 'computing' | 'match' | 'mismatch';

function Verifier({ sample, lang }: { sample: TrustSample; lang: Lang }) {
  const [state, setState] = useState<VerifyState>('idle');
  const [computed, setComputed] = useState<string | null>(null);
  const [showBytes, setShowBytes] = useState(false);

  const memo = sample.memoHex.replace(/^0x/i, '');
  // 42-byte memo layout: [FE][walletId][executorFee 8B][userOpHash 32B]
  const memoOp = memo.slice(0, 2);
  const memoWallet = memo.slice(2, 4);
  const memoFee = memo.slice(4, 20);
  const memoHash = memo.slice(20);

  const verify = useCallback(async () => {
    setState('computing');
    try {
      const { keccak256 } = await import('ethers');
      const digest = keccak256(sample.userOpData);
      setComputed(digest);
      const ok =
        digest.toLowerCase() === sample.userOpHash.toLowerCase() &&
        digest.slice(2).toLowerCase() === memoHash.toLowerCase();
      setState(ok ? 'match' : 'mismatch');
    } catch {
      setState('mismatch');
      setComputed(null);
    }
  }, [sample.userOpData, sample.userOpHash, memoHash]);

  const date = sample.at
    ? new Date(sample.at).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <div className="rounded-2xl p-6" style={CARD_STYLE}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[11px] uppercase tracking-[0.2em] text-white/40" style={MONO}>
          {T('Una operación real nuestra, ya completada', 'A real operation of ours, already completed', lang)}
        </span>
        <span className="text-[12px] text-white/45">
          {date}
          {sample.xrp != null && (
            <> · {sample.xrp.toLocaleString(lang === 'es' ? 'es-ES' : 'en-US', { maximumFractionDigits: 6 })} XRP</>
          )}
        </span>
      </div>

      {/* the signed memo, segmented so the fingerprint is visible inside it */}
      <p className="mt-5 text-[12px] text-white/45">
        {T(
          'Esto es lo que viajó dentro de la transacción firmada — y en dorado, la huella de la orden:',
          'This is what travelled inside the signed transaction — and in gold, the order’s fingerprint:',
          lang,
        )}
      </p>
      <div
        className="mt-2 break-all rounded-lg p-3 text-[11px] leading-relaxed"
        style={{ ...MONO, border: `1px solid ${BORDER}`, background: 'rgba(0,0,0,0.3)' }}
      >
        <span className="text-white/35" title={T('instrucción', 'instruction', lang)}>{memoOp}</span>
        <span className="text-white/25" title="wallet">{memoWallet}</span>
        <span className="text-white/35" title={T('fee del executor', 'executor fee', lang)}>{memoFee}</span>
        <span style={{ color: GOLD_SOFT }} title={T('la huella de tu orden', 'your order’s fingerprint', lang)}>{memoHash}</span>
      </div>

      {/* the full order bytes, collapsed by default */}
      <button
        onClick={() => setShowBytes((s) => !s)}
        className="mt-4 text-[12px] underline-offset-2 hover:underline"
        style={{ color: 'rgba(255,255,255,0.55)' }}
      >
        {showBytes
          ? T('Ocultar la orden completa', 'Hide the full order', lang)
          : T('Ver la orden completa, byte a byte', 'See the full order, byte by byte', lang)}
      </button>
      {showBytes && (
        <div
          className="mt-2 max-h-40 overflow-auto break-all rounded-lg p-3 text-[11px] leading-relaxed text-white/40"
          style={{ ...MONO, border: `1px solid ${BORDER}`, background: 'rgba(0,0,0,0.3)' }}
        >
          {sample.userOpData}
        </div>
      )}

      {/* the button that does the math on the visitor's device */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          onClick={() => void verify()}
          disabled={state === 'computing'}
          className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-black transition-transform hover:scale-[1.02] disabled:opacity-60"
          style={{ background: GOLD, boxShadow: '0 6px 22px hsl(var(--volt) / 0.22)' }}
        >
          {state === 'computing'
            ? T('Calculando…', 'Computing…', lang)
            : T('Calcular la huella en mi navegador', 'Compute the fingerprint in my browser', lang)}
        </button>
        {sample.xrplTxHash && (
          <a href={XRPL_TX(sample.xrplTxHash)} target="_blank" rel="noopener noreferrer" className="text-xs text-white/45 underline-offset-2 hover:text-white/80 hover:underline">
            {T('la firma, en XRPL ↗', 'the signature, on XRPL ↗', lang)}
          </a>
        )}
        {sample.flareTxHash && (
          <a href={FLARE_TX(sample.flareTxHash)} target="_blank" rel="noopener noreferrer" className="text-xs underline-offset-2 hover:underline" style={{ color: GOLD }}>
            {T('la ejecución, en Flare ↗', 'the execution, on Flare ↗', lang)}
          </a>
        )}
      </div>

      {state === 'match' && (
        <div className="mt-4 rounded-lg p-3.5" style={{ border: `1px solid rgba(201,162,39,0.35)`, background: 'rgba(201,162,39,0.07)' }}>
          <p className="text-sm font-semibold" style={{ color: GOLD_SOFT }}>
            ✓ {T('Cuadra.', 'It matches.', lang)}
          </p>
          <p className="mt-1 break-all text-[11px] text-white/45" style={MONO}>
            {computed}
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-white/55">
            {T(
              'La huella que tu navegador acaba de calcular sobre la orden es exactamente la que viajó dentro de la firma. Ni nosotros ni nadie pudo cambiar la orden después de firmarse.',
              'The fingerprint your browser just computed over the order is exactly the one that travelled inside the signature. Neither we nor anyone else could change the order after it was signed.',
              lang,
            )}
          </p>
        </div>
      )}
      {state === 'mismatch' && (
        <div className="mt-4 rounded-lg p-3.5" style={{ border: '1px solid rgba(230,90,90,0.4)', background: 'rgba(230,90,90,0.07)' }}>
          <p className="text-sm font-semibold text-red-300">{T('No cuadra.', 'It does not match.', lang)}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-white/55">
            {T(
              'Esto no debería ocurrir — y por eso te lo enseñamos en vez de esconderlo. Escríbenos y lo revisamos en público.',
              'This should not happen — which is why we show it instead of hiding it. Write to us and we will review it in the open.',
              lang,
            )}
          </p>
        </div>
      )}

      <p className="mt-4 border-t border-white/8 pt-3 text-[11px] leading-relaxed text-white/35">
        {T(
          'El cálculo ocurre en tu dispositivo, no en nuestros servidores, con keccak256 — el algoritmo de huella estándar de la red. Si no te fías de nuestro botón, copia los bytes y calcúlalo en cualquier herramienta externa: el resultado es el mismo.',
          'The math runs on your device, not on our servers, using keccak256 — the network’s standard fingerprint algorithm. If you don’t trust our button, copy the bytes and compute it in any external tool: the result is the same.',
          lang,
        )}
      </p>
    </div>
  );
}

// ── Block 6 · what we cannot promise ─────────────────────────────────────────
const HONEST_LIMITS = (lang: Lang) => [
  {
    title: T('Aún no hay auditoría externa', 'No external audit yet', lang),
    body: T(
      'Esta página describe cómo está construido el sistema, pero ninguna firma independiente lo ha certificado todavía. Hasta entonces, la beta opera con límites deliberadamente pequeños.',
      'This page describes how the system is built, but no independent firm has certified it yet. Until then, the beta operates under deliberately small limits.',
      lang,
    ),
  },
  {
    title: T('Dependemos de protocolos de terceros', 'We depend on third-party protocols', lang),
    body: T(
      'FAssets, los protocolos de Flare y la propia red XRPL son infraestructura pública que no controlamos. Si una pieza falla, tu operación puede quedarse en espera — pero lo único ejecutable sigue siendo lo que tú firmaste.',
      'FAssets, the Flare protocols and the XRPL network itself are public infrastructure we do not control. If a piece fails, your operation may be left waiting — but the only thing that can ever execute is still what you signed.',
      lang,
    ),
  },
  {
    title: T('Nuestra pieza puede atascarse', 'Our piece can stall', lang),
    body: T(
      'Si el executor se queda sin combustible o se cae, tu orden no se entrega a tiempo. Lo que no puede pasar es que vaya a otro sitio: queda esperando, y de ahí solo puede salir tu orden exacta.',
      'If the executor runs out of fuel or goes down, your order is not delivered on time. What cannot happen is for it to go anywhere else: it waits, and only your exact order can ever leave that queue.',
      lang,
    ),
  },
];

// ═════════════════════════════════════════════════════════════════════════════
// Legacy — the council circuit, told with the same three depths (founder
// 2026-07-29: "un toggle con las pruebas, más o menos como el de personal").
// Honest by construction: Legacy is VALIDATING on mainnet and not open yet —
// the tab says so before it proves anything. Indigo accents mirror the
// journey's governed palette; the trust claim and the door stay shared.
// ═════════════════════════════════════════════════════════════════════════════

const LEGACY_LOCK_STEPS = (lang: Lang) => [
  {
    title: T('El consejo firma por quórum', 'The council signs by quorum', lang),
    body: T(
      'Un Legacy es una cuenta gobernada por un consejo con quórum (p. ej. 2 de 3 firmas), escrito en las reglas nativas de XRPL. Ninguna orden existe hasta que firman los suficientes — y Astryum no es firmante.',
      'A Legacy is an account governed by a council with a quorum (e.g. 2 of 3 signatures), written into XRPL’s native rules. No order exists until enough members sign — and Astryum is not a signer.',
      lang,
    ),
  },
  {
    title: T('La orden lleva su huella', 'The order carries its fingerprint', lang),
    body: T(
      'La orden firmada viaja por XRPL con su huella grabada — el resumen matemático único de la orden exacta. Un byte distinto y deja de ser esa orden.',
      'The signed order travels over XRPL with its fingerprint engraved — the unique mathematical digest of the exact order. One different byte and it is no longer that order.',
      lang,
    ),
  },
  {
    title: T('Flare exige la prueba', 'Flare demands the proof', lang),
    body: T(
      'El puente en Flare solo acepta la orden acompañada de una prueba de que esa transacción del consejo existe en XRPL — una prueba que verifica la propia red (FDC), no nosotros.',
      'The bridge on Flare only accepts the order alongside a proof that the council’s transaction exists on XRPL — a proof the network itself verifies (FDC), not us.',
      lang,
    ),
  },
  {
    title: T('La jaula solo obedece esa prueba', 'The cage obeys only that proof', lang),
    body: T(
      'El capital vive en un contrato que únicamente responde a órdenes probadas del consejo. Ni un miembro solo, ni nosotros, podemos moverlo.',
      'The capital lives in a contract that answers only to proven council orders. No single member — and not us — can move it.',
      lang,
    ),
  },
];

// Owner chips for the council circuit.
function legacyChip(owner: 'familia' | 'astryum' | 'candado', lang: Lang): { label: string; style: React.CSSProperties } {
  if (owner === 'astryum') {
    return {
      label: T('nuestra', 'ours', lang),
      style: { background: 'rgba(130,141,248,0.12)', color: INDIGO_SOFT, border: '1px solid rgba(130,141,248,0.35)' },
    };
  }
  if (owner === 'familia') {
    return {
      label: T('de la familia', 'the family’s', lang),
      style: { background: 'rgba(130,141,248,0.12)', color: INDIGO_SOFT, border: '1px solid rgba(130,141,248,0.35)' },
    };
  }
  return {
    label: T('el candado', 'the lock', lang),
    style: { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.55)', border: `1px solid ${BORDER}` },
  };
}

/** Human label for a council-order action slug; unknown slugs show as-is. */
function legacyActionLabel(action: string | null, lang: Lang): string {
  switch (action) {
    case 'direct-to':
      return T('poner capital a trabajar', 'putting capital to work', lang);
    case 'recall':
      return T('retirar capital de una estrategia', 'recalling capital from a strategy', lang);
    case 'move':
      return T('mover capital entre estrategias', 'moving capital between strategies', lang);
    case 'evacuate':
      return T('evacuar una estrategia', 'evacuating a strategy', lang);
    default:
      return action ?? T('orden del consejo', 'council order', lang);
  }
}

function LegacyBlocks({ trust, lang }: { trust: TrustPayload | null; lang: Lang }) {
  const legacy = trust?.legacy ?? null;
  const pieces: Array<{
    key: string;
    name: string;
    chain: 'xrpl' | 'flare';
    owner: 'familia' | 'astryum' | 'candado';
    role: string;
    address: string | null;
    href: string | null;
    /** true → this piece deliberately has no global address (per-family). */
    perFamily?: boolean;
  }> = [
    {
      key: 'council',
      name: T('El consejo', 'The council', lang),
      chain: 'xrpl',
      owner: 'familia',
      role: T(
        'La cuenta XRPL multifirma de cada familia, con sus pesos y su quórum en las reglas nativas de la red. Cada Legacy constituye la suya propia — por eso aquí no hay una dirección que enseñar: la tuya será tuya.',
        'Each family’s multisig XRPL account, with its weights and quorum in the network’s native rules. Every Legacy constitutes its own — which is why there is no address to show here: yours will be yours.',
        lang,
      ),
      address: null,
      href: null,
      perFamily: true,
    },
    {
      key: 'anchor',
      name: T('El buzón de órdenes', 'The order mailbox', lang),
      chain: 'xrpl',
      owner: 'astryum',
      role: T(
        'La cuenta XRPL que recibe las órdenes del consejo (un pago mínimo con la orden grabada). Es solo un buzón: la autoridad viene de las firmas del consejo, nunca del destinatario. Nuestro relayer lleva la prueba a Flare y paga el gas — no puede inventar órdenes.',
        'The XRPL account that receives council orders (a minimal payment with the order engraved). It is just a mailbox: authority comes from the council’s signatures, never from the recipient. Our relayer carries the proof to Flare and pays the gas — it cannot invent orders.',
        lang,
      ),
      address: legacy?.orderAnchor ?? null,
      href: legacy?.orderAnchor ? XRPL_ACCOUNT(legacy.orderAnchor) : null,
    },
    {
      key: 'bridge',
      name: 'XrplCouncilBridge',
      chain: 'flare',
      owner: 'candado',
      role: T(
        'El contrato que compara la orden recibida con la prueba de XRPL: existe, es del consejo y es exactamente la firmada. Solo entonces la entrega a la jaula — y cada orden se consume una sola vez.',
        'The contract that checks the received order against the XRPL proof: it exists, it is the council’s, and it is exactly what was signed. Only then does it hand it to the cage — and each order can be consumed exactly once.',
        lang,
      ),
      address: legacy?.bridge ?? null,
      href: legacy?.bridge ? FLARE_ADDRESS(legacy.bridge) : null,
    },
    {
      key: 'vault',
      name: 'LegacyVault',
      chain: 'flare',
      owner: 'candado',
      role: T(
        'La jaula: el contrato donde vive el capital del Legacy. Solo obedece al puente, y su constitución queda anclada — cualquiera puede leer en la cadena qué puede y qué no puede hacer.',
        'The cage: the contract where the Legacy’s capital lives. It obeys only the bridge, and its constitution is anchored — anyone can read on-chain what it can and cannot do.',
        lang,
      ),
      address: legacy?.vault ?? null,
      href: legacy?.vault ? FLARE_ADDRESS(legacy.vault) : null,
    },
  ];

  const sample = legacy?.sample ?? null;
  const sampleDate = sample?.at
    ? new Date(sample.at).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <>
      {/* the council's lock — four steps, indigo */}
      <section className="px-6 pb-20">
        <div className="mx-auto max-w-5xl">
          <Reveal>
            <div className="mb-3 text-center text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: INDIGO_SOFT }}>
              {T('El candado del consejo', 'The council’s lock', lang)}
            </div>
            <h2 className="mx-auto mb-8 max-w-2xl text-center font-bold text-white text-balance" style={{ fontSize: 'clamp(1.5rem, 3vw, 2.2rem)', lineHeight: 1.12, letterSpacing: '-0.03em' }}>
              {T('Nada se mueve sin el quórum.', 'Nothing moves without the quorum.', lang)}
            </h2>
          </Reveal>
          <div className="relative grid gap-4 md:grid-cols-4">
            <motion.div
              aria-hidden
              className="absolute left-[8%] right-[8%] top-[34px] hidden h-px md:block"
              style={{ background: `linear-gradient(90deg, transparent, ${INDIGO}55, transparent)`, transformOrigin: 'left' }}
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true, margin: '-20%' }}
              transition={{ duration: 1.1, ease: 'easeOut' }}
            />
            {LEGACY_LOCK_STEPS(lang).map((step, i) => (
              <Reveal key={step.title} delay={0.1 + i * 0.12}>
                <SpotlightCard className="relative h-full rounded-2xl p-5 text-center" style={CARD_STYLE}>
                  <div
                    className="mx-auto flex h-9 w-9 items-center justify-center rounded-full font-mono text-[11px] font-bold text-black"
                    style={{ background: `radial-gradient(circle at 35% 30%, #E4E8FF, ${INDIGO_SOFT} 45%, ${INDIGO} 100%)` }}
                    aria-hidden
                  >
                    {i + 1}
                  </div>
                  <h3 className="mt-3 text-[15px] font-semibold text-white">{step.title}</h3>
                  <p className="mt-2.5 text-[13px] leading-relaxed text-white/55">{step.body}</p>
                </SpotlightCard>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* who is who — the council circuit */}
      <section className="px-6 pb-20">
        <div className="mx-auto max-w-5xl">
          <Reveal>
            <div className="mb-3 text-center text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: INDIGO_SOFT }}>
              {T('Quién es quién', 'Who is who', lang)}
            </div>
            <h2 className="mx-auto max-w-2xl text-center font-bold text-white text-balance" style={{ fontSize: 'clamp(1.5rem, 3vw, 2.2rem)', lineHeight: 1.12, letterSpacing: '-0.03em' }}>
              {T('La familia gobierna. El código obedece. Nosotros entregamos.', 'The family governs. The code obeys. We deliver.', lang)}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-center text-sm leading-relaxed text-white/50">
              {T(
                'Este es el circuito de una orden del consejo. Las direcciones desplegadas se leen de la configuración real al cargar la página; la del consejo es de cada familia y no se publica.',
                'This is the circuit a council order travels. The deployed addresses are read from the live configuration when this page loads; the council’s own is each family’s and is never published.',
                lang,
              )}
            </p>
          </Reveal>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {pieces.map((piece, i) => {
              const chip = legacyChip(piece.owner, lang);
              return (
                <Reveal key={piece.key} delay={0.08 + (i % 2) * 0.08}>
                  <SpotlightCard
                    className="h-full rounded-2xl p-6"
                    style={piece.owner === 'astryum' ? { ...CARD_STYLE, border: '1px solid rgba(130,141,248,0.3)' } : CARD_STYLE}
                  >
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="font-mono text-[11px]" style={{ color: INDIGO }}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <h3 className="text-[15px] font-semibold text-white">{piece.name}</h3>
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={chip.style}>
                        {chip.label}
                      </span>
                      <span className="ml-auto text-[10px] uppercase tracking-[0.15em] text-white/30" style={MONO}>
                        {piece.chain === 'xrpl' ? 'XRPL' : 'Flare'}
                      </span>
                    </div>
                    <p className="mt-3 text-[13px] leading-relaxed text-white/55">{piece.role}</p>
                    {!piece.perFamily && (
                      <AddressRow address={piece.address} href={piece.href} lang={lang} accent={INDIGO} accentSoft={INDIGO_SOFT} />
                    )}
                    {piece.key === 'vault' && legacy?.constitutionRef && (
                      <p className="mt-2 break-all text-[11px] text-white/35" style={MONO} title={legacy.constitutionRef}>
                        {T('Constitución anclada (XRPL · DID): ', 'Anchored constitution (XRPL · DID): ', lang)}
                        {legacy.constitutionRef.slice(0, 14)}…{legacy.constitutionRef.slice(-6)}
                      </p>
                    )}
                  </SpotlightCard>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* the real order — receipts, not screenshots */}
      <section className="px-6 pb-20">
        <div className="mx-auto max-w-3xl">
          <Reveal>
            <div className="mb-3 text-center text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: INDIGO_SOFT }}>
              {T('La prueba real', 'The real proof', lang)}
            </div>
            <h2 className="mx-auto mb-3 max-w-2xl text-center font-bold text-white text-balance" style={{ fontSize: 'clamp(1.5rem, 3vw, 2.2rem)', lineHeight: 1.12, letterSpacing: '-0.03em' }}>
              {T('El circuito ya corrió de verdad.', 'The circuit has already run for real.', lang)}
            </h2>
          </Reveal>
          <Reveal delay={0.12}>
            <div className="rounded-2xl p-6" style={CARD_STYLE}>
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/8 pb-3">
                <span className="text-[11px] uppercase tracking-[0.2em] text-white/40" style={MONO}>
                  {T('Órdenes del consejo ejecutadas', 'Council orders executed', lang)}
                </span>
                <span className="text-xl font-bold tabular-nums text-white">
                  {legacy?.ordersExecuted != null ? legacy.ordersExecuted : '·'}
                </span>
              </div>
              {sample ? (
                <>
                  <p className="mt-4 text-sm leading-relaxed text-white/60">
                    {T('La última orden real: ', 'The latest real order: ', lang)}
                    <span className="text-white/85">{legacyActionLabel(sample.action, lang)}</span>
                    {sampleDate && (
                      <span className="text-white/45">
                        {' '}
                        · {sampleDate}
                      </span>
                    )}
                    {T(
                      '. Firmada por el quórum en XRPL, probada ante Flare y ejecutada por la jaula — con capital propio, durante la validación.',
                      '. Signed by the quorum on XRPL, proven to Flare and executed by the cage — with our own capital, during validation.',
                      lang,
                    )}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    {sample.xrplTxHash && (
                      <a href={XRPL_TX(sample.xrplTxHash)} target="_blank" rel="noopener noreferrer" className="text-xs text-white/45 underline-offset-2 hover:text-white/80 hover:underline">
                        {T('la orden del consejo, en XRPL ↗', 'the council’s order, on XRPL ↗', lang)}
                      </a>
                    )}
                    {sample.flareTxHash && (
                      <a href={FLARE_TX(sample.flareTxHash)} target="_blank" rel="noopener noreferrer" className="text-xs underline-offset-2 hover:underline" style={{ color: INDIGO_SOFT }}>
                        {T('la ejecución de la jaula, en Flare ↗', 'the cage’s execution, on Flare ↗', lang)}
                      </a>
                    )}
                  </div>
                </>
              ) : (
                <p className="py-5 text-center text-sm text-white/40">
                  {legacy
                    ? T(
                        'Aún no hay una orden ejecutada que enseñar desde aquí — cuando la haya, aparecerá sola con sus comprobantes.',
                        'No executed order to show from here yet — when there is one, it will appear on its own with its receipts.',
                        lang,
                      )
                    : T('Leyendo la configuración…', 'Reading the configuration…', lang)}
                </p>
              )}
            </div>
          </Reveal>
        </div>
      </section>

      {/* what we cannot promise — the Legacy edition */}
      <section className="px-6 pb-24">
        <div className="mx-auto max-w-5xl">
          <Reveal>
            <div className="mb-3 text-center text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: INDIGO_SOFT }}>
              {T('La otra mitad de la transparencia', 'The other half of transparency', lang)}
            </div>
            <h2 className="mx-auto mb-8 max-w-2xl text-center font-bold text-white text-balance" style={{ fontSize: 'clamp(1.5rem, 3vw, 2.2rem)', lineHeight: 1.12, letterSpacing: '-0.03em' }}>
              {T('Lo que no te podemos prometer.', 'What we cannot promise you.', lang)}
            </h2>
          </Reveal>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                title: T('Todavía no está abierto', 'It is not open yet', lang),
                body: T(
                  'Legacy está en validación en mainnet y la puerta aún no abre al público. Lo estamos rodando primero con capital propio y pequeño — preferimos quemarnos nosotros antes que tú.',
                  'Legacy is validating on mainnet and the door is not open to the public yet. We are running it first with our own, small capital — we would rather get burned ourselves than let you be.',
                  lang,
                ),
              },
              {
                title: T('Contratos propios, sin auditoría externa', 'Our own contracts, no external audit', lang),
                body: T(
                  'La jaula y el puente son contratos nuestros: desplegados, verificables y legibles por cualquiera — pero ninguna firma independiente los ha auditado todavía. Hasta entonces, límites pequeños.',
                  'The cage and the bridge are our own contracts: deployed, verifiable and readable by anyone — but no independent firm has audited them yet. Until then, small limits.',
                  lang,
                ),
              },
              {
                title: T('Nuestro relayer puede atascarse', 'Our relayer can stall', lang),
                body: T(
                  'Si nuestra pieza falla, la orden firmada no se entrega a tiempo. Lo que no puede pasar es que se ejecute otra cosa: sin la prueba de XRPL, la jaula no obedece a nadie.',
                  'If our piece fails, the signed order is not delivered on time. What cannot happen is for something else to execute: without the XRPL proof, the cage obeys no one.',
                  lang,
                ),
              },
            ].map((limit, i) => (
              <Reveal key={limit.title} delay={0.1 + i * 0.12}>
                <SpotlightCard className="h-full rounded-2xl p-6" style={CARD_STYLE}>
                  <h3 className="text-[15px] font-semibold text-white">{limit.title}</h3>
                  <p className="mt-2.5 text-[13px] leading-relaxed text-white/55">{limit.body}</p>
                </SpotlightCard>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

// The product switch — Personal (gold, live) ⇄ Legacy (indigo, validating).
// Shares the landing's persisted choice ('astryum:product') so the visitor
// arrives on the same side they were exploring.
function ProofSwitch({
  product,
  setProduct,
  lang,
}: {
  product: 'personal' | 'legacy';
  setProduct: (p: 'personal' | 'legacy') => void;
  lang: Lang;
}) {
  const opts = [
    { key: 'personal' as const, label: 'Personal', bg: GOLD, ink: '#000' },
    { key: 'legacy' as const, label: 'Legacy', bg: INDIGO, ink: '#0B0D26' },
  ];
  return (
    <div className="flex flex-col items-center gap-2.5">
      <div
        role="group"
        aria-label={T('Producto', 'Product', lang)}
        className="inline-flex items-center gap-0.5 rounded-full p-1"
        style={{ border: `1px solid ${BORDER}`, background: 'rgba(10,10,10,0.55)' }}
      >
        {opts.map((o) => (
          <button
            key={o.key}
            onClick={() => setProduct(o.key)}
            aria-pressed={product === o.key}
            className="rounded-full px-4 py-2 text-xs font-semibold transition-colors"
            style={product === o.key ? { background: o.bg, color: o.ink } : { color: 'rgba(255,255,255,0.45)' }}
          >
            {o.label}
          </button>
        ))}
      </div>
      {product === 'legacy' && (
        <span className="text-[10px] font-mono uppercase tracking-[0.18em]" style={{ color: INDIGO_SOFT }}>
          {T('En validación en mainnet · abre pronto', 'Validating on mainnet · opening soon', lang)}
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function ProofPage() {
  const [trust, setTrust] = useState<TrustPayload | null>(null);
  // Same persisted choice as the landing's journey toggle — arriving from the
  // Legacy side of the Home opens the Legacy proofs directly.
  const [product, setProductState] = useState<'personal' | 'legacy'>('personal');
  useEffect(() => {
    try {
      const s = localStorage.getItem('astryum:product');
      if (s === 'legacy' || s === 'personal') setProductState(s);
    } catch {
      /* ignore */
    }
  }, []);
  const setProduct = (p: 'personal' | 'legacy') => {
    setProductState(p);
    try {
      localStorage.setItem('astryum:product', p);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`${getApiBase()}/platform/trust`);
        if (!r.ok) throw new Error(`http_${r.status}`);
        const j = (await r.json()) as TrustPayload;
        if (alive) setTrust(j);
      } catch {
        /* the sections render their honest fallbacks */
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <SubpageShell>
      {(lang) => (
        <>
          {/* hero */}
          <section className="px-6 pt-40 pb-14 text-center md:pt-44">
            <Reveal>
              <div className="mb-5 text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: GOLD_SOFT }}>
                {T('La prueba · verificable en cadena', 'Proof · verifiable on-chain', lang)}
              </div>
            </Reveal>
            <h1
              className="mx-auto max-w-3xl font-bold text-white text-balance"
              style={{ fontSize: 'clamp(2.2rem, 5vw, 3.8rem)', lineHeight: 1.06, letterSpacing: '-0.03em' }}
            >
              <MaskLines
                lines={[
                  T('No te pedimos confianza.', 'We don’t ask for your trust.', lang),
                  <span key="l2" style={{ color: GOLD_SOFT }}>
                    {T('La da el código.', 'The code earns it.', lang)}
                  </span>,
                ]}
                delay={0.1}
              />
            </h1>
            <Reveal delay={0.3}>
              <p className="mx-auto mt-6 max-w-2xl leading-relaxed text-white/55" style={{ fontSize: 'clamp(15px, 1.4vw, 18px)' }}>
                {T(
                  'Todo lo que sigue se comprueba sin nosotros: contratos públicos, direcciones leídas de la cadena en vivo y operaciones reales que cualquiera puede abrir en un explorador. Es lo que en DeFi se llama «trustless»: no tienes que fiarte de nadie — puedes comprobarlo.',
                  'Everything below can be checked without us: public contracts, addresses read live from the chain, and real operations anyone can open in an explorer. It is what DeFi calls “trustless”: you don’t have to take anyone’s word — you can check.',
                  lang,
                )}
              </p>
            </Reveal>
          </section>

          {/* product switch — Personal (live) ⇄ Legacy (validating) */}
          <section className="px-6 pb-12">
            <div className="mx-auto flex max-w-5xl justify-center">
              <ProofSwitch product={product} setProduct={setProduct} lang={lang} />
            </div>
          </section>

          {product === 'legacy' ? (
            <LegacyBlocks trust={trust} lang={lang} />
          ) : (
            <>
          {/* the lock — four steps on one line of flight */}
          <section className="px-6 pb-20">
            <div className="mx-auto max-w-5xl">
              <Reveal>
                <div className="mb-3 text-center text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: GOLD_SOFT }}>
                  {T('El candado', 'The lock', lang)}
                </div>
                <h2 className="mx-auto mb-8 max-w-2xl text-center font-bold text-white text-balance" style={{ fontSize: 'clamp(1.5rem, 3vw, 2.2rem)', lineHeight: 1.12, letterSpacing: '-0.03em' }}>
                  {T('Solo puede ejecutarse lo que tú firmaste.', 'Only what you signed can ever run.', lang)}
                </h2>
              </Reveal>
              <div className="relative grid gap-4 md:grid-cols-4">
                <motion.div
                  aria-hidden
                  className="absolute left-[8%] right-[8%] top-[34px] hidden h-px md:block"
                  style={{ background: `linear-gradient(90deg, transparent, ${GOLD}55, transparent)`, transformOrigin: 'left' }}
                  initial={{ scaleX: 0 }}
                  whileInView={{ scaleX: 1 }}
                  viewport={{ once: true, margin: '-20%' }}
                  transition={{ duration: 1.1, ease: 'easeOut' }}
                />
                {LOCK_STEPS(lang).map((step, i) => (
                  <Reveal key={step.title} delay={0.1 + i * 0.12}>
                    <SpotlightCard className="relative h-full rounded-2xl p-5 text-center" style={CARD_STYLE}>
                      <div
                        className="mx-auto flex h-9 w-9 items-center justify-center rounded-full font-mono text-[11px] font-bold text-black"
                        style={{ background: `radial-gradient(circle at 35% 30%, #FFF3D0, ${GOLD_SOFT} 45%, ${GOLD} 100%)` }}
                        aria-hidden
                      >
                        {i + 1}
                      </div>
                      <h3 className="mt-3 text-[15px] font-semibold text-white">{step.title}</h3>
                      <p className="mt-2.5 text-[13px] leading-relaxed text-white/55">{step.body}</p>
                    </SpotlightCard>
                  </Reveal>
                ))}
              </div>
              <Reveal delay={0.3}>
                <p className="mx-auto mt-8 max-w-2xl text-center text-[13px] leading-relaxed text-white/40">
                  {T(
                    'No-custodial de verdad: tus claves y tu capital nunca pasan por nosotros. No es una promesa nuestra — es la forma en que la red trata cada orden.',
                    'Truly non-custodial: your keys and your capital never pass through us. It is not a promise we make — it is how the network treats every order.',
                    lang,
                  )}
                </p>
              </Reveal>
            </div>
          </section>

          {/* who is who — the four pieces of the path */}
          <section className="px-6 pb-20">
            <div className="mx-auto max-w-5xl">
              <Reveal>
                <div className="mb-3 text-center text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: GOLD_SOFT }}>
                  {T('Quién es quién', 'Who is who', lang)}
                </div>
                <h2 className="mx-auto max-w-2xl text-center font-bold text-white text-balance" style={{ fontSize: 'clamp(1.5rem, 3vw, 2.2rem)', lineHeight: 1.12, letterSpacing: '-0.03em' }}>
                  {T('De las cuatro piezas del camino, una es nuestra.', 'Of the four pieces on the path, one is ours.', lang)}
                </h2>
                <p className="mx-auto mt-3 max-w-xl text-center text-sm leading-relaxed text-white/50">
                  {T(
                    'Este es el camino que recorre tu XRP cuando entra a trabajar en Flare. Tres piezas son del protocolo; la nuestra solo puede entregar — nunca decidir. Las direcciones se leen de la cadena al cargar esta página.',
                    'This is the path your XRP travels when it goes to work on Flare. Three pieces belong to the protocol; ours can only deliver — never decide. The addresses are read from the chain when this page loads.',
                    lang,
                  )}
                </p>
              </Reveal>
              <div className="mt-8 grid gap-4 md:grid-cols-2">
                {PATH_PIECES.map((piece, i) => {
                  const chip = ownerChip(piece.owner, lang);
                  const address = trust ? trust.path[piece.key] : null;
                  const href = address ? (piece.chain === 'xrpl' ? XRPL_ACCOUNT(address) : FLARE_ADDRESS(address)) : null;
                  return (
                    <Reveal key={piece.key} delay={0.08 + (i % 2) * 0.08}>
                      <SpotlightCard
                        className="h-full rounded-2xl p-6"
                        style={piece.owner === 'astryum' ? { ...CARD_STYLE, border: `1px solid rgba(201,162,39,0.3)` } : CARD_STYLE}
                      >
                        <div className="flex flex-wrap items-center gap-2.5">
                          <span className="font-mono text-[11px]" style={{ color: GOLD }}>
                            {String(i + 1).padStart(2, '0')}
                          </span>
                          <h3 className="text-[15px] font-semibold text-white">{piece.name}</h3>
                          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={chip.style}>
                            {chip.label}
                          </span>
                          <span className="ml-auto text-[10px] uppercase tracking-[0.15em] text-white/30" style={MONO}>
                            {piece.chain === 'xrpl' ? 'XRPL' : 'Flare'}
                          </span>
                        </div>
                        <p className="mt-3 text-[13px] leading-relaxed text-white/55">{piece.role(lang)}</p>
                        <AddressRow address={address} href={href} lang={lang} />
                      </SpotlightCard>
                    </Reveal>
                  );
                })}
              </div>
            </div>
          </section>

          {/* every operation, live — the existing public feed */}
          <LiveActivity lang={lang} />

          {/* verify it yourself */}
          <section className="px-6 pb-20">
            <div className="mx-auto max-w-3xl">
              <Reveal>
                <div className="mb-3 text-center text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: GOLD_SOFT }}>
                  {T('Verifícalo tú', 'Verify it yourself', lang)}
                </div>
                <h2 className="mx-auto mb-3 max-w-2xl text-center font-bold text-white text-balance" style={{ fontSize: 'clamp(1.5rem, 3vw, 2.2rem)', lineHeight: 1.12, letterSpacing: '-0.03em' }}>
                  {T('Haz tú la cuenta que hace la red.', 'Do the math the network does.', lang)}
                </h2>
                <p className="mx-auto mb-8 max-w-xl text-center text-sm leading-relaxed text-white/50">
                  {T(
                    'Esta es una operación real que ya se completó, hecha desde una cuenta nuestra — nunca publicamos las de nuestros usuarios. Tu navegador puede recalcular su huella y compararla con la que viajó en la firma: la misma comprobación que hizo la red antes de ejecutarla.',
                    'This is a real operation that already completed, made from an account of ours — we never publish our users’. Your browser can recompute its fingerprint and compare it with the one that travelled in the signature: the same check the network ran before executing it.',
                    lang,
                  )}
                </p>
              </Reveal>
              <Reveal delay={0.12}>
                {trust?.sample ? (
                  <Verifier sample={trust.sample} lang={lang} />
                ) : (
                  <div className="rounded-2xl p-6 text-center text-sm text-white/40" style={CARD_STYLE}>
                    {trust
                      ? T(
                          'Todavía no hay una operación completada que enseñar aquí — en cuanto la haya, aparecerá sola.',
                          'There is no completed operation to show here yet — as soon as there is one, it will appear on its own.',
                          lang,
                        )
                      : T('Leyendo la cadena…', 'Reading the chain…', lang)}
                  </div>
                )}
              </Reveal>
            </div>
          </section>

          {/* what we cannot promise */}
          <section className="px-6 pb-24">
            <div className="mx-auto max-w-5xl">
              <Reveal>
                <div className="mb-3 text-center text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: GOLD_SOFT }}>
                  {T('La otra mitad de la transparencia', 'The other half of transparency', lang)}
                </div>
                <h2 className="mx-auto mb-8 max-w-2xl text-center font-bold text-white text-balance" style={{ fontSize: 'clamp(1.5rem, 3vw, 2.2rem)', lineHeight: 1.12, letterSpacing: '-0.03em' }}>
                  {T('Lo que no te podemos prometer.', 'What we cannot promise you.', lang)}
                </h2>
              </Reveal>
              <div className="grid gap-4 md:grid-cols-3">
                {HONEST_LIMITS(lang).map((limit, i) => (
                  <Reveal key={limit.title} delay={0.1 + i * 0.12}>
                    <SpotlightCard className="h-full rounded-2xl p-6" style={CARD_STYLE}>
                      <h3 className="text-[15px] font-semibold text-white">{limit.title}</h3>
                      <p className="mt-2.5 text-[13px] leading-relaxed text-white/55">{limit.body}</p>
                    </SpotlightCard>
                  </Reveal>
                ))}
              </div>
              <Reveal delay={0.3}>
                <p className="mx-auto mt-8 max-w-2xl text-center text-[13px] leading-relaxed text-white/40">
                  {T(
                    'Una página que solo contara lo bueno sería publicidad. Esta existe para que compruebes lo uno y lo otro.',
                    'A page that only told the good parts would be advertising. This one exists so you can check both.',
                    lang,
                  )}
                </p>
              </Reveal>
            </div>
          </section>

            </>
          )}

          {/* door */}
          <section className="px-6 pb-28 text-center">
            <Reveal>
              <h2
                className="mx-auto max-w-2xl font-bold text-white text-balance"
                style={{ fontSize: 'clamp(1.6rem, 3.4vw, 2.6rem)', lineHeight: 1.1, letterSpacing: '-0.03em' }}
              >
                {T('Compruébalo con tus propios ojos.', 'Check it with your own eyes.', lang)}
              </h2>
              <p className="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-white/50">
                {T(
                  'El acceso anticipado abre el puesto de mando con tus wallets reales — leyendo desde el primer minuto, firmando solo cuando tú quieras.',
                  'Early access opens mission control with your real wallets — reading from the first minute, signing only when you choose to.',
                  lang,
                )}
              </p>
              <a
                href="/early-access"
                className="mt-9 inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-black transition-transform hover:scale-[1.02]"
                style={{ background: GOLD, boxShadow: '0 8px 28px hsl(var(--volt) / 0.3)' }}
              >
                {T('Solicita acceso anticipado', 'Request early access', lang)} →
              </a>
            </Reveal>
          </section>
        </>
      )}
    </SubpageShell>
  );
}
