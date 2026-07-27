/**
 * constitutionTemplates — the gallery behind the Constitution builder (§4:
 * nobody writes a constitution from a blank page, and nobody should hunt
 * [BRACKETS] in a wall of text either).
 *
 * Each template is a body with {{slots}} plus a field list (label, help,
 * default, type). The FORM generates the document text; the user never touches
 * a placeholder by hand. Assembly, editing and hashing all happen CLIENT-SIDE —
 * the document (with real names and addresses) never leaves the browser; only
 * its SHA-256 fingerprint is anchored (XLS-40 DID).
 *
 * Copy rule (L5 — legal): never "testamento / herencia / fideicomiso /
 * sucesión". This is a programmed, conditioned, revocable transfer constituted
 * in life. Every body ends with the honest legal caveat (forced-heirship).
 *
 * Bodies are Spanish (the product's constitution language today — same as the
 * previous single hardcoded template). Field labels are English t() keys so the
 * UI translates; the user can rewrite the assembled text freely afterwards.
 */

export type TemplateFieldType = 'text' | 'multiline' | 'number' | 'percent' | 'date';

export interface TemplateField {
  /** Slot id — appears in the body as {{id}}. */
  id: string;
  /** English label (t() key). */
  label: string;
  /** English help line (t() key). */
  help?: string;
  type: TemplateFieldType;
  /** Prefill value. Special tokens: '@today' (ISO date), '@account' (the Legacy address). */
  default?: string;
  placeholder?: string;
}

export interface ConstitutionTemplate {
  id: string;
  /** English name/description (t() keys). */
  name: string;
  description: string;
  /** Council shape this template assumes — shown on the card (informative only). */
  recommendedCouncil: string;
  /**
   * Founder decision 2026-07-16: exactly ONE template is usable at a time (the
   * launch case — today FAMILIAR, a family of 4 with quorum 3). The rest stay
   * visible as read-only previews until they are opened one by one.
   */
  available: boolean;
  fields: TemplateField[];
  body: string;
}

/** Common closing blocks: maintenance, survival folder, legal caveat. */
const COMMON_TAIL = `MANTENIMIENTO
Rotación anual de llaves. Una firma de quórum al año como latido (puede ser la
enmienda anual de esta constitución). Revisión anual de sucesores. Si un
firmante falta, el quórum lo reemplaza por su sucesor designado ANTES de
cualquier otra operación si el margen quedó a cero.

SUPERVIVENCIA
Cómo operar todo esto sin Astryum: {{supervivencia}}
Este documento se ancla en XRPL por su huella SHA-256; cada enmienda es una
versión nueva firmada por el quórum.

AVISO: este documento no sustituye a un abogado. En muchos países existe la
legítima: hay reglas que un tribunal puede anular. Consulta antes de constituir
con patrimonio real.`;

const F_SUPERVIVENCIA: TemplateField = {
  id: 'supervivencia',
  label: 'Survival folder URI',
  help: 'Where the offline instructions live (IPFS/Drive/paper location) — how to operate without Astryum.',
  type: 'text',
  placeholder: 'ipfs://… / "caja fuerte de casa"',
};

const F_FECHA: TemplateField = { id: 'fecha', label: 'Date', type: 'date', default: '@today' };
const F_CUENTA: TemplateField = {
  id: 'cuenta',
  label: 'Legacy account (XRPL)',
  help: 'The council-governed account this constitution rules.',
  type: 'text',
  default: '@account',
  placeholder: 'r…',
};

