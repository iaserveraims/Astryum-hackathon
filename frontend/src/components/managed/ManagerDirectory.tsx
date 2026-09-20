'use client';

/**
 * ManagerDirectory — el catálogo de bóvedas con gestor, con LA MISMA MANO que
 * los otros dos menús de Earn (fundador 2026-08-29: «tiene que estar igual que
 * los otros dos menús con estrategias»).
 *
 * Las cartas SON la mano de `StrategyFan` — la misma que los otros dos menús,
 * con sus tres artefactos por nivel de movimiento (mano, estantería, lista).
 * Durante unas horas del 13-sep fueron un mosaico de recuadros (VaultMosaic,
 * sin montar): salían achatados y pequeños, y el fundador lo devolvió a la
 * carta de Earn («deberían verse como todas las estrategias del Earn»). De
 * aquel paso se conserva lo que pedía de fondo: EL DINERO DELANTE — en la
 * bóveda y lo tuyo, sumado en todas tus wallets (vaultMoney) — y la imagen
 * del gestor pequeña, secundaria. La ficha sigue desplegándose COMO COLUMNA
 * a la derecha, en flujo, con la mano comprimiéndose — la coreografía de pick.
 *
 * ── EL TOQUE DISTINTIVO ES EL GESTOR (fundador 2026-08-29) ──────────────────
 * Cada carta lleva el AVATAR del gestor en el tile (identicon determinista de
 * su cuenta XRPL — managerIdentity), su nombre en la frase y su chip de
 * acreditación. Su PERFIL (bóvedas, capital, apoyo de la comunidad, enlace de
 * referidos) se abre desde la ficha y desde el deep-link
 * `?view=managers&manager=r…` que el propio gestor comparte para captar.
 * Las bóvedas sin gestor tercero (la de prueba) llevan el perfil genérico
 * «Astryum made» — presentado como demo, jamás como gestión de Astryum.
 *
 * DOS REGLAS QUE ESTE COMPONENTE NO NEGOCIA:
 *
 * · NO ORDENA. El orden que llega del backend es el de creación, y se pinta tal
 *   cual. Ordenar es elegir, y elegir por el usuario es la diferencia entre
 *   publicar un catálogo y recomendar un producto (invariante #9). El apoyo de
 *   la comunidad dará visibilidad SOLO como orden que el usuario pide — cuando
 *   exista el recuento público; jamás como orden por defecto.
 * · «NO PUDE LEER» NUNCA ES «NO HAY». Un fallo de red pintado como catálogo
 *   vacío le dice al usuario que no existe ningún gestor: una afirmación
 *   distinta y probablemente falsa.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { BadgeCheck, Landmark, Lock, ShieldAlert, ThumbsUp } from 'lucide-react';

import { Card, MicroLabel, SegmentedControl } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';
import { StrategyFan, type FanCard } from '../earn/StrategyFan';
import { TokenLogo } from '../ui/TokenLogo';
import { VaultTile } from './VaultTile';
import { mineByPote, VaultMoney } from './vaultMoney';
import { fmtExitWindow, shortAddr } from '../../lib/institutional/format';
import { venueIdentity } from '../../lib/institutional/venueIdentity';
import { VaultDetailPanel } from './VaultDetailPanel';
import { ManagerProfileModal } from './ManagerProfileModal';
import { ActorKindBadge, ManagerAvatar, isRealManager, managerOf, withProfile, type ManagerIdentity } from './managerIdentity';
import { listPotes, type PoteCatalogEntry } from '../../lib/institutional/api';
import { useCommunity } from '../../lib/institutional/useCommunity';
import { useMyManagedPositions } from '../../lib/institutional/useMyManagedPositions';

/* ── Formateo: nada se inventa, y lo que no se sabe se dice «—» ──────────── */



/**
 * El chip de abajo: el gestor con su cara, y el estado de acreditación.
 * El tick viaja tal cual del ledger; `credential` a null se pinta «sin
 * acreditar» — la palabra que cubre «no tiene» y «no se pudo leer» sin acusar
 * de ninguno (la credencial es requisito desde el 27-ago).
 */
