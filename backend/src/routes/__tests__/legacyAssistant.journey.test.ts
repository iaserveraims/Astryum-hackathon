/**
 * "Guía" — the journey context block appended to the Legacy assistant's system
 * prompt. Pins the privacy property (abstract flags only, and the block itself
 * restates the cage) and the next-step orientation.
 */
import { renderJourneyContext } from '../legacyAssistant';

describe('renderJourneyContext — the abstract journey block', () => {
  test('renders every known fact and the next-step instruction', () => {
    const block = renderJourneyContext({
      hasCouncil: true,
      memberCount: 4,
      quorum: 3,
      quorumMargin: 1,
      rehearsalComplete: true,
      signedCount: 4,
      masterKeyDisabled: false,
      constitutionAnchored: false,
      escrowCount: 2,
    });
    expect(block).toContain('Consejo constituido: sí (4 firmantes, quórum 3)');
    expect(block).toContain('Margen de quórum');
    expect(block).toContain('Ensayo de firmas verificado on-chain: sí (4/4 han firmado)');
    expect(block).toContain('Puerta cerrada (master key deshabilitada): no');
    expect(block).toContain('Constitución anclada: no');
    expect(block).toContain('Transferencias programadas activas: 2');
    // Orientation + the cage restated inside the block itself.
    expect(block).toMatch(/SIGUIENTE paso/);
    expect(block).toMatch(/sin ver datos personales y sin firmar nada/);
  });

  test('unknown facts render as "desconocido", never invented', () => {
    const block = renderJourneyContext({ hasCouncil: false });
    expect(block).toContain('Consejo constituido: no');
    expect(block).toContain('Ensayo de firmas verificado on-chain: desconocido');
    expect(block).toContain('Puerta cerrada (master key deshabilitada): desconocido');
    // Optional counters absent → their lines are omitted entirely.
    expect(block).not.toContain('Margen de quórum');
    expect(block).not.toContain('Transferencias programadas activas');
  });

  test('carries no address-shaped content (the privacy property, structurally)', () => {
    const block = renderJourneyContext({
      hasCouncil: true,
      memberCount: 5,
      quorum: 3,
      rehearsalComplete: false,
      signedCount: 1,
    });
    // Nothing that looks like an XRPL or EVM address can appear: the input
    // schema only admits booleans and small integers.
    expect(block).not.toMatch(/r[1-9A-HJ-NP-Za-km-z]{24,34}/);
    expect(block).not.toMatch(/0x[a-fA-F0-9]{40}/);
  });
});
