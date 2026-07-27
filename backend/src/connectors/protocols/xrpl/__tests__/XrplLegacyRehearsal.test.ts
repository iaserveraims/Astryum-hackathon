import { assessRehearsal, assessLegacyHealth, quorumMargin } from '../XrplLegacyRehearsal';

const A = 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH';
const B = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';
const C = 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY';

function council(signers: Array<[string, number]>, quorum: number, masterOff = false) {
  return {
    quorum,
    masterKeyDisabled: masterOff,
    signers: signers.map(([account, weight]) => ({ account, weight })),
  };
}

describe('quorumMargin — el margen sobre firmantes declarados (peor caso primero)', () => {
  test('5×1 con quórum 3 → margen 2 (la configuración recomendada)', () => {
    expect(quorumMargin(3, [1, 1, 1, 1, 1])).toBe(2);
  });

  test('quórum exacto → margen 0 (emergencia)', () => {
    expect(quorumMargin(3, [1, 1, 1])).toBe(0);
  });

  test('pesos desiguales: perder al pesado primero', () => {
    // total 5, quórum 3: perder el peso-3 deja 2 < 3 → margen 0.
    expect(quorumMargin(3, [3, 1, 1])).toBe(0);
    // total 6, quórum 3: pierde el 3 → quedan 3 ≥ 3 → margen 1.
    expect(quorumMargin(3, [3, 1, 1, 1])).toBe(1);
  });

  test('consejo que ya no alcanza el quórum → 0', () => {
    expect(quorumMargin(5, [1, 1])).toBe(0);
  });
});

describe('assessRehearsal — el gate del candado de la master key', () => {
  test('sin consejo: nada que evaluar, gate cerrado', () => {
    const r = assessRehearsal(null, { signersSeen: [A], multisigEscrowCreates: 1, escrowResolved: true });
    expect(r.hasCouncil).toBe(false);
    expect(r.rehearsalComplete).toBe(false);
  });

  test('el quórum firmó pero falta un miembro → gate CERRADO (F2: 3-de-5 solo prueba 3)', () => {
    const r = assessRehearsal(council([[A, 1], [B, 1], [C, 1]], 2), {
      signersSeen: [A, B], // C nunca firmó nada
      multisigEscrowCreates: 1,
      escrowResolved: false,
    });
    expect(r.signedCount).toBe(2);
    expect(r.rehearsalComplete).toBe(false);
    expect(r.members.find((m) => m.account === C)?.signedOnChain).toBe(false);
  });

  test('todos firmaron on-chain (acumulativo, en varias txs) + escrow de ensayo → gate ABIERTO', () => {
    const r = assessRehearsal(council([[A, 1], [B, 1], [C, 1]], 2), {
      signersSeen: [A, B, C],
      multisigEscrowCreates: 2,
      escrowResolved: true,
    });
    expect(r.rehearsalComplete).toBe(true);
    expect(r.quorumMargin).toBe(1);
  });

  test('todos firmaron pero sin EscrowCreate multisig → gate cerrado (el ensayo ES el escrow)', () => {
    const r = assessRehearsal(council([[A, 1], [B, 1]], 2), {
      signersSeen: [A, B],
      multisigEscrowCreates: 0,
      escrowResolved: false,
    });
    expect(r.rehearsalComplete).toBe(false);
  });
});

describe('assessLegacyHealth — la salud manda sobre las acciones (§2)', () => {
  const activity = (seen: string[], escrows = 1, resolved = true) => ({
    signersSeen: seen,
    multisigEscrowCreates: escrows,
    escrowResolved: resolved,
  });

  test('sin consejo → unknown, headline inspect, nada bloqueado (no es un Legacy todavía)', () => {
    const h = assessLegacyHealth(assessRehearsal(null, activity([])));
    expect(h.level).toBe('unknown');
    expect(h.headline).toBe('inspect');
  });

  test('margen 0 → ROJO: la única acción es reemplazar; cerrar la puerta y capital BLOQUEADOS', () => {
    // 3×1 quórum 3 = margen 0, ensayo completo — el ROJO manda igual.
    const h = assessLegacyHealth(assessRehearsal(council([[A, 1], [B, 1], [C, 1]], 3), activity([A, B, C])));
    expect(h.level).toBe('red');
    expect(h.headline).toBe('replace-fallen-signer');
    expect(h.mustReplaceSigner).toBe(true);
    expect(h.dangerousActionsBlocked).toBe(true);
    expect(h.canCloseDoor).toBe(false);
    expect(h.canCommitCapital).toBe(false);
  });

  test('ensayo sin verificar (margen sano) → ÁMBAR: correr el ensayo, sin cerrar puerta ni capital', () => {
    // 5×1 quórum 3 = margen 2, pero falta un firmante en el ensayo.
    const h = assessLegacyHealth(
      assessRehearsal(council([[A, 1], [B, 1], [C, 1], ['rD', 1], ['rE', 1]], 3), activity([A, B, C])),
    );
    expect(h.level).toBe('amber');
    expect(h.headline).toBe('run-rehearsal');
    expect(h.canCloseDoor).toBe(false);
    expect(h.canCommitCapital).toBe(false);
  });

  test('ensayo verificado, puerta abierta, margen sano → VERDE: el paso recomendado es cerrar la puerta', () => {
    const h = assessLegacyHealth(
      assessRehearsal(council([[A, 1], [B, 1], [C, 1], ['rD', 1], ['rE', 1]], 3), activity([A, B, C, 'rD', 'rE'])),
    );
    expect(h.level).toBe('green');
    expect(h.headline).toBe('close-the-door');
    expect(h.canCloseDoor).toBe(true);
    expect(h.canCommitCapital).toBe(true);
  });

  test('constituido del todo (puerta cerrada, margen sano) → VERDE, healthy', () => {
    const h = assessLegacyHealth(
      assessRehearsal(council([[A, 1], [B, 1], [C, 1], ['rD', 1], ['rE', 1]], 3, true), activity([A, B, C, 'rD', 'rE'])),
    );
    expect(h.level).toBe('green');
    expect(h.headline).toBe('healthy');
    expect(h.canCloseDoor).toBe(false); // ya está cerrada
  });

  test('margen 1 → ÁMBAR aunque el ensayo esté verificado (a una llave de la emergencia)', () => {
    // 4×1 quórum 3 = margen 1.
    const h = assessLegacyHealth(
      assessRehearsal(council([[A, 1], [B, 1], [C, 1], ['rD', 1]], 3), activity([A, B, C, 'rD'])),
    );
    expect(h.level).toBe('amber');
    expect(h.canCloseDoor).toBe(true); // margen 1 aún permite cerrar (≥1), pero avisa
  });
});
