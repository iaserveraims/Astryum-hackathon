/**
 * El catálogo como dato — y la red que impide que haya dos verdades.
 *
 * `protocols.ts` es ADITIVO: `strategyTaxonomy` y `DEMO_VAULTS` siguen mandando
 * en la pantalla de hoy. Eso está bien mientras algo obligue a los dos modelos a
 * decir lo mismo; en cuanto se separen, la pantalla dirá una cosa y el motor
 * otra, que es exactamente cómo se cuelan los bugs de esta familia.
 *
 * Así que estos tests no comprueban «que el fichero compile»: comprueban las
 * tres cosas que romperían el catálogo en silencio.
 *
 *   1. Que ninguna ruta viva se pierda ni se duplique al reagrupar.
 *   2. Que la tipología nueva y el `outcome` viejo no puedan discrepar.
 *   3. Que ningún hecho de riesgo contradiga a otro — la franja se DERIVA,
 *      nunca se escribe, y una card sin ruta jamás ofrece firmar.
 */
import { describe, it, expect } from 'vitest';
import {
  ACTIONS,
  PROTOCOLS,
  TYPOLOGIES,
  RISK_BANDS,
  actionOfKind,
  actionsOfTypology,
  builderOf,
  channelsOf,
  isExecutable,
  productsOfTypology,
  protocolOf,
  riskBand,
  type ProtocolId,
  type TypologyId,
} from '../protocols';
import { OUTCOMES, outcomeOf } from '../strategyTaxonomy';
import type { VaultKind } from '@/components/earn/FlareDemoEarn';

/** Las ocho rutas que el catálogo ejecuta hoy. Si alguien añade una novena y no
 *  la declara aquí, el primer test se lo dice. */
const LIVE_KINDS: VaultKind[] = ['e1', 'e2', 'e3', 'v-firelight', 'v-earnxrp', 'v-monarq', 'em-carry', 'em-lend'];

describe('ninguna ruta se pierde al reagrupar', () => {
  it('cada ruta viva tiene exactamente una acción', () => {
    for (const kind of LIVE_KINDS) {
      const hits = ACTIONS.filter((a) => a.kind === kind);
      expect(hits, `la ruta ${kind} debería tener UNA acción, tiene ${hits.length}`).toHaveLength(1);
    }
  });

  it('no declara rutas que no existen', () => {
    const declared = ACTIONS.map((a) => a.kind).filter((k): k is VaultKind => k !== null);
    for (const k of declared) expect(LIVE_KINDS).toContain(k);
  });

  it('ocho rutas caben en seis productos', () => {
    // La propiedad que hace que el catálogo no se multiplique: Kinetic y Morpho
    // aparecen dos veces (dos patas, dos tipologías) y siguen siendo una card.
    expect(ACTIONS).toHaveLength(8);
    expect(new Set(ACTIONS.map((a) => a.protocol)).size).toBe(6);
    expect(productsOfTypology('cash')).toEqual(['kinetic', 'morpho']);
  });

  it('toda acción apunta a un protocolo que existe, y todo protocolo se usa', () => {
    for (const a of ACTIONS) expect(protocolOf(a), `${a.protocol} no está en PROTOCOLS`).toBeTruthy();
    for (const id of Object.keys(PROTOCOLS)) {
      expect(ACTIONS.some((a) => a.protocol === id), `${id} no lo usa ninguna acción`).toBe(true);
    }
  });
});

describe('las dos fuentes no pueden discrepar', () => {
  /**
   * El puente entre el vocabulario viejo y el nuevo. Si alguien mueve una ruta
   * de sitio en uno de los dos ficheros, este test cae.
   *
   * Y hay UNA divergencia deliberada: el outcome «network» del modelo viejo se
   * fusiona en «earn» (fundador, 23-ago: «al final es lo mismo»). Desde la
   * pregunta del usuario —que mi dinero rinda sin deuda— delegar al FTSO es un
   * sitio más donde ponerlo a trabajar; que el token no salga de la wallet es un
   * hecho de esa card, no una tipología con su propia sección.
   */
  const OUTCOME_TO_TYPOLOGY: Record<string, TypologyId> = {
    earn: 'earn',
    liquidity: 'cash',
    network: 'earn',
  };

  it('la tipología nueva dice lo mismo que el outcome viejo, ruta por ruta', () => {
    for (const kind of LIVE_KINDS) {
      const outcome = outcomeOf(kind);
      const action = actionOfKind(kind);
      expect(outcome, `${kind} no tiene outcome`).not.toBeNull();
      expect(action, `${kind} no tiene acción`).not.toBeNull();
      expect(action!.typology, `${kind} está en dos sitios distintos`).toBe(
        OUTCOME_TO_TYPOLOGY[outcome as string],
      );
    }
  });

  it('quedan DOS tipologías vivas: los tres outcomes viejos caben en dos', () => {
    const live = TYPOLOGIES.filter((t) => t.live).map((t) => t.id);
    expect(new Set(live)).toEqual(new Set(['earn', 'cash']));
    // El modelo viejo sigue teniendo tres: la fusión es nuestra, no suya.
    expect(OUTCOMES).toHaveLength(3);
  });

  it('la delegación al FTSO vive en earn, no en su propia sección', () => {
    expect(actionOfKind('e2')!.typology).toBe('earn');
    expect(actionsOfTypology('earn').some((a) => a.protocol === 'ftso')).toBe(true);
  });

  it('las tipologías declaradas para el futuro no tienen producto — todavía', () => {
    for (const t of TYPOLOGIES.filter((x) => !x.live)) {
      expect(actionsOfTypology(t.id), `${t.id} está marcada como no viva pero tiene rutas`).toHaveLength(0);
    }
  });
});

