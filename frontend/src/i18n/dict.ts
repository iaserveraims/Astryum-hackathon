// Lightweight i18n for the dashboard. Strategy: the English strings ARE the keys, so we
// can translate incrementally by wrapping a string with t() and adding its Spanish entry
// here — no key bookkeeping, no restructuring. t(s) returns the Spanish entry when lang is
// 'es' and it exists, otherwise the original English string.

export type Lang = 'es' | 'en';

/** English string → Spanish. Add entries as screens get translated. */
export const ES: Record<string, string> = {
  // ── Strategy NLP compiler ──
  'Put 5 XRP to work in the FXRP vault at ratio 0.30 with protection at HF 1.10':
    'Pon 5 XRP a trabajar en el vault de FXRP con ratio 0.30 y protección en HF 1.10',
  'Describe the strategy — Astryum compiles it, you review and sign':
    'Describe la estrategia — Astryum la compila, tú revisas y firmas',
  Compile: 'Compilar',
  'Could not compile — include an XRP amount, e.g. "5 XRP", plus optional ratio and HF.':
    'No se pudo compilar — incluye una cantidad en XRP, p. ej. «5 XRP», y opcionalmente ratio y HF.',

  // ── Sidebar groups ──
  Workspace: 'Espacio',
  Markets: 'Mercados',
  Strategy: 'Estrategia',
  Risk: 'Riesgo',
  Intelligence: 'Inteligencia',
  System: 'Sistema',

  // ── Sidebar destinations ──
  Overview: 'Resumen',
  // The /app overview is named "Home" since 2026-08-04 ("Summary" stays for
  // stray consumers); Inicio is its Spanish face.
  Home: 'Inicio',
  Summary: 'Resumen',
  Earn: 'Generar',
  Savings: 'Ahorro',

  // ── Savings (XRPL escrow, B.1) ──
  'XRPL native': 'Nativo XRPL',
  'Set XRP aside on the ledger until a date you choose. It earns nothing while locked — this is a savings lock, not a yield product. Astryum composes the escrow unsigned; you sign in Xaman. XRP only — RLUSD is not escrowable today (issuer flag off).':
    'Aparta XRP en el ledger hasta la fecha que elijas. No genera rendimiento mientras está bloqueado — es un candado de ahorro, no un producto de yield. Astryum compone el escrow sin firmar; tú firmas en Xaman. Solo XRP — RLUSD no es escrowable hoy (flag del emisor apagado).',
  'Amount (drops)': 'Cantidad (drops)',
  Destination: 'Destino',
  'Back to your own account': 'Vuelve a tu propia cuenta',
  'Generates yield': 'Genera rendimiento',
  Unlocks: 'Se desbloquea',
  'Cancellable after': 'Cancelable después de',
  Owner: 'Propietario',
  'Escrow sequence': 'Secuencia del escrow',
  'Anyone can release after unlock': 'Cualquiera puede liberarlo tras el desbloqueo',
  yes: 'sí',
  no: 'no',
  'Not enough spendable XRP.': 'No hay XRP disponible suficiente.',
  'Available after ledger reserves:': 'Disponible tras las reservas del ledger:',
  'Spendable:': 'Disponible:',
  'ledger reserve': 'reserva del ledger',
  'Extra ledger reserve (XRP)': 'Reserva extra del ledger (XRP)',
  "Don't want to come back to release it yourself? The XRPL ecosystem has a permissionless auto-release service:":
    '¿No quieres volver a liberarlo tú? El ecosistema XRPL tiene un servicio permissionless de auto-liberación:',
  '— a third-party service (not Astryum) with a small XRP fee. Sign in there with this same Xaman account, pick this saving and enable it. Its keeper signs the release with its own key — your XRP can only ever land in your own account.':
    '— un servicio de terceros (no de Astryum) con una pequeña fee en XRP. Entra allí con esta misma cuenta de Xaman, elige este ahorro y actívalo. Su keeper firma la liberación con su propia clave — tu XRP solo puede acabar en tu propia cuenta.',
  'Each active saving also sets aside': 'Cada ahorro activo aparta además',
  'of ledger reserve — it returns to your balance when you release it.':
    'de reserva del ledger — vuelve a tu saldo cuando lo liberas.',
  'The ledger takes a few seconds — the list refreshes itself.':
    'El ledger tarda unos segundos — la lista se actualiza sola.',
  'Release signed and submitted.': 'Liberación firmada y enviada.',
  'it may already have been released (anyone can, after the unlock date); the XRP always ends at its destination.':
    'puede que ya estuviera liberado (cualquiera puede hacerlo tras la fecha de desbloqueo); el XRP siempre acaba en su destino.',
  'Savings rules': 'Reglas de ahorro',
  'New rule': 'Nueva regla',
  'A rule only watches and reminds: when it fires, Astryum prepares the escrow here and YOU sign it in Xaman. Nothing moves without your signature.':
    'Una regla solo vigila y avisa: cuando se dispara, Astryum prepara el escrow aquí y TÚ lo firmas en Xaman. Nada se mueve sin tu firma.',
  When: 'Cuándo',
  'Idle XRP exceeds a threshold': 'El XRP ocioso supera un umbral',
  'Every Monday (09:00 UTC)': 'Cada lunes (09:00 UTC)',
  'Every 1st of the month (09:00 UTC)': 'Cada día 1 del mes (09:00 UTC)',
  'Idle threshold (USD)': 'Umbral de ocioso (USD)',
  'Amount to set aside (XRP)': 'Cantidad a apartar (XRP)',
  'Lock for (days)': 'Bloquear durante (días)',
  'Create rule': 'Crear regla',
  'No savings rules yet': 'Aún no hay reglas de ahorro',
  'Create one and Astryum will nudge you to set XRP aside — you always sign in Xaman.':
    'Crea una y Astryum te avisará para apartar XRP — siempre firmas tú en Xaman.',
  'Save when idle XRP exceeds': 'Ahorra cuando el XRP ocioso supere',
  'Weekly savings reminder': 'Recordatorio de ahorro semanal',
  'Monthly savings reminder': 'Recordatorio de ahorro mensual',
  'Idle XRP over': 'XRP ocioso sobre',
  'every Monday': 'cada lunes',
  'every 1st of the month': 'cada día 1 del mes',
  days: 'días',
  nudges: 'avisos',
  Pause: 'Pausar',
  Resume: 'Reanudar',
  'Lock days must be a positive whole number.': 'Los días de bloqueo deben ser un entero positivo.',
  'Enter a positive USD threshold.': 'Introduce un umbral en USD positivo.',
  'Connect an XRPL wallet': 'Conecta una wallet XRPL',
  'Savings escrows live on your own XRPL account — connect Xaman from Wallets to start.':
    'Los escrows de ahorro viven en tu propia cuenta XRPL — conecta Xaman desde Wallets para empezar.',
  'Set XRP aside': 'Aparta XRP',
  'Amount (XRP)': 'Cantidad (XRP)',
  'Locked until': 'Bloqueado hasta',
  Locked: 'Bloqueado',
  Review: 'Revisar',
  'Sign in Xaman': 'Firmar en Xaman',
  Back: 'Atrás',
  'Your escrows': 'Tus escrows',
  'No savings locked yet': 'Aún no hay ahorro bloqueado',
  'Escrows you create appear here, and in your portfolio as locked value.':
    'Los escrows que crees aparecen aquí, y en tu portfolio como valor bloqueado.',
  until: 'hasta',
  conditional: 'condicional',
  incoming: 'entrante',
  locked: 'bloqueado',
  Release: 'Liberar',
  'After the unlock date, anyone can release a time-based escrow — the XRP always goes to its destination. No key is ever delegated.':
    'Pasada la fecha de desbloqueo, cualquiera puede liberar un escrow temporal — el XRP siempre va a su destino. Nunca se delega ninguna clave.',
  'Enter a positive XRP amount.': 'Introduce una cantidad de XRP positiva.',
  'Pick the date the savings unlock.': 'Elige la fecha en la que se desbloquea el ahorro.',
  'Signed and submitted from your wallet.': 'Firmado y enviado desde tu wallet.',
  'View on XRPScan': 'Ver en XRPScan',
  'The order': 'La orden',
  'Operation': 'Operación',
  'Order number (sequential)': 'Número de orden (secuencial)',
  'Order fingerprint': 'Huella de la orden',
  'Service fee': 'Comisión del servicio',
  'Vault (the cage)': 'Vasija (la jaula)',
  'Bridge (executes on Flare)': 'Puente (ejecuta en Flare)',
  'Constitution in force': 'Constitución vigente',
  'Time until it executes': 'Tiempo hasta que se ejecuta',
  'Minting fee (XRP)': 'Comisión de acuñación (XRP)',
  'Executor fee (XRP)': 'Comisión del ejecutor (XRP)',
  'Principal that lands': 'Principal que aterriza',
  'Principal can be withdrawn': 'El principal se puede retirar',
  'Signed by': 'Lo firma',
  'Astryum signs': 'Astryum firma',
  'Putting it to work needs a separate order': 'Ponerlo a trabajar exige otra orden aparte',
  'Venue': 'Destino',
  'Realizes': 'Realiza',
  'Touches the principal': 'Toca el principal',
  'Anyone can send it': 'Cualquiera puede enviarla',
  'Yield claimed': 'Rendimiento reclamado',
  'Arrives as': 'Llega como',
  'Your council signs this Payment of': 'Tu consejo firma aquí este Payment de',
  'here, each member from their own device. The signature authorizes ONLY the order above — same bytes, once, in order.':
    ', cada miembro desde su propio dispositivo. La firma autoriza SOLO la orden de arriba — los mismos bytes, una vez y en orden.',
  'Signatures still missing': 'Firmas que faltan',
  'Council proposals': 'Propuestas del consejo',
  'Open the proposal inbox': 'Abrir la bandeja de propuestas',
  'Emit': 'Emitir',
  'expires today': 'caduca hoy',
  'Sent to their Xaman as a notification — the QR still works.':
    'Enviada a su Xaman como notificación — el QR sigue valiendo.',
  'No notification yet for this member: they sign the QR once, and from then on Xaman can notify them.':
    'Aún no hay notificación para este miembro: que firme el QR una vez y a partir de ahí Xaman ya puede avisarle.',
  'Signed it elsewhere? Paste the signature': '¿Lo firmaste fuera? Pega la firma',
  'Xaman will not create QRs for this transaction type from this app. The proven route is the Xaman Multisign xApp — the same one this council was constituted with: open “Prefer your own multisign tool?” below, copy the transaction and sign it there with the quorum.':
    'Xaman no crea QRs de este tipo de transacción desde esta app. El camino probado es el xApp Multisign de Xaman — el mismo con el que se constituyó este consejo: abre «Prefer your own multisign tool?» aquí abajo, copia la transacción y fírmala allí con el quórum.',
  'Sign these EXACT bytes in your own multisign tool (xrpl.services, the Xaman Multisign xApp…) and paste the resulting signed blob. Change nothing: a single altered field is rejected.':
    'Firma estos bytes EXACTOS en tu propia herramienta multifirma (xrpl.services, el xApp Multisign de Xaman…) y pega el blob firmado que salga. No cambies nada: un solo campo distinto se rechaza.',
  'Copy the transaction to sign': 'Copiar la transacción a firmar',
  'Paste the signed blob (hex)': 'Pega el blob firmado (hex)',
  'Add this signature': 'Añadir esta firma',
  'This account is not on the Legacy access list on the server.':
    'Esta cuenta no está en la lista de acceso a Legacy del servidor.',
  'Amend the council (replace a signer)': 'Enmendar el consejo (sustituir un firmante)',
  'Replace a signer': 'Sustituir un firmante',
  'Replace a signer / amend the council': 'Sustituir un firmante / enmendar el consejo',
  'One SignerListSet with the full NEW list, signed by the CURRENT quorum.':
    'Un solo SignerListSet con la lista NUEVA completa, firmado por el quórum ACTUAL.',
  'The form starts from the CURRENT council. Edit only what changes — the new list REPLACES the old one entirely, and the CURRENT quorum signs the amendment. The new council governs from the next transaction on.':
    'El formulario arranca del consejo ACTUAL. Cambia solo lo que cambia — la lista nueva SUSTITUYE a la vieja por completo, y la enmienda la firma el quórum ACTUAL. El consejo nuevo gobierna desde la siguiente transacción.',
  'After it validates, anchor a new constitution version (DIDSet) so the amendment is written in the family record too.':
    'Cuando valide, ancla una versión nueva de la constitución (DIDSet) para que la enmienda quede también en el registro de la familia.',
  'Council amended — the new signer list replaces the old one on the ledger.':
    'Consejo enmendado — la lista de firmantes nueva sustituye a la vieja en el ledger.',
  'Council order · the cage': 'Orden del consejo · la jaula',
  'Council · quorum signs': 'Consejo · firma el quórum',
  'Move capital': 'Mover capital',
  'The relay is stuck:': 'El relé está atascado:',
  'Retry the relay': 'Reintentar el relé',
  'Executed in the cage — the bridge consumed this order.':
    'Ejecutada en la jaula — el puente consumió esta orden.',
  'The order is signed and valid, but the relay is off — the proof can be delivered by anyone later; no signature is lost.':
    'La orden está firmada y es válida, pero el relé está apagado — cualquiera puede entregar la prueba más tarde; ninguna firma se pierde.',
  'Council order — the relay is carrying the FDC proof to the cage (~2–5 min). Done means the bridge consumed it, not this screen.':
    'Orden del consejo — el relé lleva la prueba FDC a la jaula (~2–5 min). El verde llega cuando el puente la consume, no antes.',
  'Signing was cancelled.': 'La firma se canceló.',
  'XRPL savings are not enabled on this deployment yet (feature flag off).':
    'El ahorro XRPL aún no está activado en este despliegue (feature flag apagado).',
  'DeFi execution is not available for your region. Set your region in Settings — monitoring stays available.':
    'La ejecución DeFi no está disponible en tu región. Configura tu región en Ajustes — la monitorización sigue disponible.',
  'Your session expired — sign in again to continue.':
    'Tu sesión caducó — vuelve a iniciar sesión para continuar.',
  'Something went wrong.': 'Algo salió mal.',
  'Explore Earn': 'Explorar Generar',
  Put: 'Pon',
  'to work': 'a trabajar',
  'Audited Flare vaults — supply FXRP and FLR, see real conditions, and prepare every action for your signature.':
    'Vaults auditados en Flare — aporta FXRP y FLR, ve las condiciones reales y prepara cada acción para tu firma.',
  Wallet: 'Cartera',
  Portfolio: 'Cartera',
  Positions: 'Posiciones',
  Wallets: 'Wallets',
  Activity: 'Actividad',
  Transactions: 'Transacciones',
  'Capital Map': 'Mapa de capital',

  // ── Profile / account personalization ──
  Profile: 'Perfil',
  'Display name': 'Nombre visible',
  'Save profile': 'Guardar perfil',
  Saved: 'Guardado',
  'Change photo': 'Cambiar foto',
  Remove: 'Quitar',
  'How you appear across Astryum. Stored on this device only.':
    'Cómo apareces en Astryum. Se guarda solo en este dispositivo.',

  'Safe Markets': 'Mercados seguros',
  Swap: 'Swap',
  'Send & Buy': 'Enviar y comprar',
  Watchlist: 'Seguimiento',
  Goals: 'Objetivos',
  'My Strategy': 'Mi estrategia',
  'Money Flow Builder': 'Constructor de flujos',
  Intents: 'Intenciones',
  Marketplace: 'Marketplace',
  Manager: 'Gestor',
  Mandate: 'Mandato',
  Alerts: 'Alertas',
  Rules: 'Reglas',
  'Trigger Rules': 'Reglas de disparo',
  'AI Copilot': 'Copiloto IA',
  Agent: 'Agente',
  Points: 'Puntos',
  'Tax Export': 'Exportar impuestos',
  Integrations: 'Integraciones',
  'Blockchain Tools': 'Herramientas blockchain',
  'DeFi Calculators': 'Calculadoras DeFi',
  Settings: 'Ajustes',

  // ── Redesigned IA (10-menu dashboard) ──
  Operate: 'Operar',
  'Asset Production': 'Producción de activos',
  'Exchange & Swap': 'Exchange y Swap',
  Trading: 'Trading',
  'Triggered Executions': 'Ejecuciones programadas',
  'Asset Info': 'Información de activos',
  'Tax Report': 'Informe fiscal',
  'Buy / Sell': 'Comprar / Vender',
  'Stellar Swap': 'Swap Stellar',

  // ── Portfolio filters ──
  All: 'Todas',
  'Search asset or protocol…': 'Buscar activo o protocolo…',
  'Clear search': 'Limpiar búsqueda',
  'Hide dust (<$1)': 'Ocultar polvo (<$1)',
  shown: 'mostrados',
  'Clear filters': 'Limpiar filtros',
  'No positions match these filters.': 'Ninguna posición coincide con estos filtros.',

  // ── Shell / topbar ──
  Search: 'Buscar',
  'Search…': 'Buscar…',
  'Search destinations…': 'Buscar destinos…',
  'No matches': 'Sin resultados',
  'Connect wallet': 'Conectar wallet',
  Collapse: 'Colapsar',
  Expand: 'Expandir',
  'Expand sidebar': 'Expandir barra lateral',
  'Collapse sidebar': 'Colapsar barra lateral',
  'Show advanced menus': 'Mostrar menús avanzados',
  'Show every tool and advanced menu': 'Muestra todas las herramientas y menús avanzados',
  Logout: 'Cerrar sesión',
  Connected: 'Conectado',
  'Dev bypass': 'Modo dev',

  // ── Overview / dashboard ──
  Welcome: 'Bienvenido',
  'Observation, risk and execution engines for your Flare positions. Protection-first, non-custodial, deterministic by design.':
    'Motores de observación, riesgo y ejecución para tus posiciones en Flare. Protección primero, no-custodial, determinista por diseño.',
  'Engines online': 'Motores activos',
  'Non-custodial · You always sign': 'No-custodial · Tú siempre firmas',
  'Astryum reads your on-chain positions, scores their risk in real time, and prepares every action for your signature. Read-only until you sign — nothing moves without you.':
    'Astryum lee tus posiciones on-chain, evalúa su riesgo en tiempo real y prepara cada acción para tu firma. Solo lectura hasta que firmas — nada se mueve sin ti.',
  'Explore markets': 'Explorar mercados',
  'Real-time snapshots': 'Snapshots en tiempo real',
  'Deterministic risk': 'Riesgo determinista',
  'You sign everything': 'Tú firmas todo',
  'Net worth': 'Patrimonio neto',
  'Risk Score': 'Puntuación de riesgo',
  'Unread alerts': 'Alertas sin leer',
  positions: 'posiciones',
  chain: 'cadena',
  chains: 'cadenas',
  'Loading…': 'Cargando…',
  'Watch out': 'Atención',
  Healthy: 'Saludable',
  'Needs attention': 'Requiere atención',
  'All clear': 'Todo en orden',
  'Recent alerts': 'Alertas recientes',
  'View all': 'Ver todo',
  'Open portfolio': 'Abrir cartera',
  Holdings: 'Tenencias',
  Protocol: 'Protocolo',
  Chain: 'Cadena',
  Kind: 'Tipo',
  Asset: 'Activo',
  'Jump back in': 'Retomar',
  'to search everything': 'para buscar todo',
  Allocation: 'Distribución',
  'No allocation data': 'Sin datos de distribución',
  'Free balances, collateral, debt, LP and staking — unified snapshot.':
    'Balances libres, colateral, deuda, LP y staking — vista unificada.',
  'Health Factor, LTV, distance to liquidation, stress tests.':
    'Health Factor, LTV, distancia a liquidación, stress tests.',
  'Per-protocol open positions with live metrics.': 'Posiciones abiertas por protocolo con métricas en vivo.',
  'Pending and signed transaction intents waiting your action.': 'Intents pendientes y firmados esperando tu acción.',
  'Broadcast, confirmation and audit trail.': 'Difusión, confirmación y registro de auditoría.',
  'Triggers fired by the Risk Engine and Automation.': 'Disparos del Risk Engine y la Automatización.',
  'Ask, explain risk, get prepared intents over real data.':
    'Pregunta, explica el riesgo y obtén intents preparados sobre datos reales.',
  'Activity score, level, and credit conversions.': 'Puntuación de actividad, nivel y conversiones de crédito.',

  // ── Settings ──
  'Connection, network, expert toggles. No private keys are ever stored here.':
    'Conexión, red y opciones de experto. Aquí nunca se guardan claves privadas.',
  Account: 'Cuenta',
  Address: 'Dirección',
  'Not connected': 'Sin conectar',
  'Sign out': 'Cerrar sesión',
  Network: 'Red',
  'V1 intents': 'Intents V1',
  'Require SIWE': 'Requerir SIWE',
  enabled: 'activado',
  disabled: 'desactivado',
  on: 'activo',
  off: 'inactivo',
  Preferences: 'Preferencias',
  'Expert mode': 'Modo experto',
  'Show advanced controls (raw calldata, gas overrides, manual intent JSON).':
    'Muestra controles avanzados (calldata en crudo, ajustes de gas, JSON de intent manual).',
  Theme: 'Tema',
  Dark: 'Oscuro',
  Light: 'Claro',
  'Dark space or light paper.': 'Espacio oscuro o papel claro.',
  'Initial setup': 'Configuración inicial',
  'Pick your language, goal and connect a wallet again.':
    'Elige idioma, objetivo y conecta una wallet de nuevo.',
  'Run again': 'Volver a ejecutar',
  'Astryum is non-custodial': 'Astryum es no-custodial',
  'Astryum never stores or transmits your private keys. Every on-chain action is a TransactionIntent that you sign locally with your wallet. The backend only holds public addresses, simulations and signed intents.':
    'Astryum nunca guarda ni transmite tus claves privadas. Cada acción on-chain es un TransactionIntent que firmas localmente con tu wallet. El backend solo guarda direcciones públicas, simulaciones e intents firmados.',
  'Learn about Flare →': 'Saber más sobre Flare →',
};

// Page chrome across the whole dashboard (PageHeader eyebrow/title/subtitle, EmptyState
// titles, common buttons/tooltips). The shared primitives translate these automatically,
// so adding an entry here localizes it on every page at once. Merged into ES below.
const PAGES: Record<string, string> = {
  // headers / eyebrows
  'Alerts & Notifications': 'Alertas y notificaciones',
  Automation: 'Automatización',
  'Control plane': 'Plano de control',
  'DeFi Tools': 'Herramientas DeFi',
  History: 'Historial',
  'KYC Verified': 'KYC verificado',
  'Multi-chain capital overview': 'Vista de capital multi-cadena',
  'Points & gamification': 'Puntos y gamificación',
  Policy: 'Política',
  'Portfolio Settings': 'Ajustes de cartera',
  'Spending Caps & Allowances': 'Límites y permisos de gasto',
  'Tax event log': 'Registro de eventos fiscales',
  'Transaction History': 'Historial de transacciones',
  'Trigger rules': 'Reglas de disparo',
  // page titles
  'Mandate-compliant yield': 'Yield conforme a tu mandato',
  'Move your assets': 'Mueve tus activos',
  'Token swap': 'Intercambio de tokens',
  'Watched wallets': 'Wallets vigiladas',
  // subtitles
  'Multi-chain DeFi opportunities scored by the deterministic Risk Engine.':
    'Oportunidades DeFi multi-cadena puntuadas por el Risk Engine determinista.',
  'Multi-chain DeFi opportunities filtered by mandate, scored by the Risk Engine. Click any pool to review and prepare an intent.':
    'Oportunidades DeFi multi-cadena filtradas por tu mandato y puntuadas por el Risk Engine. Pulsa cualquier pool para revisar y preparar un intent.',
  'On-chain timeline · classified via canonical selectors · sourced from Flarescan':
    'Línea temporal on-chain · clasificada con selectores canónicos · vía Flarescan',
  'Swaps are routed through 1inch Aggregation API. Astryum never holds your tokens — you sign the transaction with your own wallet.':
    'Los swaps se enrutan vía la API de agregación de 1inch. Astryum nunca retiene tus tokens — firmas la transacción con tu propia wallet.',
  'Buy crypto with fiat via MoonPay, or send tokens to any wallet. Astryum never custodies funds or executes on your behalf.':
    'Compra cripto con fiat vía MoonPay, o envía tokens a cualquier wallet. Astryum nunca custodia fondos ni ejecuta por ti.',
  'Astryum monitors these wallets for DeFi positions and interactions. Only your own wallets — never any partner or third-party address.':
    'Astryum monitoriza estas wallets en busca de posiciones e interacciones DeFi. Solo tus propias wallets — nunca direcciones de terceros o partners.',
  'Triggers fired by the Risk Engine and Automation rules. All evaluated against on-chain data.':
    'Disparos del Risk Engine y las reglas de automatización. Todo evaluado contra datos on-chain.',
  'Audit trail of every signed intent, with link to Flarescan.':
    'Registro de auditoría de cada intent firmado, con enlace a Flarescan.',
  'Connect as many wallets as you want — even several from the same app. Connecting is read-only; enable transactions per wallet with a one-time signature.':
    'Conecta tantas wallets como quieras — incluso varias de la misma app. Conectar es solo lectura; habilita transacciones por wallet con una firma única.',
  'Describe what you want and the Agent will build the configuration.':
    'Describe lo que quieres y el Agente construye la configuración.',
  'Detected DeFi positions across all your watched wallets. Values are estimates from indexer data — verify on-chain before acting.':
    'Posiciones DeFi detectadas en tus wallets vigiladas. Los valores son estimaciones del indexador — verifica on-chain antes de actuar.',
  'Earn points by interacting with the platform. Convert power into credits as you level up.':
    'Gana puntos interactuando con la plataforma. Convierte power en créditos según subes de nivel.',
  'Every action you can sign is a TransactionIntent — formal, simulated, expirable.':
    'Cada acción que puedes firmar es un TransactionIntent — formal, simulado, caducable.',
  'Group MoneyFlows under named strategies. Each strategy aggregates TVL, PnL and risk across its flows. Build the underlying flows in the canvas.':
    'Agrupa MoneyFlows bajo estrategias con nombre. Cada estrategia agrega TVL, PnL y riesgo de sus flujos. Construye los flujos en el lienzo.',
  'Hard limits the PolicyGuard enforces on every intent before signing.':
    'Límites estrictos que PolicyGuard aplica a cada intent antes de firmar.',
  'Health Factor, LTV, liquidation distance and stress tests — calculated on-chain, no LLMs.':
    'Health Factor, LTV, distancia a liquidación y stress tests — calculado on-chain, sin LLMs.',
  'Live view discovered through the active protocol adapters.':
    'Vista en vivo descubierta a través de los adapters de protocolo activos.',
  'Multi-step agent with tool access, document context, and NLP rule management.':
    'Agente multipaso con acceso a herramientas, contexto documental y gestión de reglas por lenguaje natural.',
  'Providers registered with the V1.1 control plane · Flare Mainnet 14':
    'Proveedores registrados en el plano de control V1.1 · Flare Mainnet 14',
  'Rules that fire notifications when conditions are met. Astryum never auto-executes — all rules are notify-only. You always sign.':
    'Reglas que disparan notificaciones cuando se cumplen condiciones. Astryum nunca auto-ejecuta — todas las reglas solo notifican. Tú siempre firmas.',
  'Run institutional-grade DeFi calculations: health factor, impermanent loss, concentrated liquidity ranges, APY breakdown. All pure math — no wallet connection needed.':
    'Cálculos DeFi de nivel institucional: health factor, pérdida impermanente, rangos de liquidez concentrada, desglose de APY. Matemática pura — sin conectar wallet.',
  'Structured outputs over real engine data. The Copilot interprets — never substitutes the Risk Engine.':
    'Salidas estructuradas sobre datos reales de los motores. El Copiloto interpreta — nunca sustituye al Risk Engine.',
  'To add another account from the SAME wallet app, switch the active account inside that app first, then connect.':
    'Para añadir otra cuenta de la MISMA app de wallet, cambia primero la cuenta activa dentro de esa app y luego conecta.',
  'Triggers prepare a TransactionIntent. You always sign — never auto-broadcast.':
    'Los disparadores preparan un TransactionIntent. Tú siempre firmas — nunca auto-difusión.',
  'Triggers that prepare TransactionIntents when conditions hit. You always sign — never auto-broadcast.':
    'Disparadores que preparan TransactionIntents cuando se cumplen condiciones. Tú siempre firmas — nunca auto-difusión.',
  // empty / loading states
  'Computing risk…': 'Calculando riesgo…',
  'No data': 'Sin datos',
  'No activity yet': 'Aún no hay actividad',
  'No asset data yet': 'Aún no hay datos de activos',
  'No auto-generated reports yet': 'Aún no hay informes generados',
  'No badges defined yet': 'Aún no hay insignias definidas',
  'No chain data yet': 'Aún no hay datos de cadena',
  'No intents yet': 'Aún no hay intents',
  'No positions detected': 'No se detectaron posiciones',
  'No protocol data yet': 'Aún no hay datos de protocolo',
  'No protocols returned data yet': 'Aún ningún protocolo ha devuelto datos',
  'No providers registered': 'No hay proveedores registrados',
  'No rules yet': 'Aún no hay reglas',
  'No strategies yet': 'Aún no hay estrategias',
  'No tax events found': 'No se encontraron eventos fiscales',
  'No transactions recorded yet': 'Aún no hay transacciones registradas',
  'No trigger rules': 'No hay reglas de disparo',
  'No type data yet': 'Aún no hay datos por tipo',
  'No wallets in watchlist': 'No hay wallets en seguimiento',
  'Loading MoneyFlows canvas…': 'Cargando lienzo de MoneyFlows…',
  'Loading blockchain tools…': 'Cargando herramientas blockchain…',
  'Loading intents…': 'Cargando intents…',
  'Loading mandate…': 'Cargando mandato…',
  'Loading points…': 'Cargando puntos…',
  'Loading portfolio…': 'Cargando cartera…',
  'Loading strategies…': 'Cargando estrategias…',
  // sign-in gates
  'Sign in to manage rules': 'Inicia sesión para gestionar reglas',
  'Sign in to manage trigger rules': 'Inicia sesión para gestionar reglas de disparo',
  'Sign in to manage your watchlist': 'Inicia sesión para gestionar tu seguimiento',
  'Sign in to use Send & Buy': 'Inicia sesión para usar Enviar y comprar',
  'Sign in to use swap': 'Inicia sesión para usar el swap',
  'Sign in to use the Agent': 'Inicia sesión para usar el Agente',
  'Sign in to use the Copilot': 'Inicia sesión para usar el Copiloto',
  'Sign in to view alerts': 'Inicia sesión para ver las alertas',
  'Sign in to view intents': 'Inicia sesión para ver los intents',
  'Sign in to view portfolio': 'Inicia sesión para ver la cartera',
  'Sign in to view positions': 'Inicia sesión para ver las posiciones',
  'Sign in to view risk': 'Inicia sesión para ver el riesgo',
  'Sign in to view tax events': 'Inicia sesión para ver eventos fiscales',
  'Sign in to view transactions': 'Inicia sesión para ver las transacciones',
  'Sign in to view your capital map': 'Inicia sesión para ver tu mapa de capital',
  // common buttons / tooltips
  'By Asset': 'Por activo',
  'By Kind': 'Por tipo',
  'By Protocol': 'Por protocolo',
  Cancel: 'Cancelar',
  Save: 'Guardar',
  Rename: 'Renombrar',
  'Close goal': 'Cerrar objetivo',
  'Copy address': 'Copiar dirección',
  'Copy hash': 'Copiar hash',
  'View on explorer': 'Ver en el explorador',
  'Re-scan on-chain': 'Reescanear on-chain',
  'Sync from Zerion': 'Sincronizar desde Zerion',
  'New chat': 'Nuevo chat',
  'New automation rule': 'Nueva regla de automatización',
  'New rule — natural language': 'Nueva regla — lenguaje natural',
  'Convert power → credits': 'Convertir power → créditos',
  'Toggle conversations': 'Mostrar/ocultar conversaciones',
  'Make this the default wallet for its chain ecosystem': 'Hacer esta la wallet por defecto de su ecosistema',

  // ── Risk page ──
  Level: 'Nivel',
  'Liq distance': 'Dist. liquidación',
  Drivers: 'Factores',
  Warnings: 'Avisos',
  'No warnings — portfolio looks clean': 'Sin avisos — la cartera está limpia',
  Assumptions: 'Supuestos',
  'Stress test': 'Prueba de estrés',
  'Simulate the impact of an asset price drop on your portfolio':
    'Simula el impacto de una caída de precio de un activo sobre tu cartera',
  'Running…': 'Ejecutando…',
  'Run scenario': 'Ejecutar escenario',
  'Computed at': 'Calculado a las',

  // ── Send & Buy ──
  'Buy Crypto': 'Comprar cripto',
  'Fiat → Crypto via MoonPay': 'Fiat → Cripto vía MoonPay',
  'Purchase crypto with your bank card or bank transfer. MoonPay is a regulated service — your crypto arrives directly in your wallet.':
    'Compra cripto con tu tarjeta o transferencia bancaria. MoonPay es un servicio regulado — tu cripto llega directamente a tu wallet.',
  'MoonPay executes · Astryum no custody': 'MoonPay ejecuta · Astryum sin custodia',
  Send: 'Enviar',
  'Native or ERC-20 transfer': 'Transferencia nativa o ERC-20',
  'Send native tokens or any ERC-20 to another wallet. Astryum builds the unsigned transaction — you sign with your wallet.':
    'Envía tokens nativos o cualquier ERC-20 a otra wallet. Astryum construye la transacción sin firmar — tú firmas con tu wallet.',
  'You sign · Astryum no custody': 'Tú firmas · Astryum sin custodia',

  // ── Transactions ──
  records: 'registros',
  'Sign and broadcast an intent to populate the trail.':
    'Firma y difunde un intent para poblar el registro.',
  'Tx Hash': 'Hash de tx',
  Status: 'Estado',
  Block: 'Bloque',
  Date: 'Fecha',

  // ── Alerts ──
  unread: 'sin leer',
  'Unread only': 'Solo sin leer',
  Recent: 'Recientes',
  'No active alerts. The Risk Engine will surface them here when triggers fire.':
    'Sin alertas activas. El Risk Engine las mostrará aquí cuando se disparen.',
  'Mark read': 'Marcar leída',

  // ── Positions ──
  'No active adapters': 'Sin adapters activos',
  'Adapters may be inactive or the wallet has no positions.':
    'Puede que los adapters estén inactivos o que la wallet no tenga posiciones.',
  'No positions on this protocol': 'Sin posiciones en este protocolo',
  Amount: 'Cantidad',

  // ── Activity ──
  'syncing…': 'sincronizando…',
  'Refresh from Flarescan': 'Actualizar desde Flarescan',
  'Loading timeline…': 'Cargando timeline…',
  // Ceguera del carril Flare: vacío por no poder mirar ≠ vacío de verdad.
  'We cannot read Flare right now — this list may be incomplete.':
    'Ahora mismo no podemos leer Flare — esta lista puede estar incompleta.',
  'What you see is what we had saved, up to':
    'Lo que ves es lo que teníamos guardado, hasta',
  'Your XRPL movements are unaffected.': 'Tus movimientos de XRPL no se ven afectados.',
  'Your XRPL movements are unaffected. Try refreshing in a few minutes.':
    'Tus movimientos de XRPL no se ven afectados. Prueba a actualizar en unos minutos.',
  // Leer TODAS las carteras a la vez es la parte frágil: cuando alguna no
  // contesta, la salida que sí funciona es mirar una sola.
  'Select the exact wallet to see the activity':
    'Selecciona la cartera exacta para ver la actividad',
  'Some wallets did not answer — this list is missing their movements.':
    'Algunas carteras no han contestado — a esta lista le faltan sus movimientos.',
  'Reading every wallet at once is the fragile part; one at a time always loads.':
    'Leerlas todas a la vez es la parte frágil; de una en una siempre carga.',
  'Reading every wallet at once is the fragile part, and none of them answered — this is not an empty history. Pick one wallet in the filter above and its timeline loads on its own.':
    'Leerlas todas a la vez es la parte frágil, y no ha contestado ninguna — esto no es un historial vacío. Elige una cartera en el filtro de arriba y su timeline carga solo.',
  'Some wallets did not answer, so this is not an empty history. Pick one wallet in the filter above and its timeline loads on its own.':
    'Algunas carteras no han contestado, así que esto no es un historial vacío. Elige una cartera en el filtro de arriba y su timeline carga solo.',
  "We can't see your Flare movements right now":
    'Ahora mismo no podemos ver tus movimientos de Flare',
  'This is not an empty history: the Flare indexer is not answering, so we have nothing to show yet. Try refreshing in a few minutes.':
    'Esto no es un historial vacío: el indexador de Flare no contesta, así que todavía no tenemos nada que enseñarte. Prueba a actualizar en unos minutos.',
  'No on-chain events found for this wallet on Flare Mainnet. Try refreshing from Flarescan.':
    'No se encontraron eventos on-chain para esta wallet en Flare Mainnet. Prueba a actualizar desde Flarescan.',
  'Connect a wallet to see activity.': 'Conecta una wallet para ver la actividad.',
  on: 'en',
  block: 'bloque',
  view: 'ver',

  // ── Swap ──
  'Astryum earns an integrator fee (0.25% by default) on swaps via the 1inch API. This fee is disclosed in every quote and embedded in the transaction calldata by 1inch — Astryum never handles your tokens. The fee goes directly to the Astryum fee wallet.':
    'Astryum cobra una comisión de integrador (0,25% por defecto) en los swaps a través de la API de 1inch. Esta comisión se muestra en cada cotización y va embebida en el calldata de la transacción por 1inch — Astryum nunca maneja tus tokens. La comisión va directamente a la wallet de comisiones de Astryum.',
  'From token (address)': 'Token de origen (dirección)',
  'To token (address)': 'Token de destino (dirección)',
  'Amount (in token units)': 'Cantidad (en unidades del token)',
  'Slippage (basis points)': 'Slippage (puntos básicos)',
  'Pick token': 'Elige token',
  'Getting quote…': 'Obteniendo cotización…',
  'Get quote': 'Obtener cotización',
  'Preparing…': 'Preparando…',
  'Prepare transaction': 'Preparar transacción',
  Back: 'Atrás',
  'You send': 'Tú envías',
  'You receive': 'Tú recibes',
  'Min received': 'Mínimo recibido',
  'Est. gas': 'Gas est.',
  'Price impact': 'Impacto en precio',
  'Astryum platform fee': 'Comisión de plataforma de Astryum',
  'WalletIntent ready': 'WalletIntent listo',
  'Intent ID': 'ID del intent',
  Expires: 'Caduca',
  'Astryum signed?': '¿Astryum firmó?',
  'No — you sign': 'No — firmas tú',
  'Astryum custody?': '¿Astryum custodia?',
  'No custody': 'Sin custodia',
  'Transaction calldata': 'Calldata de la transacción',
  'To execute, import this calldata into your wallet (MetaMask → send transaction with this data) and confirm. Astryum does not send this transaction — you do.':
    'Para ejecutar, importa este calldata en tu wallet (MetaMask → enviar transacción con estos datos) y confirma. Astryum no envía esta transacción — la envías tú.',
  'New swap': 'Nuevo swap',

  // ── Watchlist ──
  'Add wallet': 'Añadir wallet',
  'Add wallet to watchlist': 'Añadir wallet al seguimiento',
  '0x… wallet address': '0x… dirección de wallet',
  'Label (optional)': 'Etiqueta (opcional)',
  'Adding…': 'Añadiendo…',
  Add: 'Añadir',
  'Loading watchlist…': 'Cargando seguimiento…',
  'wallet monitored': 'wallet monitoreada',
  'wallets monitored': 'wallets monitoreadas',
  active: 'activa',
  inactive: 'inactiva',
  'Last synced': 'Última sincronización',
  'Never synced': 'Nunca sincronizada',
  Synced: 'Sincronizada',
  interactions: 'interacciones',
  Sync: 'Sincronizar',
  'Syncing…': 'Sincronizando…',
  'Add your Flare wallet address to start monitoring positions and interactions.':
    'Añade la dirección de tu wallet de Flare para empezar a monitorizar posiciones e interacciones.',

  // ── Goals ──
  'Goal is achievable': 'Objetivo alcanzable',
  'Gap to close': 'Falta para llegar',
  risk: 'riesgo',
  low: 'bajo',
  medium: 'medio',
  high: 'alto',
  closed: 'cerrado',
  'Target / month': 'Objetivo / mes',
  'Realistic / month': 'Realista / mes',
  'Required APY': 'APY requerido',
  'Best available APY': 'Mejor APY disponible',
  Fee: 'Comisión',
  Hide: 'Ocultar',
  Show: 'Ver',
  View: 'Ver',
  'AI explanation': 'explicación de IA',
  month: 'mes',
  proposals: 'propuestas',
  'No proposals yet. Active managers will be notified.':
    'Aún no hay propuestas. Se notificará a los gestores activos.',
  'Describe what you want to achieve in plain language. Astryum will check if it’s achievable with your current capital and notify matching managers.':
    'Describe lo que quieres conseguir en lenguaje natural. Astryum comprobará si es alcanzable con tu capital actual y notificará a los gestores que encajen.',
  'e.g. “I want to earn 1,000 USD per month with low risk over the next year”':
    'p. ej. «Quiero ganar 1.000 USD al mes con bajo riesgo durante el próximo año»',
  'Checking feasibility…': 'Comprobando viabilidad…',
  'Failed to create goal. Please try again.':
    'No se pudo crear el objetivo. Inténtalo de nuevo.',
  'Publishing goal…': 'Publicando objetivo…',
  'Publish Goal': 'Publicar objetivo',
  'Active Goals': 'Objetivos activos',
  'No active goals. Describe your first goal above.':
    'Sin objetivos activos. Describe tu primer objetivo arriba.',
  'Closed Goals': 'Objetivos cerrados',

  // ── Capital Map ──
  Interactions: 'Interacciones',
  'Est. total value': 'Valor total est.',
  'Confidence risk score:': 'Puntuación de riesgo de confianza:',
  '/100 — higher = less confident data': '/100 — más alto = datos menos fiables',
  'By Chain': 'Por cadena',
  'By Type': 'Por tipo',
  'Add wallets and sync to see chain breakdown.':
    'Añade wallets y sincroniza para ver el desglose por cadena.',
  'Sync your wallets to see asset breakdown.':
    'Sincroniza tus wallets para ver el desglose por activo.',
  'Sync your wallets to see protocol breakdown.':
    'Sincroniza tus wallets para ver el desglose por protocolo.',
  'Sync your wallets to see position type breakdown.':
    'Sincroniza tus wallets para ver el desglose por tipo de posición.',
  'Top Positions': 'Posiciones principales',
  'Add wallets to your watchlist and press the sync button (↓) to discover DeFi positions.':
    'Añade wallets a tu seguimiento y pulsa el botón de sincronización (↓) para descubrir posiciones DeFi.',
  'Loading capital map…': 'Cargando mapa de capital…',
  'Could not load the capital map right now.': 'No se pudo cargar el mapa de capital ahora mismo.',
  position: 'posición',
  wallet: 'wallet',
  wallets: 'wallets',
  via: 'vía',
  'no providers': 'sin proveedores',
  'found.': 'encontradas.',
  '(Set ZERION_API_KEY to enable Zerion sync.)':
    '(Configura ZERION_API_KEY para habilitar la sincronización con Zerion.)',
  verified: 'verificado',
  probable: 'probable',
  detected: 'detectado',
  Free: 'Libre',
  Supplied: 'Aportado',
  Borrowed: 'Prestado',
  Staked: 'En staking',
  Farming: 'Farming',
  Other: 'Otro',

  // ── Tax ──
  'All types': 'Todos los tipos',
  Buy: 'Compra',
  Sell: 'Venta',
  Receive: 'Recibir',
  Stake: 'Stake',
  Unstake: 'Unstake',
  Reward: 'Recompensa',
  'Raw transaction data for your accountant. Astryum does not calculate taxes, does not provide tax advice, and is not responsible for the accuracy of fiat value estimates. Consult a qualified tax professional.':
    'Datos de transacciones en bruto para tu asesor. Astryum no calcula impuestos, no ofrece asesoramiento fiscal y no se responsabiliza de la exactitud de las estimaciones de valor en fíat. Consulta a un profesional fiscal cualificado.',
  'Apply filters': 'Aplicar filtros',
  'Export:': 'Exportar:',
  event: 'evento',
  events: 'eventos',
  total: 'en total',
  'Loading tax events…': 'Cargando eventos fiscales…',
  Type: 'Tipo',
  'Asset In': 'Activo entrada',
  'Amount In': 'Cantidad entrada',
  'Asset Out': 'Activo salida',
  'Amount Out': 'Cantidad salida',
  'Fiat Est.': 'Est. fíat',
  Source: 'Fuente',
  Verified: 'Verificado',
  yes: 'sí',
  no: 'no',
  Showing: 'Mostrando',
  of: 'de',
  'events. Use export to get the full dataset.':
    'eventos. Usa la exportación para obtener el conjunto completo.',

  // ── Points ──
  rewards: 'recompensas',
  'Convert power': 'Convertir poder',
  'Available power:': 'Poder disponible:',
  'Credits unlock perks across the platform.': 'Los créditos desbloquean ventajas en toda la plataforma.',
  'Conversion failed': 'La conversión falló',
  'Converting…': 'Convirtiendo…',
  Burn: 'Quemar',
  power: 'poder',
  'Power to burn': 'Poder a quemar',
  '1 power → 1 credit (rate may change)': '1 poder → 1 crédito (la tasa puede cambiar)',
  'Max level reached': 'Nivel máximo alcanzado',
  'Total Points': 'Puntos totales',
  Power: 'Poder',
  Credits: 'Créditos',
  'Next level': 'Siguiente nivel',
  'Onboarding bonus available': 'Bonus de bienvenida disponible',
  'Claim 100 points to kick off your activity ledger.':
    'Reclama 100 puntos para arrancar tu historial de actividad.',
  'Claiming…': 'Reclamando…',
  'Claim +100': 'Reclamar +100',
  Badges: 'Insignias',
  earned: 'conseguida',
  locked: 'bloqueada',
  'Recent activity': 'Actividad reciente',
  entries: 'entradas',
  Event: 'Evento',
  When: 'Cuándo',
  'Connect a wallet and start interacting to earn points.':
    'Conecta una wallet y empieza a interactuar para ganar puntos.',

  // ── Rules ──
  rules: 'reglas',
  'Creating…': 'Creando…',
  'Sample rule': 'Regla de ejemplo',
  '+ New rule': '+ Nueva regla',
  'trigger:': 'disparador:',
  cooldown: 'enfriamiento',
  max: 'máx',
  Triggered: 'Disparada',
  'Last:': 'Última:',
  never: 'nunca',
  Disable: 'Desactivar',
  Enable: 'Activar',
  Delete: 'Eliminar',
  'Name and wallet required': 'Nombre y wallet requeridos',
  'Could not create rule': 'No se pudo crear la regla',
  'Create rule': 'Crear regla',
  'Rule name': 'Nombre de la regla',
  'e.g. Repay safety — HF below 1.5': 'p. ej. Seguridad de repago — HF por debajo de 1.5',
  Trigger: 'Disparador',
  Action: 'Acción',
  'Cooldown (minutes)': 'Enfriamiento (minutos)',
  'Min time between firings': 'Tiempo mín. entre disparos',
  'Max value per action (USD)': 'Valor máx. por acción (USD)',
  'Hard cap per prepared intent': 'Límite estricto por intent preparado',
  'Health Factor below': 'Health Factor por debajo de',
  'Health Factor above': 'Health Factor por encima de',
  'LTV above (%)': 'LTV por encima de (%)',
  'LP out of range': 'LP fuera de rango',
  'Price drop ≥ (%)': 'Caída de precio ≥ (%)',
  'Rewards reach (USD)': 'Recompensas alcanzan (USD)',
  'HF threshold': 'Umbral HF',
  'LTV %': 'LTV %',
  'Drop %': 'Caída %',
  'Min USD': 'USD mín',
  'Repay debt': 'Pagar deuda',
  'Add collateral': 'Añadir colateral',
  'Harvest rewards': 'Cosechar recompensas',
  'Exit LP': 'Salir del LP',

  // ── Trigger Rules ──
  'Price below': 'Precio por debajo de',
  'Price above': 'Precio por encima de',
  'Balance below': 'Saldo por debajo de',
  'Position value below': 'Valor de posición por debajo de',
  'DeFi position detected': 'Posición DeFi detectada',
  'asset, threshold (USD)': 'activo, umbral (USD)',
  'address, asset, threshold (native units)': 'dirección, activo, umbral (unidades nativas)',
  'positionId, threshold (USD)': 'positionId, umbral (USD)',
  'protocol, contractType': 'protocolo, contractType',
  'Name required': 'Nombre requerido',
  'New rule': 'Nueva regla',
  'Create trigger rule': 'Crear regla de disparo',
  'Name *': 'Nombre *',
  'e.g. FLR price alert': 'p. ej. alerta de precio de FLR',
  'Condition type': 'Tipo de condición',
  'Params:': 'Parámetros:',
  'Condition parameters': 'Parámetros de la condición',
  Description: 'Descripción',
  'Optional description': 'Descripción opcional',
  'Notification template (optional)': 'Plantilla de notificación (opcional)',
  'e.g. FLR dropped below {{threshold}} — review your positions':
    'p. ej. FLR cayó por debajo de {{threshold}} — revisa tus posiciones',
  'Loading trigger rules…': 'Cargando reglas de disparo…',
  Cooldown: 'Enfriamiento',
  Fired: 'Disparada',
  'Disable rule': 'Desactivar regla',
  'Enable rule': 'Activar regla',
  'Delete rule': 'Eliminar regla',

  // ── Intents ──
  Transaction: 'Transacción',
  intents: 'intents',
  Refresh: 'Actualizar',
  ID: 'ID',
  'Review & sign': 'Revisar y firmar',
  Pending: 'Pendientes',
  'Missing wallet or txData': 'Falta wallet o txData',
  failed: 'fallida',
  'Signing failed': 'La firma falló',
  'Review & sign intent': 'Revisar y firmar intent',
  expires: 'caduca',
  Close: 'Cerrar',
  Retry: 'Reintentar',
  'Sign with wallet': 'Firmar con wallet',
  Explanation: 'Explicación',
  'Gas est.': 'Gas est.',
  'Net USD': 'USD neto',
  'Risk Δ': 'Riesgo Δ',
  'Health Factor impact': 'Impacto en el Health Factor',
  'Simulation is stale — re-simulate before signing.':
    'La simulación está obsoleta — vuelve a simular antes de firmar.',
  'Awaiting wallet…': 'Esperando wallet…',
  'Broadcasting…': 'Transmitiendo…',
  'Confirming on-chain…': 'Confirmando on-chain…',
  Confirmed: 'Confirmada',

  // ── Mandates ──
  default: 'por defecto',
  custom: 'personalizado',
  Reload: 'Recargar',
  'saving…': 'guardando…',
  Limits: 'Límites',
  'Caps applied per transaction and per period.': 'Topes aplicados por transacción y por periodo.',
  'Max per transaction (USD)': 'Máx. por transacción (USD)',
  'Max per day (USD)': 'Máx. por día (USD)',
  'Max slippage (bps)': 'Slippage máx. (bps)',
  '100 bps = 1%': '100 bps = 1%',
  'Min Health Factor after action': 'Health Factor mín. tras la acción',
  'Require manual approval above (USD)': 'Requerir aprobación manual por encima de (USD)',
  'Above this, the UI shows a confirmation step.': 'Por encima de esto, la UI muestra un paso de confirmación.',
  'Action scope': 'Alcance de acciones',
  'Toggle to forbid an action across all protocols.':
    'Activa para prohibir una acción en todos los protocolos.',
  'Red = forbidden (PolicyGuard blocks). Green = allowed.':
    'Rojo = prohibida (PolicyGuard bloquea). Verde = permitida.',
  'Allowed chains': 'Cadenas permitidas',
  'Only chainIds in this list pass PolicyGuard. Flare = 14.':
    'Solo los chainIds de esta lista pasan el PolicyGuard. Flare = 14.',
  'add chainId (e.g. 14)': 'añadir chainId (p. ej. 14)',
  'Allowed protocols': 'Protocolos permitidos',
  'Protocol ids the mandate accepts. Empty = none allowed.':
    'IDs de protocolo que el mandato acepta. Vacío = ninguno permitido.',
  'add protocol id (e.g. kinetic)': 'añadir id de protocolo (p. ej. kinetic)',
  'Allowed assets': 'Activos permitidos',
  'Token addresses or symbols. Empty = no asset whitelist (all allowed).':
    'Direcciones o símbolos de tokens. Vacío = sin lista blanca de activos (todos permitidos).',
  'add asset (symbol or 0x address)': 'añadir activo (símbolo o dirección 0x)',
  'Read-only': 'Solo lectura',
  'Mandate id': 'ID del mandato',
  Schema: 'Esquema',
  'Created at': 'Creado el',
  'Expires at': 'Caduca el',
  'empty — nothing allowed': 'vacío — nada permitido',
  remove: 'eliminar',
  suggest: 'sugerencias',
  supply: 'aportar',
  withdraw: 'retirar',
  borrow: 'pedir prestado',
  repay: 'pagar',
  addCollateral: 'añadir colateral',
  addLiquidity: 'añadir liquidez',
  exitLP: 'salir del LP',
  harvest: 'cosechar',
  stake: 'stake',
  unstake: 'unstake',
  claimRewards: 'reclamar recompensas',
  wrap: 'envolver',
  unwrap: 'desenvolver',
  delegate: 'delegar',
  undelegate: 'cancelar delegación',
  swap: 'swap',
  crossChainSwap: 'swap entre cadenas',

  // ── Integrations ──
  'Backend control plane returned an empty registry.':
    'El control plane del backend devolvió un registro vacío.',
  healthy: 'sana',
  degraded: 'degradado',
  down: 'caído',
  prio: 'prio',
  probe: 'sondear',
  'probing…': 'sondeando…',
  'Chain RPC': 'RPC de cadena',
  Oracle: 'Oráculo',
  Explorer: 'Explorador',
  FAsset: 'FAsset',
  Wallet: 'Wallet',
  Data: 'Datos',
  Engine: 'Motor',

  // ── Section wrappers (loaders / headers) ──
  Position: 'Posición',
  math: 'cálculos',

  // ── AI Copilot ──
  'Ask, explain,': 'Pregunta, explica,',
  decide: 'decide',
  Clear: 'Limpiar',
  'v1 · deterministic': 'v1 · determinista',
  'Explain my risk': 'Explica mi riesgo',
  'What should I do?': '¿Qué debería hacer?',
  'Ask anything about your portfolio, risk or open intents.':
    'Pregunta lo que quieras sobre tu portfolio, riesgo o intents abiertos.',
  'Thinking…': 'Pensando…',
  'Ask the Copilot…': 'Pregunta al Copilot…',
  Recommendations: 'Recomendaciones',
  score: 'puntuación',
  'Review simulation →': 'Revisar simulación →',
  confidence: 'confianza',

  // ── Strategies ──
  'Create strategy from this position': 'Crear estrategia desde esta posición',
  workspace: 'espacio de trabajo',
  'New flow': 'Nuevo flujo',
  Strategies: 'Estrategias',
  'Total TVL': 'TVL total',
  'Avg risk': 'Riesgo medio',
  'Across all strategies': 'En todas las estrategias',
  Safe: 'Seguro',
  Watch: 'Vigilar',
  High: 'Alto',
  'Your strategies': 'Tus estrategias',
  strategy: 'estrategia',
  strategies: 'estrategias',
  Active: 'Activa',
  Paused: 'Pausada',
  TVL: 'TVL',
  'PnL 24h': 'PnL 24h',
  APR: 'APR',
  flows: 'flujos',
  Open: 'Abrir',
  'MoneyFlow Builder': 'Constructor de MoneyFlow',
  'Visual canvas for composing strategies as DAGs. Each node maps to a TransactionIntent prepared via the V1 Intent Engine — you sign each step, Astryum broadcasts and tracks.':
    'Lienzo visual para componer estrategias como DAGs. Cada nodo se traduce en un TransactionIntent preparado vía el V1 Intent Engine — tú firmas cada paso, Astryum transmite y rastrea.',
  'Open builder': 'Abrir constructor',
  'AI Copilot recommendations': 'Recomendaciones del AI Copilot',
  'Get prepared intents based on your portfolio + risk profile. The copilot operates strictly on engine outputs — no hallucinations, no automatic broadcasts.':
    'Obtén intents preparados según tu portfolio + perfil de riesgo. El copilot opera estrictamente sobre las salidas del motor — sin alucinaciones, sin transmisiones automáticas.',
  'Open copilot': 'Abrir copilot',

  // ── Wallets ──
  'Multi-chain': 'Multichain',
  Primary: 'Principal',
  'Tx enabled': 'Tx habilitadas',
  'Show balance': 'Mostrar saldo',
  'Hide balance': 'Ocultar saldo',
  'Fetching balance…': 'Obteniendo saldo…',
  'Native Balance': 'Saldo nativo',
  'USD Value': 'Valor USD',
  'Balance not loaded': 'Saldo no cargado',
  'Set a chain to load balance': 'Selecciona una cadena para cargar el saldo',
  'Authorized for transactions': 'Autorizada para transacciones',
  'Set primary': 'Marcar como principal',
  Revoke: 'Revocar',
  'Read-only — cannot sign transactions': 'Solo lectura — no puede firmar transacciones',
  'Operated from your XRPL account in Xaman — it has no key of its own':
    'Se opera desde tu cuenta XRPL en Xaman — no tiene clave propia',
  'It executes orders signed in Xaman by the XRPL account that controls it — there is no EVM key to prove.':
    'Ejecuta órdenes firmadas en Xaman por la cuenta XRPL que la controla — no hay clave EVM que demostrar.',
  'Sign an ownership proof to enable transactions':
    'Firma una prueba de propiedad para habilitar transacciones',
  'Connect this wallet in your wallet app first':
    'Conecta esta wallet en tu app de wallet primero',
  'Enable transactions': 'Habilitar transacciones',
  'Invalid EVM address (must start with 0x and be 42 chars)':
    'Dirección EVM inválida (debe empezar por 0x y tener 42 caracteres)',
  'Add Wallet': 'Añadir wallet',
  'Connect a wallet app': 'Conectar una app de wallet',
  'Connecting only reads the address. You can connect several wallets — even more than one from the same app.':
    'Conectar solo lee la dirección. Puedes conectar varias wallets — incluso más de una de la misma app.',
  'or watch an address': 'o vigilar una dirección',
  'EVM Address': 'Dirección EVM',
  'e.g. Cold wallet': 'p. ej. Cold wallet',
  'Add Watch Wallet': 'Añadir wallet vigilada',
  'XRPL (r…) or Flare (0x…) address': 'Dirección XRPL (r…) o Flare (0x…)',
  'Enter a valid XRPL (r…) or Flare (0x…) address':
    'Introduce una dirección XRPL (r…) o Flare (0x…) válida',
  'Watch-only: balances and positions are read — this address can never sign.':
    'Solo observación: se leen balances y posiciones — esta dirección nunca puede firmar.',

  // ── First-wallet guide (exchange-only users) ──
  'I don’t have a wallet yet — show me how': 'Aún no tengo wallet — enséñame cómo',
  'Your first wallet': 'Tu primera wallet',
  'A wallet is your own account on the network — you hold the keys and Astryum never sees them. If your capital lives in an exchange today, four steps bring it under your own control.':
    'Una wallet es tu propia cuenta en la red — las llaves las tienes tú y Astryum nunca las ve. Si hoy tu capital vive en un exchange, cuatro pasos lo ponen bajo tu propio control.',
  'Where is your capital today?': '¿Dónde está tu capital hoy?',
  'XRP on an exchange': 'XRP en un exchange',
  'Create Xaman, the XRPL wallet app, and withdraw to it':
    'Crea Xaman, la app de wallet de XRPL, y retira hacia ella',
  'FLR or tokens on Flare': 'FLR o tokens en Flare',
  'Create MetaMask and receive on the Flare network':
    'Crea MetaMask y recibe por la red Flare',
  'Already have one of these apps? Close this and press Add Wallet — connecting takes one tap.':
    '¿Ya tienes una de estas apps? Cierra esto y pulsa Añadir wallet — conectar es un toque.',
  'Install Xaman': 'Instala Xaman',
  'Xaman is the XRPL wallet app, for iOS and Android. Download it only from the official site — never from a link someone sent you.':
    'Xaman es la app de wallet de XRPL, para iOS y Android. Descárgala solo desde el sitio oficial — nunca desde un enlace que te hayan enviado.',
  'Official site': 'Sitio oficial',
  'I have the app': 'Ya tengo la app',
  'Create your account and guard the secret': 'Crea tu cuenta y guarda el secreto',
  'The app generates your secret numbers — they ARE the wallet. Write them on paper and keep them offline. Astryum will never ask for them; nobody legitimate will.':
    'La app genera tus números secretos — SON la wallet. Escríbelos en papel y guárdalos fuera de internet. Astryum nunca te los pedirá; nadie legítimo lo hará.',
  'The XRP Ledger keeps a small base reserve (about 1 XRP) locked in every active address — a network rule, not a fee.':
    'El XRP Ledger mantiene una pequeña reserva base (en torno a 1 XRP) bloqueada en cada dirección activa — es una regla de la red, no una comisión.',
  'Secret saved': 'Secreto guardado',
  'Withdraw from your exchange': 'Retira desde tu exchange',
  'Copy your address (r…) from Xaman. In your exchange, withdraw XRP over the XRP Ledger network and paste it. Send a small test amount first; the rest once it arrives.':
    'Copia tu dirección (r…) desde Xaman. En tu exchange, retira XRP por la red XRP Ledger y pégala. Envía primero una pequeña cantidad de prueba; el resto cuando llegue.',
  'Destination tag: your Xaman address is only yours, so if the exchange marks the field optional you can leave it empty.':
    'Destination tag: tu dirección de Xaman es solo tuya, así que si el exchange marca el campo como opcional puedes dejarlo vacío.',
  'Done — my XRP is on its way': 'Hecho — mi XRP está en camino',
  'Connect it to Astryum': 'Conéctala con Astryum',
  'Connecting only reads your address — your balance and positions appear on their own. Enabling transactions is a separate, per-wallet signature, always yours.':
    'Conectar solo lee tu dirección — tu balance y posiciones aparecen solos. Habilitar transacciones es una firma aparte, por wallet, siempre tuya.',
  // 'Connect Xaman' ya existe en el bloque de XamanQRModal — misma cara ES.
  'Install MetaMask': 'Instala MetaMask',
  'MetaMask is the most used EVM wallet — a browser extension and a mobile app. Download it only from the official site — never from a link someone sent you.':
    'MetaMask es la wallet EVM más usada — extensión de navegador y app móvil. Descárgala solo desde el sitio oficial — nunca desde un enlace que te hayan enviado.',
  'Create your wallet and guard the phrase': 'Crea tu wallet y guarda la frase',
  'The app gives you a 12-word recovery phrase — it IS the wallet. Paper, offline, never typed into any website. Astryum will never ask for it; nobody legitimate will.':
    'La app te da una frase de recuperación de 12 palabras — ES la wallet. En papel, fuera de internet, jamás escrita en una web. Astryum nunca te la pedirá; nadie legítimo lo hará.',
  'Phrase saved': 'Frase guardada',
  'Withdraw from your exchange on the Flare network': 'Retira desde tu exchange por la red Flare',
  'Copy your address (0x…) from MetaMask. In your exchange, withdraw FLR choosing the Flare network. Send a small test amount first; the rest once it arrives.':
    'Copia tu dirección (0x…) desde MetaMask. En tu exchange, retira FLR eligiendo la red Flare. Envía primero una pequeña cantidad de prueba; el resto cuando llegue.',
  'If your exchange does not offer the Flare network for that token, do not send — funds sent over a different network do not arrive on Flare.':
    'Si tu exchange no ofrece la red Flare para ese token, no envíes — los fondos enviados por otra red no llegan a Flare.',
  'Done — my funds are on their way': 'Hecho — mis fondos están en camino',
  'Connecting only reads your address — your balance and positions appear on their own. Astryum switches MetaMask to Flare Mainnet (chain 14) when you connect. Enabling transactions is a separate, per-wallet signature, always yours.':
    'Conectar solo lee tu dirección — tu balance y posiciones aparecen solos. Astryum cambia MetaMask a Flare Mainnet (chain 14) al conectar. Habilitar transacciones es una firma aparte, por wallet, siempre tuya.',
  'Connect MetaMask': 'Conectar MetaMask',
  'Supported Wallets': 'Wallets compatibles',
  Ready: 'Lista',
  Install: 'Instalar',
  Get: 'Obtener',
  'All linked wallets': 'Todas las wallets vinculadas',
  'Total Wallets': 'Total de wallets',
  Chains: 'Cadenas',
  'Tx Enabled': 'Tx habilitadas',
  'Unique chains': 'Cadenas únicas',
  'Can sign transactions': 'Pueden firmar transacciones',
  'View / watch only': 'Solo ver / vigilar',
  'Can sign': 'Pueden firmar',
  'Watch only': 'Solo observación',
  'All linked': 'Todas vinculadas',
  connected: 'conectada',
  'Add this wallet': 'Añadir esta wallet',
  'Connect another': 'Conectar otra',
  Disconnect: 'Desconectar',
  'Sign in with your wallet': 'Inicia sesión con tu wallet',
  'Signing in only reads your address — it does not move funds and costs no gas. Every wallet you connect starts as read-only. To prepare on-chain transactions you enable each wallet separately with a one-time ownership signature.':
    'Iniciar sesión solo lee tu dirección — no mueve fondos y no cuesta gas. Cada wallet que conectas empieza como solo lectura. Para preparar transacciones on-chain habilitas cada wallet por separado con una firma de propiedad única.',
  'Awaiting signature…': 'Esperando firma…',
  'Sign in (read-only)': 'Iniciar sesión (solo lectura)',
  'Your Wallets': 'Tus wallets',
  'No wallets yet': 'Aún no hay wallets',

  // ── Wallets — organizer v2: origin shelves + list default (2026-08-03) ──
  'Connected wallets': 'Wallets conectadas',
  'Watch-only': 'Solo observación',
  'Login wallet': 'Wallet de acceso',
  'Embedded wallet': 'Wallet embedded',
  'No wallets added by hand yet — Add wallet connects or watches one.':
    'Aún no has añadido wallets a mano — con «Añadir wallet» conectas o vigilas una.',
  'No platform-created accounts yet — they appear when you log in with a wallet or open a Smart Account.':
    'Aún no hay cuentas creadas por la plataforma — aparecen al entrar con una wallet o al abrir una Smart Account.',
  'Your control plane': 'Tu plano de control',
  'Remove wallet': 'Eliminar wallet',
  'Read-only by default': 'Solo lectura por defecto',
  '1 wallet belongs to a Legacy (its council or Smart Account) — see it in Astryum Legacy › Governance › Wallets.':
    '1 wallet pertenece a un Legacy (su consejo o su Smart Account) — está en Astryum Legacy › Gobernanza › Wallets.',
  'wallets belong to your Legacies (council or Smart Account) — see them in Astryum Legacy › Governance › Wallets.':
    'wallets pertenecen a tus Legacies (consejo o Smart Account) — están en Astryum Legacy › Gobernanza › Wallets.',
  'Send, receive, set aside and trade — you sign in your own wallet':
    'Enviar, recibir, apartar y operar — firmas en tu propia wallet',
  'Connect a wallet app or watch any XRPL or Flare address. You can add as many as you like.':
    'Conecta una app de wallet o vigila cualquier dirección XRPL o Flare. Puedes añadir tantas como quieras.',
  'Transactions enabled for': 'Transacciones habilitadas para',
  'Wallet added. Connect another to add more — pick any wallet app.':
    'Wallet añadida. Conecta otra para añadir más — elige cualquier app de wallet.',

  // ── Agent ──
  Copilot: 'Copiloto',
  'v1.1 · experimental': 'v1.1 · experimental',
  Chat: 'Chat',
  Documents: 'Documentos',
  'No conversations yet': 'Aún no hay conversaciones',
  New: 'Nueva',
  'Ask anything about your portfolio, risk, or DeFi positions.':
    'Pregunta lo que quieras sobre tu portfolio, riesgo o posiciones DeFi.',
  'Explain my current risk': 'Explica mi riesgo actual',
  'What should I do now?': '¿Qué debería hacer ahora?',
  'Show my active positions': 'Muestra mis posiciones activas',
  'Ask the Agent… (Enter to send, Shift+Enter for newline)':
    'Pregunta al Agente… (Enter para enviar, Shift+Enter para nueva línea)',
  'File too large (max': 'Archivo demasiado grande (máx',
  'Upload failed': 'La subida falló',
  'Portfolio audits and risk analyses will appear here after the Agent runs.':
    'Las auditorías de portfolio y los análisis de riesgo aparecerán aquí tras ejecutar el Agente.',
  'Uploading…': 'Subiendo…',
  Upload: 'Subir',
  'My documents': 'Mis documentos',
  'Drop a file or click Upload': 'Suelta un archivo o pulsa Subir',
  'PDF, TXT, MD, CSV, JSON — max 10 MB': 'PDF, TXT, MD, CSV, JSON — máx 10 MB',
  auto: 'auto',
  'New rule (NLP)': 'Nueva regla (NLP)',
  'Describe a rule in natural language and the agent will build the configuration.':
    'Describe una regla en lenguaje natural y el agente construirá la configuración.',
  'AI could not build a valid rule configuration':
    'La IA no pudo construir una configuración de regla válida',
  'Parsing failed': 'El análisis falló',
  'Building…': 'Construyendo…',
  'Build config': 'Construir configuración',
  'Confirm & create': 'Confirmar y crear',
  'Describe the rule in plain language': 'Describe la regla en lenguaje natural',
  '"Alert me when my health factor drops below 1.4 and prepare a repay"':
    '«Avísame cuando mi health factor caiga por debajo de 1.4 y prepara un repago»',
  'Agent built this configuration': 'El Agente construyó esta configuración',
  'Name:': 'Nombre:',
  'Action:': 'Acción:',
  'Cooldown:': 'Enfriamiento:',
  'Max value:': 'Valor máx:',
  'Settings saved': 'Ajustes guardados',
  'Anthropic API key': 'Clave API de Anthropic',
  'Stored locally in your browser. Never sent to our servers.':
    'Almacenada localmente en tu navegador. Nunca se envía a nuestros servidores.',
  Model: 'Modelo',
  Fast: 'Rápido',
  Recommended: 'Recomendado',
  Powerful: 'Potente',
  'Fast & economical — routine queries': 'Rápido y económico — consultas rutinarias',
  'Balanced — recommended for most tasks': 'Equilibrado — recomendado para la mayoría de tareas',
  'Most capable — complex analysis & strategy': 'El más capaz — análisis y estrategia complejos',
  'Data access': 'Acceso a datos',
  'Portfolio & Capital Map': 'Portfolio y Capital Map',
  'Balances, positions, history': 'Saldos, posiciones, historial',
  'Risk Engine': 'Risk Engine',
  'HF, LTV, liquidation metrics': 'HF, LTV, métricas de liquidación',
  'Automation Rules': 'Reglas de automatización',
  'Active rules & trigger history': 'Reglas activas e historial de disparos',
  'Connected protocols & registry': 'Protocolos conectados y registro',
  'Token usage this month': 'Uso de tokens este mes',
  'Tokens consumed by the Agent in the current calendar month. Available once backend is deployed.':
    'Tokens consumidos por el Agente en el mes natural actual. Disponible cuando se despliegue el backend.',
  'External MCPs': 'MCPs externos',
  Connect: 'Conectar',
  'API key…': 'Clave API…',
  'Prices, market cap, rankings': 'Precios, capitalización, rankings',
  'Free · 10k credits/mo': 'Gratis · 10k créditos/mes',
  'Funding rates, liquidations, open interest': 'Tasas de financiación, liquidaciones, interés abierto',
  '$35/month': '$35/mes',
  'Social sentiment, on-chain metrics': 'Sentimiento social, métricas on-chain',
  'Free delayed tier': 'Nivel gratuito con retardo',
  'Exchange flows, miner activity': 'Flujos de exchange, actividad de mineros',
  'Free limited': 'Gratuito limitado',
  'XRP chain data, whales, rich list': 'Datos de la cadena XRP, ballenas, rich list',
  'Always free': 'Siempre gratis',
  'Charts & technical indicators': 'Gráficos e indicadores técnicos',
  'Requires Desktop + CDP': 'Requiere Desktop + CDP',

  // ── Portfolio ──
  'Connect your Flare wallet to load real on-chain positions.':
    'Conecta tu wallet de Flare para cargar posiciones reales on-chain.',
  Tokens: 'Tokens',
  'DeFi Positions': 'Posiciones DeFi',
  'Spending Caps': 'Límites de gasto',
  more: 'más',
  'Refreshing…': 'Actualizando…',
  'Health Factor': 'Health Factor',
  SAFE: 'SEGURO',
  WATCH: 'VIGILAR',
  WARNING: 'AVISO',
  DANGER: 'PELIGRO',
  CRITICAL: 'CRÍTICO',
  'All wallets': 'Todas las wallets',
  'No assets': 'Sin activos',
  'Total balance': 'Balance total',
  today: 'hoy',
  'History accumulates as snapshots run': 'El historial se acumula a medida que se ejecutan los snapshots',
  'Net Worth': 'Patrimonio neto',
  Collateral: 'Colateral',
  Debt: 'Deuda',
  Total: 'Total',
  'Total minus debt': 'Total menos deuda',
  'Backing your loans': 'Respaldo de tus préstamos',
  'Outstanding borrows': 'Préstamos pendientes',
  'No active debt': 'Sin deuda activa',
  'from liquidation': 'de la liquidación',
  'No lending positions': 'Sin posiciones de préstamo',
  'Range:': 'Rango:',
  'Flare · ETH · Base · Polygon + more': 'Flare · ETH · Base · Polygon + más',
  'Value (USD)': 'Valor (USD)',
  'Health factor': 'Factor de salud',
  'Price (USD)': 'Precio (USD)',
  // ── xrplTxTypeLabel (Fase 1, 2026-07-30): tipos XRPL en palabras ──
  'Payment — sends XRP': 'Pago — envía XRP',
  'Set XRP aside until a date': 'Apartar XRP hasta una fecha',
  'Release money that was set aside': 'Liberar dinero apartado',
  'Recover money that was set aside': 'Recuperar dinero apartado',
  'Account settings — moves no funds': 'Ajustes de la cuenta — no mueve fondos',
  'Change who signs for this account': 'Cambiar quién firma por esta cuenta',
  'Allow the account to hold a token': 'Permitir que la cuenta tenga un token',
  'Anchor a document to the account': 'Anclar un documento a la cuenta',
  'Several operations in one signature': 'Varias operaciones en una firma',
  'Exchange order on the ledger': 'Orden de intercambio en el ledger',
  'Cancel an exchange order': 'Cancelar una orden de intercambio',
  'Write a cheque another account can cash': 'Emitir un cheque que otra cuenta puede cobrar',
  'Cash a cheque': 'Cobrar un cheque',
  'Cancel a cheque': 'Cancelar un cheque',
  '% Portfolio': '% Portfolio',
  'FTSO prices · cached 30s': 'Precios FTSO · caché 30s',
  'No positions detected — connect a wallet and wait for the engine to scan':
    'No se detectaron posiciones — conecta una wallet y espera a que el motor escanee',
  collateral: 'colateral',
  debt: 'deuda',
  lp: 'LP',
  staking: 'staking',
  free: 'libre',
  reward: 'recompensa',
  'Token Inventory': 'Inventario de tokens',
  'Token / Address': 'Token / Dirección',
  'No free / supply / rewards tokens': 'Sin tokens libres / aportados / de recompensa',
  'Registered Wallets': 'Wallets registradas',
  Manage: 'Gestionar',
  'Loading wallets…': 'Cargando wallets…',
  'No wallets registered': 'No hay wallets registradas',
  'Add a wallet': 'Añadir una wallet',
  'Connected wallet': 'Wallet conectada',
  'Select this wallet to load its portfolio': 'Selecciona esta wallet para cargar su portfolio',
  'Flare Mainnet': 'Flare Mainnet',
  'chainId unknown': 'chainId desconocido',
  'All positions': 'Todas las posiciones',
  'No DeFi positions detected': 'No se detectaron posiciones DeFi',
  'Positions appear once Kinetic, SparkDEX or Firelight adapters are active':
    'Las posiciones aparecen cuando los adapters de Kinetic, SparkDEX o Firelight están activos',
  'Networks · XRPL + FLARE': 'Networks · XRPL + FLARE',
  'Hide balances': 'Ocultar saldos',
  'Show balances': 'Mostrar saldos',
  'No portfolio snapshot yet': 'Aún no hay snapshot del portfolio',
  "The portfolio engine hasn't produced a snapshot":
    'El motor de portfolio aún no ha producido un snapshot',
  'Full on-chain transaction history and activity feed are in the dedicated pages.':
    'El historial completo de transacciones on-chain y el feed de actividad están en sus páginas dedicadas.',
  'Activity Feed': 'Feed de actividad',
  'Manage token allowances and spending caps from the Rules page.':
    'Gestiona los allowances de tokens y los límites de gasto desde la página de Reglas.',
  'Rules & Caps': 'Reglas y límites',
  'Configure risk alerts, price triggers and automation rules.':
    'Configura alertas de riesgo, disparadores de precio y reglas de automatización.',
  'Configure display preferences, refresh intervals and privacy settings.':
    'Configura preferencias de visualización, intervalos de actualización y ajustes de privacidad.',

  // ── Safe Markets ──
  'Failed to load pools:': 'No se pudieron cargar los pools:',
  'Mandate-compliant': 'Conforme al mandato',
  yield: 'rendimiento',
  'live · defillama': 'en vivo · defillama',
  'synced · defillama': 'sincronizado · defillama',
  'Reload from DB': 'Recargar desde la BD',
  'Risk Alert:': 'Alerta de riesgo:',
  'pool(s) blocked due to anomaly detection.': 'pool(s) bloqueados por detección de anomalías.',
  'pool(s) flagged for critical anomaly.': 'pool(s) marcados por anomalía crítica.',
  'Blocked pools cannot be used for execution.': 'Los pools bloqueados no pueden usarse para ejecutar.',
  chains: 'cadenas',
  'Not connected': 'No conectada',
  'Connected': 'Conectada',
  'Connect to act': 'Conecta para actuar',
  'Yield weighted': 'Ponderado por rendimiento',
  'Across all pools': 'En todos los pools',
  'Safety ≥ 80': 'Seguridad ≥ 80',
  Protocols: 'Protocolos',
  'Low Risk': 'Riesgo bajo',
  'Total Pools': 'Total de pools',
  'Avg APY': 'APY medio',
  'Loading pools…': 'Cargando pools…',
  'Search protocol, token…': 'Buscar protocolo, token…',
  'Sort: APY': 'Orden: APY',
  'Sort: TVL': 'Orden: TVL',
  'Sort: Safety': 'Orden: Seguridad',
  min: 'mín',
  'TVL ≥': 'TVL ≥',
  'Allowlisted only': 'Solo en allowlist',
  'No pools match the current filter': 'Ningún pool coincide con el filtro actual',
  'Show all': 'Mostrar todos',
  'live from DefiLlama': 'en vivo desde DefiLlama',
  'source: defillama': 'fuente: defillama',
  'Live data · not persisted': 'Datos en vivo · no persistidos',
  'Checking your assets…': 'Comprobando tus activos…',
  'Prepare-only · No broadcast without simulate + sign · Astryum V2':
    'Solo preparación · Sin broadcast sin simular + firmar · Astryum V2',
  // ActionModal
  'Session expired. Please prepare a new intent.': 'La sesión caducó. Prepara un nuevo intent.',
  'Connect a wallet partner to continue': 'Conecta un wallet partner para continuar',
  'Invalid amount for': 'Cantidad inválida para',
  'Amount must be greater than 0': 'La cantidad debe ser mayor que 0',
  Audited: 'Auditado',
  Allowlisted: 'En allowlist',
  Safety: 'Seguridad',
  'Max LTV:': 'LTV máx:',
  'Estimated Impact': 'Impacto estimado',
  'Annual Yield': 'Rendimiento anual',
  Monthly: 'Mensual',
  'Est. Gas': 'Gas est.',
  Simulate: 'Simular',
  'Prepare Intent': 'Preparar intent',
  'Run simulation first to unlock intent preparation':
    'Ejecuta primero la simulación para desbloquear la preparación del intent',
  'Preparing intent payload…': 'Preparando el payload del intent…',
  'Policy Guard evaluating…': 'PolicyGuard evaluando…',
  'Review Transaction': 'Revisar transacción',
  'Preview Mode': 'Modo vista previa',
  Protocol: 'Protocolo',
  Contract: 'Contrato',
  'Astryum Fee': 'Comisión Astryum',
  'Session expires': 'La sesión caduca',
  'Unstake cooldown': 'Enfriamiento de unstake',
  'After signing, expect ~': 'Tras firmar, espera ~',
  day: 'día',
  days: 'días',
  'before funds are available. This is a protocol constraint, not a Astryum restriction.':
    'antes de que los fondos estén disponibles. Es una restricción del protocolo, no de Astryum.',
  'Review & Sign': 'Revisar y firmar',
  'Waiting for wallet signature…': 'Esperando la firma de la wallet…',
  'Check your wallet extension / app': 'Revisa tu extensión / app de wallet',
  'Transaction sent': 'Transacción enviada',
  'Preview authorized': 'Vista previa autorizada',
  'Your wallet broadcast the transaction.': 'Tu wallet transmitió la transacción.',
  'Preview auth complete. No on-chain tx was sent.':
    'Autorización de vista previa completa. No se envió ninguna tx on-chain.',
  Error: 'Error',
  'Try Again': 'Inténtalo de nuevo',
  // EmptyStateBanner
  'No pools synced yet': 'Aún no hay pools sincronizados',
  'The database has not been populated. You can load live data directly from DefiLlama to browse opportunities now.':
    'La base de datos no se ha poblado. Puedes cargar datos en vivo directamente desde DefiLlama para ver oportunidades ahora.',
  'Load Live from DefiLlama': 'Cargar en vivo desde DefiLlama',
  // DetailPanel
  'Select a pool to review': 'Selecciona un pool para revisarlo',
  'Selected Pool': 'Pool seleccionado',
  'APY (Net)': 'APY (neto)',
  Base: 'Base',
  Rewards: 'Recompensas',
  'Connect a wallet to prepare an intent': 'Conecta una wallet para preparar un intent',
  'View on': 'Ver en',
  'Safety Overview': 'Resumen de seguridad',
  'Protocol audited': 'Protocolo auditado',
  'Allowlisted provider': 'Proveedor en allowlist',
  'No impermanent loss': 'Sin pérdida impermanente',
  'Risk: Low': 'Riesgo: bajo',
  'Policy Guard': 'PolicyGuard',
  '4 checks passed': '4 comprobaciones superadas',
  '3 checks passed': '3 comprobaciones superadas',
  'Mandate Rules': 'Reglas del mandato',
  'Risk Limits': 'Límites de riesgo',
  'Exposure Limits': 'Límites de exposición',
  'Protocol Allowlist': 'Allowlist de protocolos',
  Beta: 'Beta',
  'Ask AI Copilot': 'Preguntar al AI Copilot',
  // BorrowHFPreview
  'Reading your on-chain position…': 'Leyendo tu posición on-chain…',
  'No collateral detected on': 'No se detectó colateral en',
  'You need to supply collateral first before you can borrow. Switch to the Lending tab and supply an asset, then return here.':
    'Necesitas aportar colateral antes de poder pedir prestado. Cambia a la pestaña de Lending y aporta un activo, luego vuelve aquí.',
  'Projected Health Factor': 'Health Factor proyectado',
  'Debt after': 'Deuda después',
  'Free borrow': 'Préstamo libre',
  '⚠ Above the on-chain available borrow': '⚠ Por encima del préstamo disponible on-chain',
  'The wallet partner will likely reject the tx.': 'El wallet partner probablemente rechazará la tx.',
  '❌ HF would drop below 1 — your position would be immediately liquidatable. Reduce the amount.':
    '❌ El HF caería por debajo de 1 — tu posición sería liquidable de inmediato. Reduce la cantidad.',
  '⚠ Tight HF buffer. A small adverse price move could trigger liquidation.':
    '⚠ Margen de HF ajustado. Un pequeño movimiento adverso de precio podría provocar liquidación.',
  // Pool table
  Pool: 'Pool',
  Provider: 'Proveedor',
  'Borrow APY': 'APY de préstamo',
  Available: 'Disponible',
  'Max LTV': 'LTV máx',
  'Supply APY': 'APY de aporte',
  Utilization: 'Utilización',
  'Net APY': 'APY neto',
  'IL Risk': 'Riesgo IL',
  offset: 'descuento',
  Lend: 'Prestar',
  Borrow: 'Pedir prestado',
  'LP Pools': 'Pools LP',
  'Liquid Staking': 'Liquid Staking',
  Yield: 'Rendimiento',
  Protect: 'Proteger',
  Leverage: 'Apalancamiento',
  Supply: 'Aportar',
  Deposit: 'Depositar',
  'Open protocol': 'Abrir protocolo',
  Low: 'Bajo',
  Medium: 'Medio',
  // Existing positions
  'No debt': 'Sin deuda',
  Caution: 'Precaución',
  Danger: 'Peligro',
  Liquidatable: 'Liquidable',
  'Available Borrow': 'Préstamo disponible',
  'Link to Strategy': 'Vincular a estrategia',
  'Money Flow': 'Money Flow',
  'Your positions on-chain': 'Tus posiciones on-chain',

  // ── Calculators ──
  'Health Factor Calculator': 'Calculadora de Health Factor',
  'Hypothetical lending position. Aave-style math (HF = collateral × liqThreshold / debt).':
    'Posición de préstamo hipotética. Cálculo estilo Aave (HF = colateral × umbral de liquidación / deuda).',
  'Collateral USD': 'Colateral USD',
  'Collateral spot price': 'Precio spot del colateral',
  'Liq. threshold': 'Umbral de liquidación',
  'Debt USD': 'Deuda USD',
  'Target HF (for max borrow)': 'HF objetivo (para préstamo máx.)',
  'Liquidation price': 'Precio de liquidación',
  'Max borrow @HF': 'Préstamo máx. @HF',
  'Concentrated LP Range': 'Rango LP concentrado',
  'Plan a Uniswap v3-style range. Higher capital efficiency means more fees but more IL.':
    'Planifica un rango estilo Uniswap v3. Mayor eficiencia de capital significa más comisiones pero más IL.',
  'Current price': 'Precio actual',
  'Position size': 'Tamaño de posición',
  'Min price': 'Precio mín.',
  'Max price': 'Precio máx.',
  'Pool fees 24h': 'Comisiones del pool 24h',
  'Pool TVL': 'TVL del pool',
  'Daily σ': 'σ diaria',
  'Suggest range (±2σ)': 'Sugerir rango (±2σ)',
  'Capital efficiency': 'Eficiencia de capital',
  'Daily fees': 'Comisiones diarias',
  'Projected fee APY': 'APY de comisiones proyectado',
  'Impermanent Loss': 'Pérdida impermanente',
  'Full-range (v2)': 'Rango completo (v2)',
  'Concentrated (v3)': 'Concentrado (v3)',
  'New price (scenario)': 'Precio nuevo (escenario)',
  'Range min': 'Rango mín.',
  'Range max': 'Rango máx.',
  'Pool fee APY': 'APY de comisiones del pool',
  'In range?': '¿En rango?',
  'Break-even': 'Punto de equilibrio',
  'Real yield · sustainable': 'Rendimiento real · sostenible',
  'Mostly real · low emissions': 'Mayormente real · pocas emisiones',
  'Emission-heavy · monitor sustainability': 'Muchas emisiones · vigila la sostenibilidad',
  'Pure emission · expect dilution': 'Pura emisión · espera dilución',
  'APY Breakdown': 'Desglose de APY',
  'Splits advertised APY into real yield vs token emissions. Compounds the total APY annually.':
    'Divide el APY anunciado en rendimiento real vs emisiones de token. Capitaliza el APY total anualmente.',
  'Base APY': 'APY base',
  'Reward APY': 'APY de recompensas',
  Principal: 'Principal',
  'reward share': 'cuota de recompensas',
  'Total APY': 'APY total',
  '6 months': '6 meses',
  '1 year': '1 año',
  '5 years': '5 años',

  // ── Stellar swap ──
  'Swap on Stellar': 'Swap en Stellar',
  'You review and sign in Freighter. Astryum never signs or holds funds.':
    'Tú revisas y firmas en Freighter. Astryum nunca firma ni custodia fondos.',
  'Asset in (contract id C…)': 'Activo de entrada (contract id C…)',
  'Asset out (contract id C…)': 'Activo de salida (contract id C…)',
  'Amount (stroops)': 'Cantidad (stroops)',
  'Slippage %': 'Slippage %',
  'Quoting…': 'Cotizando…',
  Quote: 'Cotización',
  'out ≈': 'salida ≈',
  impact: 'impacto',
  'Waiting for Freighter…': 'Esperando a Freighter…',
  '✓ Submitted ·': '✓ Enviada ·',

  // ── Marketplace ──
  clients: 'clientes',
  Capital: 'Capital',
  'Zero liq': 'Cero liq',
  Retention: 'Retención',
  'View profile': 'Ver perfil',
  'Failed to load managers': 'No se pudieron cargar los gestores',
  'Manager Marketplace': 'Marketplace de gestores',
  'Browse portfolio managers with verified track records. Accept a proposal to delegate capital management within your chosen limits.':
    'Explora gestores de portfolio con historiales verificados. Acepta una propuesta para delegar la gestión de capital dentro de los límites que elijas.',
  'Active managers': 'Gestores activos',
  'Non-custodial': 'No custodial',
  'Revokable mandates': 'Mandatos revocables',
  'Search by name or strategy...': 'Buscar por nombre o estrategia...',
  'No managers found.': 'No se encontraron gestores.',
  Previous: 'Anterior',
  Next: 'Siguiente',

  // ── Manager apply ──
  'Please check the form and try again.': 'Revisa el formulario e inténtalo de nuevo.',
  'Something went wrong. Please try again.': 'Algo salió mal. Inténtalo de nuevo.',
  'Application Submitted': 'Solicitud enviada',
  'Your manager application is pending identity verification. Complete KYC to advance to admin review.':
    'Tu solicitud de gestor está pendiente de verificación de identidad. Completa el KYC para avanzar a la revisión del administrador.',
  'Complete KYC Verification': 'Completar verificación KYC',
  'Go to Manager Dashboard →': 'Ir al panel de gestor →',
  '← Back to Dashboard': '← Volver al panel',
  'Apply as a Portfolio Manager': 'Solicitar ser gestor de portfolio',
  'Join Astryum’s manager network. Receive GoalRequests from users, send proposals, and earn fees on managed capital.':
    'Únete a la red de gestores de Astryum. Recibe GoalRequests de usuarios, envía propuestas y gana comisiones sobre el capital gestionado.',
  'Founding Badge': 'Insignia fundadora',
  'First 20 managers earn a permanent Founding Manager badge':
    'Los primeros 20 gestores reciben una insignia permanente de Gestor Fundador',
  'Grow Your AUM': 'Haz crecer tu AUM',
  'Manage delegated capital with user-approved limits and protocols':
    'Gestiona capital delegado con límites y protocolos aprobados por el usuario',
  'Earn Referral Fees': 'Gana comisiones por referidos',
  'Get a unique link and earn % of platform fees from referred users':
    'Obtén un enlace único y gana un % de las comisiones de plataforma de los usuarios referidos',
  'Application Details': 'Detalles de la solicitud',
  'Display Name': 'Nombre visible',
  'Your name or firm name': 'Tu nombre o el de tu firma',
  Bio: 'Biografía',
  'Describe your DeFi experience, strategy philosophy, and track record...':
    'Describe tu experiencia DeFi, filosofía de estrategia e historial...',
  'License Type': 'Tipo de licencia',
  'Individual (self-managed portfolio)': 'Individual (portfolio autogestionado)',
  'Registered Advisor': 'Asesor registrado',
  Institutional: 'Institucional',
  'Application process': 'Proceso de solicitud',
  'Submit application form (this step)': 'Enviar el formulario de solicitud (este paso)',
  'Complete KYC identity verification via Crossmint':
    'Completar la verificación de identidad KYC vía Crossmint',
  'Admin review and approval': 'Revisión y aprobación del administrador',
  'Receive Founding Manager badge (if eligible) + referral link':
    'Recibir la insignia de Gestor Fundador (si aplica) + enlace de referido',
  'Submitting…': 'Enviando…',
  'Submit Application': 'Enviar solicitud',

  // ── Manager dashboard ──
  'Become a Manager': 'Conviértete en gestor',
  'Register as a portfolio manager to receive GoalRequests from users, send proposals, and manage delegated capital within user-approved limits.':
    'Regístrate como gestor de portfolio para recibir GoalRequests de usuarios, enviar propuestas y gestionar capital delegado dentro de los límites aprobados por el usuario.',
  'Apply as Manager': 'Solicitar ser gestor',
  'Founding Manager': 'Gestor Fundador',
  'Manager Dashboard': 'Panel de gestor',
  'Identity verification required': 'Verificación de identidad requerida',
  'Complete KYC to proceed to admin approval.': 'Completa el KYC para pasar a la aprobación del administrador.',
  'Start KYC →': 'Iniciar KYC →',
  'Application under review': 'Solicitud en revisión',
  'KYC verified. An admin will review your application shortly.':
    'KYC verificado. Un administrador revisará tu solicitud en breve.',
  'Active Clients': 'Clientes activos',
  'Pending Proposals': 'Propuestas pendientes',
  Accepted: 'Aceptada',
  Referrals: 'Referidos',
  Rejected: 'Rechazada',
  Withdrawn: 'Retirada',
  'KYC Pending': 'KYC pendiente',
  'Awaiting Approval': 'Esperando aprobación',
  Suspended: 'Suspendida',
  Proposals: 'Propuestas',
  Clients: 'Clientes',
  Analytics: 'Analíticas',
  'Track Record': 'Historial',
  Period: 'Periodo',
  Backups: 'Respaldos',
  'Track record builds automatically each month.': 'El historial se construye automáticamente cada mes.',
  'proposals sent': 'propuestas enviadas',
  'Browse open goals': 'Explorar objetivos abiertos',
  'No proposals sent yet. Browse open goals to get started.':
    'Aún no has enviado propuestas. Explora objetivos abiertos para empezar.',
  User: 'Usuario',
  'Protocols:': 'Protocolos:',
  Max: 'Máx',
  'No active clients yet.': 'Aún no hay clientes activos.',
  'Your Referral Link': 'Tu enlace de referido',
  'Copied!': '¡Copiado!',
  'Share this link with potential users. You earn': 'Comparte este enlace con usuarios potenciales. Ganas un',
  '% of platform fees from referred clients during the first':
    '% de las comisiones de plataforma de los clientes referidos durante los primeros',
  'months.': 'meses.',
  'Conversion Funnel': 'Embudo de conversión',
  'link clicks': 'clics en el enlace',
  Registered: 'Registrado',
  'Created Goal': 'Objetivo creado',
  'Delegation Accepted': 'Delegación aceptada',
  'First Yield': 'Primer rendimiento',
  'Pending Payout': 'Pago pendiente',
  'Total Paid': 'Total pagado',
  'Proposal Funnel': 'Embudo de propuestas',
  conversion: 'conversión',
  'Goal Requests Received': 'GoalRequests recibidas',
  'Proposals Sent': 'Propuestas enviadas',
  'Assets Under Management': 'Activos bajo gestión',
  'Combined max capital across active delegations': 'Capital máx. combinado de las delegaciones activas',
  'Monthly Track Record': 'Historial mensual',
  Preserved: 'Preservado',

  // ── Manager detail ──
  'Manager not found': 'Gestor no encontrado',
  'Not found': 'No encontrado',
  'Go back': 'Volver',
  'Back to Marketplace': 'Volver al marketplace',
  'active clients': 'clientes activos',
  'Avg. APY': 'APY medio',
  months: 'meses',
  'Capital Preserved': 'Capital preservado',
  'latest period': 'último periodo',
  'Backup Activations': 'Activaciones de respaldo',
  'Zero Liquidations': 'Cero liquidaciones',
  '✓ Yes': '✓ Sí',
  '✗ No': '✗ No',
  'No Liq': 'Sin liq',
  'Delegating to a manager does NOT transfer custody of your assets. Your wallet remains in full control. All actions proposed by a manager require your explicit signature. You can revoke the mandate at any time.':
    'Delegar en un gestor NO transfiere la custodia de tus activos. Tu wallet mantiene el control total. Todas las acciones propuestas por un gestor requieren tu firma explícita. Puedes revocar el mandato en cualquier momento.',
  'Create a Goal to Receive Proposals': 'Crea un objetivo para recibir propuestas',
  'Manager sends proposal via your goal': 'El gestor envía la propuesta a través de tu objetivo',

  // ── Delegate / accept proposal ──
  'Proposal not found': 'Propuesta no encontrada',
  'Failed to reject proposal': 'No se pudo rechazar la propuesta',
  'Mandate Created': 'Mandato creado',
  'The manager can now propose actions within the limits you approved.':
    'El gestor ahora puede proponer acciones dentro de los límites que aprobaste.',
  'You still sign every transaction.': 'Sigues firmando cada transacción.',
  'Mandate ID:': 'ID del mandato:',
  'Back to Goals': 'Volver a Objetivos',
  'Browse More Managers': 'Explorar más gestores',
  'Review Proposal': 'Revisar propuesta',
  'From manager': 'Del gestor',
  Review: 'Revisar',
  Backup: 'Respaldo',
  Confirm: 'Confirmar',
  Done: 'Hecho',
  'Proposed Mandate Scope': 'Alcance del mandato propuesto',
  'Max capital per action': 'Capital máx. por acción',
  Duration: 'Duración',
  'Open-ended': 'Sin fin definido',
  'Fee Model': 'Modelo de comisiones',
  'AI Analysis': 'Análisis de IA',
  Continue: 'Continuar',
  Reject: 'Rechazar',
  'Backup Strategy Activation': 'Activación de la estrategia de respaldo',
  'If risk conditions are triggered (e.g. HF drops below threshold), how should the backup strategy activate?':
    'Si se cumplen las condiciones de riesgo (p. ej. el HF cae por debajo del umbral), ¿cómo debería activarse la estrategia de respaldo?',
  'Notify me (default)': 'Notificarme (opción por defecto)',
  'Astryum sends a push notification. You review and sign the defensive action manually.':
    'Astryum envía una notificación push. Tú revisas y firmas la acción defensiva manualmente.',
  'Pre-authorize (advanced)': 'Preautorizar (avanzado)',
  'Sign a conditional authorization now (30-day expiry). Backup actions execute when triggered without needing your real-time signature.':
    'Firma una autorización condicional ahora (caduca en 30 días). Las acciones de respaldo se ejecutan al dispararse sin necesitar tu firma en tiempo real.',
  'Pre-authorization allows the manager to execute defensive actions without your real-time approval. You can revoke it at any time from /app/goals.':
    'La preautorización permite al gestor ejecutar acciones defensivas sin tu aprobación en tiempo real. Puedes revocarla en cualquier momento desde /app/goals.',
  'Continue to Confirm': 'Continuar a Confirmar',
  Summary: 'Resumen',
  'Backup mode': 'Modo de respaldo',
  'Pre-authorized': 'Preautorizado',
  'Notify only': 'Solo notificar',
  'Your assets remain in your wallet at all times. The manager can only propose actions — you sign each transaction. You can revoke this mandate instantly from your dashboard.':
    'Tus activos permanecen en tu wallet en todo momento. El gestor solo puede proponer acciones — tú firmas cada transacción. Puedes revocar este mandato al instante desde tu panel.',
  'Creating mandate…': 'Creando mandato…',
  'Accept Proposal & Create Mandate': 'Aceptar propuesta y crear mandato',

  // ── Overview / Summary redesign ───────────────────────────────────────────
  'Astryum watches your Flare positions, scores their risk in real time, and prepares every action for your signature. Nothing moves without you.':
    'Astryum vigila tus posiciones en Flare, evalúa su riesgo en tiempo real y prepara cada acción para tu firma. Nada se mueve sin ti.',
  'Read-only until you sign. Astryum reads your on-chain positions and prepares defensive actions — repay, add collateral, exit LP — with their exact impact shown before you commit.':
    'Solo lectura hasta que firmes. Astryum lee tus posiciones on-chain y prepara acciones defensivas —repagar, añadir colateral, salir de LP— mostrando su impacto exacto antes de que confirmes.',
  Allocation: 'Distribución',
  Holdings: 'Tenencias',
  protocols: 'protocolos',
  assets: 'activos',
  'Awaiting first risk reading': 'Esperando la primera lectura de riesgo',
  'Reading positions…': 'Leyendo posiciones…',
  'Nothing to chart yet': 'Nada que graficar aún',
  'to search everything': 'para buscar en todo',
  'Put FXRP and FLR to work in audited vaults — you always sign.':
    'Pon a trabajar FXRP y FLR en bóvedas auditadas — tú siempre firmas.',
  'Balances, collateral, debt, LP and staking in one snapshot.':
    'Saldos, colateral, deuda, LP y staking en un solo vistazo.',
  'Connect Flare (EVM) and Xaman (XRPL). See and act with any.':
    'Conecta Flare (EVM) y Xaman (XRPL). Mira y actúa con cualquiera.',
  'Every coin in one real-time view across chains.':
    'Cada moneda en una vista en tiempo real entre cadenas.',
  'Health Factor, LTV, distance to liquidation, stress tests.':
    'Health Factor, LTV, distancia a liquidación, pruebas de estrés.',
  'Simulations, signatures and receipts — the full audit trail.':
    'Simulaciones, firmas y recibos — el rastro de auditoría completo.',

  // ── Dashboard 2026-07: network card, performance, gauge, allocation ────────
  'My Assets': 'Mis activos',
  'Assets Earning': 'Activos generando',
  'Not earning': 'Sin generar',
  // The ring charts only capital placed in a venue — with everything parked
  // there is nothing to draw, and the card says so instead of drawing a grey
  // circle. The figures still read in the split line above it.
  'Nothing at work yet': 'Nada trabajando todavía',
  'This ring charts only capital placed in a vault. Pick a strategy and it shows up here.':
    'Este anillo solo dibuja el capital colocado en una bóveda. Elige una estrategia y aparecerá aquí.',
  // Money LEAVING a venue: redeemed, waiting for the protocol's release date.
  // Neither working nor parked — it has a date, and the date is shown.
  'On the way': 'En camino',
  lands: 'llega el',
  Leaving: 'Saliendo',
  'Ready to claim': 'Listo para reclamar',
  Performance: 'Rendimiento',
  'Expand performance chart': 'Ampliar gráfico de rendimiento',
  offline: 'sin conexión',
  gas: 'gas',
  fee: 'comisión',
  Idle: 'Libre',
  Start: 'Empezar',

  // ── Strategy hub (pick · create · manage) ──────────────────────────────────
  'Put your': 'Pon tus',
  'Pick a working strategy': 'Elige una estrategia lista',
  'Create your own strategy': 'Crea tu propia estrategia',
  'Your working strategies': 'Tus estrategias en marcha',
  'Two strategy packs live on Flare mainnet. See the exact legs each one is made of and start with your amount.':
    'Dos packs de estrategia en vivo en Flare mainnet. Mira las patas exactas que componen cada uno y empieza con tu cantidad.',
  'Describe it in plain text. Astryum compiles it into an intent — you review every number and sign in your wallet.':
    'Descríbela en texto plano. Astryum la compila en un intent — revisas cada número y firmas en tu wallet.',
  'See and control what is currently running across your connected wallets.':
    'Mira y controla lo que está en marcha en tus wallets conectadas.',
  'Back to strategies': 'Volver a estrategias',
  'View composition': 'Ver composición',
  legs: 'patas',
  'Reading your positions…': 'Leyendo tus posiciones…',
  'No strategies working yet': 'Aún no hay estrategias en marcha',
  'When a strategy is live, its real on-chain legs show up here, read from your wallets.':
    'Cuando una estrategia esté viva, sus patas on-chain reales aparecerán aquí, leídas de tus wallets.',
  'Open in Portfolio': 'Abrir en Cartera',
  'Astryum is non-custodial: it builds unsigned payloads and hands them to your wallet. It never signs, never custodies, never broadcasts.':
    'Astryum es no-custodial: construye payloads sin firmar y los entrega a tu wallet. Nunca firma, nunca custodia, nunca difunde.',

  // ── Strategy pack composition (real on-chain legs) ─────────────────────────
  'FAssets direct-mint: your XRP is minted into FXRP on Flare':
    'Direct-mint de FAssets: tu XRP se acuña como FXRP en Flare',
  'The FXRP lands in your Flare Smart Account':
    'El FXRP llega a tu Smart Account de Flare',
  'Kinetic ISO market: FXRP supplied as collateral':
    'Mercado aislado de Kinetic: FXRP aportado como colateral',
  'Kinetic ISO market: USDT0 borrowed at your chosen ratio':
    'Mercado aislado de Kinetic: USDT0 prestado al ratio que elijas',
  'Protection: a repay intent is prepared if HF hits your trigger':
    'Protección: se prepara un intent de repago si el HF toca tu disparador',
  'WNat contract: FLR wrapped into WFLR':
    'Contrato WNat: FLR envuelto en WFLR',
  'WFLR vote power delegated to the FTSO provider you pick':
    'Poder de voto WFLR delegado al proveedor FTSO que elijas',
  'FTSO rewards accrue per ~3.5-day epoch (protocol data, not an Astryum offer)':
    'Las recompensas FTSO se acumulan por época de ~3,5 días (dato del protocolo, no oferta de Astryum)',
  'Withdraw anytime returns FXRP': 'Retira cuando quieras — devuelve FXRP',
  'The FXRP stays on Flare — going back to native XRP needs a 5 XRP protocol minimum and is not yet available from this account (roadmap)':
    'El FXRP se queda en Flare — la vuelta a XRP nativo exige un mínimo de protocolo de 5 XRP y aún no está disponible desde esta cuenta (roadmap)',

  // ── Dashboard 2026-07-03: capital performance band + earn hub v2 ───────────
  'Capital Performance': 'Rendimiento del capital',
  'Ready to Use Strategy': 'Estrategias listas para usar',

  // ── Portfolio positions v2 (price · wallet · location) ─────────────────────
  Price: 'Precio',
  Value: 'Valor',
  Location: 'Ubicación',
  'Portfolio %': '% Cartera',
  'In Wallet': 'En wallet',
  Working: 'Trabajando',
  Earning: 'Generando',
  'also working': 'también trabajando',
  'See where this asset lives': 'Ver dónde está este activo',
  'Where this asset lives across your wallets and protocols':
    'Dónde está este activo entre tus wallets y protocolos',
  'Total value': 'Valor total',
  'Total amount': 'Cantidad total',
  'Read-only view — balances come from the same live snapshot as the portfolio.':
    'Vista de solo lectura — los balances salen del mismo snapshot en vivo que la cartera.',

  // ── Wallets (demo scope) ────────────────────────────────────────────────────
  'Balance unavailable right now': 'Balance no disponible ahora mismo',
  'Balance shown for Flare and XRPL wallets': 'Balance visible para wallets de Flare y XRPL',
  'These are the two wallets accepted in this beta. Connecting only reads the address — enabling transactions is a separate, per-wallet signature.':
    'Estas son las dos wallets aceptadas en esta beta. Conectar solo lee la dirección — habilitar transacciones es una firma aparte por wallet.',
  'These are the two wallets accepted in this beta: MetaMask on Flare Mainnet (chain 14) and Xaman on XRPL. Connecting only reads the address — enabling transactions is a separate, per-wallet signature.':
    'Estas son las dos wallets aceptadas en esta beta: MetaMask en Flare Mainnet (chain 14) y Xaman en XRPL. Conectar solo lee la dirección — habilitar transacciones es una firma aparte por wallet.',
  // Prose thrown by the connect rail (lib/wallet/useWalletLinking, flareChain) —
  // rendered through t() so the Spanish UI doesn't answer in English.
  'MetaMask is not available in this browser — use the QR or the “Open in MetaMask” link that just opened, or install the MetaMask extension.':
    'MetaMask no está disponible en este navegador — usa el QR o el enlace «Abrir en MetaMask» que acaba de aparecer, o instala la extensión de MetaMask.',
  'Linking a wallet needs Flare Mainnet and the switch was declined in MetaMask. Nothing was added — try again whenever you like.':
    'Vincular una wallet necesita Flare Mainnet y el cambio de red se rechazó en MetaMask. No se ha añadido nada — inténtalo cuando quieras.',
  'This beta links Flare wallets only — switch MetaMask to Flare Mainnet (chain 14), then add the wallet again.':
    'Esta beta solo vincula wallets de Flare — cambia MetaMask a Flare Mainnet (chain 14) y añade la wallet otra vez.',
  'The MetaMask connection was declined — nothing was linked.':
    'Se rechazó la conexión con MetaMask — no se ha vinculado nada.',
  'Link MetaMask on Flare Mainnet or Xaman on XRPL to load your on-chain positions across every connected account.':
    'Vincula MetaMask en Flare Mainnet o Xaman en XRPL para cargar tus posiciones on-chain en todas las cuentas conectadas.',

  // ── Settings copy (expert toggle removed) ───────────────────────────────────
  'Connection, network and account preferences. No private keys are ever stored here.':
    'Preferencias de conexión, red y cuenta. Aquí nunca se guardan claves privadas.',

  // ── Portfolio header (2026-07-04 aesthetics pass) ───────────────────────────
  Your: 'Tu',
  portfolio: 'cartera',
  'Every wallet and position in one live view — filter by wallet, network or range.':
    'Cada wallet y posición en una vista en vivo — filtra por wallet, red o rango.',

  // ── Earn hub v3: plain-language packs + AI agent ────────────────────────────
  'Choose a Strategy': 'Elige una estrategia',
  'Create with AI Agent': 'Crear con el agente IA',
  'Chat with the agent: describe the strategy you want, it helps you complete it and compiles it for your signature.':
    'Chatea con el agente: describe la estrategia que quieres, te ayuda a completarla y la compila para tu firma.',
  'The strategies you created with the agent, plus what is live on-chain right now.':
    'Las estrategias que creaste con el agente, más lo que está vivo on-chain ahora mismo.',
  'Live on-chain': 'En vivo on-chain',
  'View technical composition': 'Ver composición técnica',
  'Your XRP becomes FXRP on Flare, works as collateral in the Kinetic market, and you borrow USDT0 against it — watched by a stop-loss.':
    'Tu XRP se convierte en FXRP en Flare, trabaja como colateral en el mercado de Kinetic y pides prestado USDT0 contra él — vigilado por un stop-loss.',
  'Your FLR is wrapped into WFLR and its vote power delegated to an FTSO data provider — rewards accrue every ~3.5 days.':
    'Tu FLR se envuelve en WFLR y su poder de voto se delega a un proveedor de datos FTSO — las recompensas se acumulan cada ~3,5 días.',
  'your wallet': 'tu wallet',
  'minted 1:1': 'acuñado 1:1',
  // 'collateral' ya existe más arriba (línea ~968) — no duplicar.
  borrowed: 'prestado',
  'wrapped 1:1': 'envuelto 1:1',
  delegated: 'delegado',
  'per epoch': 'por época',
  Converts: 'Convierte',
  'Works in': 'Trabaja en',
  Protection: 'Protección',
  'XRP → FXRP (1:1)': 'XRP → FXRP (1:1)',
  'Kinetic ISO lending market': 'Mercado de préstamo aislado de Kinetic',
  'Medium — it borrows against your collateral': 'Medio — pide prestado contra tu colateral',
  'Stop-loss at HF 1.10 — you choose it': 'Stop-loss en HF 1.10 — lo eliges tú',
  'FLR → WFLR (1:1, reversible)': 'FLR → WFLR (1:1, reversible)',
  'FTSO delegation': 'Delegación FTSO',
  'Low — no debt, undo any time': 'Bajo — sin deuda, deshaz cuando quieras',
  'Every ~3.5-day epoch (protocol data)': 'Cada época de ~3,5 días (dato del protocolo)',
  'Yields are live protocol rates — you see the exact numbers before signing.':
    'Los rendimientos son tipos en vivo del protocolo — ves los números exactos antes de firmar.',

  // ── Choose a strategy: live yield chip · More info modal · calculator ────────
  'live': 'en vivo',
  'live protocol rate': 'tipo del protocolo en vivo',
  'Loading live rate': 'Cargando tipo en vivo',
  'More info': 'Más info',
  'Technical composition': 'Composición técnica',
  'Profitability calculator': 'Calculadora de rentabilidad',
  'Signs on': 'Se firma en',
  'as of': 'a fecha de',
  'Months': 'Meses',
  'Rate': 'Tipo',
  'your estimate': 'tu estimación',
  'Estimated yield': 'Rendimiento estimado',
  'Total after': 'Total tras',
  'mo': 'm',
  'An estimate over the rate shown — simple (non-compounded), before fees and price moves. It is not an offer, a promise, or an Astryum yield.':
    'Una estimación sobre el tipo mostrado — simple (sin componer), antes de comisiones y movimientos de precio. No es una oferta, una promesa ni un rendimiento de Astryum.',
  '30-day historical': 'histórico 30 días',
  'Collateral supply APR — the carry adds a USDT0 borrow leg; model it in the calculator':
    'APR de supply del colateral — el carry añade una pata de préstamo USDT0; modélala en la calculadora',
  'Rewards start in Phase 2 (per Firelight) — not live yet':
    'Las recompensas empiezan en la Fase 2 (según Firelight) — aún no activas',
  'FTSO rewards accrue per ~3.5-day epoch (protocol data)':
    'Las recompensas FTSO se acumulan por época de ~3,5 días (dato del protocolo)',
  'Live rate unavailable — check the protocol':
    'Tipo en vivo no disponible — consulta el protocolo',

  // ── More info: mechanism · DeFiLlama/Upshift market data · website link ──────
  'How the yield is generated': 'Cómo se genera el yield',
  'Market data': 'Datos de mercado',
  'Vault data': 'Datos del vault',
  'APY total': 'APY total',
  '30d avg APY': 'APY medio 30d',
  'IL risk': 'Riesgo IL',
  'none': 'ninguno',
  'Exposure': 'Exposición',
  'Rewards in': 'Recompensas en',
  'DeFiLlama outlook': 'Perspectiva DeFiLlama',
  'data points': 'puntos de datos',
  'Receipt': 'Recibo',
  'Risk': 'Riesgo',
  'Visit': 'Visita',
  'see exactly where your money goes': 've exactamente dónde va tu dinero',
  'Not indexed on DeFiLlama — the numbers come straight from the protocol on-chain. Open the protocol to see live data.':
    'No indexado en DeFiLlama — los números vienen directos del protocolo on-chain. Abre el protocolo para ver los datos en vivo.',
  'borrow APR — you pay': 'APR del préstamo — lo pagas tú',
  'you pay': 'lo pagas',
  'The carry earns the supply side minus this borrow cost':
    'El carry gana la parte de supply menos este coste del préstamo',
  'Live market data could not load right now — open the protocol to see it.':
    'Los datos de mercado en vivo no se pudieron cargar ahora — abre el protocolo para verlos.',

  // ── Strategy agent ──────────────────────────────────────────────────────────
  'Strategy agent': 'Agente de estrategias',
  'Compiles your words into a strategy — you always review and sign':
    'Compila tus palabras en una estrategia — tú siempre revisas y firmas',
  'Saved to My Strategy': 'Guardada en Mi estrategia',
  'Describe your strategy…': 'Describe tu estrategia…',
  'Save to My Strategy': 'Guardar en Mi estrategia',
  'Compile & execute': 'Compilar y ejecutar',
  'Strategies you create with the agent are saved here — editable and ready to run.':
    'Las estrategias que crees con el agente se guardan aquí — editables y listas para ejecutar.',
  'Created by you': 'Creadas por ti',
  'Custom · beta': 'Personalizada · beta',
  'Ready-made match': 'Coincide con una lista',
  Edit: 'Editar',
  Run: 'Ejecutar',
  'Delete?': '¿Eliminar?',
  'Edit strategy': 'Editar estrategia',
  Name: 'Nombre',
  'Borrow ratio': 'Ratio de préstamo',
  'Stop-loss HF': 'HF de stop-loss',
  'Protect your position': 'Protege tu posición',
  'Stop-loss HF · trigger to repay': 'HF de stop-loss · dispara el repay',
  "How much of your maximum borrow capacity you use. Your FXRP collateral × the market's live collateral factor sets the most USDT0 you could borrow; 0.30 borrows 30% of that maximum. The lower the ratio, the higher your opening Health Factor (≈ 1 ÷ ratio) and the further you start from liquidation (HF < 1.0).":
    'Cuánta de tu capacidad máxima de préstamo usas. Tu colateral FXRP × el collateral factor vivo del mercado fija el máximo de USDT0 que podrías pedir; 0,30 pide el 30% de ese máximo. Cuanto más bajo el ratio, más alto tu Health Factor de apertura (≈ 1 ÷ ratio) y más lejos empiezas de la liquidación (HF < 1,0).',
  'The Health Factor (HF) compares your collateral (× its collateral factor) with your debt: at 1.0 the market can liquidate the position. This threshold sets the trigger price shown in the review and pre-fills the Protect rule you create afterwards from your position: when the live HF drops below it, Astryum prepares the exact repay and asks YOU to sign it — it never signs or executes on its own.':
    'El Health Factor (HF) compara tu colateral (× su collateral factor) con tu deuda: en 1,0 el mercado puede liquidar la posición. Este umbral fija el precio de disparo que verás en la revisión y pre-rellena la regla Protect que creas después desde tu posición: cuando el HF vivo caiga por debajo, Astryum prepara el repay exacto y te pide FIRMARLO — nunca firma ni ejecuta por su cuenta.',
  'Save changes': 'Guardar cambios',
  'Running opens the same review — nothing moves until you sign in your own wallet.':
    'Ejecutar abre la misma revisión — nada se mueve hasta que firmes en tu propia wallet.',
  // ── E3 lend-only (FXRP supply sin borrow) ──────────────────────────────────
  'No loans, no debt, no risk of liquidation. Withdraw whenever — you get FXRP back.':
    'Sin préstamos, sin deuda, sin riesgo de liquidación. Retíralo cuando quieras — recuperas FXRP.',
  'Value now': 'Valor ahora',
  'Supply rate (protocol data)': 'Tasa de supply (dato del protocolo)',
  'see live rate on Kinetic': 'ver tasa en vivo en Kinetic',
  'Debt · liquidation risk': 'Deuda · riesgo de liquidación',
  'None — plain supply': 'Ninguno — depósito simple',
  // ── Product assistant (guía de la app) ─────────────────────────────────────
  'How does this work?': '¿Cómo funciona?',
  'Co-pilot': 'Copiloto',
  // Puerta de la comunidad (Discord), fijada junto a Settings
  'Bugs and feedback': 'Fallos y sugerencias',
  'Report a bug or send us feedback': 'Cuéntanos un fallo o mándanos tu opinión',
  'Ready-made': 'Listas para usar',
  'With the agent': 'Con el agente',
  'Ready routes': 'Rutas listas',
  'How it works': 'Cómo funciona',
  'Describe what you have and what you want.': 'Describe qué tienes y qué quieres.',
  'The agent compiles it with live protocol numbers.': 'El agente la compila con números reales del protocolo.',
  'You review every figure and sign in your own wallet.': 'Revisas cada cifra y firmas en tu propia wallet.',
  'The agent has zero discretion: it never invents numbers, never promises yield, never executes.':
    'El agente tiene cero discreción: nunca inventa números, nunca promete rendimiento, nunca ejecuta.',
  'Astryum guide': 'Guía de Astryum',
  'Explains the app · never sees your data': 'Explica la app · nunca ve tus datos',
  'I explain how Astryum works — where things live and what each screen does. Ask me anything about the app.':
    'Explico cómo funciona Astryum: dónde está cada cosa y qué hace cada pantalla. Pregúntame lo que quieras sobre la app.',
  'Try one of these:': 'Prueba una de estas:',
  'What is the health factor?': '¿Qué es el health factor?',
  'How do I put my XRP to work?': '¿Cómo pongo mi XRP a trabajar?',
  'What is a Carry strategy?': '¿Qué es una estrategia Carry?',
  'Where do I see my positions?': '¿Dónde veo mis posiciones?',
  'Ask about the app…': 'Pregunta sobre la app…',
  'This guide only explains the app. It never sees your balance or positions, and gives no financial advice.':
    'Esta guía solo explica la app. Nunca ve tu saldo ni tus posiciones, y no da consejo financiero.',
  'A lot of questions right now — give it a moment and try again.':
    'Muchas preguntas ahora mismo — espera un momento y reinténtalo.',
  "The assistant didn't respond. Please try again.": 'El asistente no respondió. Inténtalo de nuevo.',
  // ── Estrategias (vista unificada C2) ───────────────────────────────────────
  'My strategies': 'Mis estrategias',
  'Everything in one place — the ones running now and the ones you saved.':
    'Todo en un sitio — las que están funcionando y las que guardaste.',
  'Active · Online': 'Activas · Online',
  'Saved · Offline': 'Guardadas · Offline',
  'very healthy': 'muy sana',
  'no debt': 'sin deuda',
  'cushion': 'colchón',
  'Your cushion at entry': 'Tu colchón al empezar',
  'liquidation at 1.00': 'liquidación en 1,00',
  // ── translateError (Fase 1, 2026-07-30): un fallo → una frase ──
  'You cancelled the signature. Nothing moved — try again whenever you like.':
    'Has cancelado la firma. No se ha movido nada — vuelve a intentarlo cuando quieras.',
  'Not enough XRP in the account for this payment.':
    'No hay suficiente XRP en la cuenta para este pago.',
  'The network keeps a minimum locked in every account and this would go below it.':
    'La red mantiene un mínimo bloqueado en cada cuenta y esto lo dejaría por debajo.',
  'The destination account does not exist on the network.':
    'La cuenta de destino no existe en la red.',
  'The destination account does not exist yet — it needs a first deposit larger than this.':
    'La cuenta de destino aún no existe — necesita un primer depósito mayor que este.',
  'The destination requires a tag and this payment carries none.':
    'El destino exige un tag y este pago no lleva ninguno.',
  'This operation expired before reaching the network.':
    'Esta operación caducó antes de llegar a la red.',
  'The network found no path to deliver this payment.':
    'La red no encontró camino para entregar este pago.',
  'This operation already ran or became stale.':
    'Esta operación ya se ejecutó o quedó obsoleta.',
  'This operation expired before the network confirmed it.':
    'Esta operación caducó antes de que la red la confirmara.',
  'This operation would change nothing, so the network refuses it.':
    'Esta operación no cambiaría nada, así que la red la rechaza.',
  'Only the account’s own master key can sign this operation.':
    'Solo la llave maestra de la propia cuenta puede firmar esta operación.',
  'The network rejected the operation. Your money did not move; only the network fee was spent.':
    'La red rechazó la operación. Tu dinero no se ha movido; solo se gastó la comisión de red.',
  "We couldn't reach the server. Nothing was signed and nothing moved — try again in a minute.":
    'No hemos podido conectar con el servidor. No se ha firmado ni movido nada — inténtalo en un minuto.',
  'Something went wrong — try again in a minute.':
    'Algo ha fallado — inténtalo en un minuto.',
  'keep an eye on it': 'vigílala',
  'at risk': 'en riesgo',
  'Connect your wallet to see the health of your active strategies.':
    'Conecta tu wallet para ver la salud de tus estrategias activas.',
  "Couldn't read your risk right now. Try again in a moment.":
    'No pude leer tu riesgo ahora mismo. Inténtalo en un momento.',
  'No debt to watch — your active strategies have no liquidation risk.':
    'Sin deuda que vigilar — tus estrategias activas no tienen riesgo de liquidación.',
  'Your position is': 'Tu posición está',
  "you're protected if the price falls about": 'te proteges si el precio cae en torno a un',
  'If the price touches': 'Si el precio toca',
  'your position is liquidated.': 'te liquidan la posición.',
  Distance: 'Distancia',
  'Net P&L per strategy appears once your position accumulates history.':
    'El P&L neto por estrategia aparece cuando tu posición acumula histórico.',

  // ── Estrategias · shelves + registro (reorg UI 2026-07-12) ────────────────
  'Working right now': 'Funcionando ahora',
  'Running · Online': 'Funcionando · Online',
  'The strategies working on-chain: real positions with their MoneyFlows, plus your active savings.':
    'Las estrategias funcionando on-chain: posiciones reales con sus MoneyFlows, más tu ahorro activo.',
  'The registry': 'El registro',
  'Every strategy not in use — created with the agent or by hand. Open one to see its words, edit it and reactivate it.':
    'Todas las estrategias que no están en uso — creadas con el agente o a mano. Abre una para ver sus palabras, editarla y reactivarla.',
  Enter: 'Entrar',
  'Active savings': 'Ahorro activo',
  'Manage in Earn · Savings': 'Gestionar en Generar · Ahorro',
  'Paused savings rules': 'Reglas de ahorro en pausa',
  Reactivate: 'Reactivar',
  'A reactivated rule only watches and reminds — you always sign in Xaman.':
    'Una regla reactivada solo vigila y avisa — siempre firmas tú en Xaman.',
  'The registry of every manual and agent-created strategy. Each card keeps the words that created it; Run reactivates it through the same review-and-sign flow.':
    'El registro de todas las estrategias manuales y creadas con el agente. Cada card conserva las palabras que la crearon; Ejecutar la reactiva por el mismo flujo de revisar y firmar.',

  // ── Earn · puertas Ahorro y Crear manualmente (reorg UI 2026-07-12) ───────
  'Set XRP aside on the ledger until a date you choose, with rules that nudge you to save. You sign everything in Xaman.':
    'Aparta XRP en el ledger hasta la fecha que elijas, con reglas que te animan a ahorrar. Todo lo firmas tú en Xaman.',
  'Do it yourself': 'Hazlo tú mismo',
  'Create Manually': 'Crear manualmente',
  'Compose a strategy by hand with MoneyFlows and tools. It is saved to your registry in Estrategias, and runs only when you sign.':
    'Compón una estrategia a mano con MoneyFlows y herramientas. Se guarda en tu registro de Estrategias y solo se ejecuta cuando firmas.',
  'Compose the strategy with your own parameters. It is saved to your registry in Estrategias · Saved, editable and ready to run when it maps to a live rail.':
    'Compón la estrategia con tus propios parámetros. Se guarda en tu registro de Estrategias · Guardadas, editable y lista para ejecutarse cuando corresponde a un raíl en vivo.',
  'e.g. 25 XRP — protected carry': 'p. ej. 25 XRP — carry protegido',
  Notes: 'Notas',
  'What this strategy is for, in your own words — kept with the card.':
    'Para qué es esta estrategia, con tus palabras — se guarda con la card.',
  'Maps to': 'Corresponde a',
  'Custom · beta — not executable yet': 'Personalizada · beta — aún no ejecutable',
  'Give the strategy at least a name, an asset or an amount.':
    'Dale a la estrategia al menos un nombre, un activo o una cantidad.',
  'Save strategy': 'Guardar estrategia',
  'Save and run': 'Guardar y ejecutar',
  'Saved to your registry.': 'Guardada en tu registro.',
  'View it in Estrategias · Saved': 'Verla en Estrategias · Guardadas',
  Tools: 'Herramientas',
  'Protect (repay when HF drops) and Harvest (claim when rewards accrue) attach to a live position.':
    'Protect (repagar cuando cae el HF) y Harvest (reclamar cuando se acumulan recompensas) se acoplan a una posición en vivo.',
  'Open a running strategy to add one': 'Abre una estrategia en funcionamiento para añadir uno',
  'Live rails': 'Raíles en vivo',
  'XRP/FXRP maps to the Kinetic vault rail; FLR/WFLR to the FTSO delegation rail. Anything else stays a saved draft for now.':
    'XRP/FXRP corresponde al raíl del vault de Kinetic; FLR/WFLR al raíl de delegación FTSO. Todo lo demás se queda como borrador guardado por ahora.',
  'Set the parameters yourself — no agent in the loop.':
    'Fija tú los parámetros — sin agente de por medio.',
  'The strategy is saved to your registry in Estrategias.':
    'La estrategia se guarda en tu registro de Estrategias.',
  'Astryum builds unsigned payloads only — it never signs, never custodies, never executes.':
    'Astryum solo construye payloads sin firmar — nunca firma, nunca custodia, nunca ejecuta.',

  // ── Strategy assistant (LLM chat, Earn) ─────────────────────────────────────
  'Strategy assistant': 'Asistente de estrategias',
  'Shows you the options with real numbers — you decide and sign':
    'Te muestra las opciones con números reales — tú decides y firmas',
  'all options, unranked — the decision is yours': 'todas las opciones, sin ranking — la decisión es tuya',
  'yield, no cash': 'rendimiento, sin efectivo',
  'Option': 'Opción',
  'Cash now': 'Dinero ahora',
  'Cushion': 'Colchón',
  'You lose the collateral below': 'Pierdes el aval por debajo de',
  'Interest you pay per year': 'Intereses que pagas al año',
  'Tell me what you have and what you want to do — e.g. "I have 10,000 XRP and need $200 without selling". I\'ll show you the options with their real numbers; the decision is yours.':
    'Dime qué tienes y qué quieres hacer — p.ej. "Tengo 10.000 XRP y necesito 200 $ sin vender". Te enseño las opciones con sus números reales; la decisión es tuya.',
  'Numbers are live protocol data. Astryum prepares — you review and sign. No advice.':
    'Los números son datos del protocolo en vivo. Astryum prepara — tú revisas y firmas. Sin consejos.',
  'Connect your wallet to use the strategy assistant.': 'Conecta tu wallet para usar el asistente de estrategias.',

  // ── Earn done-state (settlement copy) ───────────────────────────────────────
  'Your XRP Payment is signed. FXRP mint + the Kinetic supply/borrow batch settle on Flare via the executor.':
    'Tu XRP Payment está firmado. El mint de FXRP + el batch de supply/borrow en Kinetic liquidan en Flare vía el executor.',
  'Your XRP Payment is signed. FXRP mint + the plain Kinetic supply settle on Flare via the executor — no borrow, no debt.':
    'Tu XRP Payment está firmado. El mint de FXRP + el supply simple en Kinetic liquidan en Flare vía el executor — sin préstamo, sin deuda.',

  // ── MoneyFlows CMF (F1 — compose_moneyflow + CUSTOM review modal) ───────────
  'Drafts an automation you review — every trigger still needs your signature':
    'Redacta una automatización que tú revisas — cada disparo sigue necesitando tu firma',
  'Describe what you want to automate — e.g. "if my health factor drops below 1.5, prepare a repay". You review the draft and every trigger prepares a transaction only you can sign.':
    'Describe qué quieres automatizar — p.ej. "si mi health factor baja de 1.5, prepara un repay". Tú revisas el borrador y cada disparo prepara una transacción que solo tú puedes firmar.',
  'The draft did not pass validation — nothing was proposed.':
    'El borrador no pasó la validación — no se propuso nada.',
  'Nothing runs until you review it — each trigger prepares a transaction only you can sign.':
    'Nada corre hasta que lo revisas — cada disparo prepara una transacción que solo tú puedes firmar.',
  'Review & activate': 'Revisar y activar',
  step: 'escalón',
  steps: 'escalones',
  'Custom MoneyFlow': 'MoneyFlow personalizado',
  'Drafted by the assistant — nothing runs until you review and sign':
    'Redactado por el asistente — nada corre hasta que revisas y firmas',
  'Flow name': 'Nombre del flow',
  'Rule wallet': 'Wallet de la regla',
  'Protect this position': 'Protege esta posición',
  'Invalid value for': 'Valor no válido para',
  'Create the MoneyFlow': 'Crear el MoneyFlow',
  'MoneyFlow created — it watches your position and, on trigger, prepares the repay for YOU to sign.':
    'MoneyFlow creado — vigila tu posición y, al dispararse, prepara el repay para que TÚ lo firmes.',
  'Manage it in Strategies (pause, resume, delete).': 'Gestiónalo en Strategies (pausar, reanudar, borrar).',
  'It expires on its own (90 days at most) and you can pause or delete it instantly.':
    'Caduca sola (90 días como máximo) y puedes pausarla o borrarla al instante.',
  'No position wallet available — link the wallet that holds the position (or connect your Xaman so its Smart Account resolves).':
    'No hay wallet de posición disponible — vincula la wallet que tiene la posición (o conecta tu Xaman para resolver su Smart Account).',
  'The flow watches this wallet and every prepared action targets it.':
    'El flow vigila esta wallet y cada acción preparada la tiene como objetivo.',
  'Link the wallet that holds the position (or connect your Xaman so its Smart Account resolves) before activating.':
    'Vincula la wallet que tiene la posición (o conecta tu Xaman para resolver su Smart Account) antes de activar.',
  Step: 'Escalón',
  'When Health Factor drops below': 'Cuando el Health Factor baje de',
  'When LTV rises above': 'Cuando el LTV suba de',
  'When claimable rewards exceed': 'Cuando las recompensas reclamables superen',
  'When idle balance exceeds': 'Cuando el balance ocioso supere',
  prepare: 'preparar',
  'Activate MoneyFlow': 'Activar MoneyFlow',
  'When it triggers, Astryum prepares the action and asks you to sign. It never signs or executes on its own.':
    'Cuando salta, Astryum prepara la acción y te pide firmarla. Nunca firma ni ejecuta por su cuenta.',

  // ── Rule prefill (E1 → PROTECT bridge) ──
  'Pre-filled with the thresholds you chose for this entry — adjust them if you like.':
    'Pre-rellenado con los umbrales que elegiste para esta entrada — ajústalos si quieres.',
  'Estimated trigger price': 'Precio de disparo estimado',

  // ── Per-position health (portfolio panel + meter) ──
  'Position health': 'Salud por posición',
  'riskiest first': 'primero las de más riesgo',
  Health: 'Salud',
  liquidation: 'liquidación',
  'No health reading': 'Sin lectura de salud',
  'Liquidates at': 'Liquida a',
  now: 'ahora',
  'No liquidation price': 'Sin precio de liquidación',
  'The XRP for the mint-coupled dispatch must be greater than 0': 'El XRP del dispatch acoplado al mint debe ser mayor que 0',

  // ── PROTECT restore mode (F9) ──
  // (labels/hints of the template are Spanish-first inline, like their siblings)

  // ── Region setting (F19) ──
  Region: 'Región',
  'Used only to check whether the in-app DeFi execution module is available in your jurisdiction. Monitoring, portfolio tracking and tax stay on everywhere, regardless of this setting. Astryum never guesses this from your language or location — you choose it.':
    'Solo se usa para comprobar si el módulo de ejecución DeFi in-app está disponible en tu jurisdicción. La monitorización, el portfolio y tax siguen activos en todas partes, independientemente de este ajuste. Astryum nunca lo adivina por tu idioma o ubicación — lo eliges tú.',
  'Not set': 'Sin definir',
  'Other…': 'Otra…',
  'e.g. CH, MX': 'p. ej. CH, MX',
  '2–3 letters, A–Z — e.g. CH, MX.': '2–3 letras, A–Z — p. ej. CH, MX.',
  'Current region': 'Región actual',

  // ── Intent watcher (F3) ──
  'Enable browser notifications': 'Activar notificaciones del navegador',

  // ── Copiloto con datos (F29a) ──
  'Sees your data (read-only) — never signs or executes': 'Ve tus datos (solo lectura) — nunca firma ni ejecuta',
  'Logged in: this guide can read your balance and positions (read-only) to answer — it never signs, executes, or gives financial advice.':
    'Con sesión: este guía puede leer tu balance y posiciones (solo lectura) para responder — nunca firma, ejecuta ni da consejo financiero.',
  "Browser notifications are blocked — enable them in your browser's site settings if you'd like to be alerted here.":
    'Las notificaciones del navegador están bloqueadas — actívalas en los ajustes del sitio de tu navegador si quieres recibir avisos aquí.',

  // ── Fix pass 2026-07-10: vault actions (now t()-wrapped) ──
  'Supply FXRP + borrow USDT0': 'Aporta FXRP + pide USDT0',
  'Put your XRP to work': 'Pon tu XRP a trabajar',
  'Wrap + delegate to FTSO': 'Wrap + delegar a FTSO',

  // ── Friendly HTTP errors (prepare/sign) ──
  'Your session expired — sign in again to continue.': 'Tu sesión caducó — vuelve a iniciar sesión para continuar.',
  'This action is not available in your region yet.': 'Esta acción aún no está disponible en tu región.',
  'Flare DeFi execution is disabled on this server (feature flag).': 'La ejecución DeFi de Flare está desactivada en este servidor (feature flag).',

  // ── Post-signature guidance (E1 done) ──
  'Settlement can take a few minutes — your position appears in Positions once the executor lands it on Flare.':
    'El settlement puede tardar unos minutos — tu posición aparece en Posiciones cuando el executor la asienta en Flare.',
  'Executed on Flare — your position is settled and appears in Positions.':
    'Ejecutado en Flare — tu posición está asentada y aparece en Posiciones.',
  'Awaiting execution on Flare — your XRP is safe at the Core Vault; this can take a few minutes.':
    'Esperando ejecución en Flare — tu XRP está seguro en el Core Vault; puede tardar unos minutos.',
  'If it stays pending for long, nothing is lost: the signed operation can always be executed later. Contact support with your transaction hash.':
    'Si sigue pendiente mucho rato, no se pierde nada: la operación firmada puede ejecutarse más tarde. Contacta soporte con el hash de tu transacción.',
  'Activate your protection': 'Activa tu protección',
  'The Protect template comes pre-filled with the thresholds you chose for this entry — editable before you activate it.':
    'La plantilla Protect llega pre-rellenada con los umbrales que elegiste para esta entrada — editables antes de activarla.',
  'Network fee (gas)': 'Comisión de red (gas)',
  'quoted by your wallet before signing': 'tu wallet la cotiza antes de firmar',

  // ── Positions board: PA actions + refresh + trigger history ──
  'Position actions': 'Acciones de la posición',
  'Re-supply (carry 2)': 'Re-suministrar (carry 2)',
  Withdraw: 'Retirar',
  'Repay now': 'Repagar ahora',
  'Unwind (DERISK)': 'Deshacer (DERISK)',
  'Refresh positions': 'Refrescar posiciones',
  triggers: 'disparos',
  last: 'último',
  'No triggers yet': 'Sin disparos todavía',

  // ── PA actions modal ──
  'Re-supply USDT0 — carry step 2': 'Re-suministrar USDT0 — paso 2 del carry',
  'Repay debt (protection)': 'Repagar deuda (protección)',
  'Withdraw to your EVM wallet': 'Retirar a tu wallet EVM',
  'This account has no FXRP collateral + USDT0 debt legs to repay.': 'Esta cuenta no tiene colateral FXRP + deuda USDT0 que repagar.',
  'The connected Xaman wallet does not control this Smart Account.': 'La wallet Xaman conectada no controla esta Smart Account.',
  'This Smart Account is controlled by your XRPL account': 'Esta Smart Account la controla tu cuenta XRPL',
  'The order is pinned to it — when Xaman opens, approve with that account (no need to reconnect).':
    'La orden va fijada a esa cuenta — cuando se abra Xaman, aprueba con ella (no hace falta reconectar).',
  'None of your linked XRPL accounts controls this Smart Account — the attempt will use the connected Xaman account and may be rejected.':
    'Ninguna de tus cuentas XRPL vinculadas controla esta Smart Account — se intentará con la Xaman conectada y puede ser rechazado.',
  'That account holds fewer shares than requested': 'Esa cuenta tiene menos shares de las pedidas',
  'Use MAX to withdraw the exact balance.': 'Usa MAX para retirar el balance exacto.',
  'Signs (pinned in the payload)': 'Firma (fijado en el payload)',
  'Enter a valid destination EVM address (0x…)': 'Introduce una dirección EVM de destino válida (0x…)',
  'Withdraw the re-supplied USDT0 to your EVM wallet': 'Retira el USDT0 re-suministrado a tu wallet EVM',
  'Repay the debt in FULL from your EVM wallet': 'Repaga la deuda COMPLETA desde tu wallet EVM',
  'Withdraw your FXRP collateral': 'Retira tu colateral FXRP',
  'FXRP collateral': 'Colateral FXRP',
  'USDT0 debt': 'Deuda USDT0',
  'Restore target HF': 'Restaurar HF objetivo',
  'Repay in full': 'Repagar todo',
  'Target Health Factor': 'Health Factor objetivo',
  'The USDT0 must already sit in your EVM wallet — withdraw it from the Personal Account first if needed.':
    'El USDT0 debe estar ya en tu wallet EVM — retíralo antes de la Personal Account si hace falta.',
  'use borrowed': 'usar lo prestado',
  'use supplied': 'usar lo suministrado',
  'use all': 'usar todo',
  'Destination EVM wallet': 'Wallet EVM de destino',
  'Where the capital goes': 'Adónde va el capital',
  'The funds leave from here — pick it to keep the capital in this same wallet.':
    'De aquí salen los fondos — elígela para dejar el capital en esta misma wallet.',
  'Leaves the vault and stays as free balance in this Smart Account.':
    'Sale del vault y se queda como saldo libre en esta Smart Account.',
  'Connected Xaman': 'Xaman conectada',
  'XRP to send (mint-coupled dispatch)': 'XRP a enviar (dispatch acoplado al mint)',
  'The 0xFE dispatch rides an XRPL Payment — this XRP also mints a small FXRP into your Smart Account. Disclosed before you sign.':
    'El dispatch 0xFE viaja en un Payment XRPL — ese XRP también acuña un poco de FXRP en tu Smart Account. Se muestra antes de firmar.',
  'Prepare (unsigned)': 'Preparar (sin firmar)',
  'Preparing the unsigned payload…': 'Preparando el payload sin firmar…',
  'Current HF': 'HF actual',
  'Target HF': 'HF objetivo',
  'Top-up needed': 'Falta por aportar',
  'Nothing to sign — the position is already at/above the target.': 'Nada que firmar — la posición ya está en o por encima del objetivo.',
  'Settlement can take a few minutes — refresh the board once the executor lands it on Flare.':
    'El settlement puede tardar unos minutos — refresca el tablero cuando el executor lo asiente en Flare.',
  'Continue to step': 'Continuar al paso',
  'Check your health': 'Revisa tu salud',
  'Astryum prepares unsigned payloads and discloses every number; you sign in your own wallet. It never signs or executes on its own.':
    'Astryum prepara payloads sin firmar y muestra cada número; tú firmas en tu propia wallet. Nunca firma ni ejecuta por su cuenta.',

  // ── Portfolio health panel (anchored empty state) ──
  'No positions conditioning your health right now': 'Ahora mismo no hay posiciones que condicionen tu salud',
  'Positions with debt appear here with their own health bar and exact liquidation price.':
    'Las posiciones con deuda aparecen aquí con su propia barra de salud y su precio exacto de liquidación.',

  // ── Home: empty-state CTA (address, 0 positions) ──
  'Your wallet is connected, but nothing is working yet': 'Tu wallet está conectada, pero nada está trabajando aún',
  'Open your first strategy — supply, stake or LP, always prepared for your signature.':
    'Abre tu primera estrategia — supply, stake o LP, siempre preparada para tu firma.',
  'Open your first strategy': 'Abre tu primera estrategia',

  // ── Intents page (the signing surface) ──
  'Prepared by your automation — review and sign in your wallet. Astryum never signs.':
    'Preparado por tu automatización — revisa y firma en tu wallet. Astryum nunca firma.',
  'Connect your EVM wallet to sign intents waiting for you.': 'Conecta tu wallet EVM para firmar los intents que te esperan.',
  'Connect wallet': 'Conectar wallet',
  'Signed — waiting for confirmation.': 'Firmado — esperando confirmación.',
  'Waiting for your signature': 'Esperando tu firma',
  'Automations leave prepared intents here when they fire — nothing signs until you do.':
    'Las automatizaciones dejan aquí los intents preparados cuando saltan — nada se firma hasta que firmas tú.',
  'Loading your intents…': 'Cargando tus intents…',
  'Nothing waiting for your signature': 'Nada esperando tu firma',
  'Automations leave prepared intents here when they fire.': 'Cuando una automatización salte, te dejará aquí la operación lista para firmar.',
  // ── Intents sidebar card ── ('more' and 'Close' already defined above)
  Sign: 'Firmar',
  'Review and sign': 'Revisa y firma',
  Expired: 'Caducado',
  'Expires in': 'Caduca en',
  'Signing…': 'Firmando…',
  'This intent has no signable payload': 'Este intent no tiene payload firmable',
  Dismiss: 'Descartar',
  Building: 'En construcción',
  Failed: 'Fallido',
  Broadcasting: 'Emitiendo',
  'In mempool': 'En mempool',
  Signed: 'Firmado',
  Harvest: 'Cosechar',
  'Exit liquidity': 'Salir de liquidez',
  'Add liquidity': 'Añadir liquidez',
  Swap: 'Swap',
  'Cross-chain swap': 'Swap cross-chain',
  Wrap: 'Wrap',
  Unwrap: 'Unwrap',
  Delegate: 'Delegar',
  Undelegate: 'Retirar delegación',
  'Claim rewards': 'Reclamar recompensas',

  // ── Partner vaults (Firelight stXRP · earnXRP · Monarq MXRPY) ──
  'Stake FXRP, receive stXRP': 'Haz stake de FXRP, recibe stXRP',
  'Deposit FXRP in the earnXRP vault': 'Deposita FXRP en el vault earnXRP',
  'Deposit FXRP with Monarq': 'Deposita FXRP con Monarq',
  'Your XRP becomes FXRP on Flare and is staked in Firelight — you receive stXRP 1:1, in the same vault behind the Xaman one-click flow. Per Firelight, staking rewards start in Phase 2 (not live yet).':
    'Tu XRP se convierte en FXRP en Flare y se hace stake en Firelight — recibes stXRP 1:1, en el mismo vault que usa el flujo one-click de Xaman. Según Firelight, las recompensas de staking empiezan en la Fase 2 (aún no activas).',
  "Your XRP becomes FXRP and is deposited into the Flare XRP Yield Vault — the same earnXRP vault D'CENT distributes, curated on-chain by Clearstar. You receive earnXRP; withdraw instantly for a 0.10% fee or free after the 24h epoch.":
    "Tu XRP se convierte en FXRP y se deposita en el Flare XRP Yield Vault — el mismo vault earnXRP que distribuye D'CENT, curado on-chain por Clearstar. Recibes earnXRP; retiras al instante con 0.10% de fee o gratis tras el epoch de 24h.",
  'Your XRP becomes FXRP and is deposited into the Monarq XRP Yield Vault (MXRPY). Its strategies run OFF-chain (options, basis) by Monarq Asset Management — manager risk you cannot verify on-chain. Withdrawals wait a 7-day epoch unless you pay the 0.30% instant fee.':
    'Tu XRP se convierte en FXRP y se deposita en el Monarq XRP Yield Vault (MXRPY). Sus estrategias corren OFF-chain (opciones, basis) gestionadas por Monarq Asset Management — riesgo de gestor que no puedes verificar on-chain. Los retiros esperan un epoch de 7 días salvo que pagues el 0.30% de retiro instantáneo.',
  staked: 'en stake',
  'liquid receipt': 'recibo líquido',
  'vault deposit': 'depósito en vault',
  'vault share price': 'precio del share',
  'off-chain strategies': 'estrategias off-chain',
  'Firelight staking vault ($66M TVL)': 'Vault de staking de Firelight ($66M TVL)',
  'Low — no debt, fully on-chain': 'Bajo — sin deuda, todo on-chain',
  'Phase 1 — not live yet (per Firelight)': 'Fase 1 — aún no activas (según Firelight)',
  'Upshift vault curated by Clearstar': 'Vault de Upshift curado por Clearstar',
  'Low-medium — on-chain strategies, live deposit cap': 'Bajo-medio — estrategias on-chain, cap de depósito en vivo',
  'Instant (0.10% fee) or free after 24h epoch': 'Instantáneo (0.10% fee) o gratis tras epoch de 24h',
  'Monarq vault on Upshift (CeDeFi)': 'Vault de Monarq sobre Upshift (CeDeFi)',
  'Medium — off-chain manager, not verifiable on-chain': 'Medio — gestor off-chain, no verificable on-chain',
  '7-day epoch, or instant with 0.30% fee': 'Epoch de 7 días, o instantáneo con 0.30% de fee',
  'Firelight stXRP vault (ERC-4626): FXRP deposited, stXRP minted to your Smart Account':
    'Vault stXRP de Firelight (ERC-4626): FXRP depositado, stXRP minteado a tu Smart Account',
  'Withdraw redeems stXRP back to FXRP via the vault claim flow':
    'El retiro redime stXRP de vuelta a FXRP vía el flujo de claim del vault',
  'earnXRP vault (Upshift): FXRP deposited, earnXRP shares minted to your Smart Account':
    'Vault earnXRP (Upshift): FXRP depositado, shares earnXRP minteadas a tu Smart Account',
  'Yield accrues in the vault share price (live on-chain, shown before signing)':
    'El yield se acumula en el precio del share del vault (en vivo on-chain, mostrado antes de firmar)',
  'Withdraw: instantRedeem (0.10% fee) or requestRedeem (free, 24h epoch)':
    'Retiro: instantRedeem (0.10% fee) o requestRedeem (gratis, epoch de 24h)',
  'Monarq vault (Upshift): FXRP deposited, MXRPY shares minted to your Smart Account':
    'Vault de Monarq (Upshift): FXRP depositado, shares MXRPY minteadas a tu Smart Account',
  'Monarq Asset Management runs options/basis strategies OFF-chain (manager risk)':
    'Monarq Asset Management ejecuta estrategias de opciones/basis OFF-chain (riesgo de gestor)',
  'Withdraw: requestRedeem (free, 7-day epoch) or instantRedeem (0.30% fee)':
    'Retiro: requestRedeem (gratis, epoch de 7 días) o instantRedeem (0.30% fee)',
  'The Monarq vault is temporarily unavailable on this server (feature flag).':
    'El vault de Monarq no está disponible temporalmente en este servidor (feature flag).',
  'This vault has deposits paused right now — try again later.':
    'Este vault tiene los depósitos pausados ahora mismo — inténtalo más tarde.',
  'The vault deposit cap does not fit this amount.':
    'El cap de depósito del vault no admite esta cantidad.',
  'Remaining capacity': 'Capacidad restante',
  'No loans, no debt, no liquidation. The live share price, cap and exit terms are read on-chain and shown before you sign.':
    'Sin préstamos, sin deuda, sin liquidación. El precio del share, el cap y las condiciones de salida se leen on-chain y se muestran antes de firmar.',
  'This vault runs OFF-chain strategies managed by Monarq Asset Management — returns are not verifiable on-chain, and withdrawals wait a 7-day epoch unless you pay the instant fee.':
    'Este vault ejecuta estrategias OFF-chain gestionadas por Monarq Asset Management — los retornos no son verificables on-chain y los retiros esperan un epoch de 7 días salvo que pagues el fee instantáneo.',
  'FXRP deposited': 'FXRP depositado',
  'Share price (protocol data)': 'Precio del share (dato del protocolo)',
  '30d APY (protocol data)': 'APY 30d (dato del protocolo)',
  source: 'fuente',
  'Rewards not live yet (Firelight Phase 1)': 'Recompensas aún no activas (Firelight Fase 1)',
  'see the live figure on the protocol': 'ver la cifra en vivo en el protocolo',
  'Vault capacity left': 'Capacidad restante del vault',
  'Withdrawal terms': 'Condiciones de retiro',
  // ── Vault withdraw (instant redemption) + estrategias individuales ──
  'In the vault': 'En el vault',
  'These shares live on your Smart Account — connect your XRPL wallet (Xaman) to withdraw them.':
    'Estas participaciones viven en tu Smart Account — conecta tu wallet XRPL (Xaman) para retirarlas.',
  'Destination EVM wallet (optional — empty keeps the FXRP in your Smart Account)':
    'Wallet EVM de destino (opcional — vacío deja el FXRP en tu Smart Account)',
  'Shares to redeem': 'Participaciones a redimir',
  'Share price (live)': 'Precio por participación (en vivo)',
  'Instant redemption fee': 'Fee de retiro instantáneo',
  'You receive (est.)': 'Recibes (est.)',
  'Value (est.)': 'Valor (est.)',
  "This position's in-app exit isn't wired yet — withdraw from the protocol's own app. Your funds are always under your wallet's control, never Astryum's.":
    'La salida in-app de esta posición aún no está cableada — retira desde la app del propio protocolo. Tus fondos siempre están bajo el control de tu wallet, nunca de Astryum.',
  'more inside': 'más dentro',
  'could not resolve the holding account': 'no se pudo resolver la cuenta que tiene la posición',
  // ── Rail EVM-directo (posiciones que viven en la propia wallet Flare) ──
  'your Flare wallet — signs directly': 'tu wallet Flare — firma directo',
  'This position lives in your own Flare wallet — you sign one call and the funds land right there. No Xaman, no mint.':
    'Esta posición vive en tu propia wallet Flare — firmas una sola llamada y los fondos aterrizan ahí mismo. Sin Xaman, sin mint.',
  'This position lives in your own Flare wallet — you sign the approve + supply calls directly. No Xaman, no mint.':
    'Esta posición vive en tu propia wallet Flare — firmas el approve + supply directamente. Sin Xaman, sin mint.',
  'Withdraw from wallet': 'Retirar desde la wallet',
  'Wallet of the position': 'Wallet de la posición',
  'Dispatch XRP (comes back to you as FXRP)': 'XRP del transporte (te vuelve como FXRP)',
  "NOT a fee and NOT the withdraw amount: the order must ride an XRPL Payment to the FAssets Core Vault (Xaman will show it, e.g. 1 XRP). It comes back to your Smart Account as FXRP minus the protocol's fees — minting max(0.1%, 0.1 XRP) + 0.2 XRP for the executor — with the exact figures shown before you sign. Nothing goes to Astryum or the vault manager.":
    'NO es una comisión ni el importe del retiro: la orden viaja en un Payment XRPL al Core Vault de FAssets (Xaman lo mostrará, p. ej. 1 XRP). Vuelve a tu Smart Account como FXRP menos las fees del protocolo — mint máx(0,1%, 0,1 XRP) + 0,2 XRP del executor — con las cifras exactas antes de firmar. Nada va a Astryum ni al gestor del vault.',
  '…returns to your Smart Account as': '…vuelve a tu Smart Account como',
  'From the PA (Xaman)': 'Desde el PA (Xaman)',
  'From your Flare wallet': 'Desde tu wallet de Flare',
  "Runs entirely inside your Smart Account — one Xaman signature, the executor pays the Flare gas. Funded from the PA's free USDT0 first, then your carry supply. No EVM wallet needed.":
    'Corre entero dentro de tu Smart Account — una firma en Xaman y el executor paga el gas de Flare. Se financia primero con el USDT0 libre del PA y después con tu supply del carry. Sin wallet EVM.',
  'Nothing to repay right now.': 'Nada que repagar ahora mismo.',
  'No EVM wallet? Repay from the Smart Account itself — sign in Xaman, the executor pays the gas.':
    '¿Sin wallet EVM? Repaga desde el propio Smart Account — firmas en Xaman y el executor paga el gas.',
  'Edit MoneyFlow': 'Editar MoneyFlow',
  '30d realized': 'realizado 30d',
  'Ladder (staggered protection)': 'Escalonado (protección por tramos)',
  'Several levels: as HF falls, each fires with its own repay — % of the LIVE debt at that moment, or a fixed amount.':
    'Varios escalones: según cae el HF, cada uno dispara con su propio repay — % de la deuda VIVA en ese momento, o un importe fijo.',
  '% of debt': '% de la deuda',
  '“% of debt” is computed over the LIVE debt when the level fires — never an amount frozen today.':
    'El "% de la deuda" se calcula sobre la deuda VIVA cuando el escalón dispara — nunca un importe congelado hoy.',
  'Create the ladder': 'Crear el escalonado',
  'Ladder created — its levels fire one by one as HF falls, each preparing a repay for YOU to sign.':
    'Escalonado creado — sus escalones disparan uno a uno según cae el HF, cada uno preparando un repay para que TÚ lo firmes.',
  'Add at least one ladder level.': 'Añade al menos un escalón.',
  'Protect ladder': 'Escalonado Protect',
  'Toggle between % of live debt and a fixed USDT0 amount': 'Alterna entre % de la deuda viva e importe fijo en USDT0',
  '% of live debt to repay': '% de la deuda viva a repagar',
  'at current rates': 'con las tasas actuales',
  'over your equity': 'sobre tu equity',
  'Stop-loss Health Factor': 'Health Factor de stop-loss',
  'Minimum (USD)': 'Mínimo (USD)',
  'Fixed repay amount': 'Importe fijo a repagar',
  'This rule has no editable threshold — only its cooldown can change here.':
    'Esta regla no tiene umbral editable — aquí solo puede cambiar cada cuánto te avisa.',
  // ── RuleEditModal humanizado (F1/F2/F9, 2026-07-30) ──
  'Alert me when my cushion (health factor) drops below':
    'Avísame cuando mi colchón (factor de salud) baje de',
  '1.00 = liquidation. When it fires, we prepare the repayment for YOU to sign.':
    '1,00 = liquidación. Cuando salte, te preparamos el pago para que TÚ lo firmes.',
  'Cautious (1.50)': 'Prudente (1,50)',
  'Balanced (1.25)': 'Equilibrado (1,25)',
  'Tight (1.10)': 'Al límite (1,10)',
  'Borrowed share — alert me above': 'Parte prestada — avísame si supera',
  'How much of your borrowing limit you are using. Above 80% liquidation risk is high.':
    'Cuánto de tu límite de préstamo estás usando. Por encima del 80 % el riesgo de liquidación es alto.',
  'Enter a value between': 'Escribe un valor entre',
  'You typed': 'Has escrito',
  'Could not save the changes. Nothing was modified — try again in a minute.':
    'No se han podido guardar los cambios. No se ha modificado nada — inténtalo en un minuto.',
  'Saving moves no money and signs nothing. When the rule fires, we will ask YOU to sign.':
    'Guardar no mueve dinero ni firma nada. Cuando la regla salte, te pediremos que firmes TÚ.',
  'Minimum wait between alerts': 'Espera mínima entre avisos',
  'This rule watches the fixed critical level (health factor 1.2) — that number cannot change, by design. You can only adjust how often it alerts you.':
    'Esta regla vigila el nivel crítico fijo (factor de salud 1,2) — ese número no se puede cambiar, por diseño. Solo puedes ajustar cada cuánto te avisa.',
  'invalid threshold — edit and save this rule to fix it':
    'umbral inválido — edita y guarda esta regla para arreglarla',
  "NOT a fee and NOT the repay amount: the order must ride an XRPL Payment to the FAssets Core Vault (Xaman will show it, e.g. 1 XRP). It comes back to your Smart Account as FXRP minus the protocol's fees — minting max(0.1%, 0.1 XRP) + 0.2 XRP for the executor — with the exact figures shown before you sign. Nothing goes to Astryum or the vault manager.":
    'NO es una comisión ni el importe del repay: la orden viaja en un Payment XRPL al Core Vault de FAssets (Xaman lo mostrará, p. ej. 1 XRP). Vuelve a tu Smart Account como FXRP menos las fees del protocolo — mint máx(0,1%, 0,1 XRP) + 0,2 XRP del executor — con las cifras exactas antes de firmar. Nada va a Astryum ni al gestor del vault.',
  // ── Vault claim (release the Firelight ~24h exit queue) ──
  'Waiting in the exit queue': 'Esperando en la cola de salida',
  'amount released at claim': 'importe liberado al reclamar',
  'period': 'periodo',
  'The withdrawal period ended — this releases the FXRP straight to your wallet. Claiming pays only gas; the exit fee was already taken at redeem.':
    'El periodo de retiro terminó — esto libera el FXRP directo a tu wallet. Reclamar solo paga gas; la fee de salida ya se cobró en el redeem.',
  'Not ready yet — the withdrawal period is still running.':
    'Aún no está listo — el periodo de retiro sigue en curso.',
  'Claimable from': 'Reclamable desde',
  'Not ready yet — claimable from': 'Aún no está listo — reclamable desde',
  "This exit was queued from your Smart Account, so the claim rides a 0xFE userOp: it must carry an XRPL Payment to the FAssets Core Vault (Xaman will show it, e.g. 1 XRP). It comes back to your Smart Account as FXRP minus the protocol's fees, with the exact figures shown before you sign. Nothing goes to Astryum.":
    'Esta salida se encoló desde tu Smart Account, así que el claim viaja en un userOp 0xFE: debe llevar un Payment XRPL al Core Vault de FAssets (Xaman lo mostrará, p. ej. 1 XRP). Vuelve a tu Smart Account como FXRP menos las fees del protocolo, con las cifras exactas antes de firmar. Nada va a Astryum.',
  'This exit was queued from your Smart Account — connect your XRPL wallet (Xaman) to claim it.':
    'Esta salida se encoló desde tu Smart Account — conecta tu wallet XRPL (Xaman) para reclamarla.',
  'Available when the period ends': 'Disponible cuando termine el periodo',
  // ── Intents card: money in flight ──
  'To sign': 'Para firmar',
  'In flight': 'En camino',
  'ready to release': 'listo para liberar',
  'arrives': 'llega',
  'when the period ends': 'cuando termine el periodo',
  'Release the FXRP to your account': 'Libera el FXRP a tu cuenta',
  'Withdrawal period': 'Periodo de retiro',
  'Shares queued': 'Participaciones en cola',
  'Queued for release': 'En cola para salir',
  'Claim submitted for settlement': 'Claim enviado a liquidación',
  'ready': 'listo',
  'in the exit queue': 'en la cola de salida',
  'You have FXRP ready to claim': 'Tienes FXRP listo para reclamar',
  'exits ready to claim': 'salidas listas para reclamar',
  'Complete the borrow (carry)': 'Completar el borrow (carry)',
  'This position has FXRP collateral but no USDT0 borrow — the entry stopped halfway. This prepares ONLY the missing borrow against the collateral already supplied.':
    'Esta posición tiene colateral FXRP pero ningún borrow de USDT0 — la entrada se quedó a medias. Esto prepara SOLO el borrow que falta contra el colateral ya aportado.',
  'Borrow ratio (of the borrowing capacity)': 'Ratio de préstamo (sobre la capacidad)',
  'Connect the Flare wallet that holds this position to sign.':
    'Conecta la wallet Flare que tiene esta posición para firmar.',
  'MAX keeps 1 FLR back for gas — the wrap and delegate calls pay fees from this same balance.':
    'MAX se guarda 1 FLR para gas — las llamadas de wrap y delegate pagan fees de este mismo saldo.',
  'Withdraw releases the escrow with an EscrowFinish you sign in Xaman — the XRP always goes to its destination.':
    'Retirar libera el escrow con un EscrowFinish que firmas en Xaman — el XRP siempre va a su destino.',
  instant: 'instantáneo',
  'free after': 'gratis tras',
  'redeem via vault claim flow': 'redimir vía el flujo de claim del vault',
  'Risk profile': 'Perfil de riesgo',
  'CeDeFi — off-chain manager': 'CeDeFi — gestor off-chain',
  'None — plain deposit': 'Ninguno — depósito simple',
  'Your XRP Payment is signed. FXRP mint + the vault deposit settle on Flare via the executor — the vault shares land in your Smart Account.':
    'Tu Payment XRP está firmado. El mint de FXRP + el depósito en el vault liquidan en Flare vía el executor — las shares del vault llegan a tu Smart Account.',
  'Six strategies live on Flare mainnet, ready to start. See exactly what each one does with your tokens.':
    'Seis estrategias vivas en Flare mainnet, listas para empezar. Ve exactamente qué hace cada una con tus tokens.',
  'Pick a created strategy or create one with text. Six strategies live on mainnet, in beta testing.':
    'Elige una estrategia creada o crea una con texto. Seis estrategias vivas en mainnet, en beta.',
  'Watch-only · other chains': 'Solo lectura · otras chains',
  // ── Wallets — Send / Receive (per-wallet transfer + address QR) ──
  'Prepare a transfer you sign in your own wallet': 'Prepara una transferencia que firmas en tu propia wallet',
  'Show this address as a QR code': 'Muestra esta dirección como código QR',
  'this network': 'esta red',
  'Send only assets on': 'Envía solo activos de',
  'to this address. Assets sent from other networks would be lost.':
    'a esta dirección. Los activos enviados desde otras redes se perderían.',
  From: 'Desde',
  To: 'Hacia',
  Destination: 'Destino',
  'My wallets': 'Mis wallets',
  'External address': 'Dirección externa',
  // 'Available' ya existe arriba (misma traducción) — no duplicar la clave.
  'XRPL keeps a 1 XRP base reserve locked in the sending account.':
    'XRPL mantiene bloqueada una reserva base de 1 XRP en la cuenta emisora.',
  'Prepare transfer': 'Preparar transferencia',
  'Network fee': 'Comisión de red',
  // ── R5: todos los cargos antes de firmar (2026-07-30) ──
  'your wallet shows the exact figure before signing':
    'tu wallet muestra la cifra exacta antes de firmar',
  'The withdrawal period ended — this releases the FXRP straight to your wallet. The only cost is the network fee (cents; your wallet shows the exact figure before signing). The exit fee was already taken when you requested the withdrawal — nothing else is charged.':
    'El plazo de salida ha terminado — al confirmar, el FXRP pasa directo a tu wallet. El único coste es la comisión de red (céntimos; tu wallet muestra la cifra exacta antes de firmar). La comisión de salida ya se cobró al solicitar la retirada — no se cobra nada más.',
  'Astryum fee': 'Comisión de Astryum',
  'we charge nothing': 'no cobramos nada',
  'Real money · product in testing': 'Dinero real · producto en pruebas',
  // ── Withdraw con destino XRPL en el selector + dispatch explicado (30-jul) ──
  'This account is steered from your XRPL wallet, so every order travels on a small XRP payment — that payment IS your signature.':
    'Esta cuenta se gobierna desde tu wallet XRPL, así que cada orden viaja en un pequeño pago de XRP — ese pago ES tu firma.',
  'It is not lost: it comes back to you as FXRP. Net cost ≈ 0.3 XRP — exact figures before signing. Nothing goes to Astryum.':
    'No se pierde: te vuelve como FXRP. Coste neto ≈ 0,3 XRP — cifras exactas antes de firmar. Nada va a Astryum.',
  'Arrives as NATIVE XRP (minutes to hours) — 5 XRP minimum.':
    'Llega como XRP NATIVO (de minutos a horas) — mínimo 5 XRP.',
  'Withdraws and converts in ONE signature — the XRP arrives at your XRPL wallet in minutes to hours.':
    'Retira y convierte en UNA firma — el XRP llega a tu wallet XRPL en minutos u horas.',
  'Native XRP can only go to the XRPL wallet that owns this account.':
    'El XRP nativo solo puede ir a la wallet XRPL dueña de esta cuenta.',
  'Sending from your Astryum account to a Flare address is not wired here yet — use Withdraw on your position instead.':
    'Enviar desde tu cuenta Astryum a una dirección de Flare todavía no está cableado aquí — usa Retirar en tu posición.',
  'Travels inside the': 'Viaja dentro del pago de',
  'dispatch (your signature) — net cost ≈ 0.3 XRP; the rest returns to your account as FXRP.':
    'de transporte (tu firma) — coste neto ≈ 0,3 XRP; el resto vuelve a tu cuenta como FXRP.',
  'Keep it on Flare (instant)': 'Dejarlo en Flare (al instante)',
  'To my XRP wallet (minutes to hours)': 'A mi wallet XRP (minutos a horas)',
  // ── Reserva de gobierno XRPL (trampa del mint-total, 30-jul) ──
  'This would leave your XRPL wallet almost empty. Your Astryum account is steered FROM it — every order needs ~1 XRP of carrier payment. Keep at least ~2 XRP or you will not be able to withdraw or convert until you refund it from outside.':
    'Esto dejaría tu wallet XRPL casi vacía. Tu cuenta Astryum se gobierna DESDE ella — cada orden necesita ~1 XRP de transporte. Deja al menos ~2 XRP o no podrás retirar ni convertir hasta que la fondees desde fuera.',
  'MAX keeps ~2 XRP back — your Astryum account is steered from this wallet and every order needs a small XRP payment.':
    'MAX se guarda ~2 XRP — tu cuenta Astryum se gobierna desde esta wallet y cada orden necesita un pequeño pago de XRP.',
  'The account that signs is your XRPL wallet':
    'La cuenta que firma es tu wallet XRPL',
  'send it ~2 XRP (from an exchange or another wallet) and come back. Your money on Flare is untouched.':
    'envíale ~2 XRP (desde un exchange u otra wallet) y vuelve. Tu dinero en Flare sigue intacto.',
  // ── CmfReviewModal humanizado (Fase 3, 2026-07-30) ──
  'Drafted by the assistant. Watching is free and touches nothing — when it fires, we will ask YOU to sign.':
    'Redactado por el asistente. Vigilar es gratis y no toca nada — cuando salte, te pediremos que firmes TÚ.',
  'Turn on the watch (nothing is signed now)': 'Activar la vigilancia (ahora no se firma nada)',
  // ── R9 APY como dato (Fase 3, 2026-07-30) ──
  'current protocol figure': 'dato actual del protocolo',
  'If the rate held (it is not guaranteed — it changes constantly), this is what simple interest would add, before fees and price moves. It is not an offer, a promise, or an Astryum yield.':
    'Si el tipo se mantuviera (no está garantizado — cambia constantemente), esto es lo que sumaría el interés simple, antes de comisiones y movimientos de precio. No es una oferta, ni una promesa, ni un rendimiento de Astryum.',
  'Ready-made strategies live on mainnet. Open one to see exactly what it does with your tokens before you sign anything.':
    'Estrategias listas funcionando en mainnet. Abre una para ver exactamente qué hace con tus tokens antes de firmar nada.',
  // ── templateCatalog por t() (Fase 3, 2026-07-30) ──
  'Defends your position: if your cushion (health factor) drops below your threshold, Astryum prepares the repayment for you to sign.':
    'Defiende tu posición: si tu colchón (factor de salud) baja de tu umbral, Astryum te prepara el pago para que lo firmes.',
  'Repay only just enough to restore the cushion': 'Devolver solo lo justo para restaurar el colchón',
  'When it fires, it computes live the smallest repayment that lifts your cushion back to your target. Turn it off to use a fixed amount instead.':
    'Cuando salte, calcula en vivo el pago mínimo que devuelve tu colchón a tu objetivo. Desactívalo para usar un importe fijo.',
  'Fixed amount to repay': 'Importe fijo a devolver',
  'Only used when the restore mode is off.': 'Solo se usa con el modo de restauración desactivado.',
  'The minimum time between two alerts.': 'El tiempo mínimo entre dos avisos.',
  'Compounds your yield: when your claimable rewards pass your threshold, Astryum prepares the claim for you to sign.':
    'Reinvierte tu rendimiento: cuando tus recompensas cobrables superan tu umbral, Astryum te prepara el cobro para que lo firmes.',
  'Minimum rewards': 'Recompensas mínimas',
  'Fires when your claimable rewards exceed this value.':
    'Salta cuando tus recompensas cobrables superan este valor.',
  'Rewards are paid out roughly every 3.5 days — a long wait avoids empty alerts.':
    'Las recompensas se reparten más o menos cada 3,5 días — una espera larga evita avisos vacíos.',
  'Automatically reinvest what you earn': 'Reinvertir automáticamente lo que ganes',
  'Your rewards go back into the position, already working and voting again — nothing for you to do.':
    'Tus recompensas vuelven a la posición, ya trabajando y votando otra vez — sin que tengas que hacer nada.',
  // ── describeRule compartido (Fase 3, 2026-07-30) ──
  'If your cushion (health factor) drops below': 'Si tu colchón (factor de salud) baja de',
  'If the borrowed share goes above': 'Si la parte prestada supera el',
  'When your rewards exceed': 'Cuando tus recompensas superen',
  'When idle': 'Cuando el saldo parado de',
  'exceeds': 'supere',
  'On a schedule': 'Según calendario',
  'Every day at 12:00 UTC': 'Cada día a las 12:00 UTC',
  'Every Monday at 12:00 UTC': 'Cada lunes a las 12:00 UTC',
  'On the 1st of each month at 12:00 UTC': 'El día 1 de cada mes a las 12:00 UTC',
  'If the rate you are paid drops below': 'Si el interés que te pagan baja del',
  'we prepare a repayment for you to sign': 'te preparamos el pago para que lo firmes',
  'we prepare a withdrawal for you to sign': 'te preparamos la retirada para que la firmes',
  'we prepare a deposit for you to sign': 'te preparamos el depósito para que lo firmes',
  'we prepare the rewards claim for you to sign': 'te preparamos el cobro de recompensas para que lo firmes',
  'we prepare the reinvestment for you to sign': 'te preparamos la reinversión para que la firmes',
  'we prepare the harvest for you to sign': 'te preparamos la cosecha para que la firmes',
  'we prepare the delegation for you to sign': 'te preparamos la delegación para que la firmes',
  'we prepare the savings lock for you to sign': 'te preparamos el apartado de ahorro para que lo firmes',
  'a payment proposal goes to the council to sign': 'una propuesta de pago va al consejo para firmar',
  'a vault order proposal goes to the council to sign': 'una propuesta de orden al vault va al consejo para firmar',
  'you get an alert — nothing is prepared': 'recibes un aviso — no se prepara nada',
  'we prepare it for you to sign': 'te lo preparamos para que lo firmes',
  // ── PreflightNotice sin jerga (Fase 2b, 2026-07-30) ──
  "We couldn't test this operation in advance — double-check the figures before signing.":
    'No hemos podido probar esta operación por adelantado — repasa las cifras antes de firmar.',
  'We tested this operation without signing it — it would FAIL:':
    'Hemos probado esta operación sin firmarla — FALLARÍA:',
  'We tested this operation without signing it — it would succeed':
    'Hemos probado esta operación sin firmarla — saldría bien',
  'Partial dry-run:': 'Comprobación parcial:',
  'what could be simulated would succeed — one leg could not be checked.':
    'lo que se pudo simular saldría bien — una parte no se pudo comprobar.',
  'steps verifiable before signing': 'pasos verificables antes de firmar',
  'the simulation reported a failure': 'la simulación devolvió un fallo',
  // ── settlementReasonText (Fase 2b, 2026-07-30) ──
  'The batch failed on the network — your money did not move.':
    'El lote falló en la red — tu dinero no se ha movido.',
  'Your wallet does not let us confirm automatically — open it and check with the receipt below.':
    'Tu wallet no nos deja confirmarlo automáticamente — ábrela y compruébalo con el recibo de abajo.',
  'The network rejected the transaction. Your money did not move; only the network fee was spent.':
    'La red rechazó la transacción. Tu dinero no se ha movido; solo se gastó la comisión de red.',
  'Batch step': 'El paso',
  'of the batch was rejected by the network — nothing was applied.':
    'del lote fue rechazado por la red — no se aplicó nada.',
  // ── Léxico R3 de intenciones y CTAs (Fase 2b, 2026-07-30) ──
  'Review before signing': 'Ver el resumen antes de firmar',
  'Close the position, step by step': 'Cerrar la posición paso a paso',
  'Deposit the borrowed dollars again': 'Volver a depositar los dólares prestados',
  'Convert to XRP': 'Pasar a XRP',
  'Complete the borrow': 'Completar el préstamo',
  'Put the borrowed dollars back to work': 'Poner los dólares prestados a trabajar otra vez',
  'Repay your loan': 'Devolver tu préstamo',
  'Withdraw funds': 'Retirar fondos',
  'your Astryum account — you sign in Xaman': 'tu cuenta Astryum — firmas en Xaman',
  'Get back the dollars you had re-deposited': 'Recuperar los dólares que habías vuelto a depositar',
  'Pay off the whole loan': 'Pagar el préstamo entero',
  'Recover the XRP backing your position': 'Recuperar el XRP que respalda tu posición',
  'In your Astryum account this step signs together with step 2: the repay takes back the re-deposited dollars by itself, inside the same Xaman signature.':
    'En tu cuenta Astryum este paso se firma junto al paso 2: el repago recupera él solo los dólares re-depositados, dentro de la misma firma de Xaman.',
  'Skip to step': 'Saltar al paso',
  'You are about to repay': 'Vas a devolver',
  'of your loan on Kinetic.': 'de tu préstamo en Kinetic.',
  'You are about to deposit': 'Vas a depositar',
  'back into Kinetic.': 'de vuelta en Kinetic.',
  'You are about to convert': 'Vas a convertir',
  'into XRP, on its way to your XRPL wallet.': 'a XRP, en camino a tu wallet XRPL.',
  'You are about to withdraw': 'Vas a retirar',
  'from Kinetic to your wallet.': 'de Kinetic a tu wallet.',
  // ── Éxitos veraces + settling (Fase 2, 2026-07-30) ──
  'Keep waiting in the background': 'Seguir esperando en segundo plano',
  'Claim confirmed — your XRP is on its way to your XRPL wallet (minutes to hours).':
    'Cobro confirmado — tu XRP está en camino a tu wallet XRPL (de minutos a horas).',
  'Request registered. Your money enters the ~24h exit queue — a Claim button will appear when it is ready.':
    'Solicitud registrada. Tu dinero entra en la cola de salida de ~24 h — aparecerá un botón para cobrarlo cuando esté listo.',
  'Done. Your debt is paid down.': 'Listo. Tu deuda está pagada.',
  'Done. The funds are back in your account.': 'Listo. Los fondos están de vuelta en tu cuenta.',
  'Done. Your XRP is on its way to your XRPL wallet (minutes to hours).':
    'Listo. Tu XRP está en camino a tu wallet XRPL (de minutos a horas).',
  'See how your position looks now': 'Ver cómo queda tu posición',
  'Your XRP will appear on Flare as FXRP in a few minutes. Sometimes it takes a little longer — it is never lost.':
    'Tu XRP aparecerá en Flare como FXRP en unos minutos. A veces tarda algo más — nunca se pierde.',
  // ── Intents/firma (Fase 2, 2026-07-30) ──
  'Being prepared': 'Preparándose',
  'Sending to the network': 'Enviándose a la red',
  'On its way to the network': 'En camino a la red',
  'This operation cannot be signed yet.': 'Esta operación todavía no se puede firmar.',
  // ── Settlement en-vuelo (Fase 2, 2026-07-30): titulares que faltaban en ES ──
  'Settled on Flare — confirmed on-chain.': 'Confirmado en la red de Flare.',
  'The signed operation failed on-chain.': 'La red rechazó la operación firmada.',
  'Taking longer than normal — still watching the chain. Nothing is lost.':
    'Está tardando más de lo normal — seguimos vigilando la red. No se ha perdido nada.',
  'Signed — settling on Flare…': 'Firmado — confirmando en la red…',
  'Still settling on Flare…': 'Todavía confirmándose en la red…',
  'You signed this before the reload. We are still watching it:':
    'Firmaste esto antes de recargar. Seguimos vigilándolo:',
  'Result of what you signed before the reload:':
    'Resultado de lo que firmaste antes de recargar:',
  'Only hides this notice — the operation keeps going on-chain.':
    'Solo oculta este aviso — la operación sigue su curso en la red.',
  // ── DispatchXrpField (F12, 2026-07-30) ──
  'The order travels on a small XRP payment': 'La orden viaja en un pequeño pago de XRP',
  'it comes back to you as FXRP minus the protocol fees. You will see the exact figures before signing. Nothing goes to Astryum.':
    'te vuelve como FXRP menos las comisiones del protocolo. Verás las cifras exactas antes de firmar. Nada va a Astryum.',
  'Adjust the carrier payment (advanced)': 'Ajustar el pago de transporte (avanzado)',
  // ── Swap-fill: elección obligatoria (founder 2026-07-31) ──
  'You are short': 'Te faltan',
  'choose how to cover it: swap YOUR own asset inside the same batch you sign (wallet → pool → wallet; Astryum only compiles), or repay without the swap and cover the rest yourself. The transaction is built one way or the other — the signature unlocks when you pick:':
    'elige cómo cubrirlo: swapear TU propio activo dentro del mismo lote que firmas (wallet → pool → wallet; Astryum solo compila), o repagar sin swap y poner tú el resto. La transacción se construye de una forma o de otra — la firma se desbloquea al elegir:',
  'Pay with swapped': 'Pagar con el swap de',
  'Do not pay with a swap': 'No pagar con swap',
  'repay only what you already hold': 'repagar solo con lo que ya tienes',
  'Right now this account holds no USDT0 — without the swap there is nothing to repay. Bring USDT0 to it (or repay from your Flare wallet) and come back.':
    'Ahora mismo esta cuenta no tiene USDT0 — sin el swap no hay nada que repagar. Hazle llegar USDT0 (o repaga desde tu wallet de Flare) y vuelve.',
  'The missing USDT0 stays as YOUR debt after signing: you cover it later with USDT0 you bring yourself, and the FXRP collateral cannot leave until the whole debt is at zero.':
    'El USDT0 que falta sigue siendo TU deuda tras firmar: lo cubres después con USDT0 que traigas tú, y el colateral FXRP no puede salir hasta que toda la deuda esté a cero.',
  'First choose how to cover the missing USDT0 — pick one of the options above and the signature unlocks.':
    'Primero elige cómo cubrir el USDT0 que falta — marca una de las opciones de arriba y se desbloquea la firma.',
  'you hold': 'tienes',
  'not enough balance': 'saldo insuficiente',
  'No SparkDEX route quotes this amount right now.': 'Ninguna ruta de SparkDEX cotiza este importe ahora mismo.',
  'Remove the fill (repay only what you hold)': 'Quitar el swap (repagar solo con lo que tienes)',
  "NOT a fee and NOT the amount of your operation: the order must ride an XRPL Payment to the FAssets Core Vault (Xaman will show it). It returns to your account as FXRP minus the protocol's fees — minting max(0.1%, 0.1 XRP) + 0.2 XRP for the executor.":
    'NO es una comisión ni el importe de tu operación: la orden viaja en un Payment XRPL al Core Vault de FAssets (Xaman lo mostrará). Vuelve a tu cuenta como FXRP menos las comisiones del protocolo — mint máx(0,1 %, 0,1 XRP) + 0,2 XRP del executor.',
  // ── XamanQRModal (F6, 2026-07-30): estados terminales + countdown + i18n ──
  'Review the operation in the app and approve it. It reaches the network only with your signature.':
    'Revisa la operación en la app y apruébala. Se envía a la red solo con tu firma.',
  'Connect Xaman': 'Conectar Xaman',
  'Scan the code and approve the sign-in. No funds move.':
    'Escanea el código y aprueba el inicio de sesión. No se mueve ningún fondo.',
  'Sign the message': 'Firma el mensaje',
  'Approve the signature in the app. It is an ownership proof: it moves no funds.':
    'Aprueba la firma en la app. Es una prueba de titularidad: no mueve fondos.',
  'You declined the signature in Xaman. Nothing happened and nothing moved.':
    'Has rechazado la firma en Xaman. No ha pasado nada y no se ha movido nada.',
  'The code expired. Nothing was signed. Close this window and try again whenever you like.':
    'El código ha caducado. No se ha firmado nada. Cierra esta ventana y vuelve a intentarlo cuando quieras.',
  'QR code to sign in Xaman': 'Código QR para firmar en Xaman',
  'QR unavailable — use “Open in Xaman”.': 'QR no disponible — usa «Abrir en Xaman».',
  'Signed — sending to the network…': 'Firmado — enviando a la red…',
  'Signed in.': 'Sesión confirmada.',
  'Signature received. Nothing is sent to the network.':
    'Firma recibida. No se envía nada a la red.',
  'Open in Xaman — review and approve': 'Abierto en Xaman — revisa y aprueba',
  'Request sent to your Xaman — open it from the notification on your phone. The QR works too.':
    'Solicitud enviada a tu Xaman — ábrela desde la notificación del móvil. El QR también vale.',
  'No push this time — scan the QR with Xaman. Push notifications activate after you sign once from this browser.':
    'Esta vez sin aviso en el móvil — escanea el QR con Xaman. Los avisos push se activan tras firmar una vez desde este navegador.',
  'Opening Xaman…': 'Abriendo Xaman…',
  'Waiting for your signature in Xaman…': 'Esperando tu firma en Xaman…',
  'Open in Xaman': 'Abrir en Xaman',
  'Time left before this code expires': 'Tiempo restante antes de que caduque este código',
  'Astryum never signs and never holds custody. The key is yours and the signature happens in Xaman.':
    'Astryum no firma ni custodia. La clave es tuya y la firma ocurre en Xaman.',
  // ── Fijar beneficiarios del rendimiento (F5, 2026-07-30) ──
  'Set the payees (who receives the yield)': 'Fijar los beneficiarios (quién recibe el rendimiento)',
  'Payee (Flare 0x…)': 'Beneficiario (Flare 0x…)',
  'Share (%)': 'Parte (%)',
  'Add payee': 'Añadir beneficiario',
  'Add at least one payee.': 'Añade al menos un beneficiario.',
  'Every payee must be a Flare address (0x…).': 'Cada beneficiario debe ser una dirección de Flare (0x…).',
  'Every payee needs a share greater than 0%.': 'Cada beneficiario necesita una parte mayor que 0 %.',
  'The shares add up to more than 100%': 'Las partes suman más del 100 %',
  'The yield is shared out in these proportions. What is not assigned keeps capitalizing into the principal.':
    'El rendimiento se reparte en estas proporciones. Lo que no se asigne sigue capitalizando en el principal.',
  'This Legacy has no payees set, so ALL yield capitalizes back into the principal. To share it out, the council sends the governed order "Set the payees (who receives the yield)" from the Proposals tab.':
    'Este Legacy no tiene beneficiarios fijados, así que TODO el rendimiento capitaliza de vuelta en el principal. Para repartirlo, el consejo envía la orden gobernada «Fijar los beneficiarios (quién recibe el rendimiento)» desde la pestaña Proposals.',
  'Astryum built this payload unsigned. You review and sign it in your own wallet — nothing moves without your signature.':
    'Astryum construyó este payload sin firmar. Lo revisas y firmas en tu propia wallet — nada se mueve sin tu firma.',
  'This transfer signs in Xaman (XRPL)': 'Esta transferencia se firma en Xaman (XRPL)',
  'This transfer signs in your EVM wallet (Flare)': 'Esta transferencia se firma en tu wallet EVM (Flare)',
  'The wallet connected in your wallet app is a different account. Switch to':
    'La wallet conectada en tu app es otra cuenta. Cambia a',
  'and reconnect.': 'y reconecta.',
  'The required wallet is not connected. Connect it to sign this transfer.':
    'La wallet necesaria no está conectada. Conéctala para firmar esta transferencia.',
  'Sign in Xaman…': 'Firma en Xaman…',
  'Sign in your wallet…': 'Firma en tu wallet…',
  'Sign in your wallet': 'Firmar en tu wallet',
  'Transfer signed and submitted': 'Transferencia firmada y enviada',
  'Choose a destination': 'Elige un destino',
  'Enter a valid XRPL address (r…)': 'Introduce una dirección XRPL válida (r…)',
  'Enter a valid EVM address (0x…)': 'Introduce una dirección EVM válida (0x…)',
  'Destination is this same wallet': 'El destino es esta misma wallet',
  'Transfers in this beta support Flare (FLR) and XRPL (XRP) wallets only.':
    'Las transferencias en esta beta solo soportan wallets de Flare (FLR) y XRPL (XRP).',
  'This wallet stays read-only here for now.': 'Esta wallet se queda en solo-lectura aquí por ahora.',
  // Shared with the Earn demo hand-off (same signer prompts)
  'Building unsigned payload…': 'Construyendo payload sin firmar…',
  'Connect Xaman (XRPL)': 'Conectar Xaman (XRPL)',
  'Connect EVM wallet': 'Conectar wallet EVM',
  'Connect your XRPL wallet (Xaman) to continue': 'Conecta tu wallet XRPL (Xaman) para continuar',
  'Connect your EVM wallet (Flare) to continue': 'Conecta tu wallet EVM (Flare) para continuar',
  // ── Earn — selector de wallet firmante (Xaman mint vs Flare directo) ──
  'Signing wallet': 'Wallet firmante',
  'This wallet spends its FXRP directly on Flare — no XRPL mint, no minting fee.':
    'Esta wallet usa su FXRP directamente en Flare — sin mint desde XRPL, sin fee de minteo.',
  'This wallet pays XRP — minted 1:1 into FXRP on Flare before entering.':
    'Esta wallet paga XRP — se mintea 1:1 a FXRP en Flare antes de entrar.',
  'No linked wallet can sign this entry': 'Ninguna wallet vinculada puede firmar esta entrada',
  'Connect a wallet and it will be linked to your Astryum account on the spot.':
    'Conecta una wallet y quedará vinculada a tu cuenta de Astryum al momento.',
  'Open Xaman with this exact account to sign this entry.':
    'Abre Xaman con esta cuenta exacta para firmar esta entrada.',
  'Your connected EVM account is different — reconnect with the selected wallet to sign.':
    'Tu cuenta EVM conectada es otra — reconecta con la wallet seleccionada para firmar.',
  'Link or connect a wallet that can sign this entry to continue':
    'Vincula o conecta una wallet que pueda firmar esta entrada para continuar',
  'FXRP from your wallet': 'FXRP desde tu wallet',
  'None — no XRPL mint': 'Ninguno — sin mint desde XRPL',
  'That wallet does not hold enough FXRP for this amount.':
    'Esa wallet no tiene suficiente FXRP para este importe.',
  'Signed from your Flare wallet — no XRPL mint. The position lands directly in that wallet and appears in Positions once the transaction confirms.':
    'Firmado desde tu wallet Flare — sin mint desde XRPL. La posición aterriza directamente en esa wallet y aparece en Posiciones en cuanto la transacción confirma.',
  // Claves del modal que faltaban del dict (se veían en inglés)
  'Connect the required wallet above to prepare this entry':
    'Conecta la wallet necesaria arriba para preparar esta entrada',
  'Prepare intent': 'Preparar intent',
  'Sign in wallet': 'Firmar en wallet',
  'Submitted for settlement': 'Enviado a liquidación',
  'You pay (gross)': 'Pagas (bruto)',
  'Minting fee': 'Fee de minteo',
  'FXRP supplied': 'FXRP aportado',
  'Calls to sign': 'Llamadas a firmar',
  'Smart Account': 'Smart Account',
  'Health Factor at entry': 'Health Factor de entrada',
  'Available Balance': 'Saldo disponible',
  'locked as XRPL reserve (not spendable)': 'bloqueados como reserva XRPL (no gastables)',
  'Balance hidden — showing Flare only for now': 'Saldo oculto — de momento solo mostramos Flare',

  // ── Wallets — bridge XRP ⇄ Flare (FAssets mint / redeem) ──
  'Enter a valid destination address (r… or 0x…)': 'Introduce una dirección de destino válida (r… o 0x…)',
  'Cross-network: you pay XRP and the destination receives FXRP on Flare (FAssets mint). Mint fees are deducted from the payment.':
    'Cruce de red: pagas XRP y el destino recibe FXRP en Flare (mint de FAssets). Las fees del mint se descuentan del pago.',
  'Cross-network: burns FXRP from this wallet and a FAssets agent pays the XRP to the XRPL destination (redeem).':
    'Cruce de red: se quema FXRP de esta wallet y un agente de FAssets paga el XRP a la dirección XRPL (redeem).',
  'Mint fee': 'Fee de mint',
  'Executor fee': 'Fee del executor',
  'Destination receives': 'El destino recibe',
  'On-chain minimum': 'Mínimo on-chain',
  'The FXRP lands on Flare once the permissionless executor finalizes the mint — rate limits can delay it, never reject it.':
    'El FXRP llega a Flare cuando el executor permissionless finaliza el mint — los límites de tasa pueden retrasarlo, nunca rechazarlo.',
  'The FAssets agent now pays the XRP to the XRPL destination (minus the protocol redemption fee).':
    'El agente de FAssets paga ahora el XRP a la dirección XRPL (menos la fee de redención del protocolo).',

  // ── Unmint PA → XRP nativo (2026-07-26) — todos los caminos de vuelta ──
  'Unmint — FXRP → native XRP': 'Unmint — FXRP → XRP nativo',
  'Unmint → XRP': 'Unmint → XRP',
  'Free FXRP in the Smart Account': 'FXRP libre en el Smart Account',
  'Protocol minimum per redemption': 'Mínimo del protocolo por redención',
  'MAX = every free FXRP plus the FXRP this very dispatch mints — swept to native XRP, no dust.':
    'MAX = todo el FXRP libre más el FXRP que mintea este mismo dispatch — barrido a XRP nativo, sin polvo.',
  'The XRP arrives at the XRPL wallet that OWNS this Smart Account':
    'El XRP llega a la wallet XRPL DUEÑA de este Smart Account',
  'the burn happens at execution; the FAssets agent pays the XRP after (minutes to hours), minus the protocol redemption fee.':
    'el burn ocurre al ejecutar; el agente de FAssets paga el XRP después (minutos a horas), menos la fee de redención del protocolo.',
  'NOT a fee and NOT the unmint amount: the order must ride an XRPL Payment to the FAssets Core Vault. The FXRP it mints joins what you redeem — with the exact figures shown before you sign. Nothing goes to Astryum.':
    'NO es una fee y NO es el importe del unmint: la orden viaja en un Payment XRPL al Core Vault de FAssets. El FXRP que mintea SE SUMA a lo que redimes — con las cifras exactas antes de firmar. Nada va a Astryum.',
  'To your EVM wallet (FXRP)': 'A tu wallet EVM (FXRP)',
  'To your XRPL wallet (native XRP)': 'A tu wallet XRPL (XRP nativo)',
  'The withdrawn FXRP — plus the FXRP this dispatch mints — is redeemed to NATIVE XRP and arrives at the XRPL wallet that owns this Smart Account.':
    'El FXRP retirado — más el FXRP que mintea este dispatch — se redime a XRP NATIVO y llega a la wallet XRPL dueña de este Smart Account.',
  'FXRP to your Smart Account': 'FXRP a tu Smart Account',
  'Native XRP to your XRPL wallet': 'XRP nativo a tu wallet XRPL',
  'The claimed FXRP — plus the FXRP this dispatch mints — is redeemed to NATIVE XRP in the same signature. The burn happens at execution; the FAssets agent pays the XRP after (minutes to hours), minus the protocol redemption fee.':
    'El FXRP reclamado — más el FXRP que mintea este dispatch — se redime a XRP NATIVO en la misma firma. El burn ocurre al ejecutar; el agente de FAssets paga el XRP después (minutos a horas), menos la fee de redención del protocolo.',
  'Redeemed to native XRP': 'Redimido a XRP nativo',
  'XRP arrives at': 'El XRP llega a',
  'Below the protocol minimum per redemption': 'Por debajo del mínimo del protocolo por redención',
  'More FXRP than the Smart Account holds — available:': 'Más FXRP del que tiene el Smart Account — disponible:',
  'claim as FXRP instead, and Unmint later together with more FXRP.':
    'reclama como FXRP y haz Unmint más tarde junto con más FXRP.',
  'Unmint runs from the Smart Account — this FXRP lives in an EVM wallet; use Send → FXRP → XRPL there.':
    'El Unmint corre desde el Smart Account — este FXRP vive en una wallet EVM; usa Enviar → FXRP → XRPL allí.',
  'Free FXRP in your wallet': 'FXRP libre en tu wallet',
  'MAX = every free FXRP in this wallet, redeemed to native XRP.':
    'MAX = todo el FXRP libre de esta wallet, redimido a XRP nativo.',
  'XRPL wallet to receive the XRP': 'Wallet XRPL que recibe el XRP',
  'You sign this redeem in your own Flare wallet; the FAssets agent then pays the XRP to that XRPL address (minutes to hours), minus the protocol redemption fee. No Xaman, no dispatch.':
    'Firmas este redeem en tu propia wallet Flare; el agente de FAssets paga luego el XRP a esa dirección XRPL (minutos a horas), menos la fee de redención del protocolo. Sin Xaman, sin dispatch.',
  'Enter the XRPL address (r…) to receive the XRP': 'Introduce la dirección XRPL (r…) que recibe el XRP',
  'FXRP in this position': 'FXRP en esta posición',
  'Redeem → XRP': 'Redimir → XRP',
  'Redeem — FXRP → native XRP': 'Redimir — FXRP → XRP nativo',
  'Stays as FXRP on Flare. To get native XRP back to an XRPL wallet, use Redeem.':
    'Se queda como FXRP en Flare. Para recuperar XRP nativo en una wallet XRPL, usa Redimir.',
  'More than you can redeem:': 'Más de lo que puedes redimir:',
  'Free in this wallet': 'Libre en esta wallet',
  'Position + wallet': 'Posición + wallet',
  'More than this position holds:': 'Más de lo que tiene esta posición:',
  'MAX = the full position, withdrawn from Kinetic and redeemed to native XRP.':
    'MAX = la posición entera, retirada de Kinetic y redimida a XRP nativo.',
  'Withdraws this position from Kinetic and redeems it to native XRP, in one signature in your wallet. The FAssets agent pays the XRP to that XRPL address (minutes to hours), minus the protocol redemption fee. No Xaman, no dispatch.':
    'Retira esta posición de Kinetic y la redime a XRP nativo, en una sola firma en tu wallet. El agente de FAssets paga el XRP a esa dirección XRPL (minutos a horas), menos la fee de redención del protocolo. Sin Xaman, sin dispatch.',
  'Withdraws this position from Kinetic and redeems it to native XRP — one signature in your wallet. The FAssets agent pays the XRP to your XRPL address (minutes to hours), minus the protocol redemption fee.':
    'Retira esta posición de Kinetic y la redime a XRP nativo — una firma en tu wallet. El agente de FAssets paga el XRP a tu dirección XRPL (minutos a horas), menos la fee de redención del protocolo.',
  'Exit: Unmint back to native XRP from this account (5 XRP protocol minimum per redemption; the FAssets agent pays the XRP after the burn)':
    'Salida: Unmint de vuelta a XRP nativo desde esta cuenta (mínimo del protocolo 5 XRP por redención; el agente de FAssets paga el XRP tras el burn)',
  'Counts in dashboard totals': 'Computa en los totales del dashboard',
  'Excluded from dashboard totals': 'Excluida de los totales del dashboard',
  'Include or exclude this wallet from the dashboard totals':
    'Incluye o excluye esta wallet de los totales del dashboard',

  // ── Wallets — asset picker (FLR | FXRP) en el envío ──
  'Send the maximum available (fee headroom already deducted)':
    'Envía el máximo disponible (con el margen para fees ya descontado)',
  'Native · stays on Flare': 'Nativo · se queda en Flare',
  'XRP on Flare · can unmint to XRPL': 'XRP en Flare · puede volver a XRPL (unmint)',
  'FLR cannot be sent to an XRPL address. Switch the asset to FXRP to bridge it as XRP (unmint), or pick a Flare destination.':
    'FLR no puede enviarse a una dirección XRPL. Cambia el activo a FXRP para puentearlo como XRP (unmint), o elige un destino en Flare.',

  // ── Actividad — timeline en dos carriles (Flare + XRPL) ──
  'On-chain timeline across your connected wallets · Flare via Flarescan, XRPL live from the ledger':
    'Timeline on-chain de tus wallets conectadas · Flare vía Flarescan, XRPL en vivo desde el ledger',
  ledger: 'ledger',

  // ── Wallets — libreta de direcciones ──
  'Saved addresses': 'Direcciones guardadas',
  'Save address': 'Guardar dirección',
  'Give the address a name': 'Ponle un nombre a la dirección',
  'This address is already saved': 'Esta dirección ya está guardada',
  'Name — e.g. María (Xaman)': 'Nombre — p. ej. María (Xaman)',
  'Flare (0x…) or XRPL (r…) address. Saved entries show up as destinations when you send — saving one never moves funds.':
    'Dirección de Flare (0x…) o XRPL (r…). Las entradas guardadas aparecen como destinos al enviar — guardar una nunca mueve fondos.',
  'Save the addresses you send to often — they appear as one-tap destinations in the Send flow.':
    'Guarda las direcciones a las que envías a menudo — aparecen como destinos de un toque en el flujo de envío.',
  'Show QR': 'Ver QR',

  // ── Movimientos — puerta de Generar (ex-Ahorro, reorg 2026-07-12):
  //    enviar/recibir entre wallets + ahorro XRPL, y modales reutilizables ──
  Movements: 'Movimientos',
  'Between your wallets': 'Entre tus wallets',
  'Send between your wallets, receive with a QR, and set XRP aside until a date you choose. You sign everything in your own wallet.':
    'Envía entre tus wallets, recibe con un QR y aparta XRP hasta la fecha que elijas. Todo lo firmas tú en tu propia wallet.',
  'Send between your wallets or to an address, receive with a QR, and set XRP aside until a date you choose. Astryum prepares everything unsigned — you review and sign in your own wallet.':
    'Envía entre tus wallets o a una dirección, recibe con un QR y aparta XRP hasta la fecha que elijas. Astryum lo prepara todo sin firmar — tú revisas y firmas en tu propia wallet.',
  'To another of your wallets or an external address — cross-network rides the FAssets bridge.':
    'A otra de tus wallets o a una dirección externa — el cruce de red va por el bridge de FAssets.',
  'Show a wallet address as a QR to receive assets into it.':
    'Muestra la dirección de una wallet como QR para recibir activos en ella.',
  'Lock XRP on the ledger until a date you choose. It earns nothing while locked — a savings lock, not a yield product.':
    'Bloquea XRP en el ledger hasta la fecha que elijas. No genera nada mientras está bloqueado — es un bloqueo de ahorro, no un producto de rendimiento.',
  'This is a savings lock, not a yield product — it earns nothing while locked. XRP only: RLUSD is not escrowable today (issuer flag off).':
    'Es un bloqueo de ahorro, no un producto de rendimiento — no genera nada mientras está bloqueado. Solo XRP: RLUSD no es escrowable hoy (flag del emisor desactivado).',
  'Manage in Earn · Movements': 'Gestionar en Generar · Movimientos',
  'Choose the sending wallet': 'Elige la wallet emisora',
  'Choose the receiving wallet': 'Elige la wallet receptora',
  'Link a Flare or XRPL wallet from Wallets to send from it.':
    'Enlaza una wallet de Flare o XRPL desde Wallets para enviar desde ella.',
  'Link a wallet from Wallets to receive assets into it.':
    'Enlaza una wallet desde Wallets para recibir activos en ella.',

  // ── Agente — transferencias simples compiladas (el payload lo construye
  //    /wallet-transfer/prepare en el modal; el usuario revisa y firma) ──
  Prepare: 'Preparar',
  Transfer: 'Transferencia',
  'to choose': 'por elegir',
  'The transfer could not be compiled — nothing was proposed.':
    'La transferencia no se pudo compilar — no se propuso nada.',
  'Astryum builds the payload unsigned — you review the fees and sign in your own wallet.':
    'Astryum construye el payload sin firmar — revisas las fees y firmas en tu propia wallet.',

  // ── Legacy — la divulgación de la jaula (leer y aceptar antes de encerrar) ──
  // El texto canónico lo sirve el backend (config/cageDisclosure.ts) y lo
  // hashea allí: aquí solo se traduce. Si cambia una frase allí, se sube la
  // versión y esta entrada deja de casar — hay que actualizarla en el mismo PR.
  'How a cage works': 'Cómo funciona una jaula',
  'Read this before locking capital. Governing a Legacy on XRPL locks up nothing — only a cage does, and a cage is one-way by design.':
    'Lee esto antes de encerrar capital. Gobernar un Legacy en XRPL no encierra nada — solo la jaula lo hace, y la jaula es de una dirección por diseño.',
  'Why it is one-way': 'Por qué es de una dirección',
  'A legacy is a legacy because nobody can undo it — not the family under pressure, not a future you, and not Astryum.':
    'Un legado es un legado porque nadie puede deshacerlo — ni la familia bajo presión, ni tu yo futuro, ni Astryum.',
  'So the cage is a contract with no way to pay principal back to an address. That is the product, not a limitation of it.':
    'Por eso la jaula es un contrato sin ninguna forma de devolver el principal a una dirección. Eso es el producto, no una limitación suya.',
  'The council, the quorum, the constitution and the programmed transfers lock up nothing. You can govern a Legacy for years without ever creating a cage.':
    'El consejo, el quórum, la constitución y las transferencias programadas no encierran nada. Puedes gobernar un Legacy durante años sin crear jamás una jaula.',
  'What the code has, and what it does not': 'Lo que el código tiene, y lo que no',
  'There is no function that withdraws principal, no transfer to an arbitrary address, no proxy and no upgrade path. The rules are fixed from the first block.':
    'No hay ninguna función que retire el principal, ni transferencia a una dirección arbitraria, ni proxy, ni vía de actualización. Las reglas son fijas desde el primer bloque.',
  'Principal only moves between the vault and the venues the council whitelisted. A newly added venue takes effect 30 days later — because adding a venue IS the power to extract.':
    'El principal solo se mueve entre la vasija y los destinos que el consejo puso en su lista blanca. Un destino recién añadido tarda 30 días en entrar en vigor — porque añadir un destino ES el poder de extraer.',
  'Only realized yield ever reaches people. It is split into the lineage cut (which capitalizes back into principal), the protocol fee, and the payees the council configured.':
    'A las personas solo llega el rendimiento realizado. Se reparte entre el corte del linaje (que se capitaliza de vuelta al principal), la comisión de protocolo y los beneficiarios que el consejo haya configurado.',
  'The principal can be moved once more, and only sideways: into a successor vault with the SAME council and the SAME constitution, 30 days after the quorum proposes it. That is a move, not an exit.':
    'El principal sí puede moverse una vez más, y solo de lado: a una vasija sucesora con el MISMO consejo y la MISMA constitución, 30 días después de que el quórum lo proponga. Eso es una mudanza, no una salida.',
  'A venue can still lose value. The cage stops principal from leaving; it does not make the capital risk-free.':
    'Un destino puede perder valor igualmente. La jaula impide que el principal salga; no convierte el capital en algo sin riesgo.',
  'Who can do what': 'Quién puede hacer qué',
  'Astryum composes the payment and shows you the facts. Your council signs it, each member from their own device. The code does the rest.':
    'Astryum compone el pago y te enseña los hechos. Tu consejo lo firma, cada miembro desde su propio dispositivo. El código hace el resto.',
  'Astryum never holds a key of yours, never signs for you, and cannot open the cage. Nobody can — and that includes us.':
    'Astryum nunca tiene una clave tuya, nunca firma por ti y no puede abrir la jaula. Nadie puede — y eso nos incluye.',
  'The architecture, in three lines': 'La arquitectura, en tres líneas',
  'XRPL governs: the council, its quorum, and the constitution anchored on the ledger.':
    'XRPL gobierna: el consejo, su quórum y la constitución anclada en el ledger.',
  'Flare produces: the cage, and the venues it is allowed to work in.':
    'Flare produce: la jaula y los destinos en los que se le permite trabajar.',
  'Astryum coordinates: it builds the unsigned payload, discloses the fees, and stops there.':
    'Astryum coordina: construye el payload sin firmar, revela las comisiones y ahí se para.',
  'What it costs': 'Lo que cuesta',
  'To enter: a FAssets minting fee, the executor fee for the proof it pays on Flare, and the XRPL transaction fee. The exact numbers appear on the hand-off, before anyone signs.':
    'Para entrar: la comisión de acuñación de FAssets, la comisión del executor por la prueba que paga en Flare, y la comisión de transacción de XRPL. Los números exactos aparecen en la entrega, antes de que nadie firme.',
  'Inside: the lineage cut takes between 10% and 40% of realized yield — chosen at birth, adjustable by quorum within those bounds, never below 10%.':
    'Dentro: el corte del linaje se lleva entre el 10% y el 40% del rendimiento realizado — se elige al nacer, el quórum lo ajusta dentro de esos límites, y nunca baja del 10%.',
  'Astryum’s protocol fee applies to yield only, is capped at 10% for ever by the contract, and is 0 today.':
    'La comisión de protocolo de Astryum se aplica solo al rendimiento, el contrato la limita al 10% para siempre, y hoy es 0.',
  'It is a beta': 'Es una beta',
  'This is beta software running on mainnet, and the vault contract has not been audited by a third party.':
    'Esto es software en beta corriendo sobre mainnet, y el contrato de la vasija no ha sido auditado por un tercero.',
  'A cage accepts a limited total through Astryum during the beta. The current limit is shown next to the amount.':
    'Durante la beta una jaula acepta un total limitado a través de Astryum. El límite vigente se muestra junto al importe.',
  'Cage only what you can afford to leave locked.':
    'Enjaula solo lo que puedas permitirte dejar encerrado.',
  'I understand that the principal that enters the cage does not come back out to an address — not mine, and not Astryum’s.':
    'Entiendo que el principal que entra en la jaula no vuelve a salir a una dirección — ni a la mía, ni a la de Astryum.',
  'I understand that this is beta, unaudited software on mainnet, and that I can lose what I put in.':
    'Entiendo que esto es software en beta, sin auditar, sobre mainnet, y que puedo perder lo que meta.',
  'I understand that Astryum does not custody, does not sign, and cannot reverse this for me.':
    'Entiendo que Astryum no custodia, no firma y no puede revertir esto por mí.',
  'I understand the beta limit, and I am not caging anything I cannot afford to leave locked.':
    'Entiendo el límite de la beta, y no estoy enjaulando nada que no pueda permitirme dejar encerrado.',
  // El modal y la banda que lo abren.
  'The limits right now': 'Los límites ahora mismo',
  'Most a cage may hold through Astryum': 'Lo máximo que una jaula puede contener vía Astryum',
  'This cage holds today': 'Esta jaula contiene hoy',
  'Still fits': 'Todavía cabe',
  'Below this the fees eat the whole payment': 'Por debajo de esto las comisiones se comen el pago entero',
  'The exact minting and executor fees for your amount are shown on the hand-off, before anyone signs.':
    'Las comisiones exactas de acuñación y del executor para tu importe se muestran en la entrega, antes de que nadie firme.',
  'See the live contract addresses on the proof page':
    'Ver las direcciones de los contratos en vivo en la página de prueba',
  'Confirm you understand': 'Confirma que lo entiendes',
  'You confirmed you understood this on': 'Confirmaste que entendías esto el',
  'Not now': 'Ahora no',
  'I understand — continue': 'Lo entiendo — continuar',
  'I understand — compose the birth': 'Lo entiendo — componer el nacimiento',
  'I understand — compose the order': 'Lo entiendo — componer la orden',
  'Beta.': 'Beta.',
  'Governing a Legacy locks up nothing. Creating a cage does — and a cage is one-way by design.':
    'Gobernar un Legacy no encierra nada. Crear una jaula sí — y la jaula es de una dirección por diseño.',

  // ── Legacy (vías (a)+(b): consejo + transferencia programada + constitución) ──
  Legacy: 'Legacy',
  'Capital under rules that outlive their author: the rules and the authority live on XRPL; the capital produces on Flare inside a cage of code. A programmed, conditioned, revocable transfer — not a promise.':
    'Capital bajo reglas que sobreviven a su autor: las reglas y la autoridad viven en XRPL; el capital produce en Flare dentro de una jaula de código. Una transferencia programada, condicionada y revocable — no una promesa.',
  'Legacy account': 'Cuenta Legacy',
  'XRPL account (the council-governed account)': 'Cuenta XRPL (la cuenta gobernada por el consejo)',
  Inspect: 'Inspeccionar',
  'The council': 'El consejo',
  'Inspect an account to read its council from the ledger.':
    'Inspecciona una cuenta para leer su consejo desde el ledger.',
  quorum: 'quórum',
  weight: 'peso',
  'master key disabled — quorum-only governance':
    'master key deshabilitada — gobierno solo por quórum',
  'master key still active — the council can be bypassed':
    'master key aún activa — se puede puentear al consejo',
  'The account is protected BY ITS COUNCIL: every transaction needs the quorum. This is governance protection — on XRPL, no code physically prevents a quorum decision.':
    'La cuenta está protegida POR SU CONSEJO: cada transacción necesita el quórum. Es protección por gobernanza — en XRPL ningún código impide físicamente una decisión del quórum.',
  'No council on this account yet': 'Esta cuenta aún no tiene consejo',
  'A Legacy account is a multisig: 1-32 signers with weights and a quorum (e.g. 3 of 5). Configure it from your own wallet — Astryum composes the Legacy’s transactions, but the account setup is yours.':
    'Una cuenta Legacy es un multisig: 1-32 firmantes con pesos y un quórum (p. ej. 3 de 5). Configúralo desde tu propia wallet — Astryum compone las transacciones del Legacy, pero la configuración de la cuenta es tuya.',
  'Multisign xApp (Xaman)': 'xApp Multisign (Xaman)',
  'Programmed transfer': 'Transferencia programada',
  'Commit XRP to a beneficiary with a delivery date. Until that date the commitment is UNBREAKABLE — not even the council can take it back (that is the point). If you set a recovery date and nobody claims the transfer, after it the XRP returns to this account. The locked XRP earns nothing while locked.':
    'Compromete XRP a un beneficiario con una fecha de entrega. Hasta esa fecha el compromiso es INQUEBRANTABLE — ni el consejo puede echarse atrás (esa es la gracia). Si fijas una fecha de recuperación y nadie reclama la transferencia, después de ella el XRP vuelve a esta cuenta. El XRP bloqueado no genera nada mientras está bloqueado.',
  'Beneficiary (XRPL address)': 'Beneficiario (dirección XRPL)',
  'Delivery date (unbreakable until then)': 'Fecha de entrega (inquebrantable hasta entonces)',
  'Recovery date (optional — unclaimed funds return)':
    'Fecha de recuperación (opcional — lo no reclamado vuelve)',
  'Review the commitment': 'Revisar el compromiso',
  'What you are about to sign': 'Lo que estás a punto de firmar',
  'Sign in Xaman': 'Firmar en Xaman',
  'This account is governed by a council (multisig) — Xaman cannot sign multisig transactions natively. Copy the unsigned transaction and gather the quorum’s signatures in your wallet’s multisign tool. Astryum only composes; your council signs.':
    'Esta cuenta la gobierna un consejo (multisig) — Xaman no firma multisig nativamente. Copia la transacción sin firmar y reúne las firmas del quórum en la herramienta de multifirma de tu wallet. Astryum solo compone; firma tu consejo.',
  'Copy unsigned transaction': 'Copiar transacción sin firmar',
  Copied: 'Copiado',
  'Commitment signed and submitted.': 'Compromiso firmado y enviado.',
  deliverable: 'entregable',
  Deliver: 'Entregar',
  Recover: 'Recuperar',
  committed: 'comprometido',
  'Submitted.': 'Enviado.',
  'Delivery and recovery are permissionless: once the window opens, anyone (you, Astryum’s keeper, any third party) can trigger them — the ledger fixes where the XRP goes. Delivery always pays the beneficiary; recovery always returns to the creator.':
    'La entrega y la recuperación son permissionless: cuando la ventana se abre, cualquiera (tú, el keeper de Astryum, un tercero) puede dispararlas — el ledger fija a dónde va el XRP. La entrega siempre paga al beneficiario; la recuperación siempre vuelve al creador.',
  'The constitution': 'La constitución',
  'The governance document, anchored on the ledger by its SHA-256 fingerprint (the document itself never leaves your browser). Every amendment is a new anchor signed by the council’s quorum — the version history IS the council’s consensus history. The anchor registers the rules; the council enforces them.':
    'El documento de gobernanza, anclado en el ledger por su huella SHA-256 (el documento nunca sale de tu navegador). Cada enmienda es un nuevo ancla firmada por el quórum del consejo — el historial de versiones ES el historial de consenso del consejo. El ancla registra las reglas; el consejo las hace cumplir.',
  'Anchored today': 'Anclado hoy',
  'Document at:': 'Documento en:',
  'No constitution anchored on this account yet.': 'Esta cuenta aún no tiene constitución anclada.',
  'Verify or amend: paste the exact document text':
    'Verificar o enmendar: pega el texto exacto del documento',
  'Anchor v1: paste the exact document text': 'Anclar v1: pega el texto exacto del documento',
  'The rules of the patrimony, exactly as written…':
    'Las reglas del patrimonio, exactamente como están escritas…',
  'Document URI (optional — IPFS/HTTPS where it lives)':
    'URI del documento (opcional — IPFS/HTTPS donde vive)',
  'Verify against the ledger': 'Verificar contra el ledger',
  'Prepare amendment': 'Preparar enmienda',
  'Prepare anchor': 'Preparar ancla',
  'The document matches the anchored fingerprint — this is the governing version.':
    'El documento coincide con la huella anclada — esta es la versión que gobierna.',
  'The document does NOT match the anchor — different text, or a newer version was anchored.':
    'El documento NO coincide con el ancla — texto distinto, o se ancló una versión más nueva.',
  'Anchor signed and submitted.': 'Ancla firmada y enviada.',
  'Amendment history (each version signed by the quorum of its day)':
    'Historial de enmiendas (cada versión firmada por el quórum de su día)',
  'quorum-signed': 'firmada por quórum',
  'single signature': 'firma única',
  'Paste the exact text of the governance document first.':
    'Pega primero el texto exacto del documento de gobernanza.',
  'Enter a valid XRPL destination address (the beneficiary).':
    'Introduce una dirección XRPL de destino válida (el beneficiario).',
  'Pick the delivery date (when the beneficiary can receive).':
    'Elige la fecha de entrega (cuándo puede recibir el beneficiario).',
  'The recovery date must come after the delivery date (ledger rule).':
    'La fecha de recuperación debe ser posterior a la de entrega (regla del ledger).',
  'XRPL composition is not enabled on this deployment yet (feature flag off).':
    'La composición XRPL aún no está activada en este despliegue (feature flag apagado).',
  'What protects what: on XRPL, the account is protected by the council (quorum) and commitments by the ledger’s escrow rules — no Astryum key is involved anywhere, and Astryum charges nothing on native XRPL. The cage of code (capital that produces on Flare without a withdraw function) is a separate, Flare-side design — and even there, the code cages the PRINCIPAL while the fruits are governed by the council. Any beneficiary condition is evaluated by the council’s quorum under a written rule, with an on-ledger record — never applied automatically by a system. This is a programmed, conditioned, revocable transfer, constituted in life — it does not create or replace any legal regime, and death changes nothing here because nothing transfers at death.':
    'Qué protege qué: en XRPL, la cuenta la protege el consejo (quórum) y los compromisos las reglas de escrow del ledger — no interviene ninguna clave de Astryum en ningún punto, y Astryum no cobra nada en XRPL nativo. La jaula de código (capital que produce en Flare sin función de extracción) es un diseño aparte, del lado Flare — y aun allí, el código enjaula el PRINCIPAL mientras los frutos los gobierna el consejo. Cualquier condición sobre un beneficiario la evalúa el quórum del consejo bajo una regla escrita, con registro en el ledger — jamás la aplica automáticamente un sistema. Esto es una transferencia programada, condicionada y revocable, constituida en vida — no crea ni sustituye ningún régimen legal, y la muerte aquí no cambia nada porque con la muerte no se transfiere nada.',
  'it may already have been cancelled (anyone can, after the expiry date); the XRP always returns to the account that created the escrow.':
    'puede que ya estuviera cancelado (cualquiera puede, pasada la fecha de expiración); el XRP siempre vuelve a la cuenta que creó el escrow.',

  // ── Legacy — blindaje Fase 1 (auditoría de producto P5/P7/P10 + agente-usuario) ──
  // Dos superficies (ADR-008 / prompt Fable) + la salud que gobierna las acciones (§2).
  'Constitute': 'Constituir',
  'Govern': 'Gobernar',
  // Reorganización pre-gate 2026-08-04: conmutador de superficie en cabecera,
  // tab Info (antes "Information"), rail/tabs accesibles y estado de la
  // constitución en la tira de identidad de Gobernar.
  'Info': 'Info',
  'New Legacy': 'Nuevo Legacy',
  'Legacy surface': 'Superficie del Legacy',
  'Open or constitute a Legacy first': 'Abre o constituye un Legacy primero',
  'Govern sections': 'Secciones de Gobernar',
  'Constitution stations': 'Estaciones de la constitución',
  'done': 'hecha',
  'constitution anchored': 'constitución anclada',
  'no constitution anchored yet': 'aún sin constitución anclada',
  'View the constitution': 'Ver la constitución',
  'Previous station': 'Estación anterior',
  'Next station': 'Estación siguiente',
  // 'Previous' / 'Next' ya existen arriba (~1467) con la misma traducción.
  'A Legacy is an XRPL account governed by a council of real people — a quorum the ledger itself enforces. Constitute a new one, or open the address of one you already govern in the first step: it will appear here.':
    'Un Legacy es una cuenta XRPL gobernada por un consejo de personas reales — un quórum que el propio ledger hace cumplir. Constituye uno nuevo, o abre en el primer paso la dirección de uno que ya gobiernes: aparecerá aquí.',
  // La puerta del lobby (2026-08-04): en modo Legacy sin cuenta gobernada,
  // las páginas compartidas enseñan el lobby — nunca el capital Personal.
  'No Legacy constituted yet': 'Aún no hay ningún Legacy constituido',
  'This is the Legacy side of Astryum: it shows a council-governed account, and this profile has none yet. Personal capital stays on the Personal side — nothing is shown here until a council exists.':
    'Este es el lado Legacy de Astryum: muestra una cuenta gobernada por consejo, y este perfil aún no tiene ninguna. El capital Personal se queda en el lado Personal — aquí no se enseña nada hasta que exista un consejo.',
  'Constitute a Legacy': 'Constituir un Legacy',
  'Back to Personal': 'Volver a Personal',
  'Loading': 'Cargando',
  // Briefs por estación (2026-08-04, del propio onboarding del fundador):
  // cada slide abre diciendo QUÉ SE HACE físicamente, en pasos numerados.
  'Before you start': 'Antes de empezar',
  'What you do here': 'Qué se hace aquí',
  'Create a NEW account in the Xaman wallet on your phone — new, with no history: the ceremony ends with this account’s master key disabled, so never use your everyday account.':
    'Crea una cuenta NUEVA en la wallet Xaman de tu móvil — nueva, sin historial: la ceremonia termina deshabilitando la master key de esta cuenta, así que nunca uses tu cuenta de diario.',
  'Fund it with a little XRP — about 15 XRP covers the ledger reserves and the ceremony fees. The exact figure is checked here once the account is open.':
    'Fondéala con un poco de XRP — unos 15 XRP cubren las reservas del ledger y las comisiones de la ceremonia. La cifra exacta se comprueba aquí en cuanto la cuenta esté abierta.',
  'Paste its r… address below: that account becomes the Legacy — the main account the council will govern. Astryum reads it from the ledger and never touches its keys.':
    'Pega su dirección r… aquí abajo: esa cuenta se convierte en el Legacy — la cuenta principal que gobernará el consejo. Astryum la lee del ledger y jamás toca sus llaves.',
  // Council, acortado (2026-08-04, "demasiado texto junto"): el brief nombra
  // los tres movimientos; CouncilInXaman los explica debajo.
  'Gather 3 to 7 people (5 with a quorum of 3 is the standard), each with their OWN Xaman wallet.':
    'Reúne de 3 a 7 personas (5 con quórum de 3 es el estándar), cada una con SU wallet Xaman.',
  'Write the plan first: who signs, with what weight, and the quorum.':
    'Escribe primero el plan: quién firma, con qué peso y el quórum.',
  'Create it in the Xaman Multisign xApp — guided below, screen by screen — and come back to compare the ledger against your plan.':
    'Créalo en el xApp Multisign de Xaman — guiado abajo, pantalla a pantalla — y vuelve para comparar el ledger con tu plan.',
  // Inmersión del wizard (2026-08-05): cabecera de estación, orientación de
  // primera vez, ayuda de primera wallet y los «Continuar» del éxito.
  'A fresh Xaman account becomes the vessel of the Legacy.':
    'Una cuenta Xaman nueva se convierte en el recipiente del Legacy.',
  '~10 min · your phone': '~10 min · tu móvil',
  'Who signs, and how many must agree — created in Xaman.':
    'Quién firma y cuántos deben estar de acuerdo — creado en Xaman.',
  '~15 min · the members’ addresses': '~15 min · las direcciones de los miembros',
  'Every member proves they can sign — before any real capital.':
    'Cada miembro demuestra que sabe firmar — antes de cualquier capital real.',
  '~5 min per member · their phones': '~5 min por miembro · sus móviles',
  'The master key retires; only the council remains.':
    'La master key se retira; solo queda el consejo.',
  '~2 min · your phone': '~2 min · tu móvil',
  'The rules, written in plain language and anchored on the ledger.':
    'Las reglas, escritas en lenguaje humano y ancladas en el ledger.',
  '~10 min · here': '~10 min · aquí',
  'Fund the vessel — the ceremony is complete.': 'Fondea el recipiente — la ceremonia está completa.',
  '~1 min': '~1 min',
  'The ceremony': 'La ceremonia',
  'Six stations, one irreversible moment — closing the door — and even that one is gated behind a rehearsal. You can leave at any station and come back: everything lives on the ledger, so the ceremony resumes exactly where reality is.':
    'Seis estaciones, un solo momento irreversible — cerrar la puerta — y hasta ese llega custodiado por un ensayo. Puedes irte en cualquier estación y volver: todo vive en el ledger, así que la ceremonia se reanuda exactamente donde está la realidad.',
  'What you need: your phone with Xaman, the members’ addresses (r…), and about 15 XRP on the new account. The guide in the sidebar knows every station — ask it anything.':
    'Qué necesitas: tu móvil con Xaman, las direcciones de los miembros (r…) y unos 15 XRP en la cuenta nueva. La guía de la barra lateral conoce cada estación — pregúntale lo que sea.',
  'Never created a Xaman account? The 60-second version':
    '¿Nunca has creado una cuenta de Xaman? La versión de 60 segundos',
  'Install Xaman from the App Store or Play Store and open it.':
    'Instala Xaman desde el App Store o Play Store y ábrela.',
  'Add account → create a NEW account. Xaman shows you the secret numbers — write them on paper, in order. They ARE the account; whoever holds them holds it.':
    'Añadir cuenta → crear una cuenta NUEVA. Xaman te enseña los números secretos — escríbelos en papel, en orden. SON la cuenta: quien los tiene, la tiene.',
  'Confirm the numbers when Xaman asks. The new r… address appears at the top of the home screen — that is the vessel.':
    'Confirma los números cuando Xaman te los pida. La nueva dirección r… aparece arriba en la pantalla de inicio — ese es el recipiente.',
  'Tap the address to copy it, send it to yourself, and paste it below.':
    'Toca la dirección para copiarla, envíatela y pégala aquí abajo.',
  'Continue: the rehearsal': 'Continuar: el ensayo',
  'Continue: close the door': 'Continuar: cerrar la puerta',
  'Continue: the capital': 'Continuar: el capital',
  // Placeholders de las plantillas de constitución (2026-08-08): eran
  // literales en español y se colaban en la UI inglesa; ahora son claves
  // inglesas y este bloque es su español de siempre.
  'ipfs://… / "the safe at home"': 'ipfs://… / "caja fuerte de casa"',
  'G’s patrimony': 'Patrimonio de G',
  'Protect my capital for the long run: let it produce without being sellable on an impulse, and let no single key touch it alone.':
    'Proteger mi capital a largo plazo: que produzca sin poder venderse en un impulso, y que ninguna llave sola pueda tocarlo.',
  'Phone (Xaman) — r… — backup: home safe\nHardware — r… — backup: bank\nOld phone (Xaman) — r… — backup: my parents’ house':
    'Móvil (Xaman) — r… — backup: caja fuerte casa\nHardware — r… — backup: banco\nMóvil viejo (Xaman) — r… — backup: casa de mis padres',
  'García Legacy': 'Legacy García',
  'That no generation of this family starts from zero…':
    'Que ninguna generación de esta familia empiece de cero…',
  'Foundation / purpose': 'Fundación / propósito',
  'Ana’s branch — 50\nLuis’s branch — 50': 'Rama de Ana — 50\nRama de Luis — 50',
  'Marco: receives his share at 25': 'Marco: recibe su parte al cumplir 25 años',
  'Ana — r… — successor: Marco, r…': 'Ana — r… — sucesor: Marco, r…',
  'Marco’s fund': 'Fondo de Marco',
  'His education and his first home…': 'Su educación y su primer techo…',
  'At 18 → 30% of the fund\nAt 25 → the rest': 'Al cumplir 18 → 30% del fondo\nAl cumplir 25 → el resto',
  'Clean Sea Fund': 'Fondo Mar Limpio',
  'What this fund sustains, and for whom…': 'Qué sostiene este fondo y para quién…',
  'Annual grants…\nNever third parties’ running expenses…':
    'Becas anuales…\nNunca gasto corriente de terceros…',
  'Taller Roca Legacy': 'Legacy Taller Roca',
  'That the business keeps producing for…': 'Que el negocio siga produciendo para…',
  'Only council-approved destinations…': 'Solo destinos aprobados por el consejo…',
  'The kids’ savings': 'Ahorro de los niños',
  // Council reestructurado (2026-08-05): tarjetas separadas, tutorial
  // ilustrado con las capturas reales de Xaman, plan plegado como opcional.
  'created in Xaman, not here': 'creado en Xaman, no aquí',
  'No council governs this account yet. It is created in the Xaman Multisign xApp — from the phone that holds this account’s key — following the illustrated steps below; then you come back and Astryum reads it from the ledger. Astryum never holds a key.':
    'Aún no gobierna esta cuenta ningún consejo. Se crea en el xApp Multisign de Xaman — desde el móvil que guarda la llave de esta cuenta — siguiendo los pasos ilustrados de abajo; después vuelves y Astryum lo lee del ledger. Astryum nunca guarda una llave.',
  'Why there? The signer list is the one transaction that hands over control of an account, and Xaman only lets its own tools compose it — it refuses the request from any app, Astryum included. Everything after this step — the rehearsal, closing the door, the constitution — happens back here.':
    '¿Por qué allí? La lista de firmantes es la única transacción que entrega el control de una cuenta, y Xaman solo deja componerla a sus propias herramientas — rechaza la petición de cualquier app, Astryum incluida. Todo lo que viene después — el ensayo, cerrar la puerta, la constitución — pasa aquí de vuelta.',
  'The steps in Xaman, illustrated': 'Los pasos en Xaman, ilustrados',
  'Come back here and check it against the ledger': 'Vuelve aquí y compruébalo contra el ledger',
  'Add the members, one by one.': 'Añade los miembros, uno a uno.',
  'Paste each address as its owner sent it to you — never retype it by hand — and set its weight to 1 unless you deliberately want someone to weigh more. Add all of them before continuing: the list you send REPLACES anything that was there; it is not added to it.':
    'Pega cada dirección tal y como te la envió su dueño — nunca la reescribas a mano — y deja su peso en 1 salvo que quieras deliberadamente que alguien pese más. Añádelos todos antes de continuar: la lista que envías SUSTITUYE por completo la anterior; no se suma a ella.',
  'Set the quorum.': 'Pon el quórum.',
  'That is how many votes any decision needs, out of the total on the list. Five signers with a quorum of three is the recommended family setup — never 2-of-2 nor 2-of-3.':
    'Son los votos que necesita cualquier decisión, del total de la lista. Cinco firmantes con quórum de tres es la configuración familiar recomendada — nunca 2-de-2 ni 2-de-3.',
  'Compare the review screen, line by line.': 'Compara la pantalla de revisión, línea a línea.',
  'Xaman → xApps → search “Multisign”': 'Xaman → xApps → busca “Multisign”',
  'The Setup screen, empty — Add Signer starts the list': 'La pantalla Setup, vacía — Add Signer empieza la lista',
  'All members added, weight 1 each, quorum set — then Submit': 'Todos los miembros añadidos, peso 1 cada uno, quórum puesto — y Submit',
  'The review — type Set Signer List: every member, every weight, the quorum': 'La revisión — tipo Set Signer List: cada miembro, cada peso, el quórum',
  'Optional: write the plan here first — a checked list to copy into the phone, compared against the ledger afterwards':
    'Opcional: escribe antes el plan aquí — una lista verificada para copiar al móvil, comparada luego contra el ledger',
  'Write the list here first': 'Escribe la lista aquí primero',
  // El copiloto ES la Guía en modo Legacy (2026-08-04).
  'Reads this Legacy’s step from the ledger · never signs':
    'Lee del ledger el paso de este Legacy · nunca firma',
  'Explains Legacy and finds your setup · never sees your data':
    'Explica Legacy y encuentra tu configuración · nunca ve tus datos',
  'Ask about your Legacy…': 'Pregunta sobre tu Legacy…',
  'Wait for the rehearsal: closing the door before every member has proven they can sign risks locking this account forever.':
    'Espera al ensayo: cerrar la puerta antes de que cada miembro haya demostrado que sabe firmar arriesga bloquear esta cuenta para siempre.',
  'The account’s OWN master key signs this one — the ledger refuses the quorum for it. Scan the QR with the Xaman that holds the Legacy account.':
    'Esta la firma la PROPIA master key de la cuenta — el ledger se la niega al quórum. Escanea el QR con el Xaman que guarda la cuenta del Legacy.',
  'After it validates there is no shortcut left: only the council governs this account. That is the point.':
    'Cuando valida, ya no queda atajo: esta cuenta solo obedece al consejo. Esa es la gracia.',
  'Prepare the rehearsal below: 1 XRP, from this account to itself, delivered tomorrow, recoverable in a week.':
    'Prepara el ensayo aquí abajo: 1 XRP, de esta cuenta a sí misma, entregado mañana, recuperable en una semana.',
  'Every member signs it ALONE, from their own phone — helping someone proves that YOU can sign, not that they can.':
    'Cada miembro lo firma SOLO, desde su propio móvil — ayudar a alguien demuestra que TÚ sabes firmar, no que él sepa.',
  'Astryum verifies each signature on the ledger in the list below. No real capital enters before this is green.':
    'Astryum verifica cada firma en el ledger, en la lista de abajo. No entra capital real antes de que esto esté en verde.',
  'Write the constitution from a template — plain human language, filled with your names and rules. The text never leaves your browser.':
    'Escribe la constitución desde una plantilla — lenguaje humano, con vuestros nombres y reglas. El texto no sale nunca de tu navegador.',
  'Anchor its SHA-256 on the ledger: the council signs a DIDSet on the account’s own DID. Anyone can verify the text against the fingerprint.':
    'Ancla su SHA-256 en el ledger: el consejo firma un DIDSet en el DID de la propia cuenta. Cualquiera puede verificar el texto contra la huella.',
  'Keep the document itself with the family — the ledger holds the fingerprint, you hold the text. Amendments are new anchors signed by the quorum.':
    'El documento lo guarda la familia — el ledger guarda la huella, vosotros el texto. Las enmiendas son anclas nuevas firmadas por el quórum.',
  'Emergency: replace the fallen signer before anything else':
    'Emergencia: reemplaza al firmante caído antes que nada',
  'Locked while the quorum margin is at zero: replace the missing signer first. Closing the door now would risk locking this account forever.':
    'Bloqueado mientras el margen de quórum es cero: reemplaza primero al firmante que falta. Cerrar la puerta ahora arriesgaría bloquear esta cuenta para siempre.',
  'This Legacy is at the exact quorum — resolve the emergency before committing any capital.':
    'Este Legacy está en el quórum exacto — resuelve la emergencia antes de comprometer capital.',
  'Commit real capital only after the signing rehearsal is verified on-chain.':
    'Compromete capital real solo después de que el ensayo de firma esté verificado on-chain.',
  // Mis Legacies (Interfaz B) — la lista y la pertenencia honesta.
  'My Legacies': 'Mis Legacies',
  'The council-governed accounts you constitute and control. Their state is read live from the ledger — Astryum stores nothing about them.':
    'Las cuentas gobernadas por consejo que constituyes y controlas. Su estado se lee en vivo del ledger — Astryum no guarda nada sobre ellas.',
  'The council-governed accounts you constitute and control. Their state is read live from the ledger — Astryum stores only your pointers to them.':
    'Las cuentas gobernadas por consejo que constituyes y controlas. Su estado se lee en vivo del ledger — Astryum solo guarda tus punteros hacia ellas.',
  // ── Legacy discovery agent ("Descubrir") ──
  'Discover your Legacy': 'Descubre tu Legacy',
  'Tell me what you want to protect and for whom — I point you to the setup that fits. I never sign and never see your data.':
    'Cuéntame qué quieres proteger y para quién — te llevo a la configuración que encaja. No firmo nada ni veo tus datos.',
  'I want to protect my family — where do I start?': 'Quiero proteger a mi familia, ¿por dónde empiezo?',
  'What is the council and the quorum?': '¿Qué es el consejo y el quórum?',
  'I want to leave a fund for my kids with conditions': 'Quiero dejar un fondo para mis hijos con condiciones',
  'How do the templates differ?': '¿En qué se diferencian las plantillas?',
  'Tell me what you want to protect and for whom…': 'Cuéntame qué quieres proteger y para quién…',
  'This assistant only explains and suggests. It never signs, never sees your data, and gives no financial or legal advice.':
    'Este asistente solo explica y sugiere. Nunca firma, nunca ve tus datos y no da consejo financiero ni legal.',
  // ── Constitute slide deck + My Legacies cards (redesign 2026-07-16) ──
  'Already govern a Legacy? Open its address here — it is remembered in My Legacies. Observing is just opening.':
    '¿Ya gobiernas un Legacy? Abre su dirección aquí — queda guardado en Mis Legacies. Observar es simplemente abrir.',
  'The capital': 'El capital',
  constituted: 'constituido',
  'Your Legacy is constituted: the council governs, the rehearsal is proven, the door is closed and the constitution is anchored. From here the capital works in two layers: XRP on this account (the native reserve, protected by the quorum), and productive capital on Flare inside the cage of code — governed from XRPL through council orders.':
    'Tu Legacy está constituido: el consejo gobierna, el ensayo está probado, la puerta cerrada y la constitución anclada. Desde aquí el capital trabaja en dos capas: XRP en esta cuenta (la reserva nativa, protegida por el quórum) y capital productivo en Flare dentro de la jaula de código — gobernado desde XRPL con órdenes del consejo.',
  'Fund the account: a normal XRP payment to this address (the quorum is not needed to receive).':
    'Fondea la cuenta: un pago XRP normal a esta dirección (recibir no necesita quórum).',
  'Programmed transfers, council orders to the Flare cage, and the vault mirror live in Govern.':
    'Las transferencias programadas, las órdenes del consejo a la jaula de Flare y el espejo del vault viven en Gobernar.',
  'Go to Govern': 'Ir a Gobernar',
  'Nickname (only on this device)': 'Apodo (solo en este dispositivo)',
  'Save nickname': 'Guardar apodo',
  'Edit nickname': 'Editar apodo',
  'Unnamed Legacy': 'Legacy sin nombre',
  rehearsed: 'ensayados',
  'Constitute a new one — and if you already govern one, open its address in the first step: it will appear here.':
    'Constituye uno nuevo — y si ya gobiernas uno, abre su dirección en el primer paso: aparecerá aquí.',
  // ── Council order (FDC enforcement rail) ──
  'Council order (the cage on Flare)': 'Orden del consejo (la jaula en Flare)',
  'Govern the productive capital from XRPL, literally: the quorum signs ONE transaction committing the exact order; the Flare Data Connector proves it; the bridge executes only those bytes against the vault. No order can extract the principal — that function does not exist.':
    'Gobierna el capital productivo desde XRPL, literalmente: el quórum firma UNA transacción que compromete la orden exacta; el Flare Data Connector la prueba; el puente ejecuta solo esos bytes contra la vasija. Ninguna orden puede extraer el principal — esa función no existe.',
  Order: 'Orden',
  'Direct principal to a venue': 'Dirigir principal a un venue',
  'Recall principal from a venue': 'Retirar principal de un venue (al vault)',
  'Evacuate a venue (emergency)': 'Evacuar un venue (emergencia)',
  'Set the linaje cut (bps)': 'Fijar el corte del linaje (bps)',
  'Grant direction (the cession)': 'Ceder la dirección (la cesión)',
  'End the cession': 'Terminar la cesión',
  'Point at a new constitution version': 'Apuntar a una nueva versión de la constitución',
  'Venue #': 'Venue #',
  'Amount (base units)': 'Cantidad (unidades base)',
  'Bps (1000–4000)': 'Bps (1000–4000)',
  'Director (Flare 0x…)': 'Director (Flare 0x…)',
  Until: 'Hasta',
  'New SHA-256 (0x + 64 hex)': 'Nuevo SHA-256 (0x + 64 hex)',
  'Fill every field of the order first.': 'Rellena todos los campos de la orden primero.',
  'Compose the order': 'Componer la orden',
  'Your council signs this 1-drop Payment here, each member from their own device. The signature authorizes ONLY the order above — same bytes, once, in order.':
    'Tu consejo firma este Payment de 1 drop aquí, cada miembro desde su propio dispositivo. La firma autoriza SOLO la orden de arriba — los mismos bytes, una vez, en orden.',
  'signed on XRPL': 'firmada en XRPL',
  'FDC round': 'ronda FDC',
  'FDC round (~2-5 min)': 'ronda FDC (~2-5 min)',
  'executed in the cage': 'ejecutada en la jaula',
  'The order the quorum signed on XRPL was executed on Flare. Nobody held a key in between.':
    'La orden que el quórum firmó en XRPL se ejecutó en Flare. Nadie tuvo una llave por el camino.',
  'the order stays valid: the proof can be delivered later by anyone (permissionless).':
    'la orden sigue válida: la prueba puede entregarla más tarde cualquiera (permissionless).',
  'relay error': 'error del relay',
  'New order': 'Nueva orden',
  // ── Legacy intent compiler ("Operar") ──
  'Or describe it in words — the AI compiles, you review and sign':
    'O descríbelo con palabras — la IA compila, tú revisas y firmas',
  'e.g. "Commit 200 XRP to r… deliverable on January 1st, recoverable in a year"':
    'p. ej. «Compromete 200 XRP a r… entregable el 1 de enero, recuperable en un año»',
  'programmed transfer': 'transferencia programada',
  'amount missing': 'falta la cantidad',
  'date missing': 'falta la fecha',
  deliver: 'entrega',
  recover: 'recuperación',
  'beneficiary missing — fill it in the form': 'falta el beneficiario — rellénalo en el formulario',
  'Fill the form below': 'Rellenar el formulario de abajo',
  Discard: 'Descartar',
  'Nothing is prepared or signed yet — you review every field first.':
    'Aún no se prepara ni se firma nada — revisas cada campo antes.',
  'That is a constitution amendment — use "The constitution" card below: paste the new text, and the quorum signs the new anchor.':
    'Eso es una enmienda de la constitución — usa la tarjeta «La constitución» de abajo: pega el texto nuevo y el quórum firma el ancla nueva.',
  'I could not map that to an operation — try an amount, a beneficiary and a date.':
    'No he podido convertirlo en una operación — prueba con una cantidad, un beneficiario y una fecha.',
  'The compiler could not interpret that — try rephrasing with an amount and a date.':
    'El compilador no ha podido interpretarlo — reformúlalo con una cantidad y una fecha.',
  // ── Legacy guide (journey-aware) ──
  'Your guide on this Legacy': 'Tu guía en este Legacy',
  'It knows which step this Legacy is on (read from the ledger) and points you to the next one. It never signs and never sees your data.':
    'Sabe en qué paso está este Legacy (leído del ledger) y te orienta al siguiente. Nunca firma y nunca ve tus datos.',
  'What is my next step?': '¿Cuál es mi siguiente paso?',
  'Why do I need the rehearsal before real capital?': '¿Por qué necesito el ensayo antes de meter capital real?',
  'What does closing the door change?': '¿Qué cambia al cerrar la puerta?',
  'How do I amend the constitution?': '¿Cómo enmiendo la constitución?',
  // ── Constitution templates gallery + builder ──
  'Choose a template (a starting point, not an imposition)': 'Elige una plantilla (un punto de partida, no una imposición)',
  'Pick a starting point (never an imposition — you edit everything)':
    'Elige un punto de partida (nunca una imposición — lo editas todo)',
  Templates: 'Plantillas',
  complete: 'completa',
  'fields pending': 'campos pendientes',
  'Preview — the document as it will read': 'Vista previa — el documento tal y como quedará',
  'Insert into the document editor': 'Insertar en el editor del documento',
  'Pending fields are marked [PENDING] in the text — fill them here or edit them there.':
    'Los campos pendientes quedan marcados [PENDIENTE] en el texto — rellénalos aquí o edítalos allí.',
  '12 months': '12 meses',
  'Everything filled — review the preview, then insert.': 'Todo relleno — revisa la vista previa e inserta.',
  'Everything on this form stays in your browser: the document is assembled and fingerprinted locally, and only its SHA-256 fingerprint is anchored on the ledger.':
    'Todo lo de este formulario se queda en tu navegador: el documento se ensambla y se huellea en local, y solo su huella SHA-256 se ancla en el ledger.',
  'Your draft auto-saves in this browser — a refresh will not lose it.':
    'Tu borrador se autoguarda en este navegador — un refresh no lo pierde.',
  'New QR': 'QR nuevo',
  'Personal patrimony (one person)': 'Patrimonio personal (una persona)',
  'The most basic case, and where most people start: your own capital, protected long-term by a quorum of YOUR OWN keys. No single key — lost, stolen or coerced — can move anything.':
    'El caso más básico y por el que casi todo el mundo empieza: tu propio capital, protegido a largo plazo por un quórum de TUS PROPIAS llaves. Ninguna llave sola — perdida, robada o coaccionada — puede mover nada.',
  '3 keys · quorum 2 — all yours': '3 llaves · quórum 2 — todas tuyas',
  'Why this patrimony exists, in your own words — what "long-term" means to you.':
    'Para qué existe este patrimonio, en tus palabras — qué significa «largo plazo» para ti.',
  'Kept in XRP on this account, outside the productive layer.':
    'Permanece en XRP en esta cuenta, fuera de la capa productiva.',
  'Share of each cycle’s yield that grows the base; the rest stays at your disposal.':
    'Parte del rendimiento de cada ciclo que hace crecer la base; el resto queda a tu disposición.',
  'Your keys': 'Tus llaves',
  'One per line: "device/key — rADDRESS — where its backup lives". All of them are YOURS — this is protection from a single point of failure, with no third parties.':
    'Una por línea: «dispositivo/llave — rDIRECCIÓN — dónde vive su backup». Todas son TUYAS — es protección contra el punto único de fallo, sin terceros.',
  'Total keys': 'Llaves totales',
  'coming soon — preview': 'próximamente — preview',
  'This template is a preview — it cannot be used yet. Constitute with the available template in the gallery.':
    'Esta plantilla es una preview — aún no se puede usar. Constituye con la plantilla disponible de la galería.',
  '4 signers · quorum 3': '4 firmantes · quórum 3',
  'Family patrimony': 'Patrimonio familiar',
  'The classic setup: a family council governs the capital; the base is untouchable, the fruits are shared by written rules.':
    'La configuración clásica: un consejo familiar gobierna el capital; la base es intocable y los frutos se reparten por reglas escritas.',
  '5 signers · quorum 3': '5 firmantes · quórum 3',
  'Fund for a child / education': 'Fondo para un hijo / educación',
  'One beneficiary with written conditions (age, milestones); a small council of guardians evaluates and delivers.':
    'Un beneficiario con condiciones escritas (edad, hitos); un consejo pequeño de tutores evalúa y entrega.',
  '3 signers · quorum 2': '3 firmantes · quórum 2',
  'Foundation / cause': 'Fundación / causa',
  'The fruits sustain a cause; a board of trustees governs by quorum. The base capital never leaves.':
    'Los frutos sostienen una causa; un consejo de patronos gobierna por quórum. El capital base nunca sale.',
  'Business continuity': 'Continuidad de un negocio',
  'A director runs where the capital produces, for a fixed term, without ever receiving the assets. The council can renew or revoke.':
    'Un director dirige dónde produce el capital, por un plazo definido, sin recibir jamás los activos. El consejo renueva o revoca.',
  'Simple savings for the kids': 'Ahorro simple para los hijos',
  'The minimum: a council and dated, programmed transfers. No productive layer, no complex rules.':
    'Lo mínimo: un consejo y transferencias programadas con fecha. Sin capa productiva, sin reglas complejas.',
  'Legacy name': 'Nombre del Legacy',
  'Legacy account (XRPL)': 'Cuenta del Legacy (XRPL)',
  'The council-governed account this constitution rules.': 'La cuenta gobernada por el consejo que esta constitución rige.',
  Purpose: 'Propósito',
  'What your great-grandchild will read: why this patrimony exists.':
    'Lo que leerá tu bisnieto: para qué existe este patrimonio.',
  'Native XRP reserve (%)': 'Reserva en XRP nativo (%)',
  'Kept in XRP on the council account, outside the productive layer.':
    'Permanece en XRP en la cuenta del consejo, fuera de la capa productiva.',
  'Fruits capitalized back (%)': 'Frutos que se capitalizan (%)',
  'Share of each cycle’s yield that grows the base.': 'Parte del rendimiento de cada ciclo que hace crecer la base.',
  'Fruits to a cause (%)': 'Frutos a una causa (%)',
  'The cause': 'La causa',
  'Distribution of the rest': 'Reparto del resto',
  'One line per branch/beneficiary: "Name — %". The listed shares should add up to 100.':
    'Una línea por rama/beneficiario: «Nombre — %». Los porcentajes deberían sumar 100.',
  'Beneficiary conditions': 'Condiciones de beneficiario',
  'One per line: "Beneficiary: written condition". The council evaluates them by quorum — nothing applies itself.':
    'Una por línea: «Beneficiario: condición escrita». Las evalúa el consejo por quórum — ninguna se aplica sola.',
  'Council members': 'Miembros del consejo',
  'One per line: "Name — rADDRESS — successor: Name, rADDRESS". These stay in this document only.':
    'Uno por línea: «Nombre — rDIRECCIÓN — sucesor: Nombre, rDIRECCIÓN». Solo viven en este documento.',
  'Total signers': 'Firmantes totales',
  'Survival folder URI': 'URI de la carpeta de supervivencia',
  'Where the offline instructions live (IPFS/Drive/paper location) — how to operate without Astryum.':
    'Dónde viven las instrucciones offline (IPFS/Drive/papel) — cómo operar sin Astryum.',
  'The child’s name as it should read in the document.': 'El nombre del hijo tal y como debe leerse en el documento.',
  'Deliveries and milestones': 'Entregas e hitos',
  'One per line: "condition/date → what is delivered". Dated deliveries are enforced by the ledger (escrow); condition-based ones are evaluated by the council.':
    'Una por línea: «condición/fecha → qué se entrega». Las entregas con fecha las impone el ledger (escrow); las de condición las evalúa el consejo.',
  'Guardian council': 'Consejo de tutores',
  'One per line: "Name — rADDRESS — successor".': 'Uno por línea: «Nombre — rDIRECCIÓN — sucesor».',
  'Use of the fruits': 'Uso de los frutos',
  'Written rules for what the yield may fund (and what it may not).':
    'Reglas escritas de qué puede financiar el rendimiento (y qué no).',
  'Board of trustees': 'Consejo de patronos',
  Director: 'Director',
  'Name of the person who directs where the capital produces.': 'Nombre de quien dirige dónde produce el capital.',
  'Term of the mandate': 'Plazo del mandato',
  'Director’s limits': 'Límites del director',
  'What the director may and may not do. They never receive the assets.':
    'Qué puede y qué no puede hacer el director. Jamás recibe los activos.',
  'Beneficiaries and dates': 'Beneficiarios y fechas',
  'One per line: "Name — delivery date — amount/share". Dated transfers are enforced by the ledger.':
    'Uno por línea: «Nombre — fecha de entrega — cantidad/parte». Las transferencias con fecha las impone el ledger.',
  'Constitute a new Legacy': 'Constituir un nuevo Legacy',
  'No Legacies yet': 'Aún no hay Legacies',
  'Constitute a new one, or observe an account you govern below. The ledger cannot tell Astryum which councils you sign on — you point us to the address, we read its state.':
    'Constituye uno nuevo, u observa abajo una cuenta que gobiernes. El ledger no puede decirle a Astryum en qué consejos firmas — tú nos señalas la dirección, nosotros leemos su estado.',
  'could not read': 'no se pudo leer',
  'not a council yet': 'aún no es un consejo',
  'signers': 'firmantes',
  // Organismo Legacy del Summary (coherencia de producto, 2026-07-18).
  'No Legacy loaded': 'Sin Legacy cargado',
  'Constitute one — or observe one you govern — and it will live here.':
    'Constituye uno — u observa uno que gobiernes — y vivirá aquí.',
  'Open Legacy': 'Abrir Legacy',
  'Capital under rules': 'Capital bajo reglas',
  'Spendable after reserves': 'Disponible tras reservas',
  'Programmed transfers': 'Transferencias programadas',
  'next': 'próxima',
  'In this product you propose — the council signs. Astryum never signs, never holds custody.':
    'En este producto propones — firma el consejo. Astryum nunca firma ni custodia.',
  // Personal = solo wallets normales; los consejos viven en su Legacy (2026-07-18).
  '1 council account (multisig) lives in Astryum Legacy — switch the product toggle to see it inside its Legacy.':
    '1 cuenta de consejo (multisig) vive en Astryum Legacy — cambia el toggle de producto para verla dentro de su Legacy.',
  'council accounts (multisig) live in Astryum Legacy — switch the product toggle to see them inside their Legacy.':
    'cuentas de consejo (multisig) viven en Astryum Legacy — cambia el toggle de producto para verlas dentro de su Legacy.',
  // Toggle de producto (2026-07-18): Personal ↔ Legacy, en el sidebar.
  'Product': 'Producto',
  'Personal': 'Personal',
  'Astryum product active': 'Producto Astryum activo',
  'Personal product active': 'Producto Personal activo',
  'Legacy product active': 'Producto Legacy activo',
  'No Legacy yet — constitute it in its tab': 'Aún sin Legacy — constitúyelo en su pestaña',
  'wallet connected': 'wallet conectada',
  'wallets connected': 'wallets conectadas',
  // Switcher de autoridad (2026-07-17): la barra de contexto del shell.
  'Operating as': 'Operando como',
  'You execute — you sign directly': 'Ejecutas — firmas tú directamente',
  'You propose — the council signs': 'Propones — firma el consejo',
  'Switch account': 'Cambiar de cuenta',
  'Your accounts': 'Tus cuentas',
  'Governed Legacies': 'Legacies gobernados',
  'Open in Legacy': 'Abrir en Legacy',
  'No wallet connected': 'Sin wallet conectada',
  'council': 'consejo',
  'Remove from list': 'Quitar de la lista',
  'Observe a Legacy you govern': 'Observa un Legacy que gobiernes',
  'Are you a signer on a family or shared Legacy? Add its account address and Astryum will read its state from the ledger. This only points at an address you already govern — it grants no access.':
    '¿Eres firmante de un Legacy familiar o compartido? Añade la dirección de su cuenta y Astryum leerá su estado del ledger. Esto solo apunta a una dirección que ya gobiernas — no concede ningún acceso.',
  'Observe': 'Observar',
  'Enter a valid XRPL address (r…).': 'Introduce una dirección XRPL válida (r…).',
  'That account is already in your list.': 'Esa cuenta ya está en tu lista.',
  'Emergency: replace the fallen signer': 'Emergencia: reemplaza al firmante caído',
  'Next: run the signing rehearsal': 'Siguiente: haz el ensayo de firma',
  'Next: close the master-key door': 'Siguiente: cierra la puerta de la master key',
  'Constituted and healthy': 'Constituido y sano',
  'Not a council yet': 'Aún no es un consejo',
  // Coordinador multisig en el panel (ADR-008): N QRs → verificar → combinar → broadcast.
  'This account is governed by a council (multisig). Astryum composes the transaction; your council signs it here, each member from their own device. Astryum never signs or broadcasts on your behalf.':
    'Esta cuenta está gobernada por un consejo (multisig). Astryum compone la transacción; tu consejo la firma aquí, cada miembro desde su propio dispositivo. Astryum nunca firma ni hace broadcast por ti.',
  'Prefer your own multisign tool?': '¿Prefieres tu propia herramienta de multifirma?',
  'Hide manual signing': 'Ocultar firma manual',
  'Gather the council’s signatures': 'Reunir las firmas del consejo',
  // Los dos tempos, nombrados (2026-08-04): síncrono aquí, asíncrono en la
  // bandeja. Cada botón dice DÓNDE firma cada miembro, no solo cuánto tarda.
  'Sign now, all together': 'Firmar ahora, todos juntos',
  'Everyone signs in this sitting: one QR per member on this screen, and a notification to the Xaman of anyone who has signed here before. Nothing is stored — if this screen closes, the signatures are lost.':
    'Todos firman en esta sesión: un QR por miembro en esta pantalla, y un aviso al Xaman de quien ya haya firmado aquí antes. No se guarda nada — si se cierra esta pantalla, las firmas se pierden.',
  'Council signatures': 'Firmas del consejo',
  'Reading the council and pinning the transaction…': 'Leyendo el consejo y fijando la transacción…',
  'Ledger dry-run: this transaction would succeed': 'Simulación en el ledger: esta transacción tendría éxito',
  'Ledger dry-run says it would FAIL:': 'La simulación en el ledger dice que FALLARÍA:',
  'Ledger dry-run unavailable on this node — proceed with care.':
    'Simulación no disponible en este nodo — procede con cuidado.',
  'base': 'base',
  'Xaman QR': 'QR de Xaman',
  'waiting for signature': 'esperando firma',
  'open in Xaman': 'abrir en Xaman',
  'rejected / expired': 'rechazada / expirada',
  'error': 'error',
  'Combine & broadcast': 'Combinar y enviar',
  'Waiting for the quorum…': 'Esperando al quórum…',
  'Combining the signatures and broadcasting from your browser…':
    'Combinando las firmas y haciendo broadcast desde tu navegador…',
  'Broadcast — the ledger accepted it.': 'Enviada — el ledger la aceptó.',
  // Constituir el consejo desde 0 (builder SignerListSet).
  'Constitute it below: 1–32 signers with weights and a quorum (5 signers, quorum 3 is the recommended family setup). Astryum composes the SignerListSet; you sign it with THIS account’s key. Astryum never holds a key.':
    'Constitúyelo abajo: 1–32 firmantes con pesos y un quórum (5 firmantes, quórum 3 es la configuración familiar recomendada). Astryum compone el SignerListSet; tú lo firmas con la llave de ESTA cuenta. Astryum nunca guarda una llave.',
  'Constitute it below: 1–32 signers with weights and a quorum. The form starts at 3 signers, quorum 2 (a simple majority); a larger family may prefer 5 with quorum 3. Astryum composes the SignerListSet; you sign it with THIS account’s key. Astryum never holds a key.':
    'Constitúyelo abajo: 1–32 firmantes con pesos y un quórum. El formulario arranca con 3 firmantes y quórum 2 (mayoría simple); una familia grande puede preferir 5 con quórum 3. Astryum compone el SignerListSet; tú lo firmas con la llave de ESTA cuenta. Astryum nunca guarda una llave.',
  // ── Paso 2 de la constitución: el consejo se crea en el xApp Multisign de
  //    Xaman (2026-08-03). Xaman rechaza un SignerListSet compuesto por
  //    cualquier app (401 / 1217); Astryum prepara la lista, la revisa, guía
  //    pantalla a pantalla y después lee el ledger para confirmarla. ──
  'Constitute it in three moves: write the list of signers here (1–32, with weights and a quorum — 5 signers with quorum 3 is the recommended family setup), create it in the Xaman Multisign xApp following the steps below, and come back so Astryum reads it from the ledger. Astryum never holds a key.':
    'Constitúyelo en tres movimientos: escribe aquí la lista de firmantes (1–32, con pesos y un quórum — 5 firmantes con quórum 3 es la configuración familiar recomendada), créalo en el xApp Multisign de Xaman siguiendo los pasos de abajo, y vuelve para que Astryum lo lea del ledger. Astryum nunca guarda una llave.',
  'The council is created in Xaman, not here': 'El consejo se crea en Xaman, no aquí',
  'Try it in Xaman anyway': 'Intentarlo en Xaman de todos modos',
  'Expect “No permission to create this type of sign request” (1217) until Xaman authorises it for Astryum.':
    'Espera un «No permission to create this type of sign request» (1217) hasta que Xaman lo autorice para Astryum.',
  'The signer list is the one transaction that hands over control of an account, and Xaman only lets its own tools compose that type — it refuses a request built by any app, Astryum included. So you create the council in the Xaman Multisign xApp, from the phone that holds this account’s key.':
    'La lista de firmantes es la única transacción que entrega el control de una cuenta, y Xaman solo deja componer ese tipo a sus propias herramientas — rechaza una petición creada por cualquier app, Astryum incluida. Así que el consejo lo creas en el xApp Multisign de Xaman, desde el móvil que guarda la llave de esta cuenta.',
  'It is also how it should be: Astryum is not a wallet and never touches a key. What Astryum does here is prepare the exact list, check it for the mistakes that cannot be undone, and read the ledger afterwards to confirm what you created. Everything after this step — the rehearsal, closing the door, the constitution — happens back here.':
    'Y es como debe ser: Astryum no es una wallet y no toca una llave jamás. Lo que hace aquí es preparar la lista exacta, revisarla buscando los errores que no tienen vuelta atrás, y después leer el ledger para confirmar lo que has creado. Todo lo que viene tras este paso — el ensayo, cerrar la puerta, la constitución — se hace aquí.',
  'Before you start — four things, in this order': 'Antes de empezar — cuatro cosas, en este orden',
  'Each member has their own Xaman, on their own phone.':
    'Cada miembro tiene su propio Xaman, en su propio móvil.',
  'You do not create their accounts — each person creates their own and sends you their address (r…). That is the difference between a council and a bank account: nobody holds anybody else’s key.':
    'Tú no creas sus cuentas — cada uno crea la suya y te pasa su dirección (r…). Esa es la diferencia entre un consejo y una cuenta bancaria: nadie tiene la llave de nadie.',
  'You have THIS account in your own Xaman.': 'Tienes ESTA cuenta en tu propio Xaman.',
  'The signer list is signed by the account’s own master key — the account being governed, not yours.':
    'La lista de firmantes la firma la llave maestra de la propia cuenta — la cuenta que se va a gobernar, no la tuya.',
  'The account holds enough XRP.': 'La cuenta tiene XRP suficiente.',
  'The whole ceremony needs about': 'La ceremonia entera necesita unos',
  'held in the account.': 'en la cuenta.',
  'About 15 XRP covers the reserves and the fees of the whole ceremony.':
    'Unos 15 XRP cubren las reservas y las comisiones de toda la ceremonia.',
  'The xApp may create Tickets of its own before the signer list, and each one locks reserve too — a signature that fails for insufficient reserve still burns its fee.':
    'El xApp puede crear Tickets propios antes de la lista de firmantes, y cada uno bloquea reserva también — una firma que falla por reserva insuficiente igual quema su comisión.',
  'You have decided who is in and how many signatures decide.':
    'Habéis decidido quién está y cuántas firmas deciden.',
  'Five signers with a quorum of three is the recommended family setup. Never 2-of-2 nor 2-of-3: one lost key and you are left with no margin at all.':
    'Cinco firmantes con quórum de tres es la configuración familiar recomendada. Nunca 2-de-2 ni 2-de-3: una llave perdida y os quedáis sin ningún margen.',
  '1 · Write the list here first': '1 · Escribe la lista aquí primero',
  'ready to type into Xaman': 'lista para teclear en Xaman',
  'list not ready yet': 'lista incompleta',
  'Nothing here is sent anywhere and nothing is signed — this is the checked list you will copy into the wallet. Astryum verifies each address (a single wrong character is a member who can never sign) and refuses a quorum higher than the total, which would lock the account forever.':
    'Nada de esto se envía a ningún sitio ni se firma — es la lista revisada que vas a copiar en la wallet. Astryum verifica cada dirección (un solo carácter mal es un miembro que no podrá firmar nunca) y rechaza un quórum mayor que el total, que dejaría la cuenta bloqueada para siempre.',
  'Type exactly this into the xApp': 'Teclea exactamente esto en el xApp',
  'Copy the whole list': 'Copiar la lista entera',
  Copy: 'Copiar',
  '2 · The exact steps in Xaman': '2 · Los pasos exactos en Xaman',
  'The Multisign xApp is made by XRPL Labs (the makers of Xaman) and its wording may change between versions — what you are looking for is the SIGNER LIST section, not the one for signing a transaction that already exists.':
    'El xApp Multisign es de XRPL Labs (los de Xaman) y sus textos pueden cambiar entre versiones — lo que buscas es la sección de la LISTA DE FIRMANTES (signer list), no la de firmar una transacción que ya existe.',
  'Open Xaman on the phone that holds this account’s key.':
    'Abre Xaman en el móvil que guarda la llave de esta cuenta.',
  'Check the account shown at the top: it must be exactly the account you are constituting. If you hold several, switch to it now — a signer list created on the wrong account governs the wrong account, and you would only find out later.':
    'Comprueba la cuenta que aparece arriba: tiene que ser exactamente la que estás constituyendo. Si tienes varias, cambia a esta ahora — una lista de firmantes creada sobre la cuenta equivocada gobierna la cuenta equivocada, y lo descubrirías tarde.',
  'Open the Multisign xApp.': 'Abre el xApp Multisign.',
  'In Xaman: the xApps tab → search for “Multisign” → open it. Or open this link on the phone (it only works on a device that has Xaman installed):':
    'En Xaman: pestaña xApps → busca «Multisign» → ábrelo. O abre este enlace en el móvil (solo funciona en un dispositivo que tenga Xaman instalado):',
  'Open the Multisign xApp': 'Abrir el xApp Multisign',
  'Copy the link for the phone': 'Copiar el enlace para el móvil',
  'Choose to create the signer list of this account.':
    'Elige crear la lista de firmantes de esta cuenta.',
  'The xApp does two different jobs: define WHO signs for an account (this, the signer list) and collect signatures for a transaction that already exists (that one you will not need — Astryum gathers the council’s signatures itself, later). Pick the first.':
    'El xApp hace dos cosas distintas: definir QUIÉN firma por una cuenta (esto, la lista de firmantes) y reunir firmas para una transacción que ya existe (esa no la vas a necesitar — las firmas del consejo las reúne Astryum, más adelante). Elige la primera.',
  'Add the members, one by one, exactly as listed above.':
    'Añade a los miembros, uno a uno, exactamente como están arriba.',
  'Paste each address — never retype it by hand — and set its weight to 1 unless you deliberately want someone to weigh more. Add all of them before continuing: the list you send REPLACES anything that was there; it is not added to it.':
    'Pega cada dirección — nunca la reescribas a mano — y deja su peso en 1 salvo que quieras a propósito que alguien pese más. Añádelos a todos antes de continuar: la lista que envías SUSTITUYE a lo que hubiera; no se suma.',
  'Set the quorum to': 'Pon el quórum en',
  'That is how many votes any decision needs, out of the total on the list. What is left over is the margin: the votes you can lose before the council can no longer decide anything.':
    'Esos son los votos que necesita cualquier decisión, sobre el total de la lista. Lo que sobra es el margen: los votos que podéis perder antes de que el consejo ya no pueda decidir nada.',
  'Finish the list above and this figure will say exactly what to type.':
    'Termina la lista de arriba y esta cifra te dirá exactamente qué teclear.',
  'Compare the review screen against the list above, line by line.':
    'Compara la pantalla de revisión con la lista de arriba, línea a línea.',
  'This is the last cheap moment. One wrong character in one address is a member who can never sign — and once the master key is disabled, a council short of quorum cannot be repaired by anyone, ever. If anything differs, cancel and start the screen again.':
    'Este es el último momento barato. Un carácter mal en una dirección es un miembro que no podrá firmar nunca — y con la llave maestra deshabilitada, un consejo por debajo del quórum no lo arregla nadie, jamás. Si algo difiere, cancela y repite la pantalla.',
  'Accept Xaman’s warning and slide to sign.': 'Acepta el aviso de Xaman y desliza para firmar.',
  'Xaman shows a red warning before this signature. It is expected, and it is literally true — this is the transaction that hands the account to the council. Its exact words:':
    'Xaman enseña un aviso en rojo antes de esta firma. Es esperado, y es literalmente cierto — esta es la transacción que entrega la cuenta al consejo. Sus palabras exactas:',
  'You are signing with the account’s master key — the council does not exist yet, so it cannot sign its own creation. The master key stays ACTIVE after this: it is your safety net until the rehearsal proves every member can sign.':
    'Estás firmando con la llave maestra de la cuenta — el consejo aún no existe, así que no puede firmar su propia creación. La llave maestra sigue ACTIVA después de esto: es tu red de seguridad hasta que el ensayo demuestre que todos los miembros saben firmar.',
  'Wait until the ledger validates it.': 'Espera a que el ledger la valide.',
  'A few seconds. If it fails with tecINSUFFICIENT_RESERVE, the account is short of XRP: top it up and repeat the screen — the failed attempt only cost its fee.':
    'Unos segundos. Si falla con tecINSUFFICIENT_RESERVE, la cuenta va corta de XRP: fondéala y repite la pantalla — el intento fallido solo ha costado su comisión.',
  'While you are in the wallet, do NOT disable the master key — not from the xApp, not from Xaman’s account settings. That is step 4, it is done from Astryum, and only after the rehearsal proves every member can sign. Disabling it now, with a council nobody has tested, locks the account forever.':
    'Mientras estés en la wallet, NO deshabilites la llave maestra — ni desde el xApp, ni desde los ajustes de la cuenta en Xaman. Eso es el paso 4, se hace desde Astryum, y solo después de que el ensayo demuestre que todos saben firmar. Deshabilitarla ahora, con un consejo que nadie ha probado, bloquea la cuenta para siempre.',
  '3 · Come back here and check it against the ledger':
    '3 · Vuelve aquí y compruébalo contra el ledger',
  'The wallet saying “signed” is not the proof — the ledger is. Astryum reads the signer list straight from the ledger and compares it with the plan you wrote above, member by member.':
    'Que la wallet diga «firmado» no es la prueba — la prueba es el ledger. Astryum lee la lista de firmantes directamente del ledger y la compara con el plan que escribiste arriba, miembro a miembro.',
  'I have done it — read the council from the ledger':
    'Ya está hecho — leer el consejo del ledger',
  'If it does not appear yet, wait a few seconds and press again. If it appears but does not match your plan, you can still repeat the screen in the xApp with the corrected list — the master key is still active, and the new list replaces the old one entirely.':
    'Si aún no aparece, espera unos segundos y vuelve a pulsar. Si aparece pero no coincide con tu plan, todavía puedes repetir la pantalla en el xApp con la lista corregida — la llave maestra sigue activa, y la lista nueva sustituye entera a la anterior.',
  'From here on, everything is back in Astryum: the signing rehearsal (step 3), closing the door (step 4) and the constitution (step 5). You will not need the xApp again — except the day you have to replace a signer.':
    'De aquí en adelante, todo vuelve a Astryum: el ensayo de firma (paso 3), cerrar la puerta (paso 4) y la constitución (paso 5). No necesitarás el xApp otra vez — salvo el día que haya que sustituir a un firmante.',
  'Not using Xaman? (Ledger, Crossmark, xrpl.services)':
    '¿No usáis Xaman? (Ledger, Crossmark, xrpl.services)',
  'Astryum can still compose the unsigned transaction for the list above. Copy it into the tool that holds this account’s key and sign it there. Do not try to sign it with Xaman: it rejects this type of request from any app (error 1217) — that is the whole reason the guide above exists.':
    'Astryum sí puede componer la transacción sin firmar de la lista de arriba. Cópiala en la herramienta que guarda la llave de esta cuenta y fírmala ahí. No intentes firmarla con Xaman: rechaza este tipo de petición venga de la app que venga (error 1217) — esa es toda la razón de que exista la guía de arriba.',
  'Compose the unsigned transaction': 'Componer la transacción sin firmar',
  'Your own tool fills in the Sequence and the Fee before signing. Change nothing else: the signers and the quorum are the transaction.':
    'Tu propia herramienta rellena el Sequence y la Fee antes de firmar. No cambies nada más: los firmantes y el quórum SON la transacción.',
  // Comprobación del plan contra el ledger (la otra mitad del paso 2).
  'The council on the ledger matches the plan you prepared, member by member.':
    'El consejo del ledger coincide con el plan que preparaste, miembro a miembro.',
  'Got it': 'Entendido',
  'The council on the ledger does NOT match the plan you prepared. Check it before going any further — while the master key is still active, you can send a corrected signer list from the Xaman Multisign xApp.':
    'El consejo del ledger NO coincide con el plan que preparaste. Revísalo antes de seguir — mientras la llave maestra siga activa, puedes enviar una lista de firmantes corregida desde el xApp Multisign de Xaman.',
  'Quorum — planned vs on the ledger': 'Quórum — planeado frente al del ledger',
  'Planned but NOT on the ledger': 'Planeado pero NO está en el ledger',
  'On the ledger but not in your plan': 'Está en el ledger pero no en tu plan',
  'weight — planned vs on the ledger': 'peso — planeado frente al del ledger',
  'The council is correct — stop comparing': 'El consejo es correcto — deja de comparar',
  'A signer list holds at most 32 members.':
    'Una lista de firmantes admite 32 miembros como máximo.',
  'Xaman refuses to show a QR for this transaction type when an app composes it (error 1217), so the signature rail below may not work today. What does work: the members sign it in the Xaman Multisign xApp, or paste their signed blob into the proposal inbox. The council can always be amended — the route through this screen is what is blocked.':
    'Xaman se niega a enseñar un QR de este tipo de transacción cuando la compone una app (error 1217), así que el carril de firma de abajo puede no funcionar hoy. Lo que sí funciona: que los miembros la firmen en el xApp Multisign de Xaman, o que peguen su blob firmado en la bandeja de propuestas. El consejo se puede enmendar siempre — lo bloqueado es el camino por esta pantalla.',

  // ── Validación del consejo (F10, 2026-07-30) ──
  'Add at least one signer address.': 'Añade al menos una dirección de firmante.',
  'This is not an XRPL address (r…)': 'Esto no es una dirección XRPL (r…)',
  'The account cannot be one of its own signers.': 'La cuenta no puede ser uno de sus propios firmantes.',
  'Duplicated signer': 'Firmante duplicado',
  'Every weight must be a whole number of votes (1 or more).':
    'Cada peso debe ser un número entero de votos (1 o más).',
  'The quorum must be a whole number of votes (1 or more).':
    'El quórum debe ser un número entero de votos (1 o más).',
  'The quorum exceeds the total votes — no decision could EVER pass and the account would lock forever.':
    'El quórum supera el total de votos — NINGUNA decisión podría aprobarse y la cuenta quedaría bloqueada para siempre.',
  'Decisions need': 'Decidir necesita',
  'votes. Keys you can lose without locking the account:':
    'votos. Llaves que podéis perder sin bloquear la cuenta:',
  'votes — MORE than the total: no decision could ever pass. Lower the quorum or add signers.':
    'votos — MÁS que el total: ninguna decisión podría aprobarse. Baja el quórum o añade firmantes.',
  'Leave the weight at 1 if every member counts the same.':
    'Deja el peso en 1 si todos los miembros cuentan igual.',
  'Signer address': 'Dirección del firmante',
  'Weight': 'Peso',
  'Add signer': 'Añadir firmante',
  'Quorum': 'Quórum',
  'Prepare the council': 'Preparar el consejo',
  'Council created — refresh to read it from the ledger.':
    'Consejo creado — actualiza para leerlo del ledger.',
  'Prefer your own tools?': '¿Prefieres tus propias herramientas?',
  'Ledger dry-run…': 'Simulación en el ledger…',
  'Not enough spendable XRP on the Legacy account.':
    'No hay XRP gastable suficiente en la cuenta Legacy.',
  'Recovery date (default: delivery + 1 year — unclaimed funds return)':
    'Fecha de recuperación (por defecto: entrega + 1 año — lo no reclamado vuelve)',
  'No recovery date: this commitment can NEVER be undone. If the beneficiary loses their key, the XRP is unrecoverable forever. Strongly consider keeping one.':
    'Sin fecha de recuperación este compromiso no puede deshacerse JAMÁS. Si el beneficiario pierde su llave, el XRP queda irrecuperable para siempre. Considera seriamente mantenerla.',
  'This XRP will produce NOTHING for the whole lock. Programmed transfers suit short commitments and ceremonies — to sustain someone over time, prefer shorter, renewable commitments.':
    'Este XRP no producirá NADA durante todo el bloqueo. Las transferencias programadas son para compromisos cortos y ceremonias — para sostener a alguien en el tiempo, mejor compromisos más cortos y renovables.',
  'The multisign tool fills in Sequence and Fee (a multisig transaction pays a higher fee: one extra unit per signer).':
    'La herramienta de multifirma rellena Sequence y Fee (una transacción multisig paga una fee mayor: una unidad extra por firmante).',
  'This account has a DID, but it does not anchor a document fingerprint (no Data field) — anchoring a constitution will replace it.':
    'Esta cuenta tiene un DID, pero no ancla la huella de ningún documento (sin campo Data) — anclar una constitución lo sustituirá.',
  'Verification hashes the EXACT bytes: a changed space or line break is a different document.':
    'La verificación hashea los bytes EXACTOS: un espacio o salto de línea distinto es otro documento.',
  'it may already have been delivered (anyone can, after the date); the XRP always ends at the beneficiary.':
    'puede que ya estuviera entregado (cualquiera puede, pasada la fecha); el XRP siempre acaba en el beneficiario.',
  'it may already have been recovered (anyone can, after expiry); the XRP always returns to the creator.':
    'puede que ya estuviera recuperado (cualquiera puede, pasada la expiración); el XRP siempre vuelve al creador.',
  Beneficiary: 'Beneficiario',
  'Deliverable from': 'Entregable desde',
  'Recoverable after': 'Recuperable después de',
  'Funds return to the creator': 'Los fondos vuelven al creador',
  'Anyone can deliver after the date': 'Cualquiera puede entregar pasada la fecha',
  'Anyone can recover after expiry': 'Cualquiera puede recuperar pasada la expiración',
  'Document fingerprint (SHA-256)': 'Huella del documento (SHA-256)',
  'Document URI': 'URI del documento',
  'Enforces by itself': 'Obliga por sí misma',
  'Amendable by the quorum': 'Enmendable por el quórum',

  // ── Legacy — el asistente de constitución (candado + ensayo + espejo) ──
  Council: 'Consejo',
  Rehearsal: 'Ensayo',
  'Door closed': 'Puerta cerrada',
  Constitution: 'Constitución',
  // 'Capital' ya existe arriba (línea ~1330) con la misma traducción.
  margin: 'margen',
  signed: 'firmaron',
  owners: 'owners',
  threshold: 'umbral',
  Compare: 'Comparar',
  'The signing rehearsal is not verified yet — do NOT put real capital in. Until every council member has signed on-chain, a disabled master key would lock this account forever.':
    'El ensayo de firma aún no está verificado — NO metas capital real. Hasta que cada miembro del consejo haya firmado on-chain, deshabilitar la llave maestra podría bloquear esta cuenta para siempre.',
  'master key active — rehearsal passed: time to close the door':
    'llave maestra activa — ensayo superado: toca cerrar la puerta',
  'master key active — CORRECT for now: it is your safety net until the rehearsal passes':
    'llave maestra activa — CORRECTO por ahora: es tu red de seguridad hasta superar el ensayo',
  'You are at the EXACT quorum. One more lost key and this account is locked forever. Replace the missing signer BEFORE any other operation.':
    'Estáis en el quórum EXACTO. Una llave perdida más y la cuenta queda bloqueada para siempre. Reemplazad al firmante caído ANTES de cualquier otra operación.',
  'Astryum sees how many signers exist, not how many can still sign — the yearly re-rehearsal is the only way to know that.':
    'Astryum ve cuántos firmantes hay, no cuántos pueden firmar todavía — el reensayo anual es la única forma de saberlo.',
  'Closing the door (disable the master key)': 'Cerrar la puerta (deshabilitar la llave maestra)',
  'Locked until the rehearsal is verified on-chain. Disabling the master key before every member has proven they can sign would risk locking this account forever — nobody could rescue it.':
    'Bloqueado hasta que el ensayo esté verificado on-chain. Deshabilitar la llave maestra antes de que cada miembro haya demostrado que sabe firmar arriesga bloquear esta cuenta para siempre — nadie podría rescatarla.',
  'The rehearsal passed. From here on, closing the door is the recommended next step.':
    'El ensayo está superado. A partir de aquí, cerrar la puerta es el siguiente paso recomendado.',
  'I want to close the door': 'Quiero cerrar la puerta',
  'From now on this account only obeys the council. If the quorum cannot sign, the capital is inaccessible forever. Have ALL of you completed the rehearsal, each from their own device?':
    'A partir de ahora esta cuenta solo obedece al consejo. Si el quórum no puede firmar, el capital queda inaccesible para siempre. ¿Habéis completado el ensayo TODOS, cada uno desde su dispositivo?',
  'Astryum does not compose this transaction (account configuration is yours — we are not a wallet): do it from your own tools.':
    'Astryum no compone esta transacción (la configuración de la cuenta es tuya — no somos una wallet): hazlo desde tus propias herramientas.',
  'The signing rehearsal': 'El ensayo de firma',
  'verified on-chain': 'verificado on-chain',
  'One commitment of 1 XRP, from this account to itself, delivered tomorrow, recoverable in a week. Each member must sign it THEMSELVES, from their own device — if you help them, you have proven nothing except that YOU can sign. Include EVERY signature, not just the quorum (a 3-of-5 transaction only proves three), or repeat until everyone has signed once.':
    'Un compromiso de 1 XRP, de esta cuenta a sí misma, entregable mañana, recuperable en una semana. Cada miembro debe firmarlo ÉL MISMO, desde su propio dispositivo — si le ayudas, no has probado nada salvo que TÚ sabes firmar. Incluid TODAS las firmas, no solo el quórum (una transacción 3-de-5 solo prueba a tres), o repetid hasta que todos hayan firmado alguna vez.',
  'has signed on-chain': 'ha firmado on-chain',
  'never signed yet': 'aún no firmó nunca',
  'What the ledger proves: which accounts signed a validated transaction. What it cannot prove: that each person did it personally — that discipline is yours.':
    'Lo que el ledger prueba: qué cuentas firmaron una transacción validada. Lo que no puede probar: que cada persona lo hizo en persona — esa disciplina es vuestra.',
  'Prepare the rehearsal (1 XRP)': 'Preparar el ensayo (1 XRP)',
  'Once submitted, refresh: the verification reads the validated transaction from the ledger.':
    'Cuando la enviéis, refresca: la verificación lee la transacción validada del ledger.',
  'Start from the template (a starting point, not an imposition)':
    'Empezar desde la plantilla (un punto de partida, no una imposición)',
  'This template does not replace a lawyer. In many countries forced-heirship rules exist: a court can override parts of what you write. Get advice before constituting with real wealth.':
    'Esta plantilla no sustituye a un abogado. En muchos países existe la legítima: un tribunal puede anular partes de lo que escribas. Asesórate antes de constituir con patrimonio real.',
  'The vault mirror (Flare)': 'El espejo del vault (Flare)',
  'When the productive capital lives in the LegacyVault on Flare, its council is a SECOND multisig with the same humans — and the two sides do not sync themselves. Until the FDC enforcement exists, the vault is governed by its EVM council: this check tells you if the two have drifted apart.':
    'Cuando el capital productivo vive en el LegacyVault de Flare, su consejo es un SEGUNDO multisig con los mismos humanos — y los dos lados no se sincronizan solos. Hasta que exista el enforcement FDC, el vault lo gobierna su consejo EVM: este chequeo te dice si los dos han divergido.',
  'LegacyVault address (Flare)': 'Dirección del LegacyVault (Flare)',
  'vault council': 'consejo del vault',
  'single key (EOA) — testing phase, not a council': 'una sola llave (EOA) — fase de pruebas, no un consejo',
  'contract (owners not readable)': 'contrato (owners no legibles)',
  'Counts match: same number of members and same threshold on both sides.':
    'Los recuentos cuadran: mismo número de miembros y mismo umbral en ambos lados.',
  'The two councils have DRIFTED:': 'Los dos consejos han DIVERGIDO:',
  'The productive capital is governed by the Flare side. Replicate the change today (PROTOCOLO_CONSEJO §5).':
    'El capital productivo lo gobierna el lado de Flare. Replica el cambio hoy mismo (PROTOCOLO_CONSEJO §5).',
  'XRPL addresses (r…) and Flare addresses (0x…) are not comparable — only counts and thresholds are. Keeping the same humans behind both lists is the council’s discipline, not something any code can verify.':
    'Las direcciones XRPL (r…) y las de Flare (0x…) no son comparables — solo los recuentos y umbrales lo son. Que detrás de ambas listas estén los mismos humanos es disciplina del consejo, no algo que ningún código pueda verificar.',
  'Enter a valid Flare address (0x…).': 'Introduce una dirección de Flare válida (0x…).',

  // ── Authority switcher + governed context bar (ADR-009) ──
  'Overview': 'Panorámica',
  'All simple wallets, aggregated': 'Todas las wallets simples, agregadas',
  'Switch authority account': 'Cambiar de cuenta de autoridad',
  'Authority accounts': 'Cuentas de autoridad',
  'Simple accounts': 'Cuentas simples',
  'Governed accounts': 'Cuentas gobernadas',
  'single key': 'llave única',
  'reading ledger…': 'leyendo el ledger…',
  'health: at risk': 'salud: en riesgo',
  'health: attention': 'salud: atención',
  'health: sound': 'salud: sana',
  'health: unknown': 'salud: desconocida',
  'Constitute a governed account': 'Constituir una cuenta gobernada',
  'Governing': 'Gobernando',
  'waiting for your signature': 'esperando tu firma',
  'Leave governed mode': 'Salir del modo gobernado',
  'exit': 'salir',
  'You are governing a council account': 'Estás gobernando una cuenta de consejo',
  "Earn entries are signed by simple wallets. The council's capital moves only by council order — signed by the quorum — from the Legacy panel.":
    'Las entradas de Earn las firman wallets simples. El capital del consejo solo se mueve por orden del consejo — firmada por el quórum — desde el panel Legacy.',
  'Switch to Overview': 'Cambiar a Panorámica',
  'The active account cannot sign this entry': 'La cuenta activa no puede firmar esta entrada',
  'Switch account in the sidebar switcher, or connect another wallet.':
    'Cambia de cuenta en el selector del menú lateral, o conecta otra wallet.',

  // ── Proposal inbox (bandeja del modo gobernado) ──
  'Proposal inbox': 'Bandeja de propuestas',
  'A quorum signs asynchronously: propose, each member signs when they can, combine and broadcast from the browser once the quorum is met. Proposals expire after 7 days.':
    'Un quórum firma de forma asíncrona: se propone, cada miembro firma cuando puede, y al alcanzarse el quórum se combina y emite desde el navegador. Las propuestas caducan a los 7 días.',
  // Un asiento por cuenta (2026-08-04): la bandeja solo emite TU QR.
  'A quorum signs asynchronously: propose, and each member signs from THEIR OWN account with their own linked wallet, whenever they can. You only ever sign your own seat here. Once the quorum is met, anyone combines and broadcasts from the browser. Proposals expire after 7 days.':
    'Un quórum firma de forma asíncrona: se propone, y cada miembro firma desde SU PROPIA cuenta con su propia wallet enlazada, cuando pueda. Aquí solo firmas tu asiento. Al alcanzarse el quórum, cualquiera combina y emite desde el navegador. Las propuestas caducan a los 7 días.',
  'No signature of yours is pending here: none of this council’s seats belongs to a wallet linked to this account. Each councillor signs from their own Astryum — if one of these addresses is yours, connect it in Xaman. To sign together in one sitting, use the live ceremony instead.':
    'Aquí no hay ninguna firma tuya pendiente: ninguno de los asientos de este consejo es de una wallet enlazada a esta cuenta. Cada consejero firma desde su propio Astryum — si alguna de estas direcciones es tuya, conéctala en Xaman. Para firmar todos juntos de una sentada, usa la ceremonia en vivo.',
  'Nobody has to be here: the proposal waits in each member’s own Astryum, where they sign their own seat with their own linked wallet. It is stored, and expires in 7 days.':
    'No hace falta que nadie esté presente: la propuesta espera en el Astryum de cada miembro, donde firma su propio asiento con su propia wallet enlazada. Queda guardada y caduca a los 7 días.',
  'No proposals yet': 'Aún no hay propuestas',
  'Actions on this account create proposals here for the council to sign.':
    'Las acciones sobre esta cuenta crean aquí propuestas para que el consejo las firme.',
  'Waiting for YOUR signature': 'Pendientes de TU firma',
  'Waiting for others': 'Esperando a otros',
  'Ready to emit': 'Listas para emitir',
  'Emitted': 'Emitidas',
  'expired or withdrawn proposals not shown': 'propuestas caducadas o retiradas no mostradas',
  'days left': 'días restantes',
  'you': 'tú',
  'Sign as': 'Firmar como',
  'Withdraw (proposer only)': 'Retirar (solo el proponente)',
  'No signatures stored for this proposal.': 'No hay firmas guardadas para esta propuesta.',
  'Propose to the council (sign over days)': 'Proponer al consejo (firmar en días)',
  'Propose to the council': 'Proponer al consejo',
  'async': 'asíncrono',
  'Short summary for the inbox (optional)': 'Resumen breve para la bandeja (opcional)',
  'File the proposal': 'Registrar la propuesta',
  'Filed in the proposal inbox — each member can now sign from their own device.':
    'Registrada en la bandeja de propuestas — cada miembro puede firmar ya desde su propio dispositivo.',
  'This account already has a live proposal — emit it, withdraw it or let it expire first (XRPL pins one Sequence at a time).':
    'Esta cuenta ya tiene una propuesta viva — emítela, retírala o deja que caduque primero (XRPL fija una Sequence cada vez).',
  'Council order': 'Orden del consejo',

  // ── Formal positions (el acta) ──
  'Formal positions': 'Posiciones formales',
  'the record — not a chat': 'el acta — no un chat',
  'In favour': 'A favor',
  'Against': 'En contra',
  'Abstain': 'Abstención',
  'Request changes': 'Solicito cambios',
  'Fix my position': 'Fijar mi posición',
  'Sign my position': 'Firmar mi posición',
  'Brief comment (optional) — it becomes part of the signed record':
    'Comentario breve (opcional) — pasa a formar parte del acta firmada',
  'Immutable once signed: who thought what, and when. Your wallet signs a proof — no funds are moved.':
    'Inmutable una vez firmada: quién opinó qué, y cuándo. Tu wallet firma una prueba — no se mueve ningún fondo.',
  'anchored on-chain': 'anclada on-chain',
  'Anchor the record (1 drop)': 'Anclar el acta (1 drop)',
  'Connect your Xaman to anchor the record.': 'Conecta tu Xaman para anclar el acta.',

  // ── Earn remodel (hackathon) ──
  'Your registry': 'Tu registro',
  'Everything running and everything saved: live on-chain positions, active savings rules and your drafts — one shelf, always yours to pause or resume.':
    'Todo lo que corre y todo lo guardado: posiciones on-chain en vivo, reglas de ahorro activas y tus borradores — una estantería, siempre tuya para pausar o reanudar.',
  'Back to Earn': 'Volver a Earn',
  'Colour tag': 'Etiqueta de color',
  'No colour': 'Sin color',
  'Connect a wallet to see its performance.': 'Conecta una wallet para ver su rendimiento.',

  // ── Wallet identity glyph (personal icon, alongside colour) ──
  Icon: 'Icono',
  'No icon': 'Sin icono',
  Planet: 'Planeta',
  'Ringed planet': 'Planeta anillado',
  Moon: 'Luna',
  Comet: 'Cometa',
  Star: 'Estrella',
  Orbit: 'Órbita',
  Rocket: 'Cohete',
  Asteroid: 'Asteroide',
  Satellite: 'Satélite',
  Sun: 'Sol',
  Constellation: 'Constelación',
  Nebula: 'Nebulosa',

  // ── Tutorial (ProductTour) ──
  'Skip tour': 'Saltar tutorial',
  'Welcome aboard': 'Bienvenido a bordo',
  'This is your control deck. A one-minute walk through the sidebar and you will know where everything lives. You can skip and replay it any time from Settings.':
    'Esta es tu cabina de mando. Un paseo de un minuto por el menú lateral y sabrás dónde vive cada cosa. Puedes saltarlo y repetirlo cuando quieras desde Ajustes.',
  'Two products, one dashboard': 'Dos productos, un dashboard',
  'Astryum Personal and Astryum Legacy. Flip it here — the whole dashboard re-tints and the menu follows the product you are operating.':
    'Astryum Personal y Astryum Legacy. Cámbialo aquí — el dashboard entero se re-tinta y el menú sigue al producto que estás operando.',
  'The overview: net worth, health, alerts and how each wallet is performing — always scoped to the active account.':
    'La visión general: patrimonio, salud, alertas y el rendimiento de cada wallet — siempre acotado a la cuenta activa.',
  'Where capital goes to work: ready-made strategies, the AI agent, and your strategy registry. You always sign in your own wallet.':
    'Donde el capital se pone a trabajar: estrategias listas, el agente IA y tu registro de estrategias. Siempre firmas en tu propia wallet.',
  'Council-governed accounts: capital under rules that a quorum signs. Constitute one or govern the ones you sit on.':
    'Cuentas gobernadas por consejo: capital bajo reglas que firma un quórum. Constituye una o gobierna aquellas en las que participas.',
  'Every position, token and movement across your wallets — with filters, health readings and export.':
    'Cada posición, token y movimiento de tus wallets — con filtros, lecturas de salud y exportación.',
  'Connect, watch and manage your wallets: colours, nicknames, permissions and what counts in your totals.':
    'Conecta, observa y gestiona tus wallets: colores, apodos, permisos y qué cuenta en tus totales.',
  'Language, region, security and your profile. The tutorial can be replayed from here whenever you want.':
    'Idioma, región, seguridad y tu perfil. El tutorial se puede repetir desde aquí cuando quieras.',
  'Stuck anywhere? The co-pilot explains the ship — ask it anything about what a screen or button does.':
    '¿Atascado en algo? El copiloto explica la nave — pregúntale qué hace cualquier pantalla o botón.',
  'Audited, ready-made strategies live on mainnet. Open one to see exactly what it does with your tokens before you sign anything.':
    'Estrategias auditadas y listas, vivas en mainnet. Abre una para ver exactamente qué hace con tus tokens antes de firmar nada.',
  'Describe what you want in plain words; the agent compiles it into a strategy you review and sign. It never signs for you.':
    'Describe lo que quieres con tus palabras; el agente lo compila en una estrategia que tú revisas y firmas. Nunca firma por ti.',
  'Your registry: everything running on-chain and everything saved as a draft — pause, resume or launch from here.':
    'Tu registro: todo lo que corre on-chain y todo lo guardado como borrador — pausa, reanuda o lanza desde aquí.',
  'Replay the setup wizard and the interactive tour of every screen.':
    'Repite el asistente inicial y el tutorial interactivo de cada pantalla.',

  // ── Puerta Legacy en construcción (demo + beta) ──
  'Legacy — under construction': 'Legacy — en construcción',
  'Legacy turns an account into a GOVERNED one: its authority is a council — a quorum of keys — instead of a single key. Capital under rules a quorum signs: lose a key and you keep operating; one stolen key moves nothing.':
    'Legacy convierte una cuenta en GOBERNADA: su autoridad es un consejo — un quórum de llaves — en vez de una sola llave. Capital bajo reglas que firma un quórum: pierdes una llave y sigues operando; una llave robada no mueve nada.',
  'Not available in the demo yet — we are building it. It ships with the full launch.':
    'Aún no disponible en la demo — lo estamos construyendo. Llega con el lanzamiento completo.',
  'Back to the demo': 'Volver a la demo',
  'In development — we are building it right now. It will switch itself on in your account with one of the next beta updates.':
    'En desarrollo — lo estamos construyendo ahora mismo. Se activará solo en tu cuenta con una de las próximas actualizaciones de la beta.',
  'You are in the early-access beta: the day Legacy opens, it will show up right here, on this same switch.':
    'Estás en la beta de acceso anticipado: el día que Legacy se abra, aparecerá justo aquí, en este mismo interruptor.',
  'Stay in Personal': 'Seguir en Personal',

  // ── Governed MoneyFlows (superficie honesta, gated) ──
  'Council MoneyFlows': 'MoneyFlows del consejo',
  'not wired yet': 'aún sin cablear',
  'A governed MoneyFlow is a rule signed by the quorum, executed without discretion by the keeper, with a mandatory expiry (90 days at most). One councillor alone can PAUSE it at any moment; resuming requires the quorum again.':
    'Un MoneyFlow gobernado es una regla firmada por el quórum, ejecutada sin discreción por el keeper, con caducidad obligatoria (90 días como máximo). Un solo consejero puede PAUSARLA en cualquier momento; reanudarla exige de nuevo el quórum.',
  'What it does and WHO signed it — the quorum signature, always visible.':
    'Qué hace y QUIÉN la firmó — la firma del quórum, siempre visible.',
  'When it expires (TTL ≤ 90 days, always visible) and executions consumed.':
    'Cuándo caduca (TTL ≤ 90 días, siempre visible) y las ejecuciones consumidas.',
  'Individual PAUSE — one councillor stops it; resuming needs the quorum.':
    'PAUSA individual — un consejero la detiene; reanudar exige el quórum.',
  'No active rules': 'Sin reglas activas',
  'The governed rules engine is not built yet: it requires an enforced expiry, an executions cap and quorum resume semantics that the automation engine does not have today. Nothing is simulated here.':
    'El motor de reglas gobernadas aún no está construido: exige caducidad forzada, tope de ejecuciones y semántica de reanudación por quórum que el motor de automatización no tiene hoy. Aquí no se simula nada.',
  'Create a governed rule': 'Crear una regla gobernada',
  'gated': 'con gate',
  'Gated until the governed rules engine exists': 'Con gate hasta que exista el motor de reglas gobernadas',

  // ── Vista fiscal (export de movimientos) ──
  'Start date': 'Desde',
  'End date': 'Hasta',
  'Export': 'Exportar',
  'One file per wallet in scope. Astryum reports data; the filing is your advisor’s job.':
    'Un archivo por wallet en el ámbito. Astryum reporta datos; la declaración la hace tu asesor.',

  // ── Admin panel (founders only, read-only) ──
  'Founders only': 'Solo fundadores',
  'Admin overview': 'Resumen de administración',
  'Read-only counts and the waitlist. Nothing here writes to the database.':
    'Recuentos de solo lectura y la waitlist. Nada aquí escribe en la base de datos.',
  'This panel is not available for this account.': 'Este panel no está disponible para esta cuenta.',
  Counts: 'Recuentos',
  Users: 'Usuarios',
  'Council proposals': 'Propuestas del consejo',
  'Waitlist signups': 'Inscritos en la waitlist',
  'Waitlist by source': 'Waitlist por origen',
  Waitlist: 'Lista de espera',
  Email: 'Correo electrónico',
  Language: 'Idioma',
  Created: 'Creado',
  'Last login': 'Último acceso',
  'Recent users': 'Usuarios recientes',
  'Copy emails': 'Copiar correos',
  'No signups yet.': 'Aún no hay inscritos.',
  // Static login card (founder 2026-07-19 — the panel's only door for now)
  'Founders panel': 'Panel de fundadores',
  'Enter the panel key to open the overview.': 'Introduce la clave del panel para abrir el resumen.',
  'That key was not accepted.': 'Esa clave no ha sido aceptada.',
  'Panel key': 'Clave del panel',
  'Checking…': 'Comprobando…',
  'Open panel': 'Abrir panel',
  'No users yet.': 'Aún no hay usuarios.',

  // AuthorityCrossing reuses the shared 'Personal' key (ProductToggle block).

  // ── MoneyFlows (superficie unificada Personal + Legacy, 2026-07-18) ──
  'MoneyFlows · your rules': 'MoneyFlows · tus reglas',
  'quorum signs': 'firma el quórum',
  'you sign': 'firmas tú',
  'A MoneyFlow is a rule signed off by you: it watches without discretion and, when it fires, prepares the exact action for YOU to sign in your wallet. It always expires (90 days at most) and you can pause or delete it instantly.':
    'Un MoneyFlow es una regla tuya: vigila sin discreción y, al dispararse, prepara la acción exacta para que TÚ la firmes en tu wallet. Caduca siempre (90 días como máximo) y puedes pausarla o borrarla al instante.',
  'A governed MoneyFlow is a rule that watches without discretion and, when it fires, COMPOSES a proposal into the council inbox — only the quorum signature moves anything. It always expires (90 days at most) and any councillor can pause it instantly.':
    'Un MoneyFlow gobernado es una regla que vigila sin discreción y, al dispararse, COMPONE una propuesta en la bandeja del consejo — solo la firma del quórum mueve algo. Caduca siempre (90 días como máximo) y cualquier consejero puede pausarla al instante.',
  'Loading rules…': 'Cargando reglas…',
  'Create one from a position (Protect/Harvest) or ask the strategy agent to compose a MoneyFlow.':
    'Crea una desde una posición (Protect/Harvest) o pide al agente de estrategias que componga un MoneyFlow.',
  'Create the first governed rule below — it will only ever compose proposals for the quorum.':
    'Crea abajo la primera regla gobernada — solo compondrá propuestas para el quórum.',
  paused: 'pausada',
  expired: 'caducada',
  'expires in': 'caduca en',
  'no expiry (legacy rule)': 'sin caducidad (regla antigua)',
  fired: 'disparada',
  'Expired — create it again to renew (the 90-day clamp re-runs)':
    'Caducada — créala de nuevo para renovarla (el tope de 90 días se aplica otra vez)',
  'HF below': 'HF por debajo de',
  critical: 'crítico',
  'LTV above': 'LTV por encima de',
  'rewards over': 'recompensas sobre',
  idle: 'ocioso',
  'on schedule': 'según calendario',
  trigger: 'disparador',
  'propose payment of': 'propone pago de',
  'propose vault order': 'propone orden al vault',
  'New governed rule — scheduled council payment': 'Nueva regla gobernada — pago programado del consejo',
  'When the schedule fires, the rule COMPOSES a payment proposal from the council into the inbox above. Nothing is sent: the quorum reviews and signs each proposal, every time.':
    'Cuando el calendario dispara, la regla COMPONE una propuesta de pago del consejo en la bandeja de arriba. No se envía nada: el quórum revisa y firma cada propuesta, todas las veces.',
  'Name (e.g. Monthly stipend)': 'Nombre (p. ej. Asignación mensual)',
  'Every day (12:00 UTC)': 'Cada día (12:00 UTC)',
  'Every Monday (12:00 UTC)': 'Cada lunes (12:00 UTC)',
  'Every month, day 1 (12:00 UTC)': 'Cada mes, día 1 (12:00 UTC)',
  'Destination XRPL address (r…)': 'Dirección XRPL de destino (r…)',
  'Expires in (days, max 90)': 'Caduca en (días, máx. 90)',
  'The rule holds no authority — only the quorum signature moves funds.':
    'La regla no tiene autoridad — solo la firma del quórum mueve fondos.',
  'Vault orders (LegacyVault via the FDC bridge) will appear here as a second action once the Legacy stack is deployed — same rule language, machine execution after the quorum signs.':
    'Las órdenes al vault (LegacyVault vía el bridge FDC) aparecerán aquí como segunda acción cuando el stack Legacy esté desplegado — mismo lenguaje de reglas, ejecución por máquina tras la firma del quórum.',
  'Give the rule a name.': 'Ponle nombre a la regla.',
  'Destination must be an XRPL address (r…).': 'El destino debe ser una dirección XRPL (r…).',
  'Destination must differ from the council account.': 'El destino debe ser distinto de la cuenta del consejo.',
  'Amount must be a positive number of XRP.': 'La cantidad debe ser un número positivo de XRP.',
  'Amount must be a positive number of XRP, with at most 6 decimals.':
    'La cantidad debe ser un número positivo de XRP, con 6 decimales como máximo.',
  'Expiry must be between 1 and 90 days.': 'La caducidad debe estar entre 1 y 90 días.',
  'Sign-at-trigger with N signers: the rule composes proposals; the quorum signs each one; it expires on its own (90 days at most).':
    'Firma-al-disparo con N firmantes: la regla compone propuestas; el quórum firma cada una; caduca sola (90 días como máximo).',
  'New governed rule': 'Nueva regla gobernada',
  'If the APY falls below X%': 'Si el APY cae de X%',
  'Scheduled council payment': 'Pago programado del consejo',
  'When the venue’s live supply APY drops below your floor, the rule fires: it alerts the council — or composes the rotation order (move funds to another venue) as a proposal the quorum signs. Rates are read live from the protocol, with source.':
    'Cuando el APY de supply en vivo del venue cae por debajo de tu suelo, la regla dispara: avisa al consejo — o compone la orden de rotación (mover fondos a otro venue) como propuesta que firma el quórum. Las tasas se leen en vivo del protocolo, con fuente.',
  'Pick the market to watch.': 'Elige el mercado a vigilar.',
  'The APY floor must be a positive percentage.': 'El suelo de APY debe ser un porcentaje positivo.',
  'Rotation amount must be a positive number of FXRP.': 'La cantidad a rotar debe ser un número positivo de FXRP.',
  'No markets available (backend env)': 'Sin mercados disponibles (env del backend)',
  'APY floor (%)': 'Suelo de APY (%)',
  'Alert the council': 'Avisar al consejo',
  'Compose the rotation order (vault)': 'Componer la orden de rotación (vault)',
  'From venue #': 'Desde venue #',
  'To venue #': 'Hacia venue #',
  // ── Rotación gobernada con venues reales (F4, 2026-07-30) ──
  'Move the money from': 'Mover el dinero de',
  'to': 'a',
  'Pick the two venues of the rotation.': 'Elige los dos sitios de la rotación.',
  'The rotation needs two different venues.': 'La rotación necesita dos sitios distintos.',
  'The vault could not be read — the rotation order is not available right now.':
    'No se ha podido leer el vault — la orden de rotación no está disponible ahora mismo.',
  'The vault could not be read — the rotation order is not available right now. The alert variant works today.':
    'No se ha podido leer el vault — la orden de rotación no está disponible ahora mismo. La variante de aviso sí funciona hoy.',
  'Reading the vault venues…': 'Leyendo los sitios del vault…',
  'Amount (FXRP)': 'Cantidad (FXRP)',
  'The rotation order needs the deployed Legacy stack (bridge + vault): until then it fails with a readable error at fire time; the alert variant works today. Machine execution happens only AFTER the quorum signs.':
    'La orden de rotación necesita el stack Legacy desplegado (bridge + vault): hasta entonces falla con error legible al disparar; la variante de aviso funciona hoy. La ejecución por máquina ocurre solo DESPUÉS de que firme el quórum.',

  // ── De-AI pass 2026-07-21: claves reportadas por los agentes de páginas ──
  'Xaman or Flare wallet': 'Xaman o wallet Flare',
  'EVM direct': 'EVM directo',
  'Xaman · Smart Account': 'Xaman · Smart Account',
  'Flare direct · no mint': 'Flare directo · sin mint',
  'Put your assets to work': 'Pon tus activos a trabajar',
  'Customize': 'Personalizar',
  'tx-enabled': 'con firma',
  'Solana wallet connected': 'Wallet de Solana conectada',
  'Bitcoin wallet connected': 'Wallet de Bitcoin conectada',
  'Solana wallet added — it now shows in your portfolio.': 'Wallet de Solana añadida — ya aparece en tu portfolio.',
  'Bitcoin wallet added — it now shows in your portfolio.': 'Wallet de Bitcoin añadida — ya aparece en tu portfolio.',
  'XRPL account': 'Cuenta XRPL',
  'The council-governed account.': 'La cuenta gobernada por el consejo.',
  'Delivery date': 'Fecha de entrega',
  'Unbreakable until then.': 'Inquebrantable hasta entonces.',
  'Recovery date': 'Fecha de recuperación',
  'Default: delivery + 1 year — unclaimed funds return.': 'Por defecto: entrega + 1 año — los fondos no reclamados vuelven.',
  'Verify or amend': 'Verificar o enmendar',
  'Anchor v1': 'Anclar v1',
  'Paste the exact document text.': 'Pega el texto exacto del documento.',
  'Optional — IPFS/HTTPS where it lives.': 'Opcional — IPFS/HTTPS donde vive.',
  'Emergency': 'Emergencia',
  'Replace the fallen signer before anything else.': 'Sustituye al firmante caído antes que nada.',
  'master key disabled': 'master key deshabilitada',
  'master key active': 'master key activa',
  'Quorum-only governance.': 'Gobierno solo por quórum.',
  'The rehearsal passed — time to close the door.': 'El ensayo ha pasado — hora de cerrar la puerta.',
  'Correct for now: it is your safety net until the rehearsal passes.': 'Correcto por ahora: es tu red de seguridad hasta que el ensayo se apruebe.',
  'Or describe it in words': 'O descríbelo con palabras',
  'The AI compiles, you review and sign.': 'La IA lo compila, tú revisas y firmas.',
  'Advanced': 'Avanzado',

  // ── NetworkSwitcher (Flare network banner) ──
  "You're on another network — this app runs on Flare.":
    'Estás en otra red — la app funciona sobre Flare.',
  'Switch to Flare': 'Cambiar a Flare',
  'Switching…': 'Cambiando…',
  "No problem — you can switch whenever you're ready.":
    'Sin problema — puedes cambiar cuando quieras.',
  'Your wallet can’t add Flare automatically. Add it manually with these details, or open Chainlist:':
    'Tu wallet no puede añadir Flare automáticamente. Añádela a mano con estos datos, o abre Chainlist:',
  'Network name': 'Nombre de la red',
  'Currency symbol': 'Símbolo',
  'Block explorer': 'Explorador',
  'Open Chainlist': 'Abrir Chainlist',

  // ── LegalAcceptGate (aceptación de condiciones + aviso, 2026-07-30) ──
  'Before you continue': 'Antes de continuar',
  'One minute, once — so you know exactly what you are using.':
    'Un minuto, una sola vez — para que sepas exactamente qué estás usando.',
  'Astryum is an open demo with real XRP under deliberate caps. Its conditions and its privacy notice are published as living pages; your acceptance is recorded with the text version and date.':
    'Astryum es una demo abierta con XRP real bajo topes deliberados. Sus condiciones y su aviso de privacidad están publicados como páginas vivas; tu aceptación queda registrada con la versión del texto y la fecha.',
  'I accept the': 'Acepto las',
  'demo terms': 'condiciones de la demo',
  '— experimental software, caps by design, liability limited to €50 with the legal carve-outs.':
    '— software experimental, topes por diseño, responsabilidad limitada a 50 € con las excepciones de ley.',
  'I declare that I am 18 or older.':
    'Declaro que tengo 18 años o más.',
  'I have read the': 'He leído el',
  'privacy notice': 'aviso de privacidad',
  '— what is processed, who receives it, and what public chains make permanent.':
    '— qué se trata, quién lo recibe y qué hacen permanente las cadenas públicas.',
  'Could not record your acceptance — check your connection and try again.':
    'No se pudo registrar tu aceptación — revisa tu conexión e inténtalo de nuevo.',
  'Recording…': 'Registrando…',
  'Accept and continue': 'Aceptar y continuar',
  'Version': 'Versión',
  'Recorded with date on your account': 'Se registra con fecha en tu cuenta',

  // ── Desplegable de proveedores FTSO en Wrap + delegate (2026-07-31) ──
  'FTSO data provider': 'Proveedor de datos FTSO',
  'Delegation %': '% de delegación',
  'Choose a provider…': 'Elige un proveedor…',
  'Another provider — enter its address (0x…)': 'Otro proveedor — escribe su dirección (0x…)',
  'Public registry of listed providers, A–Z — a directory, not a recommendation.':
    'Registro público de proveedores listados, de la A a la Z — un directorio, no una recomendación.',
  'Choose from the registry list instead': 'Mejor elegir de la lista del registro',
  'Enter a valid FTSO data provider address (0x…)':
    'Escribe una dirección de proveedor FTSO válida (0x…)',
  'Delegate to': 'Delegar a',
  'FLR/USD now': 'FLR/USD ahora',

  // ── Salida de la posición FTSO: FtsoExitModal (2026-07-31) ──
  'Withdraw & unwrap': 'Retirar y desenvolver',
  'Amount · WFLR': 'Cantidad · WFLR',
  'Available:': 'Disponible:',
  'Confirm in your wallet…': 'Confirma en tu wallet…',
  'Preparing the unsigned calls…': 'Preparando las llamadas sin firmar…',
  'The live WFLR balance could not be read — try again in a moment.':
    'No se ha podido leer el saldo WFLR en vivo — inténtalo en un momento.',
  'Full exit: the delegation is removed and everything unwraps back to FLR.':
    'Salida completa: se retira la delegación y todo vuelve a FLR.',
  'A partial unwrap keeps your delegation % on the remaining WFLR.':
    'Un unwrap parcial mantiene tu % de delegación sobre el WFLR restante.',
  'Currently delegated to': 'Delegado ahora mismo a',
  'Switch your wallet to the account that holds this position':
    'Cambia tu wallet a la cuenta que tiene esta posición',
  'Remove delegation': 'Retirar la delegación',
  'all providers': 'todos los proveedores',
  'Stays wrapped & delegated': 'Sigue envuelto y delegado',
  'This wallet holds no WFLR to unwrap.': 'Esta wallet no tiene WFLR que desenvolver.',
  'That wallet holds less WFLR than requested': 'Esa wallet tiene menos WFLR de lo pedido',
  'Use MAX to unwrap the exact balance.': 'Usa MAX para desenvolver el saldo exacto.',
  'Full exit: the delegation is removed and every WFLR unwraps back to FLR in the same wallet. FTSO rewards already accrued stay claimable afterwards.':
    'Salida completa: se retira la delegación y todo el WFLR vuelve a FLR en la misma wallet. Las recompensas FTSO ya acumuladas siguen siendo reclamables después.',
  'Partial unwrap: the delegation percentages stay on the remaining WFLR. FTSO rewards already accrued stay claimable afterwards.':
    'Unwrap parcial: los porcentajes de delegación se mantienen sobre el WFLR restante. Las recompensas FTSO ya acumuladas siguen siendo reclamables después.',

  // ── Earn bajo un consejo: lo que la vasija no sabe hacer (2026-08-04) ──
  // "Unsupported" se queda en inglés a propósito: es la etiqueta corta, igual
  // en los dos idiomas. La explicación sí habla castellano.
  'Unsupported for a council': 'No disponible para un consejo',
  'This strategy cannot be run by a council': 'Esta estrategia no la puede ejecutar un consejo',
  'The vault on Flare has no borrow function: a council order can only put principal to work in a venue and bring it back. This entry borrows USDT0 against the collateral, so it cannot be composed as a council order. The lend-only entry does the same supply without debt, and it is available.':
    'La vasija en Flare no tiene función de préstamo: una orden del consejo solo puede poner el principal a trabajar en un venue y traerlo de vuelta. Esta entrada pide USDT0 prestado contra el colateral, así que no se puede componer como orden del consejo. La entrada de solo supply hace el mismo depósito sin deuda, y sí está disponible.',
  'The vault on Flare has no borrow function, so a council cannot run the borrowing route. The lend-only route does the same supply without debt.':
    'La vasija en Flare no tiene función de préstamo, así que un consejo no puede usar la ruta con préstamo. La ruta de solo supply hace el mismo depósito sin deuda.',

  // ── Pasada i18n 2026-08-08 (auditoría completa): 352 claves t() que caían
  // al inglés en modo ES — Legacy (vasija/jaula/quórum), panel de fundadores,
  // posiciones, movimientos y sueltas. Generadas contra el inventario AST
  // (scripts en la sesión); la re-auditoría debe dar 0 claves faltantes. ──
  "The vault could not be read from Flare right now. Nothing was composed — try again in a moment.":
    "Ahora mismo no se pudo leer la vasija en Flare. No se compuso nada — inténtalo de nuevo en un momento.",
  "Signed on XRPL. Fetching the proof and delivering it to the vault — this takes about 2–5 minutes.":
    "Firmado en XRPL. Recogiendo la prueba y entregándola a la vasija — tarda unos 2–5 minutos.",
  "The order is signed and valid, but the relay could not start:":
    "La orden está firmada y es válida, pero el relay no pudo arrancar:",
  "it can be re-delivered by anyone later; no signature is lost.":
    "cualquiera puede re-entregarla más tarde; ninguna firma se pierde.",
  "Your council signs this ONE payment — each member from their own device. It carries the whole instruction: mint the XRP into this Legacy's own account on Flare, then deposit it into the vault as principal. Nobody holds it in between.":
    "Tu consejo firma este ÚNICO pago — cada miembro desde su propio dispositivo. Lleva la instrucción completa: mintear el XRP en la cuenta propia de este Legacy en Flare y depositarlo en la vasija como principal. Nadie lo custodia por el camino.",
  "Your council signs this Payment — each member from their own device. The signature authorizes ONLY the order above: the bridge executes exactly those bytes on the vault, and nothing else.":
    "Tu consejo firma este Payment — cada miembro desde su propio dispositivo. La firma autoriza SOLO la orden de arriba: el puente ejecuta exactamente esos bytes sobre la vasija, y nada más.",
  "This is the FIRST of two signatures. It puts the capital inside the cage; choosing which venue it works in is a second, separate order of the quorum. That separation is deliberate — one signature should not both lock family capital away and decide where it goes.":
    "Esta es la PRIMERA de dos firmas. Mete el capital dentro de la jaula; elegir en qué venue trabaja es una segunda orden del quórum, separada. Esa separación es deliberada — una misma firma no debería a la vez encerrar capital familiar y decidir adónde va.",
  "Go to Proposals →": "Ir a Propuestas →",
  "The council moves this capital": "Este capital lo mueve el consejo",
  "This account is governed by a council, so {vault} is entered by council order instead of a single signature.":
    "Esta cuenta la gobierna un consejo, así que en {vault} se entra por orden del consejo, no con una firma individual.",
  "This account is governed by a council, so capital is moved by council order instead of a single signature.":
    "Esta cuenta la gobierna un consejo, así que el capital se mueve por orden del consejo, no con una firma individual.",
  "Astryum composes the order unsigned; the quorum signs one XRPL transaction; the Flare Data Connector proves it and the vault executes exactly those bytes. Astryum never signs and never holds a key.":
    "Astryum compone la orden sin firmar; el quórum firma una única transacción XRPL; el Flare Data Connector la prueba y la vasija ejecuta exactamente esos bytes. Astryum nunca firma y nunca tiene una llave.",
  "Reading the vault on Flare…": "Leyendo la vasija en Flare…",
  "This vault has no venues registered yet, so capital has nowhere to work. A council order registers the first one (Propose a venue, in the Legacy hub) — it opens after the vault's waiting period.":
    "Esta vasija aún no tiene venues registrados, así que el capital no tiene dónde trabajar. Una orden del consejo registra el primero (Proponer un venue, en el hub del Legacy) — se abre tras el periodo de espera de la vasija.",
  "working": "trabajando",
  "This vault has been migrated to a successor — it accepts no new direction.":
    "Esta vasija ha migrado a una sucesora — ya no acepta nuevas órdenes.",
  "Add capital": "Añadir capital",
  "Put it to work": "Ponerlo a trabajar",
  "Bring it back to the vault": "Traerlo de vuelta a la vasija",
  "Fresh XRP from the council becomes principal inside the vault. It takes ONE quorum signature; putting that principal to work is a second one.":
    "XRP nuevo del consejo se convierte en principal dentro de la vasija. Cuesta UNA firma del quórum; poner ese principal a trabajar es una segunda.",
  "Principal already in the vault goes to work in a venue the constitution whitelists.":
    "Principal que ya está en la vasija sale a trabajar a un venue que la constitución tiene en su lista blanca.",
  "Principal comes out of the VENUE and sits idle IN THE VAULT. It does not return to the council and it does not become XRP — the cage has no function that pays principal to an address. Only the yield it earns can ever be paid out.":
    "El principal sale del VENUE y queda parado EN LA VASIJA. No vuelve al consejo ni se convierte en XRP — la jaula no tiene ninguna función que pague principal a una dirección. Solo el rendimiento que genera puede llegar a pagarse.",
  "The vault holds no idle principal, so there is nothing to direct yet.":
    "La vasija no tiene principal parado, así que aún no hay nada que dirigir.",
  "Add capital first →": "Añade capital primero →",
  "retired": "retirado",
  "not open yet": "aún no abierto",
  "Holds": "Contiene",
  "principal": "principal",
  "This venue is retired: closed to new capital. Bringing capital back out of it still works.":
    "Este venue está retirado: cerrado a capital nuevo. Sacar el capital de vuelta sigue funcionando.",
  "This venue opens on": "Este venue abre el",
  "the vault's waiting period before capital may enter.":
    "el periodo de espera de la vasija antes de que pueda entrar capital.",
  "The council holds": "El consejo tiene",
  "spendable after the ledger reserve:": "gastable tras la reserva del ledger:",
  "XRP paid from the council account. Protocol fees are taken before it lands.":
    "XRP pagado desde la cuenta del consejo. Las comisiones del protocolo se descuentan antes de que llegue.",
  "Idle and available:": "Parado y disponible:",
  "In this venue:": "En este venue:",
  "Max keeps back the signing fee of": "Max reserva la comisión de firma de",
  "(a quorum of {n} signs, so it costs more than one signature).":
    "(firma un quórum de {n}, así que cuesta más que una sola firma).",
  "Minimum that actually lands:": "Mínimo que llega de verdad:",
  "below that the minting and executor fees take the whole payment.":
    "por debajo, las comisiones de mint y del executor se comen el pago entero.",
  "Of": "De",
  "minting fee": "comisión de mint",
  "executor fee": "comisión del executor",
  "lands as principal:": "llega como principal:",
  "Beta limit: this cage may hold at most":
    "Límite de la beta: esta jaula puede contener como máximo",
  "in total. It holds": "en total. Contiene",
  "room for about": "queda sitio para unos",
  "more (before fees).": "más (antes de comisiones).",
  "it is full: no more capital can enter during the beta.":
    "está llena: no puede entrar más capital durante la beta.",
  "Enter a positive amount the token can hold — at most":
    "Introduce una cantidad positiva que el token pueda representar — como máximo",
  "decimals.": "decimales.",
  "Below the minimum: the minting and executor fees would take the whole payment and no principal would reach the vault. Send at least":
    "Por debajo del mínimo: las comisiones de mint y del executor se comerían el pago entero y ningún principal llegaría a la vasija. Envía al menos",
  "More than the council can spend. It holds": "Más de lo que el consejo puede gastar. Tiene",
  "of which": "de los cuales",
  "is locked as the ledger reserve and": "está bloqueado como reserva del ledger y",
  "is needed to pay for the signatures.": "hace falta para pagar las firmas.",
  "More than the vault holds idle. Capital already working in a venue must be brought back first.":
    "Más de lo que la vasija tiene parado. El capital que ya trabaja en un venue hay que traerlo de vuelta primero.",
  "More than this venue holds for the vault.": "Más de lo que este venue tiene para la vasija.",
  "Compose the order for the council": "Componer la orden para el consejo",
  "Rates and balances shown are read live from the vault and the protocol — protocol data, never an Astryum offer or promise. Composing costs nothing and moves nothing: only the quorum's signatures do.":
    "Los tipos y balances mostrados se leen en vivo de la vasija y del protocolo — datos del protocolo, nunca una oferta o promesa de Astryum. Componer no cuesta nada y no mueve nada: solo lo hacen las firmas del quórum.",
  "Session expired — enter the key again.": "Sesión caducada — introduce la clave otra vez.",
  "Too many attempts. Wait a few minutes.": "Demasiados intentos. Espera unos minutos.",
  "Complete the anti-bot check first.": "Completa primero la comprobación anti-bots.",
  "The panel did not answer. Try again.": "El panel no respondió. Inténtalo de nuevo.",
  "Seat approved — boarding-pass email sent.":
    "Plaza aprobada — email con la tarjeta de embarque enviado.",
  "Seat approved — but the invite email did NOT send (mailer). Approve again to retry.":
    "Plaza aprobada — pero el email de invitación NO salió (mailer). Aprueba de nuevo para reintentar.",
  "Approve failed — nothing changed.": "La aprobación falló — nada cambió.",
  "Seat revoked — that email can no longer create an account. Existing accounts are untouched.":
    "Plaza revocada — ese email ya no puede crear cuenta. Las cuentas existentes no se tocan.",
  "Revoke failed — nothing changed.": "La revocación falló — nada cambió.",
  "Search email or source…": "Busca email u origen…",
  "All sources": "Todos los orígenes",
  "Show noise": "Mostrar ruido",
  "Seat": "Plaza",
  "Flag": "Marca",
  "approved · invited": "aprobada · invitado",
  "approved": "aprobada",
  "Revoke seat (blocks account creation; existing accounts untouched)":
    "Revocar plaza (bloquea crear cuenta; las cuentas existentes no se tocan)",
  "Approve": "Aprobar",
  "noise": "ruido",
  "Search email…": "Busca email…",
  "All providers": "Todos los proveedores",
  "Refetch": "Recargar",
  "Unreachable": "Inaccesible",
  "Online": "En línea",
  "No dedicated healthcheck — this pings the same overview call the panel already needs.":
    "No hay healthcheck dedicado — esto llama al mismo overview que el panel ya necesita.",
  "Unstick transactions": "Desatascar transacciones",
  "Not available right now.": "No disponible ahora mismo.",
  "Defenses covered today": "Defensas cubiertas hoy",
  "Fee margin (over cost)": "Margen de la comisión (sobre coste)",
  "FDC budget (24h window)": "Presupuesto FDC (ventana de 24 h)",
  "Coverage by budget · by wallet": "Cobertura por presupuesto · por wallet",
  "Pending · parked": "Pendientes · aparcadas",
  "Last tick": "Último tick",
  "Last refuel": "Último repostaje",
  "Last sweep": "Último barrido",
  "cost": "coste",
  "warns below": "avisa por debajo de",
  "Executor, watchers and provider health — kept even without a webhook":
    "Salud del executor, los watchers y el proveedor — se conserva incluso sin webhook",
  "Alerts & notifications": "Alertas y notificaciones",
  "Could not load alerts.": "No se pudieron cargar las alertas.",
  "Critical": "Críticas",
  "No alerts yet — the executor and watchers have been quiet.":
    "Aún no hay alertas — el executor y los watchers han estado tranquilos.",
  "Nothing at this severity.": "Nada con esta severidad.",
  "Park": "Aparcar",
  "failures": "fallos",
  "next retry": "próximo reintento",
  "Unexecutable bytes: retrying re-parks it at zero cost — the real fix is a re-prepare + a fresh user signature (the XRP waits safely at the Core Vault).":
    "Bytes inejecutables: reintentar la vuelve a aparcar a coste cero — el arreglo real es re-preparar + una firma nueva del usuario (el XRP espera a salvo en el Core Vault).",
  "On FLARE_EXECUTOR_SKIP_TXS (Railway env) — remove it there too, or the next sweep parks it again.":
    "Está en FLARE_EXECUTOR_SKIP_TXS (env de Railway) — quítala también allí, o el próximo barrido la aparca de nuevo.",
  "0xFE dispatches — incoming (deposits) and outgoing (withdrawals/claims). Retry never signs anything.":
    "Despachos del 0xFE — entrantes (depósitos) y salientes (retiradas/claims). Reintentar nunca firma nada.",
  "sweep in progress": "barrido en curso",
  "Parked": "Aparcadas",
  "no retries, no cost, until you hit Retry":
    "sin reintentos y sin coste hasta que pulses Reintentar",
  "Nothing parked — no dispatch needed rescuing.":
    "Nada aparcado — ningún despacho necesitó rescate.",
  "the watcher retries these on its own; Park stops one":
    "el watcher las reintenta por su cuenta; Aparcar detiene una",
  "No pending dispatches waiting for the executor.":
    "No hay despachos pendientes esperando al executor.",
  "The pending list comes from the watcher's last Core Vault sweep — if the watcher is OFF it can be stale. A parked dispatch survives redeploys; the user's XRP always waits at the Core Vault until its exact signed bytes execute.":
    "La lista de pendientes sale del último barrido del Core Vault del watcher — si el watcher está APAGADO puede estar desfasada. Un despacho aparcado sobrevive a los redeploys; el XRP del usuario espera siempre en el Core Vault hasta que se ejecutan exactamente sus bytes firmados.",
  "This account already has a live proposal collecting signatures — emit, withdraw or let it expire before creating another.":
    "Esta cuenta ya tiene una propuesta viva recogiendo firmas — emítela, retírala o deja que caduque antes de crear otra.",
  "This account is not a council yet (no multisig signer list). Constitute it first — then its movements can be proposed to the quorum.":
    "Esta cuenta aún no es un consejo (no tiene lista de firmantes multisig). Constitúyela primero — entonces sus movimientos podrán proponerse al quórum.",
  "XRPL DeFi is not enabled on this deployment yet (feature flag off).":
    "El DeFi de XRPL aún no está habilitado en este despliegue (feature flag apagado).",
  "Back to the account": "Volver a la cuenta",
  "Selling": "Vendes",
  "Buying": "Compras",
  "Order type": "Tipo de orden",
  "Enter a valid XRPL destination (r…).": "Introduce un destino XRPL válido (r…).",
  "The destination must differ from the council account.":
    "El destino debe ser distinto de la cuenta del consejo.",
  "Payment from the council account to {dest} for {amt} XRP.":
    "Payment desde la cuenta del consejo a {dest} por {amt} XRP.",
  "Enter a positive price (RLUSD per XRP).": "Introduce un precio positivo (RLUSD por XRP).",
  "Council account": "Cuenta del consejo",
  "Send, set XRP aside and trade on the native XRPL DEX — bound to the council account. Astryum composes each move UNSIGNED and drops it in the inbox; the council signs it by quorum in Proposals. Nothing moves without those signatures.":
    "Envía, aparta XRP y opera en el DEX nativo de XRPL — todo atado a la cuenta del consejo. Astryum compone cada movimiento SIN FIRMAR y lo deja en la bandeja; el consejo lo firma por quórum en Propuestas. Nada se mueve sin esas firmas.",
  "Propose an XRP Payment from the council to any address.":
    "Propón un Payment de XRP del consejo a cualquier dirección.",
  "Show the council account address as a QR to receive into it.":
    "Muestra la dirección de la cuenta del consejo como QR para recibir en ella.",
  "Propose an escrow that locks XRP until a date you choose.":
    "Propón un escrow que bloquea XRP hasta la fecha que elijas.",
  "Propose a buy/sell order on the native XRPL DEX (XRP ↔ RLUSD).":
    "Propón una orden de compra/venta en el DEX nativo de XRPL (XRP ↔ RLUSD).",
  "Create proposal": "Crear propuesta",
  "This does not move funds: it pins the unsigned transaction for the quorum. The council signs it in Proposals; Astryum never signs.":
    "Esto no mueve fondos: fija la transacción sin firmar para el quórum. El consejo la firma en Propuestas; Astryum nunca firma.",
  "Destination (r…)": "Destino (r…)",
  "Anyone can pay into the council account — receiving needs no signature.":
    "Cualquiera puede pagar a la cuenta del consejo — recibir no necesita firma.",
  "A savings lock, not a yield product — it earns nothing while locked. XRP only.":
    "Un candado de ahorro, no un producto de yield — no genera nada mientras está bloqueado. Solo XRP.",
  "Buy XRP": "Comprar XRP",
  "Sell XRP": "Vender XRP",
  "Limit": "Límite",
  "Market": "Mercado",
  "Price (RLUSD per XRP)": "Precio (RLUSD por XRP)",
  "A spot order on the native XRPL DEX — the price comes from the open book, Astryum quotes nothing.":
    "Una orden spot en el DEX nativo de XRPL — el precio sale del libro abierto, Astryum no cotiza nada.",
  "Proposal created — it is in the council inbox for the quorum to sign.":
    "Propuesta creada — está en la bandeja del consejo para que la firme el quórum.",
  "Quorum signs": "Firma el quórum",
  "How a governed movement works": "Cómo funciona un movimiento gobernado",
  "You compose the movement here; it becomes an unsigned proposal pinned to one ledger Sequence. Each council member signs the SAME bytes in Proposals until the quorum is met, then anyone broadcasts it. The rule of custody holds: Astryum never signs, never holds a key — only the quorum moves the funds.":
    "Tú compones el movimiento aquí; se convierte en una propuesta sin firmar fijada a un Sequence del ledger. Cada miembro del consejo firma los MISMOS bytes en Propuestas hasta alcanzar el quórum, y entonces cualquiera la difunde. La regla de custodia se mantiene: Astryum nunca firma, nunca tiene una llave — solo el quórum mueve los fondos.",
  "Reading the Flare execution…": "Leyendo la ejecución en Flare…",
  "Flare (FDC):": "Flare (FDC):",
  "FDC round in progress": "Ronda FDC en curso",
  "collecting signatures": "recogiendo firmas",
  "ready to emit": "lista para emitir",
  "emitted on-chain": "emitida on-chain",
  "withdrawn": "retirada",
  "expired — renew to keep watching": "caducada — renueva para seguir vigilando",
  "nearing its 90-day limit —": "acercándose a su límite de 90 días —",
  "watching": "vigilando",
  "Constitution anchored": "Constitución anclada",
  "Everything this Legacy has signed on XRPL and Flare, and everything still running — one record. Open any entry for its on-chain proof and the actions it still allows.":
    "Todo lo que este Legacy ha firmado en XRPL y Flare, y todo lo que sigue en marcha — un solo registro. Abre cualquier entrada para ver su prueba on-chain y las acciones que aún permite.",
  "Active now": "Activo ahora",
  "Signed (history)": "Firmado (historial)",
  "Nothing here yet": "Aún no hay nada aquí",
  "As you create proposals, rules and commitments, they land in this record — with their on-chain proof.":
    "Según creas propuestas, reglas y compromisos, van cayendo en este registro — con su prueba on-chain.",
  "Go to the inbox to sign": "Ir a la bandeja para firmar",
  "no expiry set": "sin caducidad fijada",
  "The rule holds no authority — it only composes proposals; the quorum signs each one.":
    "La regla no tiene autoridad — solo compone propuestas; el quórum firma cada una.",
  "Renew (+90 days)": "Renovar (+90 días)",
  "recoverable after": "recuperable a partir de",
  "Delivery and recovery are permissionless — trigger them from the Proposals section.":
    "La entrega y la recuperación son permissionless — dispáralas desde la sección de Propuestas.",
  "Manage in Proposals": "Gestionar en Propuestas",
  "signed by the quorum of its day": "firmado por el quórum de su día",
  "Before → after signing": "Antes → después de firmar",
  "Debt (USDT0)": "Deuda (USDT0)",
  "USDT0 in your wallet": "USDT0 en tu wallet",
  "USDT0 in the PA (free + supplied)": "USDT0 en la PA (libre + depositado)",
  "fill spend (worst case)": "gasto del fill (peor caso)",
  "Close this position, step by step": "Cierra esta posición, paso a paso",
  "More than the vault holds for this wallet — in the vault right now:":
    "Más de lo que el vault tiene para esta wallet — en el vault ahora mismo:",
  "This wallet has no supply of that asset in the Kinetic ISO market — check the selected wallet and asset.":
    "Esta wallet no tiene depósito de ese activo en el mercado ISO de Kinetic — revisa la wallet y el activo seleccionados.",
  "This position lives in wallet": "Esta posición vive en la wallet",
  "connect that wallet (MetaMask) to sign. The XRPL rail cannot move it.":
    "conecta esa wallet (MetaMask) para firmar. El raíl XRPL no puede moverla.",
  "No USDT0 supplied — nothing to withdraw in this step.":
    "No hay USDT0 depositado — nada que retirar en este paso.",
  "No outstanding debt — nothing to repay in this step.":
    "No hay deuda pendiente — nada que repagar en este paso.",
  "No FXRP collateral left — the unwind is complete.":
    "No queda colateral FXRP — el desmontaje está completo.",
  "live on-chain": "en vivo on-chain",
  "MAX = exact full exit: redeems ALL your kToken shares, interest included — the final amount can only be slightly higher than shown.":
    "MAX = salida completa exacta: redime TODAS tus participaciones kToken, intereses incluidos — el importe final solo puede ser ligeramente mayor que el mostrado.",
  "Repay": "Repagar",
  "Fill active": "Fill activo",
  "buys exactly": "compra exactamente",
  "with": "con",
  "from your own balance, swapped on SparkDEX inside this same batch. Unspent max stays with you. Slippage cap":
    "de tu propio balance, intercambiado en SparkDEX dentro de este mismo batch. Lo no gastado del max se queda contigo. Tope de slippage",
  "What the capital EARNS can be paid out; the capital itself cannot. Harvesting turns a venue's gain above its basis into an amount the payees are owed, and each payee claims their own share. The principal is never touched by either step.":
    "Lo que el capital GENERA puede pagarse; el capital en sí, no. Cosechar convierte la ganancia de un venue por encima de su base en una cantidad que se debe a los beneficiarios, y cada beneficiario reclama su parte. El principal no se toca en ninguno de los dos pasos.",
  "Reading the vault…": "Leyendo la vasija…",
  "Ready to realize": "Listo para realizar",
  "No venue is above what was put into it right now, so there is nothing to harvest. A venue that is flat or down yields nothing and its principal is never touched.":
    "Ningún venue está ahora mismo por encima de lo que se metió en él, así que no hay nada que cosechar. Un venue plano o en pérdidas no rinde nada y su principal no se toca.",
  "Anyone can harvest — it pays the sender nothing, it only credits the payees. Sent from your own Flare wallet.":
    "Cualquiera puede cosechar — no paga nada a quien la envía, solo acredita a los beneficiarios. Se envía desde tu propia wallet de Flare.",
  "Owed to the payees": "Debido a los beneficiarios",
  "No payees configured.": "No hay beneficiarios configurados.",
  "Claim your yield as XRP": "Reclama tu rendimiento como XRP",
  "If this Legacy owes you yield, one signature brings it home as native XRP to your own XRPL account — you never have to hold FXRP. The rail rides a small payment, so enter what you are willing to send with it; it is minted and redeemed back to you along with the yield.":
    "Si este Legacy te debe rendimiento, una firma lo trae a casa como XRP nativo a tu propia cuenta XRPL — nunca tienes que sostener FXRP. El raíl viaja sobre un pequeño pago, así que introduce lo que estés dispuesto a enviar con él; se mintea y se redime de vuelta a ti junto con el rendimiento.",
  "Payment that carries it (XRP)": "Pago que lo transporta (XRP)",
  "Claim to my XRPL account": "Reclamar a mi cuenta XRPL",
  "Connect the XRPL account that is a payee of this Legacy to claim.":
    "Conecta la cuenta XRPL que es beneficiaria de este Legacy para reclamar.",
  "FAssets will not redeem below its on-chain minimum; under that, the yield simply stays owed in the vault until there is enough. Nothing is lost.":
    "FAssets no redime por debajo de su mínimo on-chain; por debajo de eso, el rendimiento simplemente sigue debido en la vasija hasta que haya suficiente. No se pierde nada.",
  "Sent — waiting for the Flare receipt…": "Enviado — esperando el recibo de Flare…",
  "Harvested — the payees are now owed it.": "Cosechado — ahora se les debe a los beneficiarios.",
  "View on Flare": "Ver en Flare",
  "Signed — the executor is dispatching your claim…":
    "Firmado — el executor está despachando tu claim…",
  "Claimed — your yield is on its way back as XRP.":
    "Reclamado — tu rendimiento está de camino de vuelta como XRP.",
  "The principal stays in the vault whatever happens here. It can work in whitelisted venues, come back to the vault, or migrate to a verified successor — it can never be paid out to an address. That is the cage, and it is the point.":
    "El principal se queda en la vasija pase lo que pase aquí. Puede trabajar en venues de la lista blanca, volver a la vasija o migrar a una sucesora verificada — nunca puede pagarse a una dirección. Esa es la jaula, y esa es la gracia.",
  "Could not read the vault.": "No se pudo leer la vasija.",
  "The cage": "La jaula",
  "copied": "copiado",
  "contract": "contrato",
  "Capital held here": "Capital contenido aquí",
  "Idle in the vault": "Parado en la vasija",
  "Working in": "Trabajando en",
  "venue": "venue",
  "shares unreadable": "participaciones ilegibles",
  "the protocol confirms our position": "el protocolo confirma nuestra posición",
  "no position at the protocol yet": "aún sin posición en el protocolo",
  "Yield owed to the payees": "Rendimiento debido a los beneficiarios",
  "There are": "Hay",
  "sitting in the contract that were transferred directly instead of deposited. They never became principal, so they fund nothing and nobody can claim them.":
    "parados en el contrato que se transfirieron directamente en vez de depositarse. Nunca se convirtieron en principal, así que no financian nada y nadie puede reclamarlos.",
  "This vault has migrated to a successor — it accepts no new principal.":
    "Esta vasija ha migrado a una sucesora — ya no acepta principal nuevo.",
  "This is the council's capital, but it is not a wallet: there is no function that pays this principal out to any address. It can work in the whitelisted venues, come back idle to the vault, or migrate to a verified successor. Only the yield it earns can ever be paid to a person.":
    "Este capital es del consejo, pero esto no es una wallet: no existe ninguna función que pague este principal a una dirección. Puede trabajar en los venues de la lista blanca, volver parado a la vasija o migrar a una sucesora verificada. Solo el rendimiento que genera puede llegar a pagarse a una persona.",
  "Activate automation": "Activar automatización",
  "Automations (MoneyFlows)": "Automatizaciones (MoneyFlows)",
  "No automation yet. Add Protect or Harvest above.":
    "Aún sin automatización. Añade Protect o Harvest arriba.",
  "No automation template applies to this position.":
    "Ninguna plantilla de automatización aplica a esta posición.",
  "Borrow settled — the carry is complete.": "Préstamo asentado — el carry está completo.",
  "Claim available": "Claim disponible",
  "Your open DeFi positions on Flare. Open one to add a Protect or Harvest automation — prepared for your signature, never executed automatically.":
    "Tus posiciones DeFi abiertas en Flare. Abre una para añadir una automatización Protect o Harvest — preparada para tu firma, nunca ejecutada automáticamente.",
  "Open DeFi positions": "Posiciones DeFi abiertas",
  "Connect a wallet to view your positions": "Conecta una wallet para ver tus posiciones",
  "Your open": "Tus posiciones",
  "DeFi positions": "DeFi abiertas",
  "Loading positions…": "Cargando posiciones…",
  "Could not load positions": "No se pudieron cargar las posiciones",
  "No open DeFi positions yet": "Aún no hay posiciones DeFi abiertas",
  "Open one from Earn (FXRP → Kinetic or FLR → FTSO), then come back to automate it.":
    "Abre una desde Generar (FXRP → Kinetic o FLR → FTSO) y vuelve para automatizarla.",
  "Send from this Flare wallet to another of your wallets or an external address, and receive with a QR. Astryum prepares everything unsigned — you review and sign in your own wallet.":
    "Envía desde esta wallet de Flare a otra de tus wallets o a una dirección externa, y recibe con un QR. Astryum lo prepara todo sin firmar — tú revisas y firmas en tu propia wallet.",
  "Send between your wallets or to an address, receive with a QR, set XRP aside until a date you choose, and trade on the native XRPL DEX. Astryum prepares everything unsigned — you review and sign in your own wallet.":
    "Envía entre tus wallets o a una dirección, recibe con un QR, aparta XRP hasta la fecha que elijas y opera en el DEX nativo de XRPL. Astryum lo prepara todo sin firmar — tú revisas y firmas en tu propia wallet.",
  "Place a buy or sell order on the native XRPL DEX (XRP ↔ RLUSD). The price comes from the open order book.":
    "Coloca una orden de compra o venta en el DEX nativo de XRPL (XRP ↔ RLUSD). El precio sale del libro de órdenes abierto.",
  "Set XRP aside and DEX buy/sell are native XRPL rails — for Flare, put your assets to work in Earn. Send and receive work here as usual.":
    "Apartar XRP y comprar/vender en el DEX son raíles nativos de XRPL — para Flare, pon tus activos a trabajar en Generar. Enviar y recibir funcionan aquí como siempre.",
  "DEX orders sign on your own XRPL account — connect Xaman from Wallets to trade.":
    "Las órdenes del DEX se firman en tu propia cuenta XRPL — conecta Xaman desde Wallets para operar.",
  "Rests on the book until it fills or you cancel it.":
    "Reposa en el libro hasta que se llena o la cancelas.",
  "Fills against the book now; the remainder is cancelled (immediate-or-cancel).":
    "Se llena contra el libro ahora; el resto se cancela (immediate-or-cancel).",
  "You sell": "Vendes",
  "receive": "recibes",
  "You spend": "Gastas",
  "Order price comes from the open XRPL DEX book — Astryum quotes nothing.":
    "El precio de la orden sale del libro abierto del DEX de XRPL — Astryum no cotiza nada.",
  "Order signed and submitted from your wallet.": "Orden firmada y enviada desde tu wallet.",
  "A DEX order is a spot buy/sell on the native XRPL order book — not a yield product. Astryum builds it unsigned; you sign it in Xaman and can cancel a resting order any time.":
    "Una orden de DEX es una compra/venta spot en el libro nativo de XRPL — no es un producto de yield. Astryum la construye sin firmar; tú la firmas en Xaman y puedes cancelar una orden en reposo cuando quieras.",
  "Signed. The executor is minting the XRP and running the committed batch — the cage is usually born on Flare in about 2–5 minutes. This card becomes the vault the moment it exists.":
    "Firmado. El executor está minteando el XRP y ejecutando el batch comprometido — la jaula suele nacer en Flare en unos 2–5 minutos. Esta tarjeta se convierte en la vasija en cuanto existe.",
  "Your council signs this ONE payment — each member from their own device. It carries the whole birth: create this Legacy's own cage on Flare (a vault that obeys only this council, for ever), then deposit the minted FXRP as its first principal. Nobody holds it in between, and nobody else could have created it: the factory only obeys this council's own account.":
    "Tu consejo firma este ÚNICO pago — cada miembro desde su propio dispositivo. Lleva el nacimiento completo: crear la jaula propia de este Legacy en Flare (una vasija que obedece solo a este consejo, para siempre) y depositar el FXRP minteado como su primer principal. Nadie lo custodia por el camino, y nadie más podría haberla creado: el factory solo obedece a la cuenta propia de este consejo.",
  "The principal that enters a cage never comes back out to an address — only the yield it earns can be paid to people. And this signature does NOT choose where the capital works: that is a second, separate order of the quorum.":
    "El principal que entra en una jaula nunca vuelve a salir hacia una dirección — solo el rendimiento que genera puede pagarse a personas. Y esta firma NO elige dónde trabaja el capital: eso es una segunda orden del quórum, separada.",
  "Create this Legacy's cage": "Crear la jaula de este Legacy",
  "This Legacy has no cage yet": "Este Legacy aún no tiene jaula",
  "A cage is a contract deployed for ONE council: its address is written into the bridge when it is born and can never point at another. This council governs perfectly well without one — and it can never use another Legacy's. When the family is ready to lock productive capital in code, the quorum creates its own here, with one signature.":
    "Una jaula es un contrato desplegado para UN consejo: su dirección se escribe en el puente cuando nace y nunca puede apuntar a otro. Este consejo gobierna perfectamente sin una — y nunca puede usar la de otro Legacy. Cuando la familia esté lista para encerrar capital productivo en código, el quórum crea la suya aquí, con una firma.",
  "Beta limit: a cage accepts at most 5 XRP in total through Astryum. The principal that enters NEVER comes back out to an address — only the yield it earns can be paid to people. Do not cage anything you cannot afford to leave locked.":
    "Límite de la beta: una jaula acepta como máximo 5 XRP en total a través de Astryum. El principal que entra NUNCA vuelve a salir hacia una dirección — solo el rendimiento que genera puede pagarse a personas. No enjaules nada que no puedas permitirte dejar encerrado.",
  "First principal (XRP)": "Primer principal (XRP)",
  "e.g. 5": "p. ej. 5",
  "One payment does both: it mints this XRP into FXRP and deposits it as the cage's first principal. Small fees apply (minting + executor) and are disclosed before anyone signs.":
    "Un solo pago hace las dos cosas: mintea este XRP en FXRP y lo deposita como primer principal de la jaula. Aplican comisiones pequeñas (mint + executor) y se muestran antes de que nadie firme.",
  "Compose the birth for the quorum": "Componer el nacimiento para el quórum",
  "The constitution must be anchored on XRPL first — the cage is born pointing at that exact text, and its rules (the venues, the lineage cut, the one-way principal) are enforced by code from block one.":
    "La constitución debe anclarse antes en XRPL — la jaula nace apuntando a ese texto exacto, y sus reglas (los venues, el corte de linaje, el principal de sentido único) las impone el código desde el bloque uno.",
  "New MoneyFlow": "Nuevo MoneyFlow",
  "Compose it manually or with the AI agent — you always sign.":
    "Compónlo a mano o con el agente de IA — tú siempre firmas.",
  "With AI": "Con IA",
  "Manual": "Manual",
  "Strategy · MoneyFlows": "Estrategia · MoneyFlows",
  "saved": "guardado",
  "A MoneyFlow watches without discretion; when it fires it prepares the exact on-chain action for YOU to sign. Configure triggers over your DeFi positions. It always expires (90 days at most) and you can pause or delete it instantly — Astryum never signs or executes.":
    "Un MoneyFlow vigila sin discreción; cuando se dispara, prepara la acción on-chain exacta para que la firmes TÚ. Configura disparadores sobre tus posiciones DeFi. Siempre caduca (90 días como máximo) y puedes pausarlo o borrarlo al instante — Astryum nunca firma ni ejecuta.",
  "Manual or with AI": "A mano o con IA",
  "draft": "borrador",
  "Custom drafts can’t run in the beta":
    "Los borradores personalizados no pueden ejecutarse en la beta",
  "No active MoneyFlows yet — compose one with the ＋ card, or add Protect/Harvest from a position.":
    "Aún no hay MoneyFlows activos — compón uno con la tarjeta ＋, o añade Protect/Harvest desde una posición.",
  "No saved MoneyFlows — draft one with the ＋ card and it will wait here until you run it.":
    "No hay MoneyFlows guardados — borra uno con la tarjeta ＋ y esperará aquí hasta que lo ejecutes.",
  "% of max borrow capacity": "% de la capacidad máxima de préstamo",
  "Astryum never signs — your wallet does": "Astryum nunca firma — firma tu wallet",
  "USDT0 borrowed": "USDT0 prestado",
  "FXRP/USD now": "FXRP/USD ahora",
  "Stop-loss triggers below": "El stop-loss se dispara por debajo de",
  "Astryum does not custody your funds.": "Astryum no custodia tus fondos.",
  "Sign anyway — the dry-run says it will fail": "Firmar igualmente — el ensayo dice que fallará",
  "Approve the Payment in Xaman…": "Aprueba el Payment en Xaman…",
  "Confirmed on-chain — the position appears in Positions.":
    "Confirmado on-chain — la posición aparece en Posiciones.",
  "APY": "APY",
  "Unsupported": "Unsupported",
  "Fund the account before you start.": "Fondea la cuenta antes de empezar.",
  "The full ceremony — council, rehearsal escrow, constitution — needs about":
    "La ceremonia completa — consejo, escrow de ensayo, constitución — necesita unos",
  "Add at least": "Añade al menos",
  "first — a signature that fails for insufficient reserve still costs its fee.":
    "primero — una firma que falla por reserva insuficiente cuesta su comisión igualmente.",
  "Astryum composes this AccountSet unsigned; you sign it with the account’s OWN master key (single signature). XRPL requires the master key itself — the council quorum cannot do this one. Astryum never signs or broadcasts on your behalf.":
    "Astryum compone este AccountSet sin firmar; tú lo firmas con la master key PROPIA de la cuenta (firma única). XRPL exige la master key en sí — el quórum del consejo no puede hacer esta. Astryum nunca firma ni difunde en tu nombre.",
  "Prepare closing the door": "Preparar el cierre de la puerta",
  "Master key disabled — the door is closed. The account now obeys only the council.":
    "Master key deshabilitada — la puerta está cerrada. La cuenta ahora obedece solo al consejo.",
  "A programmed, conditioned, revocable transfer constituted in life — it creates no legal regime, and nothing transfers at death.":
    "Una transferencia programada, condicionada y revocable constituida en vida — no crea ningún régimen legal, y nada se transfiere a la muerte.",
  "Astryum composes unsigned; the quorum signs each proposal — the same bytes, once, in order.":
    "Astryum compone sin firmar; el quórum firma cada propuesta — los mismos bytes, una vez, en orden.",
  "The accounts this Legacy controls — its council on XRPL and the Smart Account it operates on Flare. Read-only here; the quorum moves funds from Movements.":
    "Las cuentas que controla este Legacy — su consejo en XRPL y la Smart Account que opera en Flare. Solo lectura aquí; el quórum mueve fondos desde Movimientos.",
  "On XRPL nobody holds a key: this account is protected by its council (quorum), never by Astryum.":
    "En XRPL nadie tiene una llave: esta cuenta la protege su consejo (quórum), nunca Astryum.",
  "The signature was cancelled or expired in Xaman.": "La firma se canceló o caducó en Xaman.",
  "Sign with the master key in Xaman": "Firma con la master key en Xaman",
  "Scan this with the Xaman that holds this account’s master key. You do not need to connect any wallet here — the request is for this account only, and only its master key can sign it.":
    "Escanea esto con el Xaman que tiene la master key de esta cuenta. No necesitas conectar ninguna wallet aquí — la petición es solo para esta cuenta, y solo su master key puede firmarla.",
  "Preparing the Xaman request…": "Preparando la petición de Xaman…",
  "waiting for the master key signature": "esperando la firma de la master key",
  "Signed and submitted — the door is closing.": "Firmado y enviado — la puerta se está cerrando.",
  "Signed — but Xaman reported no submission result yet. Check the account on the explorer before assuming the door closed.":
    "Firmado — pero Xaman aún no informó del resultado del envío. Comprueba la cuenta en el explorador antes de asumir que la puerta se cerró.",
  "Xaman submitted it but the ledger returned": "Xaman lo envió pero el ledger devolvió",
  "Try again": "Inténtalo de nuevo",
  "Compose a movement for this Legacy — the quorum signs it in Proposals":
    "Compón un movimiento para este Legacy — el quórum lo firma en Propuestas",
  "Governed by its council — Astryum never signs":
    "Gobernada por su consejo — Astryum nunca firma",
  "Wallets this Legacy controls": "Wallets que controla este Legacy",
  "The council governs on XRPL; the Smart Account it controls produces on Flare. Read-only here — every action is signed by the council, never by Astryum.":
    "El consejo gobierna en XRPL; la Smart Account que controla produce en Flare. Solo lectura aquí — cada acción la firma el consejo, nunca Astryum.",
  "No chains yet": "Aún sin cadenas",
  "Legacy wallets": "Wallets del Legacy",
  "Resolving this Legacy’s Smart Account… its wallets appear here once the council’s Flare account is known.":
    "Resolviendo la Smart Account de este Legacy… sus wallets aparecen aquí en cuanto se conozca la cuenta de Flare del consejo.",
  "Protection buffer": "Colchón de protección",
  "to liquidation": "hasta liquidación",
  "DeFi": "DeFi",
  "Connect a wallet to view your portfolio": "Conecta una wallet para ver tu cartera",
  "Connect a wallet": "Conecta una wallet",
  "the relay could not deliver the proof": "el relay no pudo entregar la prueba",
  "stuck": "atascada",
  "The FDC round takes about": "La ronda FDC tarda unos",
  "The quorum can step away — the wait is normal, not a failure.":
    "El quórum puede irse tranquilo — la espera es normal, no un fallo.",
  "The order stays valid — the same signed transaction can be re-delivered by anyone (permissionless), no new signature needed.":
    "La orden sigue válida — la misma transacción firmada puede re-entregarla cualquiera (permissionless), sin firma nueva.",
  "Transfer settled on-chain.": "Transferencia asentada on-chain.",
  "Transfer signed — settling…": "Transferencia firmada — asentándose…",
  "Payment validated on the XRPL ledger.": "Payment validado en el ledger de XRPL.",
  "Signed — waiting for ledger validation…": "Firmado — esperando la validación del ledger…",
  "Validated — the ledger applied it.": "Validado — el ledger lo aplicó.",
  "The ledger validated it but it FAILED:": "El ledger lo validó pero FALLÓ:",
  "Broadcast accepted — still waiting for ledger validation. Check XRPScan in a moment; do not assume it applied.":
    "Difusión aceptada — aún esperando la validación del ledger. Mira XRPScan en un momento; no asumas que se aplicó.",
  "Firelight does NOT pay instantly: this redeem burns your stXRP now and queues the FXRP into a ~24h withdrawal period. Nothing arrives in this transaction — your position will keep showing the FXRP in flight with a Claim button, and one click releases it when the period ends (exact time shown before you sign).":
    "Firelight NO paga al instante: este redeem quema tu stXRP ahora y encola el FXRP en un periodo de retirada de ~24 h. En esta transacción no llega nada — tu posición seguirá mostrando el FXRP en vuelo con un botón de Claim, y un clic lo libera cuando el periodo termina (la hora exacta se muestra antes de firmar).",
  "Withdrawal settled on Flare.": "Retirada asentada en Flare.",
  "Withdrawal signed — settling on Flare…": "Retirada firmada — asentándose en Flare…",
  "Claim settled — the FXRP is in your wallet.": "Claim asentado — el FXRP está en tu wallet.",
  "Claim signed — settling on Flare…": "Claim firmado — asentándose en Flare…",
  "Signed — taking longer than normal, still watching the chain.":
    "Firmado — tarda más de lo normal, seguimos vigilando la cadena.",
  "Signed and settled on-chain.": "Firmado y asentado on-chain.",
  "Live on-chain reads across your connected wallets — one source, every lens.":
    "Lecturas on-chain en vivo de tus wallets conectadas — una fuente, todas las lentes.",
  "Live reads from the same source as Portfolio — verify on-chain before acting.":
    "Lecturas en vivo de la misma fuente que Cartera — verifica on-chain antes de actuar.",
  "Here is where your capital stands today.": "Aquí es donde está tu capital hoy.",
  "API base": "Base de la API",
  "Claim": "Reclamar",
  "Legacies": "Legacies",
  "MoneyFlows": "MoneyFlows",
  "Describe what you want to do…": "Describe qué quieres hacer…",
  "held in the account; it currently holds": "retenidos en la cuenta; ahora mismo tiene",
  "Broadcast accepted — still waiting for ledger validation. Check XRPScan in a moment; if it did not apply, anchor again.":
    "Difusión aceptada — aún esperando la validación del ledger. Mira XRPScan en un momento; si no se aplicó, ancla de nuevo.",
  "Nickname": "Apodo",

  // ── Pasada i18n 2026-08-08, parte B: textos que estaban DUROS en el código
  // (sin t()) — seguridad, capacidades por cadena, error boundary, a11y del
  // shell y gráficas — envueltos en t() en el mismo cambio que estas entradas. ──
  "Something went wrong on this page": "Algo salió mal en esta página",
  "Unknown error": "Error desconocido",
  "Stack trace (dev only)": "Stack trace (solo dev)",
  "✓ Copied": "✓ Copiado",
  "Copy error": "Copiar el error",
  "Verifying access…": "Verificando acceso…",
  "Skip setup": "Saltar la configuración",
  "Loading supported chains…": "Cargando cadenas compatibles…",
  "Couldn't load chain capabilities.": "No se pudieron cargar las capacidades por cadena.",
  "No chains available.": "No hay cadenas disponibles.",
  "supported": "compatible",
  "not supported": "no compatible",
  "Honest support frontier — a ✓ means that capability is actually wired for the chain, not just \"enabled\". Execution-side capabilities on Flare depend on FLARE_DEFI_ENABLED.":
    "Frontera de soporte honesta — un ✓ significa que esa capacidad está cableada de verdad para la cadena, no solo «habilitada». Las capacidades de ejecución en Flare dependen de FLARE_DEFI_ENABLED.",
  "Passkeys": "Passkeys",
  "Add this device as a passkey to sign in with your fingerprint, face, or device PIN — no password needed.":
    "Añade este dispositivo como passkey para iniciar sesión con tu huella, tu cara o el PIN del dispositivo — sin contraseña.",
  "Device name (optional)": "Nombre del dispositivo (opcional)",
  "Waiting for device…": "Esperando al dispositivo…",
  "Add a passkey": "Añadir una passkey",
  "Passkey added": "Passkey añadida",
  "Step-up signature locks": "Candados de firma reforzada",
  "Require a fresh wallet signature before reading or changing sensitive parts of the app — so even if someone gets into your account, they can't touch what matters without your device. Pick exactly what to protect.":
    "Exige una firma fresca de tu wallet antes de leer o cambiar las partes sensibles de la app — así, aunque alguien entre en tu cuenta, no puede tocar lo que importa sin tu dispositivo. Elige exactamente qué proteger.",
  "Link a wallet first — step-up locks are confirmed with a wallet signature.":
    "Vincula una wallet primero — los candados se confirman con una firma de wallet.",
  "Enable step-up locks": "Activar los candados",
  "Master switch. When off, nothing is gated.":
    "Interruptor maestro. Apagado, nada queda protegido.",
  "Re-ask after": "Volver a pedir tras",
  "Seconds a signature stays valid (60–1800).": "Segundos que una firma sigue válida (60–1800).",
  "Feature": "Función",
  "Read": "Leer",
  "Write": "Escribir",
  "Saving…": "Guardando…",
  "Save protection settings": "Guardar la protección",
  "Security verification": "Verificación de seguridad",
  "Confirm with your wallet": "Confirma con tu wallet",
  "You protected": "Protegiste",
  "Sign a quick verification message with a linked wallet to continue. No funds move and no transaction is sent — this only proves it's really you.":
    "Firma un mensaje rápido de verificación con una wallet vinculada para continuar. No se mueven fondos ni se envía ninguna transacción — solo demuestra que eres tú de verdad.",
  "Waiting for signature…": "Esperando la firma…",
  "Sign to continue": "Firmar para continuar",
  "Open menu": "Abrir el menú",
  "Close menu": "Cerrar el menú",
  "Search and jump to anywhere": "Busca y salta a cualquier parte",
  "Account settings": "Ajustes de la cuenta",
  "Dev session": "Sesión de desarrollo",
  "No HF data": "Sin datos de HF",
  "No drivers": "Sin factores",
  "No history": "Sin historial",
  "No history yet": "Aún sin historial",
  "stale": "desfasado",
  "Connect a wallet to view your capital map": "Conecta una wallet para ver tu mapa de capital",
  "The map reads the same connected wallets as the rest of the dashboard.":
    "El mapa lee las mismas wallets conectadas que el resto del dashboard.",

  // ── Sidebar "In progress" card (settlements moved under To sign, 0.9.32) ──
  'In progress': 'En curso',
  Minimise: 'Minimizar',
  'See the operations being watched': 'Ver las operaciones vigiladas',
  'Confirmed on-chain': 'Confirmada on-chain',
  'Failed on-chain': 'Falló on-chain',
  'Taking longer — still watching': 'Tarda más de lo normal — seguimos vigilando',
  'Settling on-chain…': 'Liquidándose on-chain…',
  'Everything you sign is watched here until the chain confirms it.':
    'Todo lo que firmas se vigila aquí hasta que la cadena lo confirma.',
  'Operation signed': 'Operación firmada',
  'On its way on-chain — follow it in the sidebar, under To sign.':
    'En camino on-chain — síguela en la barra lateral, bajo Para firmar.',

  // Puntuación idéntica en ambos idiomas (LegacyActivityFeed la pasa por t()):
  // presente solo para que la auditoría AST se mantenga en 0 claves ausentes.
  '—': '—',

  // ── Earn finder, paso de resultado (0.9.40) ──
  route: 'ruta',
  routes: 'rutas',
  'Your answers': 'Tus respuestas',
  'This route can work with that:': 'Esta ruta puede funcionar con eso:',
  'These routes can work with that:': 'Estas rutas pueden funcionar con eso:',
  'A factual match, not a recommendation: the full card adds the token journey, every fact and the technical composition — nothing starts without your review and your signature.':
    'Una coincidencia factual, no una recomendación: la tarjeta completa añade el viaje del token, todos los hechos y la composición técnica — nada arranca sin tu revisión y tu firma.',
  'See this route in detail': 'Ver esta ruta en detalle',
  'See these routes in detail': 'Ver estas rutas en detalle',

  // ── Earn: the two-question strategy finder (0.9.32) ──
  // (Wallets 0.9.32 reutiliza 'Holds' y 'Watch-only', ya presentes arriba.)
  'Find your route': 'Encuentra tu ruta',
  'A filter, not advice — every route shows its own live data':
    'Un filtro, no un consejo — cada ruta muestra sus propios datos en vivo',
  'Two questions narrow the six routes to the ones that can work with what you hold. You can always browse the full list.':
    'Dos preguntas reducen las seis rutas a las que pueden funcionar con lo que tienes. Siempre puedes ver la lista completa.',
  'What do you want to put to work?': '¿Qué quieres poner a trabajar?',
  'In a Xaman/XRPL wallet, or already as FXRP on Flare':
    'En una wallet Xaman/XRPL, o ya como FXRP en Flare',
  'The Flare network token, in an EVM wallet — FTSO delegation':
    'El token de la red Flare, en una wallet EVM — delegación FTSO',
  'Just browsing': 'Solo estoy mirando',
  'Show me all six routes': 'Enséñame las seis rutas',
  'How should your XRP work?': '¿Cómo debería trabajar tu XRP?',
  'Lend it out — simple': 'Préstalo — simple',
  'Supply FXRP to a lending market and withdraw whenever you want. No borrowing involved.':
    'Deposita FXRP en un mercado de préstamo y retira cuando quieras. Sin pedir prestado.',
  'Lend and borrow against it (carry)': 'Presta y pide prestado contra él (carry)',
  'Supply FXRP and borrow a stablecoin against it. More moving parts — it carries liquidation risk.':
    'Deposita FXRP y pide una stablecoin prestada contra él. Más piezas en juego — tiene riesgo de liquidación.',
  'Deposit into a managed vault': 'Deposita en una vault gestionada',
  'A vault whose strategy is run by its manager (Clearstar, Monarq). You deposit and hold the vault token.':
    'Una vault cuya estrategia lleva su gestor (Clearstar, Monarq). Tú depositas y te quedas el token de la vault.',
  'Stake it': 'Haz staking',
  'Convert to stXRP through Firelight and hold the staked position.':
    'Conviértelo en stXRP vía Firelight y mantén la posición en staking.',
  'Whatever you pick here only filters the list — each route still shows its live rate, risks and full composition before you decide anything.':
    'Lo que elijas aquí solo filtra la lista — cada ruta sigue mostrando su tipo en vivo, sus riesgos y su composición completa antes de que decidas nada.',
  'Not sure where to start? Two questions narrow the list to the routes that can work with what you hold.':
    '¿No sabes por dónde empezar? Dos preguntas reducen la lista a las rutas que pueden funcionar con lo que tienes.',
  'Guide me': 'Guíame',
  '1 route can work with your answers — its live data and risks are on the card.':
    '1 ruta puede funcionar con tus respuestas — sus datos en vivo y riesgos están en la tarjeta.',
  'routes can work with your answers — their live data and risks are on the cards.':
    'rutas pueden funcionar con tus respuestas — sus datos en vivo y riesgos están en las tarjetas.',
  'Change answers': 'Cambiar respuestas',
  'Show all six': 'Ver las seis',
  // Settings › Preferences — fila de idioma (mudada del sidebar, 2026-08-08)
  'Texts and number formats.': 'Los textos y el formato de los números.',
};

const TABLES: Record<Lang, Record<string, string>> = { es: { ...ES, ...PAGES }, en: {} };

export function translate(lang: Lang, s: string): string {
  if (lang === 'en') return s;
  return TABLES[lang][s] ?? s;
}
