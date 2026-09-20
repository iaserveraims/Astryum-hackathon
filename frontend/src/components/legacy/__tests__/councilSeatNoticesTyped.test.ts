import { describe, expect, it } from 'vitest';
import { seatContestNotices } from '../CouncilMultisigFlow';

/**
 * LA PANTALLA INVENTABA UN RIVAL.
 *
 * El servidor mete TRES avisos distintos en el mismo canal del asiento:
 *   · un payload rival que de verdad tiene el Sequence de esta cuenta;
 *   · una transacción que NO se pudo CLASIFICAR como salida (se trata como
 *     salida, que es lo correcto, pero nada lo verificó);
 *   · una bandeja que no se pudo LEER en absoluto.
 * La pantalla pintaba para los tres «otro pago ocupa la misma secuencia», así
 * que un consejo cuyo único problema era un parpadeo de base de datos salía a
 * liquidar una propuesta que no existe — y los dos avisos verdaderos no tenían
 * lector. «No pude leer» pintado como un hecho es el mismo fallo que un código
 * crudo, un piso más arriba.
 */

const t = (s: string) => s;
const RIVAL = 'Another payload of this account is holding the same Sequence';

describe('seatContestNotices — un aviso, una frase suya', () => {
  it('sin nada, ningún aviso', () => {
    expect(seatContestNotices(null, t)).toEqual([]);
    expect(seatContestNotices({}, t)).toEqual([]);
    expect(seatContestNotices({ seatNotices: [] }, t)).toEqual([]);
  });

  it('rival real: dice el rival, con su tipo y sus ids — nunca su título', () => {
    const [n] = seatContestNotices(
      {
        seatNotices: [
          {
            kind: 'rival-seat',
            proposalId: 'cl9xyz',
            txType: 'Payment',
            pinnedSequence: 4210,
            detail: 'prosa del servidor con el título ajeno dentro',
          },
        ],
      },
      t,
    );
    expect(n.kind).toBe('rival-seat');
    expect(n.headline).toContain(RIVAL);
    expect(n.headline).toContain('Payment');
    expect(n.proposalId).toBe('cl9xyz');
    expect(n.pinnedSequence).toBe(4210);
    // Castellano en una pantalla inglesa: jamás. Se cae a la frase del cliente.
    expect(`${n.headline} ${n.body}`).not.toContain('prosa del servidor');
  });

  /**
   * LA FRASE VERDADERA VIVE EN `detail`.
   *
   * El cliente no puede saber cuál de las dos físicas se aplicó: «se fijó a ese
   * asiento» o «NO se fijó, lleva la siguiente Sequence libre». Eso solo lo dice
   * el servidor, y se estaba tirando — que es lo que manda a una familia a
   * re-liquidar un pago que quizá ya aterrizó.
   */
  it('la prosa INGLESA del servidor es el cuerpo: es la única que dice si se fijó al asiento', () => {
    const said =
      'This payload was NOT pinned to that seat: we could not confirm it is an exit, so it carries a freshly read Sequence.';
    const [n] = seatContestNotices(
      { seatNotices: [{ kind: 'rival-seat', proposalId: 'p1', txType: 'Payment', pinnedSequence: 7, detail: said }] },
      t,
    );
    expect(n.body).toBe(said);
  });

  it('sin Sequence, el titular NO afirma que compartan asiento', () => {
    const [n] = seatContestNotices(
      { seatNotices: [{ kind: 'rival-seat', proposalId: 'p1', txType: 'Payment' }] },
      t,
    );
    expect(n.headline).not.toContain(RIVAL);
    expect(n.headline).toContain('collecting signatures');
  });

  it('salida sin clasificar: NO afirma que exista otro payload', () => {
    const [n] = seatContestNotices({ seatNotices: [{ kind: 'unclassified-exit', detail: 'x' }] }, t);
    expect(n.kind).toBe('unclassified-exit');
    expect(`${n.headline} ${n.body}`).not.toContain(RIVAL);
    expect(n.headline).toContain('could not confirm this transaction is an exit');
    // Y dice en voz alta que nadie vio un rival.
    expect(n.body).toContain('Nobody said another payload is holding');
  });

  it('bandeja ilegible: es un fallo NUESTRO, y tampoco inventa un rival', () => {
    const [n] = seatContestNotices({ seatNotices: [{ kind: 'inbox-unreadable', detail: 'x' }] }, t);
    expect(n.kind).toBe('inbox-unreadable');
    expect(`${n.headline} ${n.body}`).not.toContain(RIVAL);
    expect(n.body).toContain('we will not tell you there is one, because we did not see one');
    expect(n.body).toContain('failure of ours, not a verdict');
  });

  /**
   * DOS AVISOS QUE SE CONTRADICEN, A LA VEZ.
   *
   * «Otro payload tiene esta Sequence» y «nadie dijo que otro payload la tenga»
   * no pueden estar los dos en pantalla, sin orden, junto a un QR. La evidencia
   * gana: si el servidor NOMBRÓ un rival, los dos «no pude leer» no se pintan.
   */
  it('los tres a la vez: manda el rival, y los dos «no pude leer» callan', () => {
    const out = seatContestNotices(
      {
        seatNotices: [
          { kind: 'unclassified-exit' },
          { kind: 'inbox-unreadable' },
          { kind: 'rival-seat', proposalId: 'p1', txType: 'Payment', pinnedSequence: 7 },
        ],
      },
      t,
    );
    expect(out.map((n) => n.kind)).toEqual(['rival-seat']);
    expect(out.filter((n) => `${n.headline} ${n.body}`.includes(RIVAL))).toHaveLength(1);
  });

  it('dos rivales NO se contradicen: cada uno es un payload que liquidar', () => {
    const out = seatContestNotices(
      {
        seatNotices: [
          { kind: 'rival-seat', proposalId: 'p1', txType: 'Payment', pinnedSequence: 7 },
          { kind: 'rival-seat', proposalId: 'p2', txType: 'EscrowCreate', pinnedSequence: 7 },
        ],
      },
      t,
    );
    expect(out.map((n) => n.proposalId)).toEqual(['p1', 'p2']);
  });

  it('sin rival, los dos avisos honestos conviven, y en el orden que manda el servidor', () => {
    const out = seatContestNotices(
      {
        seatNotices: [
          { kind: 'inbox-unreadable', priority: 5 },
          { kind: 'unclassified-exit', priority: 1 },
        ],
      },
      t,
    );
    expect(out.map((n) => n.kind)).toEqual(['unclassified-exit', 'inbox-unreadable']);
  });

  it('un `kind` que no conocemos se ignora: nunca se pinta a ciegas', () => {
    expect(seatContestNotices({ seatNotices: [{ kind: 'whatever', detail: 'x' }] }, t)).toEqual([]);
  });

  describe('backend antiguo (solo el campo de texto libre)', () => {
    it('con los ids del rival, sigue siendo el aviso del rival', () => {
      const [n] = seatContestNotices(
        { seatContestWarning: 'prosa', seatContest: { proposalId: 'p1', txType: 'Payment', pinnedSequence: 9 } },
        t,
      );
      expect(n.kind).toBe('rival-seat');
      expect(n.headline).toContain(RIVAL);
    });

    it('SIN ids no se afirma un rival: el texto libre puede ser cualquiera de los tres', () => {
      const [n] = seatContestNotices({ seatContestWarning: 'no pude leer la bandeja' }, t);
      expect(n.kind).toBe('inbox-unreadable');
      expect(`${n.headline} ${n.body}`).not.toContain(RIVAL);
      expect(n.body).toContain('will not claim either');
      // Y jamás la prosa del servidor.
      expect(`${n.headline} ${n.body}`).not.toContain('no pude leer la bandeja');
    });

    it('un `pinnedSequence` inválido no basta para inventar nada', () => {
      expect(seatContestNotices({ seatContest: { pinnedSequence: 0 } }, t)).toEqual([]);
      expect(seatContestNotices({ seatContest: { pinnedSequence: Number.NaN } }, t)).toEqual([]);
    });
  });
});
