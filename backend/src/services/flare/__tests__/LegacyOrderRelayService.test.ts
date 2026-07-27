/**
 * LegacyOrderRelayService — tests de los guards que deciden QUÉ se relaya.
 *
 * Igual que el gemelo 0xFE (DirectMintExecutorService.test): el carril completo
 * FDC (prepareRequest → fee → attestation → ronda → DA proof → bridge.execute)
 * es integración on-chain y se valida con el CLI/dry-run. Aquí se fija lo que se
 * puede fijar sin cadena y es lo que protege el dinero:
 *   1. `fetchXrplMemo` — la VERDAD del ledger: solo una tx validada, exitosa y
 *      con un memo de 32 bytes puede relayarse; todo lo demás aborta ANTES de
 *      pagar una sola attestation. Incluye el fallback entre nodos XRPL.
 *   2. Los abortos tempranos de `relayCouncilOrder` (txHash inválido, relayer
 *      deshabilitado) que ocurren antes de tocar la red.
 */
import { RelayAbort, relayCouncilOrder, _internals } from '../LegacyOrderRelayService';

const { fetchXrplMemo } = _internals;
const noop = () => {};

// ── fetchXrplMemo: la verdad del ledger (global.fetch mockeado) ──────────────

describe('fetchXrplMemo — solo relaya lo que el ledger validó', () => {
  const MEMO_LOWER = 'ab'.repeat(32); // 64 hex
  const originalFetch = global.fetch;
  const ORIGINAL_RPC = process.env.LEGACY_XRPL_RPC;

  const xrplResp = (result: unknown) => ({ json: async () => ({ result }) }) as unknown as Response;
  const validated = {
    validated: true,
    meta: { TransactionResult: 'tesSUCCESS' },
    Memos: [{ Memo: { MemoData: MEMO_LOWER } }],
  };

  beforeEach(() => {
    // Nodos deterministas: sin override, testXRP resuelve a 2 candidatos.
    delete process.env.LEGACY_XRPL_RPC;
    global.fetch = jest.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
    if (ORIGINAL_RPC === undefined) delete process.env.LEGACY_XRPL_RPC;
    else process.env.LEGACY_XRPL_RPC = ORIGINAL_RPC;
  });

  it('devuelve el memo en MAYÚSCULAS de una tx validada y exitosa', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(xrplResp(validated));
    const memo = await fetchXrplMemo('AB'.repeat(32), 'testXRP', noop);
    expect(memo).toBe(MEMO_LOWER.toUpperCase());
    expect(global.fetch).toHaveBeenCalledTimes(1); // el primer nodo respondió
  });

  it('aborta si la tx aún no está validada (no relaya lo no confirmado)', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(xrplResp({ validated: false }));
    await expect(fetchXrplMemo('AB'.repeat(32), 'testXRP', noop)).rejects.toThrow(/not validated/);
  });

  it('aborta si la tx no fue tesSUCCESS (nada que relayar)', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      xrplResp({ validated: true, meta: { TransactionResult: 'tecPATH_DRY' } }),
    );
    await expect(fetchXrplMemo('AB'.repeat(32), 'testXRP', noop)).rejects.toThrow(/did not succeed/);
  });

  it('aborta si no hay memo de 32 bytes (no es una orden del consejo)', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      xrplResp({ validated: true, meta: { TransactionResult: 'tesSUCCESS' }, Memos: [] }),
    );
    await expect(fetchXrplMemo('AB'.repeat(32), 'testXRP', noop)).rejects.toThrow(/no 32-byte order memo/);
  });

  it('un abort del ledger NO se enmascara probando el siguiente nodo', async () => {
    // El primer nodo responde "no validada": es un RelayAbort → se propaga tal
    // cual, sin caer al segundo nodo (una respuesta autoritativa manda).
    (global.fetch as jest.Mock).mockResolvedValueOnce(xrplResp({ validated: false }));
    await expect(fetchXrplMemo('AB'.repeat(32), 'testXRP', noop)).rejects.toThrow(RelayAbort);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('cae al siguiente nodo cuando el primero está caído (fallback de infra)', async () => {
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(xrplResp(validated));
    const memo = await fetchXrplMemo('AB'.repeat(32), 'testXRP', noop);
    expect(memo).toBe(MEMO_LOWER.toUpperCase());
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('aborta si NINGÚN nodo responde (no inventa una orden)', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(fetchXrplMemo('AB'.repeat(32), 'testXRP', noop)).rejects.toThrow(/no XRPL node answered/);
  });
});

// ── relayCouncilOrder: los abortos que ocurren ANTES de tocar la red ─────────

describe('relayCouncilOrder — guards previos a cualquier gasto', () => {
  const SAVED = {
    chain: process.env.LEGACY_CHAIN,
    bridge: process.env.LEGACY_BRIDGE_ADDRESS,
    vault: process.env.LEGACY_VAULT_ADDRESS,
    anchor: process.env.LEGACY_ORDER_ANCHOR,
    enabled: process.env.FLARE_EXECUTOR_ENABLED,
    pk: process.env.FLARE_EXECUTOR_PK,
  };

  beforeEach(() => {
    // Un stack "configurado" para pasar legacyStackConfig() sin desplegar nada.
    process.env.LEGACY_CHAIN = 'coston2';
    process.env.LEGACY_BRIDGE_ADDRESS = '0x' + '11'.repeat(20);
    process.env.LEGACY_VAULT_ADDRESS = '0x' + '22'.repeat(20);
    process.env.LEGACY_ORDER_ANCHOR = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';
  });
  afterEach(() => {
    for (const [k, v] of Object.entries({
      LEGACY_CHAIN: SAVED.chain,
      LEGACY_BRIDGE_ADDRESS: SAVED.bridge,
      LEGACY_VAULT_ADDRESS: SAVED.vault,
      LEGACY_ORDER_ANCHOR: SAVED.anchor,
      FLARE_EXECUTOR_ENABLED: SAVED.enabled,
      FLARE_EXECUTOR_PK: SAVED.pk,
    })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('rechaza un txHash que no sea 64 hex (antes de red o firma)', async () => {
    await expect(relayCouncilOrder({ xrplTxHash: 'zz', log: noop })).rejects.toThrow(/64 hex/);
  });

  it('aborta con el relayer deshabilitado — la prueba puede llevarla cualquiera', async () => {
    delete process.env.FLARE_EXECUTOR_ENABLED;
    process.env.FLARE_EXECUTOR_PK = '0x' + '01'.repeat(32);
    await expect(relayCouncilOrder({ xrplTxHash: 'AB'.repeat(32), log: noop })).rejects.toThrow(/disabled/);
  });

  it('aborta si falta FLARE_EXECUTOR_PK aunque esté habilitado', async () => {
    process.env.FLARE_EXECUTOR_ENABLED = 'true';
    delete process.env.FLARE_EXECUTOR_PK;
    await expect(relayCouncilOrder({ xrplTxHash: 'AB'.repeat(32), log: noop })).rejects.toThrow(/disabled/);
  });
});
