'use client';

import { useEffect, useState } from 'react';
import { Briefcase, ChevronRight, LogOut, Network, Sliders, ShieldCheck, Globe } from 'lucide-react';
import Link from 'next/link';
import {
  LEGAL_RECORD_UNREADABLE_EN,
  LEGAL_RECORD_UNREADABLE_ES,
  LEGAL_RECORD_UNREADABLE_TITLE_EN,
  LEGAL_RECORD_UNREADABLE_TITLE_ES,
} from '@/lib/legal/legalGateMode';
import { useAuthStore } from '../../../stores/authStore';
import { getApiBase } from '../../../lib/env';
import { getUserRegion, setUserRegion } from '../../../lib/region';
import { useOnboardingStore } from '../../../stores/onboardingStore';
import { useT } from '../../../i18n/LanguageProvider';
import {
  Card,
  GhostButton,
  HairlineCell,
  HairlineGroup,
  MicroLabel,
  PageHeader,
  Pill,
  SectionTitle,
} from '../../../components/ui/primitives';
import StepUpSettings from '../../../components/security/StepUpSettings';
import { Reveal, RevealGroup, RevealItem, PulseDot } from '../../../components/ui/motion';
import { ConsoleDials, SignatureScene } from '../../../components/ui/scenes';
import { RegisterMark } from '../../../components/ui/skin/marks';
import { useEngraved } from '../../../stores/themeStore';
import PasskeySettings from '../../../components/security/PasskeySettings';
// Demo: the Supported-chains table is hidden (component preserved intact).
// import { ChainCapabilitiesPanel } from '../../../components/chains/ChainCapabilitiesPanel';
import ProfileCard from '../../../components/settings/ProfileCard';
import MotionSettings from '../../../components/settings/MotionSettings';
import AppearanceSettings from '../../../components/settings/AppearanceSettings';
import { useIsManager, useManagerStore } from '../../../stores/managerStore';
import { ManagerCertificationCard } from '../../../components/managed/ManagerCertificationCard';

// Common region codes surfaced directly in the picker; anything else goes
// through "Other…" as free text (still validated as a 2–3 letter code).
const COMMON_REGIONS = ['ES', 'PT', 'FR', 'DE', 'IT', 'NL', 'IE', 'US', 'GB'];
const NONE_VALUE = '__none';
const OTHER_VALUE = '__other';

/** A slim gold-eyebrow section band — the calm "chapter" divider that makes the
 *  settings surface read as one instrument panel in the same spacecraft as Earn.
 *  Purely presentational; the label arrives already localized. */
function Band({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-volt-soft/60">{label}</span>
      <span className="flex-1 h-px bg-gradient-to-r from-ink/[0.08] to-transparent" />
    </div>
  );
}

