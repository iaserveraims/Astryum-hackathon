'use client';

/**
 * CurtainGraph — "behind the curtain": the fixed map of the infrastructure,
 * lit by the receipts of the selected run. Solid = real (mainnet), dashed = the
 * exchange system (simulated). Each node shows its latest hash and state; each
 * edge is labelled with what travels on it. Nothing here is an animation of a
 * story — a node only lights up when a receipt with a hash touches it.
 *
 * Nodes: council (XRPL) · omnibus (XRPL) · client wallet (XRPL) · FDC · bridge
 * · pote (the cage) · venues · Core Vault / AssetManager (FAssets) · MAC + PA /
 * passkey account · relayer · KYC registry · exchange ledger (simulated).
 */

import { useMemo } from 'react';
import { useT } from '../../i18n/LanguageProvider';
import { shortHash, type DemoRun, type Receipt, type ReceiptStep } from '../../lib/demo-exchange/api';
import type { ChainFacts } from '../../lib/demo-exchange/useDemoRun';
import { receiptStatus } from './ReceiptRow';

type NodeId = 'council' | 'omnibus' | 'clientWallet' | 'fdc' | 'bridge' | 'pote' | 'venue' | 'fassets' | 'account' | 'relayer' | 'registry' | 'ledger' | 'did';

const STEP_NODES: Record<ReceiptStep, NodeId[]> = {
  E1_ANCHOR: ['council', 'did'],
  E2_POTE: ['council', 'fassets', 'pote'],
  E3_KYC: ['registry', 'account'],
  E3_CREDENTIAL: ['council', 'clientWallet'],
  U1_DEPOSIT: ['clientWallet', 'omnibus', 'ledger'],
  E5_PUT_TO_WORK: ['omnibus', 'fassets', 'pote', 'account'],
  E6_ORDER: ['council', 'fdc', 'bridge', 'pote', 'venue'],
  E7_DENIED: ['pote'],
  U4_EXIT: ['account', 'relayer', 'pote', 'venue'],
  U4_EXIT_XRP: ['account', 'relayer', 'pote', 'fassets', 'omnibus', 'ledger'],
  E8_WITHDRAW: ['omnibus', 'clientWallet', 'ledger'],
  NOTE: [],
};

interface NodeSpec { id: NodeId; label: string; sub: string; x: number; y: number; w: number; simulated?: boolean; tone: 'authority' | 'capital' | 'custody' | 'neutral' }

const NODES: NodeSpec[] = [
  { id: 'council', label: 'Exchange council', sub: 'XRPL · SignerList', x: 40, y: 40, w: 170, tone: 'authority' },
  { id: 'did', label: 'Constitution', sub: 'XRPL · DIDSet', x: 40, y: 120, w: 170, tone: 'authority' },
  { id: 'fdc', label: 'FDC', sub: 'attests the XRPL payment', x: 260, y: 40, w: 150, tone: 'neutral' },
  { id: 'bridge', label: 'XrplCouncilBridge', sub: 'Flare · verifies proof + nonce', x: 460, y: 40, w: 190, tone: 'authority' },
  { id: 'pote', label: 'AstryumVault (the cage)', sub: 'Flare · ERC-4626 · no extraction', x: 460, y: 160, w: 190, tone: 'neutral' },
  { id: 'venue', label: 'Venues', sub: 'Kinetic · Firelight (allowlisted)', x: 720, y: 160, w: 170, tone: 'capital' },
  { id: 'registry', label: 'ExchangeKycRegistry', sub: 'Flare · approved + tag', x: 720, y: 40, w: 170, tone: 'authority' },
  { id: 'omnibus', label: 'Exchange omnibus', sub: 'XRPL · deposits by tag', x: 40, y: 300, w: 170, tone: 'capital' },
  { id: 'fassets', label: 'FAssets Core Vault', sub: 'XRP ⇄ FXRP · 0xFE memo', x: 260, y: 300, w: 170, tone: 'capital' },
  { id: 'account', label: 'Client account (passkey)', sub: 'Flare · the shares live here', x: 460, y: 300, w: 190, tone: 'custody' },
  { id: 'relayer', label: 'Relayer (gas)', sub: 'pays gas · cannot decide', x: 720, y: 300, w: 170, tone: 'neutral' },
  { id: 'clientWallet', label: 'Client XRPL wallet', sub: 'Xaman · their own', x: 40, y: 420, w: 170, tone: 'custody' },
  { id: 'ledger', label: 'Exchange ledger', sub: 'simulated · tag → balance', x: 260, y: 420, w: 170, tone: 'neutral', simulated: true },
];

