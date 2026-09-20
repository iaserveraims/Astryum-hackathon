'use client';

/**
 * VaultImagePicker — la imagen de TU bóveda (fundador 8-sep): un emblema de la
 * casa («una imagen tonta», como las de las bóvedas de demostración), tu foto
 * de perfil, o ninguna — el interrogante. Lo que elijas es lo que verá el
 * cliente en la carta de Earn, y se enseña aquí mismo al tamaño de la carta.
 *
 * Solo el dueño PROBADO del consejo puede escribirla (el backend lo exige), y
 * el catálogo solo la aplica si el consejo del pote coincide con esa cuenta.
 */

import { useState } from 'react';
import { Check, HelpCircle, ImageIcon, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { Card, MicroLabel } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';
import { saveVaultImage, type VaultImageKind } from '../../lib/institutional/api';
import { patchVaultImage, useCommunity } from '../../lib/institutional/useCommunity';
import { refusalText } from '../../lib/institutional/format';
import { VAULT_EMBLEMS, VaultEmblemIcon } from '../../lib/institutional/vaultEmblems';
import { ManagerAvatar, withProfile, managerOf } from './managerIdentity';
import { VaultTile } from './VaultTile';

export function VaultImagePicker({ account, pote }: { account: string; pote: string }) {
  const { t } = useT();
  const { actors, images } = useCommunity();
  const current = images.get(pote.toLowerCase());
  const mine = current && current.account === account ? current : null;
  const who = withProfile(managerOf({ pote, councilXrplAddress: account }), actors.get(account));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function pick(kind: VaultImageKind, emblem?: string) {
    const key = kind === 'emblem' ? `emblem:${emblem}` : kind;
    setBusy(key);
    setError('');
    try {
      const res = await saveVaultImage({ account, pote, kind, emblem });
      if (!res.ok) { setError(refusalText(res.refusal)); return; }
      // En sitio: la carta cambia al instante, sin re-descargar la comunidad.
      patchVaultImage({ pote: res.data.pote, account, kind: res.data.kind, emblem: res.data.emblem });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const isOn = (kind: VaultImageKind, emblem?: string) =>
    !!mine && mine.kind === kind && (kind !== 'emblem' || mine.emblem === emblem);

  const optionCls = (on: boolean) =>
    `relative grid h-12 w-12 place-items-center rounded-xl border transition-colors ${on ? 'border-volt/60 bg-volt/[0.08]' : 'border-ink/10 hover:border-ink/30'}`;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4 text-ink/35" strokeWidth={1.8} />
          <MicroLabel>{t('Vault image')}</MicroLabel>
        </div>
        {/* Cómo queda en la carta: el mismo tile que pinta Earn. */}
        <span className="inline-flex items-center gap-2 text-[11px] text-ink/45">
          {t('On the card')}
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-ink/15">
            <VaultTile entry={{ pote, councilXrplAddress: account }} manager={managerOf({ pote, councilXrplAddress: account })} size={22} />
          </span>
        </span>
      </div>
      <p className="mt-2 max-w-[62ch] text-[12px] leading-relaxed text-ink/50">
        {t('Pick an emblem, use your profile photo, or leave it without one — clients see it on the card in Earn. Without a choice, the card shows your profile photo or your account mark.')}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {VAULT_EMBLEMS.map((e) => {
          const on = isOn('emblem', e.key);
          const loading = busy === `emblem:${e.key}`;
          return (
            <button key={e.key} type="button" onClick={() => void pick('emblem', e.key)} disabled={busy !== null} aria-pressed={on} title={e.key} className={optionCls(on)}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin text-ink/50" /> : <VaultEmblemIcon emblem={e} size={28} />}
              {on ? <Check className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-volt p-0.5 text-volt-ink" strokeWidth={3} /> : null}
            </button>
          );
        })}
        {/* Tu foto de perfil — la del perfil público de esta cuenta. */}
        <button
          type="button"
          onClick={() => void pick('profile')}
          disabled={busy !== null || !who.photo}
          aria-pressed={isOn('profile')}
          title={t('My profile photo')}
          className={`${optionCls(isOn('profile'))} disabled:opacity-40`}
        >
          {busy === 'profile' ? <Loader2 className="h-4 w-4 animate-spin text-ink/50" /> : <ManagerAvatar manager={who} size={28} photo={who.photo} actorKind={who.actorKind} />}
          {isOn('profile') ? <Check className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-volt p-0.5 text-volt-ink" strokeWidth={3} /> : null}
        </button>
        {/* Ninguna: el interrogante, dicho a propósito. */}
        <button type="button" onClick={() => void pick('none')} disabled={busy !== null} aria-pressed={isOn('none')} title={t('No image')} className={optionCls(isOn('none'))}>
          {busy === 'none' ? <Loader2 className="h-4 w-4 animate-spin text-ink/50" /> : <HelpCircle className="h-6 w-6 text-ink/40" strokeWidth={1.6} />}
          {isOn('none') ? <Check className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-volt p-0.5 text-volt-ink" strokeWidth={3} /> : null}
        </button>
      </div>
      {!who.photo ? (
        <p className="mt-2 text-[11px] text-ink/40">
          {t('To use your photo, put one on your public profile first —')}{' '}
          <Link href="/app/manager" className="text-volt hover:underline">{t('station “Public profile”')}</Link>.
        </p>
      ) : null}
      {error ? <p className="mt-2 text-[11px] text-tone-warning">{error}</p> : null}
    </Card>
  );
}

export default VaultImagePicker;
