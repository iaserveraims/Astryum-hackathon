import {
  extractCmfBlock,
  parseCmfDraft,
  finalizeCmfDraft,
  violationFeedback,
} from '../MoneyFlowComposer';
import { CMF_VERSION } from '../../canonical/moneyflow/CanonicalMoneyFlow';

const DRAFT_JSON = JSON.stringify({
  name: 'Protege mi carry',
  description: 'Si el HF baja de 1.5, prepara un repay de 25 USDT0 que tú firmas.',
  direction: 'protect',
  steps: [
    {
      level: 1,
      trigger: { kind: 'health-factor', comparator: 'below', threshold: 1.5 },
      actions: [
        { verb: 'repay', asset: { symbol: 'USDT0' }, amount: { type: 'absolute', value: '25' }, venue: { protocolId: 'kinetic' } },
      ],
    },
  ],
  policy: { cooldownMinutes: 60, disclosedToUser: true },
});

describe('extractCmfBlock — pulls the fenced draft out of the prose', () => {
  test('no block → prose untouched, raw undefined', () => {
    const r = extractCmfBlock('¿Cuánto USDT0 quieres repagar cuando salte?');
    expect(r.raw).toBeUndefined();
    expect(r.prose).toBe('¿Cuánto USDT0 quieres repagar cuando salte?');
  });

  test('prose + block → block extracted, prose cleaned', () => {
    const text = `Aquí tienes el borrador:\n\n\`\`\`cmf\n${DRAFT_JSON}\n\`\`\`\n\nRevisa los umbrales antes de activar.`;
    const r = extractCmfBlock(text);
    expect(r.raw?.trim()).toBe(DRAFT_JSON);
    expect(r.prose).toContain('Aquí tienes el borrador:');
    expect(r.prose).toContain('Revisa los umbrales');
    expect(r.prose).not.toContain('```');
  });

  test('two blocks → the LAST one wins (the model corrected itself)', () => {
    const text = `\`\`\`cmf\n{"old":true}\n\`\`\`\nMejor así:\n\`\`\`cmf\n${DRAFT_JSON}\n\`\`\``;
    expect(extractCmfBlock(text).raw?.trim()).toBe(DRAFT_JSON);
  });
});

describe('parseCmfDraft — the zod gate (invalid = discarded, with feedback)', () => {
  test('valid draft parses', () => {
    const r = parseCmfDraft(DRAFT_JSON);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.draft.name).toBe('Protege mi carry');
  });

  test('broken JSON → feedback names the parse problem', () => {
    const r = parseCmfDraft('{not json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.feedback).toMatch(/no es JSON válido/);
  });

  test('schema violation → feedback carries the zod paths', () => {
    const bad = JSON.parse(DRAFT_JSON);
    bad.policy.disclosedToUser = false; // invariant #6 literal
    const r = parseCmfDraft(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.feedback).toMatch(/policy\.disclosedToUser/);
  });
});

describe('finalizeCmfDraft — the server stamps provenance, never the model', () => {
  test('stamps version, a fresh id, and origin ai_copilot (+conversationRef)', () => {
    const parsed = parseCmfDraft(DRAFT_JSON);
    if (!parsed.ok) throw new Error('fixture must parse');
    const a = finalizeCmfDraft(parsed.draft, 'session-123');
    expect(a.version).toBe(CMF_VERSION);
    expect(a.id.length).toBeGreaterThanOrEqual(8);
    expect(a.origin).toEqual({ source: 'ai_copilot', conversationRef: 'session-123' });
    // ids are unique per proposal
    const b = finalizeCmfDraft(parsed.draft);
    expect(b.id).not.toBe(a.id);
    expect(b.origin).toEqual({ source: 'ai_copilot' });
  });

  test('a draft claiming its own origin cannot override the stamp', () => {
    const parsed = parseCmfDraft(DRAFT_JSON);
    if (!parsed.ok) throw new Error('fixture must parse');
    const forged = { ...parsed.draft, origin: { source: 'user' } } as never;
    const final = finalizeCmfDraft(forged);
    expect(final.origin.source).toBe('ai_copilot');
  });
});

describe('violationFeedback — readable retry message', () => {
  test('joins codes, levels and messages', () => {
    const msg = violationFeedback([
      { code: 'non_emt_stable', message: 'USDT0 only for de-risking.', level: 1 },
      { code: 'expired_flow', message: 'expiry in the past.' },
    ]);
    expect(msg).toMatch(/non_emt_stable \(L1\): USDT0 only for de-risking\./);
    expect(msg).toMatch(/expired_flow: expiry in the past\./);
  });
});