function VaultChip({
  entry,
  mgr,
  supported,
  t,
}: {
  entry: PoteCatalogEntry;
  mgr: ManagerIdentity;
  /** TÚ apoyas a este gestor. Es tu gesto, no un recuento de la comunidad. */
  supported: boolean;
  t: (s: string) => string;
}) {
  // El perfil público delante (8-sep): nombre y foto reales cuando existen.
  const { actors } = useCommunity();
  const who = withProfile(mgr, mgr.address ? actors.get(mgr.address) : null);
  // ILEGIBLE = ilegible. Con `unreadable` no se sabe ni la acreditación ni la
  // puerta: pintar «sin acreditar» o callar el candado serían afirmaciones
  // sobre datos que no llegaron. Un solo chip ámbar con la verdad.
  if (entry.unreadable) {
    return (
      <span className="flex flex-wrap items-center gap-1">
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] px-1.5 py-0.5 text-[10px] text-ink/60">
          <ManagerAvatar manager={who} size={16} photo={who.photo} actorKind={who.actorKind} />
          <span className="truncate">{who.name}</span>
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-tone-warning/30 bg-tone-warning/10 px-1.5 py-0.5 text-[10px] text-tone-warning">
          <ShieldAlert className="h-3 w-3 shrink-0" strokeWidth={2} />
          {t('Could not read')}
        </span>
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] px-1.5 py-0.5 text-[10px] text-ink/60">
        <ManagerAvatar manager={who} size={16} photo={who.photo} actorKind={who.actorKind} />
        <span className="truncate">{who.name}</span>
        {who.actorKind === 'agent' ? <ActorKindBadge kind="agent" /> : null}
        {supported && isRealManager(mgr) && (
          <ThumbsUp className="h-3 w-3 shrink-0 text-volt" strokeWidth={2.2} aria-label={t('You support this manager')} />
        )}
      </span>
      {entry.credential?.issuer ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-tone-success/30 bg-tone-success/10 px-1.5 py-0.5 text-[10px] text-tone-success">
          <BadgeCheck className="h-3 w-3 shrink-0" strokeWidth={2} />
          {t('Verified')}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-full border border-tone-warning/30 bg-tone-warning/10 px-1.5 py-0.5 text-[10px] text-tone-warning">
          <ShieldAlert className="h-3 w-3 shrink-0" strokeWidth={2} />
          {t('Not accredited')}
        </span>
      )}
      {entry.gated && (
        <span className="inline-flex items-center gap-1 rounded-full border border-ink/15 px-1.5 py-0.5 text-[9px] text-ink/45">
          <Lock className="h-3 w-3 shrink-0" strokeWidth={2} />
          {t('Entry gated')}
        </span>
      )}
    </span>
  );
}

/**
 * El ORDEN es un gesto que pide el usuario, jamas el que trae la pantalla.
 * `catalogue` (creación) es el DEFAULT. Los demás ordenan por HECHOS del
 * contrato — nunca por rentabilidad. El apoyo de la comunidad entrará aquí
 * como opción MÁS cuando exista el recuento público del backend.
 */
type SortId = 'catalogue' | 'supported' | 'exit' | 'venues' | 'size';

/** La cabecera de la carta: la imagen del gestor PEQUEÑA (secundaria, fundador
 *  13-sep) y el token con logo y símbolo — lo que dice de qué va la bóveda. */
function VaultFanTile({
  entry,
  manager,
  asset,
  accent,
}: {
  entry: PoteCatalogEntry;
  manager: ManagerIdentity;
  asset: string;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className={`grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-lg border ${accent}`}>
        <VaultTile entry={entry} manager={manager} size={32} shape="square" />
      </div>
      {asset ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-ink/10 bg-ink/[0.03] py-0.5 pl-0.5 pr-1.5">
          <TokenLogo symbol={asset} size="xs" />
          <span className="font-mono text-[10px] font-medium text-ink/75">{asset}</span>
        </span>
      ) : null}
    </div>
  );
}

