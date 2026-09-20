import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  describeSeatRelease,
  mayPrepareAgainAfterRelease,
  normalizeSeatRefusal,
  seatReleaseOffer,
  seatReleaseSettled,
  seatRefusalSentence,
  seatRefusalView,
} from '../SeatRefusalNotice';
import type { HandoffPostResult } from '@/lib/wallet/handoffRelease';

/**
 * LAS DOS MITADES DEL 3.6, EL 3.7 Y LOS DOS 409 DEL 2.5.
 *
 * Tres cosas que una pantalla de salida no puede hacer, y que la re-revisión de
 * la encontró haciendo:
 */

const t = (s: string) => s;

/* ── 3.6 (a): el botón solo donde el release puede hacer algo ─────────────── */

describe('3.6a — «Free the seat» solo donde libera', () => {
  it('la ventana abierta no se libera desde aquí, lo diga quien lo diga el memo', () => {
    // El servidor manda el memo solo a quien preparó o prueba la cuenta: tener
    // el memo no es poder desplazar. Lo que decide es lo que el servidor dijo.
    expect(seatReleaseOffer({ error: 'NONCE_SEAT_TAKEN', memoHex: 'FE01', secondsLeft: 300 })).toBeNull();
    expect(seatReleaseOffer({ error: 'NONCE_SEAT_TAKEN', retryable: false }, 'DEADBEEF')).toBeNull();
    // Y la frase de ese rechazo sigue diciendo que no se desplaza desde aquí:
    // el botón contradecía a su propio párrafo.
    expect(seatRefusalSentence({ error: 'NONCE_SEAT_TAKEN', secondsLeft: 300 }, t)).toMatch(
      /cannot be displaced from here/i,
    );
  });

  it('con el permiso explícito del servidor sí, que es la única puerta que abre', () => {
    expect(seatReleaseOffer({ error: 'NONCE_SEAT_TAKEN', retryable: true, memoHex: 'FE01' })).toEqual({
      memoHex: 'FE01',
    });
  });

  it('sin ventana medida, la salida es preguntar otra vez — nunca «prepáralo otra vez»', () => {
    // «Try again» no afirma que el asiento esté libre: el servidor decide de
    // cero y un asiento todavía ocupado vuelve a negarse.
    const view = seatRefusalView({ error: 'NONCE_SEAT_TAKEN' }, t);
    expect(view?.kind).toBe('taken-window-open');
    expect(view?.mayTryAgain).toBe(true);
    expect(view?.mayFreeSeat).toBe(false);
    // Con ventana medida hay cuenta atrás, así que esperar ES el camino.
    expect(seatRefusalView({ error: 'NONCE_SEAT_TAKEN', secondsLeft: 300 }, t)?.mayTryAgain).toBeUndefined();
    // …y cuando esa ventana pasa, preparar otra vez es honesto.
    expect(mayPrepareAgainAfterRelease(null, true)).toBe(true);
  });
});

/* ── 3.6 (b): el payload que aún se firma tiene camino ────────────────────── */

describe('3.6b — el aviso del asiento abandonado no deja a nadie parado', () => {
  const SRC = readFileSync(join(__dirname, '..', 'SeatRefusalNotice.tsx'), 'utf8');

  it('el botón ya no se esconde por el simple hecho de que el payload siga firmable', () => {
    // La condición vieja escondía la acción SIEMPRE que `stillSignable`; la
    // nueva solo mientras haya una ventana MEDIDA corriendo, que es cuando
    // esperar es de verdad un camino.
    expect(SRC).not.toMatch(/!settled && !stillSignable/);
    expect(SRC).toMatch(/const mayAsk = !settled && !\(stillSignable && liveWindow\);/);
  });

  it('y cuando el payload sigue firmable, el botón pregunta — no promete liberar', () => {
    expect(SRC).toMatch(/Check whether the seat is free/);
    // La promesa de que preguntar es seguro la sostiene el servidor, no esta
    // pantalla: el release no suelta nada que aún pueda firmarse.
    expect(SRC).toMatch(/never frees a payment that can still be signed/);
  });

  it('las tres superficies que lo usan con el payload en pantalla ofrecen volver a preparar', () => {
    const read = (...p: string[]) => readFileSync(join(__dirname, '..', '..', ...p), 'utf8');
    for (const [name, source] of [
      ['VaultWithdrawModal', read('positions', 'VaultWithdrawModal.tsx')],
      ['VaultClaimModal', read('positions', 'VaultClaimModal.tsx')],
      ['VaultEntryModal', read('managed', 'VaultEntryModal.tsx')],
      ['TicketsBoard', read('institutional', 'TicketsBoard.tsx')],
      ['LegacyYieldPanel', read('legacy', 'LegacyYieldPanel.tsx')],
    ] as Array<[string, string]>) {
      // Ni un solo `stillSignable` suelto: el que lo use, cablea la salida.
      expect(source, name).not.toMatch(/<AbandonedSeatNotice[^>]*stillSignable\s*\/>/);
      expect(source, name).toMatch(/onPrepareAgain/);
    }
  });
});

/* ── 2.5: los dos 409 que ninguna pantalla sabía leer ─────────────────────── */

