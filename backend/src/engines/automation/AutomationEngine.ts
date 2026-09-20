import { prisma } from '../../database/prismaClient';
import { PortfolioEngine } from '../portfolio/PortfolioEngine';
import { RiskEngine } from '../risk/RiskEngine';
import { IntentEngine } from '../intent/IntentEngine';
import { intentPreparationEngine } from '../../control-plane/IntentPreparationEngine';
import { regulatedRelayBoundary } from '../../partners/RegulatedRelayBoundary';
import { PushNotificationService } from '../../services/PushNotificationService';
import { cooldownService } from '../../control-plane/policy/CooldownService';
import { jurisdictionService } from '../../services/JurisdictionService';
import { emRepayPushUrl } from './emRepayNudge';
import {
  TriggerEvaluator,
  type TriggerConfig,
  type TriggerEvalResult,
} from './TriggerEvaluator';
import type { ProtocolActionKind } from '../../types/domain/Protocol';

/**
 * V2: Prepared flow node action types. Only prepare_* nodes are allowed —
 * no node type triggers direct execution. Every node creates a pending
 * IntentAuthorizationSession that the user must review before authorization.
 */
export type FlowNodeType =
  | 'prepare_swap'
  | 'prepare_supply'
  | 'prepare_borrow'
  | 'prepare_repay'
  | 'prepare_stake'
  | 'prepare_unstake'
  | 'prepare_vault_deposit'
  | 'prepare_vault_withdraw'
  | 'prepare_swap_and_supply'
  | 'prepare_claim_rewards'
  | 'prepare_bridge';

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  params: Record<string, unknown>;
}

/** What `PushNotificationService.sendToUser` answers. */
type PushOutcome = { sent: number; failed: number; skipped: number };

/**
 * G3-final (blocker 4) — how long the tick is willing to WAIT for a push whose
 * result decides an occurrence stamp.
 */
const PUSH_AWAIT_TIMEOUT_MS = 10_000;

/**
 * Waits for a push, bounded. A timeout is NOT a delivery verdict: it resolves
 * `undefined` — "I could not read whether it landed" — and every caller treats
 * an unread delivery as NOT delivered, so the occurrence stays OWED and is
 * retried. Never the other way round: an unread push must never burn a month.
 * (It cannot cancel the underlying fetch from here; that needs the signal in
 * PushNotificationService. It only stops the TICK from hanging on it.)
 */
