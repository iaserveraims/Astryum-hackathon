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
   * Templates open ONE BY ONE, and only once their whole chain is real
   * (founder 2026-07-16). Open today: FAMILIAR (a family of 4, quorum 3) and
   * PERSONAL (the reinforced personal account, 2-of-3 of your own keys —
   * founder 2026-08-21). The rest stay visible as read-only previews.
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

/** H7 — the supremacy-and-cure clause every NEW template carries (E4,
 *  2026-08-16). If law and ledger diverge, the law prevails and the quorum
 *  binds itself to the cure ceremony (quorum re-enablement of the master key
 *  is possible on XRPL — validated 15-ago) within a written deadline. */
const SUPREMACIA = `SUPREMACÍA Y CURACIÓN
Si la ley aplicable y el estado del ledger divergen, manda la ley: el ledger
es el mecanismo de ejecución, no la fuente del derecho. El quórum se obliga a
ejecutar la ceremonia de curación que realinee el ledger con el derecho
(incluida, si es imprescindible, la re-habilitación de la llave maestra por
quórum) en un plazo máximo de {{plazoCuracion}} días desde que la divergencia
sea firme.`;

const SUPREMACIA_EN = `SUPREMACY AND CURE
If the applicable law and the ledger's state diverge, the law prevails: the
ledger is the enforcement mechanism, not the source of the right. The quorum
binds itself to run the cure ceremony that realigns the ledger with the law
(including, if indispensable, quorum re-enablement of the master key) within
{{plazoCuracion}} days of the divergence becoming final.`;

