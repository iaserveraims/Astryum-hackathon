'use client';

/**
 * /app/admin/demo-exchange — the Demo Exchange v2 (BuildSpec 2026-08-26): the
 * complete demo UI built BESIDE /app/admin/institutional, importing its pieces
 * and touching none of them.
 *
 *  · Exchange = the operator desk: council, pote, clients + tags, omnibus,
 *    put capital to work, direct it (one authority: the council XRPL account),
 *    the DENIED moment, pay a client out.
 *  · User = the client of the exchange: Face ID once, deposit with a tag,
 *    position, exit with ONE signature (to their slot or to their own wallet).
 *  · Behind the curtain = the infrastructure lit by the run's receipts.
 *  · Evidence = the receipt book, read from the chain, exportable.
 *  · Runs = one take = one council account + one pote; repeatable.
 *
 * Hidden page (no nav). Gated by NEXT_PUBLIC_INSTITUTIONAL_ENABLED AND by the
 * server verdict isAdmin (PreviewOnly, fail-closed). The exchange system here
 * is SIMULATED and labelled so; everything that touches capital is real.
 */

import { PreviewOnly } from '../../../../components/ui/PreviewOnly';
import { DemoExchangeShell } from '../../../../components/demo-exchange/DemoExchangeShell';
import { useT } from '../../../../i18n/LanguageProvider';

const ENABLED = process.env.NEXT_PUBLIC_INSTITUTIONAL_ENABLED === 'true';

export default function DemoExchangePage() {
  const { t } = useT();
  if (!ENABLED) {
    return (
      <div className="p-6">
        <p className="text-sm text-ink/60">{t('The institutional module is not enabled on this environment.')}</p>
      </div>
    );
  }
  return (
    <PreviewOnly label="Demo Exchange v2" pending="rodaje 21-sep">
      <DemoExchangeShell />
    </PreviewOnly>
  );
}
