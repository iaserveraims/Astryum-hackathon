/**
 * LOS CUATRO A LOS MANDOS.
 *
 * Fundador, 2026-09-19: «la respuesta a quién gobierna es autocustodia, empresa,
 * exchange y agente, porque estos son los que van a estar en los mandos. Una
 * familia, tú y otros y tu gestor es self custody con las subcuentas
 * personalizadas». Y sobre la forma: «el concepto de la landing actual por
 * todas partes, pero por cada producto distinto debe cambiar la sobriedad y
 * algo más».
 *
 * Aquí vive ese «algo más», como DATO y en un solo sitio: la escena (el
 * instrumento con el que se mira el mismo cielo), el material (radio, trazo,
 * brillo), el token de color, el aviso honesto de estado y el vocabulario de
 * las láminas. Cada mundo de la landing lo lee de aquí; ninguno lo repite.
 *
 *   · self      — el sistema solar, a simple vista. Oro, expresivo.
 *   · business  — la carta estelar: el mismo cielo, medido. Bronce, línea fina.
 *   · exchange  — la estación en anillo: un muelle por cliente. Platino, denso.
 *   · agent     — la sonda con su corredor. Plata, trazo discontinuo.
 *
 * ── LO QUE NO ES DATO DE AQUÍ ────────────────────────────────────────────
 * Ni una cifra de rendimiento, ni una promesa, ni «recomendamos», ni «el agente
 * decide» (INVARIANTS #8 y #9). Las cifras de las consolas son maqueta y se
 * rotulan como tal. El agente se describe siempre como DESIGNADO y acotado:
 * la IA prepara, el dueño firma los límites una vez, el contrato los impone.
 * El test de al lado (`governors.test.ts`) lo vigila palabra a palabra.
 */

import { WORLD_ROUTES } from '../../lib/nav/mandosLanding';

export type GovernorId = 'self' | 'business' | 'exchange' | 'agent';
export type Bi = { es: string; en: string };

/** El estado, en tres tonos: vivo (verde), en validación (oro), en preparación (gris). */
export type Readiness = 'live' | 'soon' | 'prep';

export interface GovernorConsole {
  root: Bi;
  cred: Bi;
  metricLabel: Bi;
  /** Cifra de MAQUETA. Se rotula «datos de ejemplo» en pantalla. */
  metric: string;
  rows: Array<{ label: Bi; pct: number; color: string }>;
  foot: Bi;
  accounts: Array<{ name: Bi; sub: Bi; rule: Bi }>;
  seats: Array<{ label: Bi; signed: boolean }>;
  quorum: Bi;
  signLine: Bi;
  title: Bi;
  changes: Bi[];
  cta: { label: Bi; href: string };
}

export interface GovernorPass {
  name: Bi;
  origin: Bi;
  dest: Bi;
  fields: Array<{ k: Bi; v: Bi }>;
  foot: Bi;
  sign: Bi;
}

export interface Governor {
  id: GovernorId;
  route: string;
  label: Bi;
  scene: Bi;
  /** El valor de `data-product` en la raíz de la landing: decide los tokens `--volt*`. */
  product: 'personal' | 'institutional' | 'exchange' | 'agent';
  /** El token del producto (`--product-*`), para pintar «del color del
   *  producto» sin hex y con la alfa que haga falta: `hsl(var(token) / a)`. */
  token: string;
  accent: string;
  ink: string;
  /** La frase de la tarjeta: quién firma, en cinco palabras. */
  tagline: Bi;
  /** El material: cuanto más sobrio el mundo, menos radio, menos brillo. */
  radius: number;
  innerRadius: number;
  dashed: boolean;
  glow: boolean;
  /** Del 1 (expresivo) al 4 (mínimo): lo que cambia además del color. */
  sobriety: 1 | 2 | 3 | 4;
  readiness: Readiness;
  notice: Bi;
  /** El vocabulario de las láminas de este mundo, como lo diría su público. */
  vocabulary: Bi;
  console: GovernorConsole;
  pass: GovernorPass;
}

const XRP = '#5B8DEF';
const FLR = '#EC4899';

