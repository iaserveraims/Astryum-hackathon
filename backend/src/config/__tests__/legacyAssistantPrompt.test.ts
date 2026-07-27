import { buildLegacyAssistantSystemPrompt, LEGACY_KNOWLEDGE_BASE } from '../legacyAssistantPrompt';

describe('legacyAssistantPrompt — the discovery agent cage', () => {
  test('system prompt carries every cage rule (never signs, no user data, no advice, forbidden copy, honest protection, no invention, brief)', () => {
    const p = buildLegacyAssistantSystemPrompt();
    expect(p).toMatch(/NO firmas, NO construyes transacciones/i);
    expect(p).toMatch(/NO ves datos del usuario ni los pides/i);
    expect(p).toMatch(/INTENCIÓN ABSTRACTA/i);
    expect(p).toMatch(/NO das consejo financiero ni legal/i);
    expect(p).toMatch(/COPY PROHIBIDO/i);
    expect(p).toMatch(/la IA compila, el usuario firma/i); // invariant #8, spelled out
    expect(p).toMatch(/@Astryum_/); // real support channel, not a phantom
    expect(p).toMatch(/MANUAL DE LEGACY/); // the manual section is appended
  });

  test('cage names the forbidden L5 legal words as forbidden (so the agent avoids them)', () => {
    const p = buildLegacyAssistantSystemPrompt();
    // They appear ONLY inside the "never use these words" rule.
    expect(p).toMatch(/nunca uses estas palabras.*testamento/is);
    for (const word of ['testamento', 'herencia', 'fideicomiso', 'sucesión']) {
      expect(p.toLowerCase()).toContain(word);
    }
  });

  test('privacy invariant is explicit: the constitution text never leaves the browser', () => {
    const p = buildLegacyAssistantSystemPrompt();
    expect(p).toMatch(/NUNCA sale de su navegador/i);
  });

  test('ships the real Legacy manual (the journey + the templates), not a placeholder', () => {
    expect(LEGACY_KNOWLEDGE_BASE).not.toMatch(/PLACEHOLDER/i);
    expect(LEGACY_KNOWLEDGE_BASE).toMatch(/EL RECORRIDO/);
    expect(LEGACY_KNOWLEDGE_BASE).toMatch(/CONSEJO/);
    expect(LEGACY_KNOWLEDGE_BASE).toMatch(/ENSAYO/);
    expect(LEGACY_KNOWLEDGE_BASE).toMatch(/CERRAR LA PUERTA/);
    expect(LEGACY_KNOWLEDGE_BASE).toMatch(/CONSTITUCIÓN/);
    expect(LEGACY_KNOWLEDGE_BASE).toMatch(/LAS PLANTILLAS/);
    expect(LEGACY_KNOWLEDGE_BASE).toMatch(/FAMILIAR/);
  });

  test('the availability truth: FAMILIAR (family of 4, quorum 3) is the only usable template; the rest are preview', () => {
    expect(LEGACY_KNOWLEDGE_BASE).toMatch(/DISPONIBLE HOY/);
    expect(LEGACY_KNOWLEDGE_BASE).toMatch(/FAMILIAR \(patrimonio de familia\): el caso de lanzamiento — una familia de 4 con quórum 3/);
    expect(LEGACY_KNOWLEDGE_BASE).toMatch(/EN PREVIEW/);
    expect(LEGACY_KNOWLEDGE_BASE).toMatch(/PERSONAL \(patrimonio de una persona\)/); // still described, as preview
    expect(LEGACY_KNOWLEDGE_BASE).toMatch(/no prometas fechas/i);
  });

  test('LEGACY_ASSISTANT_KB env overrides the inline manual (team hot-swaps without a deploy)', () => {
    jest.resetModules();
    const prev = process.env.LEGACY_ASSISTANT_KB;
    process.env.LEGACY_ASSISTANT_KB = 'CUSTOM LEGACY MANUAL BODY';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../legacyAssistantPrompt');
    expect(mod.LEGACY_KNOWLEDGE_BASE).toBe('CUSTOM LEGACY MANUAL BODY');
    expect(mod.buildLegacyAssistantSystemPrompt()).toContain('CUSTOM LEGACY MANUAL BODY');
    if (prev === undefined) delete process.env.LEGACY_ASSISTANT_KB;
    else process.env.LEGACY_ASSISTANT_KB = prev;
  });
});