/** De lo que devuelve la chain a la carta de la mano. */
function toFan(p: PoteCatalogEntry, mgr: ManagerIdentity, who: { name: string }, t: (s: string) => string): FanCard<string> {
  const accent = p.unreadable || !p.credential?.issuer ? 'border-tone-warning/35' : 'border-ink/15';
  const base = {
    kind: p.pote,
    asset: p.asset?.symbol ?? '',
    title: p.name ?? shortAddr(p.pote),
    icon: <VaultTile entry={p} manager={mgr} size={22} />,
    tile: <VaultFanTile entry={p} manager={mgr} asset={p.asset?.symbol ?? ''} accent={accent} />,
    accent,
    blocked: false,
    market: undefined,
  };
  // ILEGIBLE (429 del RPC, el incidente del 17-ago): la carta lo dice y no
  // afirma NADA más — un «exit — · 0 destinos» sobre datos que no llegaron es
  // «no pude leer» pintado como «no hay», en la pantalla de comparar.
  if (p.unreadable) {
    return { ...base, action: t('Its state could not be read right now — that is not the same as empty.') };
  }
  // QUIÉN la lleva, por identidad — jamás «Run by Astryum made»: Astryum no
  // gestiona (#1/#8), y con consejo sin resolver no se afirma dueño ninguno.
  const runBy =
    mgr.kind === 'manager'
      ? `${t('Run by')} ${who.name}`
      : mgr.kind === 'astryum'
        ? t('Demo vault — no third-party manager')
        : t('Manager unresolved');
  // A DÓNDE va el capital, con nombre: «Kinetic · Firelight» dice más que
  // «2 destinos»; sin destinos se dice que el capital estaría parado.
  const venueNames = [...new Set(p.venues.filter((v) => !v.retired).map((v) => { const id = venueIdentity(v.target); return id.known && id.name ? id.name : shortAddr(v.target); }))];
  const action = [
    runBy,
    `${t('exit')} ${fmtExitWindow(p.cooldownSeconds, t)}`,
    venueNames.length > 0 ? venueNames.join(' · ') : t('no destination yet — capital would sit idle'),
  ].join(' · ');
  return { ...base, action };
}