async function awaitPushBounded(
  delivery: Promise<PushOutcome | undefined>,
  onTimeout: () => void,
): Promise<PushOutcome | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      onTimeout();
      resolve(undefined);
    }, PUSH_AWAIT_TIMEOUT_MS);
    // A notification must never hold the process open.
    (timer as unknown as { unref?: () => void }).unref?.();
  });
  try {
    return await Promise.race([delivery, bound]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * AutomationEngine V1/V2 — prepare-only.
 *
 * V1 tick (every 60s):
 *  1. Load enabled rules (group by walletAddress)
 *  2. Compute portfolio + risk per wallet (cached 30s)
 *  3. Evaluate each rule with TriggerEvaluator
 *  4. If fired AND cooldown ok:
 *     a. Create Alert
 *     b. (best-effort) Prepare TransactionIntent via IntentEngine
 *     c. Persist AutomationRun(status='intent_prepared' | 'triggered' | 'error')
 *     d. NEVER broadcast. NEVER sign.
 */
export class AutomationEngine {
  private static instance: AutomationEngine | null = null;
  static getInstance(): AutomationEngine {
    if (!this.instance) this.instance = new AutomationEngine();
    return this.instance;
  }

  /**
   * G3-tormenta (R5) — the evaluator's non-firing REASON used to be dropped on
   * the floor at `if (!evalResult.fired) continue;`: "retry held for 59 min",
   * "live price unavailable for XRP", "no priced XRP balance in this snapshot"
   * were readable only from a test. Logged when it CHANGES for that rule, never
   * once a minute forever — the tick is a singleton in production
   * (index-simple.ts uses getInstance), so this survives ticks. Bounded by the
   * rule count; cleared as soon as the rule fires or goes quiet.
   */
  private readonly lastSilentReason = new Map<string, string>();

  /**
   * G3-final (blocker 3) — one closing notice per (rule, occurrence) per
   * process. Key: rule id → occurrence signature. See
   * `announceExpiredOccurrence`: without this, a stamp that keeps failing
   * turned the closing notice itself into the storm it came to kill.
   */
  private readonly announcedExpiry = new Map<string, string>();

  async tick(): Promise<{ ruleCount: number; firedCount: number }> {
    let rules;
    try {
      rules = await prisma.automationRule.findMany({
        where: { enabled: true },
        include: { wallet: true, protocol: true },
      });
    } catch (err) {
      console.warn('[automation] tick: rules read failed:', (err as Error).message);
      return { ruleCount: 0, firedCount: 0 };
    }

    // G3-final (blocker 6) — both in-process maps are keyed by rule id and
    // nothing ever dropped the entry of a rule that was deleted or disabled, so
    // a process that runs for months leaked one string per rule that ever went
    // quiet. The read above IS the live set of enabled rules; anything else is
    // gone. Pruned only after a SUCCESSFUL read — a failed read is "I could not
    // look", never "they no longer exist" (the early return above keeps both
    // maps untouched on that path).
    const liveRuleIds = new Set(rules.map((r) => r.id));
    for (const id of this.lastSilentReason.keys()) {
      if (!liveRuleIds.has(id)) this.lastSilentReason.delete(id);
    }
    for (const id of this.announcedExpiry.keys()) {
      if (!liveRuleIds.has(id)) this.announcedExpiry.delete(id);
    }

    if (rules.length === 0) return { ruleCount: 0, firedCount: 0 };

    // Group by wallet to avoid recomputing portfolio per rule.
    //
    // Chain resolution (bug): the rule stores NO chainId of its own —
    // and the Wallet row keeps its CONNECT-time chain (EVM connects store 1 or
    // null), so grouping by wallet.chainId scanned the WRONG chain for a Flare
    // rule on an Ethereum-linked wallet: empty portfolio → HF undefined →
    // HF_BELOW never fired, silently. The rule's Protocol (resolved at create
    // time against the request's chainId — kinetic@14) is the authoritative
    // scope; wallet.chainId remains only for protocol-less rules (council
    // payments, savings escrow), whose behavior is unchanged.
    const byWallet = new Map<string, typeof rules>();
    for (const r of rules) {
      // H5 — an action whose venue lives on ONE chain by construction pins it
      // itself. `emRepay` is the FXRP/RLUSD market on Ethereum: nowhere else.
      // Without this the chain came from the Protocol row, and there is no
      // `morpho-blue@1` row (schema: Protocol.slug is globally @unique, and the
      // seed only plants Flare protocols) → protocolId null → the rule fell
      // back to `wallet.chainId ?? 14` and the tick scanned FLARE for an
      // Ethereum position: exactly the b207fff bug, re-entering by the back
      // door. A rule that silently watches the wrong chain never fires.
      const actionKind = (r.action as { kind?: string } | null)?.kind;
      const pinnedChainId = actionKind === 'emRepay' ? 1 : undefined;
      const ruleChainId = pinnedChainId ?? r.protocol?.chainId ?? r.wallet.chainId ?? 14;
      const key = `${r.wallet.address}:${ruleChainId}`;
      if (!byWallet.has(key)) byWallet.set(key, []);
      byWallet.get(key)!.push(r);
    }

    let firedCount = 0;
    const now = new Date();

    // La MISMA frontera que la ruta para lo que la regla abre. Sin esto el tick
    // trabajaba el carril de Ethereum aunque el interruptor estuviera apagado
    // (una lectura por wallet cada 60 s) y empujaba al usuario a abrir una
    // acción que la ruta le va a negar.
    const EM_ENTRY_RULE_KINDS = new Set<string>(); // hoy ninguna: emRepay es salida
    const emRailGate = (() => {
      if (process.env.ETH_RLUSD_FXRP_ENABLED !== 'true') return 'ETH_RLUSD_FXRP_DISABLED';
      const hasEmEntry = rules.some((r) =>
        EM_ENTRY_RULE_KINDS.has(String((r.action as { kind?: string } | null)?.kind ?? '')),
      );
      if (!hasEmEntry) return null;
      const geo = jurisdictionService.isDefiExecutionAllowed(null);
      return geo.allowed ? null : `GEOFENCE_BLOCKED: ${geo.reason ?? 'region not allowed'}`;
    })();
    const emRailOpen = emRailGate === null;
    if (!emRailOpen && rules.some((r) => (r.action as { kind?: string } | null)?.kind === 'emRepay')) {
      console.warn(
        `[automation] emRepay rules NOT watched this tick — the Ethereum rail is closed (${emRailGate}).`,
      );
    }

    // Prefetch the live supply APYs every APY_BELOW rule needs — ONE read per
    // tick for all rules (the evaluator stays pure/sync over ctx.rates).
    let rates: Record<string, number> = {};
    const apyMarkets = rules
      .map((r) => r.trigger as TriggerConfig)
      .filter((t): t is Extract<TriggerConfig, { type: 'APY_BELOW' }> => t?.type === 'APY_BELOW')
      .map((t) => t.market);
    if (apyMarkets.length > 0) {
      try {
        const { readSupplyAprs } = await import('../../services/flare/MarketRatesService');
        rates = await readSupplyAprs(apyMarkets);
      } catch (err) {
        console.warn('[automation] APY prefetch failed (APY rules skip this tick):', (err as Error).message);
      }
    }

    // Prefetch the live FTSO prices every PRICE_DROP_PCT rule needs — ONE
    // read per tick (the provider memoizes 60s on top). The provider answers
    // 0 for a FAILED read: those never enter ctx.prices, so the evaluator's
    // "no data ⇒ never fire" holds and a dead feed cannot look like a crash.
    const prices: Record<string, number> = {};
    const priceAssets: string[] = [
      ...new Set<string>(
        rules
          .map((r) => r.trigger as TriggerConfig)
          .filter((t): t is Extract<TriggerConfig, { type: 'PRICE_DROP_PCT' }> => t?.type === 'PRICE_DROP_PCT')
          .map((t) => String(t.asset).toUpperCase()),
      ),
    ];
    // H6 — el HF que decide un `emRepay` debe ser el del MERCADO, no el del
    // portfolio. El snapshot de cartera no tiene adapter para morpho-blue, así
    // que `risk.healthFactor` llegaba vacío (o de otra chain) y la protección
    // no saltaba NUNCA: fallo silencioso del peor tipo — el usuario cree que
    // tiene una red debajo. `emRepayFireCheck` ya lee la posición viva; aquí
    // se adelanta al disparo, UNA lectura por wallet y tick.
    const emHealthByWallet: Record<string, number> = {};
    const emWallets: string[] = emRailOpen
      ? [
          ...new Set<string>(
            rules
              .filter((r) => (r.action as { kind?: string } | null)?.kind === 'emRepay')
              .map((r) => String(r.wallet.address)),
          ),
        ]
      : [];
    if (emWallets.length > 0) {
      try {
        const { makeEthersMorphoReader, emRepayFireCheck } = await import(
          '../../services/EthMorphoMarketService'
        );
        const { getRpcForChain } = await import('../../utils/rpcForChain');
        const reader = makeEthersMorphoReader(getRpcForChain(1));
        for (const addr of emWallets) {
          try {
            const check = await emRepayFireCheck(reader, addr);
            // Sin deuda no hay HF que vigilar (y el check lo dice): no se
            // inventa un número, simplemente no entra en el contexto.
            if (typeof check.healthFactor === 'number' && Number.isFinite(check.healthFactor)) {
              emHealthByWallet[addr.toLowerCase()] = check.healthFactor;
            }
          } catch {
            /* esta wallet no se pudo leer — su regla no dispara este tick */
          }
        }
      } catch (err) {
        console.warn('[automation] em HF prefetch failed (em rules skip this tick):', (err as Error).message);
      }
    }

    if (priceAssets.length > 0) {
      try {
        const { createFTSOPriceProvider } = await import('../../engines/normalisation/NormalisationEngine');
        const provider = await createFTSOPriceProvider();
        const priced = await provider.getPricesUSD?.(priceAssets);
        if (priced) {
          for (const [sym, price] of priced) {
            if (price > 0) prices[sym.toUpperCase()] = price;
          }
        } else {
          for (const sym of priceAssets) {
            const price = await provider.getPriceUSD(sym);
            if (price > 0) prices[sym] = price;
          }
        }
      } catch (err) {
        console.warn('[automation] price prefetch failed (price rules skip this tick):', (err as Error).message);
      }
    }

    for (const [key, walletRules] of byWallet) {
      const [address, chainIdStr] = key.split(':');
      const chainId = parseInt(chainIdStr, 10) || 14;

      let portfolio;
      try {
        portfolio = await PortfolioEngine.getInstance().getPortfolio(address, chainId);
      } catch (err) {
        console.warn(`[automation] portfolio read failed for ${address}:`, (err as Error).message);
        // Portfolio-independent triggers (TIME_TRIGGER) must still run — a
        // council account whose snapshot fails would otherwise silently freeze
        // its scheduled rules. Empty snapshot; state-reading triggers no-op.
        portfolio = { positions: [] } as never;
      }
      const risk = RiskEngine.getInstance().evaluateSnapshot(portfolio);

      for (const rule of walletRules) {
        // Enforced TTL: an expired rule is disabled, never evaluated (guardarraíl
        // MoneyFlows — caduca sola; renovarla es un acto explícito del dueño).
        if (rule.expiresAt && rule.expiresAt.getTime() <= now.getTime()) {
          try {
            await prisma.automationRule.update({
              where: { id: rule.id },
              data: { enabled: false },
            });
            console.log(`[automation] rule ${rule.id} (${rule.name}) expired ${rule.expiresAt.toISOString()} — disabled`);
          } catch {
            /* next tick retries the disable */
          }
          continue;
        }
        // Cooldown
        if (
          rule.lastTriggeredAt &&
          rule.cooldownMinutes > 0 &&
          now.getTime() - rule.lastTriggeredAt.getTime() <
            rule.cooldownMinutes * 60_000
        ) {
          continue;
        }

        const isEmRule = (rule.action as { kind?: string } | null)?.kind === 'emRepay';
        // Carril cerrado ⇒ la regla no se evalúa siquiera. Avisar de un repago
        // en un módulo que el usuario no puede usar es empujarle contra una
        // puerta cerrada; y sin esto el geofence solo vivía en la ruta.
        if (isEmRule && !emRailOpen) continue;

        const trigger = rule.trigger as TriggerConfig;
        // H6: para una regla del mercado de Ethereum, el HF que manda es el
        // leído de ESE mercado — no el del snapshot de cartera.
        const emHf = isEmRule
          ? emHealthByWallet[rule.wallet.address.toLowerCase()]
          : undefined;
        const evalResult = TriggerEvaluator.evaluate(trigger, {
          portfolio,
          risk: emHf === undefined ? risk : { ...risk, healthFactor: emHf },
          now,
          // G3 — two stamps, two jobs: `lastTriggeredAt` is the cooldown
          // (written on every fire) and `lastArtefactAt` is the SERVED
          // occurrence (written only when the fire produced its artefact). The
          // cron evaluator measures against the second; the first only spaces
          // retries of an occurrence still owed.
          lastTriggeredAt: rule.lastTriggeredAt,
          lastArtefactAt: rule.lastArtefactAt,
          rates,
          prices,
        });

        if (!evalResult.fired) {
          if (evalResult.expiredOccurrence) {
            // G3-tormenta (R3) — the promise caducó: say it, once.
            await this.announceExpiredOccurrence(
              rule,
              trigger,
              evalResult.expiredOccurrence,
              evalResult.reason ?? null,
              now,
            );
          } else if (evalResult.reason) {
            if (this.lastSilentReason.get(rule.id) !== evalResult.reason) {
              this.lastSilentReason.set(rule.id, evalResult.reason);
              console.log(
                `[automation] rule ${rule.id} (${rule.name}) did not fire — ${evalResult.reason}`,
              );
            }
          } else {
            this.lastSilentReason.delete(rule.id);
          }
          continue;
        }
        this.lastSilentReason.delete(rule.id);

        firedCount += 1;

        // Per V1: prepare-only
        const ruleAction = (rule.action as { kind?: ProtocolActionKind; protocolId?: string; positionId?: string; params?: Record<string, unknown> }) ?? {};

        let intentId: string | undefined;
        let runStatus: 'triggered' | 'intent_prepared' | 'proposal_created' | 'error' = 'triggered';
        let runNotes = evalResult.reason ?? null;
        /**
         * G3 — ¿este disparo llegó a producir su ARTEFACTO (propuesta, intent,
         * aviso accionable)? Solo entonces cuenta como «fired ×N» en la
         * superficie. Un `error` ya no contaba; faltaba el consejo ocupado, que
         * dispara, no produce nada, y aun así inflaba el contador que la
         * familia lee como «esto ya se hizo».
         */
        let artefactProduced = true;
        /**
         * G3-tormenta (R4) — «intenté avisar» no es «el artefacto llegó».
         * For the branches whose ONLY artefact is the nudge (scheduledPayment,
         * escrow, emRepay) the push was fire-and-forget and the Alert insert was
         * best-effort: when BOTH failed, `lastArtefactAt` was stamped anyway and
         * the month burnt exactly as before the split — the one place where the
         * declared objective literally did not hold. These two flags carry the
         * delivery so the occurrence stamp can depend on it. (The council and
         * intent branches keep their fire-and-forget push: their artefact is a
         * ROW — proposal / TransactionIntent — that exists whether or not the
         * notification lands.)
         */
        let artefactIsNudge = false;
        let nudgeDelivery:
          | Promise<{ sent: number; failed: number; skipped: number } | undefined>
          | null = null;
        /**
         * LA PUERTA, también dentro de la app. El deep-link vivía
         * SOLO en el push: quien abre Astryum en vez de tocar la notificación
         * —o quien no tiene push activo, que es el caso normal en escritorio—
         * leía «repay ready to prepare» en una fila de texto muerta y tenía que
         * ir a buscar la posición a mano, con el reloj de la liquidación
         * corriendo. Es exactamente el hallazgo H4 («un aviso que no abre nada
         * es un aviso que miente») reentrando por la superficie de al lado.
         *
         * Va en `data.url` para que la Alert viaje con su puerta sin tocar el
         * esquema, y la lista del Home la pinta como enlace cuando existe.
         */
        let alertUrl: string | undefined;

        if (ruleAction.kind === 'councilPayment' || ruleAction.kind === 'councilOrder') {
          // Governed MoneyFlow (sign-at-trigger, N firmantes): the trigger
          // COMPOSES a proposal into the council inbox; the QUORUM signs it
          // there. The rule holds zero authority — nothing moves without the
          // quorum. One live proposal per account (XRPL pins one Sequence):
          // a busy council is a retry-after-cooldown, not an error.
          try {
            const { composeCouncilRuleTx, createCouncilProposalFromRule } = await import(
              '../../services/CouncilProposalService'
            );
            const composed = await composeCouncilRuleTx(
              ruleAction.kind,
              (ruleAction.params ?? {}) as Record<string, unknown>,
              rule.wallet.address,
            );
            const outcome = await createCouncilProposalFromRule({
              account: composed.council,
              xrplTx: composed.xrplTx,
              title: `${rule.name} — ${composed.summary}`.slice(0, 120),
              createdByUserId: rule.wallet.userId,
            });
            if (outcome.ok) {
              runStatus = 'proposal_created';
              runNotes = `${runNotes ?? 'trigger fired'} — proposal ${outcome.proposalId} in the council inbox (quorum signs)`;
              cooldownService.markBroadcast(rule.id, now);
              alertUrl = '/app/legacy?tab=proposals';
              void PushNotificationService.getInstance()
                .sendToUser(rule.wallet.userId, {
                  type: 'INTENT_READY',
                  title: `MoneyFlow: ${rule.name} — council proposal ready`,
                  body: `${composed.summary} — the quorum reviews and signs in the inbox. Nothing moves without those signatures.`,
                  // G5 (auditorí) — el aviso decía «firma en la bandeja»
                  // y abría `/app/wallets`, que hoy redirige al mazo de wallets:
                  // la bandeja (ProposalInbox) SOLO se monta en /app/legacy.
                  // Se abría una página válida sin la propuesta, y a los 7 días
                  // caducaba. La rama emRepay ya había aprendido a deep-linkear;
                  // las del consejo se quedaron con el enlace romo.
                  url: '/app/legacy?tab=proposals',
                  data: { ruleId: rule.id, proposalId: outcome.proposalId, trigger: trigger.type },
                })
                .catch((err: Error) => console.warn('[automation] push failed:', err.message));
            } else if (outcome.reason === 'LIVE_PROPOSAL_EXISTS') {
              runStatus = 'triggered';
              runNotes = `${runNotes ?? 'trigger fired'} — council busy (one live proposal per account); retries after cooldown`;
              cooldownService.markBroadcast(rule.id, now);
              // G3 (auditorí) — el consejo ocupado NO produjo propuesta:
              // contar este disparo pintaba «fired ×1» en la bandeja para un mes
              // en el que la familia no tiene NADA que firmar. Es la misma
              // familia «éxito no ganado» que el guard de `error` ya cubría; le
              // faltaba este caso, que además es el más frecuente.
              artefactProduced = false;
            } else {
              runStatus = 'error';
              runNotes = `council_proposal_failed (${outcome.reason}): ${outcome.detail}`;
            }
          } catch (err) {
            runStatus = 'error';
            runNotes = `council_compose_failed: ${(err as Error).message}`;
          }
        } else if (ruleAction.kind === 'scheduledPayment') {
          // Personal «domiciliación» (M1, sign-at-trigger with ONE signer):
          // nothing is persisted server-side — the tick VALIDATES the payment
          // (a rule with a broken destination must fail loudly at fire time,
          // not at the signing door) and nudges the OWNER; the Payment txjson
          // is composed FRESH by the prepare route when they open the door,
          // and signed in their own Xaman. Zero signing, zero broadcast.
          try {
            const { composeScheduledPaymentTx } = await import('../../services/ScheduledPaymentService');
            const composed = composeScheduledPaymentTx(
              rule.wallet.address,
              (ruleAction.params ?? {}) as Record<string, unknown>,
            );
            runStatus = 'triggered';
            runNotes = `${runNotes ?? 'trigger fired'} — scheduled payment ready to sign (${composed.summary})`;
            cooldownService.markBroadcast(rule.id, now);
            // R4: the nudge IS the artefact here — nothing is persisted for the
            // owner other than this. Its outcome decides the occurrence stamp.
            artefactIsNudge = true;
            alertUrl = '/app/strategies';
            nudgeDelivery = PushNotificationService.getInstance()
              .sendToUser(rule.wallet.userId, {
                type: 'INTENT_READY',
                title: `MoneyFlow: ${rule.name} — payment ready to sign`,
                body: `${composed.summary} — review and sign it in Xaman from Strategies. Nothing moves without your signature.`,
                url: '/app/strategies',
                data: { ruleId: rule.id, trigger: trigger.type, params: ruleAction.params ?? {} },
              })
              .catch((err: Error) => {
                console.warn('[automation] push failed:', err.message);
                return undefined;
              });
          } catch (err) {
            runStatus = 'error';
            runNotes = `scheduled_payment_invalid: ${(err as Error).message}`;
          }
        } else if (ruleAction.kind === 'emRepay') {
          // W5/B7 — Ethereum repay (FXRP/RLUSD Morpho market), M1 pattern:
          // the tick VALIDATES the live position and nudges the OWNER; the
          // repay legs are composed FRESH by POST /eth-morpho/prepare when
          // they open the door (debt grows with interest; repay-full needs
          // LIVE borrowShares — trigger-time calldata arrives stale at the
          // signature). Zero signing, zero broadcast.
          try {
            const { makeEthersMorphoReader, emRepayFireCheck } = await import(
              '../../services/EthMorphoMarketService'
            );
            const { getRpcForChain } = await import('../../utils/rpcForChain');
            const check = await emRepayFireCheck(
              makeEthersMorphoReader(getRpcForChain(1)),
              rule.wallet.address,
            );
            if (!check.ok) {
              // Fired but nothing to repay (debt already closed): stamp the
              // cooldown, never nudge — a push to repay a vanished debt is the
              // "screen lies" family.
              runStatus = 'triggered';
              runNotes = `${runNotes ?? 'trigger fired'} — ${check.note}`;
              cooldownService.markBroadcast(rule.id, now);
            } else {
              runStatus = 'triggered';
              runNotes = `${runNotes ?? 'trigger fired'} — Ethereum repay ready to prepare (HF ${(check.healthFactor ?? 0).toFixed(2)})`;
              cooldownService.markBroadcast(rule.id, now);
              // R4: nudge-only branch — the repay legs are composed later by the
              // route, so this notice is the whole artefact.
              artefactIsNudge = true;
              // La MISMA puerta en los dos sitios donde se lee el aviso.
              alertUrl = emRepayPushUrl(rule.wallet.address);
              nudgeDelivery = PushNotificationService.getInstance()
                .sendToUser(rule.wallet.userId, {
                  type: 'INTENT_READY',
                  title: `MoneyFlow: ${rule.name} — repay ready to prepare`,
                  body:
                    `${runNotes} — open Strategies to review and sign on Ethereum. ` +
                    // Binding adjustment #3 (the ammo): the repay spends RLUSD
                    // ON ETHEREUM — the Sentora leg redeems on the same chain.
                    'You need RLUSD reachable on Ethereum (the Sentora lend-only position redeems on the same chain). Nothing moves without your signature.',
                  // The deep-link the board actually understands (H4): a bare
                  // /app/strategies landed on the page and opened NOTHING —
                  // the nudge told the owner to act and then hid the door.
                  // Vive en emRepayNudge para que el ensayo en seco enseñe LA
                  // MISMA puerta que abre el aviso, no una copia.
                  url: emRepayPushUrl(rule.wallet.address),
                  data: {
                    ruleId: rule.id,
                    trigger: trigger.type,
                    market: 'fxrp-rlusd-eth',
                    mode: (ruleAction.params as { mode?: string } | undefined)?.mode ?? 'partial',
                    debtBase: check.debtBase,
                  },
                })
                .catch((err: Error) => {
                  console.warn('[automation] push failed:', err.message);
                  return undefined;
                });
            }
          } catch (err) {
            runStatus = 'error';
            runNotes = `em_repay_check_failed: ${(err as Error).message}`;
          }
        } else if (ruleAction.kind === 'escrow') {
          // XRPL savings-escrow (B.1, N1): nothing is prepared server-side —
          // the EscrowCreate txjson is composed FRESH in the Savings surface
          // when the user acts (FinishAfter must be relative to signing time,
          // not trigger time) and signed in Xaman. The trigger's job is the
          // nudge; the alert + push below carry the prefill.
          runStatus = 'triggered';
          runNotes = `${runNotes ?? 'trigger fired'} — savings escrow suggested`;
          cooldownService.markBroadcast(rule.id, now);
          // R4: nudge-only branch — nothing is prepared server-side, so the
          // notice landing IS the artefact.
          artefactIsNudge = true;
          alertUrl = '/app/savings';
          nudgeDelivery = PushNotificationService.getInstance()
            .sendToUser(rule.wallet.userId, {
              type: 'SAVINGS_READY',
              title: `Automation: ${rule.name} — idle XRP detected`,
              body: `${evalResult.reason ?? 'trigger fired'} — set it aside from the Savings surface (you sign in Xaman).`,
              url: '/app/savings',
              data: {
                ruleId: rule.id,
                trigger: trigger.type,
                params: ruleAction.params ?? {},
              },
            })
            .catch((err: Error) => {
              console.warn('[automation] push failed:', err.message);
              return undefined;
            });
        } else if (ruleAction.kind && ruleAction.protocolId) {
          try {
            const intent = await IntentEngine.getInstance().createIntent({
              walletAddress: rule.wallet.address,
              chainId,
              sessionId: `automation:${rule.id}`,
              protocolId: ruleAction.protocolId,
              actionKind: ruleAction.kind,
              positionId: ruleAction.positionId,
              params: ruleAction.params ?? {},
              source: 'automation',
              ruleId: rule.id,
              ruleCooldownMinutes: rule.cooldownMinutes ?? undefined,
            });
            intentId = intent.id;
            runStatus = 'intent_prepared';
            // V1.1 in-memory cooldown — mirrors the DB-level lastTriggeredAt
            // update below, but lets PolicyGuard short-circuit subsequent
            // ticks without paying a DB round-trip.
            cooldownService.markBroadcast(rule.id, now);
          } catch (err) {
            runStatus = 'error';
            runNotes = `intent_prepare_failed: ${(err as Error).message}`;
          }
        }

        /**
         * G3-tormenta (R1) — la tormenta de avisos: 1 → 37.
         *
         * WHAT WAS FAILING IN SILENCE: measured on this very evaluator, a
         * monthly occurrence whose action stays barren fires 37 times inside the
         * 36h catch-up window (the first attempt plus one per hour), and every
         * single one inserted an AutomationRun AND an Alert the family reads
         * (GET /alerts, GET /rules/:id/runs — take 50, so the storm also buries
         * the history the MoneyFlows panel summarises). The alert loop the retry
         * floor was written to prevent was still there, only at 60 minutes
         * instead of 60 seconds. The first failure is the news; 36 repeats of
         * the SAME barren outcome are noise.
         */
        const cronRetry = evalResult.data?.retry === true;
        const producedNow = runStatus !== 'error' && artefactProduced;
        const silentRetry = cronRetry && !artefactIsNudge && !producedNow;

        // Create AutomationRun
        let runId: string | undefined;
        let alertCreated = false;
        if (silentRetry) {
          console.log(
            `[automation] rule ${rule.id} (${rule.name}) — retry of the ${String(
              evalResult.data?.dueAt ?? 'current',
            )} occurrence is still barren (${runNotes ?? 'no note'}); the owner was told on the first attempt, not repeating`,
          );
        } else {
          try {
            const run = await prisma.automationRun.create({
              data: {
                ruleId: rule.id,
                intentId,
                triggeredAt: now,
                triggerData: (evalResult.data ?? {}) as object,
                status: runStatus,
                notes: runNotes ?? undefined,
              },
            });
            runId = run.id;
          } catch (err) {
            console.warn('[automation] AutomationRun create failed:', (err as Error).message);
          }

          // Create Alert (best-effort)
          try {
            await prisma.alert.create({
              data: {
                userId: rule.wallet.userId,
                walletId: rule.wallet.id,
                type: trigger.type,
                priority:
                  runStatus === 'error'
                    ? 'LOW'
                    : trigger.type === 'HF_CRITICAL' || trigger.type === 'HF_BELOW'
                      ? 'CRITICAL'
                      : 'MEDIUM',
                severity: trigger.type === 'HF_CRITICAL' ? 'CRITICAL' : 'HIGH',
                triggerType: trigger.type,
                title: `Automation: ${rule.name}`,
                message: runNotes ?? 'trigger fired',
                // La misma puerta que abre el push (ver `alertUrl`): un aviso
                // accionable que no se puede abrir desde donde se lee no es un
                // aviso, es una frase.
                data: { ...((evalResult.data ?? {}) as object), ...(alertUrl ? { url: alertUrl } : {}) },
                automationRunId: runId,
              },
            });
            alertCreated = true;
          } catch (err) {
            console.warn('[automation] alert create failed:', (err as Error).message);
          }
        }

        // Notify the user to review + sign. The intent is prepared-only; the
        // user signs in their wallet (EVM for A2 compound, Xaman Payment for A1
        // repay). Astryum never signs. STOP after push.
        if (runStatus === 'intent_prepared' && intentId) {
          void PushNotificationService.getInstance()
            .sendToUser(rule.wallet.userId, {
              type: 'INTENT_READY',
              title: `Automation: ${rule.name} — action ready`,
              body: `${runNotes ?? 'trigger fired'} — review and sign in your wallet.`,
              url: '/app/intents',
              data: { intentId, ruleId: rule.id, trigger: trigger.type },
            })
            .catch((err: Error) =>
              console.warn('[automation] push failed:', err.message),
            );
        }

        // Update rule cooldown. "Éxito no ganado" guard (instancia #1): a fired
        // trigger whose action ERRORED is not a successful run — stamp the
        // cooldown (it did fire) but do NOT inflate totalTimesTriggered, which
        // the MoneyFlows / Movements / Legacy surfaces read verbatim as
        // "fired ×N" / "N nudges". Counting errors there is the disease.
        let nudgeLanded = alertCreated;
        if (nudgeDelivery) {
          const outcome = await awaitPushBounded(nudgeDelivery, () =>
            console.warn(
              `[automation] rule ${rule.id} (${rule.name}) — push delivery still unread after ${
                PUSH_AWAIT_TIMEOUT_MS / 1000
              }s; treated as NOT delivered (the occurrence stays owed)`,
            ),
          );
          if ((outcome?.sent ?? 0) > 0) nudgeLanded = true;
        }
        if (artefactIsNudge && !nudgeLanded) {
          artefactProduced = false;
          console.warn(
            `[automation] rule ${rule.id} (${rule.name}) fired but its nudge reached NOBODY (no alert row, no push delivered) — the occurrence stays owed`,
          );
        }

        const producedArtefact = runStatus !== 'error' && artefactProduced;
        try {
          await prisma.automationRule.update({
            where: { id: rule.id },
            data: {
              lastTriggeredAt: now,
              ...(producedArtefact
                ? { lastArtefactAt: now, totalTimesTriggered: { increment: 1 } }
                : {}),
            },
          });
        } catch {
          /* ignore */
        }
      }
    }

    return { ruleCount: rules.length, firedCount };
  }

  /**
   * G3-tormenta (R3) — el muro de 36 h ya no quema en silencio.
   *
   * WHAT WAS FAILING IN SILENCE: after ~37 barren attempts the occurrence left
   * `CRON_LOOKBACK_MINUTES` and the evaluator simply stopped offering it. No
   * run, no alert, no push: the last thing in the family's inbox still read
   * "council busy — retries after cooldown", a promise that had quietly
   * expired. This says it ONCE — the notice is the artefact that closes the
   * dead occurrence, so `lastArtefactAt` is stamped when (and only when) it
   * lands somewhere the owner can see it; an unsaid closure is not a closure
   * and is retried on the next tick.
   */
  private async announceExpiredOccurrence(
    rule: {
      id: string;
      name: string;
      action: unknown;
      wallet: { id: string; userId: string };
    },
    trigger: TriggerConfig,
    expired: NonNullable<TriggerEvalResult['expiredOccurrence']>,
    reason: string | null,
    now: Date,
  ): Promise<void> {
    // G3-final (blocker 3, cap 2): already said in this process? Then the only
    // thing that can still be missing is the DB stamp that makes it once
    // FOREVER — retry exactly that, never another row.
    const occurrenceKey = `${expired.cron}|${expired.dueAt}|${expired.lastAttemptAt}`;
    if (this.announcedExpiry.get(rule.id) === occurrenceKey) {
      await this.stampOccurrenceClosed(rule.id, now);
      return;
    }

    const kind = (rule.action as { kind?: string } | null)?.kind;
    // The door that actually holds this rule's business — same deep-links the
    // live nudges use (G5): a closing notice pointing nowhere is the disease it
    // is trying to cure.
    const url =
      kind === 'councilPayment' || kind === 'councilOrder'
        ? '/app/legacy?tab=proposals'
        : kind === 'escrow'
          ? '/app/savings'
          : '/app/strategies';
    // The date is never invented: the evaluator only reports an occurrence it
    // could attribute to THIS cron (G3-final blocker 5), so `dueAt` is real.
    const message =
      `The ${expired.dueAt} occurrence of "${rule.name}" never produced anything to sign and has left the ` +
      `${expired.lookbackHours}h catch-up window: it will NOT be retried. Nothing was sent and nothing was signed. ` +
      `The rule stays armed for its next scheduled time (${expired.cron}); if this one mattered, do it by hand.`;

    let runId: string | undefined;
    try {
      const run = await prisma.automationRun.create({
        data: {
          ruleId: rule.id,
          triggeredAt: now,
          triggerData: {
            cron: expired.cron,
            dueAt: expired.dueAt,
            lastAttemptAt: expired.lastAttemptAt,
            abandoned: true,
          } as object,
          // The signal the surfaces reduce: AutomationRunStatus `expired`
          // (schema enum, unchanged) + `triggerData.abandoned: true`. This is
          // the ONLY writer of that status for AutomationRun in the repo.
          status: 'expired',
          notes: reason ?? message,
        },
      });
      runId = run.id;
    } catch (err) {
      console.warn('[automation] expired-occurrence run create failed:', (err as Error).message);
    }

    let alertCreated = false;
    try {
      await prisma.alert.create({
        data: {
          userId: rule.wallet.userId,
          walletId: rule.wallet.id,
          type: trigger.type,
          priority: 'HIGH',
          severity: 'HIGH',
          triggerType: trigger.type,
          title: `MoneyFlow: ${rule.name} — scheduled occurrence abandoned`,
          message,
          data: {
            cron: expired.cron,
            dueAt: expired.dueAt,
            lastAttemptAt: expired.lastAttemptAt,
            abandoned: true,
          } as object,
          automationRunId: runId,
        },
      });
      alertCreated = true;
    } catch (err) {
      console.warn('[automation] expired-occurrence alert create failed:', (err as Error).message);
    }

    // G3-final (blocker 4): bounded, like every other awaited push in the tick.
    const outcome = await awaitPushBounded(
      PushNotificationService.getInstance()
        .sendToUser(rule.wallet.userId, {
          // The closest honest type in the existing set: this IS news about a
          // rule that fired and produced nothing. Nothing is "ready".
          type: 'RULE_FIRED',
          title: `MoneyFlow: ${rule.name} — nothing was sent`,
          body: message,
          url,
          data: { ruleId: rule.id, trigger: trigger.type, dueAt: expired.dueAt, abandoned: true },
        })
        .catch((err: Error) => {
          console.warn('[automation] expired-occurrence push failed:', err.message);
          return undefined;
        }),
      () =>
        console.warn(
          `[automation] rule ${rule.id} (${rule.name}) — expired-occurrence push still unread after ${
            PUSH_AWAIT_TIMEOUT_MS / 1000
          }s; treated as NOT delivered`,
        ),
    );
    const pushed = (outcome?.sent ?? 0) > 0;

    // G3-final (blocker 3, cap 1): the run row is the notice the surfaces
    // reduce (`runHealth.summarizeRuns` over GET /rules/:id/runs), so a written
    // run counts as said. Only when NOTHING at all was written or delivered do
    // we refuse to stamp — and then nothing was inserted either, so the retry
    // costs a failed write per tick, not a row per tick.
    if (!runId && !alertCreated && !pushed) {
      console.warn(
        `[automation] rule ${rule.id} (${rule.name}): the abandoned occurrence could NOT be announced (no run row, no alert row, no push delivered) — retrying next tick`,
      );
      return; // do NOT stamp: a closure nobody received is not a closure
    }
    if (runId && !alertCreated && !pushed) {
      console.warn(
        `[automation] rule ${rule.id} (${rule.name}): the abandoned occurrence is recorded as an \`expired\` run but neither the alert row nor a push landed — it is visible only in the rule's run history`,
      );
    }

    this.announcedExpiry.set(rule.id, occurrenceKey);
    await this.stampOccurrenceClosed(rule.id, now);
  }

  /**
   * G3-final (blocker 3) — the stamp that makes the closing notice happen
   * exactly once, DB-side and across restarts. Split out so the "already
   * announced in this process" path can retry the stamp alone.
   */
  private async stampOccurrenceClosed(ruleId: string, now: Date): Promise<void> {
    try {
      await prisma.automationRule.update({
        where: { id: ruleId },
        data: { lastArtefactAt: now },
      });
    } catch (err) {
      console.warn('[automation] expired-occurrence stamp failed:', (err as Error).message);
    }
  }

  /**
   * Intent Reminder Engine — prepareFlowNode()
   *
   * MoneyFlows are scheduled opportunity preparations, NOT autonomous executions.
   * Every scheduled node:
   *   1. Prepares a NEW IntentPayload (no reuse)
   *   2. Creates a NEW IntentAuthorizationSession (single-use, expiring)
   *   3. Notifies the user to review
   *   4. STOPS — never authorizes automatically, never relays
   *
   * No signature reuse. No standing approvals. No background execution.
   */
  async prepareFlowNode(
    node: FlowNode,
    context: {
      userId: string;
      walletAddress: string;
      chainId?: number;
      sessionId: string;
      ruleId?: string;
      flowId?: string;
    },
  ): Promise<{
    intentPayload: Awaited<ReturnType<typeof intentPreparationEngine.prepare>>;
    authorizationSessionId: string;
  }> {
    const chainId = context.chainId ?? 14;

    // 1. Prepare a new IntentPayload (no reuse of any prior payload)
    const intentPayload = await intentPreparationEngine.prepare(node.type, {
      walletAddress: context.walletAddress,
      chainId,
      sessionId: context.sessionId,
      ...node.params,
    });

    // 2. Create a new IntentAuthorizationSession (single-use, 5-minute expiry)
    const session = await regulatedRelayBoundary.createAuthorizationSession({
      userId: context.userId,
      intentPayload,
    });

    // 3. Notify the user — they must review before authorizing
    void PushNotificationService.getInstance()
      .sendToUser(context.userId, {
        type: 'INTENT_READY',
        title: 'Prepared opportunity awaiting your review',
        body: `${intentPayload.metadata.description} — review before authorizing.`,
        url: '/app/intents',
        data: {
          intentId: intentPayload.intentId,
          sessionId: session.id,
          nodeType: node.type,
          flowId: context.flowId,
          ruleId: context.ruleId,
        },
      })
      .catch((err: Error) =>
        console.warn('[automation] push notification failed:', err.message),
      );

    // 4. Audit log
    try {
      await prisma.auditLog.create({
        data: {
          userId: context.userId,
          action: 'flow:prepareFlowNode',
          resource: intentPayload.intentId,
          newValues: {
            nodeType: node.type,
            flowId: context.flowId,
            ruleId: context.ruleId,
            sessionId: session.id,
            walletAddress: context.walletAddress,
            attributionBps: intentPayload.referralAttribution.attributionBps,
            referralWallet: intentPayload.referralAttribution.referralWallet,
          },
        },
      });
    } catch (err) {
      console.warn('[automation] audit log failed:', (err as Error).message);
    }

    // 5. STOP — no auto-authorize, no relay, no execution
    return { intentPayload, authorizationSessionId: session.id };
  }
}
