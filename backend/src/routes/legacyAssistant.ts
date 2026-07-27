/**
 * /api/legacy-assistant — Legacy Assistant ("Descubrir", the discovery agent).
 *
 * The conversational front door to the Legacy product: it helps a non-expert
 * find WHICH Legacy setup fits what they want to protect and explains the
 * journey. Same design as productAssistant.ts — the INVERSE of the personal
 * agents in agent.ts (no tools, no execution):
 *   - PUBLIC: no auth. It never needs the user's data — it works on abstract
 *     intent only (the constitution text and real names/addresses stay in the
 *     browser and go into the app's forms, never here).
 *   - NO tools, ever: system + messages only, so it structurally cannot build a
 *     payload or reach the signing path (invariants #1 / #7 / #8).
 *   - STATELESS: only the SSE streaming mechanics are reused; no DB persistence.
 *     Multi-turn is client-driven via `history`.
 *   - RATE-LIMITED: public and spends Astryum's own Anthropic key, so a per-IP
 *     sliding window + global daily cap bound the spend.
 *   - KEY: always Astryum's env key, server-side (invariant #2).
 */

import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { buildLegacyAssistantSystemPrompt } from '../config/legacyAssistantPrompt';
import { createSlidingWindowLimiter } from '../middleware/slidingWindowRateLimit';

const router = Router();

// Model: default to the latest capable model; a deployment can switch to a cheaper
// tier (e.g. claude-haiku-4-5) via env if cost/latency matter for this chat.
const MODEL = process.env.LEGACY_ASSISTANT_MODEL || 'claude-opus-4-8';

// Rate limiting — PUBLIC endpoint spending Astryum's Anthropic key. Same limiter
// (extracted + unit-tested) as the product assistant.
const limiter = createSlidingWindowLimiter({
  perKeyMax: Number(process.env.LEGACY_ASSISTANT_IP_MAX || 20),
  windowMs: Number(process.env.LEGACY_ASSISTANT_IP_WINDOW_MS || 5 * 60_000),
  dailyMax: Number(process.env.LEGACY_ASSISTANT_DAILY_MAX || 5000),
});

function clientIp(req: Request): string {
  const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  return fwd || req.socket.remoteAddress || 'unknown';
}

/**
 * "Guía" — the OPTIONAL journey state. Abstract ledger facts only (booleans +
 * small counters the client already read from the PUBLIC ledger): which step of
 * constitute→govern this Legacy is on. Deliberately NO addresses, NO names, NO
 * amounts — the privacy line of the cage stays exactly where it was.
 */
const JourneySchema = z
  .object({
    hasCouncil: z.boolean(),
    memberCount: z.number().int().min(0).max(32).optional(),
    quorum: z.number().int().min(0).max(4_294_967_295).optional(), // SignerQuorum is a UInt32
    quorumMargin: z.number().int().min(0).max(32).optional(),
    rehearsalComplete: z.boolean().optional(),
    signedCount: z.number().int().min(0).max(32).optional(),
    masterKeyDisabled: z.boolean().optional(),
    constitutionAnchored: z.boolean().optional(),
    escrowCount: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();

const ChatBodySchema = z.object({
  message: z.string().min(1).max(2000),
  // Prior turns, supplied by the client (stateless server). Bounded.
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(4000) }))
    .max(20)
    .optional(),
  journey: JourneySchema.optional(),
});

/** Render the journey block appended to the system prompt (Spanish, compact). */
export function renderJourneyContext(j: z.infer<typeof JourneySchema>): string {
  const yn = (b: boolean | undefined) => (b === true ? 'sí' : b === false ? 'no' : 'desconocido');
  return [
    'ESTADO REAL DEL RECORRIDO DE ESTE LEGACY (leído del ledger público, solo lectura; sin nombres ni direcciones):',
    `- Consejo constituido: ${yn(j.hasCouncil)}${j.memberCount !== undefined ? ` (${j.memberCount} firmantes${j.quorum !== undefined ? `, quórum ${j.quorum}` : ''})` : ''}`,
    j.quorumMargin !== undefined ? `- Margen de quórum (llaves que puede perder): ${j.quorumMargin}` : null,
    `- Ensayo de firmas verificado on-chain: ${yn(j.rehearsalComplete)}${j.signedCount !== undefined && j.memberCount !== undefined ? ` (${j.signedCount}/${j.memberCount} han firmado)` : ''}`,
    `- Puerta cerrada (master key deshabilitada): ${yn(j.masterKeyDisabled)}`,
    `- Constitución anclada: ${yn(j.constitutionAnchored)}`,
    j.escrowCount !== undefined ? `- Transferencias programadas activas: ${j.escrowCount}` : null,
    '',
    'Con este estado, orienta SIEMPRE hacia el SIGUIENTE paso correcto del recorrido (consejo → ensayo → cerrar la puerta → constitución → capital) y avisa de los peligros de saltárselo (margen 0, capital antes del ensayo). Sigues sin ver datos personales y sin firmar nada.',
  ]
    .filter((l): l is string => l !== null)
    .join('\n');
}

// ── "Operar": the NL → intent compiler ──────────────────────────────────────
//
// Invariant #8 verbatim: the AI COMPILES, the user signs. This endpoint turns a
// sentence into ONE deterministic intent object — never a transaction. The
// frontend takes the intent, prefills the EXISTING tested forms, the EXISTING
// prepare endpoints compose the unsigned txjson, the disclosure + simulate
// preflight (#11) verify it against the ledger, and the user signs. The LLM has
// no tools and its output is zod-validated: an intent it cannot express cannot
// happen.
//
// PRIVACY: the client scrubs XRPL addresses into {{DIR_n}} tokens BEFORE the
// message leaves the browser and re-substitutes locally on the way back. The
// schema below only admits 'SELF' or a token as destination — a raw address in
// the model's output is structurally rejected.

