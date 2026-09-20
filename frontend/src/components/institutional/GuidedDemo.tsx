'use client';

/**
 * GuidedDemo — el recorrido de 11 pasos para el vídeo: cada paso con su
 * explicación, el CÓDIGO del contrato visible donde toca (qué permite y qué no
 * al exchange y al user), y los componentes que ya funcionan. Muestra que es
 * real: se lee el código, se hace la acción, se comprueba en el explorador.
 */

import { type ReactNode } from 'react';
import { useT } from '../../i18n/LanguageProvider';
import { ContractCodeCard } from './ContractCodeCard';
import { PoteBirthCard } from './PoteBirthCard';
import { CouncilAnchorCard } from './CouncilAnchorCard';
import { XrpFundCard } from './XrpFundCard';
import { OperatorConsole } from './OperatorConsole';
import { PasskeyGate } from './user/PasskeyGate';
import { UserVaultPanel } from './user/UserVaultPanel';
import { useCatalogPolicies } from '../../lib/institutional/useCatalogPolicies';

function Step({ n, title, side, children }: { n: number; title: string; side: 'exchange' | 'user' | 'both'; children: ReactNode }) {
  const { t } = useT();
  const color = side === 'exchange' ? 'var(--authority, #A76A15)' : side === 'user' ? 'var(--muscle, #1F6F70)' : 'var(--ink)';
  const label = side === 'exchange' ? t('Exchange') : side === 'user' ? t('User') : t('Both');
  return (
    <section className="relative pl-10">
      <div
        className="absolute left-0 top-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
        style={{ background: color }}
      >
        {n}
      </div>
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <span className="text-[10px] font-mono uppercase" style={{ color }}>{label}</span>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function GuidedDemo() {
  const { t } = useT();
  const { policies } = useCatalogPolicies();
  const firstPolicy = policies[0];

  return (
    <div className="space-y-8">
      <p className="text-xs text-ink/50">
        {t('The whole circuit, in order. Read the code at each step to see what can and cannot be done — then do it, and check it on the explorer. Nothing here is faked: the contracts are live on Flare.')}
      </p>

      <Step n={1} title={t('The exchange connects its XRPL wallet')} side="exchange">
        <p className="text-xs text-ink/60">
          {t('The exchange operates through its XRPL council wallet (a multisig quorum). That wallet — and only it — will command the vaults it creates. It connects once.')}
        </p>
      </Step>

      <Step n={2} title={t('The contracts, and what each one permits — and does NOT')} side="both">
        <p className="text-xs text-ink/60">
          {t('These are the live contracts. The rules are enforced by the code, not by us — read them: this is what makes the guarantee true instead of a promise.')}
        </p>
        <ContractCodeCard contractKey="vault" defaultOpen />
        <ContractCodeCard contractKey="bridge" />
        <ContractCodeCard contractKey="registry" />
        <ContractCodeCard contractKey="passkey" />
      </Step>

      <Step n={3} title={t('The exchange creates its vault')} side="exchange">
        <p className="text-xs text-ink/60">
          {t('First the council anchors its constitution on XRPL (DIDSet) — the rules precede the code. Then one signature mints the genesis and deploys the vault. It obeys only this exchange, forever (bridge binding). Repeatable: another council address births another vault.')}
        </p>
        <CouncilAnchorCard />
        <PoteBirthCard />
      </Step>

      <Step n={4} title={t('The user\'s on-chain account: a Flare passkey (their XRP stays in the exchange)')} side="user">
        <p className="text-xs text-ink/60">
          {t('The user sets up a passkey (Face ID) — this is their ON-CHAIN account, where their SHARES will live, under their sole control. On a computer that offers nowhere to keep the key, open the page on their phone. Their XRP itself stays in the exchange as a tag/memo — off-chain, in the exchange\'s books, like any exchange balance. That is not created here; the exchange assigns it.')}
        </p>
      </Step>

      <Step n={5} title={t('KYC is validated (by the exchange)')} side="exchange">
        <p className="text-xs text-ink/60">
          {t('The exchange runs its own KYC (simulated here) and records it two ways, both real on-chain: an XLS-70 credential on XRPL, and an entry in its ExchangeKycRegistry — the vault\'s on-chain gate. Until the client is approved, the vault refuses their deposit.')}
        </p>
        <ContractCodeCard contractKey="registry" />
      </Step>

      <Step n={6} title={t('The exchange funds the position — IT signs (custodial, mode B)')} side="exchange">
        <p className="text-xs text-ink/60">
          {t('This is the custodial entry: the EXCHANGE takes the user\'s custodied XRP (their tag in the omnibus) and, with ONE signature, mints it to FXRP and deposits it into the pote — with the shares going to the USER\'s passkey account. The user does NOT sign the entry (they already trusted the exchange with their XRP); but the shares are theirs. Set the funding account to the exchange, and the receiver to the user\'s passkey.')}
        </p>
        <XrpFundCard poteAddress={firstPolicy?.poteAddress} />
      </Step>

      <Step n={7} title={t('The shares are the user\'s — a distinct on-chain claim')} side="user">
        <p className="text-xs text-ink/60">
          {t('The exchange put the money in, but the shares landed in the USER\'s passkey account — a distinct ERC-20 claim on the pote, not a line in the exchange\'s books. From here only the user\'s signature can move or redeem them. The money can only work where the allowlist says.')}
        </p>
        <ContractCodeCard contractKey="vault" />
      </Step>

      <Step n={8} title={t('The exchange puts the capital to work (only vault actions)')} side="exchange">
        <p className="text-xs text-ink/60">
          {t('The operator directs the capital across the allowlisted venues — choosing how much in each — with the concentration cap and the buffer floor enforced. This console lets it do ONLY the vault\'s actions; there is no door to extract.')}
        </p>
        {policies.map((p) => (
          <div key={p.key} className="space-y-2">
            <div className="text-xs font-semibold text-ink">{t(p.title)}</div>
            <OperatorConsole policy={p} />
          </div>
        ))}
      </Step>

      <Step n={9} title={t('The user holds shares')} side="user">
        <p className="text-xs text-ink/60">
          {t('The client\'s shares are a direct claim on the pote — theirs, on their own account, not a credit against the exchange. The yield raises their value; only their signature can redeem them.')}
        </p>
      </Step>

      <Step n={10} title={t('The user exits, and sees the money arrive')} side="user">
        <p className="text-xs text-ink/60">
          {t('The client decides to take out — one Face ID. The vault unwinds the venues by itself; the money lands at the exchange\'s custodial address (its AML rails). Immediate for the conservative pote, on a clock for the yield one. Nobody can stop it.')}
        </p>
      </Step>

      <Step n={11} title={t('The user withdraws to their own wallet')} side="user">
        <p className="text-xs text-ink/60">
          {t('From the exchange, the client withdraws to their personal wallet by the exchange\'s normal flow (its own system — simulated in the demo). In the sovereign model they can also send straight out with Face ID.')}
        </p>
      </Step>

      {/* El área de usuario (pasos 4, 6, 7, 9, 10, 11): una sola cuenta passkey
          hace todas las acciones. Se coloca al final para que el presentador la
          maneje mientras narra los pasos. */}
      {firstPolicy && (
        <section className="rounded-2xl border-2 border-dashed border-ink/15 p-4 space-y-2">
          <h3 className="text-sm font-semibold text-ink">{t('User area (Face ID) — steps 4, 6–11')}</h3>
          <PasskeyGate>{(account) => <UserVaultPanel account={account} />}</PasskeyGate>
        </section>
      )}
    </div>
  );
}