interface EdgeSpec { from: NodeId; to: NodeId; label: string; steps: ReceiptStep[]; dashed?: boolean }

const EDGES: EdgeSpec[] = [
  { from: 'council', to: 'did', label: 'anchors sha-256', steps: ['E1_ANCHOR'] },
  { from: 'council', to: 'fdc', label: 'order Payment (memo)', steps: ['E6_ORDER'] },
  { from: 'fdc', to: 'bridge', label: 'XRPPayment proof', steps: ['E6_ORDER'] },
  { from: 'bridge', to: 'pote', label: 'directTo / recall', steps: ['E6_ORDER', 'E7_DENIED'] },
  { from: 'pote', to: 'venue', label: 'deposit / withdraw', steps: ['E6_ORDER', 'U4_EXIT', 'U4_EXIT_XRP'] },
  { from: 'council', to: 'fassets', label: '0xFE: create pote', steps: ['E2_POTE'] },
  { from: 'fassets', to: 'pote', label: 'mint + deposit(receiver)', steps: ['E2_POTE', 'E5_PUT_TO_WORK'] },
  { from: 'omnibus', to: 'fassets', label: '0xFE: XRP → FXRP', steps: ['E5_PUT_TO_WORK'] },
  { from: 'pote', to: 'account', label: 'shares to the client', steps: ['E5_PUT_TO_WORK'] },
  { from: 'registry', to: 'account', label: 'approved · tag', steps: ['E3_KYC'] },
  { from: 'clientWallet', to: 'omnibus', label: 'XRP + tag', steps: ['U1_DEPOSIT'] },
  { from: 'omnibus', to: 'ledger', label: 'watcher credits', steps: ['U1_DEPOSIT', 'U4_EXIT_XRP'], dashed: true },
  { from: 'account', to: 'relayer', label: 'Face ID batch', steps: ['U4_EXIT', 'U4_EXIT_XRP'] },
  { from: 'relayer', to: 'pote', label: 'redeem', steps: ['U4_EXIT', 'U4_EXIT_XRP'] },
  { from: 'account', to: 'fassets', label: 'redeemWithTag', steps: ['U4_EXIT_XRP'] },
  { from: 'fassets', to: 'omnibus', label: 'XRP back, with tag', steps: ['U4_EXIT_XRP'] },
  { from: 'omnibus', to: 'clientWallet', label: 'payout', steps: ['E8_WITHDRAW'] },
];

const TONE: Record<NodeSpec['tone'], string> = {
  authority: 'var(--authority, #A76A15)',
  capital: '#B7791F',
  custody: 'var(--muscle, #1F6F70)',
  neutral: 'currentColor',
};

function center(n: NodeSpec): { x: number; y: number } {
  return { x: n.x + n.w / 2, y: n.y + 28 };
}

