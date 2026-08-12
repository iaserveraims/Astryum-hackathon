/**
 * sentinelProbes — LA LISTA. Qué se vigila de Astryum y, para cada cosa, qué
 * hacer cuando se pone roja.
 *
 * Orden de lectura (de abajo del stack hacia arriba):
 *   1. backend            — ¿está vivo el proceso? ¿acaba de reiniciarse?
 *   2. base-de-datos      — ¿responde Postgres? (sin ella no hay handoffs)
 *   3. flare-rpc          — ¿vemos la cadena donde se ejecuta?
 *   4. xrpl-endpoints     — ¿vemos el ledger donde firma el usuario?
 *   5. executor-watcher   — ¿sigue barriendo el executor 0xFE?
 *   6. executor-pendientes— ¿hay XRP de alguien esperando ejecución?
 *   7. executor-aparcados — ¿hay dispatches que ya NADIE reintentará?
 *   8. executor-combustible — ¿le queda FLR para defender?
 *   9. executor-presupuesto — ¿queda tope de fees FDC en la ventana de 24 h?
 *  10. executor-margen    — ¿la fee sigue cubriendo el coste (guardián FTSO)?
 *  11. consejo-ordenes    — ¿alguna orden firmada por el consejo sin relayar?
 *  12. jaulas-factory     — ¿el factory de jaulas está bien configurado? (+🎉 nacimientos)
 *  13. jaulas-nacimientos — ¿algún nacimiento firmable lleva demasiado en vuelo?
 *  14. agentes           — ¿siguen latiendo los lazos que no publican salud?
 *  15. errores-http      — ¿hay una rafaga de 5xx en la API?
 *  16. frontend          — ¿el sitio publico responde? (Vercel, dominio, DNS)
 *  17. providers          — ¿hay integraciones caídas?
 *  18. canal-alertas      — ¿esto que estás leyendo puede siquiera llegarte?
 *
 * Reglas de escritura de un probe (mantenerlas al añadir el siguiente):
 *  · Read-only. Nada de firmar, escribir on-chain ni tocar capital (#1/#8).
 *  · Un finding por OBJETO (`key`), no por categoría: se arregla la tx
 *    7BFC…65F, no "el executor".
 *  · `message` en una frase entendible desde el móvil, con el objeto y el
 *    impacto. `facts` con lo copiable (hash completo, cuenta, importe).
 *  · `runbook` SIEMPRE que exista un arreglo: el camino exacto en /app/admin
 *    o el comando. Sin runbook, un aviso es ruido con reloj.
 *  · Barato: esto corre cada 5 minutos. Reutiliza el ctx compartido.
 */

import type { Probe, ProbeCtx, ProbeFinding } from './sentinelTypes';

const PANEL = '/app/admin';

function short(v: string | null | undefined, head = 6, tail = 4): string {
  if (!v) return '—';
  return v.length <= head + tail + 1 ? v : `${v.slice(0, head)}…${v.slice(-tail)}`;
}

function minutesSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 60_000)) : null;
}

