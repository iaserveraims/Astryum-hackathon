'use client';

/**
 * useExchangeScript — el GUION del rodaje, en el orden del runbook
 * (Astryum_Demo_Exchange_v2_Runbook §3 y readiness §F): qué se hace, quién
 * firma, qué hay que tener listo y qué se lee de la cadena para dar el paso
 * por hecho. Es la fuente única del tour, del raíl de estaciones y del «?».
 *
 * «HECHO» SE DETECTA, NUNCA SE MARCA: cada paso trae un `done(run, chain)` que
 * mira recibos, direcciones y hechos leídos — el guion jamás inventa un check
 * (misma regla que StationProgress y el wizard del gestor).
 */

import { useMemo } from 'react';
import { useT } from '../../../i18n/LanguageProvider';
import type { DemoRun, ReceiptStep } from '../../../lib/demo-exchange/api';
import type { ChainFacts } from '../../../lib/demo-exchange/useDemoRun';
import { AUTOPILOT_UI } from '../../../lib/demo-exchange/autopilotVisibility';

export type StageTab = 'exchange' | 'user' | 'curtain' | 'evidence' | 'runs';
export type StepSide = 'exchange' | 'user' | 'cage' | 'proof';

/** Comprobaciones VIVAS que el panel del tour puede resolver por sí mismo. */
export type ReadyCheck = 'run' | 'xaman-council' | 'xaman-omnibus' | 'evm' | 'pote' | 'clients' | 'client-account' | 'registry' | 'anchored';

export interface ReadyItem {
  label: string;
  check?: ReadyCheck;
}

export interface ScriptStep {
  id: string;
  tab: StageTab;
  /** La estación del desk (E0…E8, AUTO) o del cliente (U0…U5) que se enseña. */
  station?: string;
  side: StepSide;
  title: string;
  lede: string;
  /** Quién firma y dónde — en una línea. Vacío = no se firma nada. */
  signs?: string;
  ready: ReadyItem[];
  /** La explicación entera, detrás del «?». */
  learn: string[];
  /** Paso opcional del guion (no bloquea el «todo hecho»). */
  optional?: boolean;
  done: (run: DemoRun | null, chain: ChainFacts | null) => boolean;
}

/**
 * «Poner a trabajar el XRP del cliente» DESDE LA MESA (E5), apagado (fundador
 * 14-sep: «si el cliente ya pone él mismo su XRP a trabajar, no hace falta»).
 *
 * El motivo de fondo no es solo de interfaz: E5 dejaba al OPERADOR elegir un
 * cliente y un importe y meter su dinero en el pote sin que el cliente lo
 * pidiera — el exchange decidiendo sobre capital ajeno. El camino del producto
 * es el otro: el cliente lo pide (U2) y el autopilot ejecuta SU petición.
 *
 * Inerte, no borrado (regla del repo): con `true` vuelven la estación, su paso
 * del tour y su bloque en la mesa. La ruta del backend sigue tras requireAdmin.
 */
export const DESK_PUT_TO_WORK_UI = false;

/** Las estaciones del desk, en su orden — el raíl del tab Exchange. */
export const EXCHANGE_STATIONS: readonly string[] = ['E0', 'E1', 'E2', 'E3', 'E4', 'AUTO', ...(DESK_PUT_TO_WORK_UI ? ['E5'] : []), 'E6', 'E8'];

function has(run: DemoRun | null, step: ReceiptStep): boolean {
  return Boolean(run?.receipts.some((r) => r.step === step));
}