export const GOVERNORS: readonly Governor[] = [
  {
    id: 'self',
    route: WORLD_ROUTES.self,
    label: { es: 'Autocustodia', en: 'Self-custody' },
    scene: { es: 'El sistema solar', en: 'The solar system' },
    product: 'personal',
    token: '--product-personal',
    accent: 'hsl(var(--product-personal))',
    ink: 'hsl(var(--product-personal-ink))',
    tagline: { es: 'Tú firmas. Y dentro, tus cuentas.', en: 'You sign. And inside, your accounts.' },
    radius: 20,
    innerRadius: 12,
    dashed: false,
    glow: true,
    sobriety: 1,
    readiness: 'live',
    notice: { es: 'En vivo · Flare mainnet', en: 'Live · Flare mainnet' },
    vocabulary: { es: 'patrimonio · órbita · salud', en: 'net worth · orbit · health' },
    console: {
      root: { es: 'Raíz XRPL · tu wallet', en: 'XRPL root · your wallet' },
      cred: { es: 'Ninguna', en: 'None' },
      metricLabel: { es: 'Patrimonio neto', en: 'Net worth' },
      metric: '$24,918',
      rows: [
        { label: { es: 'XRPL', en: 'XRPL' }, pct: 62, color: XRP },
        { label: { es: 'Flare', en: 'Flare' }, pct: 38, color: FLR },
      ],
      foot: { es: 'Salud 1.86', en: 'Health 1.86' },
      accounts: [
        { name: { es: 'Principal', en: 'Main' }, sub: { es: 'La de siempre', en: 'The usual one' }, rule: { es: 'Solo tu firma', en: 'Your signature only' } },
        { name: { es: 'Compartida', en: 'Shared' }, sub: { es: 'Pareja, socios, familia', en: 'Partner, associates, family' }, rule: { es: '2 de 3', en: '2 of 3' } },
        { name: { es: 'Con gestor', en: 'With a manager' }, sub: { es: 'Dirige dentro de una jaula · tú sales', en: 'Directs inside a cage · you exit' }, rule: { es: 'La jaula', en: 'The cage' } },
      ],
      seats: [{ label: { es: 'Tú', en: 'You' }, signed: true }],
      quorum: { es: '1 de 1', en: '1 of 1' },
      signLine: { es: 'Firmas tú. En las demás cuentas te sientas como un firmante más.', en: 'You sign. In the other accounts you sit as one more signer.' },
      title: { es: 'Tú firmas. Y dentro, las cuentas que necesites.', en: 'You sign. And inside, the accounts you need.' },
      changes: [
        { es: 'Sin credencial: basta tu wallet.', en: 'No credential: your wallet is enough.' },
        { es: 'Compartes una cuenta por quórum: pareja, socios, familia.', en: 'You share an account by quorum: partner, associates, family.' },
        { es: 'Un gestor dirige dentro de una jaula; tú sales cuando quieras.', en: 'A manager directs inside a cage; you exit whenever you want.' },
      ],
      cta: { label: { es: 'Conocer Autocustodia', en: 'Explore Self-custody' }, href: WORLD_ROUTES.self },
    },
    pass: {
      name: { es: 'Tarjeta de embarque', en: 'Boarding pass' },
      origin: { es: 'Tu wallet', en: 'Your wallet' },
      dest: { es: 'Flare mainnet', en: 'Flare mainnet' },
      fields: [
        { k: { es: 'Custodia', en: 'Custody' }, v: { es: 'Tuya', en: 'Yours' } },
        { k: { es: 'Comisiones', en: 'Fees' }, v: { es: 'Visibles antes', en: 'Shown first' } },
        { k: { es: 'Simulación', en: 'Simulation' }, v: { es: 'Siempre previa', en: 'Always first' } },
      ],
      foot: { es: 'Trayectoria preparada · la firmas tú', en: 'Trajectory prepared · you sign it' },
      sign: { es: 'Firma aquí', en: 'Sign here' },
    },
  },
  {
    id: 'business',
    route: WORLD_ROUTES.business,
    label: { es: 'Empresa', en: 'Business' },
    scene: { es: 'La carta estelar', en: 'The star chart' },
    product: 'institutional',
    token: '--product-institutional',
    accent: 'hsl(var(--product-institutional))',
    ink: 'hsl(var(--product-institutional-ink))',
    tagline: { es: 'Firma el órgano de la entidad.', en: 'The entity’s body signs.' },
    radius: 6,
    innerRadius: 4,
    dashed: false,
    glow: false,
    sobriety: 2,
    readiness: 'prep',
    notice: { es: 'Para entidades · en preparación', en: 'For entities · in preparation' },
    vocabulary: { es: 'liquidez · exposición · liquidación', en: 'liquidity · exposure · settlement' },
    console: {
      root: { es: 'Raíz XRPL · la entidad', en: 'XRPL root · the entity' },
      cred: { es: 'KYB', en: 'KYB' },
      metricLabel: { es: 'Liquidez disponible hoy', en: 'Liquidity available today' },
      metric: '1,108,600 XRP',
      rows: [
        { label: { es: 'Ahora', en: 'Now' }, pct: 23, color: 'hsl(var(--volt-soft))' },
        { label: { es: 'En 24 h', en: 'In 24 h' }, pct: 31, color: 'hsl(var(--volt))' },
        { label: { es: 'Con cola', en: 'Queued' }, pct: 46, color: 'hsl(var(--volt-deep))' },
      ],
      foot: { es: 'Reserva mínima · cumplida', en: 'Minimum reserve · met' },
      accounts: [
        { name: { es: 'Tesorería', en: 'Treasury' }, sub: { es: 'El grueso, bajo el órgano', en: 'The bulk, under the body' }, rule: { es: '2 de 4', en: '2 of 4' } },
        { name: { es: 'Operativa', en: 'Operating' }, sub: { es: 'El día a día', en: 'Day to day' }, rule: { es: '1 de 2', en: '1 of 2' } },
        { name: { es: 'Reserva', en: 'Reserve' }, sub: { es: 'Lo que casi nunca se toca', en: 'What is almost never touched' }, rule: { es: '3 de 4', en: '3 of 4' } },
      ],
      seats: [
        { label: { es: 'Órgano', en: 'Body' }, signed: true },
        { label: { es: 'Órgano', en: 'Body' }, signed: true },
        { label: { es: 'Órgano', en: 'Body' }, signed: false },
        { label: { es: 'Órgano', en: 'Body' }, signed: false },
      ],
      quorum: { es: '2 de 4', en: '2 of 4' },
      signLine: { es: 'Firma el órgano de la entidad, no una persona.', en: 'The entity’s governing body signs, not a person.' },
      title: { es: 'Firma el órgano de la entidad.', en: 'The entity’s governing body signs.' },
      changes: [
        { es: 'La raíz lleva la credencial de la entidad.', en: 'The root carries the entity’s credential.' },
        { es: 'Cada cuenta, con su quórum.', en: 'Each account, with its quorum.' },
        { es: 'Los límites de exposición, en contrato.', en: 'Exposure limits, in a contract.' },
      ],
      cta: { label: { es: 'Conocer Empresa', en: 'Explore Business' }, href: WORLD_ROUTES.business },
    },
    pass: {
      name: { es: 'Hoja de ruta', en: 'Route sheet' },
      origin: { es: 'La entidad', en: 'The entity' },
      dest: { es: 'Flare mainnet', en: 'Flare mainnet' },
      fields: [
        { k: { es: 'Llaves', en: 'Keys' }, v: { es: 'De la entidad', en: 'The entity’s' } },
        { k: { es: 'Firma', en: 'Signature' }, v: { es: 'El órgano', en: 'The body' } },
        { k: { es: 'Registro', en: 'Record' }, v: { es: 'Cada paso', en: 'Every step' } },
      ],
      foot: { es: 'Operación preparada · la firma el órgano', en: 'Operation prepared · the body signs it' },
      sign: { es: 'Firma el órgano', en: 'The body signs' },
    },
  },
  {
    id: 'exchange',
    route: WORLD_ROUTES.exchange,
    label: { es: 'Exchange', en: 'Exchange' },
    scene: { es: 'La estación', en: 'The station' },
    product: 'exchange',
    token: '--product-exchange',
    accent: 'hsl(var(--product-exchange))',
    ink: 'hsl(var(--product-exchange-ink))',
    tagline: { es: 'Firma la llave del exchange.', en: 'The exchange’s key signs.' },
    radius: 4,
    innerRadius: 2,
    dashed: false,
    glow: false,
    sobriety: 3,
    readiness: 'prep',
    notice: { es: 'Piloto · en preparación', en: 'Pilot · in preparation' },
    vocabulary: { es: 'ómnibus · casillas · reserva', en: 'omnibus · slots · reserve' },
    console: {
      root: { es: 'Raíz XRPL · el exchange', en: 'XRPL root · the exchange' },
      cred: { es: 'CASP + KYB', en: 'CASP + KYB' },
      metricLabel: { es: 'Capital de clientes en Flare', en: 'Client capital on Flare' },
      metric: '4,820,000 XRP',
      rows: [
        { label: { es: 'En venues', en: 'In venues' }, pct: 78, color: 'hsl(var(--volt))' },
        { label: { es: 'Reserva', en: 'Reserve' }, pct: 22, color: 'hsl(var(--volt-soft))' },
      ],
      foot: { es: 'Conciliado · 0 descuadres', en: 'Reconciled · 0 mismatches' },
      accounts: [
        { name: { es: 'Ómnibus', en: 'Omnibus' }, sub: { es: 'Del exchange, con su llave', en: 'The exchange’s, with its key' }, rule: { es: 'Su llave', en: 'Its key' } },
        { name: { es: 'Casillas', en: 'Slots' }, sub: { es: 'Una por cliente', en: 'One per client' }, rule: { es: 'KYC por casilla', en: 'KYC per slot' } },
        { name: { es: 'Pote de clientes', en: 'Client pot' }, sub: { es: 'Venues · tope · reserva', en: 'Venues · cap · reserve' }, rule: { es: 'En contrato', en: 'In contract' } },
      ],
      seats: [{ label: { es: 'Exchange', en: 'Exchange' }, signed: true }],
      quorum: { es: 'Su llave', en: 'Its key' },
      signLine: { es: 'Firma desde su ómnibus. Astryum no tiene ninguno.', en: 'It signs from its omnibus. Astryum has none.' },
      title: { es: 'Firma la llave del exchange.', en: 'The exchange’s key signs.' },
      changes: [
        { es: 'Su instancia, su ómnibus, sus clientes.', en: 'Its instance, its omnibus, its clients.' },
        { es: 'KYC casilla a casilla: Astryum no admite a nadie.', en: 'KYC slot by slot: Astryum admits no one.' },
        { es: 'La reserva y los topes, en contrato.', en: 'The reserve and the caps, in a contract.' },
      ],
      cta: { label: { es: 'Conocer Exchange', en: 'Explore Exchange' }, href: WORLD_ROUTES.exchange },
    },
    pass: {
      name: { es: 'Manifiesto de atraque', en: 'Docking manifest' },
      origin: { es: 'Tu ómnibus', en: 'Your omnibus' },
      dest: { es: 'Pote en Flare', en: 'Pot on Flare' },
      fields: [
        { k: { es: 'Llave', en: 'Key' }, v: { es: 'Del exchange', en: 'The exchange’s' } },
        { k: { es: 'Clientes', en: 'Clients' }, v: { es: 'Por casilla', en: 'Per slot' } },
        { k: { es: 'Salida', en: 'Exit' }, v: { es: 'Siempre abierta', en: 'Always open' } },
      ],
      foot: { es: 'Operación preparada · la firma tu llave', en: 'Operation prepared · your key signs it' },
      sign: { es: 'Firma el exchange', en: 'The exchange signs' },
    },
  },
  {
    id: 'agent',
    route: WORLD_ROUTES.agent,
    label: { es: 'Agente', en: 'Agent' },
    scene: { es: 'La sonda', en: 'The probe' },
    product: 'agent',
    token: '--product-agent',
    accent: 'hsl(var(--product-agent))',
    ink: 'hsl(var(--product-agent-ink))',
    tagline: { es: 'El dueño firma los límites. Una vez.', en: 'The owner signs the limits. Once.' },
    radius: 14,
    innerRadius: 10,
    dashed: true,
    glow: false,
    sobriety: 4,
    readiness: 'prep',
    notice: { es: 'En diseño · no disponible', en: 'In design · not available' },
    vocabulary: { es: 'mandato · corredor · revocación', en: 'mandate · corridor · revocation' },
    console: {
      root: { es: 'Raíz XRPL · quien lo designa', en: 'XRPL root · whoever appoints it' },
      cred: { es: 'Designación revocable', en: 'Revocable appointment' },
      metricLabel: { es: 'Capital bajo mandato', en: 'Capital under mandate' },
      metric: '12,400 XRP',
      rows: [
        { label: { es: 'En límites', en: 'Within limits' }, pct: 100, color: 'hsl(var(--tone-success))' },
        { label: { es: 'Tope usado', en: 'Cap used' }, pct: 40, color: 'hsl(var(--volt))' },
      ],
      foot: { es: 'Mandato vigente · 30 días', en: 'Mandate in force · 30 days' },
      accounts: [
        { name: { es: 'Pote designado', en: 'Appointed pot' }, sub: { es: 'El único sitio donde opera', en: 'The only place it operates' }, rule: { es: 'Límites firmados', en: 'Signed limits' } },
        { name: { es: 'El resto de las cuentas', en: 'Every other account' }, sub: { es: 'Fuera de su alcance', en: 'Out of its reach' }, rule: { es: 'Sin acceso', en: 'No access' } },
      ],
      seats: [
        { label: { es: 'Dueño', en: 'Owner' }, signed: true },
        { label: { es: 'Agente', en: 'Agent' }, signed: false },
      ],
      quorum: { es: 'En el corredor', en: 'In the corridor' },
      signLine: { es: 'El dueño firma los límites. El contrato los impone.', en: 'The owner signs the limits. The contract enforces them.' },
      title: { es: 'El dueño firma los límites. Una vez.', en: 'The owner signs the limits. Once.' },
      changes: [
        { es: 'Lo designa cualquiera de los otros tres.', en: 'Any of the other three can appoint it.' },
        { es: 'Opera un solo pote, dentro del corredor.', en: 'It operates a single pot, inside the corridor.' },
        { es: 'Se revoca con una firma.', en: 'It is revoked with one signature.' },
      ],
      cta: { label: { es: 'Conocer Agente', en: 'Explore Agent' }, href: WORLD_ROUTES.agent },
    },
    pass: {
      name: { es: 'Plan de vuelo', en: 'Flight plan' },
      origin: { es: 'El dueño', en: 'The owner' },
      dest: { es: 'Un pote', en: 'One pot' },
      fields: [
        { k: { es: 'Límites', en: 'Limits' }, v: { es: 'En contrato', en: 'In contract' } },
        { k: { es: 'Discreción', en: 'Discretion' }, v: { es: 'Ninguna', en: 'None' } },
        { k: { es: 'Revocación', en: 'Revocation' }, v: { es: 'Una firma', en: 'One signature' } },
      ],
      foot: { es: 'Corredor firmado · el contrato lo impone', en: 'Corridor signed · the contract enforces it' },
      sign: { es: 'Firma el dueño', en: 'The owner signs' },
    },
  },
];

