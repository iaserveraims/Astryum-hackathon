import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * EL CABLE, NO LA PIEZA.
 *
 * Las dos regresiones de esta ronda son de CABLEADO, no de lógica:
 *   · `exitToken` existía, `/multisign/prepare` lo aceptaba y CouncilSigningDoors
 *     lo reenviaba — pero dos consolas no se lo pasaban, así que sus salidas
 *     contestaban 451 en cuanto el registro fallaba: una salida gateada por una
 *     base de datos (R3 3.1). Probar la pieza no probaba que la cadena existiera.
 *   · `staleOffersPrepareAgain` existía y nadie la llamaba en producción: la
 *     tarjeta decía «no la prepares otra vez» y el padre componía otra (R2 2.3).
 */

const FRONTEND_SRC = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(FRONTEND_SRC, rel), 'utf8');

const CONSOLES: Array<[string, string]> = [
  ['ManagerConsole', 'components/managed/ManagerConsole.tsx'],
  ['CageConsole', 'components/institutional/CageConsole.tsx'],
  ['OperatorConsole', 'components/institutional/OperatorConsole.tsx'],
  ['VaultCreator', 'components/managed/VaultCreator.tsx'],
  ['CouncilOrderCard', 'components/legacy/CouncilOrderCard.tsx'],
  ['CouncilVaultEntry', 'components/legacy/CouncilVaultEntry.tsx'],
];