export function useExchangeScript(): ScriptStep[] {
  const { t } = useT();
  return useMemo<ScriptStep[]>(
    () => [
      {
        id: 'run',
        tab: 'runs',
        side: 'exchange',
        title: t('Open a take'),
        lede: t('One take = one council account, one omnibus account and one policy. Everything you do next hangs from it — and it stays listed with its receipts.'),
        ready: [
          { label: t('The council XRPL account (r…) — the exchange authority, in Xaman') },
          { label: t('The omnibus XRPL account (r…) — where clients deposit with a tag') },
        ],
        learn: [
          t('A take is one recording of the whole circuit. A council account births exactly one cage on the factory, so a new take means a new council account; the omnibus can be reused.'),
          t('Policy A opens a pote with immediate exit; policy B a pote with a 72-hour cooldown. Client tags are derived from the take number, so two takes on the same omnibus never collide.'),
          t('Passkeys are bound to the domain they were created on: record every take from the same URL.'),
        ],
        done: (run) => Boolean(run),
      },
      {
        id: 'E0',
        tab: 'exchange',
        station: 'E0',
        side: 'exchange',
        title: t('Meet the authority'),
        lede: t('One XRPL account commands everything: it anchors the rules, births the cage and signs every order. Read the contracts here — what they permit and what they refuse is the product.'),
        ready: [{ label: t('A take is open'), check: 'run' }],
        // Una LECTURA: hecha cuando los hechos de la cadena de esta toma se han
        // leído (12-sep: antes se ponía verde solo por existir la toma).
        learn: [
          t('The council is the exchange itself, as a signer: nothing moves capital without its signature in Xaman. Astryum only composes what it signs and never holds a key.'),
          t('The contracts on the page are live on Flare. The vault has no function to extract the principal; the bridge only executes orders proven by the FDC; the passkey factory gives each client an account of their own.'),
        ],
        done: (_run, chain) => Boolean(chain),
      },
      {
        id: 'E1',
        tab: 'exchange',
        station: 'E1',
        side: 'exchange',
        title: t('Anchor the constitution'),
        lede: t('Paste the governance text. Only its SHA-256 goes on the ledger, as a DIDSet signed by the council. The rules precede the code.'),
        signs: t('The council, in Xaman (DIDSet)'),
        ready: [
          { label: t('Xaman connected as the council account'), check: 'xaman-council' },
          { label: t('The constitution text, or its SHA-256') },
        ],
        learn: [
          t('The text itself never travels: the hash is computed in your browser and anchored on XRPL. Anyone can later verify that a document matches the anchored fingerprint.'),
          t('Without the anchor the cage cannot be born — the backend refuses with CONSTITUTION_NOT_ANCHORED. The receipt is E1_ANCHOR, verified by reading the DID object of the council.'),
        ],
        done: (_run, chain) => Boolean(chain?.council.didAnchored),
      },
      {
        id: 'E2',
        tab: 'exchange',
        station: 'E2',
        side: 'exchange',
        title: t('Birth the cage, then open the pote'),
        lede: t('Two acts on one button: first the cage is born from a single 0xFE signature of the council; then a council order opens the pote inside it, with the venues Astryum has allowlisted.'),
        signs: t('The council, in Xaman — twice (0xFE, then a council order)'),
        ready: [
          { label: t('The constitution is anchored'), check: 'anchored' },
          { label: t('Xaman connected as the council account'), check: 'xaman-council' },
          { label: t('Genesis XRP on the council account (the operator\'s own capital)') },
        ],
        learn: [
          t('The cage is a Flare contract that obeys this council forever. It custodies nothing: the genesis XRP is fuel for the birth, and its shares stay with the council.'),
          t('The pote opens by council order: XRPL payment with a memo → FDC proof → the bridge executes createPote. The relayer pays the proof; it cannot decide anything. Expect 2–5 minutes; the pote appears on its own.'),
          t('This take runs XRPL-only: identity lives in XLS-70 credentials on XRPL, and the exit carries the client\'s exchange tag. A tenant that wants the gate written into the contract too can point the pote at an on-chain registry later, with one council order.'),
        ],
        done: (run) => Boolean(run?.poteAddress),
      },
      {
        id: 'E3',
        tab: 'exchange',
        station: 'E3',
        side: 'exchange',
        title: t('Your first client'),
        lede: t('The client opens your client site, creates their account with Face ID and appears on the desk with their deposit tag — you enrol nobody. Creating one by hand is there for an invite or a demo. KYC is the exchange\'s own business.'),
        signs: t('Nobody extra: the exchange assigns the tag in its own books; identity is XLS-70 on XRPL'),
        ready: [
          { label: t('The pote is born'), check: 'pote' },
        ],
        learn: [
          t('The tag is what the omnibus watcher uses to credit a deposit to the right client — like any exchange. It lives in the exchange\'s books; the client\'s identity is the XLS-70 credential on XRPL.'),
          t('The XLS-70 credential ceremony is the on-ledger version of KYC: an issuer signs, the client accepts in Xaman. It leaves the E3_CREDENTIAL receipt on its own.'),
        ],
        done: (run) => (run?.clients.length ?? 0) > 0,
      },
      {
        id: 'U0',
        tab: 'user',
        station: 'U0',
        side: 'user',
        title: t('The client sets up Face ID'),
        lede: t('Switch sides. Face ID once creates the client\'s on-chain account on Flare — where their shares will live, in their name. Then they open their exchange account or link the client you created.'),
        signs: t('The client, with Face ID (passkey)'),
        ready: [
          { label: t('A phone with Face ID or a fingerprint — a computer only if it offers somewhere to keep a P-256 key') },
          { label: t('At least one client on the take'), check: 'clients' },
        ],
        learn: [
          t('The passkey account is a smart account on Flare controlled only by the client\'s biometrics. Astryum cannot use it; the relayer only pays its gas.'),
          t('Linking to a client the exchange created attaches this account to that tag. Opening a new one assigns a fresh tag.'),
        ],
        done: (run) => Boolean(run?.clients.some((c) => c.passkeyAccount)),
      },
      {
        id: 'U1',
        tab: 'user',
        station: 'U1',
        side: 'user',
        title: t('The client deposits XRP'),
        lede: t('Ask for deposit instructions: destination, tag and amount. Sign from the connected Xaman or send it from any wallet — the watcher credits it when the ledger validates it.'),
        signs: t('The client, in Xaman (or any XRPL wallet)'),
        ready: [
          { label: t('The client has an on-chain account'), check: 'client-account' },
          { label: t('Some XRP in the client\'s own wallet') },
        ],
        learn: [
          t('The deposit is a normal XRPL payment to the omnibus with a DestinationTag. The exchange ledger mirrors the chain: nothing is credited that the ledger did not validate.'),
          t('For the exit later, leave room: the FAssets floor is 5 FXRP per redemption, so a take should deposit at least ~6 XRP.'),
        ],
        done: (run) => has(run, 'U1_DEPOSIT') || Boolean(run?.clients.some((c) => BigInt(c.xrpOnExchangeDrops || '0') > BigInt(0))),
      },
      {
        id: 'E4',
        tab: 'exchange',
        station: 'E4',
        side: 'exchange',
        title: t('Scan the omnibus'),
        lede: t('Back at the exchange: the watcher reads the omnibus and credits every deposit by tag. Read-only — it signs nothing.'),
        ready: [{ label: t('A client deposit is on the ledger') }],
        learn: [
          t('The watcher lists the omnibus transactions, matches the DestinationTag to a client and credits the simulated ledger. It also recognises returns from FAssets (an exit with tag) and payouts.'),
          t('With autopilot on, this scan runs on its own every 20 seconds.'),
        ],
        done: (run) => has(run, 'U1_DEPOSIT') || Boolean(run?.clients.some((c) => BigInt(c.xrpOnExchangeDrops || '0') > BigInt(0))),
      },
      {
        id: 'AUTO',
        tab: 'exchange',
        station: 'AUTO',
        side: 'exchange',
        // 18-sep: el autopilot fuera de la vista (AUTOPILOT_UI) — la estación sirve
        // las peticiones con el QR del omnibus.
        ...(AUTOPILOT_UI
          ? {
              title: t('The exchange backend (autopilot)'),
              lede: t('What a real exchange already has: a backend with its hot key that fulfils client requests. Turn it on for the take and the deposit → shares path becomes one tap for the client.'),
              optional: true,
              ready: [{ label: t('The omnibus seed on the server (DEMO_EXCHANGE_AUTOSIGN_ENABLED)') }],
              learn: [
                t('The key belongs to the simulated exchange — never to Astryum, never to a client. It refuses by construction: only the Core Vault or a registered client wallet as destination, only its own clients as receivers, a per-payment cap and a daily cap.'),
                t('A signed 0xFE is never re-sent: it stays "signed" until the controller reports it consumed. Refusals are receipts with their reason.'),
              ],
              done: (run: DemoRun | null) => Boolean(run?.autopilot),
            }
          : {
              title: t('Client requests — the omnibus signs each one with a QR'),
              lede: t('Your clients ask to put XRP to work or to withdraw it. Each request is signed by your omnibus with a QR in Xaman, for the amount the client asked — the desk never picks a client or an amount.'),
              optional: true,
              ready: [{ label: t('The omnibus account in your Xaman') }],
              learn: [
                t('The omnibus key never leaves your Xaman: Astryum composes the payment and your omnibus signs it. Nothing moves until you sign it.'),
                t('A signed 0xFE is never re-sent: it stays "signed" until the controller reports it consumed. Refusals are receipts with their reason.'),
              ],
              done: (run: DemoRun | null) => Boolean(run?.deskPayments?.some((p) => p.status === 'settled')),
            }),
      },
      // Fuera del tour con DESK_PUT_TO_WORK_UI apagado: un paso sin estación
      // visible haría aterrizar el tour en una pantalla vacía.
      ...(DESK_PUT_TO_WORK_UI ? [{
        id: 'E5',
        tab: 'exchange',
        station: 'E5',
        side: 'exchange',
        title: t('Put the client\'s XRP to work'),
        lede: t('The exchange signs from its omnibus; the shares are minted to the client\'s account from the first block. The client signs nothing. Expect 2–5 minutes for the mint.'),
        signs: t('The omnibus, in Xaman (0xFE with a 42-byte memo)'),
        ready: [
          { label: t('Xaman connected as the omnibus account'), check: 'xaman-omnibus' },
          { label: t('The client has an on-chain account and XRP at the exchange'), check: 'client-account' },
          { label: t('The pote is born'), check: 'pote' },
        ],
        learn: [
          t('Mode B, custodial: the omnibus pays the FAssets Core Vault with a 0xFE memo; the executor mints FXRP and deposits into the pote naming the client account as receiver. The ledger debits the client.'),
          t('The receipt is E5_PUT_TO_WORK; the client sees the shares in their position when the mint lands.'),
        ],
        done: (run: DemoRun | null) => has(run, 'E5_PUT_TO_WORK'),
      } satisfies ScriptStep] : []),
      {
        id: 'E6',
        tab: 'exchange',
        station: 'E6',
        side: 'exchange',
        title: t('Direct the capital'),
        lede: t('Send capital to a listed venue, or recall it to the buffer, by council order: XRPL → FDC → bridge. The council governs; the venues are the allowlist.'),
        signs: t('The council, in Xaman (a council order)'),
        ready: [
          { label: t('Xaman connected as the council account'), check: 'xaman-council' },
          { label: t('Capital inside the pote (E5 landed)') },
        ],
        learn: [
          t('A council order is an XRPL payment with a memo the bridge understands. The FDC attests it; the relayer pays the proof and calls the bridge; the bridge checks the nonce and executes directTo or recall on the cage.'),
          t('The on-chain reading is bridge.consumedTxId — that is what the receipt E6_ORDER is verified against. Expect 2–5 minutes.'),
        ],
        done: (run) => Boolean(run?.receipts.some((r) => r.step === 'E6_ORDER' && (r.expect?.action === 'direct-to' || r.expect?.action === 'recall'))),
      },
      {
        id: 'E7',
        tab: 'exchange',
        station: 'E6',
        side: 'cage',
        title: t('Make the cage say no'),
        lede: t('Now break the rules on purpose: more than the cap, below the buffer floor, or an unlisted venue. The cage refuses before anyone signs — and the refusal is the proof.'),
        ready: [{ label: t('Any amount above the cap, or a venue id that is not listed') }],
        learn: [
          t('There is no other door: the mandate only moves capital between listed venues, above the buffer floor, under the cap. The refusal is recorded as E7_DENIED with its reason — a receipt without a transaction.'),
          t('This is the moment the demo exists for: the robbery is impossible by bytecode, not by trust.'),
        ],
        done: (run) => has(run, 'E7_DENIED'),
      },
      {
        id: 'U4',
        tab: 'user',
        station: 'U4',
        side: 'user',
        title: t('The client leaves with one Face ID'),
        lede: t('Switch sides again. One signature redeems the shares and sends the XRP back — to their slot at the exchange with their tag, to their own wallet, or kept as FXRP. Nobody can stop it.'),
        signs: t('The client, with Face ID (one batch)'),
        ready: [
          { label: t('Shares in the client\'s account (E5 landed)'), check: 'client-account' },
          { label: t('At least ~6 XRP of value inside (FAssets floor: 5 FXRP)') },
        ],
        learn: [
          t('To the exchange = redeem + redeemWithTag in ONE signature, tagged with the client\'s exchange tag so the return credits them. To their wallet = redeem + unmint. On a cooldown pote (policy B) the shares burn now and the amount is claimed when the clock ends.'),
          t('The relayer pays gas and cannot decide. The receipt is U4_EXIT or U4_EXIT_XRP, verified on Flare; the return with tag shows up on the omnibus scan.'),
        ],
        done: (run) => has(run, 'U4_EXIT') || has(run, 'U4_EXIT_XRP'),
      },
      {
        id: 'E8',
        tab: 'exchange',
        station: 'E8',
        side: 'exchange',
        title: t('Pay the client out'),
        lede: t('The exchange\'s normal withdrawal rail: a real XRPL payment from the omnibus to the client\'s own wallet, refused by the ledger if it cannot cover it.'),
        signs: t('The omnibus, in Xaman (an XRPL payment)'),
        ready: [
          { label: t('Xaman connected as the omnibus account'), check: 'xaman-omnibus' },
          { label: t('The client has an XRPL wallet on file') },
        ],
        learn: [
          t('The client can request the withdrawal from their side; with autopilot on, the backend pays it on its next tick. The watcher records the payout as E8_WITHDRAW when the payment validates.'),
        ],
        done: (run) => has(run, 'E8_WITHDRAW'),
      },
      {
        id: 'proof',
        tab: 'evidence',
        side: 'proof',
        title: t('Read every receipt from the chain'),
        lede: t('Each receipt is a hash and a promise. Reading the chain measures the promise — then export the proof document.'),
        ready: [{ label: t('Receipts on the take') }],
        learn: [
          t('The backend never marks anything done by itself: every check is read from XRPL or Flare on demand. A failed check says why. The proof document is the same book, as markdown.'),
        ],
        done: (run) => Boolean(run && run.receipts.length > 0 && run.receipts.every((r) => r.checks.length > 0)),
      },
    ],
    [t],
  );
}