describe('los hechos de riesgo no se contradicen', () => {
  it('la franja se deriva de los hechos, nunca se escribe', () => {
    // Kinetic prestar: sin deuda y decides tú.
    expect(riskBand(actionOfKind('e3')!)).toBe('safe');
    // Kinetic carry: hay deuda contra tu colateral.
    expect(riskBand(actionOfKind('e1')!)).toBe('liquidatable');
    // Monarq: sin deuda, pero decide un gestor fuera de la cadena.
    expect(riskBand(actionOfKind('v-monarq')!)).toBe('delegated');
    // Y las tres franjas existen como texto.
    expect(RISK_BANDS.map((b) => b.id)).toEqual(['safe', 'delegated', 'liquidatable']);
  });

  it('toda ruta de la tipología «cash» puede liquidarse, y ninguna de «earn»', () => {
    for (const a of actionsOfTypology('cash')) expect(a.risk.liquidation).not.toBe('none');
    for (const a of actionsOfTypology('earn')) expect(a.risk.liquidation).toBe('none');
  });

  it('pedir prestado nombra SIEMPRE el activo de la deuda', () => {
    // Hoy es un hecho, no un menú: cada mercado paga exactamente uno.
    for (const a of ACTIONS.filter((x) => x.id === 'borrow')) {
      expect(a.debtAsset, `${a.protocol} pide prestado sin decir qué`).toBeTruthy();
    }
  });

  it('lo que no es verificable on-chain lo dice, y no se cuela como seguro', () => {
    const monarq = ACTIONS.find((a) => a.protocol === 'upshift-monarq')!;
    expect(monarq.risk.verifiable).toBe(false);
    expect(monarq.risk.decides).toBe('offchain-manager');
    expect(riskBand(monarq)).not.toBe('safe');
  });

  it('una salida con cola lo dice en palabras, no solo en un enum', () => {
    for (const a of ACTIONS.filter((x) => x.risk.exit === 'cooldown' || x.risk.exit === 'epoch')) {
      expect(a.risk.exitNote, `${a.protocol} tiene cola y no la explica`).toBeTruthy();
    }
  });
});

describe('la pantalla nunca ofrece lo que no existe', () => {
  it('sin ruta construida no hay firma posible', () => {
    for (const a of ACTIONS) {
      if (a.kind === null) expect(isExecutable(a)).toBe(false);
    }
  });

  it('firmar exige un asset que la ruta admite', () => {
    const kinetic = actionOfKind('e3')!;
    expect(isExecutable(kinetic, 'FXRP')).toBe(true);
    // Kinetic tiene mercado de USDC.e, pero no hay ruta de preparación para él:
    // se puede leer, no firmar (barrido 2026-08-23).
    expect(isExecutable(kinetic, 'USDC.e')).toBe(false);
  });
});

