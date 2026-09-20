import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extract } from '../../legacy/__tests__/extractFromSource';
import { describeUnreadableRows, serverRefusalText } from '../../../lib/errors/serverRefusal';

/**
 * prosa-y-lectores — «no pude leer» pintado como «no tienes nada».
 *
 * The sidebar tray reads the active council's live proposals and its catch was
 * a comment: "the tray degrades to empty; the Legacy tab is the source of
 * truth". Empty is not a degradation, it is a STATEMENT — the card then prints
 * "Nothing waiting for your signature", which is a verdict about a family's
 * decisions, over a read that never happened.
 *
 * The round-4 permission floor makes that routine rather than rare:
 * `GET /council/proposals` answers 403 NOT_A_COUNCIL_MEMBER to any session with
 * no REGISTERED wallet on the account's signer list — an XRP-Identity login
 * whose Xaman was never registered earns it on its own Legacy. The tray then
 * told that councillor, on every paint, that there was nothing to decide, while
 * a proposal counted down its seven days and the seat it pinned went unsettled.
 *
 * `mayClaimNothingWaiting` is that decision, pulled out so it can be RUN.
 */

const CARD = join(__dirname, '..', 'SidebarIntents.tsx');
const cardSrc = readFileSync(CARD, 'utf8');

// it. 31 — the guard grew a third eye (the claim queue); the two-argument
// calls below still hold, the default keeps them meaningful.
const mayClaimNothingWaiting = extract<
  (hasAnything: boolean, councilUnreadable: boolean, claimsUnreadable?: boolean) => boolean
>(
  cardSrc,
  'function mayClaimNothingWaiting(hasAnything: boolean, councilUnreadable: boolean, claimsUnreadable = false): boolean {',
  'function mayClaimNothingWaiting(hasAnything, councilUnreadable, claimsUnreadable = false) {',
  'mayClaimNothingWaiting',
);

const t = (s: string) => s;

/** Exactly what `jget` throws for a non-ok response. */
function httpError(status: number, body: unknown): Error {
  const b = body as { error?: string } | null;
  return Object.assign(new Error(b?.error ?? `http_${status}`), { status, body });
}

describe('prosa-y-lectores — the tray never says "nothing" about an unread council', () => {
  it('says it when the tray really is empty AND was read', () => {
    expect(mayClaimNothingWaiting(false, false)).toBe(true);
  });

  it('REFUSES to say it when the council read failed — the old code said it anyway', () => {
    // The old condition was `!hasAnything` alone, which is `true` here.
    expect(mayClaimNothingWaiting(false, true)).toBe(false);
  });

  it('never says it while something is on screen', () => {
    expect(mayClaimNothingWaiting(true, false)).toBe(false);
    expect(mayClaimNothingWaiting(true, true)).toBe(false);
  });
});

describe('prosa-y-lectores — what the tray says instead', () => {
  it('turns the listing 403 into the family’s own sentence, not the slug', () => {
    const refusal = httpError(403, {
      error: 'NOT_A_COUNCIL_MEMBER',
      detail:
        'These proposals belong to a council you are not a member of. The inbox of a council is readable by its ' +
        'signer list and by whoever composed each proposal.',
    });
    const said = serverRefusalText(refusal, t);
    expect(said).not.toBe('NOT_A_COUNCIL_MEMBER');
    expect(said).toContain('signer list');
    // And it is never a claim about the council's workload.
    expect(said).not.toMatch(/nothing waiting/i);
    expect(mayClaimNothingWaiting(false, !!said)).toBe(false);
  });

  it('a detail-less refusal still reads as a sentence with the cure in it', () => {
    const said = serverRefusalText(httpError(403, { error: 'NOT_A_COUNCIL_MEMBER' }), t);
    expect(said).toContain('registered');
    expect(said).not.toContain('NOT_A_COUNCIL_MEMBER');
  });

  it('a session that simply expired is named as that, not as an empty council', () => {
    const said = serverRefusalText(httpError(401, { error: 'missing_siwe_session' }), t);
    expect(said).toContain('session expired');
    expect(mayClaimNothingWaiting(false, !!said)).toBe(false);
  });
});

/**
 * productizer it. 25 (1) — UN 200 QUE TRAE FILAS ILEGIBLES BORRABA EL AVISO.
 *
 * it. 23 hizo que la fila que el servidor no pudo decidir viajase NOMBRADA en
 * `unreadable[]` DENTRO del 200, con su código y su frase. El `then` del éxito de
 * esta bandeja hacía `setUnreadable(null)` a secas: tiraba esas filas y, de paso,
 * apagaba cualquier advertencia que hubiera puesta. La tarjeta volvía a decir «nada
 * te espera» sobre una lectura incompleta — el fallo exacto que este fichero existe
 * para no repetir, un piso más arriba.
 *
 * `councilTrayUnreadable` es esa decisión, sacada para poder EJECUTARLA, con el
 * lector real inyectado: un sitio de llamada que dejase de delegar revienta aquí.
 */
const councilTrayUnreadable = extract<
  (landed: { unreadable?: unknown } | null, t: (s: string) => string) => { text: string; partial: boolean } | null
>(
  cardSrc,
  'function councilTrayUnreadable(landed: { unreadable?: unknown } | null, t: (s: string) => string): CouncilUnreadableNotice | null {',
  'function councilTrayUnreadable(landed, t) {',
  'councilTrayUnreadable',
  { describeUnreadableRows },
);

describe('it. 25 — la fila que no se pudo leer SE PINTA, y no borra el aviso anterior', () => {
  const unreadableRow = {
    id: 'p2',
    account: 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf',
    error: 'PROOF_STORE_UNREADABLE',
    retryable: true,
    detail: 'We could not read your wallet proofs just now. Try again in a moment.',
  };

  it('un 200 CON filas ilegibles deja un aviso — el código viejo lo ponía a null', () => {
    const notice = councilTrayUnreadable({ unreadable: [unreadableRow] }, t);
    expect(notice).not.toBeNull();
    expect(notice!.text).toContain('could not be read');
    expect(notice!.text).toContain('(PROOF_STORE_UNREADABLE)');
    // Y con un aviso puesto, la zona NO puede decir «nada te espera».
    expect(mayClaimNothingWaiting(false, !!notice)).toBe(false);
  });

  it('marca que la lectura fue PARCIAL: la cabecera «no se pudieron leer» no le pega', () => {
    expect(councilTrayUnreadable({ unreadable: [unreadableRow] }, t)!.partial).toBe(true);
  });

  it('solo una lectura COMPLETA apaga el aviso', () => {
    expect(councilTrayUnreadable({ unreadable: [] }, t)).toBeNull();
    expect(councilTrayUnreadable({}, t)).toBeNull();
    expect(councilTrayUnreadable(null, t)).toBeNull();
  });

  it('la frase jamás es el código crudo, ni una afirmación sobre la persona', () => {
    const said = councilTrayUnreadable({ unreadable: [unreadableRow] }, t)!.text;
    expect(said).not.toBe('PROOF_STORE_UNREADABLE');
    expect(said).not.toMatch(/you are not a member/i);
    expect(said).not.toMatch(/nothing waiting/i);
  });
});
