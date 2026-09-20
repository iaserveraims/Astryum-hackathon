'use client';

/**
 * VaultIdentityPane — la pestaña «Identidad» del puente: lo que NO
 * es capital ni reglas — la imagen de la carta, el enlace de captación y la
 * página pública. Antes la imagen colgaba al final de Capital, entre la
 * consola y nada; aquí tiene su sitio y Capital queda para mover dinero.
 */

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Copy, Share2 } from 'lucide-react';
import { Card, GhostButton, MicroLabel } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';
import { VaultImagePicker } from './VaultImagePicker';

/** El enlace de captación: Earn abierto sobre la ficha de este gestor. */
export function vaultReferralLink(account: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/app/asset-production?view=managers&manager=${encodeURIComponent(account)}`;
}

export function useCopyReferral(account: string): { copy: () => void; copied: boolean; fallback: string | null } {
  const [copied, setCopied] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  const copy = () => {
    const url = vaultReferralLink(account);
    if (!navigator.clipboard?.writeText) { setFallback(url); return; }
    navigator.clipboard.writeText(url).then(
      () => { setCopied(true); window.setTimeout(() => setCopied(false), 2500); },
      () => setFallback(url),
    );
  };
  return { copy, copied, fallback };
}

export function VaultIdentityPane({ account, pote }: { account: string; pote: string }) {
  const { t } = useT();
  const { copy, copied, fallback } = useCopyReferral(account);
  return (
    <div className="space-y-4">
      <VaultImagePicker account={account} pote={pote} />
      <Card className="p-5">
        <div className="flex items-center gap-2">
          <Share2 className="h-4 w-4 text-ink/35" strokeWidth={1.8} />
          <MicroLabel>{t('Bring your clients')}</MicroLabel>
        </div>
        <p className="mt-2 max-w-[62ch] text-[12px] leading-relaxed text-ink/55">
          {t('Your vault is listed in Earn like any other. This link opens Earn straight on your card, with your profile — how a manager brings their own clients. Astryum lists; it never recommends.')}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <GhostButton onClick={copy}>
            <Copy className="mr-1.5 inline h-3.5 w-3.5" /> {copied ? t('Link copied') : t('Copy vault link')}
          </GhostButton>
          <Link href={`/app/community?actor=${encodeURIComponent(account)}`} className="inline-flex items-center gap-1 text-[12px] text-volt hover:underline">
            {t('Your public page')} <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
        {fallback ? (
          <div className="mt-2 rounded-lg border border-ink/10 bg-ink/[0.02] p-2">
            <p className="mb-1 text-[10px] text-ink/45">{t('Copying failed here — select the link by hand:')}</p>
            <input readOnly value={fallback} onFocus={(e) => e.currentTarget.select()} className="w-full bg-transparent font-mono text-[11px] text-ink/70 outline-none" />
          </div>
        ) : null}
      </Card>
    </div>
  );
}

export default VaultIdentityPane;
