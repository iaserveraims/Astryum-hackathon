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
 * Bodies are BILINGUAL (founder 2026-08-11: an English page produced a Spanish
 * document — now the document is born in the page's language and the user
 * rewrites it freely afterwards; the anchored text is whatever they edit).
 * Field labels, help lines and placeholders are English t() keys so the UI
 * translates.
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
  /** English t() key (or a language-neutral hint like 'r…') — the builder renders it through t(). */
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
  /** The document text per language — the builder picks the page's language. */
  body: { es: string; en: string };
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

const COMMON_TAIL_EN = `MAINTENANCE
Annual key rotation. One quorum signature a year as a heartbeat (the annual
amendment of this constitution can be it). Annual review of successors. If a
signer is lost, the quorum replaces them with their designated successor
BEFORE any other operation if the margin fell to zero.

SURVIVAL
How to operate all of this without Astryum: {{supervivencia}}
This document is anchored on XRPL by its SHA-256 fingerprint; every amendment
is a new version signed by the quorum.

NOTICE: this document does not replace a lawyer. Many countries have
forced-heirship rules a court can override. Take advice before constituting
with real capital.`;

const F_SUPERVIVENCIA: TemplateField = {
  id: 'supervivencia',
  label: 'Survival folder URI',
  help: 'Where the offline instructions live (IPFS/Drive/paper location) — how to operate without Astryum.',
  type: 'text',
  placeholder: 'ipfs://… / "the safe at home"',
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
      { id: 'nombre', label: 'Legacy name', type: 'text', placeholder: 'G’s patrimony' },
      F_FECHA,
      F_CUENTA,
      {
        id: 'proposito',
        label: 'Purpose',
        help: 'Why this patrimony exists, in your own words — what "long-term" means to you.',
        type: 'multiline',
        placeholder: 'Protect my capital for the long run: let it produce without being sellable on an impulse, and let no single key touch it alone.',
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
        placeholder: 'Phone (Xaman) — r… — backup: home safe\nHardware — r… — backup: bank\nOld phone (Xaman) — r… — backup: my parents’ house',
      },
      { id: 'quorumN', label: 'Quorum', type: 'number', default: '2' },
      { id: 'totalN', label: 'Total keys', type: 'number', default: '3' },
      F_SUPERVIVENCIA,
    ],
    body: {
      es: `CONSTITUCIÓN DEL {{nombre}} — v1
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
      en: `CONSTITUTION OF {{nombre}} — v1
Date: {{fecha}} · Legacy XRPL account: {{cuenta}}

1. THE PURPOSE
This patrimony belongs to one person: its holder. It exists to:
{{proposito}}

2. THE PROTECTION
The account obeys no single key: it obeys the quorum of the holder’s keys.
A key that is lost, stolen or coerced can move nothing. The account’s
master key is disabled: the account only obeys the quorum.

3. THE UNTOUCHABLE
The base capital is never sold. It produces, and one lives off what it
produces. A reserve of {{reservaPct}}% stays in native XRP, on this
account, outside the productive layer.

4. THE FRUITS
Of each cycle’s yield: {{capitalizaPct}}% is capitalized back into the
patrimony; the rest stays at the holder’s disposal.

5. THE KEYS
All keys belong to the holder:
{{llaves}}
Quorum: {{quorumN}} of {{totalN}}. Changing these rules or the keys
requires that quorum.

6. ${COMMON_TAIL_EN}`,
    },
  },
  {
    id: 'familiar',
    name: 'Family patrimony',
    description:
      'The classic setup: a family council governs the capital; the base is untouchable, the fruits are shared by written rules.',
    recommendedCouncil: '4 signers · quorum 3',
    available: true,
    fields: [
      { id: 'nombre', label: 'Legacy name', type: 'text', placeholder: 'García Legacy' },
      F_FECHA,
      F_CUENTA,
      {
        id: 'proposito',
        label: 'Purpose',
        help: 'What your great-grandchild will read: why this patrimony exists.',
        type: 'multiline',
        placeholder: 'That no generation of this family starts from zero…',
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
      { id: 'causa', label: 'The cause', type: 'text', placeholder: 'Foundation / purpose' },
      {
        id: 'repartos',
        label: 'Distribution of the rest',
        help: 'One line per branch/beneficiary: "Name — %". The listed shares should add up to 100.',
        type: 'multiline',
        placeholder: 'Ana’s branch — 50\nLuis’s branch — 50',
      },
      {
        id: 'condiciones',
        label: 'Beneficiary conditions',
        help: 'One per line: "Beneficiary: written condition". The council evaluates them by quorum — nothing applies itself.',
        type: 'multiline',
        placeholder: 'Marco: receives his share at 25',
      },
      {
        id: 'firmantes',
        label: 'Council members',
        help: 'One per line: "Name — rADDRESS — successor: Name, rADDRESS". These stay in this document only.',
        type: 'multiline',
        placeholder: 'Ana — r… — successor: Marco, r…',
      },
      { id: 'quorumN', label: 'Quorum', type: 'number', default: '3' },
      { id: 'totalN', label: 'Total signers', type: 'number', default: '4' },
      F_SUPERVIVENCIA,
    ],
    body: {
      es: `CONSTITUCIÓN DEL {{nombre}} — v1
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
      en: `CONSTITUTION OF {{nombre}} — v1
Date: {{fecha}} · Legacy XRPL account: {{cuenta}}

1. THE PURPOSE
This patrimony exists to: {{proposito}}

2. THE UNTOUCHABLE
The base capital is never sold. It produces, and one lives off what it
produces. A reserve of {{reservaPct}}% stays in native XRP, on the
council’s account, outside the productive layer.

3. THE FRUITS
Of each cycle’s yield: {{capitalizaPct}}% is capitalized back into the
patrimony; {{causaPct}}% goes to {{causa}}; the rest is distributed:
{{repartos}}

4. BENEFICIARY CONDITIONS
{{condiciones}}
Every condition is evaluated by the council by quorum, under this written
rule, with a record on the ledger. No condition applies itself.

5. THE COUNCIL
Signers:
{{firmantes}}
Quorum: {{quorumN}} of {{totalN}}. Changing these rules, the signers or the
distributions requires that quorum. The account’s master key is disabled:
the account only obeys the council.

6. THE MANDATE
The council may appoint a director for a defined term: they direct where
the capital produces within the approved destinations and never receive
the assets. When the term expires, the right expires with it.

7. ${COMMON_TAIL_EN}`,
    },
  },
  {
    id: 'hijo',
    name: 'Fund for a child / education',
    description:
      'One beneficiary with written conditions (age, milestones); a small council of guardians evaluates and delivers.',
    recommendedCouncil: '3 signers · quorum 2',
    available: false,
    fields: [
      { id: 'nombre', label: 'Legacy name', type: 'text', placeholder: 'Marco’s fund' },
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
        placeholder: 'His education and his first home…',
      },
      {
        id: 'entregas',
        label: 'Deliveries and milestones',
        help: 'One per line: "condition/date → what is delivered". Dated deliveries are enforced by the ledger (escrow); condition-based ones are evaluated by the council.',
        type: 'multiline',
        placeholder: 'At 18 → 30% of the fund\nAt 25 → the rest',
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
    body: {
      es: `CONSTITUCIÓN DEL {{nombre}} — v1
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
      en: `CONSTITUTION OF {{nombre}} — v1
Date: {{fecha}} · Legacy XRPL account: {{cuenta}}

1. THE PURPOSE
This fund exists for {{beneficiario}}: {{proposito}}

2. THE DELIVERIES
{{entregas}}
Dated deliveries are committed on the ledger (a programmed transfer:
unbreakable until the date, recoverable afterwards if unclaimed).
Condition-based deliveries are evaluated by the guardian council by quorum,
under this written rule, with a record on the ledger. No condition applies
itself.

3. THE GUARDIAN COUNCIL
Signers:
{{tutores}}
Quorum: {{quorumN}} of {{totalN}}. Changing these rules or the signers
requires that quorum. The account’s master key is disabled: the account
only obeys the council.

4. ${COMMON_TAIL_EN}`,
    },
  },
  {
    id: 'fundacion',
    name: 'Foundation / cause',
    description:
      'The fruits sustain a cause; a board of trustees governs by quorum. The base capital never leaves.',
    recommendedCouncil: '5 signers · quorum 3',
    available: false,
    fields: [
      { id: 'nombre', label: 'Legacy name', type: 'text', placeholder: 'Clean Sea Fund' },
      F_FECHA,
      F_CUENTA,
      { id: 'causa', label: 'The cause', type: 'multiline', placeholder: 'What this fund sustains, and for whom…' },
      {
        id: 'usoFrutos',
        label: 'Use of the fruits',
        help: 'Written rules for what the yield may fund (and what it may not).',
        type: 'multiline',
        placeholder: 'Annual grants…\nNever third parties’ running expenses…',
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
    body: {
      es: `CONSTITUCIÓN DEL {{nombre}} — v1
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
      en: `CONSTITUTION OF {{nombre}} — v1
Date: {{fecha}} · Legacy XRPL account: {{cuenta}}

1. THE CAUSE
{{causa}}

2. THE UNTOUCHABLE
The base capital is never sold and never donated: it produces, and the
cause lives off what it produces.

3. USE OF THE FRUITS
{{usoFrutos}}
Every use is approved by the board of trustees by quorum, under this
written rule, with a record on the ledger.

4. THE BOARD OF TRUSTEES
Signers:
{{patronos}}
Quorum: {{quorumN}} of {{totalN}}. Changing these rules or the signers
requires that quorum. The account’s master key is disabled: the account
only obeys the council.

5. ${COMMON_TAIL_EN}`,
    },
  },
  {
    id: 'negocio',
    name: 'Business continuity',
    description:
      'A director runs where the capital produces, for a fixed term, without ever receiving the assets. The council can renew or revoke.',
    recommendedCouncil: '5 signers · quorum 3',
    available: false,
    fields: [
      { id: 'nombre', label: 'Legacy name', type: 'text', placeholder: 'Taller Roca Legacy' },
      F_FECHA,
      F_CUENTA,
      { id: 'proposito', label: 'Purpose', type: 'multiline', placeholder: 'That the business keeps producing for…' },
      { id: 'director', label: 'Director', help: 'Name of the person who directs where the capital produces.', type: 'text' },
      // The default is an English t() key — the builder resolves defaults
      // through t(), so the ES page prefills "12 meses".
      { id: 'plazo', label: 'Term of the mandate', type: 'text', default: '12 months' },
      {
        id: 'limites',
        label: 'Director’s limits',
        help: 'What the director may and may not do. They never receive the assets.',
        type: 'multiline',
        placeholder: 'Only council-approved destinations…',
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
    body: {
      es: `CONSTITUCIÓN DEL {{nombre}} — v1
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
      en: `CONSTITUTION OF {{nombre}} — v1
Date: {{fecha}} · Legacy XRPL account: {{cuenta}}

1. THE PURPOSE
{{proposito}}

2. THE MANDATE
The council appoints {{director}} as director for a term of {{plazo}}: they
direct where the capital produces within the approved destinations and
never receive the assets. When the term expires, the right expires with
it; renewing or revoking it requires the quorum.

3. THE DIRECTOR’S LIMITS
{{limites}}

4. THE COUNCIL
Signers:
{{firmantes}}
Quorum: {{quorumN}} of {{totalN}}. Changing these rules, the signers or the
mandate requires that quorum. The account’s master key is disabled: the
account only obeys the council.

5. ${COMMON_TAIL_EN}`,
    },
  },
  {
    id: 'simple',
    name: 'Simple savings for the kids',
    description:
      'The minimum: a council and dated, programmed transfers. No productive layer, no complex rules.',
    recommendedCouncil: '3 signers · quorum 2',
    available: false,
    fields: [
      { id: 'nombre', label: 'Legacy name', type: 'text', placeholder: 'The kids’ savings' },
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
    body: {
      es: `CONSTITUCIÓN DEL {{nombre}} — v1
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
      en: `CONSTITUTION OF {{nombre}} — v1
Date: {{fecha}} · Legacy XRPL account: {{cuenta}}

1. THE PURPOSE
Set aside and deliver on written dates, with no productive layer.

2. THE DELIVERIES
{{beneficiarios}}
Each dated delivery is committed on the ledger (a programmed transfer:
unbreakable until the date, recoverable afterwards if unclaimed).

3. THE COUNCIL
Signers:
{{firmantes}}
Quorum: {{quorumN}} of {{totalN}}. Changing these rules or the signers
requires that quorum. The account’s master key is disabled: the account
only obeys the council.

4. ${COMMON_TAIL_EN}`,
    },
  },
];

/** Resolve a field's default ('@today' / '@account' / literal). */
export function resolveDefault(field: TemplateField, account: string | null): string {
  if (field.default === '@today') return new Date().toISOString().slice(0, 10);
  if (field.default === '@account') return account ?? '';
  return field.default ?? '';
}

/** Matches the pending marker in either language — the builder counts with it. */
export const PENDING_MARKER_RE = /\[(?:PENDIENTE|PENDING):/g;

/**
 * Assemble the document in the page's language: replace each {{slot}} with its
 * value, or a visible [PENDING/PENDIENTE: label] marker when empty — an honest
 * gap beats a silent hole. `translateLabel` (pass the UI's t) renders the
 * field label in the document's language.
 */
export function assembleConstitution(
  template: ConstitutionTemplate,
  values: Record<string, string>,
  opts: { lang: 'es' | 'en'; translateLabel?: (label: string) => string },
): string {
  const marker = opts.lang === 'es' ? 'PENDIENTE' : 'PENDING';
  return template.body[opts.lang].replace(/\{\{(\w+)\}\}/g, (_m, id: string) => {
    const v = values[id]?.trim();
    if (v) return v;
    const field = template.fields.find((f) => f.id === id);
    const label = field?.label ?? id;
    return `[${marker}: ${opts.translateLabel ? opts.translateLabel(label) : label}]`;
  });
}
