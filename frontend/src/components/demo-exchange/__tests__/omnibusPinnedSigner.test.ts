/**
 * EL QR SE CREA PARA EL OMNIBUS, ESTÉ CONECTADA LA CUENTA QUE ESTÉ.
 *
 * Captura del y el botón muerto. El 0xFE ya lleva el omnibus en `Account`, y un
 * Account fijado no necesita sesión (98900df6): el payload se crea para esa
 * cuenta y Xaman la pide al escanear. Esta puerta seguía exigiendo que la
 * cuenta CONECTADA fuera el omnibus.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pinnedXrplSigner } from '../../../lib/wallet/xrplSigner';

const DOOR = readFileSync(join(__dirname, '..', 'OmnibusSignDoor.tsx'), 'utf8');

describe('OmnibusSignDoor firma lo que lleva fijado el omnibus', () => {
  it('el botón se habilita con la cuenta fijada, no solo con la conectada', () => {
    expect(DOOR).toContain('const pinnedToOmnibus = pinnedXrplSigner(xrplTx) === account;');
    expect(DOOR).toContain('const canSign = matches || pinnedToOmnibus;');
    expect(DOOR).toContain('disabled={busy || !canSign}');
    expect(DOOR).not.toContain('disabled={busy || !matches}');
  });

  it('el 0xFE y el payout que compone la mesa llevan el omnibus en Account: eso es lo que la puerta lee', () => {
    const omnibus = 'r4yp47QPbB3XcVurs8pbE75k7EwQ1GEBAa';
    expect(pinnedXrplSigner({ TransactionType: 'Payment', Account: omnibus, Destination: 'rfkXSaCZKTg1EZzec2rLDyrWHxRVJdtVXj', Amount: '13000000' })).toBe(omnibus);
    // Sin Account no hay cuenta fijada: ahí sigue haciendo falta conectar el omnibus.
    expect(pinnedXrplSigner({ TransactionType: 'Payment', Destination: 'rX', Amount: '1' })).toBeNull();
  });
});
