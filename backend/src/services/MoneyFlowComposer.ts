/**
 * MoneyFlowComposer — pure helpers for the strategy assistant's
 * `compose_moneyflow` mode (F1, design doc §4).
 *
 * The LLM writes prose + at most ONE fenced ```cmf block with the CMF DRAFT
 * (name/description/direction/steps/policy). Everything trust-critical
 * happens HERE, server-side and deterministic:
 *   - the block is extracted and zod-validated (invalid → discarded, the
 *     model gets ONE retry with the validation feedback — never silently
 *     repaired);
 *   - version/id/origin are STAMPED by the server (the model cannot forge
 *     provenance — origin.source is always 'ai_copilot' on this path);
 *   - the result is dry-run translated so the user sees the exact rules
 *     before anything persists.
 *
 * No Anthropic imports here: these helpers are unit-tested without a key.
 */

import { randomUUID } from 'crypto';
import {
  CMF_VERSION,
  cmfDraftSchema,
  validateCmfInvariants,
  type CanonicalMoneyFlow,
  type CmfDraft,
  type CmfViolation,
} from '../canonical/moneyflow/CanonicalMoneyFlow';

export interface ExtractedCmfBlock {
  /** Prose with the fenced block(s) removed — what the user should read. */
  prose: string;
  /** Raw text inside the LAST fence of the given tag, if any. */
  raw?: string;
}

/** Pull the LAST ```<tag> fenced block out of a model reply — shared by the
 *  CMF composer and the transfer compiler (only the tag differs). */
export function extractFencedBlock(text: string, tag: string): ExtractedCmfBlock {
  const fence = new RegExp('```' + tag + '\\s*\\n([\\s\\S]*?)```', 'g');
  let raw: string | undefined;
  for (const match of text.matchAll(fence)) {
    raw = match[1];
  }
  const prose = text.replace(fence, '').replace(/\n{3,}/g, '\n\n').trim();
  return { prose, raw };
}

/** Pull the LAST ```cmf fenced block out of the model's reply. */
export function extractCmfBlock(text: string): ExtractedCmfBlock {
  return extractFencedBlock(text, 'cmf');
}

// `?: undefined` counter-fields: see CanonicalEvmTranslator.TranslateResult —
// the repo compiles with strict off, so unions stay accessible unnarrowed.
export type CmfDraftParse =
  | { ok: true; draft: CmfDraft; feedback?: undefined }
  | { ok: false; feedback: string; draft?: undefined };

/** Parse + zod-validate the raw block. On failure, returns retry feedback. */
export function parseCmfDraft(raw: string): CmfDraftParse {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { ok: false, feedback: `El bloque cmf no es JSON válido: ${(e as Error).message}` };
  }
  const parsed = cmfDraftSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 8)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    return { ok: false, feedback: `El bloque cmf no valida contra el schema: ${issues}` };
  }
  return { ok: true, draft: parsed.data };
}

/**
 * Stamp the server-owned fields. origin.source is ALWAYS 'ai_copilot' here —
 * it travels to IntentPayload.audit.intentSource so the audit trail can tell
 * AI-drafted flows apart (invariant: the model never writes its own provenance).
 */
export function finalizeCmfDraft(draft: CmfDraft, conversationRef?: string): CanonicalMoneyFlow {
  return {
    ...draft,
    version: CMF_VERSION,
    id: randomUUID(),
    origin: { source: 'ai_copilot', ...(conversationRef ? { conversationRef } : {}) },
  };
}

/** Human-readable retry feedback for invariant violations. */
export function violationFeedback(violations: CmfViolation[]): string {
  return (
    'El CMF viola invariantes: ' +
    violations
      .slice(0, 8)
      .map((v) => `${v.code}${v.level ? ` (L${v.level})` : ''}: ${v.message}`)
      .join('; ')
  );
}

export { validateCmfInvariants };
