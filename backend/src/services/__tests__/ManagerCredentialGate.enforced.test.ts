/**
 * La puerta del título de gestor está PUESTA en código.
 *
 * Era `MANAGER_GATE_ENABLED === 'true'`: apagada salvo que alguien se acordara.
 * Con el módulo institucional abierto y esa variable sin definir, cualquier cuenta
 * con sesión hacía nacer una jaula sin que nadie mirase su título. Lo que este
 * test fija: en producción ninguna variable la apaga; fuera, está puesta por
 * defecto y solo un `false` explícito la quita; y puesta sin emisores no pasa
 * nadie.
 */
import { evaluateManagerCredential, managerGateConfig, managerGateEnforced } from '../ManagerCredentialGate';

const SAVED = {
  node: process.env.NODE_ENV,
  gate: process.env.MANAGER_GATE_ENABLED,
  issuers: process.env.MANAGER_CREDENTIAL_ISSUERS,
};

afterEach(() => {
  const put = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  put('NODE_ENV', SAVED.node);
  put('MANAGER_GATE_ENABLED', SAVED.gate);
  put('MANAGER_CREDENTIAL_ISSUERS', SAVED.issuers);
});

describe('managerGateEnforced', () => {
  it('en producción está SIEMPRE puesta — ni sin variable, ni con false, ni con basura', () => {
    for (const v of [undefined, 'false', 'true', '0', '']) {
      expect(managerGateEnforced({ NODE_ENV: 'production', MANAGER_GATE_ENABLED: v } as NodeJS.ProcessEnv)).toBe(true);
    }
  });

  it('fuera de producción está puesta por defecto: no definir la variable ya no la apaga', () => {
    expect(managerGateEnforced({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe(true);
    expect(managerGateEnforced({ NODE_ENV: 'development', MANAGER_GATE_ENABLED: 'true' } as NodeJS.ProcessEnv)).toBe(true);
    expect(managerGateEnforced({} as NodeJS.ProcessEnv)).toBe(true);
  });

  it('solo un `false` literal, y solo fuera de producción, la quita', () => {
    expect(managerGateEnforced({ NODE_ENV: 'test', MANAGER_GATE_ENABLED: 'false' } as NodeJS.ProcessEnv)).toBe(false);
    expect(managerGateEnforced({ NODE_ENV: 'test', MANAGER_GATE_ENABLED: 'FALSE' } as NodeJS.ProcessEnv)).toBe(true);
    expect(managerGateEnforced({ NODE_ENV: 'test', MANAGER_GATE_ENABLED: '0' } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('managerGateConfig · lo que ve la ruta', () => {
  it('sin ninguna variable, la config sale con la puerta puesta', () => {
    delete process.env.MANAGER_GATE_ENABLED;
    expect(managerGateConfig().enabled).toBe(true);
  });

  it('puesta y sin emisores no pasa nadie: falla cerrada', () => {
    delete process.env.MANAGER_GATE_ENABLED;
    delete process.env.MANAGER_CREDENTIAL_ISSUERS;
    const cfg = managerGateConfig();
    expect(cfg.issuers.size).toBe(0);
    expect(evaluateManagerCredential([], cfg, 'rQ3fNyLjbvcDaPNS4EAJY8aT9zw3oLjAaY')).toEqual({ ok: false, code: 'NO_ISSUERS_CONFIGURED' });
  });
});