export const CompiledIntentSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('escrow-create'),
    amountXrp: z.number().positive().max(100_000_000_000).nullish(),
    deliveryDateISO: z.string().regex(/^\d{4}-\d{2}-\d{2}/).nullish(),
    recoveryDateISO: z.string().regex(/^\d{4}-\d{2}-\d{2}/).nullish(),
    destination: z.union([z.literal('SELF'), z.string().regex(/^\{\{DIR_\d+\}\}$/)]).nullish(),
    summary: z.string().max(300).nullish(),
  }),
  z.object({ action: z.literal('did-amend'), summary: z.string().max(300).nullish() }),
  z.object({ action: z.literal('none'), reason: z.string().max(300).nullish() }),
]);
export type CompiledIntent = z.infer<typeof CompiledIntentSchema>;

/** Extract + validate the ONE JSON object the compiler must answer with. */
export function parseCompiledIntent(text: string): CompiledIntent | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = CompiledIntentSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function buildCompilerSystemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `Eres el COMPILADOR de intents del Legacy de Astryum. Conviertes la frase del usuario en UN objeto JSON estricto y NADA más: sin prosa, sin markdown, sin explicación. Hoy es ${today}.

Acciones posibles:
1. "escrow-create" — comprometer XRP a un beneficiario con fecha de entrega (transferencia programada):
   {"action":"escrow-create","amountXrp":número|null,"deliveryDateISO":"YYYY-MM-DD"|null,"recoveryDateISO":"YYYY-MM-DD"|null,"destination":"SELF"|"{{DIR_n}}"|null,"summary":"una frase corta"}
   - destination: "SELF" si es a la propia cuenta / a sí mismo; el token {{DIR_n}} EXACTO si aparece en el mensaje; null si no se nombra a nadie.
   - NUNCA inventes cantidades ni fechas: lo que no esté en el mensaje es null.
   - Fechas relativas se resuelven contra hoy ("mañana", "en un año", "el 1 de enero" → el próximo 1 de enero).
   - recoveryDateISO solo si el usuario habla de recuperar/expirar (p.ej. "recuperable en un año" → entrega + 1 año).
2. "did-amend" — quiere cambiar/enmendar/versionar la constitución: {"action":"did-amend","summary":"..."}
3. "none" — cualquier otra cosa (preguntas, otras operaciones, fuera de alcance): {"action":"none","reason":"una frase corta en el idioma del usuario"}

Reglas duras: JSON válido en UNA línea, claves exactas, sin claves extra. Tú solo compilas: no firmas, no ejecutas, no aconsejas. Si el mensaje trae una dirección r... en claro (no debería llegar), NO la copies a destination: usa null.`;
}

// POST /api/legacy-assistant/compile — one NL sentence → one validated intent.
router.post('/compile', async (req: Request, res: Response) => {
  const rl = limiter.check(clientIp(req), Date.now());
  if (rl.limited) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    res.status(429).json({ error: 'RATE_LIMITED', retryAfter: rl.retryAfter });
    return;
  }
  const parse = z.object({ message: z.string().min(1).max(1000) }).safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'INVALID_BODY', details: parse.error.flatten() });
    return;
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'ASSISTANT_UNAVAILABLE' });
    return;
  }
  try {
    const client = new Anthropic({ apiKey });
    const reply = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: buildCompilerSystemPrompt(),
      messages: [{ role: 'user', content: parse.data.message }],
    });
    const text = reply.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const intent = parseCompiledIntent(text);
    if (!intent) {
      res.status(422).json({ error: 'UNPARSEABLE', detail: 'The compiler did not produce a valid intent.' });
      return;
    }
    res.json({ intent });
  } catch (err: any) {
    res.status(502).json({ error: 'COMPILER_ERROR', detail: err?.message ?? 'unknown' });
  }
});

// POST /api/legacy-assistant/chat — SSE stream of the assistant's reply.
router.post('/chat', async (req: Request, res: Response) => {
  const rl = limiter.check(clientIp(req), Date.now());
  if (rl.limited) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    res.status(429).json({ error: 'RATE_LIMITED', retryAfter: rl.retryAfter });
    return;
  }

  const parse = ChatBodySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'INVALID_BODY', details: parse.error.flatten() });
    return;
  }
  const { message, history = [], journey } = parse.data;

  // Always Astryum's own key, server-side (invariant #2).
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'ASSISTANT_UNAVAILABLE', message: 'Legacy assistant is not configured.' });
    return;
  }

  // Cage + Legacy manual, plus — when the client sends it — the ABSTRACT journey
  // state ("Guía"): public ledger facts (flags + counters), never names,
  // addresses or amounts. The cage does not relax: the block itself restates it.
  let system = buildLegacyAssistantSystemPrompt();
  if (journey) {
    system += `\n\n${renderJourneyContext(journey)}`;
  }

  // Stateless: build the messages array from the client-supplied history + the
  // new message. No DB persistence, no conversation storage.
  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-18).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: message },
  ];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const client = new Anthropic({ apiKey });
  try {
    // NO `tools` → the model cannot build payloads or touch the signing path.
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 1024,
      system,
      messages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ type: 'delta', text: event.delta.text })}\n\n`);
      }
    }
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err?.message ?? 'assistant error' })}\n\n`);
  } finally {
    res.end();
  }
});

export default router;