const F_PLAZO_CURACION: TemplateField = {
  id: 'plazoCuracion',
  label: 'Cure deadline (days)',
  help: 'Maximum days the quorum has to realign the ledger with the law once a divergence is final.',
  type: 'number',
  default: '30',
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

/** The REINFORCED PERSONAL account's own account field (founder 2026-08-21).
 *  Same slot, different truth: there is no council here and nothing is
 *  "governed" by other people — it is the holder's own account, and calling it
 *  a Legacy account in the document would be a plain misdescription. */
const F_CUENTA_PERSONAL: TemplateField = {
  id: 'cuenta',
  label: 'Your account (XRPL)',
  help: 'The account this document governs — yours, held by a quorum of your own keys.',
  type: 'text',
  default: '@account',
  placeholder: 'r…',
};

/** Closing blocks for the reinforced personal account. The shared COMMON_TAIL
 *  speaks of signers and designated successors — the vocabulary of a council of
 *  people. Here every key belongs to ONE person, so a lost key is a device to
 *  replace, not a human to convince, and the tail says so. */
const PERSONAL_TAIL = `MANTENIMIENTO
Rotación anual de llaves: cada dispositivo renueva la suya. Una firma de
quórum al año como latido — si puedes firmar, la configuración sigue viva.
Si un dispositivo se pierde o deja de funcionar, repónlo ANTES de cualquier
otra operación: lo que se agota no es el dinero, es el MARGEN. Con el quórum
justo, una pérdida más deja la cuenta bloqueada para siempre.

SUPERVIVENCIA
Cómo operar esta cuenta sin Astryum: {{supervivencia}}
Este documento se ancla en XRPL por su huella SHA-256; cada enmienda es una
versión nueva firmada por el quórum.

AVISO: este documento describe cómo gobiernas tu propia cuenta. No transfiere
nada a nadie, no crea ninguna estructura, y no sustituye a un abogado.`;

const PERSONAL_TAIL_EN = `MAINTENANCE
Annual key rotation: each device renews its own. One quorum signature a year
as a heartbeat — if you can sign, the setup is still alive. If a device is
lost or stops working, replace it BEFORE any other operation: what runs out is
not the money, it is the MARGIN. At exact quorum, one more loss locks the
account for ever.

SURVIVAL
How to operate this account without Astryum: {{supervivencia}}
This document is anchored on XRPL by its SHA-256 fingerprint; every amendment
is a new version signed by the quorum.

NOTICE: this document describes how you govern your own account. It transfers
nothing to anyone, creates no structure, and does not replace a lawyer.`;

export const CONSTITUTION_TEMPLATES: ConstitutionTemplate[] = [
  {
    // THE REINFORCED PERSONAL ACCOUNT (founder 2026-08-21 — the "Reinforce it"
    // door on every XRPL wallet card). It is the SAME ceremony as a Legacy —
    // SignerList, rehearsal, master key off, anchored constitution — with two
    // differences that the text must never blur: every key belongs to ONE
    // person, and there is NO cage on Flare. Nothing here is locked away, the
    // holder spends normally; what changes is that a single stolen phone no
    // longer moves anything. The floor is 2-of-3; above that it is the
    // holder's choice.
    id: 'personal',
    name: 'Reinforced personal account',
    description:
      'Your own account, held by a quorum of YOUR OWN keys: no single key — lost, stolen or coerced — moves anything alone. It stays a personal wallet: no council of other people, and nothing is locked away.',
    recommendedCouncil: '3 keys · quorum 2 — all yours',
    available: true,
    fields: [
      { id: 'nombre', label: 'Account name', type: 'text', placeholder: 'My reinforced account' },
      F_FECHA,
      F_CUENTA_PERSONAL,
      {
        id: 'proposito',
        label: 'Purpose',
        help: 'Why you are reinforcing this account, in your own words.',
        type: 'multiline',
        placeholder: 'So that no single device — lost, stolen or taken from me under pressure — can move my capital on its own.',
      },
      {
        id: 'llaves',
        label: 'Your keys',
        help: 'One per line: "device/key — rADDRESS — where its backup lives". All of them are YOURS — this removes the single point of failure, and brings in no third party.',
        type: 'multiline',
        placeholder: 'Phone (Xaman) — r… — backup: home safe\nHardware — r… — backup: bank\nOld phone (Xaman) — r… — backup: my parents’ house',
      },
      { id: 'quorumN', label: 'Quorum', type: 'number', default: '2' },
      { id: 'totalN', label: 'Total keys', type: 'number', default: '3' },
      F_SUPERVIVENCIA,
    ],
    body: {
      es: `REGLAS DE {{nombre}} — v1
Fecha: {{fecha}} · Cuenta XRPL: {{cuenta}}

1. EL PROPÓSITO
Esta cuenta es de una sola persona: su titular. Se refuerza para:
{{proposito}}

2. LA PROTECCIÓN
La cuenta no obedece a ninguna llave sola: obedece al quórum de las llaves
del titular. Una llave perdida, robada o coaccionada no puede mover nada.
La llave maestra está deshabilitada: la cuenta solo obedece al quórum.

3. LAS LLAVES
Todas las llaves son del titular:
{{llaves}}
Quórum: {{quorumN}} de {{totalN}}. Cambiar estas reglas o las llaves exige
ese quórum.

4. LO QUE ESTO NO ES
Esto no encierra nada. El titular sigue disponiendo de su capital con
normalidad — solo que hacen falta {{quorumN}} de sus llaves para moverlo.
No hay consejo de terceros, no hay beneficiarios, no hay capa productiva
obligatoria, y nadie más adquiere derecho alguno sobre esta cuenta.

5. ${PERSONAL_TAIL}`,
      en: `RULES OF {{nombre}} — v1
Date: {{fecha}} · XRPL account: {{cuenta}}

1. THE PURPOSE
This account belongs to one person: its holder. It is reinforced in order to:
{{proposito}}

2. THE PROTECTION
The account obeys no single key: it obeys the quorum of the holder’s keys.
A key that is lost, stolen or coerced can move nothing. The master key is
disabled: the account only obeys the quorum.

3. THE KEYS
All keys belong to the holder:
{{llaves}}
Quorum: {{quorumN}} of {{totalN}}. Changing these rules or the keys
requires that quorum.

4. WHAT THIS IS NOT
This locks nothing away. The holder goes on using their capital normally —
it simply takes {{quorumN}} of their keys to move it. There is no council of
third parties, no beneficiaries, no compulsory productive layer, and nobody
else acquires any right over this account.

5. ${PERSONAL_TAIL_EN}`,
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
    // T4 (tipologías 15-ago). The referee is NOT optional: 2-of-2 over shared
    // capital is a freezer the day the couple breaks — the referee is the
    // on-ledger way OUT of deadlock, never a third owner. E4, 2026-08-16.
    id: 'matrimonial',
    name: 'Couple patrimony (matrimonial)',
    description:
      'Shared capital of a couple, governed 2-of-3: both partners plus a referee whose only job is breaking a deadlock. The matrimonial property regime — not this document — says who owns what.',
    recommendedCouncil: '3 signers · quorum 2 — both partners + referee',
    available: false,
    fields: [
      { id: 'nombre', label: 'Legacy name', type: 'text', placeholder: 'Ana & Luis' },
      F_FECHA,
      F_CUENTA,
      {
        id: 'regimen',
        label: 'Matrimonial property regime',
        help: 'The legal regime that ACTUALLY says who owns this capital (community property, separation…), and where your marriage agreement (capitulaciones) lives, if one exists.',
        type: 'multiline',
        placeholder: 'Separation of property — agreement before notary X, date Y',
      },
      {
        id: 'proposito',
        label: 'Purpose',
        help: 'Why this shared patrimony exists, in your own words.',
        type: 'multiline',
        placeholder: 'That our shared capital produces without either of us being able to move it alone.',
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
        help: 'Share of each cycle’s yield that grows the base; the rest is at the couple’s disposal.',
        type: 'percent',
        default: '50',
      },
      {
        id: 'firmantes',
        label: 'The couple',
        help: 'One per line: "Name — rADDRESS — successor: Name, rADDRESS".',
        type: 'multiline',
        placeholder: 'Ana — r… — successor: …\nLuis — r… — successor: …',
      },
      {
        id: 'arbitro',
        label: 'The referee',
        help: 'A third signer BOTH trust (notary, sibling, lawyer): "Name — rADDRESS". They sign ONLY to break a tie on something one of you proposed — they own nothing and propose nothing.',
        type: 'text',
        placeholder: 'María (notary) — r…',
      },
      F_PLAZO_CURACION,
      F_SUPERVIVENCIA,
    ],
    body: {
      es: `CONSTITUCIÓN DEL {{nombre}} — v1
Fecha: {{fecha}} · Cuenta XRPL del Legacy: {{cuenta}}

1. EL PROPÓSITO
Este patrimonio común existe para: {{proposito}}

2. EL MUNDO AL QUE PERTENECE
Esta constitución NO cambia de quién es el capital. Quién es dueño de qué lo
dice el régimen económico matrimonial:
{{regimen}}
Este documento es la capa de gobierno del capital común; las capitulaciones
matrimoniales son su capa legal. Si quieres que estas reglas obliguen ante un
tribunal, llévalas a tus capitulaciones con un profesional.

3. LO INTOCABLE
El capital base común no se vende: produce, y se vive de lo que produce.
Una reserva del {{reservaPct}}% permanece en XRP nativo, en la cuenta del
consejo, fuera de la capa productiva.

4. LOS FRUTOS
Del rendimiento de cada ciclo: el {{capitalizaPct}}% se capitaliza al
patrimonio; el resto queda a disposición de la pareja, por acuerdo.

5. EL CONSEJO DE LA PAREJA
Firmantes:
{{firmantes}}
El árbitro: {{arbitro}}
Quórum: 2 de 3. El árbitro NO es un tercer dueño: no propone ni recibe nada.
Firma únicamente para desempatar algo que uno de los dos propuso. Un 2-de-2
sin árbitro es un congelador el día que la pareja no se pone de acuerdo — por
eso el árbitro no es opcional en esta plantilla. La llave maestra de la
cuenta está deshabilitada: la cuenta solo obedece al consejo.

6. LA SALIDA
Si la pareja se separa, el capital se parte por la regla del régimen de la
sección 2, ejecutada como ceremonia por el quórum (cualquiera de los dos +
el árbitro bastan). Honesto: la partición es una operación del quórum sobre
el ledger, no un automatismo — sin quórum no hay partición, y esa es
exactamente la protección.

7. ${SUPREMACIA}

8. ${COMMON_TAIL}`,
      en: `CONSTITUTION OF {{nombre}} — v1
Date: {{fecha}} · Legacy XRPL account: {{cuenta}}

1. THE PURPOSE
This shared patrimony exists to: {{proposito}}

2. THE WORLD IT BELONGS TO
This constitution does NOT change who owns the capital. Who owns what is
said by the matrimonial property regime:
{{regimen}}
This document is the shared capital’s governance layer; the marriage
agreement is its legal layer. If you want these rules to bind in court,
take them into your marriage agreement with a professional.

3. THE UNTOUCHABLE
The shared base capital is not sold: it produces, and one lives off what it
produces. A reserve of {{reservaPct}}% stays in native XRP, on the council’s
account, outside the productive layer.

4. THE FRUITS
Of each cycle’s yield: {{capitalizaPct}}% is capitalized back into the
patrimony; the rest is at the couple’s disposal, by agreement.

5. THE COUPLE’S COUNCIL
Signers:
{{firmantes}}
The referee: {{arbitro}}
Quorum: 2 of 3. The referee is NOT a third owner: they propose nothing and
receive nothing. They sign only to break a tie on something one of the two
proposed. A 2-of-2 with no referee is a freezer the day the couple cannot
agree — that is why the referee is not optional in this template. The
account’s master key is disabled: the account only obeys the council.

6. THE EXIT
If the couple separates, the capital is split by the regime’s rule in
section 2, executed as a quorum ceremony (either partner + the referee
suffice). Honestly: the split is a quorum operation on the ledger, not an
automatism — no quorum, no split, and that is exactly the protection.

7. ${SUPREMACIA_EN}

8. ${COMMON_TAIL_EN}`,
    },
  },
  {
    // T6 (tipologías 15-ago). Weights = ownership: basis points that add to
    // 10,000 across at most 32 seats (the ledger's SignerList bound). Entry
    // is NEVER permissionless; the Q5 line (passive contributors expecting
    // managed returns = collective investment) is said in the text itself.
    id: 'socios',
    name: 'Partners’ holding (weighted)',
    description:
      'Partners who DO want transferable ownership over a shared patrimony: signer weights mirror ownership, in basis points that add up to 10,000, across at most 32 seats.',
    recommendedCouncil: 'up to 32 seats · weights = ownership (Σ 10,000 bps)',
    available: false,
    fields: [
      { id: 'nombre', label: 'Legacy name', type: 'text', placeholder: 'Holding Astryum' },
      F_FECHA,
      F_CUENTA,
      {
        id: 'objeto',
        label: 'Object',
        help: 'What this holding exists to hold and why.',
        type: 'multiline',
        placeholder: 'Hold and produce the partners’ shared capital under written rules.',
      },
      {
        id: 'socios',
        label: 'The partners',
        help: 'One per line: "Name — rADDRESS — ownership (bps) — successor". Basis points MUST add up to 10,000 (100% = 10,000 bps; 25.5% = 2,550). At most 32 seats.',
        type: 'multiline',
        placeholder: 'Ana — r… — 4000 — successor: …\nLuis — r… — 3500 — successor: …\nMarco — r… — 2500 — successor: …',
      },
      {
        id: 'quorumBps',
        label: 'Quorum (bps)',
        help: 'Weight required to move anything, in basis points of ownership. 5,001 = simple majority of ownership; raise it for supermajority decisions.',
        type: 'number',
        default: '5001',
      },
      {
        id: 'reservaPct',
        label: 'Native XRP reserve (%)',
        type: 'percent',
        default: '20',
      },
      {
        id: 'capitalizaPct',
        label: 'Fruits capitalized back (%)',
        help: 'The rest is distributed to the partners pro-rata to their weights.',
        type: 'percent',
        default: '50',
      },
      {
        id: 'pacto',
        label: 'Partners’ agreement',
        help: 'Where the legal-layer agreement (pacto de socios) lives, if one exists — the document that makes these rules bind between partners.',
        type: 'text',
        placeholder: 'Private agreement, notarised on…  /  "none yet"',
      },
      F_PLAZO_CURACION,
      F_SUPERVIVENCIA,
    ],
    body: {
      es: `CONSTITUCIÓN DEL {{nombre}} — v1
Fecha: {{fecha}} · Cuenta XRPL del Legacy: {{cuenta}}

1. EL OBJETO
Este patrimonio de socios existe para: {{objeto}}

2. EL MUNDO AL QUE PERTENECE
Esta estructura NO es una sociedad: sin vehículo legal, el ledger no cambia
de quién es el capital ni crea participaciones transmisibles frente a
terceros. La capa legal que obliga entre socios es el pacto de socios:
{{pacto}}
Si el círculo quiere propiedad plenamente transmisible (venta, herencia,
embargo), el vehículo societario es el camino — este documento es la capa
de gobierno que ese vehículo ejecutará.

3. LAS PARTICIPACIONES
Los socios y sus pesos (en puntos básicos, suma exacta 10.000 — máximo 32
asientos):
{{socios}}
Quórum: {{quorumBps}} puntos básicos de peso. Los pesos del consejo son el
espejo de la propiedad: cambiar la propiedad exige cambiar los pesos, por
ceremonia de rotación firmada por el quórum.

4. LA ENTRADA Y LA TRANSMISIÓN
La entrada al círculo JAMÁS es abierta: alta, baja y toda transmisión de
peso (venta, herencia, embargo) se ejecuta como ceremonia de rotación por
quórum, y se registra. Toda transmisión que ocurra en el mundo legal DEBE
proyectarse al ledger en el plazo de curación de la sección 7.

5. LO QUE ESTA ESTRUCTURA NO ES
Este círculo es CERRADO y sus socios gobiernan su propio capital. No acepta
aportantes pasivos que esperen un rendimiento gestionado por otros: eso es
un organismo de inversión colectiva y exige licencia. Si el círculo quiere
eso algún día, es otro vehículo y otra conversación con un profesional.

6. LO INTOCABLE Y LOS FRUTOS
El capital base no se vende. Una reserva del {{reservaPct}}% permanece en
XRP nativo, fuera de la capa productiva. Del rendimiento de cada ciclo, el
{{capitalizaPct}}% se capitaliza; el resto se distribuye a los socios en
proporción exacta a sus pesos.

7. ${SUPREMACIA}

8. ${COMMON_TAIL}`,
      en: `CONSTITUTION OF {{nombre}} — v1
Date: {{fecha}} · Legacy XRPL account: {{cuenta}}

1. THE OBJECT
This partners’ patrimony exists to: {{objeto}}

2. THE WORLD IT BELONGS TO
This structure is NOT a company: without a legal vehicle, the ledger does
not change who owns the capital, nor does it create ownership transferable
against third parties. The legal layer that binds between partners is the
partners’ agreement:
{{pacto}}
If the circle wants fully transferable ownership (sale, inheritance,
seizure), a corporate vehicle is the path — this document is the governance
layer that vehicle will execute.

3. THE OWNERSHIP WEIGHTS
The partners and their weights (in basis points, adding up to exactly
10,000 — at most 32 seats):
{{socios}}
Quorum: {{quorumBps}} basis points of weight. The council’s weights mirror
ownership: changing ownership requires changing the weights, by a rotation
ceremony signed by the quorum.

4. ENTRY AND TRANSFER
Entry into the circle is NEVER open: joining, leaving and every transfer of
weight (sale, inheritance, seizure) executes as a quorum rotation ceremony,
and is recorded. Every transfer that happens in the legal world MUST be
projected onto the ledger within section 7’s cure deadline.

5. WHAT THIS STRUCTURE IS NOT
This circle is CLOSED and its partners govern their own capital. It does
not accept passive contributors expecting returns managed by others: that
is a collective investment scheme and requires a licence. If the circle
ever wants that, it is another vehicle and another conversation with a
professional.

6. THE UNTOUCHABLE AND THE FRUITS
The base capital is not sold. A reserve of {{reservaPct}}% stays in native
XRP, outside the productive layer. Of each cycle’s yield, {{capitalizaPct}}%
is capitalized; the rest is distributed to the partners in exact proportion
to their weights.

7. ${SUPREMACIA_EN}

8. ${COMMON_TAIL_EN}`,
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