export function CurtainGraph({ run, chain }: { run: DemoRun | null; chain: ChainFacts | null }) {
  const { t } = useT();
  const byNode = useMemo(() => {
    const m = new Map<NodeId, { latest: Receipt; status: 'verified' | 'failed' | 'pending' }>();
    if (!run) return m;
    const ordered = [...run.receipts].sort((a, b) => a.at.localeCompare(b.at));
    for (const r of ordered) {
      for (const n of STEP_NODES[r.step] ?? []) m.set(n, { latest: r, status: receiptStatus(r) });
    }
    return m;
  }, [run]);
  const litEdges = useMemo(() => {
    const s = new Set<ReceiptStep>();
    for (const r of run?.receipts ?? []) s.add(r.step);
    return s;
  }, [run]);

  const H = 500;
  const W = 920;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 text-[11px] text-ink/60">
        <span className="inline-flex items-center gap-1"><span className="inline-block w-6 border-t-2 border-current" /> {t('real · mainnet')}</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-6 border-t-2 border-dashed border-current" /> {t('exchange system · simulated')}</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-tone-success" /> {t('verified on-chain')}</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-danger" /> {t('check failed')}</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-ink/30" /> {t('recorded, not read yet')}</span>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-ink/10 bg-surface-1 p-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[720px] h-auto text-ink" role="img" aria-label={t('Infrastructure choreography lit by the receipts of this run')}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>
          {EDGES.map((e, i) => {
            const a = center(NODES.find((n) => n.id === e.from)!);
            const b = center(NODES.find((n) => n.id === e.to)!);
            const lit = e.steps.some((s) => litEdges.has(s));
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            return (
              <g key={i} opacity={lit ? 1 : 0.28}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" strokeWidth={lit ? 1.8 : 1} strokeDasharray={e.dashed ? '5 4' : undefined} markerEnd="url(#arrow)" />
                <text x={mx} y={my - 4} fontSize="9" textAnchor="middle" fill="currentColor" style={{ fontFamily: 'ui-monospace, monospace' }}>{e.label}</text>
              </g>
            );
          })}
          {NODES.map((n) => {
            const hit = byNode.get(n.id);
            const dot = hit ? (hit.status === 'verified' ? 'var(--tone-success, #16a34a)' : hit.status === 'failed' ? 'var(--tone-danger, #dc2626)' : 'rgba(127,127,127,.6)') : null;
            return (
              <g key={n.id} opacity={hit || !run ? 1 : 0.55}>
                <rect x={n.x} y={n.y} width={n.w} height={56} rx={10} fill="var(--surface-2, rgba(127,127,127,.08))" stroke={TONE[n.tone]} strokeWidth={hit ? 1.6 : 1} strokeDasharray={n.simulated ? '5 4' : undefined} />
                <text x={n.x + 10} y={n.y + 20} fontSize="12" fontWeight={600} fill="currentColor">{t(n.label)}</text>
                <text x={n.x + 10} y={n.y + 36} fontSize="9.5" fill="currentColor" opacity={0.65}>{t(n.sub)}</text>
                {hit ? (
                  <>
                    <circle cx={n.x + n.w - 12} cy={n.y + 12} r={4.5} fill={dot ?? 'currentColor'} />
                    <text x={n.x + 10} y={n.y + 50} fontSize="8.5" fill="currentColor" opacity={0.8} style={{ fontFamily: 'ui-monospace, monospace' }}>
                      {hit.latest.txHash ? shortHash(hit.latest.txHash, 8, 4) : t('refused before signing')}
                    </text>
                  </>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      {chain?.pote ? (
        <div className="grid gap-2 sm:grid-cols-3 text-xs">
          <div className="rounded-xl border border-ink/10 bg-surface-1 p-3">
            <div className="text-[10px] uppercase tracking-wider text-ink/50">{t('The cage, live')}</div>
            <div className="font-mono text-ink">{chain.pote.totalAssets ? (Number(chain.pote.totalAssets) / 10 ** (chain.pote.asset?.decimals ?? 6)).toFixed(4) : '—'} {chain.pote.asset?.symbol ?? 'FXRP'}</div>
            <div className="text-ink/60">{t('cooldown')} {chain.pote.cooldownSeconds ? `${Math.round(chain.pote.cooldownSeconds / 3600)} h` : t('immediate')} · {t('buffer floor')} {(chain.pote.bufferFloorBps / 100).toFixed(0)}% · {t('cap per venue')} {(chain.pote.maxVenueBps / 100).toFixed(0)}%</div>
          </div>
          <div className="rounded-xl border border-ink/10 bg-surface-1 p-3">
            <div className="text-[10px] uppercase tracking-wider text-ink/50">{t('Venues (allowlist)')}</div>
            {chain.pote.venues.length === 0 ? <div className="text-ink/60">—</div> : chain.pote.venues.map((v) => (
              <div key={v.id} className="font-mono text-ink">#{v.id} {shortHash(v.target, 6, 4)} · {(Number(v.value) / 10 ** (chain.pote?.asset?.decimals ?? 6)).toFixed(4)}</div>
            ))}
          </div>
          <div className="rounded-xl border border-ink/10 bg-surface-1 p-3">
            <div className="text-[10px] uppercase tracking-wider text-ink/50">{t('Authority')}</div>
            <div className="text-ink/60">{t('council (bridge)')} <span className="font-mono">{shortHash(chain.pote.governance.council, 6, 4)}</span></div>
            <div className="text-ink/60">{t('director')} <span className="font-mono">{/^0x0+$/.test(chain.pote.governance.director) ? t('none — only the council') : shortHash(chain.pote.governance.director, 6, 4)}</span></div>
            <div className="text-ink/60">{t('constitution DID')} {chain.council.didAnchored ? t('anchored') : t('not anchored')}</div>
          </div>
        </div>
      ) : null}
      <p className="text-[11px] text-ink/50">
        {t('What nobody can do, by bytecode: extract the principal (no such function), send capital off the allowlist, cross the buffer floor, or redeem for the client. The 30-day notice on any new venue is the client\'s exit window.')}
      </p>
    </div>
  );
}
