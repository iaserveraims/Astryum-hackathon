import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extract } from '../../legacy/__tests__/extractFromSource';

/**
 * LA PALABRA DE LA ENTREGA EN LAS
 * SUPERFICIES INSIGNIA.
 */

const src = (...p: string[]) => readFileSync(join(__dirname, '..', '..', ...p), 'utf8');

const PA_ACTIONS = src('positions', 'PaActionsModal.tsx');
const FLARE_EARN = src('earn', 'FlareDemoEarn.tsx');
const SURFACES: Array<[string, string]> = [
  ['WalletTransferModals', src('wallet', 'WalletTransferModals.tsx')],
  ['VaultClaimModal', src('positions', 'VaultClaimModal.tsx')],
  ['VaultWithdrawModal', src('positions', 'VaultWithdrawModal.tsx')],
  ['BorrowFlowRunner', src('earn', 'BorrowFlowRunner.tsx')],
  ['PaActionsModal', PA_ACTIONS],
  ['FlareDemoEarn', FLARE_EARN],
];

const ADAPTER_TS =
  'function noteHandoffDelivery(body: { xrplPayment?: unknown; serverDelivery?: { executorEnabled?: unknown } } | null | undefined): void {';
const ADAPTER_JS = 'function noteHandoffDelivery(body) {';

describe('el adaptador que las pantallas usan reenvía lo que el servidor dijo', () => {
  for (const [name, source] of [
    ['PaActionsModal', PA_ACTIONS],
    ['FlareDemoEarn', FLARE_EARN],
  ] as Array<[string, string]>) {
    it(`${name}: pasa el 0xFE y la palabra del servidor tal cual`, () => {
      const spy = vi.fn();
      const note = extract<(b: unknown) => void>(source, ADAPTER_TS, ADAPTER_JS, 'noteHandoffDelivery', {
        noteFlareInstructionDelivery: spy,
      });
      const tx = { TransactionType: 'Payment', Memos: [] };
      note({ xrplPayment: tx, serverDelivery: { executorEnabled: true } });
      expect(spy).toHaveBeenCalledWith(tx, { executorEnabled: true });
    });

    it(`${name}: una ruta que no manda la palabra no la inventa (queda NEUTRAL)`, () => {
      const spy = vi.fn();
      const note = extract<(b: unknown) => void>(source, ADAPTER_TS, ADAPTER_JS, 'noteHandoffDelivery', {
        noteFlareInstructionDelivery: spy,
      });
      note({ xrplPayment: { TransactionType: 'Payment' } });
      expect(spy).toHaveBeenCalledWith({ TransactionType: 'Payment' }, undefined);
      // Ni un cuerpo vacío ni uno nulo pueden reventar una preparación válida.
      note({});
      note(null);
      note(undefined);
      expect(spy).toHaveBeenCalledTimes(4);
    });
  }
});

describe('las seis superficies insignia registran la entrega', () => {
  for (const [name, source] of SURFACES) {
    it(`${name} importa el registro y lo llama`, () => {
      expect(source, `${name} must import the registry`).toMatch(
        /import \{[^}]*noteFlareInstructionDelivery[^}]*\} from/,
      );
      // Importado y además LLAMADO: un import huérfano no registra nada. Las
      // llamadas se cuentan sin la línea del import (que no lleva paréntesis) y
      // sin la declaración del adaptador (que lleva su firma tipada delante).
      const calls =
        (source.match(/(?<!function )noteFlareInstructionDelivery\(/g) ?? []).length +
        (source.match(/(?<!function )noteHandoffDelivery\(/g) ?? []).length;
      expect(calls, `${name} must CALL it, not only import it`).toBeGreaterThan(0);
    });
  }

  it('PaActionsModal lo hace en las CUATRO preparaciones 0xFE, no en una', () => {
    const seats = PA_ACTIONS.match(/noteHandoffDelivery\(body\);\s*\n\s*setPrepared\(body as XrplPrepared\);/g) ?? [];
    expect(seats).toHaveLength(4);
  });

  it('VaultWithdrawModal — la que no enseñaba nada del asiento — ya monta el aviso', () => {
    const withdraw = src('positions', 'VaultWithdrawModal.tsx');
    expect(withdraw).toContain('<SeatRefusalNotice');
    expect(withdraw).toContain('fallbackMemoHex={abandonedMemo.current}');
  });
});
