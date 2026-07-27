import { buildProductAssistantSystemPrompt, PRODUCT_KNOWLEDGE_BASE } from '../productAssistantPrompt';

describe('productAssistantPrompt — the agent cage', () => {
  test('system prompt carries every cage rule (no user data, no advice, no execution, concrete-first, no invention)', () => {
    const p = buildProductAssistantSystemPrompt();
    expect(p).toMatch(/NO ves NADA del usuario/i);
    expect(p).toMatch(/NO das consejo/i);
    expect(p).toMatch(/NO ejecutas ni construyes nada/i);
    expect(p).toMatch(/NO inventas/i);
    expect(p).toMatch(/CONCRETO ANTES QUE ABSTRACTO/i);
    expect(p).toMatch(/@Astryum_/); // support channel, not a phantom
    expect(p).toMatch(/MANUAL DE ASTRYUM/); // the manual section is appended
  });

  test('cage teaches the [[goto:ROUTE|LABEL]] navigation marker with a closed, literal allowlist', () => {
    const p = buildProductAssistantSystemPrompt();
    expect(p).toMatch(/\[\[goto:RUTA\|ETIQUETA\]\]/); // the exact marker shape the model must reproduce
    expect(p).toMatch(/Máximo 2 marcadores/i);
    expect(p).toMatch(/nunca inventes una ruta/i);
    // every allowlisted destination named literally, so the model can't drift the route strings
    for (const route of [
      '/app',
      '/app/asset-production',
      '/app/asset-production?view=movements',
      '/app/portfolio',
      '/app/portfolio?tab=positions',
      '/app/wallets',
      '/app/legacy',
      '/app/settings',
      '/app/intents',
    ]) {
      expect(p).toContain(route);
    }
  });

  test('ships the real product manual (§1-7), not a placeholder', () => {
    expect(PRODUCT_KNOWLEDGE_BASE).not.toMatch(/PLACEHOLDER/);
    expect(PRODUCT_KNOWLEDGE_BASE).toMatch(/MANUAL DE PRODUCTO/);
    expect(PRODUCT_KNOWLEDGE_BASE).toMatch(/Health Factor/);
    expect(PRODUCT_KNOWLEDGE_BASE).toMatch(/Carry/);
    expect(PRODUCT_KNOWLEDGE_BASE).toMatch(/Earn/);
    expect(PRODUCT_KNOWLEDGE_BASE).toMatch(/Estrategias/);
    expect(PRODUCT_KNOWLEDGE_BASE).toMatch(/@Astryum_/); // real support channel, not a phantom
    expect(PRODUCT_KNOWLEDGE_BASE).toMatch(/NO-CUSTODIAL/i);
  });

  test('§7 demonstrates the goto marker on the two navigation questions the client screenshots', () => {
    expect(PRODUCT_KNOWLEDGE_BASE).toMatch(/¿Dónde vinculo mis wallets\?/);
    expect(PRODUCT_KNOWLEDGE_BASE).toContain('[[goto:/app/wallets|Wallets]]');
    expect(PRODUCT_KNOWLEDGE_BASE).toMatch(/¿Cómo pongo mi dinero a trabajar\?/);
    expect(PRODUCT_KNOWLEDGE_BASE).toContain('[[goto:/app/asset-production|Earn]]');
  });

  test('PRODUCT_ASSISTANT_KB env overrides the placeholder (team drops the manual in)', () => {
    jest.resetModules();
    const prev = process.env.PRODUCT_ASSISTANT_KB;
    process.env.PRODUCT_ASSISTANT_KB = 'CUSTOM MANUAL BODY';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../productAssistantPrompt');
    expect(mod.PRODUCT_KNOWLEDGE_BASE).toBe('CUSTOM MANUAL BODY');
    expect(mod.buildProductAssistantSystemPrompt()).toContain('CUSTOM MANUAL BODY');
    if (prev === undefined) delete process.env.PRODUCT_ASSISTANT_KB;
    else process.env.PRODUCT_ASSISTANT_KB = prev;
  });
});
