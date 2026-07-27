/**
 * "Operar" — the NL → intent compiler's output contract. Pins the properties
 * that make it invariant-#8-safe: the model can only express a closed set of
 * intents, raw addresses are structurally rejected, garbage yields null.
 */
import { parseCompiledIntent } from '../legacyAssistant';

describe('parseCompiledIntent — the compiler output contract', () => {
  test('accepts a full escrow-create intent with a scrubbed token destination', () => {
    const intent = parseCompiledIntent(
      '{"action":"escrow-create","amountXrp":200,"deliveryDateISO":"2027-01-01","recoveryDateISO":"2028-01-01","destination":"{{DIR_1}}","summary":"200 XRP al beneficiario el 1 de enero"}',
    );
    expect(intent).not.toBeNull();
    expect(intent).toMatchObject({ action: 'escrow-create', amountXrp: 200, destination: '{{DIR_1}}' });
  });

  test('accepts SELF and null fields (nothing invented)', () => {
    const intent = parseCompiledIntent(
      '{"action":"escrow-create","amountXrp":null,"deliveryDateISO":null,"recoveryDateISO":null,"destination":"SELF"}',
    );
    expect(intent).toMatchObject({ action: 'escrow-create', destination: 'SELF', amountXrp: null });
  });

  test('REJECTS a raw XRPL address as destination (structural privacy)', () => {
    const intent = parseCompiledIntent(
      '{"action":"escrow-create","amountXrp":5,"deliveryDateISO":"2027-01-01","recoveryDateISO":null,"destination":"rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf"}',
    );
    expect(intent).toBeNull();
  });

  test('extracts the JSON even when the model wraps it in prose', () => {
    const intent = parseCompiledIntent('Aquí tienes: {"action":"did-amend","summary":"enmendar"} — listo.');
    expect(intent).toMatchObject({ action: 'did-amend' });
  });

  test('none intent carries its reason; unknown actions and garbage yield null', () => {
    expect(parseCompiledIntent('{"action":"none","reason":"fuera de alcance"}')).toMatchObject({ action: 'none' });
    expect(parseCompiledIntent('{"action":"send-everything-now"}')).toBeNull();
    expect(parseCompiledIntent('no json at all')).toBeNull();
    expect(parseCompiledIntent('{"action":"escrow-create","amountXrp":-5}')).toBeNull();
  });
});
