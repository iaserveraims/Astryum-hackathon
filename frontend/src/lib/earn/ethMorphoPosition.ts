/**
 * ethMorphoPosition — la posición de Ethereum, traída AL TABLERO (H1).
 *
 * El hueco que cerraba: `/api/positions/:wallet` es Flare-only por
 * construcción, y el barrido multi-chain del board sólo miraba a Base y
 * pintaba lo que encontraba como tarjeta watch-only. Resultado: la posición
 * FXRP/RLUSD de Ethereum no existía como FILA del tablero — y sin fila no hay
 * botón «Repagar ahora» ni plantilla PROTECT_EM. La puerta de repago y su
 * MoneyFlow estaban construidos y eran inalcanzables.
 *
 * Este módulo convierte la lectura del carril (`GET /eth-morpho/position`) en
 * las MISMAS filas que el tablero ya sabe pintar: una de colateral (FXRP) y
 * una de deuda (RLUSD). Puro y sin red en la parte que decide (toRows) para
 * que la regla sea testeable; el fetch es una función aparte.
 *
 * Honestidad: los importes viajan en base units con sus decimales LEÍDOS del
 * ledger (6/18 — la trampa F4), y una posición vacía devuelve [] en vez de
 * filas a cero, que en un tablero se leerían como «tienes algo».
 */

/** Lo que devuelve `GET /api/eth-morpho/position`. */
export interface EthMorphoPositionRead {
  wallet: string;
  chainId: number;
  hasPosition: boolean;
  collateralBase: string;
  collateralSymbol: string;
  collateralDecimals: number;
  debtBase: string;
  debtSymbol: string;
  debtDecimals: number;
  healthFactor: number | null;
  lltvPct: number;
  readAt: string;
  /* ── La pata lend-only (bóveda Sentora) ────────────────────────────────── */
  /** false = la bóveda NO se pudo leer. No es «no tienes nada prestado». */
  lentReadOk?: boolean;
  lentSharesBase?: string;
  lentAssetsBase?: string;
  lentSymbol?: string;
  lentDecimals?: number;
  /** Lo que la bóveda puede pagar HOY — techo duro, no estimación. */
  vaultAvailableNowBase?: string;
  vault?: string;
}

/** Una fila del tablero, en la forma que `DefiPositionsBoard` consume. */
export interface EthMorphoRow {
  protocolId: 'morpho-blue';
  chainId: 1;
  kind: 'COLLATERAL' | 'DEBT' | 'LEND';
  asset: string;
  amount: string;
  owner: string;
  /** Decimales del activo de ESTA fila — el tablero no debe asumirlos. */
  decimals: number;
  healthFactor: number | null;
  lltvPct: number;
  raw: {
    symbol: string;
    healthFactor: number | null;
    lltvPct: number;
    /* Solo en la fila LEND — lo que hace útil su puerta de salida. */
    lentSharesBase?: string;
    vaultAvailableNowBase?: string;
    vault?: string;
  };
}

/**
 * Lectura → filas del tablero. Sólo emite la pata que existe: colateral sin
 * deuda es una posición legítima (carry a medio abrir) y deuda sin colateral
 * no debería pasar, pero si pasara se dice en vez de esconderse.
 */
export function toRows(read: EthMorphoPositionRead | null): EthMorphoRow[] {
  if (!read || !read.hasPosition) return [];
  const rows: EthMorphoRow[] = [];
  const base = {
    protocolId: 'morpho-blue' as const,
    chainId: 1 as const,
    owner: read.wallet,
    healthFactor: read.healthFactor,
    lltvPct: read.lltvPct,
  };
  if (BigInt(read.collateralBase || '0') > BigInt(0)) {
    rows.push({
      ...base,
      kind: 'COLLATERAL',
      asset: read.collateralSymbol,
      amount: read.collateralBase,
      decimals: read.collateralDecimals,
      raw: { symbol: read.collateralSymbol, healthFactor: read.healthFactor, lltvPct: read.lltvPct },
    });
  }
  if (BigInt(read.debtBase || '0') > BigInt(0)) {
    rows.push({
      ...base,
      kind: 'DEBT',
      asset: read.debtSymbol,
      amount: read.debtBase,
      decimals: read.debtDecimals,
      raw: { symbol: read.debtSymbol, healthFactor: read.healthFactor, lltvPct: read.lltvPct },
    });
  }
  // La pata LEND-ONLY. Sin esta fila, el RLUSD depositado en la bóveda no
  // existía en ninguna pantalla —ni tablero, ni portfolio, ni salida con
  // saldo— mientras la pantalla de éxito prometía que aparecería en Positions.
  // El usuario que no ve su dinero vuelve a depositar.
  //
  // El HF no viaja en esta fila: prestar no se liquida, y colgarle el health
  // factor del carry sería atribuirle un riesgo que no tiene.
  if (BigInt(read.lentAssetsBase || '0') > BigInt(0)) {
    rows.push({
      ...base,
      kind: 'LEND',
      asset: read.lentSymbol ?? 'RLUSD',
      amount: read.lentAssetsBase as string,
      decimals: read.lentDecimals ?? 18,
      healthFactor: null,
      raw: {
        symbol: read.lentSymbol ?? 'RLUSD',
        healthFactor: null,
        lltvPct: read.lltvPct,
        // Lo que hace útil la fila: cuánto vale, en cuántas shares, y cuánto
        // puede pagarte la bóveda HOY (techo duro — no desasigna al vuelo).
        lentSharesBase: read.lentSharesBase,
        vaultAvailableNowBase: read.vaultAvailableNowBase,
        vault: read.vault,
      },
    });
  }
  return rows;
}

