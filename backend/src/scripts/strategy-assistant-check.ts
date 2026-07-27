/**
 * strategy-assistant-check — reproduces the exact conversation that failed with the
 * old regex agent, now against the LLM + real metrics table, and prints the literal
 * responses. This is the Fix 3 verification (loop bug dead + neutral honest table).
 *
 * Rates here are REPRESENTATIVE (dev has no live Flare RPC/FTSO). The numbers still
 * come from the tested math (StrategyMetricsService/KineticIsoMath) — in prod the
 * endpoint feeds the same calculator with LIVE rates. Run:
 *     npx ts-node src/scripts/strategy-assistant-check.ts   (needs ANTHROPIC_API_KEY in .env)
 */

import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { StrategyMetricsService } from '../services/StrategyMetricsService';
import { buildStrategyAssistantSystemPrompt } from '../config/strategyAssistantPrompt';

dotenv.config();

const MODEL = process.env.PRODUCT_ASSISTANT_MODEL || 'claude-opus-4-8';
// Representative dev rates (prod uses live FTSO price + CF + borrow/supply APR).
const RATES = { fxrpPriceUSD: 2.0, collateralFactor: 0.7, borrowAprPct: 15.5, supplyAprPct: 2.0 };

const recommends = (s: string) =>
  /(la mejor|te recomiendo|deber[íi]as elegir|la m[áa]s segura para ti|para tu caso.*mejor|i recommend|the best|you should (go|pick|choose))/i.test(s);
const repeatsVerbatim = (prev: string, next: string) => prev.trim() === next.trim();

async function ask(client: Anthropic, system: string, messages: Anthropic.MessageParam[]): Promise<string> {
  const msg = await client.messages.create({ model: MODEL, max_tokens: 1400, system, messages });
  const b = msg.content.find((x) => x.type === 'text') as { text: string } | undefined;
  return b?.text ?? '(no text)';
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('No ANTHROPIC_API_KEY (put it in backend/.env).');
    process.exit(1);
  }
  const client = new Anthropic({ apiKey });

  // The user's case: 10000 XRP, wants ~$200 without selling. Build the real table.
  const metrics = StrategyMetricsService.computeCarryOptions(10000, RATES, { targetUsd: 200 });
  const system = buildStrategyAssistantSystemPrompt(StrategyMetricsService.toContextTable(metrics));

  console.log(`\n=== Strategy agent — loop-bug case (model: ${MODEL}, rates: representativas) ===\n`);
  console.log('TABLA (calculada, la que ve el LLM):');
  console.log(StrategyMetricsService.toContextTable(metrics).replace(/^/gm, '   '));
  console.log('');

  const messages: Anthropic.MessageParam[] = [];

  // Turn 1 — the exact message that used to loop
  const q1 = "I want to use my 10000 xrp but i don't want to sell it, i only need a few 200 dollars";
  messages.push({ role: 'user', content: q1 });
  const r1 = await ask(client, system, messages);
  messages.push({ role: 'assistant', content: r1 });
  console.log(`[turn 1] U: ${q1}`);
  console.log(`         A: ${r1.replace(/\n/g, '\n            ')}`);
  const t1reflects = /200/.test(r1) && /(borrow|prestad|préstamo|collateral|colateral|usdt0|liquidaci)/i.test(r1);
  console.log(`         ${t1reflects ? '✓' : '⚠'} refleja el objetivo (~$200 contra el XRP)  ${recommends(r1) ? '⚠ RECOMIENDA' : '✓ no recomienda'}\n`);

  // Turn 2 — "minimum risk": must be interpreted, NOT looped
  const q2 = 'I want the minimum risk';
  messages.push({ role: 'user', content: q2 });
  const r2 = await ask(client, system, messages);
  console.log(`[turn 2] U: ${q2}`);
  console.log(`         A: ${r2.replace(/\n/g, '\n            ')}`);
  const t2interprets = /(sin deuda|lend|solo supply|conservad|menor riesgo|sin riesgo|no debt|lowest risk|minimum risk)/i.test(r2);
  const t2loops = repeatsVerbatim(r1, r2);
  console.log(
    `         ${t2interprets && !t2loops ? '✓' : '⚠'} interpreta "minimum risk" (mapea a menor riesgo)  ` +
      `${t2loops ? '⚠ BUCLE (repite verbatim)' : '✓ no repite'}  ${recommends(r2) ? '⚠ RECOMIENDA' : '✓ no recomienda'}\n`,
  );

  const ok = t1reflects && t2interprets && !t2loops && !recommends(r1) && !recommends(r2);
  console.log(`=== ${ok ? '✅ bucle muerto + neutral' : '❌ revisar arriba'} ===`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
