'use client';

/**
 * ManagedVaultNotice — el aviso que no se cierra.
 *
 */

import { UserRound } from 'lucide-react';

import { useT } from '../../i18n/LanguageProvider';

export function ManagedVaultNotice({ className = '' }: { className?: string }) {
  const { t } = useT();
  return (
    <div
      role="note"
      className={`flex items-start gap-3 rounded-xl border border-tone-warning/30 bg-tone-warning/[0.07] p-4 ${className}`}
    >
      <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-tone-warning" strokeWidth={1.8} />
      <p className="max-w-[70ch] text-[13px] leading-relaxed text-ink/70">
        <span className="font-semibold text-ink/85">{t('This is not an ordinary vault.')}</span>{' '}
        {t('A person decides what happens to the capital inside it, day to day. The contract keeps them within the vault’s rules, but it cannot make their decisions good ones — you can lose money without anybody breaking a rule.')}
      </p>
    </div>
  );
}

export default ManagedVaultNotice;
