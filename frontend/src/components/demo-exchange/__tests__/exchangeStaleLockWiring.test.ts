import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * EL CABLE, EN LAS DOS PANTALLAS DE LA DEMO.
 *
 * El candado de la orden caducada existía y estaba cableado en las SEIS consolas
 * institucionales… y el test que lo fijaba miraba exactamente esas seis. Las dos
 * pantallas del exchange — las que se ven en la demo — componían órdenes de
 * consejo SIN candado: firmar pasada la ventana dejaba componer otra orden sobre
 * el mismo capital, y el verde del cableado era falso porque nadie las miraba.
 */

const FRONTEND_SRC = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(FRONTEND_SRC, rel), 'utf8');

const SURFACES: Array<[string, string]> = [
  ['ExchangeDesk', 'components/demo-exchange/ExchangeDesk.tsx'],
  ['ExchangeSetupWizard', 'components/demo-exchange/stage/ExchangeSetupWizard.tsx'],
];

describe('las dos pantallas del exchange componen órdenes de consejo CON candado', () => {
  it.each(SURFACES)('%s: toma el candado, escucha el destino, para de componer y lo dice', (_name, rel) => {
    const src = read(rel);
    // El candado se toma COMPARTIDO — `useExchangeStaleLock`, que
    // dentro del scope devuelve el único de la pantalla y fuera cae en el suyo.
    expect(src).toContain('useExchangeStaleLock');
    // El destino del stale entra por el prop; sin esto el candado nunca se cierra.
    expect(src).toMatch(/onStaleFate=\{staleLock\.report\}/);
    // …y alguien le pregunta si puede componer.
    expect(src).toMatch(/staleBlocks|staleLock\.locked/);
    // La persona tiene la única salida: decir que lo comprobó.
    expect(src).toContain('StaleOrderLockNote');
  });

  it('sale de la misma pieza compartida, no de una copia del exchange', () => {
    for (const [, rel] of SURFACES) {
      expect(read(rel)).toMatch(/from '\.\.\/(\.\.\/)?xrpl\/XamanSingleSign'/);
    }
  });
});

describe('el candado no toca una SALIDA', () => {
  it('ExchangeDesk: «Recall to buffer» compone sin consultar el candado; «Direct to venue» sí lo consulta', () => {
    const src = read('components/demo-exchange/ExchangeDesk.tsx');
    const recall = /<button onClick=\{\(\) => composeOrder\('recall'\)\} disabled=\{([^}]*)\}/.exec(src);
    expect(recall, 'the recall button must exist').not.toBeNull();
    expect(recall![1]).not.toContain('stale');
    const direct = /<button onClick=\{\(\) => composeOrder\('direct-to'\)\} disabled=\{([^}]*)\}/.exec(src);
    expect(direct, 'the direct-to button must exist').not.toBeNull();
    expect(direct![1]).toContain('staleBlocks');
  });

  /**
   * «Compose another order anyway» ES la confirmación.
   *
   * Ese botón aparece DENTRO del aviso de duplicado, con la frase que dice que
   * nada se firmó ni se registró: pulsarlo es exactamente el acto que el
   * candado pide («I checked»). Gatearlo dejaba a la persona en un bucle — el
   * aviso ofrece componer y el botón que lo ofrece está apagado por un candado
   * que se abre en otra parte de la pantalla. `staleLockBlocks` ya contempla la
   * confirmación explícita: se usa esa puerta, no `staleBlocks` a secas.
   */
  it('ExchangeDesk: «Compose another order anyway» no lo gatea el candado — es la confirmación', () => {
    const src = read('components/demo-exchange/ExchangeDesk.tsx');
    const offer = /onClick=\{\(\) => void composeOrder\(duplicateOffer\.action, true\)\}[\s\S]{0,1400}?disabled=\{([^}]*\}[^}]*)\}\n/.exec(src);
    expect(offer, 'the duplicate-offer button must exist').not.toBeNull();
    // Nunca el candado a secas…
    expect(offer![1]).not.toMatch(/&&\s*staleBlocks/);
    // …sino la puerta que ya sabe que esto es una confirmación explícita.
    expect(offer![1]).toContain('confirmed: true');
  });
});

/**
 * UN SOLO CANDADO POR PANTALLA.
 *
 * `useStaleOrderLock` guarda el candado en estado de React y solo lo LEE al
 * montar: dos consolas que lo llamaran cada una por su cuenta acababan con dos
 * copias del mismo candado, y «I checked» liberaba únicamente la del componente
 * donde se pulsó. La otra seguía pausada hasta desmontarse. Ahora la pantalla
 * monta UNO y lo reparte, así que soltarlo la libera entera.
 */
describe('«I checked» libera la pantalla entera, no medio componente', () => {
  const scope = read('components/demo-exchange/ExchangeStaleLockScope.tsx');

  it('el scope monta UNA sola instancia del candado y la reparte por contexto', () => {
    expect(scope.match(/useStaleOrderLock\(\)/g) ?? []).toHaveLength(2); // el del scope + el de reserva
    expect(scope).toMatch(/StaleLockContext\.Provider value=\{lock\}/);
    // Fuera del proveedor nada se rompe: se cae en el candado propio.
    expect(scope).toMatch(/return shared \?\? own;/);
  });

  it('el wizard envuelve sus estaciones en el scope, y ninguna toma su propio candado', () => {
    const src = read('components/demo-exchange/stage/ExchangeSetupWizard.tsx');
    expect(src).toContain('<ExchangeStaleLockScope>');
    expect(src).toContain('</ExchangeStaleLockScope>');
    // Las DOS estaciones con candado (pote y puerta) piden el compartido…
    expect(src.match(/useExchangeStaleLock\(\)/g) ?? []).toHaveLength(2);
    // …y ninguna llama al hook crudo por su cuenta.
    expect(src).not.toMatch(/=\s*useStaleOrderLock\(\)/);
  });

  it('la mesa también pide el compartido, nunca una copia suya', () => {
    const src = read('components/demo-exchange/ExchangeDesk.tsx');
    expect(src).toMatch(/const staleLock = useExchangeStaleLock\(\);/);
    expect(src).not.toMatch(/=\s*useStaleOrderLock\(\)/);
  });
});

describe('cada reserva tiene su propia cuenta atrás (R5 5.5)', () => {
  it('ExchangeDesk guarda un mapa de esperas, una por desk-payment, y lo persiste en la pestaña', () => {
    const src = read('components/demo-exchange/ExchangeDesk.tsx');
    // Un único `releaseWait` mataba la cuenta atrás de la primera reserva en
    // cuanto llegaba la segunda: el estado es un mapa por id, no un objeto.
    expect(src).toMatch(/releaseWaits, setReleaseWaits\] = useState<Record<string, StoredWait>>/);
    expect(src).toContain('RELEASE_WAIT_KEY');
    expect(src).toContain('readReleaseWaits()');
    expect(src).toContain('writeReleaseWaits(releaseWaits)');
    // …y la espera se pinta contra SU fila, nunca contra «la» espera del desk.
    expect(src).toMatch(/releaseWaits\[p\.id\]/);
  });
});

describe('una sola regla para liberar el asiento, dicha igual en los tres sitios', () => {
  it('ni el botón ni la confirmación piden al operador que juzgue si llegó a Xaman', () => {
    const src = read('components/demo-exchange/ExchangeDesk.tsx');
    expect(src).not.toContain('only if it never reached Xaman');
    expect(src).not.toContain('never reached Xaman');
    // Lo que sí dicen: el asiento se libera cuando el payload ya no puede firmarse.
    expect(src).toContain('can no longer be signed');
  });
});