describe('Los dos 409 deterministas, con su frase y sus dos puertas', () => {
  for (const code of ['ACCOUNT_RECORD_MISSING', 'PROOF_FLOOR_UNREADABLE']) {
    it(`${code}: se reconoce, venga en \`error\`, en \`code\` o dentro del \`detail\``, () => {
      expect(normalizeSeatRefusal({ error: code })).not.toBeNull();
      expect(normalizeSeatRefusal({ code })).not.toBeNull();
      expect(
        normalizeSeatRefusal({ error: 'POTE_EXIT_PREPARE_FAILED', detail: `${code}: la fila del usuario no existe` })
          ?.error,
      ).toBe(code);
    });

    it(`${code}: dice lo que es, las dos salidas, y NO promete un reintento`, () => {
      const view = seatRefusalView({ error: code, retryable: false, status: 409 }, t);
      expect(view?.code).toBe(code);
      // Esperar no arregla esto, y ofrecerlo sería una promesa que nadie cumple.
      expect(view?.mayTryAgain).toBe(false);
      expect(view?.mayFreeSeat).toBe(false);
      // La frase puede venir del lector compartido
      // o del respaldo de aquí: las dos dicen que esperar no arregla esto.
      expect(view?.text).toMatch(/(does not fix this|will not fix itself)/i);
      // Las dos puertas reales: firmar con esa wallet, o que un admin repare.
      expect(view?.text).toMatch(/sign in with the wallet/i);
      expect(view?.text).toMatch(/administrator/i);
      // Ni el código ni la frase genérica que se tragaba todo esto.
      expect(view?.text).not.toMatch(new RegExp(code));
      expect(view?.text).not.toMatch(/The server refused this operation/i);
      // Y jamás un asiento: no hay nada que liberar aquí.
      expect(seatReleaseOffer({ error: code, memoHex: 'FE01' })).toBeNull();
    });
  }

  it('un 409 de estos NO es la espera del payload: nadie está esperando a nada', () => {
    const said = describeSeatRelease(
      {
        kind: 'refused',
        status: 409,
        error: 'ACCOUNT_RECORD_MISSING',
        detail: 'no se encontró la fila de la cuenta',
      } as HandoffPostResult,
      t,
      300,
    );
    expect(said?.kind).toBe('proof-record');
    expect(said?.text).not.toMatch(/can still be signed/i);
    expect(said?.text).not.toMatch(/ACCOUNT_RECORD_MISSING|no se encontró/);
    // Zanjado: volver a pulsar no cambia nada, y la frase ya dice qué sí.
    expect(seatReleaseSettled(said)).toBe(true);
  });

  it('la espera de verdad sigue siendo la espera', () => {
    const said = describeSeatRelease(
      { kind: 'refused', status: 409, error: 'WAIT_FOR_PAYLOAD_EXPIRY', secondsLeft: 92 } as HandoffPostResult,
      t,
    );
    expect(said?.kind).toBe('wait');
  });
});

/* ── 3.7: el `detail` del servidor, nunca en crudo ────────────────────────── */

describe('Ninguna superficie de salida pinta el `detail` sin filtrar', () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, '..', '..', ...p), 'utf8');
  const SURFACES: Array<[string, string]> = [
    ['PoteExitCard', read('institutional', 'user', 'PoteExitCard.tsx')],
    ['TicketsBoard', read('institutional', 'TicketsBoard.tsx')],
    ['VaultEntryModal', read('managed', 'VaultEntryModal.tsx')],
    ['VaultWithdrawModal', read('positions', 'VaultWithdrawModal.tsx')],
    ['VaultClaimModal', read('positions', 'VaultClaimModal.tsx')],
    ['WalletTransferModals', read('wallet', 'WalletTransferModals.tsx')],
    ['PaActionsModal', read('positions', 'PaActionsModal.tsx')],
    ['FlareDemoEarn', read('earn', 'FlareDemoEarn.tsx')],
    ['BorrowFlowRunner', read('earn', 'BorrowFlowRunner.tsx')],
    ['LegacyYieldPanel', read('legacy', 'LegacyYieldPanel.tsx')],
    // Las dos que faltaban en «las diez superficies» de la —
    // la salida del pote y el panel de la bóveda del cliente de email.
    ['PoteExitModal', read('institutional', 'PoteExitModal.tsx')],
    ['UserVaultPanel', read('institutional', 'user', 'UserVaultPanel.tsx')],
  ];

  for (const [name, source] of SURFACES) {
    it(`${name}: el detalle pasa por el filtro y el código nunca se pinta`, () => {
      // Lo que había: `{refusal.detail}` en el JSX y `body.detail || body.error`
      // como último recurso. Las dos cosas enseñan castellano o un slug. Los
      // comentarios que CITAN el patrón viejo no cuentan: se leen solo las
      // líneas de código.
      const code = source
        .split(/\r?\n/)
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join(' ');
      expect(code, name).not.toMatch(/\{\s*[\w.]*refusal\.detail\s*\}/);
      expect(code, name).not.toMatch(/\w+\.detail \|\| \w+\.error/);
      // Y su gemelo con `??`, que es el que sobrevivió en UserVaultPanel.
      expect(code, name).not.toMatch(/\w+\.detail \?\? \w+\.error/);
      expect(code, name).toMatch(/serverDetailIfEnglish/);
    });
  }

  it('PoteExitCard deja SIEMPRE una frase: un hueco tampoco explica nada', () => {
    const src = read('institutional', 'user', 'PoteExitCard.tsx');
    expect(src).toMatch(/serverDetailIfEnglish\(refusal\.detail\) \?\?/);
    expect(src).toMatch(/Nothing was prepared and nothing was signed/);
  });

  it('la comisión de redención sigue intacta: bruto, neto y «no se pudo leer»', () => {
    // El contrato de comisiones no se toca al arreglar el texto de al lado.
    const src = read('institutional', 'user', 'PoteExitCard.tsx');
    expect(src).toMatch(/RedemptionFeeNotice/);
    expect(src).toMatch(/grossFxrp=\{grossFxrp\}/);
    expect(src).toMatch(/exitRedemption\(prepared, copy\?\.unminted === true\)/);
  });
});