export default function SettingsPage() {
  const { t, lang, setLang } = useT();
  const es = lang === 'es';
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  // Perfil profesional: el onboarding es saltable, así
  // que el interruptor de gestor vive TAMBIÉN aquí — y con él, el KYC.
  const isManager = useIsManager();
  const setManager = useManagerStore((s) => s.setManager);
  // El flag viaja a la CUENTA; si el servidor no lo acepta, el
  // toggle revierte y esta línea lo cuenta — un guardado a medias es el bug.
  const [managerSaveFailed, setManagerSaveFailed] = useState(false);

  const [apiBase] = useState(getApiBase());
  const useV1 =
    (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_USE_V1_INTENTS) !== 'false';
  const requireSiwe =
    (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_REQUIRE_SIWE) !== 'false';

  return (
    <RevealGroup>
      <PageHeader
        eyebrow={t('Settings')}
        title={es ? 'Preferencias del espacio' : 'Workspace preferences'}
        subtitle={t('Connection, network and account preferences. No private keys are ever stored here.')}
        actions={<Pill tone="info">v1</Pill>}
      />

      <div className="grid md:grid-cols-2 gap-4">
        {/* ── Identity — how you appear across Astryum, stored on this device ── */}
        <RevealItem className="md:col-span-2">
          <Band label={es ? 'Identidad' : 'Identity'} />
        </RevealItem>
        <RevealItem className="md:col-span-2">
          <ProfileCard />
        </RevealItem>

        {/* ── Network & account — read-only connection facts, as instruments ── */}
        <RevealItem className="md:col-span-2">
          <Band label={es ? 'Red y cuenta' : 'Network & account'} />
        </RevealItem>
        <RevealItem className="md:col-span-2">
          <Card spotlight className="group relative overflow-hidden">
            <div className="relative z-[1]">
              <div className="flex items-center justify-between gap-3 mb-4">
                <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-ink">
                  <Network className="w-4 h-4 text-ink/50" strokeWidth={1.5} />
                  {es ? 'Conexión' : 'Connection'}
                </span>
                <GhostButton
                  onClick={() => {
                    logout();
                    window.location.href = '/login';
                  }}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <LogOut className="w-3.5 h-3.5" strokeWidth={1.5} /> {t('Sign out')}
                  </span>
                </GhostButton>
              </div>
              <HairlineGroup columns="grid-cols-2">
                <HairlineCell className="p-4">
                  <MicroLabel>{t('Chain')}</MicroLabel>
                  <div className="mt-1.5 text-sm text-ink/90">Flare Mainnet</div>
                </HairlineCell>
                <HairlineCell className="p-4">
                  <MicroLabel>{t('Address')}</MicroLabel>
                  <div className="mt-1.5 flex items-center gap-2 min-w-0">
                    {user?.address ? <PulseDot size={7} /> : null}
                    <span className="font-mono text-sm text-ink/90 break-all">
                      {user?.address ?? t('Not connected')}
                    </span>
                  </div>
                </HairlineCell>
              </HairlineGroup>

              {/* Debug/connection-plumbing facts — collapsed by default (de-AI
                  pass): chainId/API base/flags are for troubleshooting,
                  not something everyone needs to see every visit. */}
              <details className="group mt-3">
                <summary className="flex list-none items-center gap-1.5 text-xs font-medium text-ink/45 transition-colors hover:text-ink/70 [&::-webkit-details-marker]:hidden cursor-pointer">
                  <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" strokeWidth={1.5} />
                  {t('Advanced')}
                </summary>
                <div className="mt-3">
                  <HairlineGroup columns="grid-cols-2">
                    <HairlineCell className="p-4">
                      <MicroLabel>chainId</MicroLabel>
                      <div className="mt-1.5 font-mono text-sm text-ink/90">14</div>
                    </HairlineCell>
                    <HairlineCell className="p-4">
                      <MicroLabel>{t('API base')}</MicroLabel>
                      <div className="mt-1.5 font-mono text-sm text-ink/80 break-all">{apiBase}</div>
                    </HairlineCell>
                    <HairlineCell className="p-4">
                      <MicroLabel>{t('V1 intents')}</MicroLabel>
                      <div className="mt-2">
                        <Pill tone={useV1 ? 'success' : 'warning'}>{useV1 ? t('enabled') : t('disabled')}</Pill>
                      </div>
                    </HairlineCell>
                    <HairlineCell className="p-4">
                      <MicroLabel>{t('Require SIWE')}</MicroLabel>
                      <div className="mt-2">
                        <Pill tone={requireSiwe ? 'success' : 'warning'}>{requireSiwe ? t('enabled') : t('disabled')}</Pill>
                      </div>
                    </HairlineCell>
                  </HairlineGroup>
                </div>
              </details>
            </div>
          </Card>
        </RevealItem>

        {/* ── Region & jurisdiction — the fail-closed geofence (invariant #5) ── */}
        <RevealItem className="md:col-span-2">
          <Band label={es ? 'Jurisdicción' : 'Region & jurisdiction'} />
        </RevealItem>
        <RevealItem className="md:col-span-2">
          <RegionSettings />
        </RevealItem>

        {/* ── Session & security ── */}
        <RevealItem className="md:col-span-2">
          <Band label={es ? 'Sesión y seguridad' : 'Session & security'} />
        </RevealItem>
        {/* `steady`: este bloque contiene el selector de tema y no vuelve a
            imprimirse al cambiarlo — el botón que acabas de pulsar no puede
            quedar bajo el recorte (ui/motion.tsx RevealItem). */}
        <RevealItem className="md:col-span-2" steady>
          <Card spotlight>
            <SectionTitle>
              <span className="inline-flex items-center gap-2">
                <Sliders className="w-4 h-4" strokeWidth={1.5} /> {t('Preferences')}
              </span>
            </SectionTitle>
            {/* APARIENCIA — dos filas, dos ejes: el TEMA
                (de qué material está hecho el panel: Astryum o Institucional,
                con sus dos probetas en vivo) y la LUZ (claro, oscuro o el
                dispositivo). Hasta hoy esta fila se llamaba «Tema» y solo
                elegía la luz. Ver components/settings/AppearanceSettings.tsx
                y lib/theme/appearance.ts. */}
            <AppearanceSettings />
            {/* Movimiento: cuánto se mueve la interfaz —
                completo, sereno o mínimo — o que decida el dispositivo. Un
                ajuste para toda la web; las probetas de abajo lo enseñan en
                vivo. Persistido (stores/motionStore). */}
            <MotionSettings />
            {/* Language — moved here from the sidebar: same ES/EN pair, now living with the
                other preferences instead of taking a sidebar slot. */}
            <div className="flex items-center justify-between gap-4 py-2 border-b border-ink/5">
              <div>
                <div className="text-sm text-ink/90">{t('Language')}</div>
                <div className="text-xs text-ink/40 mt-0.5">{t('Texts and number formats.')}</div>
              </div>
              <div className="flex items-center rounded-lg border border-ink/10 bg-ink/[0.03] p-0.5 text-[11px] font-medium shrink-0">
                {(['es', 'en'] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => setLang(l)}
                    aria-pressed={lang === l}
                    className={`px-3 py-1 rounded-md uppercase transition-colors ${
                      lang === l ? 'bg-volt text-volt-ink' : 'text-ink/45 hover:text-ink/80'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            {/* Expert-mode toggle hidden for the demo (authStore.setExpertMode preserved). */}
            <div className="flex items-center justify-between gap-4 py-2">
              <div>
                <div className="text-sm text-ink/90">{t('Initial setup')}</div>
                <div className="text-xs text-ink/40 mt-0.5">
                  {t('Replay the setup wizard and the interactive tour of every screen.')}
                </div>
              </div>
              <button
                onClick={() => {
                  const s = useOnboardingStore.getState();
                  s.resetTours(); // the Summary/Earn coachmarks replay too
                  s.reopen();
                }}
                className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border border-volt/30 text-volt hover:bg-volt/[0.08] transition-colors"
              >
                {t('Run again')}
              </button>
            </div>
          </Card>
        </RevealItem>

        {/* ── Legal: qué firmaste y cuándo. El recibo de la ceremonia
            de firma, siempre a mano, con los textos públicos enlazados. ── */}
        <RevealItem className="md:col-span-2">
          <LegalRecordCard />
        </RevealItem>

        {/* ── Professional profile — the manager switch + certification ──
            El flag decide DESCUBRIMIENTO (la fila «Manager desk» del sidebar),
            no permisos: la chain y el raíl de KYC mandan. Mismo interruptor
            que la pregunta sutil del onboarding. */}
        <RevealItem className="md:col-span-2">
          <Band label={es ? 'Perfil profesional' : 'Professional profile'} />
        </RevealItem>
        <RevealItem className="md:col-span-2">
          <Card spotlight>
            <SectionTitle>
              <span className="inline-flex items-center gap-2">
                <Briefcase className="w-4 h-4" strokeWidth={1.5} /> {t('Vault manager')}
              </span>
            </SectionTitle>
            <div className="flex items-center justify-between gap-4 py-2">
              <div>
                <div className="text-sm text-ink/90">{t('I manage third-party capital')}</div>
                <div className="text-xs text-ink/40 mt-0.5">
                  {t('Opens your Manager desk from Earn → Managed vaults: the vaults you run and your certification. Off any time.')}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isManager}
                onClick={() => {
                  setManagerSaveFailed(false);
                  void setManager(!isManager).then((ok) => setManagerSaveFailed(!ok));
                }}
                className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                  isManager
                    ? 'border-volt/40 bg-volt/[0.1] text-volt'
                    : 'border-ink/10 text-ink/50 hover:text-ink hover:border-ink/20'
                }`}
              >
                {isManager ? t('Manager: on') : t('Manager: off')}
              </button>
            </div>
            {managerSaveFailed && (
              <p className="pb-2 text-[11px] leading-relaxed text-tone-warning">
                {t('The change did not reach your account — it was undone. Try again in a moment; without it, other browsers would not see it.')}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-ink/5">
              {isManager && (
                <Link
                  href="/app/manager"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-volt hover:underline"
                >
                  {t('Open Manager desk')} <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              )}
              {/* La comunidad: quién lleva bóvedas, personas y agentes,
                  con sus apoyos. No vive en el sidebar — se llega desde aquí,
                  desde el catálogo y desde cualquier perfil. */}
              <Link
                href="/app/community"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-volt hover:underline"
              >
                {t('Community of managers')} <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </Card>
        </RevealItem>
        {/* La certificación como REFERRAL — la MISMA tarjeta que en la mesa, una
            pieza y dos montajes: la explicación del circuito y la puerta
            hacia la certificadora (por env; apagada mientras no haya empresa). */}
        {isManager && (
          <RevealItem className="md:col-span-2">
            <ManagerCertificationCard />
          </RevealItem>
        )}

        {/* Supported-chains table hidden for the demo — ChainCapabilitiesPanel
            remains intact under components/chains/. */}

        {/* Flag-gated: both return null unless their env flags are set, yet each
            keeps its RevealItem slot so the security grid stays choreographed. */}
        <RevealItem>
          <PasskeySettings />
        </RevealItem>

        <RevealItem>
          <StepUpSettings />
        </RevealItem>

        {/* ── The promise — the emotional peak, given the fullest scene on the
            page. Brand identity, not a warning: it reads in calm gold, never in
            alarm amber, and is made to outrank every other card. ── */}
        <RevealItem className="md:col-span-2">
          <Band label={es ? 'La promesa' : 'The promise'} />
        </RevealItem>
        <RevealItem className="md:col-span-2">
          <Card spotlight className="group relative overflow-hidden border-volt/20">
            {/* the signature — "you always sign" written by hand: the stroke
                writes itself under attention. Decorative, never intercepts. */}
            <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 hidden lg:block opacity-[0.4] group-hover:opacity-75 transition-opacity duration-700 z-0">
              <SignatureScene width={220} height={150} />
            </div>
            <div className="relative z-[1] flex items-start gap-4 max-w-2xl">
              <div className="w-10 h-10 rounded-xl grid place-items-center bg-volt/10 border border-volt/25 text-volt shrink-0">
                <ShieldCheck className="w-5 h-5" strokeWidth={1.5} />
              </div>
              <div className="flex-1">
                <div className="text-lg font-semibold text-ink tracking-tight">{t('Astryum is non-custodial')}</div>
                <div className="text-sm text-ink/60 mt-2 leading-relaxed">
                  {t('Astryum never stores or transmits your private keys. Every on-chain action is a TransactionIntent that you sign locally with your wallet. The backend only holds public addresses, simulations and signed intents.')}
                </div>
                <a
                  href="https://docs.flare.network"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block mt-3 text-xs text-volt hover:text-volt/80"
                >
                  {t('Learn about Flare →')}
                </a>
              </div>
            </div>
          </Card>
        </RevealItem>
      </div>
    </RevealGroup>
  );
}

// Region — feeds JurisdictionService's fail-closed geofence (invariant #5).
// Purely device-local (see lib/region.ts) and purely explicit: no IP/language guess.
/**
 * LegalRecordCard — lo que esta cuenta tiene firmado: las condiciones aceptadas y el
 * aviso leído, con versión y fecha, y el enlace a cada texto para releerlo.
 * Sale de /auth/me (`legal.accepted`); si falta la firma, lo dice y remite a
 * la puerta del panel. Nada se firma desde aquí: firmar es la ceremonia.
 */
function LegalRecordCard() {
  const { t, lang } = useT();
  const legal = useAuthStore((s) => s.legalGate);
  const acc = legal?.accepted ?? null;
  // TERCER ESTADO: la puerta legal ya no dice «no has firmado»
  // cuando lo que ocurrio es que no pudimos leer la ficha. Esta tarjeta
  // leia lo mismo a traves de `accepted: null` y seguia acusando. Las
  // frases viven en lib/legal/legalGateMode: una sola redaccion para la
  // nota de la puerta y para esta tarjeta, y en los dos idiomas sin tocar
  // dict.ts.
  const recordUnreadable = legal?.unreadable === true;
  const unreadableTitle = lang === 'es' ? LEGAL_RECORD_UNREADABLE_TITLE_ES : LEGAL_RECORD_UNREADABLE_TITLE_EN;
  const unreadableBody = lang === 'es' ? LEGAL_RECORD_UNREADABLE_ES : LEGAL_RECORD_UNREADABLE_EN;
  const when = (() => {
    if (!acc?.acceptedAt) return null;
    const d = new Date(acc.acceptedAt);
    if (Number.isNaN(d.getTime())) return null;
    try {
      return d.toLocaleString(lang === 'es' ? 'es-ES' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return acc.acceptedAt;
    }
  })();
  const rows: Array<{ label: string; verb: string; href: string; version: string | null; current: string | null }> = [
    { label: t('Terms of use'), verb: t('accepted'), href: '/demo-terms', version: acc?.termsVersion ?? null, current: legal?.termsVersion || null },
    { label: t('Privacy notice'), verb: t('read'), href: '/privacy', version: acc?.privacyVersion ?? null, current: legal?.privacyVersion || null },
  ];
  return (
    <Card spotlight>
      <SectionTitle>
        <span className="inline-flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" strokeWidth={1.5} /> {t('Your signatures')}
        </span>
      </SectionTitle>
      <p className="mt-1 text-xs text-ink/45">
        {t('What you accepted and read, with the version and the date. The texts are public pages; if one changes materially you will be asked to read and sign it again.')}
      </p>
      {recordUnreadable ? (
        <p className="mt-3 text-[12px] leading-relaxed text-ink/60">{unreadableBody}</p>
      ) : legal?.required ? (
        <p className="mt-3 text-[12px] leading-relaxed text-tone-warning/90">
          {t('Pending — the dashboard will ask you to read and sign before continuing.')}
        </p>
      ) : null}
      <div className="mt-3 divide-y divide-ink/5">
        {rows.map((r) => {
          const upToDate = !!r.version && !!r.current && r.version === r.current;
          return (
            <div key={r.href} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
              <div className="min-w-0">
                <div className="text-sm text-ink/90">{r.label}</div>
                <div className="mt-0.5 font-mono text-[11px] text-ink/45">
                  {r.version
                    ? `${r.verb} · ${t('version')} ${r.version}${when ? ` · ${when}` : ''}`
                    : recordUnreadable
                      ? unreadableTitle
                      : t('not signed yet')}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {r.version ? (
                  <Pill tone={upToDate ? 'success' : 'warning'}>
                    {upToDate ? t('up to date') : t('newer version pending')}
                  </Pill>
                ) : null}
                <Link
                  href={r.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-volt hover:underline"
                >
                  {t('Read it again')} <ChevronRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function RegionSettings() {
  const { t } = useT();
  // En la lámina, la consola de diales cede el sitio al registro reglado: la
  // jurisdicción es un asiento, no un dial. (La firma que se escribe sola de
  // la promesa se queda en los dos temas: en bronce ES una rúbrica.)
  const engraved = useEngraved();
  const [region, setRegion] = useState<string | null>(null);
  const [otherMode, setOtherMode] = useState(false);
  const [otherInput, setOtherInput] = useState('');
  const [otherError, setOtherError] = useState<string | null>(null);

  useEffect(() => {
    const stored = getUserRegion();
    setRegion(stored);
    if (stored && !COMMON_REGIONS.includes(stored)) {
      setOtherMode(true);
      setOtherInput(stored);
    }
  }, []);

  const selectValue = otherMode ? OTHER_VALUE : region && COMMON_REGIONS.includes(region) ? region : NONE_VALUE;

  const onSelect = (value: string) => {
    if (value === OTHER_VALUE) {
      setOtherMode(true);
      setOtherError(null);
      return;
    }
    setOtherMode(false);
    setOtherError(null);
    setOtherInput('');
    const next = value === NONE_VALUE ? null : value;
    setUserRegion(next);
    setRegion(next);
  };

  const onOtherChange = (raw: string) => {
    const cleaned = raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
    setOtherInput(cleaned);
    const valid = /^[A-Z]{2,3}$/.test(cleaned);
    setOtherError(cleaned.length === 0 || valid ? null : t('2–3 letters, A–Z — e.g. CH, MX.'));
    setUserRegion(valid ? cleaned : null);
    setRegion(valid ? cleaned : null);
  };

  const onClear = () => {
    setUserRegion(null);
    setRegion(null);
    setOtherMode(false);
    setOtherInput('');
    setOtherError(null);
  };

  return (
    <Card spotlight className="group relative overflow-hidden border-volt/10">
      {/* the tuning console — the jurisdiction dial. Decorative, pointer-events
          -none, tucked in the top-right corner so it never covers the select. */}
      <div className="pointer-events-none absolute -right-4 -top-6 hidden md:block opacity-[0.22] group-hover:opacity-40 transition-opacity duration-700 z-0">
        {engraved ? <RegisterMark size={132} /> : <ConsoleDials size={132} />}
      </div>

      <div className="relative z-[1]">
        <SectionTitle>
          <span className="inline-flex items-center gap-2">
            <Globe className="w-4 h-4" strokeWidth={1.5} /> {t('Region')}
          </span>
        </SectionTitle>

        <p className="text-xs text-ink/50 leading-relaxed mb-4 max-w-2xl">
          {t(
            'Used only to check whether the in-app DeFi execution module is available in your jurisdiction. Monitoring, portfolio tracking and tax stay on everywhere, regardless of this setting. Astryum never guesses this from your language or location — you choose it.'
          )}
        </p>

        <div className="flex flex-wrap items-center gap-3 mb-1">
          <select
            value={selectValue}
            onChange={(e) => onSelect(e.target.value)}
            className="bg-surface-2 border border-ink/10 rounded-lg px-3 py-2 text-sm text-ink/90 cursor-pointer focus:outline-none focus:border-volt/40 transition-colors"
          >
            <option value={NONE_VALUE}>{t('Not set')}</option>
            {COMMON_REGIONS.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
            <option value={OTHER_VALUE}>{t('Other…')}</option>
          </select>

          {otherMode && (
            <Reveal>
              <input
                type="text"
                value={otherInput}
                onChange={(e) => onOtherChange(e.target.value)}
                placeholder={t('e.g. CH, MX')}
                maxLength={3}
                className="w-24 bg-surface-2 border border-ink/10 rounded-lg px-3 py-2 text-sm font-mono uppercase text-ink/90 focus:outline-none focus:border-volt/40 transition-colors"
              />
            </Reveal>
          )}

          {region && (
            <button
              type="button"
              onClick={onClear}
              className="text-xs text-ink/40 hover:text-ink/80 transition-colors"
            >
              {t('Clear')}
            </button>
          )}
        </div>

        {otherError && <div className="mt-2 text-xs text-tone-warning">{otherError}</div>}

        {/* Current region as a calm reading — success when set, warning when not.
            The tone carries the state; never flattened to gold (invariant #5). */}
        <div className="mt-5 flex items-center gap-2.5">
          <MicroLabel>{t('Current region')}</MicroLabel>
          {region ? (
            <Pill tone="success">
              <span className="font-mono">{region}</span>
            </Pill>
          ) : (
            <Pill tone="warning">{t('Not set')}</Pill>
          )}
        </div>
      </div>
    </Card>
  );
}