describe('la ficha de empresa no puede mentir', () => {
  it('una auditoría o tiene enlace, o no existe', () => {
    for (const p of Object.values(PROTOCOLS)) {
      if (p.audit === null) continue;
      expect(p.audit.firm, `${p.id} tiene auditoría sin firma`).toBeTruthy();
      expect(p.audit.url, `${p.id} tiene auditoría sin enlace`).toMatch(/^https:\/\//);
    }
  });

  it('lo no publicado se queda en null — nunca un sello de oídas', () => {
    // Del barrido del ecosistema: en Flare solo Kinetic publica informe
    // localizable de las que tenemos conectadas.
    expect(PROTOCOLS.kinetic.audit).not.toBeNull();
    expect(PROTOCOLS.firelight.audit).toBeNull();
    expect(PROTOCOLS['upshift-monarq'].audit).toBeNull();
  });

  it('todo protocolo dice dónde vive', () => {
    for (const p of Object.values(PROTOCOLS)) expect(p.website).toMatch(/^https:\/\//);
  });
});

describe('el venue es el SITIO, no el producto', () => {
  it('earnXRP y Monarq son dos productos de UN venue', () => {
    expect(PROTOCOLS['upshift-earnxrp'].venue).toBe('Upshift');
    expect(PROTOCOLS['upshift-monarq'].venue).toBe('Upshift');
    // Y siguen siendo entradas distintas: lo que las separa —quién gestiona y
    // si se puede comprobar on-chain— no puede esconderse detrás de un nombre.
    expect(PROTOCOLS['upshift-earnxrp'].id).not.toBe(PROTOCOLS['upshift-monarq'].id);
  });

  it('todo protocolo dice en qué sitio vive', () => {
    for (const p of Object.values(PROTOCOLS)) expect(p.venue.length).toBeGreaterThan(0);
  });
});

describe('a quién se escribe cuando el problema es del sitio', () => {
  /**
   * Los venues que HOY no publican ningún canal enlazable. Está vacío, y esa
   * es la gracia: el día que se conecte uno que no publique nada, hay que
   * escribirlo AQUÍ. Así «este sitio no tiene puerta» es una decisión anotada
   * y no un campo que alguien se dejó sin rellenar — la misma disciplina que
   * `audit: null`.
   */
  const SIN_CANAL: ProtocolId[] = [];

  it('todo venue conectado tiene al menos una puerta, o está declarado sin ella', () => {
    for (const p of Object.values(PROTOCOLS)) {
      if (SIN_CANAL.includes(p.id)) {
        expect(p.support, `${p.id} está declarado sin canal pero tiene uno`).toHaveLength(0);
      } else {
        expect(p.support.length, `${p.id} no dice a quién escribir`).toBeGreaterThan(0);
      }
    }
  });

  it('cada puerta es un enlace que una persona puede abrir', () => {
    for (const p of Object.values(PROTOCOLS)) {
      for (const c of p.support) {
        // Un enlace muerto o relativo sería peor que ninguno (#9).
        expect(c.url, `${p.id} · ${c.name}`).toMatch(/^https:\/\/\S+$/);
        expect(c.name.trim().length, `${p.id} tiene una puerta sin nombre`).toBeGreaterThan(0);
      }
      const urls = p.support.map((c) => c.url);
      expect(new Set(urls).size, `${p.id} repite una puerta`).toBe(urls.length);
    }
  });

  it('el mismo venue enseña las mismas puertas', () => {
    // Upshift es UN sitio con dos productos: si un día divergen, la persona
    // que entró por Monarq escribiría a otro sitio que la que entró por
    // earnXRP, y sería el mismo dinero en la misma plataforma.
    expect(PROTOCOLS['upshift-monarq'].support).toEqual(PROTOCOLS['upshift-earnxrp'].support);
  });

  it('primero el mostrador, la red social la última', () => {
    // Morpho publica help centre + foro + docs + X: el orden no es el del
    // fichero, es el de la probabilidad de que alguien te conteste.
    const orden = channelsOf(PROTOCOLS.morpho).map((c) => c.kind);
    expect(orden).toEqual(['support', 'forum', 'docs', 'social']);
  });

  it('el límite recorta la cola, nunca reordena', () => {
    const dos = channelsOf(PROTOCOLS.kinetic, 2);
    expect(dos).toHaveLength(2);
    expect(dos).toEqual(channelsOf(PROTOCOLS.kinetic).slice(0, 2));
    // Y un límite mayor que la lista no inventa puertas.
    expect(channelsOf(PROTOCOLS.firelight, 9)).toHaveLength(PROTOCOLS.firelight.support.length);
  });

  it('el constructor nunca somos nosotros', () => {
    for (const p of Object.values(PROTOCOLS)) {
      expect(builderOf(p)).not.toMatch(/astryum/i);
      expect(builderOf(p).length).toBeGreaterThan(0);
    }
    // El FTSO es un protocolo de una red, no una empresa: «FTSO lo construyó»
    // sería una frase sobre nadie.
    expect(builderOf(PROTOCOLS.ftso)).toBe('Flare');
    expect(builderOf(PROTOCOLS.kinetic)).toBe('Kinetic');
  });
});
