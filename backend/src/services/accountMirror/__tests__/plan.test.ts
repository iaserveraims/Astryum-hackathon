/**
 * El espejo de cuentas decide antes de tocar nada — y aquí se fija lo que decide.
 *
 * Lo que más importa: que se NIEGUE a correr donde podría hacer daño (su
 * propia base es la de producción), que no refleje a la gente de verdad sin
 * que alguien lo escriba a mano, que ADOPTE la cuenta que el preview ya tiene
 * en vez de sustituirla, y que las preferencias que producción no conoce se
 * queden como estaban — el «ignorarlo sin más» del fundador.
 */
import {
  mirrorVerdict,
  mirrorScope,
  inScope,
  resolveTarget,
  mergePreferences,
  MIRROR_DEFAULT_EVERY_MS,
} from '../plan';

const PROD = 'postgresql://ro:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres';
const STAGING = 'postgresql://app:secret@postgres.railway.internal:5432/railway';

describe('mirrorVerdict — ¿puede correr aquí?', () => {
  it('sin la variable de origen, apagado — el estado por defecto', () => {
    expect(mirrorVerdict({ DATABASE_URL: STAGING })).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('en el preview, con origen producción: corre', () => {
    const v = mirrorVerdict({ DATABASE_URL: STAGING, ACCOUNT_MIRROR_SOURCE_URL: PROD });
    expect(v).toEqual({ ok: true, sourceUrl: PROD, everyMs: MIRROR_DEFAULT_EVERY_MS });
  });

  it('LA GUARDA QUE IMPORTA: si la base propia es producción, NO corre — diga lo que diga la variable', () => {
    const v = mirrorVerdict({
      DATABASE_URL: PROD,
      ACCOUNT_MIRROR_SOURCE_URL: STAGING,
      NODE_ENV: 'production',
    });
    expect(v).toEqual({ ok: false, reason: 'own_database_is_production' });
  });

  it('origen y destino iguales: reflejarse a sí mismo no significa nada', () => {
    const v = mirrorVerdict({ DATABASE_URL: STAGING, ACCOUNT_MIRROR_SOURCE_URL: STAGING });
    expect(v).toEqual({ ok: false, reason: 'source_is_own_database' });
  });

  it('un origen que no es Postgres se rechaza', () => {
    const v = mirrorVerdict({ DATABASE_URL: STAGING, ACCOUNT_MIRROR_SOURCE_URL: 'https://example.com' });
    expect(v).toEqual({ ok: false, reason: 'source_url_invalid' });
  });

  it('el intervalo se puede fijar, y 0 significa «solo a demanda»', () => {
    expect(
      mirrorVerdict({ DATABASE_URL: STAGING, ACCOUNT_MIRROR_SOURCE_URL: PROD, ACCOUNT_MIRROR_EVERY_MS: '60000' }),
    ).toMatchObject({ ok: true, everyMs: 60_000 });
    expect(
      mirrorVerdict({ DATABASE_URL: STAGING, ACCOUNT_MIRROR_SOURCE_URL: PROD, ACCOUNT_MIRROR_EVERY_MS: '0' }),
    ).toMatchObject({ ok: true, everyMs: 0 });
  });

  it('un intervalo que no es un número cae al valor por defecto', () => {
    expect(
      mirrorVerdict({ DATABASE_URL: STAGING, ACCOUNT_MIRROR_SOURCE_URL: PROD, ACCOUNT_MIRROR_EVERY_MS: 'pronto' }),
    ).toMatchObject({ ok: true, everyMs: MIRROR_DEFAULT_EVERY_MS });
  });
});

describe('mirrorScope — ¿a quién refleja?', () => {
  it('sin listas, a nadie — y lo dice', () => {
    expect(mirrorScope({})).toEqual({ kind: 'nobody' });
  });

  it('los fundadores entran por ADMIN_EMAILS, las cuentas de prueba por ACCOUNT_MIRROR_EMAILS', () => {
    const s = mirrorScope({
      ADMIN_EMAILS: 'Founder@Astryum.xyz, otro@astryum.xyz',
      ACCOUNT_MIRROR_EMAILS: 'judgesdemo@gmail.com',
    });
    expect(s.kind).toBe('emails');
    expect(inScope(s, 'founder@astryum.xyz')).toBe(true);
    expect(inScope(s, '  JUDGESDEMO@gmail.com ')).toBe(true);
    expect(inScope(s, 'alguien@real.com')).toBe(false);
    expect(inScope(s, null)).toBe(false);
  });

  it('la gente de verdad sólo entra con un asterisco escrito a mano', () => {
    const s = mirrorScope({ ADMIN_EMAILS: 'founder@astryum.xyz', ACCOUNT_MIRROR_EMAILS: '*' });
    expect(s).toEqual({ kind: 'everyone' });
    expect(inScope(s, 'alguien@real.com')).toBe(true);
  });
});

describe('resolveTarget — la misma persona aterriza en SU fila del preview', () => {
  const prod = { id: 'p1', email: 'ge@gmail.com', oauthSub: 'xrplid:abc', xrplAddress: null };

  it('sin fila local: se crea con el mismo id que producción', () => {
    expect(resolveTarget(prod, [])).toEqual({ kind: 'create', id: 'p1' });
  });

  it('la misma fila (mismo id): se adopta tal cual', () => {
    expect(resolveTarget(prod, [{ ...prod }])).toEqual({ kind: 'adopt', id: 'p1', sameId: true });
  });

  it('la cuenta que el preview creó con el mismo email: SE ADOPTA, no se sustituye', () => {
    // Antes se borraba en cascada — y con ella el perfil de gestor, las
    // imágenes de bóveda y los apoyos que solo existen en el preview.
    const local = { id: 'local-9', email: 'GE@gmail.com', oauthSub: null, xrplAddress: null };
    expect(resolveTarget(prod, [local])).toEqual({ kind: 'adopt', id: 'local-9', sameId: false });
  });

  it('el email manda sobre los enganches cuando hay varias coincidencias', () => {
    const a = { id: 'a', email: null, oauthSub: 'xrplid:abc', xrplAddress: null };
    const b = { id: 'b', email: 'ge@gmail.com', oauthSub: null, xrplAddress: null };
    expect(resolveTarget(prod, [a, b])).toEqual({ kind: 'adopt', id: 'b', sameId: false });
  });

  it('sin email en producción, vale el enganche de XRP Identity', () => {
    const p = { id: 'p2', email: null, oauthSub: 'xrplid:zzz', xrplAddress: null };
    const a = { id: 'a', email: null, oauthSub: 'xrplid:zzz', xrplAddress: null };
    expect(resolveTarget(p, [a])).toEqual({ kind: 'adopt', id: 'a', sameId: false });
  });
});

describe('mergePreferences — producción manda, pero no borra lo que no conoce', () => {
  it('el check de gestor del preview SOBREVIVE — el «ignorarlo sin más»', () => {
    const local = { managerMode: true, appearance: 'institutional' };
    const prod = { legal: { termsVersion: '2026-09-13' }, appearance: 'astryum' };
    expect(mergePreferences(local, prod)).toEqual({
      managerMode: true,
      appearance: 'astryum',
      legal: { termsVersion: '2026-09-13' },
    });
  });

  it('sin preferencias locales, las de producción tal cual', () => {
    expect(mergePreferences(null, { legal: 1 })).toEqual({ legal: 1 });
  });

  it('sin preferencias en producción, se conservan las locales', () => {
    expect(mergePreferences({ managerMode: true }, null)).toEqual({ managerMode: true });
  });

  it('nada por ningún lado: null, no un objeto vacío', () => {
    expect(mergePreferences(null, undefined)).toBeNull();
  });

  it('basura que no es un objeto no rompe la fusión', () => {
    expect(mergePreferences('x', [1, 2])).toBeNull();
    expect(mergePreferences({ a: 1 }, 'x')).toEqual({ a: 1 });
  });
});