export function ManagerDirectory() {
  const { t } = useT();
  const [selected, setSelected] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortId>('catalogue');
  const [entries, setEntries] = useState<PoteCatalogEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  /** El perfil abierto (clave de gestor), desde la ficha o el deep-link. */
  const [profileKey, setProfileKey] = useState<string | null>(null);
  /** La comunidad: perfiles (nombre, foto, persona/agente), apoyos e imágenes. */
  const { actors } = useCommunity();
  /** LO TUYO en cada bóveda (13-sep): todas tus wallets y sus Smart Accounts,
   *  del mismo lector compartido que usa el resto de la app. */
  const { positions, loading: positionsLoading } = useMyManagedPositions();
  /** Los gestores que TÚ apoyas — lo dice el servidor, no este navegador. */
  const endorsedSet = useMemo(() => {
    const set = new Set<string>();
    actors.forEach((a) => { if (a.endorsedByMe) set.add(a.account); });
    return set;
  }, [actors]);

  useEffect(() => {
    let alive = true;
    listPotes(true)
      .then((r) => { if (alive) { setEntries(r); setFailed(false); } })
      .catch(() => { if (alive) { setEntries([]); setFailed(true); } });
    return () => { alive = false; };
  }, []);

  /**
   * El enlace de referidos del gestor: `?manager=r…` abre su perfil al llegar.
   *
   * SOLO SI ESE GESTOR ESTÁ EN EL CATÁLOGO. Un enlace puede traer cualquier
   * cadena, y abrir una ficha con el nombre y el avatar de una cuenta que aquí
   * no lleva ninguna bóveda sería fabricar la página de un gestor que no
   * existe — exactamente el material de un enlace de phishing. Por eso espera
   * a que el catálogo esté leído y compara; una sola vez (el ref), para que
   * cerrar el perfil no lo vuelva a abrir en el siguiente render.
   */
  const deepLinkDone = useRef(false);
  useEffect(() => {
    if (deepLinkDone.current || entries === null) return;
    deepLinkDone.current = true;
    try {
      const qs = new URLSearchParams(window.location.search);
      const wanted = qs.get('manager');
      if (!wanted) return;
      // El param se CONSUME: sin esto, cerrar el perfil y volver a la puerta
      // (o un F5) lo reabría, y el enlace copiado de la barra arrastraría el
      // perfil a cualquiera. Mismo gesto que el cleanup de ?launch en Earn.
      qs.delete('manager');
      const rest = qs.toString();
      window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
      // Solo identidades con perfil: un gestor real del catálogo o la casa.
      const match = entries.map((e) => managerOf(e)).find((m) => m.key === wanted && m.kind !== 'unknown');
      if (match) setProfileKey(match.key);
    } catch {
      /* sin URL legible no hay deep-link — el catálogo sigue */
    }
  }, [entries]);

  /** Ordenar es una COPIA, nunca in situ: el orden que llega no se destruye. */
  const ordered = useMemo(() => {
    const base = entries ?? [];
    if (sortBy === 'catalogue') return base;
    const arr = [...base];
    if (sortBy === 'supported') {
      // El recuento PÚBLICO (8-sep): votos de la comunidad contados en el
      // servidor. Sigue siendo una opción que el usuario elige, jamás el
      // orden por defecto (#9): visibilidad votada por usuarios, no
      // recomendación de Astryum.
      const tally = (e: PoteCatalogEntry) => {
        const m = managerOf(e);
        return isRealManager(m) ? (actors.get(m.key)?.endorsements ?? 0) : -1;
      };
      arr.sort((a, b) => tally(b) - tally(a));
    } else if (sortBy === 'exit') {
      arr.sort((a, b) => (a.cooldownSeconds ?? Infinity) - (b.cooldownSeconds ?? Infinity));
    } else if (sortBy === 'venues') {
      arr.sort((a, b) => a.venues.length - b.venues.length);
    } else {
      // «Más capital» compara CANTIDADES DE TOKEN, y solo tiene sentido pleno
      // entre bóvedas del mismo activo. Se normalizan los decimales (sin esto
      // el orden lo decidían los decimales del token, no su cantidad) y lo
      // ilegible cuenta 0 con try/catch — el hermano de arriba ya lo hacía.
      // Comparar activos distintos en valor real necesita precios: eso llega
      // con el backend, no se finge aquí.
      const scaled = (e: PoteCatalogEntry) => {
        try {
          if (!e.totalAssets || !e.asset) return BigInt(0);
          return BigInt(e.totalAssets) * BigInt(10) ** BigInt(Math.max(0, 18 - e.asset.decimals));
        } catch {
          return BigInt(0);
        }
      };
      arr.sort((a, b) => {
        const va = scaled(a);
        const vb = scaled(b);
        return va === vb ? 0 : va > vb ? -1 : 1;
      });
    }
    return arr;
  }, [entries, sortBy, actors]);

  const managersByPote = useMemo(() => {
    const m = new Map<string, ManagerIdentity>();
    for (const e of ordered) m.set(e.pote, managerOf(e));
    return m;
  }, [ordered]);
  /** Lo tuyo, sumado por bóveda — va en la carta, encima del chip del gestor. */
  const mine = useMemo(() => mineByPote(positions), [positions]);
  const fanCards = useMemo(
    () =>
      ordered.map((e) => {
        const mgr = managersByPote.get(e.pote) ?? managerOf(e);
        const who = withProfile(mgr, mgr.address ? actors.get(mgr.address) : null);
        return toFan(e, mgr, who, t);
      }),
    [ordered, managersByPote, actors, t],
  );

  const loading = entries === null;
  const openEntry = useMemo(
    () => (entries ?? []).find((e) => e.pote === selected) ?? null,
    [entries, selected],
  );
  // La identidad del perfil sale SIEMPRE de una bóveda real del catálogo: sin
  // coincidencia no hay perfil (misma razón que el deep-link de arriba). Y
  // 'unknown' NUNCA tiene perfil: agrupar consejos sin resolver bajo una
  // ficha sumaría capitales de dueños distintos que no conocemos.
  const profileManager = useMemo(() => {
    if (!profileKey) return null;
    const sample = (entries ?? [])
      .map((e) => managerOf(e))
      .find((m) => m.key === profileKey && m.kind !== 'unknown');
    return sample ?? null;
  }, [profileKey, entries]);
  const profileVaults = useMemo(
    () => (profileManager ? (entries ?? []).filter((e) => managerOf(e).key === profileManager.key) : []),
    [entries, profileManager],
  );

  if (loading) {
    return (
      <Card className="p-6">
        <p className="text-sm text-ink/45">{t('Reading the catalogue from the chain…')}</p>
      </Card>
    );
  }
  if (failed) {
    return (
      <Card className="p-6">
        <p className="max-w-[62ch] text-sm leading-relaxed text-tone-warning/80">
          {t('The catalogue could not be read right now. That is not the same as there being none — try again in a moment.')}
        </p>
      </Card>
    );
  }
  if (ordered.length === 0) {
    return (
      <Card className="p-6">
        <div className="flex items-start gap-3">
          <Landmark className="mt-0.5 h-5 w-5 shrink-0 text-ink/35" strokeWidth={1.6} />
          <div className="min-w-0">
            <h3 className="text-base font-semibold tracking-tight text-ink">{t('No vaults listed yet')}</h3>
            <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-ink/55">
              {t('This is where vaults run by a manager will appear, with the rules each one enforces. Astryum lists them; it never manages and never recommends one.')}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MicroLabel>{t('Vaults open to new clients')}</MicroLabel>
        {/* El control existe pero arranca en «catalogue»: el orden es una
            peticion visible del usuario, no algo que la pantalla decide. */}
        <SegmentedControl<SortId>
          layoutId="managed-vaults-sort"
          // whitespace-nowrap: sin él, en cajas estrechas las cinco etiquetas
          // se parten a dos líneas ANTES de que el overflow llegue a scrollear.
          className="max-w-full overflow-x-auto scrollbar-hide whitespace-nowrap"
          value={sortBy}
          onChange={setSortBy}
          options={[
            { key: 'catalogue', label: t('Catalogue order') },
            { key: 'supported', label: t('Most supported') },
            { key: 'exit', label: t('Shortest exit') },
            { key: 'venues', label: t('Fewest destinations') },
            { key: 'size', label: t('Most capital') },
          ]}
        />
      </div>

      {/* LA MISMA COREOGRAFÍA QUE PICK (24→26-ago allí, hoy aquí): mano a la
          izquierda que se comprime al abrir; ficha EN FLUJO como columna
          derecha que crece. En móvil el flex es columna: la mano cae a la
          rejilla de StrategyFan y la ficha queda debajo, a lo ancho. */}
      <div className="flex flex-col gap-5 md:flex-row md:items-start">
        <div
          className={
            openEntry
              ? 'min-w-0 md:w-[46%] md:min-w-[19rem] md:max-w-[36rem] md:shrink-0 xl:max-w-[40rem]'
              : 'min-w-0 flex-1'
          }
        >
          <StrategyFan<string>
            cards={fanCards}
            selected={selected}
            onSelect={(k) => setSelected((cur) => (cur === k ? null : k))}
            // El pie de la carta: el DINERO (en la bóveda | tuyo) y, debajo,
            // el gestor con su acreditación. Una bóveda ilegible no pinta cifras.
            chip={(k) => {
              const e = ordered.find((x) => x.pote === k);
              const mgr = managersByPote.get(k);
              if (!e || !mgr) return null;
              return (
                <div className="space-y-2">
                  {!e.unreadable && <VaultMoney entry={e} mine={mine.get(k) ?? null} loading={positionsLoading} t={t} />}
                  <VaultChip entry={e} mgr={mgr} supported={endorsedSet.has(mgr.key)} t={t} />
                </div>
              );
            }}
            compressed={!!openEntry}
            t={t}
          />
        </div>

        {openEntry && (
          <motion.aside
            initial={{ opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}
            className="min-w-0 flex-1 md:h-[min(74vh,46rem)]"
            role="region"
            aria-label={t('This vault')}
          >
            <div className="md:h-full md:overflow-y-auto scrollbar-thin">
              <VaultDetailPanel
                entry={openEntry}
                onOpenManager={(() => {
                  const m = managerOf(openEntry);
                  // Sin identidad no hay perfil que abrir — la ficha ya dice
                  // que el consejo no se pudo resolver.
                  return m.kind === 'unknown' ? undefined : () => setProfileKey(m.key);
                })()}
              />
            </div>
          </motion.aside>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] text-ink/35">
          {sortBy === 'catalogue'
            ? t('Listed in the order the chain returns them — Astryum does not rank vaults.')
            : t('You chose this order. It is a filter, not a recommendation.')}
        </p>
        {!selected && (
          <p className="text-[11px] text-ink/35">
            {t('Pick a vault — its cage, its destinations and who runs it unfold beside it.')}
          </p>
        )}
      </div>

      {profileManager && (
        <ManagerProfileModal
          manager={profileManager}
          vaults={profileVaults}
          onPickVault={(pote) => { setSelected(pote); setProfileKey(null); }}
          onClose={() => setProfileKey(null)}
        />
      )}
    </div>
  );
}

export default ManagerDirectory;
