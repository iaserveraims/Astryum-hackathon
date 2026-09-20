import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { seatContestNotice } from '../CouncilMultisigFlow';

/**
 * productizer it. 19 (R3 N3 / M2) — EL AVISO DEL ASIENTO DISPUTADO SE PINTA.
 *
 * it. 17 cambió un 422 duro por `seatContestWarning` para que una SALIDA no se
 * quedara detrás del payload de otro. it. 18 midió el resultado: `grep
 * seatContestWarning frontend/src` → 0. Nadie lo leía. Un consejo juntaba quórum
 * sobre dos payloads del MISMO Sequence sin enterarse — exactamente la cadena
 * del doble pago que la guarda cortaba. Un aviso sin lector es peor que la
 * negativa que sustituye: parece que se tomó una decisión.
 *
 * Y NO SE PINTA LA PROSA DEL SERVIDOR. Esa frase lleva el TÍTULO de la propuesta
 * rival, que es texto que escribió otro consejo, y la puerta la alcanza quien no
 * tiene pertenencia (it. 18, §2.7). El titular sale de los IDs.
 */

const t = (s: string) => s;
const FRONTEND_SRC = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(FRONTEND_SRC, rel), 'utf8');

describe('seatContestNotice — qué se dice, y con qué', () => {
  it('sin disputa no hay aviso', () => {
    expect(seatContestNotice(null, t)).toBeNull();
    expect(seatContestNotice({}, t)).toBeNull();
    expect(seatContestNotice({ seatContestWarning: '   ' }, t)).toBeNull();
  });

  it('avisa con la prosa sola (backend viejo), sin citarla', () => {
    const n = seatContestNotice(
      { seatContestWarning: 'A proposal on this account (Pago a la abuela) is collecting signatures…' },
      t,
    )!;
    expect(n).not.toBeNull();
    // El título del consejo ajeno jamás llega a la pantalla.
    expect(`${n.headline} ${n.body}`).not.toContain('Pago a la abuela');
  });

  it('con los IDs dice el tipo, el Sequence y la propuesta a resolver', () => {
    const n = seatContestNotice(
      {
        seatContestWarning: 'prosa con el título ajeno dentro',
        seatContest: { proposalId: 'cl9xyz', txType: 'Payment', pinnedSequence: 4210 },
      },
      t,
    )!;
    expect(n.headline).toContain('Payment');
    expect(n.proposalId).toBe('cl9xyz');
    expect(n.pinnedSequence).toBe(4210);
    // Dice QUÉ le pasa a la otra y DÓNDE se resuelve.
    expect(n.body).toMatch(/can no longer apply/i);
    expect(n.body).toMatch(/proposal inbox/i);
  });

  it('un txType que no es un tipo de transacción no se pinta', () => {
    const n = seatContestNotice(
      { seatContest: { txType: 'Pago <b>a la abuela</b>', pinnedSequence: 7 } },
      t,
    )!;
    expect(n.headline).not.toContain('abuela');
    expect(n.pinnedSequence).toBe(7);
  });

  it('un Sequence imposible no viaja', () => {
    expect(seatContestNotice({ seatContest: { pinnedSequence: 0 } }, t)).toBeNull();
    expect(seatContestNotice({ seatContest: { pinnedSequence: Number.NaN } }, t)).toBeNull();
  });
});

describe('el cable: la ceremonia lo pinta ANTES de los QRs', () => {
  const src = read('components/legacy/CouncilMultisigFlow.tsx');

  it('CouncilMultisigFlow lee el aviso (it. 18 medía 0 referencias en todo el frontend)', () => {
    expect(src).toContain('seatContestNotice');
    expect(src).toContain('seatContestWarning');
  });

  it('se renderiza antes del preflight y de la lista de miembros', () => {
    const notice = src.indexOf('<SeatNoticeList notices={seatNotices} />');
    const preflight = src.indexOf('prep.preflight.available');
    const members = src.indexOf('members.map((m)');
    expect(notice).toBeGreaterThan(0);
    expect(notice).toBeLessThan(preflight);
    expect(notice).toBeLessThan(members);
  });

  /**
   * it. 21 (it. 20 2.9) — y TAMBIÉN donde firma cada miembro.
   *
   * «Antes del QR» era cierto en el DOM: el compositor lo ve encima de su botón,
   * y los cosignatarios reciben su push y firman sin haber visto nunca esta
   * pantalla. La misma frase va dentro del panel de cada miembro, pegada a su QR
   * y a su enlace de Xaman.
   */
  it('el aviso también va DENTRO del panel de cada miembro, junto a su QR', () => {
    const list = src.indexOf('<SeatNoticeList notices={seatNotices} compact />');
    const deeplink = src.indexOf("t('Open in Xaman to sign')");
    const membersMap = src.indexOf('members.map((m)');
    expect(list).toBeGreaterThan(0);
    // Dentro del map de miembros, y después del enlace de firma de esa fila.
    expect(list).toBeGreaterThan(membersMap);
    expect(list).toBeGreaterThan(deeplink);
  });

  /**
   * it. 23 (it. 22 §2.2) — ESTABA DENTRO DE LA RAMA «waiting».
   *
   * El aviso vivía dentro de `m.status === 'waiting'`, así que en cuanto alguien
   * pulsaba «New QR» (status 'creating', y luego 'waiting' con otro payload) el
   * aviso desaparecía justo para quien acababa de pedir una petición nueva — y
   * no existía nunca para el miembro cuyo payload dio error y está a punto de
   * pedir otro. La verdad no llegaba a quien firma.
   */
  it('y NO está encerrado en la rama «waiting»: quien pulsa «New QR» lo sigue viendo', () => {
    const list = src.indexOf('<SeatNoticeList notices={seatNotices} compact />');
    const newQr = src.indexOf("t('New QR')");
    const waitingBranch = src.indexOf("{m.status === 'waiting' && (");
    const signedPill = src.indexOf("{m.status === 'signed' && (");
    expect(waitingBranch).toBeGreaterThan(0);
    // Fuera de la rama de espera: se pinta después del botón de «New QR», que
    // vive al nivel de la fila, no dentro del panel del QR.
    expect(list).toBeGreaterThan(newQr);
    expect(list).toBeGreaterThan(signedPill);
    // La única condición es que a ese miembro le quede firma que dar.
    expect(src).toContain("{m.status !== 'signed' && (");
  });

  it('el tipo del prepare declara los dos campos, o nadie podría leerlos', () => {
    const api = read('services/v1Api.ts');
    expect(api).toContain('seatContestWarning?: string');
    expect(api).toContain('pinnedSequence?: number');
  });
});