/**
 * EL PASE DEL MUNDO VENUES — el mismo objeto, para quien recibe el capital:
 * un certificado de destino. No es un gobernador (nadie gobierna una cuenta
 * desde aquí), así que vive fuera de la lista y la landing lo pide por su
 * nombre.
 */
export const VENUE_PASS: GovernorPass = {
  name: { es: 'Certificado de destino', en: 'Destination certificate' },
  origin: { es: 'Tu protocolo', en: 'Your protocol' },
  dest: { es: 'El catálogo', en: 'The catalogue' },
  fields: [
    { k: { es: 'Contrato', en: 'Contract' }, v: { es: 'Firma del desplegador', en: 'Deployer signature' } },
    { k: { es: 'Proyecto', en: 'Project' }, v: { es: 'Fichero en tu dominio', en: 'File on your domain' } },
    { k: { es: 'Certificación', en: 'Certification' }, v: { es: 'Fechada · revocable', en: 'Dated · revocable' } },
  ],
  foot: { es: 'Lo medido no se edita · la salida no se cierra', en: 'What was measured is not edited · the exit never closes' },
  sign: { es: 'Pide la verificación', en: 'Request verification' },
};

export const GOVERNOR_BY_ID: Record<GovernorId, Governor> = Object.fromEntries(GOVERNORS.map((g) => [g.id, g])) as Record<GovernorId, Governor>;

export function isGovernorId(v: unknown): v is GovernorId {
  return v === 'self' || v === 'business' || v === 'exchange' || v === 'agent';
}

/** El color del producto con alfa, sin hex: lo que pinta chips, bordes y halos. */
export function tint(g: Governor, alpha: number): string {
  return `hsl(var(${g.token}) / ${alpha})`;
}

/** El color del aviso de estado: verde vivo, oro en validación, gris en preparación. */
export function readinessColor(r: Readiness): string {
  if (r === 'live') return 'hsl(var(--tone-success))';
  if (r === 'soon') return 'hsl(45 75% 62%)';
  return 'hsl(var(--product-agent))';
}