describe('cada consola que compone órdenes de consejo tiene el candado del stale', () => {
  it.each(CONSOLES)('%s: toma el candado, escucha el destino y para de componer', (_name, rel) => {
    const src = read(rel);
    expect(src).toContain('useStaleOrderLock');
    // El destino del stale entra por el prop; sin esto el candado nunca se cierra.
    expect(src).toMatch(/onStaleFate=\{staleLock\.report\}/);
    // …y alguien le pregunta si puede componer (guarda o botón deshabilitado).
    expect(src).toMatch(/staleLock\.blocks\(|staleLocked/);
    // La persona tiene la única salida: decir que lo comprobó.
    expect(src).toContain('StaleOrderLockNote');
  });

  it('el candado y su nota salen de la misma pieza, no de seis copias', () => {
    const shared = read('components/xrpl/XamanSingleSign.tsx');
    expect(shared).toContain('export function useStaleOrderLock');
    expect(shared).toContain('export function StaleOrderLockNote');
    // La decisión es pura y vive en la capa sin React.
    expect(shared).toContain('nextStaleOrderLock');
    // Y la decisión de si PARA algo también es pura.
    expect(shared).toContain('staleLockBlocks');
  });
});

/**
 * EL CANDADO NO GATEA UNA SALIDA. NUNCA.
 *
 * La regresión de la fue nuestra: el candado paraba TODO lo que componía
 * una consola, incluidos `recall`, `evacuate`, «Pull out» y la salida del
 * creador. Eso contradice lo que el mismo commit escribía en el backend — una
 * salida se avisa, jamás se para — y deja a un consejo sin poder sacar su
 * capital por una pantalla nuestra.
 *
 * Este cable-trampa mira el código desplegado: ninguna consola puede volver a
 * atar una puerta de SALIDA al candado, y la que compone las dos cosas tiene que
 * preguntar por el tipo de lo que compone (`composeKindOf`), no por un booleano
 * global.
 */
const EXIT_DOORS: Array<[string, string, RegExp[]]> = [
  [
    'OperatorConsole',
    'components/institutional/OperatorConsole.tsx',
    [
      // El recall del pote y la salida del creador: sus botones ya no miran el candado.
      /onClick=\{\(\) => run\('recall'\)\}\s*\n\s*disabled=\{busy \|\| evmPathDead \|\| signLocked\}/,
      /onClick=\{\(\) => void pullGenesis\(\)\}\s*\n\s*disabled=\{exitBusy\}/,
      /onClick=\{\(\) => void pullGenesis\(\{ supersede: true \}\)\}\s*\n\s*disabled=\{exitBusy\}/,
    ],
  ],
  [
    'ManagerConsole',
    'components/managed/ManagerConsole.tsx',
    [/setPending\(\{ verb: 'recall'[\s\S]{0,200}?disabled=\{value === BigInt\(0\) \|\| signLocked \|\| !!councilOrder\}/],
  ],
  [
    'CageConsole',
    'components/institutional/CageConsole.tsx',
    [
      // Recall y Evacuate: solo `busy`, y su fieldset ya no se deshabilita entero.
      /prepareMove\('recall'\)\} disabled=\{busy\}/,
      /sendOrder\('evacuate',[\s\S]{0,80}?\)\} disabled=\{busy\}/,
    ],
  ],
];

describe('Ninguna consola gatea una SALIDA con el candado', () => {
  it.each(EXIT_DOORS)('%s: sus puertas de salida no miran el candado', (_name, rel, patterns) => {
    const src = read(rel);
    for (const re of patterns) expect(src).toMatch(re);
  });

  it('CageConsole ya no apaga el bloque entero con un `fieldset disabled` sobre las salidas', () => {
    const src = read('components/institutional/CageConsole.tsx');
    // El fieldset de «Direct capital» (el que contiene Recall y Evacuate) va sin `disabled`.
    expect(src).toMatch(/<fieldset className="min-w-0 space-y-2 rounded-lg border border-white\/10 p-3">\s*\n\s*<p className="text-\[12px\] font-medium">\{t\('Direct capital'\)\}/);
  });

  it('las consolas que componen salidas y entradas preguntan por el TIPO, no por un booleano', () => {
    for (const rel of [
      'components/institutional/OperatorConsole.tsx',
      'components/institutional/CageConsole.tsx',
      'components/managed/ManagerConsole.tsx',
      'components/legacy/CouncilOrderCard.tsx',
      'components/legacy/CouncilVaultEntry.tsx',
    ]) {
      expect(read(rel)).toContain('composeKindOf');
    }
  });

  it('«Compose it again anyway» compone: toda guarda admite la confirmación explícita', () => {
    for (const rel of [
      'components/institutional/OperatorConsole.tsx',
      'components/institutional/CageConsole.tsx',
      'components/managed/ManagerConsole.tsx',
      'components/managed/VaultCreator.tsx',
      'components/legacy/CouncilOrderCard.tsx',
      'components/legacy/CouncilVaultEntry.tsx',
    ]) {
      expect(read(rel)).toMatch(/confirmed:\s*(opts\?\.confirmAnotherOrder|input\.confirmAnotherOrder === true)/);
    }
  });
});

/**
 * EL CANDADO SE ARMABA DONDE SU BOTÓN NO SE PINTA.
 *
 * En CouncilVaultEntry y CouncilOrderCard la nota vivía DESPUÉS de un `return`
 * temprano: el stale llega firmando (la ceremonia), y esa pantalla es
 * exactamente la que no renderizaba la nota. La consola quedaba en pausa sin
 * titular y sin manera de decir «lo comprobé».
 */
describe('La nota del candado se pinta donde el candado se arma', () => {
  it('CouncilVaultEntry: también en la rama del pedido pendiente (antes del return)', () => {
    const src = read('components/legacy/CouncilVaultEntry.tsx');
    const firstNote = src.indexOf('<StaleOrderLockNote');
    const pendingReturn = src.indexOf('if (pending) {');
    expect(pendingReturn).toBeGreaterThan(-1);
    expect(firstNote).toBeGreaterThan(pendingReturn);
    // y hay DOS: la de la rama pendiente y la del formulario.
    expect(src.split('<StaleOrderLockNote').length - 1).toBeGreaterThanOrEqual(2);
  });

  it('CouncilOrderCard: por encima de todas las etapas, no dentro de la del formulario', () => {
    const src = read('components/legacy/CouncilOrderCard.tsx');
    const note = src.indexOf('<StaleOrderLockNote');
    const formStage = src.indexOf("{(stage === 'form'");
    const reviewStage = src.indexOf("{stage === 'review' && handoff && (");
    expect(note).toBeGreaterThan(-1);
    expect(note).toBeLessThan(formStage);
    expect(note).toBeLessThan(reviewStage);
  });

  it('el candado se guarda por memo para sobrevivir a un F5', () => {
    const shared = read('components/xrpl/XamanSingleSign.tsx');
    expect(shared).toContain('restoredStaleLock');
    expect(shared).toContain('writeStoredStaleLock');
    expect(shared).toContain('clearStoredStaleLocks');
    // El memo viaja con el destino desde las dos puertas que leen el fate.
    expect(shared).toMatch(/onStaleFateRef\.current\?\.\(fate, memo\)/);
    expect(read('components/legacy/CouncilMultisigFlow.tsx')).toMatch(/onStaleFateRef\.current\?\.\(fate, memo\)/);
  });
});

describe('toda puerta de consejo que firma una SALIDA reenvía su pase', () => {
  it('OperatorConsole: el recall del pote Y la salida del creador (las dos que faltaban)', () => {
    const src = read('components/institutional/OperatorConsole.tsx');
    expect(src).toMatch(/exitToken=\{pendingOrder\.exitToken\}/);
    expect(src).toMatch(/exitToken=\{creatorExit\.exitToken\}/);
  });

  it('CouncilOrderCard y CouncilVaultEntry lo siguen reenviando', () => {
    expect(read('components/legacy/CouncilOrderCard.tsx')).toMatch(/exitToken=\{handoff\.exitToken\}/);
    expect(read('components/legacy/CouncilVaultEntry.tsx')).toMatch(/exitToken=\{pending\.exitToken\}/);
  });

  it('las puertas lo aceptan y lo bajan a la ceremonia, que lo manda al servidor', () => {
    const doors = read('components/legacy/CouncilMultisigFlow.tsx');
    expect(doors).toMatch(/exitToken=\{exitToken\}/);
    expect(doors).toMatch(/multisignPrepare\(account, xrplTx, exitToken \? \{ exitToken \} : undefined\)/);
  });

  it('ManagerConsole y CageConsole firman sus salidas en single-sig: no pasan por esa puerta', () => {
    // Dicho aquí para que la ausencia sea una decisión leída y no un olvido: sus
    // órdenes las firma una cuenta sin SignerList (XamanSingleSign), que no llama
    // a /multisign/prepare y por tanto no tiene pase que reenviar.
    for (const rel of ['components/managed/ManagerConsole.tsx', 'components/institutional/CageConsole.tsx']) {
      expect(read(rel)).not.toContain('CouncilSigningDoors');
    }
  });
});