function envNum(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function executorArmed(): boolean {
  return process.env.FLARE_EXECUTOR_ENABLED === 'true' && !!process.env.FLARE_EXECUTOR_PK;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Contexto compartido de la pasada                                           */
/* ────────────────────────────────────────────────────────────────────────── */

export function buildProbeContext(now: number): ProbeCtx {
  let healthPromise: Promise<unknown> | null = null;
  let stuckPromise: Promise<unknown> | null = null;
  const watcher = async () => {
    const mod = await import('../flare/DirectMintExecutorService');
    return mod.directMintExecutorWatcher;
  };
  return {
    now,
    executorHealth: () => {
      if (!healthPromise) {
        healthPromise = watcher()
          .then((w) => w.health())
          .catch(() => null);
      }
      return healthPromise as ReturnType<ProbeCtx['executorHealth']>;
    },
    stuck: () => {
      if (!stuckPromise) {
        stuckPromise = watcher()
          .then((w) => w.listStuck())
          .catch(() => null);
      }
      return stuckPromise as ReturnType<ProbeCtx['stuck']>;
    },
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 1. El proceso                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

const backendProbe: Probe = {
  id: 'backend',
  title: 'Proceso backend',
  run: async () => {
    const out: ProbeFinding[] = [];
    const uptimeMin = Math.round(process.uptime() / 60);
    // Un reinicio no es un fallo, pero SÍ explica cosas raras: el backoff del
    // executor, la caché de attestations en RAM y las ventanas en memoria
    // empiezan de cero. Verlo escrito ahorra media hora de diagnóstico. Sale
    // un aviso por arranque (info: no despierta a nadie); si en días de muchos
    // despliegues molesta, OPS_SENTINEL_RESTART_INFO=false lo calla.
    if (uptimeMin < 15 && process.env.OPS_SENTINEL_RESTART_INFO !== 'false') {
      out.push({
        key: 'reinicio',
        level: 'info',
        message: `el backend arrancó hace ${uptimeMin} min — el estado en memoria (backoffs del executor, cachés, ventanas) empieza de cero`,
        facts: { uptimeMin },
        runbook:
          'Si no has desplegado nada, ha sido un reinicio del hosting (OOM o crash): Railway → Deployments → Logs. ' +
          'Si se repite varias veces al día, sube el plan o busca la fuga de memoria.',
      });
    }
    const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
    const warnMb = envNum('OPS_SENTINEL_RSS_WARN_MB', 700);
    if (rssMb > warnMb) {
      out.push({
        key: 'memoria',
        level: 'warn',
        message: `el backend va por ${rssMb} MB de memoria (aviso a partir de ${warnMb} MB) — a este ritmo el hosting lo reinicia por OOM`,
        facts: { rssMb, warnMb, uptimeMin },
        runbook:
          'Un reinicio por OOM tira los backoffs y la caché de attestations. Reinicia tú en frío desde Railway ' +
          'cuando no haya ceremonia en curso, o sube OPS_SENTINEL_RSS_WARN_MB si este techo es normal para el plan.',
      });
    }
    return out;
  },
};

/* ────────────────────────────────────────────────────────────────────────── */
/* 2. Base de datos                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

const databaseProbe: Probe = {
  id: 'base-de-datos',
  title: 'Base de datos',
  applies: () => !!process.env.DATABASE_URL,
  run: async () => {
    const t0 = Date.now();
    try {
      const { prisma } = await import('../../database/prismaClient');
      await prisma.$queryRaw`SELECT 1`;
    } catch (e) {
      return {
        key: 'conexion',
        level: 'critical',
        message: `Postgres no responde (${(e as Error).message}) — sin ella no se guardan los bytes de los handoffs 0xFE ni las alertas`,
        runbook:
          'Supabase → Project → Database: mira si el pooler (puerto 6543) está arriba y si se agotaron las conexiones. ' +
          'Mientras dure, NO firmes nada nuevo: un 0xFE preparado sin fila en el store solo se rescata a mano.',
      };
    }
    const ms = Date.now() - t0;
    if (ms > 3_000) {
      return {
        key: 'latencia',
        level: 'warn',
        message: `Postgres tarda ${ms} ms en un SELECT 1 — el pooler va saturado`,
        facts: { ms },
        runbook: 'Supabase → Database → Connection pooling: revisa conexiones activas y el límite del pooler.',
      };
    }
    return null;
  },
};

/* ────────────────────────────────────────────────────────────────────────── */
/* 3. Flare RPC                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

const flareRpcProbe: Probe = {
  id: 'flare-rpc',
  title: 'RPC de Flare',
  run: async () => {
    const { ethers } = await import('ethers');
    const url = process.env.FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc';
    const provider = new ethers.JsonRpcProvider(url);
    try {
      const block = await provider.getBlock('latest');
      if (!block) {
        return {
          key: 'sin-bloque',
          level: 'critical',
          message: 'el RPC de Flare no devuelve bloque — el executor no puede simular ni ejecutar nada',
          runbook:
            'Prueba otro nodo en FLARE_RPC_URL (Railway) — p.ej. https://rpc.ftso.au/flare o el de Ankr — y reinicia el backend.',
        };
      }
      const ageS = Math.max(0, Math.round(Date.now() / 1000 - Number(block.timestamp)));
      if (ageS > 120) {
        return {
          key: 'atrasado',
          level: 'warn',
          message: `el último bloque de Flare que vemos tiene ${ageS} s — el nodo va atrasado o la red está lenta`,
          facts: { bloque: block.number, ageS },
          runbook: 'Comprueba en flarescan.com si la red avanza. Si avanza, el atrasado es el nodo: cambia FLARE_RPC_URL.',
        };
      }
      return null;
    } catch (e) {
      return {
        key: 'inalcanzable',
        level: 'critical',
        message: `el RPC de Flare no responde (${(e as Error).message}) — el executor está a ciegas sobre la cadena de ejecución`,
        runbook: 'Cambia FLARE_RPC_URL en Railway a otro nodo público y reinicia. Los mints firmados esperan en el Core Vault, no se pierden.',
      };
    } finally {
      provider.destroy();
    }
  },
};

/* ────────────────────────────────────────────────────────────────────────── */
/* 4. Endpoints XRPL — la ceguera del 31-jul                                  */
/* ────────────────────────────────────────────────────────────────────────── */

const xrplEndpointsProbe: Probe = {
  id: 'xrpl-endpoints',
  title: 'Nodos XRPL (frescura)',
  run: async () => {
    const { xrplHttpEndpoints, xrplEndpointFresh } = await import('../flare/DirectMintExecutorService');
    const endpoints = xrplHttpEndpoints(process.env.XRPL_WSS_URL);
    const results = await Promise.all(
      endpoints.map(async (url) => ({ url, fresh: await xrplEndpointFresh(url) })),
    );
    const fresh = results.filter((r) => r.fresh);
    if (fresh.length === 0) {
      return {
        key: 'todos-congelados',
        level: 'critical',
        message:
          'NINGÚN nodo XRPL sirve datos frescos: el barrido del executor está ciego y los 0xFE nuevos no se ven ' +
          '(esto es exactamente el incidente del 31-jul, 5 h sin enterarnos)',
        facts: { probados: results.length },
        runbook:
          'Pon un nodo con historia completa en XRPL_RPC_URL (Railway) y reinicia: p.ej. https://s1.ripple.com:51234 ' +
          `o el de tu proveedor. Verifica con: npx ts-node src/scripts/execute-direct-mint.ts --check. Panel: ${PANEL} → Sistema.`,
      };
    }
    if (!results[0]?.fresh) {
      return {
        key: 'preferido-congelado',
        level: 'warn',
        message: `el nodo XRPL preferido (${results[0]?.url}) sirve una ventana vieja; se está barriendo por el de reserva`,
        facts: { frescos: fresh.length, de: results.length },
        runbook:
          'No urge (la rotación funciona), pero cambia XRPL_RPC_URL al primero que sí esté fresco antes de que caiga también.',
      };
    }
    return null;
  },
};

/* ────────────────────────────────────────────────────────────────────────── */
/* 5-10. El executor 0xFE                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

const executorWatcherProbe: Probe = {
  id: 'executor-watcher',
  title: 'Watcher del executor 0xFE',
  applies: executorArmed,
  run: async (ctx) => {
    const health = await ctx.executorHealth();
    if (!health) {
      return {
        key: 'sin-lectura',
        level: 'warn',
        message: 'no se pudo leer la salud del executor — el carril está armado pero no responde a la introspección',
        runbook: `Mira ${PANEL} → Sistema → Executor 0xFE y los logs de Railway ([0xFE-executor]).`,
      };
    }
    const everyMs = envNum('FLARE_EXECUTOR_INTERVAL_MS', 60_000);
    const uptimeMin = process.uptime() / 60;
    const ageMin = minutesSince(health.lastTickAt, ctx.now);

    if (ageMin == null) {
      if (uptimeMin < 5) return null; // arrancando: aún no le toca
      return {
        key: 'nunca-barrio',
        level: 'critical',
        message: `el executor lleva ${Math.round(uptimeMin)} min arrancado y NO ha barrido ni una vez — cualquier 0xFE firmado se queda esperando`,
        runbook:
          'Revisa los logs de Railway ([0xFE-executor]): lo normal es FLARE_EXECUTOR_PK inválida o el RPC caído. ' +
          'El XRP de los usuarios sigue a salvo en el Core Vault mientras tanto.',
      };
    }
    const staleMin = Math.max(3, Math.ceil((everyMs * 3) / 60_000));
    if (ageMin > staleMin) {
      return {
        key: 'tick-parado',
        level: 'critical',
        message: `el executor no barre desde hace ${ageMin} min (debería cada ${Math.round(everyMs / 60_000)} min) — está atascado o muerto`,
        facts: { ultimoBarrido: health.lastTickAt, error: health.lastTickError },
        runbook:
          'Un barrido puede durar minutos si espera una ronda FDC, pero no esta cifra. Reinicia el servicio en Railway; ' +
          `si vuelve a pasar, mira si un dispatch concreto lo bloquea en ${PANEL} → Sistema → Desatascar.`,
      };
    }
    if (health.lastTickError) {
      return {
        key: 'tick-con-error',
        level: 'warn',
        message: `el último barrido del executor terminó en error: ${health.lastTickError}`,
        facts: { ultimoBarrido: health.lastTickAt },
        runbook:
          'Si el error habla de XRPL (402, stale, txnNotFound) es transporte: mira el probe de nodos XRPL. ' +
          'Si habla del RPC de Flare, cambia FLARE_RPC_URL.',
      };
    }
    return null;
  },
};

/**
 * Dos capas, una sola voz por suceso: el WATCHER avisa del inicio (él ve el
 * 0xFE en cuanto pasa del umbral, ~10 min) y el SENTINEL avisa de lo que
 * PERSISTE — por eso aquí el listón es 3× ese umbral. Así el canal no recibe
 * dos mensajes distintos del mismo minuto, y lo que se queda pillado de verdad
 * sí se recuerda, se escala y se cierra cuando se arregla.
 */
const executorPendingProbe: Probe = {
  id: 'executor-pendientes',
  title: 'Dispatches 0xFE pendientes',
  applies: executorArmed,
  run: async (ctx) => {
    const snapshot = await ctx.stuck();
    if (!snapshot) return null;
    const stuckMin = envNum('FLARE_EXECUTOR_STUCK_ALERT_MIN', 10);
    const escalateMin = stuckMin * 3;
    const out: ProbeFinding[] = [];
    for (const tx of snapshot.pending) {
      const ageMin = minutesSince(tx.dateISO, ctx.now);
      if (ageMin == null || ageMin < escalateMin) continue;
      const failures = tx.failures ?? 0;
      const level = ageMin > stuckMin * 6 || failures >= 3 ? 'critical' : 'warn';
      const rumbo =
        tx.direction === 'saliente'
          ? 'es dinero SALIENDO hacia el usuario'
          : tx.direction === 'entrante'
            ? 'es dinero entrando a una posición'
            : '';
      out.push({
        key: tx.hash,
        level,
        message:
          `la tx ${short(tx.hash)} (${tx.xrp ?? '—'} XRP de ${short(tx.account)}) lleva ${ageMin} min pillada en el executor` +
          `${tx.action ? ` — acción «${tx.action}»` : ''}${rumbo ? `, ${rumbo}` : ''}`,
        facts: {
          hash: tx.hash,
          cuenta: tx.account,
          xrp: tx.xrp,
          accion: tx.action,
          fallos: failures,
          proximoIntento: tx.nextAttemptISO,
        },
        runbook:
          `${PANEL} → Sistema → Desatascar: busca esa fila. Si el motivo dice INEJECUTABLE hace falta re-prepare + firma ` +
          'nueva del usuario; si no, pulsa Reintentar (no cuesta fee: la attestation ya pagada se reutiliza). ' +
          'El XRP del usuario está a salvo en el Core Vault hasta que se ejecute.',
      });
    }
    return out;
  },
};

const executorParkedProbe: Probe = {
  id: 'executor-aparcados',
  title: 'Dispatches 0xFE aparcados',
  applies: executorArmed,
  run: async (ctx) => {
    const snapshot = await ctx.stuck();
    if (!snapshot) return null;
    const graceMin = envNum('OPS_SENTINEL_PARKED_GRACE_MIN', 10);
    return snapshot.parked
      // El watcher ya grita en el instante del aparcamiento; esta capa es el
      // recordatorio de lo que SIGUE aparcado (dinero de un usuario parado).
      // `parkedAt` nulo = rehidratado de antes del último redeploy: es viejo.
      .filter((tx) => (minutesSince(tx.parkedAt, ctx.now) ?? graceMin) >= graceMin)
      .map<ProbeFinding>((tx) => ({
        key: tx.hash,
        level: 'critical',
        message:
          `la tx ${short(tx.hash)} (${tx.xrp ?? '—'} XRP de ${short(tx.account)}) sigue APARCADA: nadie la reintentará` +
          `${tx.reason ? ` — ${tx.reason.slice(0, 180)}` : ''}`,
        facts: { hash: tx.hash, cuenta: tx.account, xrp: tx.xrp, accion: tx.action, origen: tx.source, desde: tx.parkedAt },
        runbook:
          `${PANEL} → Sistema → Desatascar. Aparcada por tope de fallos → Reintentar. Aparcada por bytes INEJECUTABLES ` +
          '(sender ajeno o nonce consumido) → no se cura ahí: hay que re-preparar la operación y que el usuario firme de nuevo. ' +
          'Rescate manual: USER_OP_DATA=0x… npx ts-node src/scripts/execute-direct-mint.ts --live',
      }));
  },
};

const executorFuelProbe: Probe = {
  id: 'executor-combustible',
  title: 'Combustible del executor',
  applies: executorArmed,
  run: async (ctx) => {
    const health = await ctx.executorHealth();
    if (!health?.flrBalance) return null;
    const flr = Number(health.flrBalance);
    const fxrp = Number(health.fxrpBalance ?? 0);
    const rescue = envNum('FLARE_EXECUTOR_RESCUE_RESERVE_FLR', 0.5);
    const refuelMin = envNum('FLARE_EXECUTOR_REFUEL_MIN_FLR', 60);
    const minFlr = envNum('FLARE_EXECUTOR_MIN_FLR', 30);
    const out: ProbeFinding[] = [];

    if (flr < rescue) {
      out.push({
        key: 'reserva-rescate',
        level: 'critical',
        message: `el executor tiene ${flr.toFixed(2)} FLR: por debajo de la reserva de rescate (${rescue} FLR) ni el swap salvavidas es seguro`,
        facts: { flr, fxrp, direccion: health.executor },
        runbook: `RECARGA MANUAL YA: manda FLR a ${health.executor ?? 'la dirección del executor'}. Sin gas no se ejecuta ni un mint.`,
      });
    } else if (flr < minFlr) {
      out.push({
        key: 'saldo-bajo',
        level: 'warn',
        message: `el executor baja de ${minFlr} FLR (tiene ${flr.toFixed(2)}) y cada defensa cuesta ~20 FLR de attestation`,
        facts: { flr, fxrp, direccion: health.executor },
        runbook: health.refuelEnabled
          ? 'El refuel automático debería swapear FXRP→FLR en el próximo tick; si no lo hace, mira el probe de margen y recarga a mano.'
          : `Recarga FLR a ${health.executor ?? 'el executor'} o enciende FLARE_EXECUTOR_REFUEL_ENABLED=true.`,
      });
    }

    if (health.refuelEnabled && flr < refuelMin && fxrp <= 0) {
      out.push({
        key: 'sin-fxrp',
        level: 'critical',
        message: `el refuel automático no tiene con qué: 0 FXRP y ${flr.toFixed(2)} FLR (umbral ${refuelMin})`,
        facts: { flr, fxrp },
        runbook: 'Manda FLR (o FXRP) al executor. Si el sweep está barriendo demasiado, sube FLARE_EXECUTOR_KEEP_FXRP.',
      });
    }

    const cover = health.defensesCoveredToday?.effective;
    if (typeof cover === 'number' && cover <= 2 && flr >= rescue) {
      out.push({
        key: 'cobertura',
        level: cover <= 0 ? 'critical' : 'warn',
        message: `hoy solo caben ${cover} defensa(s) más (mínimo entre presupuesto y saldo) — el siguiente usuario que firme puede quedarse esperando`,
        facts: { porPresupuesto: health.defensesCoveredToday?.byBudget, porSaldo: health.defensesCoveredToday?.byWallet },
        runbook:
          'Si el límite es el saldo, recarga FLR. Si es el presupuesto, sube FLARE_EXECUTOR_DAILY_FEE_BUDGET_FLR en Railway ' +
          '(y comprueba antes que el gasto es legítimo en la pestaña Alertas).',
      });
    }
    return out;
  },
};

const executorBudgetProbe: Probe = {
  id: 'executor-presupuesto',
  title: 'Presupuesto de fees FDC (24 h)',
  applies: executorArmed,
  run: async (ctx) => {
    const health = await ctx.executorHealth();
    const b = health?.dailyFeeBudget;
    if (!b || !b.budgetFLR) return null;
    const spent = Number(b.spentFLR);
    const pct = (spent / b.budgetFLR) * 100;
    if (pct >= 100) {
      return {
        key: 'agotado',
        level: 'critical',
        message: `presupuesto de fees FDC AGOTADO: ${spent.toFixed(1)}/${b.budgetFLR} FLR en la ventana — no se paga ninguna attestation más`,
        facts: { gastado: spent, tope: b.budgetFLR, ventanaDesde: b.windowStartedAt },
        runbook:
          'Si el gasto es legítimo (día de ceremonia), sube FLARE_EXECUTOR_DAILY_FEE_BUDGET_FLR en Railway. ' +
          `Si no, algo reintenta con dinero real: mira ${PANEL} → Sistema → Desatascar y aparca al culpable.`,
      };
    }
    const warnPct = envNum('FLARE_EXECUTOR_FEE_WARN_PCT', 80);
    if (pct >= warnPct) {
      return {
        key: 'cerca-del-tope',
        level: 'warn',
        message: `presupuesto de fees FDC al ${pct.toFixed(0)}%: ${spent.toFixed(1)}/${b.budgetFLR} FLR gastados en la ventana`,
        facts: { gastado: spent, tope: b.budgetFLR, ventanaDesde: b.windowStartedAt },
        runbook: 'Si hoy hay ceremonia o ventana de jueces, sube el tope ANTES de agotarlo: FLARE_EXECUTOR_DAILY_FEE_BUDGET_FLR.',
      };
    }
    return null;
  },
};

const executorMarginProbe: Probe = {
  id: 'executor-margen',
  title: 'Margen de la fee (guardián FTSO)',
  applies: executorArmed,
  run: async (ctx) => {
    const health = await ctx.executorHealth();
    const m = health?.feeMargin;
    if (!m || m.marginPct == null) return null;
    if (m.marginPct >= m.warnBelowPct) return null;
    return {
      key: 'margen',
      level: m.marginPct < 0 ? 'critical' : 'warn',
      message:
        `la fee del executor cubre el coste al ${m.marginPct.toFixed(1)}% (umbral ${m.warnBelowPct}%)` +
        `${m.marginPct < 0 ? ' — CADA DISPATCH PIERDE DINERO' : ''}`,
      facts: { feeXrp: m.execFeeXrp, xrpUsd: m.xrpUsd, flrUsd: m.flrUsd, costeFlr: m.costFlr },
      runbook:
        'El ratio XRP/FLR se ha movido en contra. Decide: subir la fee del dispatch, pausar el carril, o asumirlo con los ojos abiertos. ' +
        'No es urgente en minutos, pero sí antes de una tanda grande de dispatches.',
    };
  },
};

/* ────────────────────────────────────────────────────────────────────────── */
/* 11. Órdenes del consejo firmadas y sin relayar                             */
/* ────────────────────────────────────────────────────────────────────────── */

const councilOrdersProbe: Probe = {
  id: 'consejo-ordenes',
  title: 'Órdenes del consejo sin relayar',
  applies: () => !!process.env.DATABASE_URL && !!process.env.LEGACY_ORDER_ANCHOR,
  run: async (ctx) => {
    const graceMin = envNum('OPS_SENTINEL_COUNCIL_GRACE_MIN', 10);
    const { prisma } = await import('../../database/prismaClient');
    const anchor = process.env.LEGACY_ORDER_ANCHOR;
    const cutoff = new Date(ctx.now - graceMin * 60_000);
    const submitted = await prisma.councilProposal.findMany({
      where: { status: 'submitted', updatedAt: { lt: cutoff } },
      orderBy: { updatedAt: 'desc' },
      take: 25,
      select: { id: true, title: true, txHash: true, txjson: true, account: true, updatedAt: true },
    });

    const out: ProbeFinding[] = [];
    for (const p of submitted) {
      if (!p.txHash) continue;
      // ¿Es una ORDEN (Payment al anchor con memo de 32 bytes) o cualquier otra
      // tx del consejo? Solo las órdenes viajan a Flare. Se comprueba aquí en
      // vez de importar el lanzador para no acoplarse a su forma.
      const tx = (p.txjson ?? {}) as {
        TransactionType?: unknown;
        Destination?: unknown;
        Memos?: Array<{ Memo?: { MemoData?: unknown } }>;
      };
      if (tx.TransactionType !== 'Payment' || tx.Destination !== anchor) continue;
      const memo = tx.Memos?.[0]?.Memo?.MemoData;
      if (typeof memo !== 'string' || !/^[0-9A-Fa-f]{64}$/.test(memo)) continue;

      // La verdad del settlement es la fila de la orden: se marca 'completed'
      // con el txHash XRPL que la consumió.
      const done = await prisma.backgroundJob.findFirst({
        where: {
          jobType: 'legacy-council-order',
          status: 'completed',
          result: { path: ['xrplTxHash'], equals: p.txHash },
        },
        select: { id: true },
      });
      if (done) continue;

      const ageMin = minutesSince(p.updatedAt.toISOString(), ctx.now) ?? 0;
      out.push({
        key: p.txHash,
        level: ageMin > graceMin * 6 ? 'critical' : 'warn',
        message:
          `la orden del consejo «${p.title ?? p.id}» se firmó y difundió en XRPL hace ${ageMin} min y NO consta ejecutada en Flare ` +
          '— el relé no la ha entregado',
        facts: { xrplTxHash: p.txHash, propuesta: p.id, cuenta: p.account },
        runbook:
          'Relanza el relé (no cuesta fee nueva: la attestation pagada se reutiliza y una orden ya consumida responde ' +
          '"already-executed"):\n' +
          `curl -X POST "$API/api/xrpl-defi/council-order/relay" -H 'content-type: application/json' -d '{"xrplTxHash":"${p.txHash}"}'\n` +
          'Si responde que no está validada, espera un minuto y repite. Si responde ORDER_WOULD_REVERT, la orden no cabe ' +
          'en el estado de la vasija: hay que re-emitirla.',
      });
    }
    return out;
  },
};

/* ────────────────────────────────────────────────────────────────────────── */
/* 12-13. Integraciones y el propio canal                                     */
/* ────────────────────────────────────────────────────────────────────────── */

const providersProbe: Probe = {
  id: 'providers',
  title: 'Integraciones (providers)',
  run: async () => {
    const { registry } = await import('../../integrations/registry/IntegrationRegistry');
    const { StubProvider } = await import('../../integrations/registry/StubProvider');
    // Los STUBS no cuentan (misma línea que ProviderHealthService, 2026-08-01):
    // un placeholder sin provider cableado responde 'down' por construcción y
    // no puede recuperarse — avisar de eso entierra lo real.
    const down = registry
      .list()
      .filter((p) => !(p instanceof StubProvider))
      .map((p) => ({ id: p.id, status: registry.getHealth(p.id)?.status }))
      .filter((p) => p.status === 'down');
    if (down.length === 0) return null;
    // A nivel `info` a propósito: ProviderHealthService ya avisa de la CAÍDA en
    // el momento (3 ticks) y de la recuperación. Aquí solo se refleja el estado
    // vigente para que el panel lo muestre sin duplicar la alarma.
    return {
      key: 'caidos',
      level: 'info',
      message: `${down.length} integración(es) caída(s): ${down.map((d) => d.id).join(', ')}`,
      facts: { providers: down.map((d) => d.id).join(', ') },
      runbook:
        'Mira el motivo de cada uno en /app/admin → Integrations (o el propio panel de proveedores): ' +
        'ahí sale el host que falló y con qué error.\n' +
        '· flarescan / chain-explorer (carril de actividad, Flare): ya lee por dos puertas — Routescan ' +
        'principal, Blockscout de reserva — así que "down" significa que NO contesta ninguna. La pantalla ' +
        'de Movimientos ya avisa sola de que está ciega y el export fiscal se niega a entregar un fichero ' +
        'incompleto, así que nadie se choca en silencio: normalmente basta esperar. Para forzar otro ' +
        'indexador, FLARESCAN_API_URL en Railway (lista separada por comas, en orden de preferencia).\n' +
        '· Si el caído es de un carril en uso (onramp, KYC, seguridad), avisa en la UI antes de que un ' +
        'usuario se choque.',
    };
  },
};

/* ────────────────────────────────────────────────────────────────────────── */
/* 14-16. Lo que faltaba: los otros lazos, los 5xx y el sitio                  */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Los agentes que NO publican `health()` (automatización, triggers, actividad,
 * keeper de escrows, vigía XRPL) dejan su latido en agentHeartbeats. Aquí se
 * comprueban las tres cosas que importan: que sigan latiendo, que el último
 * tick no fuera un fallo, y que los fallos no se estén encadenando.
 *
 * Solo se vigila a quien se ha anunciado alguna vez: un carril apagado por flag
 * no puede echarse de menos (y así no hay falsos positivos tras un reinicio).
 */
const agentsProbe: Probe = {
  id: 'agentes',
  title: 'Latido de los agentes',
  run: async (ctx) => {
    const { agentTicks } = await import('./agentHeartbeats');
    const out: ProbeFinding[] = [];
    for (const a of agentTicks()) {
      const ageMs = ctx.now - a.atMs;
      // 3× su cadencia + 1 min de gracia: un tick lento no es un tick muerto.
      if (ageMs > a.everyMs * 3 + 60_000) {
        out.push({
          key: `${a.id}:mudo`,
          level: 'critical',
          message:
            `${a.title} lleva ${Math.round(ageMs / 60_000)} min sin dar señal ` +
            `(debería latir cada ${Math.round(a.everyMs / 60_000)} min) — su ciclo se ha parado`,
          facts: { agente: a.id, ultimoLatido: new Date(a.atMs).toISOString() },
          runbook:
            'Un setInterval no se recupera solo: reinicia el servicio en Railway y mira en los logs la última ' +
            `traza de [${a.id}] antes del silencio — ahí está la excepción que mató el ciclo.`,
        });
        continue;
      }
      if (!a.ok) {
        out.push({
          key: `${a.id}:fallando`,
          level: a.failures >= 3 ? 'critical' : 'warn',
          message:
            `${a.title} falla desde hace ${a.failures} tick(s) seguidos` +
            `${a.detail ? `: ${a.detail}` : ''}`,
          facts: { agente: a.id, fallosSeguidos: a.failures },
          runbook:
            'Sigue latiendo, así que el ciclo está vivo pero su trabajo no se hace. Mira los logs de Railway con ' +
            `el prefijo [${a.id}]: si el error es de base de datos o de RPC, mira antes esos dos chequeos.`,
        });
      }
    }
    return out;
  },
};

/**
 * Ráfagas de 5xx. Un 500 suelto es ruido; veinte en la misma ruta es un
 * despliegue roto o una dependencia caída — y a esa distinción se llega
 * contando en una ventana, no alertando por error.
 */
const httpErrorsProbe: Probe = {
  id: 'errores-http',
  title: 'Errores 5xx de la API',
  run: async (ctx) => {
    const { httpErrorWindow } = await import('./httpErrorMonitor');
    const windowMin = envNum('OPS_SENTINEL_HTTP_WINDOW_MIN', 15);
    const warnAt = envNum('OPS_SENTINEL_HTTP_WARN', 5);
    const w = httpErrorWindow(windowMin * 60_000, ctx.now);
    if (w.total < warnAt) return null;
    const worst = w.top[0];
    return {
      key: 'rafaga',
      level: w.total >= warnAt * 4 ? 'critical' : 'warn',
      message:
        `${w.total} errores 5xx en los últimos ${w.windowMin} min` +
        (worst ? `, la mayoría en ${worst.method} ${worst.route} (${worst.count})` : ''),
      facts: {
        total: w.total,
        ventanaMin: w.windowMin,
        rutas: w.top.map((t) => `${t.method} ${t.route} ×${t.count}`).join(' · '),
      },
      runbook:
        'Railway → Deployments → Logs y filtra por esa ruta: la traza del primer 500 dice la causa. Si empezó justo ' +
        'tras un despliegue, revierte al anterior desde Railway; si no, mira antes los chequeos de base de datos y RPC.',
    };
  },
};

/**
 * El sitio en sí. El backend puede estar impecable y la app caída (build roto
 * en Vercel, dominio, DNS): sin esto, el usuario se entera antes que nosotros.
 */
const frontendProbe: Probe = {
  id: 'frontend',
  title: 'Sitio público (Vercel)',
  applies: () => process.env.OPS_FRONTEND_CHECK !== 'false',
  run: async () => {
    const url = (process.env.OPS_FRONTEND_URL || 'https://astryum.xyz').replace(/\/$/, '');
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'user-agent': 'astryum-sentinel' },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return null;
      return {
        key: 'caido',
        level: 'critical',
        message: `el sitio ${url} responde HTTP ${res.status} — los usuarios no pueden entrar`,
        facts: { url, status: res.status },
        runbook:
          'Vercel → Deployments: si el último build falló, promociona el anterior (Promote to Production). ' +
          'Si el build está bien, mira el dominio/DNS en Vercel → Settings → Domains.',
      };
    } catch (e) {
      return {
        key: 'inalcanzable',
        level: 'critical',
        message: `el sitio ${url} no responde (${(e as Error).message}) — los usuarios no pueden entrar`,
        facts: { url },
        runbook:
          'Compruébalo tú desde el móvil (con datos, no wifi) para descartar tu red. Si está caído: Vercel → ' +
          'Deployments → promociona el último despliegue que funcionaba.',
      };
    }
  },
};

/* ────────────────────────────────────────────────────────────────────────── */
/* 17. El factory de jaulas (carril self-service, 2026-08-06)                 */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * La config del factory PROBADA contra la cadena — y el aviso de negocio.
 *
 * El fallo que caza es silencioso por diseño ajeno: una LEGACY_FACTORY_ADDRESS
 * con el checksum mal escrito hace que el resolver la ignore y TODO user vea
 * «este Legacy no tiene jaula» con el factory perfectamente sano en mainnet.
 * Un error de config vestido de estado de producto. Hoy solo lo dice un
 * console.warn perdido en Railway; esto lo convierte en un crítico que llega.
 *
 * Y el delta del censo es la alerta bonita: cuando vaultCount sube, ha nacido
 * una jaula — eso se cuenta por el canal como negocio (🎉), no como avería.
 * Se emite DIRECTO con opsAlert (no como finding): un nacimiento es un evento,
 * no un estado que luego «se resuelve».
 */
const cageFactoryProbe: Probe = {
  id: 'jaulas-factory',
  title: 'Jaulas (factory)',
  applies: () => !!process.env.LEGACY_FACTORY_ADDRESS,
  run: async () => {
    const { readCageFactoryStatus, readCageCensus } = await import('../flare/LegacyCageFleetService');
    const { kvGet, kvUpsert } = await import('../persistence/backgroundJobKv');
    const out: ProbeFinding[] = [];
    const st = await readCageFactoryStatus();

    if (!st.addressValid) {
      out.push({
        key: 'checksum',
        level: 'critical',
        message:
          `LEGACY_FACTORY_ADDRESS no es una dirección válida ("${short(st.address)}") — el registro de jaulas NO se consulta ` +
          'y todos los Legacies ven «sin jaula» con el factory sano',
        facts: { valor: st.address },
        runbook:
          'Ethers valida el checksum EIP-55: cópiala del explorer TAL CUAL (o toda en minúsculas) en Railway → ' +
          'LEGACY_FACTORY_ADDRESS y redespliega. La buena es 0xF93A8A0bd93e95514fF02285349b0b1c1a5a3e0a.',
      });
      return out; // sin dirección válida, nada más es comprobable
    }
    if (st.hasCode === false) {
      out.push({
        key: 'sin-codigo',
        level: 'critical',
        message: `en ${short(st.address)} no hay ningún contrato — LEGACY_FACTORY_ADDRESS apunta a una dirección vacía en ${process.env.LEGACY_CHAIN || 'coston2'}`,
        facts: { address: st.address, chain: process.env.LEGACY_CHAIN || 'coston2' },
        runbook: 'O la variable tiene la dirección de OTRA red, o el factory no se desplegó aquí. Contrasta con contracts/README.md (§factory).',
      });
      return out;
    }
    if (st.sourceMatches === false) {
      out.push({
        key: 'source-id',
        level: 'critical',
        message:
          `el factory de ${short(st.address)} nació con SOURCE_ID "${st.sourceId}" y esta red espera "${st.expectedSourceId}" — ` +
          'los bridges que parió no verificarán NINGUNA prueba FDC jamás (campo inmutable)',
        facts: { sourceId: st.sourceId, esperado: st.expectedSourceId },
        runbook:
          'Ese factory no tiene arreglo: se redespliega con el SOURCE_ID correcto y se cambia LEGACY_FACTORY_ADDRESS. ' +
          'Las jaulas ya nacidas de él necesitan revisión una a una antes de aceptar más capital.',
      });
    }
    if (!st.treasuryValid) {
      out.push({
        key: 'treasury',
        level: 'warn',
        message: st.treasuryConfigured
          ? 'LEGACY_PROTOCOL_TREASURY no es una dirección válida — el prepare de creación rechazará todos los nacimientos'
          : 'LEGACY_PROTOCOL_TREASURY sin configurar — el prepare de creación rechazará todos los nacimientos',
        runbook: 'Pon en Railway una wallet EVM que controles (es el receptor D6, eterno por jaula nacida; por defecto no cobra nada).',
      });
    }
    if (st.birthVenues.length === 0) {
      out.push({
        key: 'venues',
        level: 'warn',
        message: 'sin venues de nacimiento configurados (KINETIC_KFXRP_ISO / FIRELIGHT_STXRP) — una jaula nacida sin venues no podría trabajar su capital',
        runbook: 'Revisa que las direcciones de Kinetic/Firelight sigan puestas en Railway.',
      });
    }

    // ── El delta del censo: los nacimientos, contados como negocio. ─────────
    if (st.vaultCount !== null && process.env.DATABASE_URL) {
      const KEY = 'vault-count';
      const prev = await kvGet('legacy-cage-sentinel', 'key', KEY).catch(() => null);
      const prevCount = Number((prev as { count?: number } | null)?.count ?? NaN);
      if (!Number.isFinite(prevCount)) {
        // Primera pasada: fija la línea base sin ruido.
        await kvUpsert('legacy-cage-sentinel', 'key', KEY, { key: KEY, count: st.vaultCount }).catch(() => {});
      } else if (st.vaultCount > prevCount) {
        const census = await readCageCensus().catch(() => []);
        const nuevos = census.slice(prevCount); // allVaults es append-only
        const { opsAlert } = await import('../OpsAlertService');
        for (const cage of nuevos) {
          await opsAlert(
            'jaulas',
            'info',
            `🎉 ha nacido una jaula: el consejo ${cage.council ?? short(cage.councilHash)} ya tiene su vault en ${short(cage.vault)}` +
              (cage.totalPrincipalUBA ? ` con ${(Number(cage.totalPrincipalUBA) / 1e6).toFixed(2)} FXRP de principal` : ''),
            {
              key: `nacimiento:${cage.vault}`,
              facts: { vault: cage.vault, bridge: cage.bridge, consejo: cage.council ?? cage.councilHash },
              runbook: `Verla en ${PANEL} → Sistema → Jaulas. Es un evento de negocio, no una avería.`,
            },
          ).catch(() => {});
        }
        await kvUpsert('legacy-cage-sentinel', 'key', KEY, { key: KEY, count: st.vaultCount }).catch(() => {});
      }
    }
    return out;
  },
};

/**
 * Nacimientos firmables que llevan demasiado sin ejecutar. Una fila 'queued'
 * no distingue «nadie firmó» (inerte, caduca sola) de «firmado y el executor
 * no lo ha barrido» (el FXRP estaría ya minteado en la cuenta del consejo) —
 * el aviso cuenta los dos casos y su arreglo, porque fingir certeza aquí sería
 * mentir con reloj.
 */
const cageBirthsProbe: Probe = {
  id: 'jaulas-nacimientos',
  title: 'Nacimientos de jaulas en vuelo',
  applies: () => !!process.env.DATABASE_URL && !!process.env.LEGACY_FACTORY_ADDRESS,
  run: async (ctx) => {
    const { listCageBirths } = await import('../flare/LegacyCageFleetService');
    const warnMin = envNum('OPS_CAGE_BIRTH_STUCK_MIN', 20);
    const births = await listCageBirths(20);
    const out: ProbeFinding[] = [];
    for (const b of births) {
      if (b.status !== 'queued') continue;
      if (b.ageMinutes < warnMin || b.ageMinutes > 24 * 60) continue; // <20 min = normal · >24 h = abandonado (inerte)
      out.push({
        key: b.userOpHash,
        level: 'warn',
        message:
          `un nacimiento de jaula para ${short(b.council, 8, 5)} lleva ${b.ageMinutes} min preparado sin ejecutarse ` +
          `(${(Number(b.grossXrpDrops) / 1e6).toFixed(2)} XRP)`,
        facts: { userOpHash: b.userOpHash, consejo: b.council, pa: b.personalAccount, minutos: b.ageMinutes },
        runbook:
          'Dos casos: si el quórum NO llegó a firmar el Payment, esto es inerte y caduca solo — ignóralo o libera el ' +
          `asiento desde ${PANEL} → Sistema → atascos. Si SÍ firmó, el FXRP ya está minteado en la cuenta Flare del ` +
          'consejo (no se pierde) y el executor debería barrerlo: mira las probes executor-pendientes/aparcados.',
      });
    }
    void ctx; // el contexto compartido no aplica: esto lee filas, no al watcher
    return out;
  },
};

const alertChannelProbe: Probe = {
  id: 'canal-alertas',
  title: 'Canal de alertas',
  run: async () => {
    const { alertChannels } = await import('../OpsAlertService');
    const out: ProbeFinding[] = [];
    const channels = alertChannels();
    if (!channels.some((c) => c.armed)) {
      out.push({
        key: 'sin-canal',
        level: 'warn',
        message:
          'no hay ningún canal externo armado: las alertas SOLO quedan en el panel y en los logs — nadie se entera fuera de la pantalla',
        runbook:
          'Discord: Ajustes del canal → Integraciones → Webhooks → Nuevo, y pega la URL en Railway como ' +
          'OPS_ALERT_WEBHOOK_URL. Para que SUENE el móvil con los críticos, añade OPS_ALERT_DISCORD_MENTION ' +
          `(@everyone o <@tu_id>): Discord solo notifica cuando menciona. Comprueba la entrega en ${PANEL} → Alertas → Probar canal.`,
      });
    }
    if (!process.env.OPS_HEARTBEAT_URL) {
      out.push({
        key: 'sin-hombre-muerto',
        level: 'info',
        message:
          'sin interruptor de hombre muerto: si el backend muere ENTERO, ningún vigía interno puede avisar (nadie escribe desde un proceso muerto)',
        runbook:
          'Crea un check en healthchecks.io (o Better Stack) cada 15 min y pega su URL en Railway como OPS_HEARTBEAT_URL. ' +
          'El vigía la pinga en cada pasada; si deja de llegar, te avisan ellos.',
      });
    }
    return out;
  },
};

/** El registro completo. Añadir un probe = añadirlo aquí. */
export const SENTINEL_PROBES: Probe[] = [
  backendProbe,
  databaseProbe,
  flareRpcProbe,
  xrplEndpointsProbe,
  executorWatcherProbe,
  executorPendingProbe,
  executorParkedProbe,
  executorFuelProbe,
  executorBudgetProbe,
  executorMarginProbe,
  councilOrdersProbe,
  cageFactoryProbe,
  cageBirthsProbe,
  agentsProbe,
  httpErrorsProbe,
  frontendProbe,
  providersProbe,
  alertChannelProbe,
];