export const CONSTITUTION_TEMPLATES: ConstitutionTemplate[] = [
  {
    id: 'personal',
    name: 'Personal patrimony (one person)',
    description:
      'The most basic case, and where most people start: your own capital, protected long-term by a quorum of YOUR OWN keys. No single key — lost, stolen or coerced — can move anything.',
    recommendedCouncil: '3 keys · quorum 2 — all yours',
    available: false,
    fields: [
      { id: 'nombre', label: 'Legacy name', type: 'text', placeholder: 'Patrimonio de G' },
      F_FECHA,
      F_CUENTA,
      {
        id: 'proposito',
        label: 'Purpose',
        help: 'Why this patrimony exists, in your own words — what "long-term" means to you.',
        type: 'multiline',
        placeholder: 'Proteger mi capital a largo plazo: que produzca sin poder venderse en un impulso, y que ninguna llave sola pueda tocarlo.',
      },
      {
        id: 'reservaPct',
        label: 'Native XRP reserve (%)',
        help: 'Kept in XRP on this account, outside the productive layer.',
        type: 'percent',
        default: '20',
      },
      {
        id: 'capitalizaPct',
        label: 'Fruits capitalized back (%)',
        help: 'Share of each cycle’s yield that grows the base; the rest stays at your disposal.',
        type: 'percent',
        default: '70',
      },
      {
        id: 'llaves',
        label: 'Your keys',
        help: 'One per line: "device/key — rADDRESS — where its backup lives". All of them are YOURS — this is protection from a single point of failure, with no third parties.',
        type: 'multiline',
        placeholder: 'Móvil (Xaman) — r… — backup: caja fuerte casa\nHardware — r… — backup: banco\nMóvil viejo (Xaman) — r… — backup: casa de mis padres',
      },
      { id: 'quorumN', label: 'Quorum', type: 'number', default: '2' },
      { id: 'totalN', label: 'Total keys', type: 'number', default: '3' },
      F_SUPERVIVENCIA,
    ],
    body: `CONSTITUCIÓN DEL {{nombre}} — v1
Fecha: {{fecha}} · Cuenta XRPL del Legacy: {{cuenta}}

1. EL PROPÓSITO
Este patrimonio es de una sola persona: su titular. Existe para:
{{proposito}}

2. LA PROTECCIÓN
La cuenta no obedece a ninguna llave sola: obedece al quórum de las llaves
del titular. Una llave perdida, robada o coaccionada no puede mover nada.
La llave maestra de la cuenta está deshabilitada: la cuenta solo obedece
al quórum.

3. LO INTOCABLE
El capital base nunca se vende. Produce, y se vive de lo que produce.
Una reserva del {{reservaPct}}% permanece en XRP nativo, en esta cuenta,
fuera de la capa productiva.

4. LOS FRUTOS
Del rendimiento de cada ciclo: el {{capitalizaPct}}% se capitaliza al
patrimonio; el resto queda a disposición del titular.

5. LAS LLAVES
Todas las llaves son del titular:
{{llaves}}
Quórum: {{quorumN}} de {{totalN}}. Cambiar estas reglas o las llaves exige
ese quórum.

6. ${COMMON_TAIL}`,
  },
  {
    id: 'familiar',
    name: 'Family patrimony',
    description:
      'The classic setup: a family council governs the capital; the base is untouchable, the fruits are shared by written rules.',
    recommendedCouncil: '4 signers · quorum 3',
    available: true,
    fields: [
      { id: 'nombre', label: 'Legacy name', type: 'text', placeholder: 'Legacy García' },
      F_FECHA,
      F_CUENTA,
      {
        id: 'proposito',
        label: 'Purpose',
        help: 'What your great-grandchild will read: why this patrimony exists.',
        type: 'multiline',
        placeholder: 'Que ninguna generación de esta familia empiece de cero…',
      },
      {
        id: 'reservaPct',
        label: 'Native XRP reserve (%)',
        help: 'Kept in XRP on the council account, outside the productive layer.',
        type: 'percent',
        default: '20',
      },
      {
        id: 'capitalizaPct',
        label: 'Fruits capitalized back (%)',
        help: 'Share of each cycle’s yield that grows the base.',
        type: 'percent',
        default: '30',
      },
      { id: 'causaPct', label: 'Fruits to a cause (%)', type: 'percent', default: '5' },
      { id: 'causa', label: 'The cause', type: 'text', placeholder: 'Fundación / propósito' },
      {
        id: 'repartos',
        label: 'Distribution of the rest',
        help: 'One line per branch/beneficiary: "Name — %". The listed shares should add up to 100.',
        type: 'multiline',
        placeholder: 'Rama de Ana — 50\nRama de Luis — 50',
      },
      {
        id: 'condiciones',
        label: 'Beneficiary conditions',
        help: 'One per line: "Beneficiary: written condition". The council evaluates them by quorum — nothing applies itself.',
        type: 'multiline',
        placeholder: 'Marco: recibe su parte al cumplir 25 años',
      },
      {
        id: 'firmantes',
        label: 'Council members',
        help: 'One per line: "Name — rADDRESS — successor: Name, rADDRESS". These stay in this document only.',
        type: 'multiline',
        placeholder: 'Ana — r… — sucesor: Marco, r…',
      },
      { id: 'quorumN', label: 'Quorum', type: 'number', default: '3' },
      { id: 'totalN', label: 'Total signers', type: 'number', default: '4' },
      F_SUPERVIVENCIA,
    ],
    body: `CONSTITUCIÓN DEL {{nombre}} — v1
Fecha: {{fecha}} · Cuenta XRPL del Legacy: {{cuenta}}

1. EL PROPÓSITO
Este patrimonio existe para: {{proposito}}

2. LO INTOCABLE
El capital base nunca se vende. Produce, y se vive de lo que produce.
Una reserva del {{reservaPct}}% permanece en XRP nativo, en la cuenta del
consejo, fuera de la capa productiva.

3. LOS FRUTOS
Del rendimiento de cada ciclo: el {{capitalizaPct}}% se capitaliza al
patrimonio; el {{causaPct}}% se destina a {{causa}}; el resto se reparte:
{{repartos}}

4. CONDICIONES DE BENEFICIARIO
{{condiciones}}
Toda condición la evalúa el consejo por quórum, bajo esta regla escrita,
con registro en el ledger. Ninguna condición se aplica sola.

5. EL CONSEJO
Firmantes:
{{firmantes}}
Quórum: {{quorumN}} de {{totalN}}. Cambiar estas reglas, los firmantes o los
repartos exige ese quórum. La llave maestra de la cuenta está deshabilitada:
la cuenta solo obedece al consejo.

6. LA CESIÓN
El consejo puede nombrar un director por plazo definido: dirige dónde produce
el capital dentro de los destinos aprobados y no recibe los activos jamás.
Al expirar el plazo, el derecho se extingue.

7. ${COMMON_TAIL}`,
  },
  {
    id: 'hijo',
    name: 'Fund for a child / education',
    description:
      'One beneficiary with written conditions (age, milestones); a small council of guardians evaluates and delivers.',
    recommendedCouncil: '3 signers · quorum 2',
    available: false,
    fields: [
      { id: 'nombre', label: 'Legacy name', type: 'text', placeholder: 'Fondo de Marco' },
      F_FECHA,
      F_CUENTA,
      {
        id: 'beneficiario',
        label: 'Beneficiary',
        help: 'The child’s name as it should read in the document.',
        type: 'text',
      },
      {
        id: 'proposito',
        label: 'Purpose',
        type: 'multiline',
        placeholder: 'Su educación y su primer techo…',
      },
      {
        id: 'entregas',
        label: 'Deliveries and milestones',
        help: 'One per line: "condition/date → what is delivered". Dated deliveries are enforced by the ledger (escrow); condition-based ones are evaluated by the council.',
        type: 'multiline',
        placeholder: 'Al cumplir 18 → 30% del fondo\nAl cumplir 25 → el resto',
      },
      {
        id: 'tutores',
        label: 'Guardian council',
        help: 'One per line: "Name — rADDRESS — successor".',
        type: 'multiline',
      },
      { id: 'quorumN', label: 'Quorum', type: 'number', default: '2' },
      { id: 'totalN', label: 'Total signers', type: 'number', default: '3' },
      F_SUPERVIVENCIA,
    ],
    body: `CONSTITUCIÓN DEL {{nombre}} — v1
Fecha: {{fecha}} · Cuenta XRPL del Legacy: {{cuenta}}

1. EL PROPÓSITO
Este fondo existe para {{beneficiario}}: {{proposito}}

2. LAS ENTREGAS
{{entregas}}
Las entregas con fecha se comprometen en el ledger (transferencia programada:
irrompible hasta la fecha, recuperable después si no se reclama). Las entregas
por condición las evalúa el consejo de tutores por quórum, bajo esta regla
escrita, con registro en el ledger. Ninguna condición se aplica sola.

3. EL CONSEJO DE TUTORES
Firmantes:
{{tutores}}
Quórum: {{quorumN}} de {{totalN}}. Cambiar estas reglas o los firmantes exige
ese quórum. La llave maestra de la cuenta está deshabilitada: la cuenta solo
obedece al consejo.

4. ${COMMON_TAIL}`,
  },
  {
    id: 'fundacion',
    name: 'Foundation / cause',
    description:
      'The fruits sustain a cause; a board of trustees governs by quorum. The base capital never leaves.',
    recommendedCouncil: '5 signers · quorum 3',
    available: false,
    fields: [
      { id: 'nombre', label: 'Legacy name', type: 'text', placeholder: 'Fondo Mar Limpio' },
      F_FECHA,
      F_CUENTA,
      { id: 'causa', label: 'The cause', type: 'multiline', placeholder: 'Qué sostiene este fondo y para quién…' },
      {
        id: 'usoFrutos',
        label: 'Use of the fruits',
        help: 'Written rules for what the yield may fund (and what it may not).',
        type: 'multiline',
        placeholder: 'Becas anuales…\nNunca gasto corriente de terceros…',
      },
      {
        id: 'patronos',
        label: 'Board of trustees',
        help: 'One per line: "Name — rADDRESS — successor".',
        type: 'multiline',
      },
      { id: 'quorumN', label: 'Quorum', type: 'number', default: '3' },
      { id: 'totalN', label: 'Total signers', type: 'number', default: '5' },
      F_SUPERVIVENCIA,
    ],
    body: `CONSTITUCIÓN DEL {{nombre}} — v1
Fecha: {{fecha}} · Cuenta XRPL del Legacy: {{cuenta}}

1. LA CAUSA
{{causa}}

2. LO INTOCABLE
El capital base nunca se vende ni se dona: produce, y la causa vive de lo que
produce.

3. USO DE LOS FRUTOS
{{usoFrutos}}
Cada uso lo aprueba el consejo de patronos por quórum, bajo esta regla escrita,
con registro en el ledger.

4. EL CONSEJO DE PATRONOS
Firmantes:
{{patronos}}
Quórum: {{quorumN}} de {{totalN}}. Cambiar estas reglas o los firmantes exige
ese quórum. La llave maestra de la cuenta está deshabilitada: la cuenta solo
obedece al consejo.

5. ${COMMON_TAIL}`,
  },
  {
    id: 'negocio',
    name: 'Business continuity',
    description:
      'A director runs where the capital produces, for a fixed term, without ever receiving the assets. The council can renew or revoke.',
    recommendedCouncil: '5 signers · quorum 3',
    available: false,
    fields: [
      { id: 'nombre', label: 'Legacy name', type: 'text', placeholder: 'Legacy Taller Roca' },
      F_FECHA,
      F_CUENTA,
      { id: 'proposito', label: 'Purpose', type: 'multiline', placeholder: 'Que el negocio siga produciendo para…' },
      { id: 'director', label: 'Director', help: 'Name of the person who directs where the capital produces.', type: 'text' },
      { id: 'plazo', label: 'Term of the mandate', type: 'text', default: '12 meses' },
      {
        id: 'limites',
        label: 'Director’s limits',
        help: 'What the director may and may not do. They never receive the assets.',
        type: 'multiline',
        placeholder: 'Solo destinos aprobados por el consejo…',
      },
      {
        id: 'firmantes',
        label: 'Council members',
        type: 'multiline',
        help: 'One per line: "Name — rADDRESS — successor".',
      },
      { id: 'quorumN', label: 'Quorum', type: 'number', default: '3' },
      { id: 'totalN', label: 'Total signers', type: 'number', default: '5' },
      F_SUPERVIVENCIA,
    ],
    body: `CONSTITUCIÓN DEL {{nombre}} — v1
Fecha: {{fecha}} · Cuenta XRPL del Legacy: {{cuenta}}

1. EL PROPÓSITO
{{proposito}}

2. LA CESIÓN
El consejo nombra director a {{director}} por un plazo de {{plazo}}: dirige
dónde produce el capital dentro de los destinos aprobados y no recibe los
activos jamás. Al expirar el plazo, el derecho se extingue; renovarlo o
revocarlo exige el quórum.

3. LÍMITES DEL DIRECTOR
{{limites}}

4. EL CONSEJO
Firmantes:
{{firmantes}}
Quórum: {{quorumN}} de {{totalN}}. Cambiar estas reglas, los firmantes o la
cesión exige ese quórum. La llave maestra de la cuenta está deshabilitada:
la cuenta solo obedece al consejo.

5. ${COMMON_TAIL}`,
  },
  {
    id: 'simple',
    name: 'Simple savings for the kids',
    description:
      'The minimum: a council and dated, programmed transfers. No productive layer, no complex rules.',
    recommendedCouncil: '3 signers · quorum 2',
    available: false,
    fields: [
      { id: 'nombre', label: 'Legacy name', type: 'text', placeholder: 'Ahorro de los niños' },
      F_FECHA,
      F_CUENTA,
      {
        id: 'beneficiarios',
        label: 'Beneficiaries and dates',
        help: 'One per line: "Name — delivery date — amount/share". Dated transfers are enforced by the ledger.',
        type: 'multiline',
        placeholder: 'Ana — 2032-06-01 — 40%\nLuis — 2035-06-01 — 60%',
      },
      {
        id: 'firmantes',
        label: 'Council members',
        type: 'multiline',
        help: 'One per line: "Name — rADDRESS — successor".',
      },
      { id: 'quorumN', label: 'Quorum', type: 'number', default: '2' },
      { id: 'totalN', label: 'Total signers', type: 'number', default: '3' },
      F_SUPERVIVENCIA,
    ],
    body: `CONSTITUCIÓN DEL {{nombre}} — v1
Fecha: {{fecha}} · Cuenta XRPL del Legacy: {{cuenta}}

1. EL PROPÓSITO
Apartar y entregar en fechas escritas, sin capa productiva.

2. LAS ENTREGAS
{{beneficiarios}}
Cada entrega con fecha se compromete en el ledger (transferencia programada:
irrompible hasta la fecha, recuperable después si no se reclama).

3. EL CONSEJO
Firmantes:
{{firmantes}}
Quórum: {{quorumN}} de {{totalN}}. Cambiar estas reglas o los firmantes exige
ese quórum. La llave maestra de la cuenta está deshabilitada: la cuenta solo
obedece al consejo.

4. ${COMMON_TAIL}`,
  },
];

/** Resolve a field's default ('@today' / '@account' / literal). */
export function resolveDefault(field: TemplateField, account: string | null): string {
  if (field.default === '@today') return new Date().toISOString().slice(0, 10);
  if (field.default === '@account') return account ?? '';
  return field.default ?? '';
}

/**
 * Assemble the document: replace each {{slot}} with its value, or a visible
 * [PENDIENTE: label] marker when empty — an honest gap beats a silent hole.
 */
export function assembleConstitution(
  template: ConstitutionTemplate,
  values: Record<string, string>,
): string {
  return template.body.replace(/\{\{(\w+)\}\}/g, (_m, id: string) => {
    const v = values[id]?.trim();
    if (v) return v;
    const field = template.fields.find((f) => f.id === id);
    return `[PENDIENTE: ${field?.label ?? id}]`;
  });
}