/**
 * ¿Alguna lectura de bóveda se quedó sin contestar? `lentReadOk:false` es «no
 * lo sé», no «no tienes nada prestado» — y hay que poder decirlo, porque un
 * cero silencioso en la pata lend-only es indistinguible de un depósito que se
 * perdió.
 */
export function anyVaultLegUnread(reads: EthMorphoPositionRead[]): boolean {
  return reads.some((r) => r?.lentReadOk === false);
}

/* ------------------------------------------------------------------ */
/* EL LECTOR — compartido por el tablero y por la tira de salud         */
/* ------------------------------------------------------------------ */

export interface EthMorphoScan {
  /**
   * `true`/`false` = el carril dijo si está vivo. `null` = NO lo dijo (backend
   * inalcanzable): distinto de «apagado», y quien pinte riesgo debe tratarlo
   * como «no lo sé», jamás como «no hay nada».
   */
  active: boolean | null;
  /** Las lecturas que SÍ se consiguieron. */
  reads: EthMorphoPositionRead[];
  /**
   * Direcciones cuya posición no se pudo leer. Ni se pintan ni se dan por
   * vacías: una posición que desaparece en silencio se lee como «no tengo
   * nada» — y con ella desaparece la puerta de repago justo cuando hace falta.
   */
  unreadable: string[];
}

const EVM_ADDR = /^0x[a-fA-F0-9]{40}$/;

/**
 * Lee la posición de Ethereum de cada dirección. Fail-closed por la puerta del
 * propio carril (`/status`), best-effort por dirección, y —la mitad que
 * importa— DISTINGUE «no tienes posición» de «no pude leerla».
 *
 * `onRailStatus` publica el interruptor caliente (setEthRailLive) sin que este
 * módulo tenga que importar el store: así sigue siendo testeable sin red.
 */
export async function scanEthMorpho(
  addrs: string[],
  deps: {
    apiBase: string;
    headers: () => Record<string, string>;
    region: string | null;
    onRailStatus?: (active: boolean) => void;
    fetchImpl?: typeof fetch;
    /** Corte duro por petición. 0 lo desactiva (los tests no lo necesitan). */
    timeoutMs?: number;
  },
): Promise<EthMorphoScan> {
  const base = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 12_000;
  /**
   * Una lectura sin corte no falla: se queda colgada. Y «colgada» es el peor
   * de los tres estados, porque quien la espera se queda en «cargando» para
   * siempre — y una pantalla de riesgo que nunca termina de cargar es una
   * pantalla que no avisa. Con corte, un cuelgue se convierte en «no lo sé»,
   * que sí se sabe decir.
   */
  const doFetch: typeof fetch = timeoutMs > 0 && typeof AbortController !== 'undefined'
    ? ((input, init) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        return base(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
      }) as typeof fetch
    : base;
  let active: boolean | null = null;
  try {
    const res = await doFetch(`${deps.apiBase}/eth-morpho/status`, {
      headers: deps.headers(),
      credentials: 'include',
    });
    if (res.ok) {
      const body = (await res.json()) as { active?: boolean };
      active = body?.active === true;
      deps.onRailStatus?.(active);
    }
  } catch {
    /* active se queda en null — «no lo sé», que es la verdad */
  }
  if (active !== true) return { active, reads: [], unreadable: [] };

  const targets = addrs.filter((a) => EVM_ADDR.test(a));
  const region = encodeURIComponent(deps.region ?? '');
  const reads: EthMorphoPositionRead[] = [];
  const unreadable: string[] = [];
  const settled = await Promise.allSettled(
    targets.map(async (addr) => {
      const r = await doFetch(
        `${deps.apiBase}/eth-morpho/position?wallet=${encodeURIComponent(addr)}&region=${region}`,
        { headers: deps.headers(), credentials: 'include' },
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as EthMorphoPositionRead;
    }),
  );
  settled.forEach((res, i) => {
    if (res.status === 'fulfilled') reads.push(res.value);
    else unreadable.push(targets[i]);
  });
  return { active, reads, unreadable };
}

/**
 * El factor de salud del carril: el PEOR de las posiciones leídas. Puro.
 *
 * `unreadable` viaja aparte a propósito — quien lo pinte necesita poder decir
 * «no lo sé» en vez de «estás a salvo».
 */
/**
 * HF por dirección, solo las que tienen deuda VIVA. Lo necesitan las pantallas
 * que pintan una fila POR WALLET: decirle «sana» a la wallet que sostiene el
 * carry porque otra está limpia es la misma mentira, en versión granular.
 *
 * Las claves van en minúsculas — quien consulta no debería tener que acordarse
 * del checksum.
 */
export function healthByWallet(reads: EthMorphoPositionRead[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of reads) {
    if (!r?.hasPosition) continue;
    if (BigInt(r.debtBase || '0') <= BigInt(0)) continue;
    const hf = r.healthFactor;
    if (typeof hf !== 'number' || !Number.isFinite(hf)) continue;
    const k = String(r.wallet).toLowerCase();
    out[k] = out[k] === undefined ? hf : Math.min(out[k], hf);
  }
  return out;
}

export function worstHealthFactor(reads: EthMorphoPositionRead[]): number | null {
  let worst: number | null = null;
  for (const r of reads) {
    if (!r?.hasPosition) continue;
    if (BigInt(r.debtBase || '0') <= BigInt(0)) continue;  // sin deuda no hay HF que vigilar
    const hf = r.healthFactor;
    if (typeof hf !== 'number' || !Number.isFinite(hf)) continue;
    worst = worst == null ? hf : Math.min(worst, hf);
  }
  return worst;
}
