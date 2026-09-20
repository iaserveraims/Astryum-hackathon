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
  // The /app overview is named "Home" ("Summary" stays for
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
  'How you appear across Astryum. Saved to your account.':
    'Cómo apareces en Astryum. Se guarda en tu cuenta.',
  "Saved on this device — the account copy didn't update.":
    'Guardado en este dispositivo — la copia de tu cuenta no se actualizó.',

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
  // La puerta de cada aviso accionable, en la propia lista.
  'Open it': 'Abrirlo',
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
  // ── Apariencia: el TEMA (material) y la LUZ ──
  // «Tema» deja de significar claro/oscuro y pasa a significar de qué material
  // está hecho el panel. La luz se llama por su nombre.
  Astryum: 'Astryum',
  'Light or dark': 'Claro u oscuro',
  'Every theme has both faces. You can also let your device decide.':
    'Cada tema tiene sus dos caras. También puedes dejar que lo decida tu dispositivo.',
  'The material the panel is made of — colours, drawings and layout, not just a tint. It follows your account, not this browser.':
    'De qué material está hecho el panel: colores, dibujos y disposición, no solo un tinte. Va con tu cuenta, no con este navegador.',
  'Deep space and warm gold. Living scenes on the doors, generous corners, orbits and a breathing star field. The house look — nothing moves from where you know it.':
    'Espacio profundo y oro cálido. Escenas vivas en las puertas, esquinas generosas, órbitas y un campo de estrellas que respira. El aspecto de siempre: nada se mueve de donde lo conoces.',
  'Ink on register paper. Bronze instead of gold, square corners, serif headings, rules instead of shadows, and engraved marks — the guilloche rosette, the balance, the portico — instead of scenes.':
    'Tinta sobre papel de registro. Bronce en vez de oro, esquinas cuadradas, titulares en serif, filetes en vez de sombras, y grabados —la roseta de guilloché, la balanza, el pórtico— en vez de escenas.',
  'The change did not reach your account — it stays on this device, so other browsers will not see it. Try again in a moment.':
    'El cambio no ha llegado a tu cuenta: se queda en este dispositivo, así que otros navegadores no lo verán. Inténtalo de nuevo en un momento.',
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
  // Puertas de Earn a una línea + HelpDot: el texto largo vive
  // en el interrogante (claves largas ya existentes, reutilizadas).
  'Your tokens work. No debt.': 'Tus tokens trabajan. Sin deuda.',
  'Borrow — your tokens stay yours.': 'Pide prestado — tus tokens siguen siendo tuyos.',
  'A third party runs it, inside your limits.': 'Lo dirige un tercero, dentro de tus límites.',
  'Describe what you want in your own words and the agent compiles it into a strategy for you to review. You always sign — it never signs or moves funds on its own.':
    'Describe lo que quieres con tus palabras y el agente lo compila en una estrategia para que la revises. Firmas siempre tú — él nunca firma ni mueve fondos por su cuenta.',
  // PortfolioSyncBadge: el total parcial se declara parcial.
  'Still reading your wallets — the figure keeps growing':
    'Aún leyendo tus wallets — la cifra sigue creciendo',
  // Dorso de la tarjeta compacta ('Wallet' ya existía en Orbit): la etiqueta
  // de la segunda dirección y su copia.
  'Copy the Smart Account address': 'Copiar la dirección de la Smart Account',
  // ── Tarjetas compactas de Wallets ──
  'Open this card': 'Abre esta tarjeta',
  'Flip the card — quick actions on the back': 'Gira la tarjeta — acciones rápidas en el dorso',
  'Flip back': 'Girar de vuelta',
  // La pestaña de la invitación al giro — una palabra, cabe en la píldora.
  'Turn': 'Girar',
  'Turn back': 'Volver',
  'Collapse this card': 'Contrae esta tarjeta',
  'No assets read yet': 'Aún sin activos leídos',
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
  // ── El alta dice SIEMPRE en qué acabó ──
  'Checking what this address is…': 'Mirando qué es esta dirección…',
  'This account is governed by a council': 'Esta cuenta está gobernada por un consejo',
  'The ledger says its signatures come from a quorum, not from a single key. Adding it is fine — it lands on the Legacy shelf as read-only, and the council keeps signing.':
    'El ledger dice que sus firmas salen de un quórum, no de una sola llave. Puedes añadirla igualmente: aterriza en el estante Legacy en solo lectura, y quien firma sigue siendo el consejo.',
  'I could not check this account': 'No he podido comprobar esta cuenta',
  'The ledger read failed, so I do not know whether this account has a council. You can add it anyway — I am telling you instead of guessing.':
    'La lectura del ledger falló, así que no sé si esta cuenta tiene consejo. Puedes añadirla igualmente — te lo digo en vez de suponerlo.',
  'Add it anyway': 'Añadir igualmente',
  'Wallet added': 'Wallet añadida',
  'You will find it on the Legacy shelf, as read-only: its council signs, never a single key.':
    'La encontrarás en el estante Legacy, en solo lectura: firma su consejo, nunca una sola llave.',
  'You will find it on the Personal shelf, in your wallet list.':
    'La encontrarás en el estante Personal, en tu lista de wallets.',
  'You already had this one': 'Esta ya la tenías',
  'It is already in your wallet list, and nothing was changed.':
    'Ya está en tu lista de wallets, y no se ha cambiado nada.',
  'Add another': 'Añadir otra',
  'Connected again': 'Conectada de nuevo',
  'It was already in your list. What changed is this browser: it has the Xaman session for this account again, the one the Manager desk and signatures use.':
    'Ya estaba en tu lista. Lo que ha cambiado es este navegador: vuelve a tener la sesión de Xaman de esta cuenta, la que usan la mesa del gestor y las firmas.',
  'Linked to your account, not connected in this browser — Xaman will ask for this account when you sign.':
    'Enlazada a tu cuenta, sin sesión en este navegador: al firmar, Xaman te pedirá esta cuenta.',
  'Reading your wallets…': 'Leyendo tus wallets…',
  'Enter the vault — your signature': 'Entrar en el vault: tu firma',
  'Leave the vault — your signature': 'Salir del vault: tu firma',
  'This account is linked to you, but Xaman is not connected in this browser. Connect it to sign — nothing is prepared until then, so no seat is taken.':
    'Esta cuenta está enlazada a ti, pero Xaman no está conectada en este navegador. Conéctala para firmar: hasta entonces no se prepara nada y no se ocupa ningún asiento.',
  'Connect Xaman with': 'Conectar Xaman con',
  'Xaman connected a different account': 'Xaman ha conectado otra cuenta',
  'switch to': 'cambia a',
  'in Xaman and try again.': 'en Xaman y vuelve a intentarlo.',
  'Signed. The ledger is validating it and this station will turn green on its own — nothing to sign again.':
    'Firmado. El ledger lo está validando y esta estación se pondrá en verde sola: no hay nada que volver a firmar.',
  'Signed — the network is proving your cage on Flare.': 'Firmado: la red está probando tu jaula en Flare.',
  'One signature is one birth: nothing to sign again, and nothing more is charged. This station turns green on its own, usually within a couple of minutes.':
    'Una firma es un nacimiento: no hay nada que volver a firmar ni se cobra nada más. Esta estación se pone en verde sola, normalmente en un par de minutos.',
  'Your signature on the ledger': 'Tu firma en el ledger',
  'Done on this account': 'Hecha en esta cuenta',
  'Why it counts': 'Por qué cuenta',
  'Nothing to sign here.': 'Aquí no hay nada que firmar.',
  'Resumed at': 'Retomado en',
  'earlier station(s) were already done on this account — read from the ledger, never assumed.':
    'estación(es) anteriores ya estaban hechas en esta cuenta: leídas del ledger, nunca supuestas.',
  'No XRPL wallet is linked to your account yet, and none is connected in this browser.':
    'Aún no hay ninguna wallet XRPL enlazada a tu cuenta, ni conectada en este navegador.',
  'an XRPL wallet of yours — linked to your account or connected in this browser':
    'una wallet XRPL tuya, enlazada a tu cuenta o conectada en este navegador',
  'A vault obeys ONE XRPL account. Pick which of your XRPL wallets — linked to your account, or connected in this browser — acts as the manager; credentials, cage and orders on this desk all follow this choice.':
    'Una bóveda obedece a UNA cuenta XRPL. Elige cuál de tus wallets XRPL, enlazadas a tu cuenta o conectadas en este navegador, actúa como gestora; las credenciales, la jaula y las órdenes de esta mesa siguen esa elección.',
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

  // ── Wallets — organizer v2: origin shelves + list default ──
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
  'History accumulates as snapshots run': 'El historial se acumula a medida que se ejecutan los snapshots',
  'No readings inside this window — showing the last one on record.':
    'No hay lecturas dentro de esta ventana — se enseña la última registrada.',
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
  // ── xrplTxTypeLabel (Fase 1): tipos XRPL en palabras ──
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

  // ── Dashboard: capital performance band + earn hub v2 ───────────
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

  // ── Portfolio header (aesthetics pass) ───────────────────────────
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

  // ── Aviso regulatorio del activo prestado (assetDisclosure.ts): el carry
  //    de Kinetic pide USDT0, que es justo el activo que el invariante #9
  //    deja fuera de las estrategias dirigidas a la UE. Se dice en la CARA de
  //    la card, en el detalle, en la ficha y en la pantalla previa a
  //    la firma. ──
  'Real product · not MiCA-compliant: it borrows USDT0':
    'Producto real · no cumple MiCA: pide prestado USDT0',
  'USDT0 is not a MiCA-authorised e-money token':
    'USDT0 no es un token de dinero electrónico autorizado bajo MiCA',
  'This entry borrows USDT0 — the omnichain form of Tether’s USDT. It carries no e-money-token authorisation under the EU’s MiCA regulation, and it sits outside the EMTs-only rule Astryum applies to its own EU-facing strategies (USDC, EURC, RLUSD). Astryum does not issue, offer or trade it: the loan is taken in Kinetic’s market, prepared unsigned, and signed by you in your own wallet under your own responsibility. The lend-only entry puts the same FXRP to work with no borrow and no USDT0.':
    'Esta entrada pide prestado USDT0 — la forma omnichain del USDT de Tether. No tiene autorización como token de dinero electrónico bajo el reglamento europeo MiCA, y queda fuera de la regla de solo-EMT que Astryum aplica a sus propias estrategias dirigidas a la UE (USDC, EURC, RLUSD). Astryum no lo emite, ni lo ofrece, ni lo negocia: el préstamo se toma en el mercado de Kinetic, se prepara sin firmar y lo firmas tú en tu propia wallet, bajo tu responsabilidad. La entrada de solo prestar pone el mismo FXRP a trabajar sin préstamo y sin USDT0.',
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
  // ── translateError (Fase 1): un fallo → una frase ──
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
  // La misma casilla cuando NO se ha podido leer todo: se dice qué se miró y
  // qué no, en vez de afirmar una tranquilidad que nadie ha comprobado.
  "No debt to watch on the chains we could read — but one position couldn't be read just now, so this isn't the full picture.":
    'Sin deuda que vigilar en las chains que pudimos leer — pero una posición no se pudo leer ahora mismo, así que esto no es la foto completa.',
  "One position couldn't be read just now — this reading may not be your worst.":
    'Una posición no se pudo leer ahora mismo — puede que esta lectura no sea la peor que tienes.',
  'Your position is': 'Tu posición está',
  "you're protected if the price falls about": 'te proteges si el precio cae en torno a un',
  'If the price touches': 'Si el precio toca',
  'your position is liquidated.': 'te liquidan la posición.',
  Distance: 'Distancia',
  'Net P&L per strategy appears once your position accumulates history.':
    'El P&L neto por estrategia aparece cuando tu posición acumula histórico.',

  // ── Estrategias · shelves + registro (reorg UI) ────────────────
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

  // ── Earn · puertas Ahorro y Crear manualmente (reorg UI) ───────
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
  Protections: 'Protecciones',
  'watching your positions': 'vigilando tus posiciones',
  'A watch that repays for you before liquidation — you sign every move.':
    'Una vigilancia que repaga por ti antes de la liquidación — cada movimiento lo firmas tú.',
  'Which position do you want to watch?': '¿Qué posición quieres vigilar?',
  'Choose another position': 'Elegir otra posición',
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

  // ── Fix pass: vault actions (now t()-wrapped) ──
  'Supply FXRP + borrow USDT0': 'Aporta FXRP + pide USDT0',
  'Put your XRP to work': 'Pon tu XRP a trabajar',
  'Wrap + delegate to FTSO': 'Wrap + delegar a FTSO',

  // ── eth-morpho pair (W3): the two Ethereum cards ──
  'Supply FXRP + borrow RLUSD': 'Aporta FXRP + pide RLUSD',
  'Lend RLUSD, earn the vault rate': 'Presta RLUSD y cobra el tipo de la bóveda',
  'Ethereum wallet': 'Wallet de Ethereum',
  'Your FXRP works as collateral in the Morpho FXRP/RLUSD market on Ethereum, and you borrow RLUSD — a regulated e-money token — against it, watched by repay protection.':
    'Tu FXRP trabaja como colateral en el mercado FXRP/RLUSD de Morpho en Ethereum, y pides RLUSD — un token de dinero electrónico regulado — contra él, vigilado por la protección de repago.',
  'Your RLUSD is lent into the Sentora RLUSD vault on Morpho (Ethereum). Lending here is exposure to the aggregate of the curator’s allocations — not to a single market. No debt on your side; withdraw against the vault’s live liquidity.':
    'Tu RLUSD se presta en la bóveda RLUSD de Sentora sobre Morpho (Ethereum). Prestar aquí es exposición al agregado de las asignaciones del curador — no a un solo mercado. Sin deuda por tu parte; retiras contra la liquidez viva de la bóveda.',
  'Morpho FXRP/RLUSD market (Ethereum)': 'Mercado FXRP/RLUSD de Morpho (Ethereum)',
  'RLUSD — a regulated e-money token': 'RLUSD — token de dinero electrónico regulado',
  'A repay intent at the trigger you choose': 'Un intent de repago en el disparador que elijas',
  'Sentora RLUSD Main vault (Morpho)': 'Bóveda Sentora RLUSD Main (Morpho)',
  'Sentora decides the allocation — aggregate exposure': 'Sentora decide la asignación — exposición agregada',
  'No debt on your side — curator and market risk remain': 'Sin deuda por tu parte — quedan el riesgo del curador y del mercado',
  'Anytime, against the vault’s live liquidity': 'Cuando quieras, contra la liquidez viva de la bóveda',
  Borrows: 'Pide prestado',
  Curator: 'Curador',
  'The council’s vault lives on Flare and can only put principal to work in whitelisted Flare venues. This entry works on Ethereum and borrows RLUSD — it cannot be composed as a council order.':
    'La vasija del consejo vive en Flare y solo puede poner el principal a trabajar en venues de Flare autorizados. Esta entrada trabaja en Ethereum y pide RLUSD — no puede componerse como orden del consejo.',
  'The council’s vault lives on Flare and can only put principal to work in whitelisted Flare venues. This entry lends RLUSD on Ethereum — it cannot be composed as a council order.':
    'La vasija del consejo vive en Flare y solo puede poner el principal a trabajar en venues de Flare autorizados. Esta entrada presta RLUSD en Ethereum — no puede componerse como orden del consejo.',
  'collateral earns no supply rate here': 'el colateral no cobra tipo de supply aquí',
  'FXRP collateral earns 0% here — Morpho never lends collateral':
    'El FXRP de colateral genera 0% aquí — Morpho nunca presta el colateral',
  'live rate on Morpho — source unavailable': 'tipo vivo en Morpho — fuente no disponible',
  'Pick a created strategy or create one with text. Every strategy runs live on mainnet, in beta testing.':
    'Elige una estrategia creada o crea una con texto. Todas las estrategias corren en mainnet, en beta.',
  'The strategy catalogue runs live on mainnet, ready to start. See exactly what each one does with your tokens.':
    'El catálogo de estrategias corre en vivo en mainnet, listo para empezar. Mira exactamente qué hace cada una con tus tokens.',
  // 'Show all' ya existe en el dict (otra zona) — no duplicar la clave.
  'Two questions narrow the routes to the ones that can work with what you hold. You can always browse the full list.':
    'Dos preguntas reducen las rutas a las que funcionan con lo que tienes. Siempre puedes ver la lista completa.',
  'Show me every route': 'Enséñame todas las rutas',
  'The regulated e-money token, in an EVM wallet — lend-only': 'El token de dinero electrónico regulado, en una wallet EVM — solo prestar',
  // — el modal del par eth-morpho (form · review · done · errores) —
  'RLUSD to borrow': 'RLUSD a pedir',
  'You will see the resulting health factor before signing': 'Verás el factor de salud resultante antes de firmar',
  'This entry signs with your EVM wallet — select it to continue.': 'Esta entrada se firma con tu wallet EVM — selecciónala para continuar.',
  'Enter how much RLUSD to borrow — greater than 0.': 'Indica cuánto RLUSD pedir — mayor que 0.',
  'too many decimals for this asset': 'demasiados decimales para este activo',
  'enter a valid amount greater than 0': 'introduce un importe válido mayor que 0',
  'FXRP you supply': 'FXRP que aportas',
  'RLUSD you borrow': 'RLUSD que pides',
  'Health factor after': 'Factor de salud después',
  // 'now' y 'liquidation at 1.00' ya existen en el dict — no duplicar claves.
  'Liquidation threshold': 'Umbral de liquidación',
  'Market utilization': 'Utilización del mercado',
  'Borrow rate': 'Tipo del préstamo',
  'unavailable right now — source down': 'no disponible ahora — fuente caída',
  'Market can lend': 'El mercado puede prestar',
  'RLUSD you lend': 'RLUSD que prestas',
  'Vault holds': 'La bóveda contiene',
  Approvals: 'Aprobaciones',
  'finite — the exact amount, never unlimited': 'finitas — el importe exacto, jamás ilimitadas',
  'Ethereum direct · your wallet': 'Ethereum directo · tu wallet',
  'Signed — confirming on Ethereum…': 'Firmado. Confirmando en Ethereum…',
  'Signed from your wallet on Ethereum. The position lands directly in that wallet and appears in Positions once the transaction confirms.':
    'Firmado desde tu wallet en Ethereum. La posición aterriza directamente en esa wallet y aparece en Posiciones cuando la transacción confirma.',
  'This strategy is not open yet — the module is switched off.': 'Esta estrategia aún no está abierta — el módulo está apagado.',
  'We cannot reach Ethereum right now. Nothing moved — try again in a minute.': 'No podemos llegar a Ethereum ahora mismo. No se ha movido nada — inténtalo en un minuto.',
  'The market on-chain no longer matches what we verified — we refuse to build this transaction. Nothing moved.':
    'El mercado on-chain ya no coincide con lo que verificamos — nos negamos a construir esta transacción. No se ha movido nada.',
  'The market cannot lend that much right now — lower the borrow amount.': 'El mercado no puede prestar tanto ahora mismo — baja el importe del préstamo.',
  'You cannot withdraw more than your lent balance allows right now.': 'No puedes retirar más de lo que tu saldo prestado permite ahora mismo.',
  'That is more than the live debt — use the full-repay option to close it.': 'Eso es más que la deuda viva — usa la opción de repago total para cerrarla.',
  'We could not prepare the operation right now. Nothing moved — try again in a minute.': 'No hemos podido preparar la operación ahora mismo. No se ha movido nada — inténtalo en un minuto.',
  // — plantilla PROTECT_EM (W5/B7) + describeRule del emRepay —
  'Protect (Ethereum)': 'Proteger (Ethereum)',
  'Defends your FXRP/RLUSD position on Ethereum: if your cushion (health factor) drops below your threshold, Astryum nudges you and prepares the RLUSD repayment fresh when you open it — you sign on Ethereum. Keep RLUSD reachable there: the Sentora lend-only position redeems on the same chain.':
    'Defiende tu posición FXRP/RLUSD en Ethereum: si tu colchón (factor de salud) cae por debajo de tu umbral, Astryum te avisa y prepara el repago de RLUSD en fresco cuando lo abres — firmas tú en Ethereum. Ten RLUSD alcanzable allí: la posición lend-only de Sentora redime en la misma chain.',
  'Close the whole debt when it fires': 'Cierra toda la deuda cuando salte',
  'On: the door prepares a full repay against the LIVE debt (zero dust). Off: you choose the amount at the door, with the live numbers in front of you.':
    'Activado: la puerta prepara un repago total contra la deuda VIVA (cero polvo). Desactivado: eliges el importe en la puerta, con los números vivos delante.',
  'we prepare the RLUSD repayment fresh for you to sign on Ethereum': 'preparamos el repago de RLUSD en fresco para que lo firmes en Ethereum',
  // — la puerta de repago em (EmRepayModal) —
  'Repay RLUSD (Ethereum)': 'Repagar RLUSD (Ethereum)',
  'Prepared fresh with the live debt — you sign in your own wallet.': 'Preparado en fresco con la deuda viva — firmas en tu propia wallet.',
  'Repay an amount': 'Repagar un importe',
  'Close the whole debt': 'Cerrar toda la deuda',
  'RLUSD to repay': 'RLUSD a repagar',
  'The whole LIVE debt is repaid with zero dust — the exact figure is computed when you press continue, and shown before you sign.':
    'Se repaga toda la deuda VIVA sin polvo — la cifra exacta se calcula al continuar y se enseña antes de firmar.',
  'Reading the live position…': 'Leyendo la posición viva…',
  'Live debt': 'Deuda viva',
  'You repay': 'Repagas',
  'the whole live debt (zero dust)': 'toda la deuda viva (cero polvo)',
  'no debt — nothing can liquidate': 'sin deuda — nada puede liquidar',
  'This position has no live debt — nothing to repay.': 'Esta posición no tiene deuda viva — nada que repagar.',
  'The dry-run says this would fail': 'La simulación dice que esto fallaría',
  // — la puerta del puente (EmBridgeModal, B6-UI) —
  'Bridge FXRP to Ethereum': 'Puentea FXRP a Ethereum',
  'To your own address on Ethereum — same account, other chain. You sign on Flare.': 'A tu propia dirección en Ethereum — misma cuenta, otra chain. Firmas en Flare.',
  'FXRP to bridge': 'FXRP a puentear',
  'The LayerZero delivery fee is paid in FLR and shown before you sign. If your FXRP sits in the Personal Account, move it to your wallet first (PA → wallet transfer).':
    'La fee de entrega de LayerZero se paga en FLR y se enseña antes de firmar. Si tu FXRP vive en la Personal Account, muévelo antes a tu wallet (transferencia PA → wallet).',
  // — el flujo que conduce la entrada (BorrowFlowRunner) —
  'Native · a Flare destination mints it into FXRP': 'Nativo · un destino Flare lo mintea como FXRP',
  'You still sign in Xaman. FXRP arrives as FXRP — to an XRPL destination, into its own Astryum account. Native XRP on the ledger is the Unmint door, next to Movements.':
    'Sigues firmando en Xaman. El FXRP llega como FXRP — a un destino XRPL, a su propia cuenta Astryum. El XRP nativo en el ledger es la puerta Unmint, junto a Movimientos.',
  'Arrives as FXRP in the Astryum account of that XRPL address — same owner, Flare side. If you wanted native XRP on the ledger, that is the Unmint door.':
    'Llega como FXRP a la cuenta Astryum de esa dirección XRPL — misma dueña, lado Flare. Si querías XRP nativo en el ledger, eso es la puerta Unmint.',
  'External address: its owner will only see this FXRP from Astryum or a FAssets-aware wallet.':
    'Dirección externa: su dueño solo verá este FXRP desde Astryum o una wallet que entienda FAssets.',
  'Could not resolve the Astryum account of that XRPL address — try again.':
    'No pude resolver la cuenta Astryum de esa dirección XRPL — reinténtalo.',
  'That FXRP already lives in that account — nothing to move.':
    'Ese FXRP ya vive en esa cuenta — no hay nada que mover.',
  'Discard forever? Its signed bytes can never execute; the record stays in the audit archive.':
    '¿Descartar para siempre? Sus bytes firmados jamás podrán ejecutar; el registro queda en el archivo de auditoría.',
  'The FXRP leaves your Astryum account to the Flare destination — one atomic order you sign in Xaman.':
    'El FXRP sale de tu cuenta Astryum al destino Flare — una orden atómica que firmas en Xaman.',
  // ── FLR nativo de la Smart Account: enviar y recibir ──
  'That FLR already lives in that account — nothing to move.':
    'Ese FLR ya vive en esa cuenta — no hay nada que mover.',
  'Native on Flare, in your account': 'Nativo en Flare, en tu cuenta',
  'The FLR leaves your Astryum account to the Flare destination — one atomic order you sign in Xaman. The FLR is your account’s own balance; Astryum adds none of its own.':
    'El FLR sale de tu cuenta Astryum al destino Flare — una orden atómica que firmas en Xaman. El FLR es el saldo de tu propia cuenta; Astryum no pone nada del suyo.',
  'You still sign in Xaman. The FLR leaves your account’s Flare side and only travels to a Flare address (0x…) — it cannot cross to the XRP Ledger.':
    'Sigues firmando en Xaman. El FLR sale del lado Flare de tu cuenta y solo viaja a una dirección de Flare (0x…) — no puede cruzar al XRP Ledger.',
  'FLR lives on Flare, so it lands in this wallet’s Smart Account — operated from your own XRPL account. Same capital, shown inside this wallet.':
    'El FLR vive en Flare, así que aterriza en la Smart Account de esta wallet — operada desde tu propia cuenta XRPL. El mismo capital, enseñado dentro de esta wallet.',
  'Cross-network: the FXRP in your Astryum account is redeemed and a FAssets agent pays native XRP to the XRPL destination. You sign in Xaman.':
    'Entre redes: el FXRP de tu cuenta Astryum se redime y un agente de FAssets paga XRP nativo al destino XRPL. Firmas en Xaman.',
  'You still sign in Xaman: a Flare destination receives the FXRP as-is; an XRPL destination gets it redeemed to native XRP.':
    'Sigues firmando en Xaman: un destino Flare recibe el FXRP tal cual; un destino XRPL lo recibe redimido a XRP nativo.',
  'Destination EVM wallet — receives the FXRP, signs on Ethereum, gets the RLUSD':
    'Wallet EVM de destino — recibe el FXRP, firma en Ethereum, cobra el RLUSD',
  'Pay XRP in Xaman — it arrives as FXRP in your EVM wallet on Flare':
    'Paga XRP en Xaman — llega como FXRP a tu wallet EVM en Flare',
  'After mint fees, the FXRP that travels is': 'Tras las comisiones del mint, el FXRP que viaja es',
  'Moving free FXRP out of the Personal Account does not have its own door yet. Meanwhile: pay with XRP above — it mints straight into your EVM wallet and the flow runs end to end.':
    'Sacar FXRP libre de la Personal Account aún no tiene puerta propia. Mientras tanto: paga con XRP arriba — se mintea directo en tu wallet EVM y el flujo corre de punta a punta.',
  'The flow mints your XRP into FXRP on your OWN EVM wallet and continues from there — link a MetaMask to receive it.':
    'El flujo mintea tu XRP como FXRP en tu PROPIA wallet EVM y sigue desde ahí — enlaza una MetaMask para recibirlo.',
  'projecting the position…': 'proyectando la posición…',
  'Arm the repay protection when this entry settles': 'Arma la protección de repago cuando esta entrada asiente',
  'Repay when the health factor drops below': 'Repagar cuando el health factor baje de',
  'When it fires, Astryum prepares the exact RLUSD repay and asks YOU to sign it on Ethereum — it never signs or executes on its own.':
    'Cuando salta, Astryum prepara el repago exacto de RLUSD y te pide a TI la firma en Ethereum — jamás firma ni ejecuta por su cuenta.',
  'Enter the amounts to see the steps of this flow': 'Pon las cantidades para ver los pasos de este flujo',
  'Repay protection armed.': 'Protección de repago armada.',
  'If the health factor drops below': 'Si el health factor baja de',
  'Astryum prepares the exact RLUSD repay and asks YOU to sign it on Ethereum. Manage it from Positions.':
    'Astryum prepara el repago exacto de RLUSD y te pide a TI la firma en Ethereum. Gestiónala desde Posiciones.',
  'The repay protection arms itself when this entry settles — you chose':
    'La protección de repago se arma sola cuando esta entrada asiente — elegiste',
  'Move the FXRP out of your Personal Account': 'Saca el FXRP de tu Personal Account',
  'Bridge the FXRP to Ethereum': 'Puentea el FXRP a Ethereum',
  'Supply the collateral and borrow': 'Aporta el colateral y pide prestado',
  'signed in Xaman': 'se firma en Xaman',
  'signed on Ethereum': 'se firma en Ethereum',
  'signed on Flare': 'se firma en Flare',
  'transactions in one signature': 'transacciones en una firma',
  'waiting for settlement on Flare…': 'esperando el asentamiento en Flare…',
  'waiting for the bridge to deliver…': 'esperando la entrega del puente…',
  'It was sent, but the receipt could not be read. Do NOT sign again — check the explorer before continuing.':
    'Se envió, pero no se pudo leer el recibo. NO vuelvas a firmar — comprueba el explorador antes de continuar.',
  'Try this step again': 'Reintentar este paso',
  'Start — each signature is requested when its step is ready':
    'Empezar — cada firma se te pide cuando su paso está listo',
  'The remaining signatures will be requested on their own — you can leave this open.':
    'Las firmas que quedan se piden solas — puedes dejar esto abierto.',
  'Position open. Your RLUSD is in your wallet.': 'Posición abierta. Tu RLUSD está en tu wallet.',
  // el RLUSD prestado va a Sentora en la misma firma —
  'Position open. Your borrowed RLUSD is lent in the Sentora vault.':
    'Posición abierta. Tu RLUSD prestado está trabajando en la bóveda de Sentora.',
  'Supply the collateral, borrow, and lend the RLUSD in the Sentora vault':
    'Aporta el colateral, pide prestado y presta el RLUSD en la bóveda de Sentora',
  'Lend the borrowed RLUSD in the Sentora vault — same signature':
    'Prestar el RLUSD pedido en la bóveda de Sentora — misma firma',
  'The RLUSD does not sit in your wallet: it is lent into the Sentora RLUSD vault (Morpho, Ethereum) in this same signature. Sentora decides the allocation — aggregate exposure. When you repay, the repay door redeems what it needs from the vault first.':
    'El RLUSD no se queda en tu wallet: se presta en la bóveda RLUSD de Sentora (Morpho, Ethereum) en esta misma firma. Sentora decide la asignación — exposición agregada. Cuando repagues, la puerta de repago retira primero de la bóveda lo que haga falta.',
  'Off: the borrowed RLUSD stays in your wallet.': 'Apagado: el RLUSD pedido se queda en tu wallet.',
  'RLUSD lent in Sentora': 'RLUSD prestado en Sentora',
  // el repago saca la munición de Sentora —
  'Taken from your Sentora vault': 'Sacado de tu bóveda de Sentora',
  'your wallet holds': 'tu wallet tiene',
  'The shortfall is redeemed from your Sentora lend position as the first leg of this signature — the rest of your lent RLUSD stays lent.':
    'Lo que falta se retira de tu posición prestada en Sentora como primera pata de esta misma firma — el resto de tu RLUSD prestado sigue prestado.',
  "Your wallet and your Sentora lend position together don't hold enough RLUSD on Ethereum for this repay.":
    'Tu wallet y tu posición prestada en Sentora, juntas, no tienen RLUSD suficiente en Ethereum para este repago.',
  'See it in Positions →': 'Verla en Posiciones →',
  // ── Cerrar la posición entera: el hueco del interés lo paga
  //    el propio colateral sobrante, dentro del mismo lote.
  'Close it all': 'Cerrarlo todo',
  'Close the whole position': 'Cerrar la posición entera',
  'One signature: recover what you lent, repay everything, take your collateral back.':
    'Una firma: recuperas lo prestado, repagas todo y te llevas tu colateral.',
  'Reading your live position…': 'Leyendo tu posición en vivo…',
  'You must return': 'Tienes que devolver',
  'From your Sentora position': 'De tu posición en Sentora',
  'From your wallet': 'De tu wallet',
  'Missing — this is the interest': 'Falta — esto es el interés',
  'Collateral sold to cover it': 'Colateral que se vende para cubrirlo',
  'Spending cap for that swap': 'Tope de gasto de ese swap',
  'Collateral back to you': 'Colateral que vuelve a ti',
  'Closing costs more than you borrowed. Choose how to cover the difference:':
    'Cerrar cuesta más de lo que pediste. Elige cómo cubrir la diferencia:',
  'Sell the minimum collateral, in this same transaction':
    'Vender el mínimo colateral, en esta misma transacción',
  'It buys exactly what is missing. Anything unspent stays yours.':
    'Compra exactamente lo que falta. Lo que no se gaste se queda contigo.',
  'I will bring the RLUSD myself': 'Pongo yo el RLUSD',
  'Send it to your wallet on Ethereum and come back.': 'Mándalo a tu wallet en Ethereum y vuelve.',
  'Choose how to cover the difference': 'Elige cómo cubrir la diferencia',
  'Close the position — one signature': 'Cerrar la posición — una firma',
  'Position closed. Your FXRP is back in your wallet.':
    'Posición cerrada. Tu FXRP está de vuelta en tu wallet.',
  'There is no position to close.': 'No hay ninguna posición que cerrar.',

  'This first step is signed in Xaman and does not have its own door yet — move the FXRP from your Personal Account to your EVM wallet, then come back.':
    'Este primer paso se firma en Xaman y todavía no tiene puerta propia — mueve el FXRP de tu Personal Account a tu wallet EVM y vuelve.',
  // — saldo y cruce de cadenas de las entradas de Ethereum —
  'reading balance…': 'leyendo saldo…',
  'On Ethereum': 'En Ethereum',
  'On Flare': 'En Flare',
  'balance unreadable': 'no pude leer el saldo',
  'That amount is more than this wallet holds on Ethereum, but you have':
    'Esa cantidad supera lo que esta wallet tiene en Ethereum, pero tienes',
  'on Flare — it has to be bridged first.': 'en Flare — hay que puentearlo antes.',
  'Even counting your FXRP on Flare you hold': 'Incluso contando tu FXRP en Flare tienes',
  '— less than this entry needs.': '— menos de lo que esta entrada necesita.',
  // — el camino que le falta a la wallet elegida (entradas de Ethereum) —
  'This entry signs on Ethereum, and that FXRP is not there yet.':
    'Esta entrada firma en Ethereum, y ese FXRP todavía no está allí.',
  'Sign in Xaman to move the FXRP out of your Personal Account':
    'Firma en Xaman para sacar el FXRP de tu Personal Account',
  'Sign on Flare to bridge it to Ethereum': 'Firma en Flare para puentearlo a Ethereum',
  'Sign on Ethereum to supply it and borrow': 'Firma en Ethereum para aportarlo y pedir prestado',
  'then a few minutes of settlement': 'luego unos minutos de asentamiento',
  'then minutes of bridge delivery': 'luego unos minutos de entrega del puente',
  'Once the FXRP is in your EVM wallet on Ethereum, select it above and continue here.':
    'Cuando el FXRP esté en tu wallet EVM en Ethereum, selecciónala arriba y continúa aquí.',
  'Open the bridge →': 'Abrir el puente →',
  'Bring the FXRP to Ethereum first': 'Trae antes el FXRP a Ethereum',
  'Not enough FXRP for this amount': 'No hay FXRP suficiente para esa cantidad',
  // — el medidor de riesgo del préstamo (BorrowRiskMeter) —
  Comfortable: 'Cómoda',
  Tight: 'Ajustada',
  Exposed: 'Expuesta',
  'Past the limit': 'Pasado el límite',
  'this borrow is past what the market allows on that collateral.':
    'este préstamo pasa de lo que el mercado permite sobre ese colateral.',
  'it survives a': 'aguanta una caída del',
  'fall in the collateral before liquidation.': 'en el colateral antes de la liquidación.',
  'of the collateral borrowed': 'del colateral pedido',
  'liquidation at': 'liquidación en el',
  'Automatic repay armed at': 'Repago automático armado en el',
  'it fires if the collateral falls': 'salta si el colateral cae un',
  'up to': 'hasta el',
  'survives a fall of at least': 'aguanta una caída de al menos el',
  'This wallet supplies its FXRP on Ethereum — the entry signs there, not on Flare.':
    'Esta wallet aporta su FXRP en Ethereum — la entrada firma allí, no en Flare.',
  'This bridge signs on an EVM chain: select (or connect) the EVM wallet that holds the FXRP before bridging.':
    'Este puente firma en una chain EVM: selecciona (o conecta) la wallet EVM que tiene el FXRP antes de puentear.',
  'Quoting the live delivery fee…': 'Cotizando la fee de entrega en vivo…',
  'FXRP you send': 'FXRP que envías',
  'Arrives at': 'Llega a',
  'LayerZero delivery fee (max)': 'Fee de entrega LayerZero (máx)',
  quoted: 'cotizada',
  'Sent from Flare — the FXRP appears in your Ethereum wallet in minutes (LayerZero delivery).': 'Enviado desde Flare — el FXRP aparece en tu wallet de Ethereum en minutos (entrega LayerZero).',
  'Signed — confirming on Flare…': 'Firmado. Confirmando en Flare…',
  'Your FXRP is on Flare? Bridge it to Ethereum first →': '¿Tu FXRP está en Flare? Puéntealo antes a Ethereum →',
  'Arm the repay protection from this position’s card in Positions — the Protect (Ethereum) template watches your health factor and prepares the RLUSD repayment fresh for you to sign.':
    'Arma la protección de repago desde la card de esta posición en Posiciones — la plantilla Proteger (Ethereum) vigila tu factor de salud y prepara el repago de RLUSD en fresco para que lo firmes.',

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
  Notifications: 'Notificaciones',
  'Hackathon exclusives': 'Exclusivas del hackathon',
  'Follow the Xaman avatar': 'Seguir el avatar de Xaman',
  'The card follows the colours of your Xaman avatar. Pick a swatch to choose your own colour.':
    'La tarjeta sigue los colores de tu avatar de Xaman. Elige una muestra para poner el color que decidas.',
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
  // ── RuleEditModal humanizado (F1/F2/F9) ──
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
  // ── R5: todos los cargos antes de firmar ──
  'your wallet shows the exact figure before signing':
    'tu wallet muestra la cifra exacta antes de firmar',
  'The withdrawal period ended — this releases the FXRP straight to your wallet. The only cost is the network fee (cents; your wallet shows the exact figure before signing). The exit fee was already taken when you requested the withdrawal — nothing else is charged.':
    'El plazo de salida ha terminado — al confirmar, el FXRP pasa directo a tu wallet. El único coste es la comisión de red (céntimos; tu wallet muestra la cifra exacta antes de firmar). La comisión de salida ya se cobró al solicitar la retirada — no se cobra nada más.',
  'Astryum fee': 'Comisión de Astryum',
  'we charge nothing': 'no cobramos nada',
  'Real money · product in testing': 'Dinero real · producto en pruebas',
  // ── Withdraw con destino XRPL en el selector + dispatch explicado ──
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
  // ── Reserva de gobierno XRPL (trampa del mint-total) ──
  'This would leave your XRPL wallet almost empty. Your Astryum account is steered FROM it — every order needs ~1 XRP of carrier payment. Keep at least ~2 XRP or you will not be able to withdraw or convert until you refund it from outside.':
    'Esto dejaría tu wallet XRPL casi vacía. Tu cuenta Astryum se gobierna DESDE ella — cada orden necesita ~1 XRP de transporte. Deja al menos ~2 XRP o no podrás retirar ni convertir hasta que la fondees desde fuera.',
  'MAX keeps ~2 XRP back — your Astryum account is steered from this wallet and every order needs a small XRP payment.':
    'MAX se guarda ~2 XRP — tu cuenta Astryum se gobierna desde esta wallet y cada orden necesita un pequeño pago de XRP.',
  'The account that signs is your XRPL wallet':
    'La cuenta que firma es tu wallet XRPL',
  'send it ~2 XRP (from an exchange or another wallet) and come back. Your money on Flare is untouched.':
    'envíale ~2 XRP (desde un exchange u otra wallet) y vuelve. Tu dinero en Flare sigue intacto.',
  // ── CmfReviewModal humanizado (Fase 3) ──
  'Drafted by the assistant. Watching is free and touches nothing — when it fires, we will ask YOU to sign.':
    'Redactado por el asistente. Vigilar es gratis y no toca nada — cuando salte, te pediremos que firmes TÚ.',
  'Turn on the watch (nothing is signed now)': 'Activar la vigilancia (ahora no se firma nada)',
  // ── R9 APY como dato (Fase 3) ──
  'current protocol figure': 'dato actual del protocolo',
  'If the rate held (it is not guaranteed — it changes constantly), this is what simple interest would add, before fees and price moves. It is not an offer, a promise, or an Astryum yield.':
    'Si el tipo se mantuviera (no está garantizado — cambia constantemente), esto es lo que sumaría el interés simple, antes de comisiones y movimientos de precio. No es una oferta, ni una promesa, ni un rendimiento de Astryum.',
  'Ready-made strategies live on mainnet. Open one to see exactly what it does with your tokens before you sign anything.':
    'Estrategias listas funcionando en mainnet. Abre una para ver exactamente qué hace con tus tokens antes de firmar nada.',
  // ── templateCatalog por t() (Fase 3) ──
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
  // ── describeRule compartido (Fase 3) ──
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
  // ── PreflightNotice sin jerga (Fase 2b) ──
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
  // ── settlementReasonText (Fase 2b) ──
  'The batch failed on the network — your money did not move.':
    'El lote falló en la red — tu dinero no se ha movido.',
  'Your wallet does not let us confirm automatically — open it and check with the receipt below.':
    'Tu wallet no nos deja confirmarlo automáticamente — ábrela y compruébalo con el recibo de abajo.',
  'The network rejected the transaction. Your money did not move; only the network fee was spent.':
    'La red rechazó la transacción. Tu dinero no se ha movido; solo se gastó la comisión de red.',
  'Batch step': 'El paso',
  'of the batch was rejected by the network — nothing was applied.':
    'del lote fue rechazado por la red — no se aplicó nada.',
  // ── Léxico R3 de intenciones y CTAs (Fase 2b) ──
  'Review before signing': 'Ver el resumen antes de firmar',
  // ── El porqué del botón gris: el tooltip del bloqueo ──
  'Enter an amount above zero to continue': 'Introduce una cantidad mayor que cero para continuar',
  'Your balance does not cover this amount — lower it or top up the wallet':
    'Tu saldo no cubre esta cantidad — bájala o recarga la wallet',
  'The dry-run proved this transaction would revert on-chain — signing would only burn gas':
    'El ensayo demostró que esta transacción revertiría en la cadena — firmar solo quemaría gas',
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
  // ── Éxitos veraces + settling (Fase 2) ──
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
  // ── Intents/firma (Fase 2) ──
  'Being prepared': 'Preparándose',
  'Sending to the network': 'Enviándose a la red',
  'On its way to the network': 'En camino a la red',
  'This operation cannot be signed yet.': 'Esta operación todavía no se puede firmar.',
  // ── Settlement en-vuelo (Fase 2): titulares que faltaban en ES ──
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
  // ── DispatchXrpField (F12) ──
  'The order travels on a small XRP payment': 'La orden viaja en un pequeño pago de XRP',
  'it comes back to you as FXRP minus the protocol fees. You will see the exact figures before signing. Nothing goes to Astryum.':
    'te vuelve como FXRP menos las comisiones del protocolo. Verás las cifras exactas antes de firmar. Nada va a Astryum.',
  'Adjust the carrier payment (advanced)': 'Ajustar el pago de transporte (avanzado)',
  // ── Swap-fill: elección obligatoria ──
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
  // ── XamanQRModal (F6): estados terminales + countdown + i18n ──
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
  'Time left before this code expires': 'Tiempo restante antes de que caduque este código',
  'Astryum never signs and never holds custody. The key is yours and the signature happens in Xaman.':
    'Astryum no firma ni custodia. La clave es tuya y la firma ocurre en Xaman.',
  // ── Fijar beneficiarios del rendimiento (F5) ──
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
  // E6: endurecimiento del formulario — suma exacta, endowment, duplicados.
  'The shares must add up to exactly 100%': 'Las partes deben sumar exactamente el 100 %',
  'The same address appears twice in the payees.': 'La misma dirección aparece dos veces entre los beneficiarios.',
  'No payees — every harvest capitalizes into the principal (endowment)':
    'Sin beneficiarios — cada cosecha capitaliza en el principal (dotación)',
  'This order clears the payee list. Yield already owed to someone stays claimable by them; everything harvested from now on grows the principal.':
    'Esta orden vacía la lista de beneficiarios. El rendimiento ya debido a alguien sigue siendo reclamable por esa persona; todo lo cosechado desde ahora engorda el principal.',
  'The shares now add up to': 'Las partes suman ahora',
  'exactly 100% — ready to compose': 'exactamente el 100 % — lista para componer',
  'the vault only accepts exactly 100%': 'la vasija solo acepta exactamente el 100 %',
  'The yield is shared out in these proportions, and the whole of it must be assigned. To keep capitalizing instead, use the no-payees option above.':
    'El rendimiento se reparte en estas proporciones, y hay que asignarlo entero. Para seguir capitalizando, usa la opción sin beneficiarios de arriba.',
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

  // ── Unmint PA → XRP nativo — todos los caminos de vuelta ──
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

  // ── Movimientos — puerta de Generar (ex-Ahorro, reorg):
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
  // Reorganización pre-gate: conmutador de superficie en cabecera,
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
  // La puerta del lobby: en modo Legacy sin cuenta gobernada,
  // las páginas compartidas enseñan el lobby — nunca el capital Personal.
  'No Legacy constituted yet': 'Aún no hay ningún Legacy constituido',
  'This is the Legacy side of Astryum: it shows a council-governed account, and this profile has none yet. Personal capital stays on the Personal side — nothing is shown here until a council exists.':
    'Este es el lado Legacy de Astryum: muestra una cuenta gobernada por consejo, y este perfil aún no tiene ninguna. El capital Personal se queda en el lado Personal — aquí no se enseña nada hasta que exista un consejo.',
  'Constitute a Legacy': 'Constituir un Legacy',
  'Back to Personal': 'Volver a Personal',
  'Loading': 'Cargando',
  // Briefs por estación (del propio onboarding del fundador):
  // cada slide abre diciendo QUÉ SE HACE físicamente, en pasos numerados.
  'Before you start': 'Antes de empezar',
  'What you do here': 'Qué se hace aquí',
  'Create a NEW account in the Xaman wallet on your phone — new, with no history: the ceremony ends with this account’s master key disabled, so never use your everyday account.':
    'Crea una cuenta NUEVA en la wallet Xaman de tu móvil — nueva, sin historial: la ceremonia termina deshabilitando la master key de esta cuenta, así que nunca uses tu cuenta de diario.',
  'Fund it with a little XRP — about 15 XRP covers the ledger reserves and the ceremony fees. The exact figure is checked here once the account is open.':
    'Fondéala con un poco de XRP — unos 15 XRP cubren las reservas del ledger y las comisiones de la ceremonia. La cifra exacta se comprueba aquí en cuanto la cuenta esté abierta.',
  'Paste its r… address below: that account becomes the Legacy — the main account the council will govern. Astryum reads it from the ledger and never touches its keys.':
    'Pega su dirección r… aquí abajo: esa cuenta se convierte en el Legacy — la cuenta principal que gobernará el consejo. Astryum la lee del ledger y jamás toca sus llaves.',
  // Council, acortado ("demasiado texto junto"): el brief nombra
  // los tres movimientos; CouncilInXaman los explica debajo.
  'Gather 3 to 7 people (5 with a quorum of 3 is the standard), each with their OWN Xaman wallet.':
    'Reúne de 3 a 7 personas (5 con quórum de 3 es el estándar), cada una con SU wallet Xaman.',
  'Write the plan first: who signs, with what weight, and the quorum.':
    'Escribe primero el plan: quién firma, con qué peso y el quórum.',
  'Create it in the Xaman Multisign xApp — guided below, screen by screen — and come back to compare the ledger against your plan.':
    'Créalo en el xApp Multisign de Xaman — guiado abajo, pantalla a pantalla — y vuelve para comparar el ledger con tu plan.',
  // Inmersión del wizard: cabecera de estación, orientación de
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
  // Placeholders de las plantillas de constitución: eran
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
  // Council reestructurado: tarjetas separadas, tutorial
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
  // El copiloto ES la Guía en modo Legacy.
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
  // ── Constitute slide deck + My Legacies cards (redesign) ──
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
  // ── Cuenta personal reforzada: la puerta «Reinforce it» de
  //    cada card XRPL y la plantilla que abre. Las dos claves de arriba
  //    ('Personal patrimony (one person)' y su descripción) quedan INERTES:
  //    la plantilla se renombró, pero no se borran.
  'Reinforce it': 'Refuérzala',
  'The account you are reinforcing — it stays yours throughout.':
    'La cuenta que estás reforzando — sigue siendo tuya en todo momento.',
  'Your own keys, and how many must agree — created in Xaman.':
    'Tus propias llaves, y cuántas tienen que estar de acuerdo — se crean en Xaman.',
  '~15 min · your devices': '~15 min · tus dispositivos',
  'Each of your keys proves it can sign — before the door closes.':
    'Cada una de tus llaves demuestra que sabe firmar — antes de cerrar la puerta.',
  '~5 min per device': '~5 min por dispositivo',
  'The master key retires; only your quorum remains.':
    'La llave maestra se retira; solo queda tu quórum.',
  'Nothing left to do — the account is reinforced.':
    'No queda nada por hacer — la cuenta está reforzada.',
  'reinforced': 'reforzada',
  'This account is reinforced: your quorum governs it, every key has proved it can sign, and the master key is retired. Nothing was locked away and nothing moved — you go on using it exactly as before, except that no single key can move anything alone.':
    'Esta cuenta está reforzada: la gobierna tu quórum, cada llave ha demostrado que sabe firmar, y la llave maestra está retirada. No se ha encerrado nada ni se ha movido nada — sigues usándola exactamente igual que antes, salvo que ninguna llave sola puede mover nada.',
  'What to keep in mind': 'Qué tener en cuenta',
  'Every payment now needs your quorum — signed in Xaman, from the devices you registered.':
    'Cada pago necesita ahora tu quórum — firmado en Xaman, desde los dispositivos que registraste.',
  'If you lose a device, replace it before anything else: at exact quorum, one more loss locks the account for ever.':
    'Si pierdes un dispositivo, repónlo antes que nada: con el quórum justo, una pérdida más deja la cuenta bloqueada para siempre.',
  'Back to my wallets': 'Volver a mis wallets',
  'Give this account a quorum of your own keys — it stays yours, and you keep signing in Xaman':
    'Dale a esta cuenta un quórum de tus propias llaves — sigue siendo tuya, y sigues firmando en Xaman',
  'One key can move everything here': 'Una sola llave puede moverlo todo aquí',
  'The quorum signs this': 'Esto lo firma el quórum',
  'This account signs by quorum': 'Esta cuenta firma por quórum',
  'Its keys each get their own request below — sign them from their own devices. Nothing goes out until the quorum is met.':
    'Cada una de sus llaves recibe abajo su propia petición — fírmalas desde sus dispositivos. No sale nada hasta que se reúne el quórum.',
  'This account signs by quorum — gather the signatures below.':
    'Esta cuenta firma por quórum — reúne las firmas aquí abajo.',
  'This account is reinforced: it signs by quorum. Every one of your keys gets its own request below — sign them from their own devices.':
    'Esta cuenta está reforzada: firma por quórum. Cada una de tus llaves recibe abajo su propia petición — fírmalas desde sus dispositivos.',
  'The ledger rejected it: it is on-chain and it charged the fee, but it did NOT go through.':
    'El ledger la rechazó: está en la cadena y cobró la comisión, pero NO se ejecutó.',
  'The network never accepted it: it is not on the ledger and it cost nothing. You can compose it again.':
    'La red no llegó a aceptarla: no está en el ledger y no ha costado nada. Puedes volver a componerla.',
  'Either way Astryum never signs: it composes the unsigned transaction and the quorum signs it — together now, or each from their own device.':
    'De las dos formas Astryum no firma nunca: compone la transacción sin firmar y la firma el quórum — juntos ahora, o cada uno desde su dispositivo.',
  'Reinforced — no single key moves anything': 'Reforzada — ninguna llave sola mueve nada',
  'Its keys, its quorum, its health and its rules': 'Sus llaves, su quórum, su salud y sus reglas',
  'Governance': 'Gobernanza',
  'Reinforce this account': 'Refuerza esta cuenta',
  'Your own XRPL account, governed by a quorum of your own keys: no single key — lost, stolen or coerced — moves anything on its own. It stays a personal wallet, nothing is caged, and every signature is yours in Xaman.':
    'Tu propia cuenta XRPL, gobernada por un quórum de tus propias llaves: ninguna llave sola — perdida, robada o coaccionada — mueve nada por su cuenta. Sigue siendo una wallet personal, no se enjaula nada, y cada firma es tuya en Xaman.',
  'Reinforced personal account': 'Cuenta personal reforzada',
  'Your own account, held by a quorum of YOUR OWN keys: no single key — lost, stolen or coerced — moves anything alone. It stays a personal wallet: no council of other people, and nothing is locked away.':
    'Tu propia cuenta, sostenida por un quórum de TUS PROPIAS llaves: ninguna llave sola — perdida, robada o coaccionada — mueve nada. Sigue siendo una wallet personal: sin consejo de terceros, y sin nada encerrado.',
  'Account name': 'Nombre de la cuenta',
  'My reinforced account': 'Mi cuenta reforzada',
  'Your account (XRPL)': 'Tu cuenta (XRPL)',
  'The account this document governs — yours, held by a quorum of your own keys.':
    'La cuenta que gobierna este documento — la tuya, sostenida por un quórum de tus propias llaves.',
  'Why you are reinforcing this account, in your own words.':
    'Por qué estás reforzando esta cuenta, en tus palabras.',
  'So that no single device — lost, stolen or taken from me under pressure — can move my capital on its own.':
    'Para que ningún dispositivo por sí solo — perdido, robado o sacado bajo presión — pueda mover mi capital.',
  'One per line: "device/key — rADDRESS — where its backup lives". All of them are YOURS — this removes the single point of failure, and brings in no third party.':
    'Una por línea: «dispositivo/llave — rDIRECCIÓN — dónde vive su backup». Todas son TUYAS — esto elimina el punto único de fallo, y no mete a ningún tercero.',
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
  // ── E4: plantillas matrimonial (T4) y socios (T6) ──
  'Couple patrimony (matrimonial)': 'Patrimonio de pareja (matrimonial)',
  'Shared capital of a couple, governed 2-of-3: both partners plus a referee whose only job is breaking a deadlock. The matrimonial property regime — not this document — says who owns what.':
    'El capital común de una pareja, gobernado 2-de-3: los dos cónyuges más un árbitro cuyo único papel es deshacer un bloqueo. Quién es dueño de qué lo dice el régimen económico matrimonial — no este documento.',
  '3 signers · quorum 2 — both partners + referee': '3 firmantes · quórum 2 — la pareja + árbitro',
  'Matrimonial property regime': 'Régimen económico matrimonial',
  'The legal regime that ACTUALLY says who owns this capital (community property, separation…), and where your marriage agreement (capitulaciones) lives, if one exists.':
    'El régimen legal que DE VERDAD dice de quién es este capital (gananciales, separación…), y dónde viven vuestras capitulaciones, si existen.',
  'Why this shared patrimony exists, in your own words.': 'Para qué existe este patrimonio común, con vuestras palabras.',
  'That our shared capital produces without either of us being able to move it alone.':
    'Que nuestro capital común produzca sin que ninguno de los dos pueda moverlo solo.',
  'Separation of property — agreement before notary X, date Y':
    'Separación de bienes — capitulaciones ante notario X, fecha Y',
  'Share of each cycle’s yield that grows the base; the rest is at the couple’s disposal.':
    'Parte del rendimiento de cada ciclo que hace crecer la base; el resto queda a disposición de la pareja.',
  'The couple': 'La pareja',
  'One per line: "Name — rADDRESS — successor: Name, rADDRESS".':
    'Uno por línea: «Nombre — rDIRECCIÓN — sucesor: Nombre, rDIRECCIÓN».',
  'The referee': 'El árbitro',
  'A third signer BOTH trust (notary, sibling, lawyer): "Name — rADDRESS". They sign ONLY to break a tie on something one of you proposed — they own nothing and propose nothing.':
    'Un tercer firmante en quien confiéis LOS DOS (notario, hermano, abogado): «Nombre — rDIRECCIÓN». Firma SOLO para desempatar algo que uno de los dos propuso — no es dueño de nada y no propone nada.',
  'María (notary) — r…': 'María (notaria) — r…',
  'Cure deadline (days)': 'Plazo de curación (días)',
  'Maximum days the quorum has to realign the ledger with the law once a divergence is final.':
    'Días máximos que tiene el quórum para realinear el ledger con el derecho cuando una divergencia sea firme.',
  'Partners’ holding (weighted)': 'Círculo de socios (con pesos)',
  'Partners who DO want transferable ownership over a shared patrimony: signer weights mirror ownership, in basis points that add up to 10,000, across at most 32 seats.':
    'Socios que SÍ quieren propiedad transmisible sobre un patrimonio común: los pesos de firma son el espejo de la propiedad, en puntos básicos que suman 10.000, en hasta 32 asientos.',
  'up to 32 seats · weights = ownership (Σ 10,000 bps)': 'hasta 32 asientos · pesos = propiedad (Σ 10.000 pb)',
  'Object': 'Objeto',
  'What this holding exists to hold and why.': 'Qué existe para sostener este círculo, y por qué.',
  'Hold and produce the partners’ shared capital under written rules.':
    'Sostener y hacer producir el capital común de los socios bajo reglas escritas.',
  'The partners': 'Los socios',
  'One per line: "Name — rADDRESS — ownership (bps) — successor". Basis points MUST add up to 10,000 (100% = 10,000 bps; 25.5% = 2,550). At most 32 seats.':
    'Uno por línea: «Nombre — rDIRECCIÓN — participación (pb) — sucesor». Los puntos básicos DEBEN sumar 10.000 (100 % = 10.000 pb; 25,5 % = 2.550). Máximo 32 asientos.',
  'Quorum (bps)': 'Quórum (pb)',
  'Weight required to move anything, in basis points of ownership. 5,001 = simple majority of ownership; raise it for supermajority decisions.':
    'Peso necesario para mover cualquier cosa, en puntos básicos de propiedad. 5.001 = mayoría simple de la propiedad; súbelo para decisiones de supermayoría.',
  'The rest is distributed to the partners pro-rata to their weights.':
    'El resto se distribuye a los socios en proporción a sus pesos.',
  'Partners’ agreement': 'Pacto de socios',
  'Where the legal-layer agreement (pacto de socios) lives, if one exists — the document that makes these rules bind between partners.':
    'Dónde vive el pacto de socios, si existe — el documento que hace que estas reglas obliguen entre socios.',
  'Private agreement, notarised on…  /  "none yet"': 'Pacto privado, elevado a público el…  /  «aún no hay»',
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
  // Organismo Legacy del Summary (coherencia de producto).
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
  // E2: el tercer estado — cuenta simple con llaves de quórum.
  // ('Quorum' ya existe como clave más abajo — el pill la reutiliza.)
  'This is my reinforced personal account, not a Legacy — keep it with my wallets':
    'Es mi cuenta personal reforzada, no un Legacy — que se quede con mis wallets',
  // La corona de la reforzada: el quórum en la cabecera, como un Legacy pero en oro.
  'Reinforced': 'Reforzada',
  'a quorum of your keys signs': 'firma un quórum de tus llaves',
  // La puerta de VUELTA de la marca: reforzada → Legacy.
  'Marked as YOUR reinforced account': 'Marcada como TU cuenta reforzada',
  'It is a Legacy': 'Es un Legacy',
  'Remove the mark: the ledger-confirmed council takes over and the account moves to the Legacy shelf':
    'Retira la marca: manda el consejo confirmado por el ledger y la cuenta pasa al estante Legacy',
  // El estante Manager de Wallets: las wallets que sirven a los managed vaults.
  'The wallets you run managed vaults with: the XRPL account that governs and, while ceded, the director key on Flare.':
    'Las wallets con las que llevas tus bóvedas gestionadas: la cuenta XRPL que gobierna y, mientras dure la cesión, la llave de director en Flare.',
  'Open the manager desk': 'Abrir la mesa del gestor',
  // Banda de estructuras del Summary (E1): una firma, N estructuras.
  'Structures': 'Estructuras',
  'in progress': 'en curso',
  'programmed': 'programadas',
  // Personal = solo wallets normales; los consejos viven en su Legacy.
  '1 council account (multisig) lives in Astryum Legacy — switch the product toggle to see it inside its Legacy.':
    '1 cuenta de consejo (multisig) vive en Astryum Legacy — cambia el toggle de producto para verla dentro de su Legacy.',
  'council accounts (multisig) live in Astryum Legacy — switch the product toggle to see them inside their Legacy.':
    'cuentas de consejo (multisig) viven en Astryum Legacy — cambia el toggle de producto para verlas dentro de su Legacy.',
  // Toggle de producto: Personal ↔ Legacy, en el sidebar.
  'Product': 'Producto',
  'Personal': 'Personal',
  'Astryum product active': 'Producto Astryum activo',
  'Personal product active': 'Producto Personal activo',
  'Legacy product active': 'Producto Legacy activo',
  'No Legacy yet — constitute it in its tab': 'Aún sin Legacy — constitúyelo en su pestaña',
  'wallet connected': 'wallet conectada',
  'wallets connected': 'wallets conectadas',
  // Switcher de autoridad: la barra de contexto del shell.
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
  // Los dos tempos, nombrados: síncrono aquí, asíncrono en la
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
  // E7 QA móvil: en el teléfono desde el que firma la familia, el deeplink ES
  // la acción (el QR no se puede escanear en la propia pantalla).
  'Open in Xaman to sign': 'Abrir en Xaman para firmar',
  // G1 — el aviso que evita el pago duplicado del consejo.
  'This proposal WAS broadcast — we could not register it here.':
    'Esta propuesta SÍ se difundió — no hemos podido registrarla aquí.',
  'The transaction is already on the XRP Ledger. Do NOT compose it again: register it here, or check it in the explorer first.':
    'La transacción ya está en el XRP Ledger. NO la compongas otra vez: regístrala aquí, o compruébala antes en el explorador.',
  'Register it now': 'Registrarla ahora',
  // G4 — la tarjeta de una regla que falló en su último disparo. Antes decía
  // «active» en verde mientras no vigilaba nada.
  failing: 'fallando',
  'Its last run FAILED — this rule is armed but it produced nothing to sign.':
    'Su último disparo FALLÓ — la regla está armada pero no produjo nada que firmar.',
  'the engine recorded no reason': 'el motor no registró ningún motivo',
  'Consecutive failed runs:': 'Disparos fallidos seguidos:',
  'Could not read this rule’s run history — we cannot tell you whether its last fire worked.':
    'No hemos podido leer el historial de esta regla — no podemos decirte si su último disparo funcionó.',
  'See it in the explorer': 'Verla en el explorador',
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
  //    Xaman. Xaman rechaza un SignerListSet compuesto por
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

  // ── Validación del consejo (F10) ──
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
  // Un asiento por cuenta: la bandeja solo emite TU QR.
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
  // Static login card
  'Founders panel': 'Panel de fundadores',
  'Enter the panel key to open the overview.': 'Introduce la clave del panel para abrir el resumen.',
  'That key was not accepted.': 'Esa clave no ha sido aceptada.',
  'Panel key': 'Clave del panel',
  'Checking…': 'Comprobando…',
  'Open panel': 'Abrir panel',
  'No users yet.': 'Aún no hay usuarios.',

  // AuthorityCrossing reuses the shared 'Personal' key (ProductToggle block).

  // ── MoneyFlows (superficie unificada Personal + Legacy) ──
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
  // ── Pago recurrente personal (M1): la domiciliación de una wallet normal ──
  'prepare payment of': 'prepara pago de',
  // ── H3: la VUELTA del puente (Ethereum → Flare) ──
  'Bring FXRP back to Flare': 'Traer el FXRP de vuelta a Flare',
  'Bring your FXRP back to Flare →': 'Trae tu FXRP de vuelta a Flare →',
  'To your own address on Flare — same account, other chain. You sign on Ethereum.':
    'A tu propia dirección en Flare — misma cuenta, otra cadena. Firmas en Ethereum.',
  'Flare → Ethereum': 'Flare → Ethereum',
  'Ethereum → Flare': 'Ethereum → Flare',
  'The LayerZero delivery fee is paid in ETH on this leg and shown before you sign. It spends the FXRP held by the wallet that signs, on Ethereum.':
    'La comisión de entrega de LayerZero se paga en ETH en este tramo y se enseña antes de firmar. Gasta el FXRP que tiene la wallet que firma, en Ethereum.',
  'none — on Ethereum FXRP is the token itself': 'ninguna — en Ethereum el FXRP es el propio token',
  'Sent from Ethereum — the FXRP appears in your Flare wallet in minutes (LayerZero delivery).':
    'Enviado desde Ethereum — el FXRP aparece en tu wallet de Flare en minutos (entrega de LayerZero).',
  // ('Signed — confirming on Ethereum…' ya existe más arriba — se reutiliza.)
  // ── H8: la disclosure completa en la puerta de repago ──
  'Liquidation limit (LLTV)': 'Límite de liquidación (LLTV)',
  // ('Borrow rate' ya existe como clave más arriba — se reutiliza.)
  'unavailable right now — not invented': 'no disponible ahora mismo — no se inventa',
  'Rate source': 'Fuente del tipo',
  // ── H2: la puerta de SALIDA del carril de Ethereum ──
  'Withdraw RLUSD from the vault': 'Retirar RLUSD de la bóveda',
  'Take FXRP collateral out': 'Sacar el colateral FXRP',
  'Take collateral out': 'Sacar colateral',
  'Already lending? Withdraw your RLUSD →': '¿Ya estás prestando? Retira tu RLUSD →',
  'RLUSD to withdraw': 'RLUSD a retirar',
  'FXRP to take out': 'FXRP a sacar',
  'You take out': 'Sacas',
  'Collateral now': 'Colateral ahora',
  'Where it lands': 'Dónde aterriza',
  'Prepared fresh with the live position — you sign in your own wallet.':
    'Preparado en fresco con la posición viva — firmas en tu propia wallet.',
  "The vault pays out against its own live liquidity: if it cannot cover the amount right now, you are told before signing — never after.":
    'La bóveda paga contra su propia liquidez viva: si ahora mismo no puede cubrir el importe, se te dice antes de firmar — nunca después.',
  'Collateral holds the debt up. If you still owe RLUSD, taking too much out would cross the liquidation line — that is checked before you sign, not after.':
    'El colateral es lo que sostiene la deuda. Si aún debes RLUSD, sacar de más cruzaría la línea de liquidación — eso se comprueba antes de firmar, no después.',
  "That is more than the vault can pay out right now — its live liquidity decides, not your balance.":
    'Eso es más de lo que la bóveda puede pagar ahora mismo — manda su liquidez viva, no tu saldo.',
  'That amount is not valid for this position.': 'Ese importe no es válido para esta posición.',
  // M2: el carril gobernado se nombra «domiciliación» — con día
  // del mes explícito y la diferencia con el banco dicha en voz alta.
  'Council standing order': 'Domiciliación del consejo',
  'Every month, on the day you pick (12:00 UTC)': 'Cada mes, el día que elijas (12:00 UTC)',
  'A standing order the council signs: Astryum watches the date and COMPOSES the exact payment into the inbox above; the quorum reviews and signs it, every time; the rule expires on its own. It is not a bank direct debit — nothing is ever sent without those signatures, and that is the point.':
    'Una domiciliación que firma el consejo: Astryum vigila la fecha y COMPONE el pago exacto en la bandeja de arriba; el quórum lo revisa y lo firma, todas las veces; la regla caduca sola. No es una domiciliación bancaria — nada se envía jamás sin esas firmas, y ese es justamente el punto.',
  'Days run 1–28 so the payment exists in every month (a 29–31 rule would silently skip the short ones).':
    'Los días van del 1 al 28 para que el pago exista en todos los meses (una regla del 29–31 se saltaría en silencio los cortos).',
  // Trigger de precio (M3): caída desde la línea base de la regla.
  'If the price of': 'Si el precio de',
  'falls': 'cae un',
  'from': 'desde',
  'we prepare the payment for you to sign in Xaman': 'te preparamos el pago para que lo firmes en Xaman',
  'On day': 'El día',
  'of each month at 12:00 UTC': 'de cada mes a las 12:00 UTC',
  'Recurring payments': 'Pagos recurrentes',
  'New recurring payment': 'Nuevo pago recurrente',
  'Create a recurring payment': 'Crear un pago recurrente',
  'A standing order the ledger cannot fake: Astryum watches the date and prepares the exact payment; you sign each one in Xaman; the rule expires on its own (90 days at most).':
    'Una orden permanente que el ledger no puede fingir: Astryum vigila la fecha y prepara el pago exacto; tú firmas cada uno en Xaman; la regla caduca sola (90 días como máximo).',
  'Astryum watches the date and prepares the exact payment; you sign it in Xaman, every time; the rule expires on its own. Nothing is ever sent without your signature.':
    'Astryum vigila la fecha y prepara el pago exacto; tú lo firmas en Xaman, todas las veces; la regla caduca sola. Nada se envía jamás sin tu firma.',
  'Name (e.g. Car insurance)': 'Nombre (p. ej. Seguro del coche)',
  'Destination must differ from your own wallet.': 'El destino debe ser distinto de tu propia wallet.',
  'Day of the month': 'Día del mes',
  'Destination tag (optional)': 'Tag de destino (opcional)',
  'The destination tag must be a whole number (many exchanges require one).':
    'El tag de destino debe ser un número entero (muchos exchanges exigen uno).',
  'Days run 1–28 so the payment exists in every month (a 29–31 rule would silently skip the short ones). Fires at 12:00 UTC.':
    'Los días van del 1 al 28 para que el pago exista en todos los meses (una regla del 29–31 se saltaría en silencio los cortos). Dispara a las 12:00 UTC.',
  'The rule holds no authority — only your signature moves funds.':
    'La regla no tiene ninguna autoridad — solo tu firma mueve fondos.',
  'Prepare & sign in Xaman': 'Preparar y firmar en Xaman',
  'Signed and sent — the ledger has it:': 'Firmado y enviado — el ledger lo tiene:',
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
  // ── Rotación gobernada con venues reales (F4) ──
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

  // ── De-AI pass: claves reportadas por los agentes de páginas ──
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

  // ── LegalAcceptGate (aceptación de condiciones + aviso) ──
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

  // ── Desplegable de proveedores FTSO en Wrap + delegate ──
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

  // ── Salida de la posición FTSO: FtsoExitModal ──
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

  // ── Earn bajo un consejo: lo que la vasija no sabe hacer ──
  // "Unsupported" se queda en inglés a propósito: es la etiqueta corta, igual
  // en los dos idiomas. La explicación sí habla castellano.
  'Unsupported for a council': 'No disponible para un consejo',
  'This strategy cannot be run by a council': 'Esta estrategia no la puede ejecutar un consejo',
  'The vault on Flare has no borrow function: a council order can only put principal to work in a venue and bring it back. This entry borrows USDT0 against the collateral, so it cannot be composed as a council order. The lend-only entry does the same supply without debt, and it is available.':
    'La vasija en Flare no tiene función de préstamo: una orden del consejo solo puede poner el principal a trabajar en un venue y traerlo de vuelta. Esta entrada pide USDT0 prestado contra el colateral, así que no se puede componer como orden del consejo. La entrada de solo supply hace el mismo depósito sin deuda, y sí está disponible.',
  'The vault on Flare has no borrow function, so a council cannot run the borrowing route. The lend-only route does the same supply without debt.':
    'La vasija en Flare no tiene función de préstamo, así que un consejo no puede usar la ruta con préstamo. La ruta de solo supply hace el mismo depósito sin deuda.',

  // ── Pasada i18n (auditoría completa): 352 claves t() que caían
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
  // El Send gobernado con la gramática del genérico.
  "Native": "Nativo",
  "This door moves native XRP on XRPL. The FXRP held by the council’s Flare Smart Account does not move from here.":
    "Esta puerta mueve XRP nativo en XRPL. El FXRP de la Smart Account de Flare del consejo no se mueve desde aquí.",
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
  'Cancel this ceremony': 'Cancelar esta ceremonia',
  'The council is signing this transaction right now': 'El consejo está firmando esta transacción ahora mismo',
  'FXRP → RLUSD liquidity (without selling)': 'FXRP → liquidez en RLUSD (sin vender)',
  'Borrow RLUSD against your FXRP': 'Pide RLUSD contra tu FXRP',
  'Keep your FXRP and still get liquidity from it. Your FXRP stays yours as collateral in the Morpho FXRP/RLUSD market on Ethereum, and you borrow RLUSD — a regulated e-money token — straight to your own wallet. This is not a yield strategy: collateral earns nothing here and the borrow costs interest, shown live with its source before you sign. What you get is spendable liquidity without selling your exposure. Repay protection is a separate rule you arm afterwards; entering does not arm it.': 'Conserva tu FXRP y aun así saca liquidez de él. Tu FXRP sigue siendo tuyo como colateral en el mercado FXRP/RLUSD de Morpho en Ethereum, y pides RLUSD prestado —un token de dinero electrónico regulado— directo a tu propia wallet. Esto NO es una estrategia de rendimiento: aquí el colateral no gana nada y el préstamo cuesta intereses, que se enseñan en vivo y con su fuente antes de que firmes. Lo que consigues es liquidez gastable sin vender tu exposición. La protección de repago es una regla aparte que armas después; entrar NO la arma.',
  'You get': 'Recibes',
  'RLUSD — a regulated e-money token — in your own wallet': 'RLUSD —un token de dinero electrónico regulado— en tu propia wallet',
  'Your FXRP': 'Tu FXRP',
  'Stays yours as collateral — it earns nothing while it sits there': 'Sigue siendo tuyo como colateral — ahí dentro no gana nada',
  'Medium — if FXRP falls far enough, the position is liquidated': 'Medio — si el FXRP cae lo suficiente, la posición se liquida',
  'Borrow RLUSD against your collateral': 'Pide RLUSD contra tu colateral',
  'Borrowed — the RLUSD is in your wallet.': 'Pedido — el RLUSD está en tu wallet.',
  'Borrow RLUSD against it': 'Pide RLUSD contra él',
  'Armed automations. This count does not say whether their last run worked.': 'Automatizaciones armadas. Este número NO dice si su última ejecución funcionó.',
  "Your wallet doesn't hold enough of that token on Ethereum for this action.": 'Tu wallet no tiene suficiente de ese token en Ethereum para esta operación.',
  "You're trying to bridge more FXRP than that wallet holds.": 'Estás intentando puentear más FXRP del que tiene esa wallet.',
  "The LayerZero delivery fee is paid in FLR, and your wallet doesn't hold enough.": 'La comisión de entrega de LayerZero se paga en FLR, y tu wallet no tiene suficiente.',
  "The LayerZero delivery fee is paid in ETH, and your wallet doesn't hold enough.": 'La comisión de entrega de LayerZero se paga en ETH, y tu wallet no tiene suficiente.',
  'That is more than your lent position is worth right now.': 'Eso es más de lo que vale tu posición prestada ahora mismo.',
  'The vault cannot pay that out right now — its live liquidity decides, not your balance.': 'La bóveda no puede pagar eso ahora mismo — manda su liquidez viva, no tu saldo.',
  'The vault cannot take that much right now — its deposit cap decides, not your balance.': 'La bóveda no puede aceptar tanto ahora mismo — manda su cupo de depósito, no tu saldo.',
  'The market cannot lend that much right now.': 'El mercado no puede prestar tanto ahora mismo.',
  'That borrow would put your position past its liquidation limit.': 'Ese préstamo dejaría tu posición pasada de su límite de liquidación.',
  'You cannot take out more collateral than the position holds.': 'No puedes sacar más colateral del que tiene la posición.',
  'Taking that much collateral out would cross the liquidation line while you still owe.': 'Sacar tanto colateral cruzaría la línea de liquidación mientras sigues debiendo.',
  'That is more than you owe — use "close the whole debt" instead.': 'Eso es más de lo que debes — usa «cerrar toda la deuda» en su lugar.',
  'This position has no debt to repay.': 'Esta posición no tiene deuda que repagar.',
  'The market on-chain no longer matches the one this app was built against. Nothing was prepared.': 'El mercado on-chain ya no coincide con el que esta aplicación tiene construido. No se ha preparado nada.',
  'That vault does not hold RLUSD. Nothing was prepared.': 'Esa bóveda no sostiene RLUSD. No se ha preparado nada.',
  'The bridge endpoints no longer match. Nothing was prepared.': 'Los extremos del puente ya no coinciden. No se ha preparado nada.',
  'The bridge no longer wraps the FXRP this app expects. Nothing was prepared.': 'El puente ya no envuelve el FXRP que esta aplicación espera. No se ha preparado nada.',
  'The amount has to be greater than zero.': 'El importe tiene que ser mayor que cero.',
  'That amount is not a valid figure.': 'Ese importe no es una cifra válida.',
  'That action is not one this rail can prepare.': 'Esa acción no es una que este carril pueda preparar.',
  'this step is IN FLIGHT — sent, but not confirmed yet.': 'este paso está EN VUELO — mandado, pero aún sin confirmar.',
  'It is IN FLIGHT — sent, but not confirmed yet.': 'Está EN VUELO — mandada, pero aún sin confirmar.',
  'Do NOT sign it again — check it on the explorer, and only retry the steps that are left once it lands.': 'NO la vuelvas a firmar — compruébala en el explorador, y reintenta sólo los pasos que falten cuando aterrice.',
  'Your FXRP works as collateral in the Morpho FXRP/RLUSD market on Ethereum, and you borrow RLUSD — a regulated e-money token — against it. Repay protection is a separate rule you arm afterwards; entering does not arm it.': 'Tu FXRP trabaja como colateral en el mercado FXRP/RLUSD de Morpho en Ethereum, y pides RLUSD prestado contra él — un token de dinero electrónico regulado. La protección de repago es una regla aparte que armas después; entrar NO la arma.',
  'Optional — a repay rule you arm after entering': 'Opcional — una regla de repago que armas después de entrar',
  'FXRP → Morpho (RLUSD carry)': 'FXRP → Morpho (carry en RLUSD)',
  'RLUSD → Sentora vault (lend-only)': 'RLUSD → bóveda Sentora (solo préstamo)',
  'Your FXRP on Ethereum is supplied to the Morpho market as collateral': 'Tu FXRP en Ethereum se aporta al mercado de Morpho como colateral',
  'RLUSD is borrowed at your chosen ratio, straight to your own wallet': 'El RLUSD se pide al ratio que elijas, directo a tu propia wallet',
  'Exit: repay the RLUSD, withdraw your FXRP': 'Salida: repagas el RLUSD y retiras tu FXRP',
  'Your RLUSD is deposited into the Sentora vault (finite approval, exact amount)': 'Tu RLUSD se deposita en la bóveda Sentora (aprobación finita, importe exacto)',
  'The curator allocates across Morpho markets — yield accrues in the share price': 'El curador reparte entre mercados de Morpho — el rendimiento se acumula en el precio de la share',
  'Withdraw returns RLUSD to your wallet, against live vault liquidity': 'Retirar devuelve RLUSD a tu wallet, contra la liquidez viva de la bóveda',
  'Your XRP becomes FXRP on Flare and is supplied to the Kinetic market to earn the protocol rate. No loans, no debt, no liquidation — withdraw whenever and you get FXRP back.': 'Tu XRP se convierte en FXRP en Flare y se aporta al mercado de Kinetic para ganar el tipo del protocolo. Sin préstamos, sin deuda y sin liquidación — retiras cuando quieras y recuperas FXRP.',
  'Kinetic ISO market: FXRP supplied as a plain deposit (no borrow)': 'Mercado ISO de Kinetic: el FXRP se aporta como depósito simple (sin pedir prestado)',
  'FLR → FTSO': 'FLR → FTSO',
  'FXRP → Firelight (stXRP)': 'FXRP → Firelight (stXRP)',
  'FXRP → Kinetic (carry)': 'FXRP → Kinetic (carry)',
  'FXRP → Kinetic (lend-only)': 'FXRP → Kinetic (solo préstamo)',
  'FXRP → Monarq (MXRPY)': 'FXRP → Monarq (MXRPY)',
  'FXRP → earnXRP (Clearstar)': 'FXRP → earnXRP (Clearstar)',
  'Anytime — returns FXRP': 'Cuando quieras — devuelve FXRP',
  'Firelight staking vault': 'Bóveda de staking de Firelight',
  'Kinetic ISO — plain supply': 'ISO de Kinetic — aportación simple',
  'Low — no debt, no liquidation': 'Bajo — sin deuda y sin liquidación',
  "Your open DeFi positions on Flare. Open one to add a Protect or Harvest automation — prepared for your signature, never executed automatically.":
    "Tus posiciones DeFi abiertas en Flare. Abre una para añadir una automatización Protect o Harvest — preparada para tu firma, nunca ejecutada automáticamente.",
  "Open DeFi positions": "Posiciones DeFi abiertas",
  "Connect a wallet to view your positions": "Conecta una wallet para ver tus posiciones",
  "Your open": "Tus posiciones",
  "DeFi positions": "DeFi abiertas",
  "Loading positions…": "Cargando posiciones…",
  "Could not load positions": "No se pudieron cargar las posiciones",
  "No open DeFi positions yet": "Aún no hay posiciones DeFi abiertas",
  'No active debt on the chains we could read': 'Sin deuda activa en las chains que pudimos leer',
  'No lending positions on the chains we could read': 'Sin posiciones de préstamo en las chains que pudimos leer',
  'Live on Ethereum — liquidation distance not available here': 'Viva en Ethereum — la distancia a liquidación no está disponible aquí',
  'Check it on the explorer →': 'Compruébalo en el explorador →',
  'Your repay protection is NOT armed yet.': 'Tu protección de repago NO está armada todavía.',
  "Arm it from this position’s card in Positions — the Protect (Ethereum) template watches your health factor and prepares the RLUSD repayment fresh for you to sign. Until you do, nothing is watching this position.": "Ármala desde la card de esta posición en Posiciones — la plantilla Proteger (Ethereum) vigila tu factor de salud y prepara el repago de RLUSD fresco para que lo firmes. Hasta que lo hagas, nada está vigilando esta posición.",
  "No debt to watch on the chains we could read — still reading Ethereum…": "Sin deuda que vigilar en las chains que pudimos leer — todavía leyendo Ethereum…",
  'Still reading Ethereum — this reading may not be your worst yet.': 'Todavía leyendo Ethereum — puede que esta lectura no sea aún la peor que tienes.',
  "Couldn't read your lend-only position in the Sentora vault just now. If you have RLUSD lent, it's still lent — retry in a moment.": "No pude leer tu posición de préstamo en la bóveda Sentora ahora mismo. Si tienes RLUSD prestado, sigue prestado — reinténtalo en un momento.",
  'Withdraw your RLUSD': 'Retira tu RLUSD',
  'Finish the carry (borrow RLUSD)': 'Termina el carry (pide RLUSD)',
  'Finish the carry — borrow RLUSD': 'Termina el carry — pide RLUSD prestado',
  'You borrow': 'Pides',
  'MAX': 'MÁX',
  "couldn't read your balance": "no pude leer tu saldo",
  'You have lent': 'Tienes prestado',
  'The vault can pay out now': 'La bóveda puede pagar ahora',
  'that is a hard ceiling, not an estimate.': 'eso es un techo duro, no una estimación.',
  "Your FXRP is already in as collateral and earns nothing while it sits there — collateral pays no supply rate. This is the borrow leg that was missing, over the collateral you already have: no new FXRP, no second approve. What you can borrow is checked against the live liquidation line before you sign.": "Tu FXRP ya está dentro como colateral y ahí no renta nada — el colateral no cobra tipo de supply. Esta es la pata de préstamo que faltaba, sobre el colateral que ya tienes: sin FXRP nuevo y sin un segundo approve. Lo que puedes pedir se comprueba contra la línea de liquidación viva antes de que firmes.",
  // No poder leer una posición no es no tenerla: el tablero lo dice en vez de
  // pintarse vacío (y llevarse por delante el botón de repago).
  "Couldn't read your Ethereum position right now, so it isn't on this board. If you have one open, it's still open — retry in a moment.":
    'No pude leer tu posición de Ethereum ahora mismo, así que no está en este tablero. Si tienes una abierta, sigue abierta — reinténtalo en un momento.',
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

  // ── Pasada i18n, parte B: textos que estaban DUROS en el código
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

  // ── Claves ES que faltaban en los modales em (auditoría AST a 0) ──
  None: 'Ninguna',
  'How much RLUSD arrives in your wallet, borrowed against the FXRP you supply. The review shows the health factor this leaves BEFORE you sign — at 1.0 the market can liquidate the position. The server blocks amounts past the liquidation limit or past what the market can lend right now.':
    'Cuánto RLUSD llega a tu wallet, prestado contra el FXRP que depositas. La revisión muestra el health factor que deja ANTES de firmar — en 1.0 el mercado puede liquidar la posición. El servidor bloquea importes que pasen del límite de liquidación o de lo que el mercado puede prestar ahora mismo.',

  // ── Claves ES que faltaban en CMF/consejo (auditoría AST a 0) ──
  'Protect me if the price falls below': 'Protégeme si el precio cae por debajo de',
  'On this schedule (UTC)': 'Con este horario (UTC)',
  'The floor is anchored to the live price when you activate — it must be below today’s price, and if the price cannot be read the flow is not created and we say why.':
    'El suelo se ancla al precio vivo al activar — debe estar por debajo del precio de hoy, y si el precio no se puede leer el flujo no se crea y te decimos por qué.',
  'This flow runs on the XRP Ledger: it must bind to the XRPL account that pays (an r-address). Connect that wallet before activating.':
    'Este flujo corre en el XRP Ledger: debe vincularse a la cuenta XRPL que paga (una dirección r). Conecta esa wallet antes de activar.',
  'Rail: XRP Ledger, governed — every trigger composes a council proposal and only the quorum’s signatures move anything.':
    'Raíl: XRP Ledger, gobernado — cada disparo compone una propuesta al consejo y solo las firmas del quórum mueven algo.',
  'Rail: XRP Ledger — every trigger nudges you and the transaction is composed fresh at the signing door; you sign it in Xaman.':
    'Raíl: XRP Ledger — cada disparo te avisa y la transacción se compone fresca en la puerta de firma; la firmas en Xaman.',
  'Rail: Flare (EVM) — every trigger prepares an unsigned action for you to sign in your wallet.':
    'Raíl: Flare (EVM) — cada disparo prepara una acción sin firmar para que la firmes en tu wallet.',
  'No XRPL account available — this flow pays from the XRP Ledger, so it must bind to your XRPL account (an r-address). Connect your Xaman.':
    'No hay cuenta XRPL disponible — este flujo paga desde el XRP Ledger, así que debe vincularse a tu cuenta XRPL (una dirección r). Conecta tu Xaman.',
  '(this account has no signer list on the ledger, so it pays for one signature).':
    '(esta cuenta no tiene lista de firmantes en el ledger, así que paga una sola firma).',
  'The council could not be read from XRPL just now, so the signing fee — which grows with every member of the quorum — is unknown. There is no Max while that is true: leave room for it, or reload before funding.':
    'El consejo no se ha podido leer de XRPL ahora mismo, así que la fee de firma — que crece con cada miembro del quórum — es desconocida. No hay Max mientras eso sea así: deja margen para ella, o recarga antes de fondear.',
  'Careful: the ledger says this would fail. It is in the inbox and holds the account’s only live slot — do not sign it; let it expire and compose it again fixed.':
    'Cuidado: el ledger dice que esto fallaría. Está en la bandeja y ocupa el único hueco vivo de la cuenta — no lo firmes; deja que caduque y compónlo de nuevo corregido.',

  // ── Plegado visual de la Smart Account (paFold) ──
  'Includes your Flare Smart Account — operated from this wallet':
    'Incluye tu Flare Smart Account — operada desde esta wallet',

  // ── Claves ES que faltaban (consejo/feed, auditoría a 0) ──
  'Choose the venue kind…': 'Elige el tipo de venue…',
  'its last run FAILED — it is watching nothing': 'su última ejecución FALLÓ — no está vigilando nada',
  'armed — its run history could not be read': 'armado — su historial de ejecuciones no se pudo leer',
  'Reading its run history…': 'Leyendo su historial de ejecuciones…',

  // ── Claves ES que faltaban (ceremonia multisig, auditoría a 0) ──
  'The sign requests on the members’ phones were dealt with, but the record of that sitting could not be reached, so we cannot tell you the Sequence it pinned is free again. Filing a proposal here may still be refused until it is — which happens as soon as the transaction reaches the ledger, and in any case within 30 minutes of the sitting being opened.':
    'Las peticiones de firma en los móviles de los miembros se atendieron, pero el registro de esa sesión no se pudo alcanzar, así que no podemos decirte que la Sequence que fijó esté libre de nuevo. Presentar una propuesta aquí puede seguir rechazándose hasta que lo esté — lo que ocurre en cuanto la transacción llega al ledger y, en todo caso, a los 30 minutos de abrirse la sesión.',
  'That sitting is either waiting for an answer or has already sent a transaction from this browser, so the Sequence it pinned is spoken for and there is nothing left here to cancel: a proposal filed now would pin the same one, and only one of the two can ever reach the ledger. The seat is freed as soon as that transaction reaches the ledger, and in any case within 30 minutes of being pinned.':
    'Esa sesión o está esperando respuesta o ya envió una transacción desde este navegador, así que la Sequence que fijó está comprometida y aquí no queda nada que cancelar: una propuesta presentada ahora fijaría la misma, y solo una de las dos puede llegar al ledger. El asiento se libera en cuanto esa transacción llega al ledger y, en todo caso, a los 30 minutos de fijarse.',
  'While this ceremony is open it holds the Sequence it pinned on this account, so the same transaction cannot also be filed as a proposal: two live copies of one seat means one of them executes and the other becomes a row nobody can settle — which is how a council ends up paying twice. Finish the signatures above, or cancel the ceremony there, and this door opens again.':
    'Mientras esta ceremonia está abierta retiene la Sequence que fijó en esta cuenta, así que la misma transacción no puede presentarse además como propuesta: dos copias vivas de un asiento significan que una ejecuta y la otra queda como una fila que nadie puede liquidar — así es como un consejo acaba pagando dos veces. Termina las firmas de arriba, o cancela la ceremonia allí, y esta puerta se abre de nuevo.',
  'Cancelling asks Xaman to kill the requests still open on the members’ phones. Signatures collected in this sitting are not stored, so they are lost.':
    'Cancelar pide a Xaman matar las peticiones aún abiertas en los móviles de los miembros. Las firmas recogidas en esta sesión no se guardan, así que se pierden.',
  'The wallet you have connected in Xaman is not one of the wallets linked to this account, and that registry is what the server reads. If your seat on this council is that wallet, link it in Wallets — the inbox opens as soon as it is registered.':
    'La wallet que tienes conectada en Xaman no es ninguna de las vinculadas a esta cuenta, y ese registro es lo que lee el servidor. Si tu asiento en este consejo es esa wallet, vincúlala en Wallets — la bandeja se abre en cuanto quede registrada.',
  'This account already has a proposal collecting signatures, and XRPL pins one Sequence at a time. Settle that one in the proposal inbox first: finish collecting its signatures and broadcast it, or register the transaction hash if it has already gone out — any member can do either.':
    'Esta cuenta ya tiene una propuesta recogiendo firmas, y XRPL fija una Sequence a la vez. Liquida antes esa en la bandeja de propuestas: termina de recoger sus firmas y difúndela, o registra el hash de la transacción si ya salió — cualquier miembro puede hacer ambas cosas.',
  'The server does not recognise you as a member of this council. It reads membership from the wallets registered in your account — not from the one connected in this tab — and none of them is on this signer list. Register the wallet that holds your seat, and this inbox opens.':
    'El servidor no te reconoce como miembro de este consejo. Lee la membresía de las wallets registradas en tu cuenta — no de la conectada en esta pestaña — y ninguna está en esta lista de firmantes. Registra la wallet que tiene tu asiento, y esta bandeja se abre.',

  // ── La pantalla del agente v2: raíl fuera, rutas dentro ──
  'Or start from a ready route': 'O empieza desde una ruta lista',
  'Or browse the ready-made routes': 'O echa un vistazo a las rutas ya hechas',
  'See this route on the strategy table': 'Ver esta ruta en la mesa de estrategias',

  // ── La mesa de cartas de estrategias (v2) ──
  'Pick a route — its full detail unfolds below.':
    'Elige una ruta — su detalle completo se despliega debajo.',

  // ── Carrier automático + ⓘ en fees + tema sistema ──
  'set automatically': 'fijado automáticamente',
  'It is not lost: it comes back to you as FXRP. Exact figures before signing. Nothing goes to Astryum.':
    'No se pierde: vuelve a ti como FXRP. Cifras exactas antes de firmar. Nada va a Astryum.',
  'How this figure is set': 'Cómo se fija esta cifra',
  "NOT a fee and NOT the amount of your operation: the order must ride an XRPL Payment to the FAssets Core Vault (Xaman will show it). The app reads the protocol's live fees — minting max(0.1%, 0.1 XRP) + 0.2 XRP for the executor — and adds a small margin so the order can never fail for lack of carrier. The margin returns to your account as FXRP.":
    'NO es una fee y NO es el importe de tu operación: la orden debe viajar en un Payment XRPL al Core Vault de FAssets (Xaman te lo mostrará). La app lee las fees vivas del protocolo — minting max(0,1%, 0,1 XRP) + 0,2 XRP del executor — y añade un pequeño margen para que la orden nunca falle por falta de portador. El margen vuelve a tu cuenta como FXRP.',
  'The XRPL Payment that carries your order — it IS your signature. After the protocol fees below, the remainder becomes the FXRP that goes to work; nothing here goes to Astryum.':
    'El Payment XRPL que transporta tu orden — ES tu firma. Tras las fees del protocolo de abajo, el resto se convierte en el FXRP que se pone a trabajar; nada de esto va a Astryum.',
  'Set automatically from live protocol fees plus a small margin, so the order can never fail for lack of carrier. The margin returns to your account as FXRP.':
    'Fijado automáticamente con las fees vivas del protocolo más un pequeño margen, para que la orden nunca falle por falta de portador. El margen vuelve a tu cuenta como FXRP.',
  'FAssets protocol fee for minting FXRP — max(0.1%, 0.1 XRP), read live from the protocol. Not an Astryum fee.':
    'Fee del protocolo FAssets por mintear FXRP — max(0,1%, 0,1 XRP), leída en vivo del protocolo. No es una fee de Astryum.',
  'Pays the executor that completes your order on Flare after your signature — a protocol-level cost, not an Astryum fee.':
    'Paga al executor que completa tu orden en Flare tras tu firma — un coste del protocolo, no una fee de Astryum.',
  'Dark space, light paper, or follow your device.':
    'Espacio oscuro, papel claro, o seguir a tu dispositivo.',

  // ── Home v3 (quinta pasada): una línea por cuenta, sin lente ──
  'Manage your accounts': 'Gestiona tus cuentas',
  'Every account you own, at a glance — including the ones a council governs: how much of each is working, how it stands, what it is worth. Click any row to manage it.':
    'Todas tus cuentas de un vistazo — también las que gobierna un consejo: cuánto trabaja cada una, cómo está y cuánto vale. Pulsa cualquier fila para gestionarla.',
  'This is your Home: all your capital, across every account, in one place. A minute of tour and you will know where everything lives — skip and replay it any time from Settings.':
    'Este es tu Inicio: todo tu capital, de todas tus cuentas, en un solo sitio. Un minuto de recorrido y sabrás dónde está todo — sáltalo y repítelo cuando quieras desde Ajustes.',
  'Where your accounts are managed: connect, watch or create them, and give one a quorum of your own keys. A Legacy — an account a council governs — lives here too, and you govern it from its own card.':
    'Donde se gestionan tus cuentas: conectarlas, vigilarlas o crearlas, y darle a una un quórum de tus propias llaves. Un Legacy —una cuenta que gobierna un consejo— también vive aquí, y lo gobiernas desde su propia tarjeta.',
  'A Legacy is one of your accounts held by a council: a quorum signs, not a single key. It appears in this same list, and you govern it from its own card.':
    'Un Legacy es una de tus cuentas sostenida por un consejo: firma un quórum, no una sola llave. Aparece en esta misma lista, y lo gobiernas desde su propia tarjeta.',

  // ── Banda de cuentas del Summary (cuarta pasada): UNA lista,
  //    los Legacy dentro, y la lente que reparte el total de arriba ──
  'Show the capital of every account together': 'Enseña el capital de todas las cuentas juntas',
  'Open this Legacy — governance, council and proposals':
    'Abre este Legacy — gobernanza, consejo y propuestas',
  'Every account you own, in one list — including the ones a council governs. Click any of them and the figures above, the health and both rings read that account alone; click "The whole fleet" to go back to everything.':
    'Todas tus cuentas en una sola lista — también las que gobierna un consejo. Pulsa cualquiera y las cifras de arriba, la salud y los dos anillos pasan a leer solo esa cuenta; pulsa «Toda la flota» para volver a verlo todo.',
  'A Legacy is one of your accounts held by a council: a quorum signs, not a single key. It lives with the rest of your wallets — this is the room where you govern it or constitute a new one.':
    'Un Legacy es una de tus cuentas sostenida por un consejo: firma un quórum, no una sola llave. Vive con el resto de tus wallets — esta es la sala donde la gobiernas o constituyes una nueva.',

  // ── Banda de flotas del Summary: Personal | Legacy, y la
  //    lente que reparte el total de arriba ──
  'The whole fleet': 'Toda la flota',
  'Show the capital of the whole fleet — personal and Legacy together':
    'Enseña el capital de toda la flota — personal y Legacy juntos',
  'personal + Legacy': 'personal + Legacy',
  account: 'cuenta',
  accounts: 'cuentas',
  'Click to read this account on its own': 'Pulsa para leer esta cuenta por separado',
  'Click to read this structure on its own': 'Pulsa para leer esta estructura por separado',
  'No wallets yet. Connect one you already own, watch an address, or create one here.':
    'Todavía no hay wallets. Conecta una que ya sea tuya, vigila una dirección, o crea una aquí.',
  'Open this wallet in Portfolio': 'Abre esta wallet en Portfolio',
  'Open this Legacy': 'Abre este Legacy',

  // ── Home hub v2: bienvenida + dos tarjetas + selección=tema ──
  'Good morning': 'Buenos días',
  'Good afternoon': 'Buenas tardes',
  'Good night': 'Buenas noches',
  'Pick the account you want to work with — the dashboard follows your choice.':
    'Elige la cuenta con la que quieres trabajar — el dashboard sigue tu elección.',
  'All wallets together': 'Todas las wallets juntas',
  'Work with this wallet — the dashboard scopes to it':
    'Trabaja con esta wallet — el dashboard se acota a ella',
  'Manage wallets': 'Gestionar wallets',
  'Nothing constituted yet. A Legacy is an account governed by a council — inheritance, family, treasury — where no single key can move alone.':
    'Aún no hay nada constituido. Un Legacy es una cuenta gobernada por un consejo — herencia, familia, tesorería — donde ninguna llave puede moverse sola.',
  'Enter this Legacy — the dashboard crosses to governed mode':
    'Entra en este Legacy — el dashboard cruza al modo gobernado',
  'Go to your Summary': 'Ir a tu Resumen',
  'net worth, health and what your capital is doing':
    'patrimonio, salud y qué está haciendo tu capital',
  'This is your Home: every account you work with lives here. A minute of tour and you will know where everything is — skip and replay it any time from Settings.':
    'Este es tu Inicio: aquí viven todas las cuentas con las que trabajas. Un minuto de recorrido y sabrás dónde está todo — sáltalo y repítelo cuando quieras desde Ajustes.',
  'Your own wallets. Click one to work with it — the whole dashboard turns gold and scopes to what you picked. Connect, watch or create wallets from the door below.':
    'Tus propias wallets. Haz clic en una para trabajar con ella — todo el dashboard se vuelve dorado y se acota a lo que elegiste. Conecta, vigila o crea wallets desde la puerta de abajo.',
  'Council-governed accounts: capital under rules that a quorum signs. Click one to enter — the dashboard crosses to indigo while you govern.':
    'Cuentas gobernadas por consejo: capital bajo reglas que firma un quórum. Haz clic en una para entrar — el dashboard cruza al índigo mientras gobiernas.',
  'The overview: net worth, health, alerts and how each wallet is performing — always scoped to the account you picked here.':
    'El resumen: patrimonio, salud, alertas y cómo rinde cada wallet — siempre acotado a la cuenta que elegiste aquí.',

  // ── Home hub (preview/home-hub, Fase A — "Home absorbe W1") ──
  // ('Home', 'Summary', 'Enter', 'Active', 'quorum', 'Manage', 'Personal' y
  // 'Constitute a Legacy' ya existen arriba.)
  'Pick the account you want to work with — or add the next one. Everything starts with a wallet.':
    'Elige la cuenta con la que quieres trabajar — o añade la siguiente. Todo empieza con una wallet.',
  'Across your fleet': 'En toda tu flota',
  'your capital — you sign': 'tu capital — firmas tú',
  // ('No wallets yet' ya existe arriba.)
  'Connect one you already have, watch an address, or create your first wallet with the guide.':
    'Conecta una que ya tengas, vigila una dirección, o crea tu primera wallet con la guía.',
  'See in Portfolio': 'Ver en Portfolio',
  'Add or create a wallet': 'Añadir o crear una wallet',
  'council-governed accounts — the quorum signs':
    'cuentas gobernadas por consejo — firma el quórum',
  'Back to Home': 'Volver a Inicio',

  // ── Unmint + entrada con FXRP de la Smart Account (0.9.41) ──
  'Unmint to XRP': 'Unmint a XRP',
  'Burns FXRP on Flare — the FAssets agent pays you native XRP on the XRP Ledger.':
    'Quema FXRP en Flare — el agente de FAssets te paga XRP nativo en el XRP Ledger.',
  'Pick your XRPL (Xaman) account as the destination — the XRP arrives there after the redemption. The protocol minimum per redemption is shown before you sign.':
    'Elige tu cuenta XRPL (Xaman) como destino — el XRP llega allí tras la redención. El mínimo del protocolo por redención se muestra antes de firmar.',
  'Convert the FXRP in this account back to native XRP on your XRPL wallet':
    'Convierte el FXRP de esta cuenta de vuelta a XRP nativo en tu wallet XRPL',
  'Pay with': 'Pagar con',
  'Converts now (mint)': 'Se convierte ahora (mint)',
  'Already minted in your account': 'Ya minteado en tu cuenta',
  'Xaman · FXRP already minted': 'Xaman · FXRP ya minteado',
  'FXRP from your account': 'FXRP de tu cuenta',
  'Carrier payment': 'Pago portador',

  // ── Earn finder, paso de resultado (0.9.40) ──
  // (Clave ES que faltaba en el trabajo en vuelo del compañero.)
  'Council, constitution and proposals of this account':
    'Consejo, constitución y propuestas de esta cuenta',

  // ── Anclaje de operaciones + Know how ──
  'operations settling on-chain': 'operaciones liquidándose on-chain',
  'Minimize — it waits at the bottom, exactly as you left it':
    'Minimizar — espera abajo, exactamente como la dejaste',
  'Pin to the side — the dashboard stays live': 'Anclar al lado — el dashboard sigue vivo',
  'Back to a window': 'Volver a ventana',
  // Constituir como operación — el subtítulo del host.
  'Six stations — pin this panel and the dashboard stays live beside it.':
    'Seis estaciones — ancla este panel y el dashboard sigue vivo al lado.',
  'Know how — the 8 steps, illustrated': 'Know how — los 8 pasos, ilustrados',
  // Multi-op: hasta tres a la vez + cierre en dos pasos.
  'Close the operation': 'Cerrar la operación',
  // Reinforce como operación en oro — copy propia, sin Legacy.
  'Your own keys guard it — it stays a personal wallet throughout.':
    'La guardan tus propias llaves — sigue siendo una wallet personal de principio a fin.',
  'Rules (optional)': 'Reglas (opcional)',
  'Optional for a reinforced account — your quorum already protects it. Anchor rules only if you want them written on the ledger.':
    'Opcional en una cuenta reforzada — tu quórum ya la protege. Ancla reglas solo si quieres dejarlas escritas en el ledger.',
  'Optional — anchor written rules on the ledger, or go straight to done.':
    'Opcional — ancla reglas escritas en el ledger, o pasa directamente al final.',
  '~10 min · only if you want it': '~10 min · solo si lo quieres',
  // ('Keep it open' ya existe más abajo — clave compartida.)
  'Close…': 'Cerrar…',
  'Three operations are already open': 'Ya hay tres operaciones abiertas',
  'Close one from its pill at the bottom and try again — none is closed for you, they all hold live state.':
    'Cierra una desde su píldora de abajo y vuelve a intentarlo — ninguna se cierra sola: todas guardan estado vivo.',

  // ── Crossing v3: wallet → flecha → panteón ──
  signs: 'firma',

  // ── Posiciones: una estrategia = una tarjeta + stepper saneado ──
  'This step WITHDRAWS your collateral — the FXRP comes back to you. You are not depositing anything.':
    'Este paso RETIRA tu colateral — el FXRP vuelve a ti. No estás depositando nada.',
  'A crumb of debt remains': 'Queda una migaja de deuda',
  'the protocol keeps just enough collateral backing it, so MAX already discounts that part. Settle the crumb and the rest becomes withdrawable.':
    'el protocolo retiene el respaldo justo para cubrirla, así que MAX ya descuenta esa parte. Salda la migaja y el resto queda libre para retirar.',
  'The protocol keeps part of the collateral while any debt remains — you still owe':
    'El protocolo retiene parte del colateral mientras quede deuda — aún debes',
  'Try a slightly smaller amount, or settle that crumb first (step 2).':
    'Prueba con un poco menos, o salda antes esa migaja (paso 2).',
  'Pay off the loan': 'Pagar el préstamo',
  'Deposit the borrowed dollars back and close the loan — your collateral stays put.':
    'Devuelve los dólares pedidos y cierra el préstamo — tu colateral se queda donde está.',
  'Withdraw collateral': 'Retirar colateral',
  'Take part of your collateral out — mind the health factor: less backing means closer to liquidation.':
    'Saca parte de tu colateral — ojo al health factor: menos respaldo es estar más cerca de la liquidación.',
  Carry: 'Carry',
  'One strategy, two legs: what you lent backs what you borrowed. Closing runs in the safe order — the loan first, then your collateral — and the step-by-step does the ordering for you.':
    'Una estrategia, dos piernas: lo que prestaste respalda lo que pediste. El cierre va en el orden seguro — primero el préstamo, después tu colateral — y el paso a paso ordena por ti.',
  'Two legs, one close': 'Dos piernas, un solo cierre',
  'Moving on…': 'Pasando al siguiente…',
  'How it runs, exactly': 'Cómo se ejecuta, exactamente',

  // ── Portfolio lavado de cara: Overview + Activity ──
  type: 'tipo',
  types: 'tipos',
  // ('All types', 'Clear filters' y 'By Kind' ya existen arriba.)
  'Nothing in this date range': 'Nada en este rango de fechas',
  'Your history has events outside the selected dates — widen the range or clear the filters.':
    'Tu historial tiene movimientos fuera de las fechas elegidas — amplía el rango o quita los filtros.',

  // ── Wallets v2: identidad delante, gestión detrás ──
  'My Legacy': 'Mi Legacy',
  'Legacy governance': 'Gobernanza del Legacy',
  'Rename this Legacy': 'Renombrar este Legacy',
  'Balance hidden on this card': 'Saldo oculto en esta tarjeta',
  'Balance visible on this card': 'Saldo visible en esta tarjeta',
  'Signing wallet options': 'Opciones de la wallet firmante',
  'Stop tracking this wallet': 'Dejar de seguir esta wallet',
  // ── La confirmación clásica de borrado ──
  'Remove this Legacy from your list?': '¿Quitar este Legacy de tu lista?',
  'Remove this wallet from your list?': '¿Quitar esta wallet de tu lista?',
  'This is the wallet connected right now, so removing it also releases that connection — otherwise it would come straight back to the list.':
    'Es la wallet que tienes conectada ahora mismo, así que al quitarla también se suelta esa conexión: si no, volvería a la lista enseguida.',
  '— governed by a council, a quorum signs': '— gobernada por un consejo, firma un quórum',
  // ── El distintivo amplificado de una cuenta gobernada ──
  sign: 'firman',
  'the council signs': 'firma el consejo',
  'Accounts governed by a council: a quorum signs, never a single key.':
    'Cuentas gobernadas por un consejo: firma un quórum, nunca una sola llave.',
  // (llega por variable — la auditoría AST no la ve, pero se pinta)
  'XRPL wallet': 'Wallet XRPL',

  // ── El panel de la derecha: la ficha entera de una ruta ──
  'The journey': 'El viaje',
  'What can happen to you': 'Qué puede pasarte',
  Liquidation: 'Liquidación',
  'Who decides': 'Quién decide',
  'How you get out': 'Cómo se sale',
  'Step by step': 'Paso a paso',
  'Who is behind it': 'Quién está detrás',
  Audit: 'Auditoría',
  // Sin informe enlazable se dice que no lo hay: es un hecho verdadero y útil,
  // y un sello sin enlace sería peor que nada (#9).
  'Audit: not published': 'Auditoría: no publicada',
  'Signs with': 'Se firma con',
  'You review and sign in your own wallet. Astryum never signs.':
    'Tú revisas y firmas en tu propia wallet. Astryum nunca firma.',
  // Las salidas, en palabras de persona.
  'Any time': 'Cuando quieras',
  'Against live liquidity': 'Contra la liquidez viva',
  'Repay the debt first': 'Repagando la deuda primero',
  'With a waiting period': 'Con periodo de espera',
  'In windows': 'Por ventanas',

  // De donde sale cada numero, en castellano llano. Viajan como DATO desde
  // lib/earn/rateSource, asi que el comprobador de literales no las ve: sin
  // estas lineas saldrian en ingles bajo una tasa en castellano.
  'Read from Kinetic on the chain, plus the rewards DeFiLlama reports':
    'Leido del contrato de Kinetic, mas los premios que publica DeFiLlama',
  'Read from Kinetic on the chain': 'Leido del contrato de Kinetic',
  'The cost Kinetic charges right now, read from the chain':
    'Lo que cobra Kinetic ahora mismo, leido de la cadena',
  'Read from your position on the chain': 'Leido de tu posicion en la cadena',
  'Upshift, the platform that runs the vault': 'Upshift, la plataforma que opera la boveda',
  'The Morpho market, read from the chain': 'El mercado de Morpho, leido de la cadena',
  'DeFiLlama, which tracks these markets': 'DeFiLlama, que sigue estos mercados',
  'The Flare network itself': 'La propia red de Flare',
  'Read from the chain': 'Leido de la cadena',

  // ── La copy de las cards, curada para cualquiera ──
  // Los nombres nombran el SITIO y lo que hace allí: en una rejilla, lo que uno
  // busca es el sitio. Las dos de «saca efectivo» conservan su frase de
  // beneficio, porque ahí lo que se elige es un resultado, no un lugar.
  'Strategy details': 'Detalle de la estrategia',
  'Kinetic earning': 'Rendimiento en Kinetic',
  'The market rate on your XRP, with no loan': 'El tipo del mercado para tu XRP, sin préstamo',
  'Firelight staking': 'Staking en Firelight',
  'You get a token you can still use while it earns': 'Recibes un token que sigues pudiendo usar mientras rinde',
  'earnXRP Vault': 'Bóveda earnXRP',
  'Strategies anyone can check on the chain': 'Estrategias que cualquiera puede comprobar en la cadena',
  'Monarq XRP fund': 'Fondo de XRP de Monarq',
  'Run off the chain, so you cannot check it': 'Se gestiona fuera de la cadena, así que no puedes comprobarlo',
  'Earn FLR': 'Gana con tu FLR',
  'It stays in your wallet, working for the network': 'Se queda en tu wallet, trabajando para la red',
  'Sentora decides where it goes': 'Sentora decide dónde va',
  'When you get paid': 'Cuándo cobras',
  'Roughly every 3–4 days': 'Cada 3-4 días, más o menos',
  'Not yet — Firelight has not started paying': 'Todavía no: Firelight aún no ha empezado a pagar',
  'Getting out': 'Cómo se sale',
  'Right away for a 0.10% fee, or free after 24 h': 'Al momento pagando un 0,10%, o gratis pasadas 24 h',
  'You wait 7 days, or pay 0.30% to leave now': 'Esperas 7 días, o pagas un 0,30% para salir ya',
  'The network pays roughly every 3–4 days. It is its rate, not an Astryum offer':
    'La red paga cada 3-4 días, más o menos. Es su tipo, no una oferta de Astryum',
  'Not paying rewards yet — Firelight says they start later':
    'Todavía no reparte recompensas: Firelight dice que empiezan más adelante',
  // El título dice QUÉ CONSIGUES; la acción, DÓNDE y lo que hay que saber. Sin
  // flechas de ticker, sin «carry», sin nombres de token de recibo: nada de eso
  // significa nada para quien no viene de DeFi, y ninguna traducción arregla una
  // frase que en su propio idioma tampoco se entiende.
  'Earn on your XRP and borrow dollars': 'Haz rendir tu XRP y pide dólares prestados',
  'Kinetic · it earns, and backs a loan': 'Kinetic · rinde, y respalda un préstamo',
  'Put your XRP to earn': 'Pon tu XRP a rendir',
  'Kinetic · the market rate, no loan': 'Kinetic · el tipo del mercado, sin préstamo',
  'Stake your XRP': 'Haz staking con tu XRP',
  'Firelight · you get a token you can still use':
    'Firelight · recibes un token que sigues pudiendo usar',
  'Let a curated vault grow your XRP': 'Deja que una bóveda haga crecer tu XRP',
  'earnXRP · strategies anyone can check on-chain':
    'earnXRP · estrategias que cualquiera puede comprobar en la cadena',
  'A managed XRP fund': 'Un fondo de XRP gestionado',
  'Monarq · run off-chain, so you cannot check it':
    'Monarq · se gestiona fuera de la cadena, así que no puedes comprobarlo',
  'Earn with your FLR without moving it': 'Gana con tu FLR sin moverlo de sitio',
  'Flare · it stays in your wallet, working for the network':
    'Flare · se queda en tu wallet, trabajando para la red',
  'Get dollars without selling your XRP': 'Consigue dólares sin vender tu XRP',
  'Morpho · your XRP is the guarantee, and it can be liquidated':
    'Morpho · tu XRP es la garantía, y puede liquidarse',
  'Lend your RLUSD': 'Presta tus RLUSD',
  'Sentora · a curator decides where it goes': 'Sentora · un curador decide dónde va',
  // Y los hechos que acompañan a un número, dichos como se le dirían a alguien.
  'Your XRP earns nothing here: it is only the guarantee':
    'Aquí tu XRP no gana nada: solo hace de garantía',
  'same place': 'mismo sitio',
  'Not for this account': 'No disponible en esta cuenta',

  // ── El selector de activos y sus filtros ──
  'Market data and calculator': 'Datos de mercado y calculadora',
  'Nothing here with': 'Aquí no hay nada con',
  'Ordering is yours — the default keeps the catalogue order, and nothing here is a recommendation.':
    'El orden lo eliges tú: por defecto se mantiene el del catálogo, y nada de esto es una recomendación.',
  // Estas dos vienen de la otra sesión (puerta del gestor) y se
  // quedaron sin traducir: sin ellas el CI de i18n deja la rama roja.
  // REVISADAS por su autor: la primera se queda tal cual. La segunda
  // decía «bóveda gestionada» y pasa a «bóveda con gestor», que es el nombre
  // que eligió el fundador para el producto («Managed vaults» / «Bóvedas con
  // gestor»). Dos palabras para lo mismo en dos pantallas es como empiezan las
  // divergencias en las que luego nadie sabe cuál es la buena.
  'A manager puts your assets to work. You choose the vault and the risk — and code, not trust, holds them to the parameters you signed: they can never take your assets.':
    'Un gestor pone tus activos a trabajar. Tú eliges la bóveda y el riesgo — y es el código, no la confianza, quien lo sujeta a los parámetros que firmaste: jamás puede llevarse tus activos.',
  'How a managed vault works': 'Cómo funciona una bóveda con gestor',

  // ── El catálogo v2: asset → tipología → producto ──
  Assets: 'Activos',
  'See all strategies': 'Ver todas las estrategias',
  'Back to venues': 'Volver a los sitios',
  // 'strategies' ya vive arriba (línea ~969): repetirla aquí es TS1117, que es
  // como este diccionario avisa de que se está duplicando en vez de reutilizar.
  'With what': 'Con qué',
  Everything: 'Todo',
  'Your XRP counts here: it is minted into FXRP on the way in.':
    'Tu XRP cuenta aquí: se acuña en FXRP por el camino.',
  'By type': 'Por tipo',
  'By risk': 'Por riesgo',
  'protocol data with its source — nothing here is a recommendation':
    'datos del protocolo con su fuente — nada de esto es una recomendación',
  'No route here with': 'Aquí no hay ninguna ruta con',
  'there is one with': 'sí la hay con',
  'Nothing here for the chosen asset.': 'Nada aquí para el activo elegido.',
  'See it whole': 'Verlo entero',
  // Las franjas de riesgo: el título y su hecho. Viajan como DATO (RISK_BANDS),
  // así que el comprobador de literales no las ve — y sin estas líneas saldrían
  // en inglés en medio de la pantalla, que es el agujero B del checker.
  'Nothing can liquidate you': 'Nada puede liquidarte',
  'No debt, and nobody else decides where your money goes.':
    'Sin deuda, y nadie más decide dónde va tu dinero.',
  'Someone else decides where it goes': 'Otro decide dónde va',
  'A curator or a manager allocates it — on-chain or off it, and the card says which.':
    'Lo reparte un curador o un gestor — dentro o fuera de la cadena, y la card dice cuál.',
  'It can be liquidated': 'Puede liquidarse',
  'There is debt against your collateral.': 'Hay deuda contra tu colateral.',
  // Y las dos tipologías declaradas para cuando tengan producto (Spectra, LP).
  'Lock in your rate': 'Fija tu rendimiento',
  'Know today what you will hold on a given date — with a maturity, and a penalty for leaving early.':
    'Saber hoy cuánto tendrás en una fecha — con vencimiento, y penalización por salir antes.',
  'Provide liquidity': 'Provee liquidez',
  'Earn the fees of a market, carrying impermanent loss while you do.':
    'Cobra las comisiones de un mercado, cargando con la pérdida impermanente mientras.',

  // ── El camino interactivo del catálogo ──
  'What do you want to happen?': '¿Qué quieres que pase?',
  'With what?': '¿Con qué?',
  '— only one asset reaches this outcome': '— solo un activo llega a este resultado',
  '1 route matches — its live data and risks are on the card below.':
    '1 ruta encaja — sus datos en vivo y sus riesgos están en la tarjeta de abajo.',
  'routes match — their live data and risks are on the cards below.':
    'rutas encajan — sus datos en vivo y sus riesgos están en las tarjetas de abajo.',
  'Clear and see all': 'Quitar el filtro y verlas todas',
  'Pick one to narrow the list below — or scroll and read them all. Nothing here is a recommendation.':
    'Elige una para acotar la lista de abajo — o baja y léelas todas. Nada de esto es una recomendación.',
  // Resultados (el primer paso del camino)
  'Make it earn, simply': 'Que rente, sin complicaciones',
  // Dos menús + el agente dentro.
  'Against your tokens': 'Contra tus tokens',
  // La barra de mando del agente.
  'Tell the agent what you want with your tokens…': 'Dile al agente qué quieres con tus tokens…',
  'Tell the agent what your tokens should earn…': 'Dile al agente qué tienen que rentar tus tokens…',
  'Tell the agent the cash you need without selling…': 'Dile al agente el dinero que necesitas sin vender…',
  'It compiles — you sign': 'Él compila — tú firmas',
  'Send to the agent': 'Enviar al agente',
  'Fold the agent': 'Plegar el agente',
  // Ideas de prompt de la barra — mismas frases que el estado
  // vacío del chat donde ya existían; preguntas del usuario, jamás consejo.
  'Try:': 'Prueba:',
  // Historial local del agente — 30 días en este navegador.
  'New conversation': 'Nueva conversación',
  // Etiquetas de la tarjeta de opciones, derivadas en cliente.
  'Supply only (no loan)': 'Solo supply (sin préstamo)',
  // La lente Tokens recupera todos los detalles.
  'Quantity': 'Cantidad',
  // El selector de wallet con cara.
  'Choose a wallet': 'Elige una wallet',
  // Los filtros de alcance del Portfolio, ahora selectores.
  'All networks': 'Todas las redes',
  'Show only this Legacy': 'Ver solo este Legacy',
  // Wallets: quitar en dos pasos (y el Legacy con su casilla).
  'Keep it': 'Dejarla',
  'Remove…': 'Quitar…',
  'This is a Legacy governed by a council. Removing it here only stops tracking it in Astryum: the account, its council and its capital stay on XRPL exactly as they are, and nothing is signed. To see it again you will have to add it back.': 'Esto es un Legacy gobernado por un consejo. Quitarlo aquí solo deja de seguirlo en Astryum: la cuenta, su consejo y su capital siguen en XRPL exactamente igual, y no se firma nada. Para volver a verlo tendrás que añadirlo de nuevo.',
  'Removing it here only stops tracking it in Astryum: the wallet and its capital stay where they are, and nothing is signed. To see it again you will have to add it back.': 'Quitarla aquí solo deja de seguirla en Astryum: la wallet y su capital siguen donde están, y no se firma nada. Para volver a verla tendrás que añadirla de nuevo.',
  'I understand the Legacy stays on the ledger — I am only removing it from this list.': 'Entiendo que el Legacy sigue en el ledger: solo lo quito de esta lista.',
  'Remove this Legacy from my list': 'Quitar este Legacy de mi lista',
  'Remove this wallet': 'Quitar esta wallet',
  // Wallets: sello de gestor y chip de lectura.
  'Your own keys — one signature, yours to move.': 'Tus propias llaves: una firma, y se mueve lo tuyo.',
  'Runs managed vaults': 'Gestiona bóvedas',
  'Reading wallets': 'Leyendo wallets',
  'Some vaults could not be read right now — the list may be incomplete. Try again in a moment.': 'Algunas bóvedas no se pudieron leer ahora mismo — la lista puede estar incompleta. Prueba de nuevo en un momento.',
  // Exchange (segunda pasada): sitio del cliente aparte del operador, dos cuentas nuevas, alta que se esconde.
  'Your XRP, at the exchange': 'Tu XRP, en el exchange',
  'You deposit with your tag, like at any exchange. The exchange keeps the XRP in its omnibus account.': 'Depositas con tu tag, como en cualquier exchange. El exchange guarda el XRP en su cuenta ómnibus.',
  'Working, in your name': 'Trabajando, a tu nombre',
  'When it works, the shares live in an account that only your Face ID controls. The exchange cannot touch them.': 'Cuando trabaja, las participaciones viven en una cuenta que solo controla tu Face ID. El exchange no puede tocarlas.',
  'Out with one signature': 'Fuera con una firma',
  'One Face ID takes everything out — back to your slot at the exchange or to your own wallet. Nobody can stop it.': 'Un Face ID lo saca todo: de vuelta a tu casilla del exchange o a tu propia wallet. Nadie puede impedirlo.',
  'A custodial exchange, on the rail': 'Un exchange custodial, sobre el raíl',
  'Your capital works, and stays yours': 'Tu capital trabaja, y sigue siendo tuyo',
  'your tag at the exchange': 'tu tag en el exchange',
  'XRP with your tag': 'XRP con tu tag',
  'shares in your name': 'participaciones a tu nombre',
  'Out': 'Fuera',
  'one Face ID': 'un Face ID',
  'Your path at the exchange': 'Tu camino en el exchange',
  'Your wallet for withdrawals': 'Tu wallet para retiradas',
  'Withdrawals from the exchange go to this XRPL account of yours. You can change it any time.': 'Las retiradas del exchange van a esta cuenta XRPL tuya. Puedes cambiarla cuando quieras.',
  'Optional to operate; needed to withdraw to self-custody. Create one in Xaman, pick one you already connected, or connect a new one.': 'Opcional para operar; necesaria para retirar a autocustodia. Créala en Xaman, elige una que ya conectaste o conecta una nueva.',
  'Pick a connected wallet': 'Elegir una wallet conectada',
  'Create one in Xaman': 'Crear una en Xaman',
  'Connect a new one from Wallets': 'Conectar una nueva desde Wallets',
  'Use this wallet for withdrawals': 'Usar esta wallet para retiradas',
  'Install Xaman (xaman.app) and create a new account — the keys are born on your phone.': 'Instala Xaman (xaman.app) y crea una cuenta nueva: las claves nacen en tu teléfono.',
  'Write the family seed on paper, offline. Whoever holds it holds the account.': 'Apunta la family seed en papel, sin conexión. Quien la tiene, tiene la cuenta.',
  'Activate it with ~2 XRP (1 stays as reserve), then connect it here from Wallets and pick it above.': 'Actívala con ~2 XRP (1 queda de reserva), conéctala aquí desde Wallets y elígela arriba.',
  'Your exchange could not be opened': 'Tu exchange no se pudo abrir',
  '72h cooldown exit': 'salida con cooldown de 72 h',
  'Your exchange could not be found right now': 'Tu exchange no se pudo encontrar ahora mismo',
  'Which exchange do you want an account with?': '¿En qué exchange quieres abrir cuenta?',
  // Cliente POR exchange: la misma llave pide acceso a cada uno.
  'Each exchange verifies its own clients: you are inside an exchange only once it has registered your KYC. Your account at one exchange does not open another.': 'Cada exchange verifica a sus propios clientes: estás dentro de un exchange solo cuando ha registrado tu KYC. Tu cuenta en un exchange no te abre otro.',
  'Go to my account': 'Ir a mi cuenta',
  'One account per exchange, each with its own deposit tag and its own verification. Which one do you want to open?': 'Una cuenta por exchange, cada una con su tag de depósito y su propia verificación. ¿Cuál quieres abrir?',
  'There is no other exchange to ask for access right now. Your accounts are here:': 'Ahora mismo no hay otro exchange al que pedir acceso. Tus cuentas están aquí:',
  'This passkey already has an account at every exchange taking clients': 'Esta passkey ya tiene cuenta en todos los exchanges que admiten clientes',
  'You already have an account at:': 'Ya tienes cuenta en:',
  'Your exchange accounts': 'Tus cuentas de exchange',
  // Sin autopilot: cada movimiento lo firma el omnibus con un QR de Xaman.
  'Signed by the omnibus ({hash}). Recording it against the ledger…': 'Firmado por el omnibus ({hash}). Registrándolo contra el ledger…',
  'Signed and validated ({hash}); the mint lands in the pote in ~2–5 min. Its record is still catching up with the ledger — if it has not settled in a few minutes, use «Record again» below. The client is debited once.': 'Firmado y validado ({hash}); el mint llega al pote en ~2–5 min. Su registro aún se está poniendo al día con el ledger: si en unos minutos no se ha liquidado, usa «Registrar otra vez» abajo. Al cliente se le descuenta una sola vez.',
  'The ledger node the exchange reads does not show it validated yet — nothing is lost; try «Record again» in a moment.': 'El nodo del ledger que lee el exchange aún no lo muestra validado; no se pierde nada: prueba «Registrar otra vez» en un momento.',
  '{xrp} XRP waiting for the exchange to sign': '{xrp} XRP esperando a que el exchange firme',
  'The QR is created for the omnibus: scan it with the Xaman that holds that account. The account connected here does not need to change.': 'El QR se crea para el omnibus: escanéalo con la Xaman que tiene esa cuenta. La cuenta conectada aquí no tiene que cambiar.',
  'Client requests': 'Peticiones de tus clientes',
  'Client requests — the omnibus signs each one with a QR': 'Peticiones de tus clientes: el omnibus firma cada una con un QR',
  'What your clients ask, for the amount they asked. Each one is signed by your omnibus with a QR in Xaman — nothing moves until you sign it.': 'Lo que piden tus clientes, por el importe que pidieron. Cada una la firma tu omnibus con un QR en Xaman: nada se mueve hasta que firmas.',
  'Sign with QR': 'Firmar con QR',
  'Read the omnibus': 'Leer el omnibus',
  'withdrawal': 'retirada',
  'into the vault': 'al vault',
  'No requests waiting. When a client asks to put XRP to work or to withdraw, it appears here.': 'No hay peticiones esperando. Cuando un cliente pida poner XRP a trabajar o retirarlo, aparece aquí.',
  'A payment of this client is already in flight — it settles first.': 'Ya hay un pago de este cliente en vuelo: primero se liquida ese.',
  'This client also asked for a withdrawal: serve that one first — a withdrawal always goes ahead.': 'Este cliente también pidió una retirada: sirve esa primero; una retirada siempre va delante.',
  'This client has no withdrawal wallet on file yet.': 'Este cliente aún no tiene wallet de retirada registrada.',
  'This client has no Flare account yet (they create it with their passkey).': 'Este cliente aún no tiene cuenta en Flare (la crea con su passkey).',
  'Your pote is not open yet.': 'Tu pote aún no está abierto.',
  'This request belongs to a client that is no longer on file — reload.': 'Esta petición es de un cliente que ya no está registrado: recarga.',
  "Pay {xrp} XRP to {name}'s own wallet": 'Pagar {xrp} XRP a la wallet propia de {name}',
  'Put {xrp} XRP of {name} to work in the pote': 'Poner a trabajar {xrp} XRP de {name} en el pote',
  'Back — nothing is signed': 'Atrás: no se firma nada',
  "The request was taken from the queue, but its payment could not be composed: {reason}. Nothing was signed and the client's XRP is free again — they can ask again.": 'La petición se tomó de la cola, pero su pago no se pudo componer: {reason}. No se firmó nada y el XRP del cliente vuelve a estar libre: puede pedirlo otra vez.',
  "Nothing was signed. The request was already taken from the queue: the client's XRP is free again and they can ask again.": 'No se firmó nada. La petición ya se había tomado de la cola: el XRP del cliente vuelve a estar libre y puede pedirlo otra vez.',
  'Payout signed by the omnibus ({hash}). The client is debited when the payment validates — this panel reads the omnibus on its own.': 'Pago firmado por el omnibus ({hash}). Al cliente se le descuenta cuando el pago se valida; este panel lee el omnibus solo.',
  'Signed by the omnibus. The executor mints XRP → FXRP and deposits into the pote with the client as receiver (~2–5 min).': 'Firmado por el omnibus. El executor acuña XRP → FXRP y deposita en el pote con el cliente como receptor (~2–5 min).',
  'The client asked; the exchange signed it from its omnibus with a QR. The shares are minted to the client account.': 'Lo pidió el cliente; el exchange lo firmó desde su omnibus con un QR. Las participaciones se acuñan a la cuenta del cliente.',
  'In flight — signed or waiting for a signature:': 'En vuelo: firmados o esperando firma:',
  'validated — read the omnibus to settle it': 'validado: lee el omnibus para liquidarlo',
  'validated — scan the omnibus to settle it': 'validado: lee el omnibus para liquidarlo',
  'Free the seat (once its payload can no longer be signed)': 'Liberar el asiento (cuando su payload ya no pueda firmarse)',
  'Record again ({hash})': 'Registrar otra vez ({hash})',
  'Recorded: the 0xFE {hash} is verified on the ledger and the client was debited once.': 'Registrado: el 0xFE {hash} está verificado en el ledger y al cliente se le descontó una sola vez.',
  'The 0xFE is validated ({hash}) but the exchange ledger could not record it: {reason}. Its reservation stays in flight until it is recorded — use «Record again».': 'El 0xFE está validado ({hash}) pero el libro del exchange no pudo registrarlo: {reason}. Su reserva sigue en vuelo hasta que se registre: usa «Registrar otra vez».',
  'The payout is validated, but its hash could not be kept on the desk record ({reason}) — it stays in flight until the ledger mirror settles it.': 'El pago está validado, pero su hash no se pudo guardar en el registro de la mesa ({reason}): sigue en vuelo hasta que el espejo del ledger lo liquide.',
  'The payout is validated, but its hash could not be kept on the desk record — it stays in flight until the ledger mirror settles it.': 'El pago está validado, pero su hash no se pudo guardar en el registro de la mesa: sigue en vuelo hasta que el espejo del ledger lo liquide.',
  'The reservation could not be released and stays in flight: {reason}': 'La reserva no se pudo liberar y sigue en vuelo: {reason}',
  'each one signed by the omnibus with a QR': 'cada una la firma el omnibus con un QR',
  'Your clients, their KYC, the omnibus and your potes. Your clients ask; you sign each movement from the omnibus with a QR in Xaman.': 'Tus clientes, su KYC, el omnibus y tus potes. Tus clientes piden; tú firmas cada movimiento desde el omnibus con un QR en Xaman.',
  'receives by tag · signs in your Xaman, with a QR': 'recibe por tag · firma en tu Xaman, con un QR',
  'A payment without a tag, or with a tag no account has, is not credited to anyone. Nothing pays it back on its own: every payout of the omnibus is one you sign with a QR.': 'Un pago sin tag, o con un tag que ninguna cuenta tiene, no se acredita a nadie. Nada lo devuelve solo: cada pago del omnibus lo firmas tú con un QR.',
  'Approve KYC · step 1 of 2: your root signs (QR)': 'Aprobar KYC · paso 1 de 2: firma tu raíz (QR)',
  'Step 1 of 2 done: your root issued it.': 'Paso 1 de 2 hecho: tu raíz la emitió.',
  'Your root already issued it; the omnibus has not accepted it yet.': 'Tu raíz ya la emitió; el omnibus aún no la ha aceptado.',
  'Step 2: the omnibus accepts it — one signature of the omnibus in Xaman.': 'Paso 2: el omnibus la acepta, con una firma del omnibus en Xaman.',
  'Accept from the omnibus · QR in Xaman': 'Aceptar desde el omnibus · QR en Xaman',
  'Accept KYC {type} · the omnibus signs': 'Aceptar KYC {type} · firma el omnibus',
  'Accepted by the omnibus. The KYC is in force as soon as the ledger validates it — this panel updates on its own.': 'Aceptada por el omnibus. El KYC está vigente en cuanto el ledger la valida; este panel se actualiza solo.',
  'Two signatures, each with a QR in Xaman: your root issues it and your omnibus accepts it — the client signs nothing. It is the record of your process, not a portable credential of the client. Withdrawals never depend on it.': 'Dos firmas, cada una con un QR en Xaman: tu raíz la emite y tu omnibus la acepta; el cliente no firma nada. Es el registro de tu proceso, no una credencial portable del cliente. Las retiradas nunca dependen de ella.',
  'With the exchange': 'Con el exchange',
  'Not sent': 'No enviado',
  'the exchange signs it from its account': 'el exchange lo firma desde su cuenta',
  'The exchange took this request to sign it from its account — its progress shows in your activity.': 'El exchange tomó esta petición para firmarla desde su cuenta: su avance sale en tu actividad.',
  'Your clients ask to put XRP to work or to withdraw it. Each request is signed by your omnibus with a QR in Xaman, for the amount the client asked — the desk never picks a client or an amount.': 'Tus clientes piden poner XRP a trabajar o retirarlo. Cada petición la firma tu omnibus con un QR en Xaman, por el importe que pidió el cliente: la mesa nunca elige cliente ni importe.',
  'The omnibus account in your Xaman': 'La cuenta omnibus en tu Xaman',
  'The omnibus key never leaves your Xaman: Astryum composes the payment and your omnibus signs it. Nothing moves until you sign it.': 'La llave del omnibus nunca sale de tu Xaman: Astryum compone el pago y tu omnibus lo firma. Nada se mueve hasta que firmas.',
  'Your Face ID account is not a client of any exchange yet. Choose one: it assigns your deposit tag — your slot in its omnibus — and from then on this page is your account there.': 'Tu cuenta de Face ID aún no es cliente de ningún exchange. Elige uno: te asigna tu tag de depósito —tu casilla en su ómnibus— y desde entonces esta página es tu cuenta allí.',
  'Open my account here': 'Abrir mi cuenta aquí',
  'My exchange account': 'Mi cuenta en el exchange',
  'Your XRP at the exchange, working or not — and the way out, always yours. Face ID once creates the on-chain account where your shares live, in your name.': 'Tu XRP en el exchange, trabajando o no, y la salida, siempre tuya. Un Face ID crea la cuenta on-chain donde viven tus participaciones, a tu nombre.',
  'Do you run an exchange?': '¿Operas un exchange?',
  'Operator desk': 'Mesa del operador',
  'In Xaman: add TWO new accounts': 'En Xaman: añade DOS cuentas nuevas',
  'Account switcher → “Add account” → “Create new account”, twice: one is the root (council), the other the omnibus for your users. The keys are born on your phone and never leave it — Astryum never sees them.': 'Selector de cuentas → «Añadir cuenta» → «Crear cuenta nueva», dos veces: una es la raíz (consejo), la otra el ómnibus para tus usuarios. Las claves nacen en tu teléfono y no salen de él: Astryum nunca las ve.',
  'Write both secrets down, on paper': 'Apunta los dos secretos en papel',
  'Xaman shows each family seed once. Paper, offline: whoever holds the root holds the exchange authority; whoever holds the omnibus holds the clients\' XRP.': 'Xaman enseña cada family seed una sola vez. Papel, sin conexión: quien tiene la raíz tiene la autoridad del exchange; quien tiene el ómnibus tiene el XRP de los clientes.',
  'Activate them: 15–30 XRP the root, ~2 XRP the omnibus': 'Actívalas: 15–30 XRP la raíz, ~2 XRP el ómnibus',
  'On the root, 1 XRP stays as base reserve, ~0.6 covers the credential and DID objects, the rest is the carrier of the cage birth (it comes back as FXRP) and margin. The omnibus only needs its reserve; the clients fill it.': 'En la raíz, 1 XRP queda como reserva base, ~0,6 cubre los objetos de credencial y DID, y el resto es el carrier del nacimiento de la jaula (vuelve como FXRP) y margen. El ómnibus solo necesita su reserva; lo llenan los clientes.',
  'Connect them here': 'Conéctalas aquí',
  'Back in Astryum, connect both from Wallets and pick them above. Every station reads the ledger of the ROOT; the omnibus is what your desk and your backend will watch.': 'De vuelta en Astryum, conecta las dos desde Wallets y elígelas arriba. Cada estación lee el ledger de la RAÍZ; el ómnibus es lo que vigilarán tu mesa y tu backend.',
  'Two fresh accounts, both dedicated': 'Dos cuentas nuevas, las dos dedicadas',
  'The same account system that already works in the non-custodial Astryum, replicated for the custodial case: governance lives in XRPL accounts, where the XRP is; the asset, when it works, lives on Flare. One root governs one cage, for ever — never reuse an account with a history.': 'El mismo sistema de cuentas que ya funciona en el Astryum no custodial, replicado para el caso custodial: la gobernanza vive en cuentas XRPL, donde está el XRP; el activo, cuando trabaja, vive en Flare. Una raíz gobierna una jaula, para siempre: jamás reutilices una cuenta con historia.',
  'Why two accounts, and why both new': 'Por qué dos cuentas, y por qué las dos nuevas',
  'One 0xFE in flight per account: ceremonial governance and frequent cash would step on each other\'s nonce.': 'Un 0xFE en vuelo por cuenta: el gobierno ceremonial y la caja frecuente se pisarían el nonce.',
  'The credential never lives on an automated hot key: a backend compromise would take the cash AND the identity of the vehicle. Tomorrow the root is the SignerList of the board — it cannot be a hot wallet.': 'La credencial jamás vive en una llave caliente automatizada: un compromiso del backend se llevaría la caja Y la identidad del vehículo. Mañana la raíz es el SignerList del órgano: no puede ser una hot wallet.',
  'Each XRPL account has ONE Personal Account on Flare: sharing would mix the book of governance acts with the cash operations.': 'Cada cuenta XRPL tiene UNA Personal Account en Flare: compartirla mezclaría el libro de actos de gobierno con la operativa de caja.',
  'New, because one council = one cage for ever (a clean history as the record of the vehicle), and because the rail omnibus needs its own tag space, caps and evidence — the legacy omnibus keeps its life; capital migrates as clients come in.': 'Nuevas, porque un consejo = una jaula para siempre (historia limpia como acta del vehículo), y porque el ómnibus del raíl necesita espacio de tags propio, topes propios y evidencia propia: el ómnibus legacy sigue su vida; el capital migra según entran los clientes.',
  'Connect them from Wallets': 'Conectarlas desde Wallets',
  'The second account — the omnibus for your users': 'La segunda cuenta: el ómnibus para tus usuarios',
  'Where your clients deposit, each with their tag — their slice of this account. NEW and dedicated to the rail; its seed lives in YOUR backend, never in Astryum. Pick another connected Xaman, or paste its r-address.': 'Donde depositan tus clientes, cada uno con su tag: su trocito de esta cuenta. NUEVA y dedicada al raíl; su seed vive en TU backend, nunca en Astryum. Elige otra Xaman conectada o pega su r-address.',
  'Omnibus on file': 'Ómnibus guardado',
  'Omnibus XRPL account (r…)': 'Cuenta XRPL ómnibus (r…)',
  'The omnibus must be a different account from the root.': 'El ómnibus tiene que ser una cuenta distinta de la raíz.',
  'An XRPL r-address.': 'Una r-address de XRPL.',
  'Save the omnibus': 'Guardar el ómnibus',
  'Two new accounts': 'Dos cuentas nuevas',
  'The root that governs (council) and the omnibus where your users deposit by tag — both NEW, in your Xaman': 'La raíz que gobierna (consejo) y el ómnibus donde depositan tus usuarios por tag: las dos NUEVAS, en tu Xaman',
  'Client (demo view)': 'Cliente (vista demo)',
  'Setup complete · review': 'Alta completa · revisar',
  'Exchange · operator desk': 'Exchange · mesa del operador',
  'The exchange adopts the whole rail with two NEW accounts — the root that governs and the omnibus where its clients deposit by tag — gets accredited, births its cage and operates. Astryum does not sign, custody or decide: it lays the rail and the mechanical doors.': 'El exchange adopta el raíl entero con dos cuentas NUEVAS —la raíz que gobierna y el ómnibus donde sus clientes depositan por tag—, se acredita, pare su jaula y opera. Astryum no firma, no custodia ni decide: pone el raíl y las puertas mecánicas.',
  'Client site': 'Sitio del cliente',
  'what your clients see, in the menu': 'lo que ven tus clientes, en el menú',
  // El pie de estaciones y «¿por qué está hecha?» (StationProgress v2, StationDoneNotice).
  'Why done?': '¿Por qué hecha?',
  'the account you pasted or connected': 'la cuenta que pegaste o conectaste',
  'the SignerList of the account, read from the ledger': 'el SignerList de la cuenta, leído del ledger',
  'the rehearsal signatures recorded for this account': 'las firmas de ensayo registradas para esta cuenta',
  'the master key flag of the account, read from the ledger': 'el flag de la clave maestra de la cuenta, leído del ledger',
  'the DID object of the account, read from the ledger': 'el objeto DID de la cuenta, leído del ledger',
  'the balance of the account, read from the ledger': 'el saldo de la cuenta, leído del ledger',
  'the connected Xaman wallet': 'la wallet Xaman conectada',
  'the ledger gate: every required credential in force, from an accepted issuer': 'la puerta del ledger: cada credencial exigida vigente, de un emisor aceptado',
  'DID object of the account, read from XRPL': 'objeto DID de la cuenta, leído de XRPL',
  'cageOf(account) on the factory, read from Flare': 'cageOf(cuenta) en la factory, leído de Flare',
  'your public profile, saved on the server': 'tu perfil público, guardado en el servidor',
  'Already done': 'Ya está hecha',
  'This station is already done for the account you picked. The ledger is per account: whatever this account already did counts here, whoever did it and wherever it was done — a manager setup, a Legacy, an earlier take.': 'Esta estación ya está hecha para la cuenta que elegiste. El ledger es por cuenta: lo que esta cuenta ya hizo cuenta aquí, lo hiciera quien lo hiciera y donde fuera: un alta de gestor, un Legacy, una toma anterior.',
  'What was read': 'Qué se leyó',
  'Nothing to sign here. You can look around, or jump to the first station that is still pending.': 'Aquí no hay nada que firmar. Puedes mirar, o saltar a la primera estación que sigue pendiente.',
  'Stay here': 'Quedarme aquí',
  'Click again to close': 'Pulsa otra vez para cerrar',
  // Alta del exchange: de dónde sale cada check.
  'this root already governs a cage from another life — the exchange root must be a NEW account': 'esta raíz ya gobierna una jaula de otra vida: la raíz del exchange tiene que ser una cuenta NUEVA',
  'This account already has a history — it cannot be the exchange root.': 'Esta cuenta ya tiene historia: no puede ser la raíz del exchange.',
  'It governs a cage': 'Gobierna una jaula',
  'pote(s)': 'pote(s)',
  'born before this exchange existed (a manager root, most likely). One council governs one cage, for ever: attaching an exchange to it would mix two lives in one registry. Create a NEW account in Xaman for the root and pick it here.': 'nacida antes de que existiera este exchange (una raíz de gestor, seguramente). Un consejo gobierna una jaula, para siempre: colgarle un exchange mezclaría dos vidas en un registro. Crea una cuenta NUEVA en Xaman para la raíz y elígela aquí.',
  'This root already has a history from another life: what the ledger shows here belongs to that life, not to this exchange. Go back to station 1 and pick a NEW account.': 'Esta raíz ya tiene historia de otra vida: lo que el ledger enseña aquí es de esa vida, no de este exchange. Vuelve a la estación 1 y elige una cuenta NUEVA.',
  // Alta del exchange: la puerta de operador de la estación 7, en frase y con su paso.
  'This is reserved to the operators of this deployment, and your Astryum session is not recognised as one. Nothing was changed.': 'Esto está reservado a los operadores de este despliegue, y tu sesión de Astryum no consta como una de ellas. No se ha cambiado nada.',
  'Your admin panel session expired. Nothing was changed.': 'Tu sesión del panel de admin ha caducado. No se ha cambiado nada.',
  'Open the admin panel again in this same tab and enter the panel key, then create the profile again. Everything you did at the other stations stays on the ledger.': 'Vuelve a abrir el panel de admin en esta misma pestaña y mete la llave del panel; después crea el perfil otra vez. Todo lo que hiciste en las otras estaciones sigue en el ledger.',
  "If you operate this deployment: a password account is not recognised by its email alone, even when the email is on the operators' list. Open the admin panel in this same tab and enter the panel key, then create the profile again. Everything you did at the other stations stays on the ledger.": 'Si operas este despliegue: una cuenta con contraseña no se reconoce solo por su email, aunque el email esté en la lista de operadores. Abre el panel de admin en esta misma pestaña y mete la llave del panel; después crea el perfil otra vez. Todo lo que hiciste en las otras estaciones sigue en el ledger.',
  'root = the connected Xaman · omnibus = saved on this device': 'raíz = la Xaman conectada · ómnibus = guardado en este dispositivo',
  'both legs in force in the ledger (XLS-70)': 'las dos patas vigentes en el ledger (XLS-70)',
  'DID object of the root, read from XRPL': 'objeto DID de la raíz, leído de XRPL',
  'address saved on the desk profile or on this device': 'dirección guardada en el perfil de la mesa o en este dispositivo',
  'cageOf(root) on the factory, read from Flare': 'cageOf(raíz) en la factory, leído de Flare',
  'potes of the cage, read from Flare': 'potes de la jaula, leídos de Flare',
  'the order was sent — its hash is kept on this device; the contract confirms in ~2–5 min': 'la orden se envió: su hash se guarda en este dispositivo; el contrato la confirma en ~2–5 min',
  'a desk profile whose council is this root': 'un perfil de mesa cuyo consejo es esta raíz',
  // Ceremonias de configuración: una plantilla (SetupOperationShell), puertas (SetupDoorCard), hub /app/setup.
  'Set up your exchange': 'Configura tu exchange',
  'Eight stations — pin this panel and the dashboard stays live beside it.': 'Ocho estaciones: ancla este panel y el dashboard sigue vivo al lado.',
  'desk': 'mesa',
  'Two new accounts, the licence, the constitution, the KYC registry, the cage, the pote, the gate and the desk — become a tenant of the rail.': 'Dos cuentas nuevas, la licencia, la constitución, el registro KYC, la jaula, el pote, la puerta y la mesa: nacer como tenant del raíl.',
  '~40 min · Xaman + MetaMask': '~40 min · Xaman + MetaMask',
  'Setup complete for this root': 'Alta completa para esta raíz',
  'Set up your manager account': 'Configura tu cuenta de gestor',
  'A dedicated account, its title, its constitution, its cage and its first vault — and the public card clients read before depositing.': 'Una cuenta dedicada, su título, su constitución, su jaula y su primera bóveda, y la ficha pública que los clientes leen antes de depositar.',
  '~30 min · Xaman + your signatures': '~30 min · Xaman + tus firmas',
  'vault(s) already open on this account': 'bóveda(s) ya abierta(s) en esta cuenta',
  'The setup follows ONE XRPL account of yours. Connect the one that will manage — a fresh, dedicated account — and this window fills with its stations.': 'El alta sigue a UNA cuenta XRPL tuya. Conecta la que va a gestionar, una cuenta nueva y dedicada, y esta ventana se llena con sus estaciones.',
  'Ceremonies': 'Ceremonias',
  'Everything that is set up once, by stations, in the same window: a Legacy, a manager account, an exchange. Each check is read from the ledger — leave at any station and come back.': 'Todo lo que se configura una vez, por estaciones, en la misma ventana: un Legacy, una cuenta de gestor, un exchange. Cada check se lee del ledger: puedes irte en cualquier estación y volver.',
  'A fresh account becomes the vessel of a council: who signs, how many must agree, the rehearsal, the master key retired, the rules anchored.': 'Una cuenta nueva se convierte en la vasija de un consejo: quién firma, cuántos deben estar de acuerdo, el ensayo, la clave maestra retirada, las reglas ancladas.',
  '~45 min · the members’ phones': '~45 min · los teléfonos de los miembros',
  'stations': 'estaciones',
  'Open the setup': 'Abrir el alta',
  'Opens as a window you can pin to the side or minimize — the dashboard stays live beside it.': 'Se abre como una ventana que puedes anclar al lado o minimizar: el dashboard sigue vivo al lado.',
  // Mesa del exchange (stage/): puerta de cuenta, alta por estaciones, tour, guion.
  'I don\'t have an XRPL account': 'No tengo cuenta XRPL',
  'Create one in Xaman in two minutes — the keys are born on your phone.': 'Créala en Xaman en dos minutos: las claves nacen en tu teléfono.',
  'I already have one in Astryum': 'Ya la tengo en Astryum',
  'Pick one of the Xaman wallets you connected.': 'Elige una de las wallets Xaman que ya conectaste.',
  'I have one, but not here yet': 'La tengo, pero aún no está aquí',
  'Connect it from Wallets and come back.': 'Conéctala desde Wallets y vuelve.',
  'The XRPL wallet where your keys are born and stay. Free, on iOS and Android.': 'La wallet XRPL donde tus claves nacen y se quedan. Gratis, en iOS y Android.',
  'Create a new account and write the secret on paper': 'Crea una cuenta nueva y apunta el secreto en papel',
  'Xaman shows the family seed once. Paper, offline — whoever holds it holds the account.': 'Xaman enseña la family seed una sola vez. Papel, sin conexión: quien la tiene, tiene la cuenta.',
  'Activate it with a few XRP': 'Actívala con unos XRP',
  'An XRPL account exists once it receives its first XRP. For an exchange root, 15–30 XRP cover reserves, objects and the birth of the cage.': 'Una cuenta XRPL existe cuando recibe su primer XRP. Para la raíz de un exchange, 15–30 XRP cubren reservas, objetos y el nacimiento de la jaula.',
  'Back in Astryum, add it from Wallets. This desk follows it from then on.': 'De vuelta en Astryum, añádela desde Wallets. Esta mesa la sigue desde entonces.',
  'Which XRPL account is yours here?': '¿Qué cuenta XRPL es la tuya aquí?',
  'Everything on the exchange desk follows ONE XRPL account of yours: it holds the credentials, anchors the rules and signs every order in Xaman. Choose how you bring it.': 'Toda la mesa del exchange sigue a UNA cuenta XRPL tuya: sostiene las credenciales, ancla las reglas y firma cada orden en Xaman. Elige cómo la traes.',
  'Create your account in Xaman': 'Crea tu cuenta en Xaman',
  'Get Xaman': 'Descargar Xaman',
  'Then connect it from Wallets': 'Después conéctala desde Wallets',
  'Your Xaman wallets in Astryum': 'Tus wallets Xaman en Astryum',
  'No Xaman wallet connected yet — connect it from Wallets first.': 'Aún no hay ninguna wallet Xaman conectada: conéctala primero desde Wallets.',
  'For an exchange root, use a NEW account with no history: one root governs one cage, for ever.': 'Para la raíz de un exchange usa una cuenta NUEVA, sin historia: una raíz gobierna una jaula, para siempre.',
  'Use this account': 'Usar esta cuenta',
  'Add another from Wallets': 'Añadir otra desde Wallets',
  'Connect your account': 'Conecta tu cuenta',
  'Wallets opens the connection flow: scan with your Xaman, sign the binding, and it appears in your list. Come back here and pick it.': 'Wallets abre el flujo de conexión: escanea con tu Xaman, firma la vinculación y aparece en tu lista. Vuelve aquí y elígela.',
  'I already connected it': 'Ya la he conectado',
  'In Xaman: add a NEW account': 'En Xaman: añade una cuenta NUEVA',
  'Account switcher → “Add account” → “Create new account”. The keys are born on your phone and never leave it — Astryum never sees them.': 'Selector de cuentas → «Añadir cuenta» → «Crear cuenta nueva». Las claves nacen en tu teléfono y no salen de él: Astryum nunca las ve.',
  'Xaman shows the family seed once. Paper, offline: whoever holds it holds the exchange authority.': 'Xaman enseña la family seed una sola vez. Papel, sin conexión: quien la tiene, tiene la autoridad del exchange.',
  'Activate it with 15–30 XRP': 'Actívala con 15–30 XRP',
  '1 XRP stays as base reserve, ~0.6 covers the credential and DID objects, the rest is the carrier of the cage birth (it comes back as FXRP) and margin for fees.': '1 XRP queda como reserva base, ~0,6 cubre los objetos de credencial y DID, y el resto es el carrier del nacimiento de la jaula (vuelve como FXRP) y margen para fees.',
  'Back in Astryum, connect the new account from Wallets and pick it above. Every station reads the ledger of THIS account.': 'De vuelta en Astryum, conecta la cuenta nueva desde Wallets y elígela arriba. Cada estación lee el ledger de ESTA cuenta.',
  'A fresh account, dedicated to governing': 'Una cuenta nueva, dedicada a gobernar',
  'One root governs one cage, for ever. Never reuse an account with a history (another pote, another cage, another product): the resolver is generation-first and a root with two lives is the multi-registry hazard.': 'Una raíz gobierna una jaula, para siempre. Jamás reutilices una cuenta con historia (otro pote, otra jaula, otro producto): el resolver es generación-primero y una raíz con dos vidas es el hazard multi-registro.',
  'CASP — the licence of your sector': 'CASP: la licencia de tu sector',
  'Issued by an accredited issuer as an XLS-70 credential with an expiry. In the demo the reference issuer signs it; in production, a regulated third party.': 'La emite un emisor acreditado como credencial XLS-70 con caducidad. En la demo la firma el emisor de referencia; en producción, un tercero regulado.',
  'KYC — who answers for the exchange': 'KYC: quién responde por el exchange',
  'The identity of the compliance officer behind the root, as an XLS-70 credential. It travels with the account, never with a document.': 'La identidad del responsable de cumplimiento detrás de la raíz, como credencial XLS-70. Viaja con la cuenta, nunca con un documento.',
  'Issued. It lands in the tray below in a few seconds — accept it in your Xaman: that signature is the consent.': 'Emitida. Aterriza en la bandeja de abajo en unos segundos: acéptala en tu Xaman, esa firma es el consentimiento.',
  'Credentials of the root': 'Credenciales de la raíz',
  'The ledger gate reads the licence of YOUR sector plus the identity of who answers. Without both in force, the cage refuses to be born — the gate bites at the birth itself.': 'La puerta del ledger lee la licencia de TU sector más la identidad de quien responde. Sin las dos vigentes, la jaula se niega a nacer: la puerta muerde en el propio nacimiento.',
  'Issue CASP with the demo issuer': 'Emitir CASP con el emisor de la demo',
  'Credential ceremony (issue as an issuer)': 'Ceremonia de credencial (emitir como emisor)',
  'The demo issuer is the reference notary of this environment (MANAGER_DEMO_AIFM_ENABLED): it signs the licence for the root so the take can proceed. The ceremony lets any issuer account you control sign a credential of any type — the KYC leg in the demo. In production both come from regulated issuers; Astryum never issues.': 'El emisor de la demo es el notario de referencia de este entorno (MANAGER_DEMO_AIFM_ENABLED): firma la licencia para la raíz para que la toma pueda seguir. La ceremonia permite que cualquier cuenta emisora que controles firme una credencial de cualquier tipo: la pata KYC en la demo. En producción las dos vienen de emisores regulados; Astryum nunca emite.',
  'Your KYC registry on Flare': 'Tu registro KYC en Flare',
  'Each exchange has its own ExchangeKycRegistry: YOUR list of approved clients and their tag, the on-chain source of the return tag. Its admin is your compliance wallet on Flare (MetaMask) — Astryum is admin of none.': 'Cada exchange tiene su propio ExchangeKycRegistry: TU lista de clientes aprobados y su tag, la fuente on-chain del tag de retorno. Su admin es tu wallet de cumplimiento en Flare (MetaMask): Astryum no es admin de ninguno.',
  'Registry on file': 'Registro guardado',
  'saved on the desk profile': 'guardado en el perfil de la mesa',
  'kept here until the desk profile exists': 'guardado aquí hasta que exista el perfil de la mesa',
  'Registry address (0x…)': 'Dirección del registro (0x…)',
  'A 0x address of 40 hex characters.': 'Una dirección 0x de 40 caracteres hex.',
  'Already on file.': 'Ya está guardada.',
  'Save the registry': 'Guardar el registro',
  'How to deploy it': 'Cómo desplegarlo',
  'Optional but recommended: without it, entry is gated by the exchange alone and the exit tag has no on-chain source.': 'Opcional pero recomendado: sin él, la entrada la filtra solo el exchange y el tag de salida no tiene fuente on-chain.',
  'Deploy your KYC registry': 'Despliega tu registro KYC',
  'One forge script, one address to paste back here.': 'Un script de forge y una dirección que pegar aquí.',
  'Decide the admin: the EVM wallet of your compliance officer (MetaMask on Flare). It will sign every setApprovedWithTag.': 'Decide el admin: la wallet EVM de tu responsable de cumplimiento (MetaMask en Flare). Firmará cada setApprovedWithTag.',
  'Run the deploy script from the contracts folder of the repo:': 'Ejecuta el script de despliegue desde la carpeta contracts del repo:',
  'Paste the deployed address in this station. Station 7 points the pote at it by council order; from then on the contract — not Astryum, not the exchange — refuses deposits from accounts that are not approved.': 'Pega la dirección desplegada en esta estación. La estación 7 apunta el pote hacia él por orden de consejo; desde entonces el contrato —ni Astryum ni el exchange— rechaza depósitos de cuentas no aprobadas.',
  'The ledger carries the YES, never the NO: an AML rejection is never written on-chain.': 'El ledger lleva el SÍ, nunca el NO: un rechazo AML jamás se escribe on-chain.',
  'The cage is not born yet (station 5).': 'La jaula aún no ha nacido (estación 5).',
  'Relayed. The relayer pays the FDC proof and the cage opens the pote (~2–5 min); this station turns green on its own.': 'Relayada. El relayer paga la prueba FDC y la jaula abre el pote (~2–5 min); esta estación se pone verde sola.',
  'Your pote is open inside the cage': 'Tu pote está abierto dentro de la jaula',
  'The ERC-4626 vault where your clients\' shares will live. Next: point it at your KYC registry, then set up the desk.': 'El vault ERC-4626 donde vivirán las participaciones de tus clientes. Siguiente: apúntalo a tu registro KYC y configura la mesa.',
  'Open the pote — a council order': 'Abrir el pote: una orden de consejo',
  'The cage opens the pote by order of its root: an XRPL payment with a memo → FDC proof → the bridge executes createPote. The venues come from Astryum\'s allowlist for the policy you pick; the pote is born with a 10% buffer floor and a 20% cut.': 'La jaula abre el pote por orden de su raíz: un pago XRPL con memo → prueba FDC → el bridge ejecuta createPote. Los destinos salen de la whitelist de Astryum según la política que elijas; el pote nace con colchón del 10 % y corte del 20 %.',
  'Venues from the allowlist': 'Destinos de la whitelist',
  'Reading the registry…': 'Leyendo el registro…',
  'The venue registry could not be read right now.': 'El registro de destinos no se pudo leer ahora mismo.',
  'No active venue for this policy on this chain.': 'No hay ningún destino activo para esta política en esta cadena.',
  'Open the pote — the root signs': 'Abrir el pote: firma la raíz',
  'Compose the opening (1 signature)': 'Componer la apertura (1 firma)',
  'Relayed. The pote points at your registry once the proof lands (~2–5 min).': 'Relayada. El pote apunta a tu registro en cuanto aterrice la prueba (~2–5 min).',
  'The gate — point the pote at your registry': 'La puerta: apunta el pote a tu registro',
  'From here the CONTRACT rejects deposits from accounts that are not approved in your registry, and every exit with tag has its on-chain source (tagOf). Exits are never gated.': 'Desde aquí el CONTRATO rechaza depósitos de cuentas no aprobadas en tu registro, y cada salida con tag tiene su fuente on-chain (tagOf). Las salidas nunca se filtran.',
  'Order sent': 'Orden enviada',
  'Point the gate — the root signs': 'Apuntar la puerta: firma la raíz',
  'The pote is not open yet (station 6).': 'El pote aún no está abierto (estación 6).',
  'No KYC registry on file (station 4).': 'No hay registro KYC guardado (estación 4).',
  'Send the order again': 'Enviar la orden otra vez',
  'Compose the gate order (1 signature)': 'Componer la orden de puerta (1 firma)',
  'The desk profile exists for this root': 'El perfil de la mesa ya existe para esta raíz',
  'Omnibus': 'Ómnibus',
  'Pote': 'Pote',
  'KYC registry': 'Registro KYC',
  'Open the desk': 'Abrir la mesa',
  'The desk profile': 'El perfil de la mesa',
  'What Operate runs on: your omnibus (where clients deposit with a tag), the policy of your pote and your registry. The root is this account. The omnibus seed never touches Astryum — it lives in YOUR backend.': 'Sobre lo que corre Operar: tu ómnibus (donde depositan los clientes con tag), la política de tu pote y tu registro. La raíz es esta cuenta. La seed del ómnibus jamás toca a Astryum: vive en TU backend.',
  'Root (council)': 'Raíz (consejo)',
  'Policy · registry · pote': 'Política · registro · pote',
  'Create the desk profile': 'Crear el perfil de la mesa',
  'Root account': 'Cuenta raíz',
  'A NEW, dedicated XRPL account in your Xaman — the exchange authority': 'Una cuenta XRPL NUEVA y dedicada en tu Xaman: la autoridad del exchange',
  '~5 min · Xaman': '~5 min · Xaman',
  'Credentials': 'Credenciales',
  'CASP (your licence) and KYC (who answers), issued to THIS account and accepted in Xaman': 'CASP (tu licencia) y KYC (quién responde), emitidas a ESTA cuenta y aceptadas en Xaman',
  '~10 min · issuer + your signatures': '~10 min · emisor + tus firmas',
  'Your own ExchangeKycRegistry on Flare — the approved list and the source of the return tag': 'Tu propio ExchangeKycRegistry en Flare: la lista de aprobados y la fuente del tag de retorno',
  '~5 min · forge + MetaMask': '~5 min · forge + MetaMask',
  'Born with one 0xFE signature, obeying this account for ever — it locks no capital': 'Nace con una firma 0xFE, obedeciendo a esta cuenta para siempre; no bloquea capital',
  'The pote': 'El pote',
  'A council order opens the vault inside the cage, with the venues of your policy': 'Una orden de consejo abre el vault dentro de la jaula, con los destinos de tu política',
  '~5 min · 1 signature + FDC': '~5 min · 1 firma + FDC',
  'The gate': 'La puerta',
  'A council order points the pote at your registry — the contract refuses who is not approved': 'Una orden de consejo apunta el pote a tu registro: el contrato rechaza a quien no está aprobado',
  'The desk': 'La mesa',
  'The exchange profile: omnibus, policy, registry — what Operate runs on': 'El perfil del exchange: ómnibus, política, registro; sobre lo que corre Operar',
  '~2 min': '~2 min',
  'Becoming a tenant': 'Nacer como tenant',
  'Eight stations, once. You can leave at any station and come back: everything lives on the ledger, so the setup resumes exactly where reality is — each segment turns green when the chain says so, never before.': 'Ocho estaciones, una vez. Puedes irte en cualquier estación y volver: todo vive en el ledger, así que el alta se retoma exactamente donde está la realidad; cada segmento se pone verde cuando la cadena lo dice, nunca antes.',
  'What you bring from home: your omnibus (you already run one), your Xaman, your real licence, an EVM wallet for compliance, and your backend. What you create here: ONE new governing account, accredited, with its cage.': 'Lo que traes de casa: tu ómnibus (ya operas uno), tu Xaman, tu licencia real, una wallet EVM para cumplimiento y tu backend. Lo que creas aquí: UNA cuenta de gobierno nueva, acreditada, con su jaula.',
  'Which account is the exchange authority?': '¿Qué cuenta es la autoridad del exchange?',
  'Everything on this desk follows ONE XRPL account: credentials, constitution, cage and orders. Pick which of your connected Xaman wallets is the root.': 'Toda esta mesa sigue a UNA cuenta XRPL: credenciales, constitución, jaula y órdenes. Elige cuál de tus wallets Xaman conectadas es la raíz.',
  'No Xaman wallet connected yet — connect the new account from Wallets first.': 'Aún no hay ninguna wallet Xaman conectada: conecta primero la cuenta nueva desde Wallets.',
  'This account already governs a cage — the setup resumes where the ledger is.': 'Esta cuenta ya gobierna una jaula: el alta se retoma donde está el ledger.',
  'Pick the root account first (station 1).': 'Elige primero la cuenta raíz (estación 1).',
  'Set up': 'Configurar',
  'Become a tenant, station by station: root, credentials, constitution, registry, cage, pote, gate, desk': 'Nacer como tenant, estación a estación: raíz, credenciales, constitución, registro, jaula, pote, puerta, mesa',
  'The take, end to end: the exchange side, the client side, the curtain, the evidence': 'La toma, de punta a punta: el lado del exchange, el del cliente, la cortina, la evidencia',
  'Institutional (v1)': 'Institucional (v1)',
  'The first generation, kept for the record': 'La primera generación, conservada como acta',
  'Exchange stations': 'Estaciones del exchange',
  'Every station at once — the free path.': 'Todas las estaciones a la vez: la vía libre.',
  'One at a time': 'Una a una',
  'All stations': 'Todas las estaciones',
  'Notes = the short explanations inside each station. Off by default: the tour and the “Why” of each step carry the explanation; the free path stays clean.': 'Notas = las explicaciones cortas dentro de cada estación. Apagadas por defecto: el tour y el «Por qué» de cada paso llevan la explicación; la vía libre queda limpia.',
  'Your exchange on the rail': 'Tu exchange en el raíl',
  'The exchange brings its omnibus, creates ONE governing account, gets it accredited, births its cage and operates. Astryum does not sign, custody or decide: it lays the rail and the mechanical doors.': 'El exchange trae su ómnibus, crea UNA cuenta de gobierno, la acredita, pare su jaula y opera. Astryum no firma, no custodia ni decide: pone el raíl y las puertas mecánicas.',
  'Guided tour: on': 'Tour guiado: activo',
  'Guided tour': 'Tour guiado',
  'Simulated exchange, real chain': 'Exchange simulado, cadena real',
  'What is simulated': 'Qué es simulado',
  'The exchange system — client accounts, deposit tags, the internal ledger, the KYC verdict — lives in our backend and is labelled so. It custodies no key and signs nothing. Astryum plays the operator; no exchange uses this yet.': 'El sistema del exchange —cuentas de cliente, tags de depósito, el libro interno, el veredicto KYC— vive en nuestro backend y así se etiqueta. No custodia ninguna clave y no firma nada. Astryum hace de operador; ningún exchange lo usa aún.',
  'What is real': 'Qué es real',
  'Everything that touches capital: the council account and its constitution on XRPL, the cage and the pote on Flare, the FAssets mint, the council orders through the FDC, the client\'s passkey account and every exit. Each leaves a receipt you read from the chain.': 'Todo lo que toca capital: la cuenta del consejo y su constitución en XRPL, la jaula y el pote en Flare, el mint de FAssets, las órdenes de consejo por la FDC, la cuenta passkey del cliente y cada salida. Cada uno deja un recibo que se lee de la cadena.',
  'Who signs what': 'Quién firma qué',
  'The root (council) — in Xaman': 'La raíz (consejo): en Xaman',
  'The exchange authority: anchors the constitution, births the cage, opens the pote, points the gate, directs and recalls capital. One root governs one cage, for ever.': 'La autoridad del exchange: ancla la constitución, pare la jaula, abre el pote, apunta la puerta, dirige y recupera capital. Una raíz gobierna una jaula, para siempre.',
  'The omnibus — in Xaman, or its hot key': 'El ómnibus: en Xaman, o su hot key',
  'The deposit account the exchange already runs. It signs the put-to-work (a 0xFE payment) and every payout. With autopilot, its key on the exchange\'s own server does it — never on Astryum.': 'La cuenta de depósitos que el exchange ya opera. Firma el put-to-work (un pago 0xFE) y cada pago. Con autopilot lo hace su llave en el servidor del propio exchange, nunca en Astryum.',
  'The client — with Face ID': 'El cliente: con Face ID',
  'A passkey account on Flare, theirs alone, where the shares live from the first block. One signature takes everything out. They never see a wallet, gas or FLR.': 'Una cuenta passkey en Flare, solo suya, donde viven las participaciones desde el primer bloque. Una firma lo saca todo. Nunca ve una wallet, gas ni FLR.',
  'The compliance wallet — in MetaMask': 'La wallet de cumplimiento: en MetaMask',
  'Admin of the exchange\'s own KYC registry on Flare: it signs setApprovedWithTag for each client. The ledger carries the YES, never the NO.': 'Admin del registro KYC propio del exchange en Flare: firma setApprovedWithTag por cada cliente. El ledger lleva el SÍ, nunca el NO.',
  'What the exchange cannot do — and is the product': 'Lo que el exchange no puede hacer, y es el producto',
  'Touch a client\'s shares': 'Tocar las participaciones de un cliente',
  'They live in the client\'s passkey account. There is no approve from the client to the operator, ever — the shares inherit the standard, and only the client\'s signature redeems them.': 'Viven en la cuenta passkey del cliente. No hay approve del cliente al operador, jamás: las participaciones heredan el estándar y solo la firma del cliente las redime.',
  'Take capital out of the mandate': 'Sacar capital del mandato',
  'The cage only moves capital between listed venues, above the buffer floor, under the cap. Anything else reverts before it moves — the DENIED is recorded as proof. A new venue takes 30 days before a single token can go there.': 'La jaula solo mueve capital entre destinos listados, por encima del colchón y bajo el corte. Cualquier otra cosa revierte antes de moverse: el DENIED queda registrado como prueba. Un destino nuevo tarda 30 días antes de que un solo token pueda ir allí.',
  'Operate without credentials in force': 'Operar sin credenciales vigentes',
  'A revoked or expired licence freezes NEW orders of the root. The clients\' exits are never frozen.': 'Una licencia revocada o caducada congela las órdenes NUEVAS de la raíz. Las salidas de los clientes jamás se congelan.',
  'What Astryum never does': 'Lo que Astryum jamás hace',
  'It does not sign, custody, execute with discretion, issue the real title, administer any tenant\'s KYC registry, hold any omnibus, or decide who may be an exchange — an accredited issuer\'s credential decides, as a mechanical filter with zero discretion.': 'No firma, no custodia, no ejecuta con discreción, no emite el título real, no administra el registro KYC de ningún tenant, no sostiene ningún ómnibus ni decide quién puede ser exchange: lo decide la credencial de un emisor acreditado, como filtro mecánico y con cero discreción.',
  'The order of a take': 'El orden de una toma',
  'Set up: root, credentials, constitution, registry, cage, pote, gate, desk — once.': 'Configurar: raíz, credenciales, constitución, registro, jaula, pote, puerta, mesa; una vez.',
  'E3 · a client with a tag; the client sets up Face ID and deposits XRP (U0, U1).': 'E3 · un cliente con tag; el cliente configura Face ID y deposita XRP (U0, U1).',
  'E4 · the omnibus is scanned; E5 · the exchange puts the XRP to work — shares to the client.': 'E4 · se escanea el ómnibus; E5 · el exchange pone el XRP a trabajar: participaciones para el cliente.',
  'E6 · capital directed by council order; E7 · the cage says no on purpose.': 'E6 · capital dirigido por orden de consejo; E7 · la jaula dice que no a propósito.',
  'U4 · the client leaves with one Face ID; E8 · the exchange pays out to their wallet.': 'U4 · el cliente sale con un Face ID; E8 · el exchange le paga a su wallet.',
  'Evidence · every receipt read from the chain; the proof document.': 'Evidencia · cada recibo leído de la cadena; el documento de prueba.',
  'How the exchange desk works': 'Cómo funciona la mesa del exchange',
  'Read once; the tour and the “?” of every step repeat what matters, where it matters.': 'Léelo una vez; el tour y el «?» de cada paso repiten lo que importa, donde importa.',
  'First generation (a loose pote, v1), kept for the record and as a test bench. The live generation is the cage (v2) — the Operate room. Nothing here is faked: the contracts are live on Flare.': 'Primera generación (pote suelto, v1), conservada como acta y banco de pruebas. La generación viva es la jaula (v2): la sala Operar. Nada aquí es falso: los contratos están vivos en Flare.',
  'Proof': 'Prueba',
  'Done — read from the chain': 'Hecho: leído de la cadena',
  'You are here': 'Estás aquí',
  'Take me there': 'Llévame allí',
  'Learn more about this step': 'Saber más de este paso',
  'Why': 'Por qué',
  'Skip to the next pending': 'Saltar al siguiente pendiente',
  'Exit the tour — free path': 'Salir del tour: vía libre',
  'Open a take': 'Abre una toma',
  'One take = one council account, one omnibus account and one policy. Everything you do next hangs from it — and it stays listed with its receipts.': 'Una toma = una cuenta de consejo, una cuenta ómnibus y una política. Todo lo que hagas después cuelga de ella, y queda listada con sus recibos.',
  'The council XRPL account (r…) — the exchange authority, in Xaman': 'La cuenta XRPL del consejo (r…): la autoridad del exchange, en Xaman',
  'The omnibus XRPL account (r…) — where clients deposit with a tag': 'La cuenta XRPL ómnibus (r…): donde los clientes depositan con tag',
  'Optional: the KYC registry address on Flare (0x…)': 'Opcional: la dirección del registro KYC en Flare (0x…)',
  'A take is one recording of the whole circuit. A council account births exactly one cage on the factory, so a new take means a new council account; the omnibus can be reused.': 'Una toma es una grabación del circuito entero. Una cuenta de consejo pare exactamente una jaula en la factory, así que una toma nueva es una cuenta de consejo nueva; el ómnibus se puede reutilizar.',
  'Policy A opens a pote with immediate exit; policy B a pote with a 72-hour cooldown. Client tags are derived from the take number, so two takes on the same omnibus never collide.': 'La política A abre un pote con salida inmediata; la B, un pote con cooldown de 72 horas. Los tags de los clientes derivan del número de toma, así que dos tomas sobre el mismo ómnibus nunca chocan.',
  'Meet the authority': 'Conoce a la autoridad',
  'One XRPL account commands everything: it anchors the rules, births the cage and signs every order. Read the contracts here — what they permit and what they refuse is the product.': 'Una cuenta XRPL lo manda todo: ancla las reglas, pare la jaula y firma cada orden. Lee aquí los contratos: lo que permiten y lo que rechazan es el producto.',
  'A take is open': 'Hay una toma abierta',
  'The council is the exchange itself, as a signer: nothing moves capital without its signature in Xaman. Astryum only composes what it signs and never holds a key.': 'El consejo es el propio exchange, como firmante: nada mueve capital sin su firma en Xaman. Astryum solo compone lo que firma y jamás tiene una clave.',
  'The four contracts on the page are live on Flare. The vault has no function to extract the principal; the bridge only executes orders proven by the FDC; the registry holds approved accounts and their tag; the passkey factory gives each client an account of their own.': 'Los cuatro contratos de la página están vivos en Flare. El vault no tiene función para extraer el principal; el bridge solo ejecuta órdenes probadas por la FDC; el registro guarda cuentas aprobadas y su tag; la factory de passkeys da a cada cliente una cuenta propia.',
  'Anchor the constitution': 'Ancla la constitución',
  'Paste the governance text. Only its SHA-256 goes on the ledger, as a DIDSet signed by the council. The rules precede the code.': 'Pega el texto de gobierno. Solo su SHA-256 va al ledger, como DIDSet firmado por el consejo. Las reglas preceden al código.',
  'The council, in Xaman (DIDSet)': 'El consejo, en Xaman (DIDSet)',
  'Xaman connected as the council account': 'Xaman conectada como la cuenta del consejo',
  'The constitution text, or its SHA-256': 'El texto de la constitución, o su SHA-256',
  'The text itself never travels: the hash is computed in your browser and anchored on XRPL. Anyone can later verify that a document matches the anchored fingerprint.': 'El texto en sí nunca viaja: el hash se calcula en tu navegador y se ancla en XRPL. Cualquiera puede verificar después que un documento coincide con la huella anclada.',
  'Without the anchor the cage cannot be born — the backend refuses with CONSTITUTION_NOT_ANCHORED. The receipt is E1_ANCHOR, verified by reading the DID object of the council.': 'Sin el ancla la jaula no puede nacer: el backend rehúsa con CONSTITUTION_NOT_ANCHORED. El recibo es E1_ANCHOR, verificado leyendo el objeto DID del consejo.',
  'Birth the cage, then open the pote': 'Pare la jaula y abre el pote',
  'Two acts on one button: first the cage is born from a single 0xFE signature of the council; then a council order opens the pote inside it, with the venues Astryum has allowlisted.': 'Dos actos en un botón: primero nace la jaula de una sola firma 0xFE del consejo; después una orden de consejo abre el pote dentro, con los destinos de la whitelist de Astryum.',
  'The council, in Xaman — twice (0xFE, then a council order)': 'El consejo, en Xaman, dos veces (0xFE y después una orden de consejo)',
  'The constitution is anchored': 'La constitución está anclada',
  'Genesis XRP on the council account (the operator\'s own capital)': 'XRP de génesis en la cuenta del consejo (capital propio del operador)',
  'The cage is a Flare contract that obeys this council forever. It custodies nothing: the genesis XRP is fuel for the birth, and its shares stay with the council.': 'La jaula es un contrato en Flare que obedece a este consejo para siempre. No custodia nada: el XRP de génesis es gasolina para el nacimiento, y sus participaciones se quedan con el consejo.',
  'The pote opens by council order: XRPL payment with a memo → FDC proof → the bridge executes createPote. The relayer pays the proof; it cannot decide anything. Expect 2–5 minutes; the pote appears on its own.': 'El pote se abre por orden de consejo: pago XRPL con memo → prueba FDC → el bridge ejecuta createPote. El relayer paga la prueba; no puede decidir nada. Cuenta 2–5 minutos; el pote aparece solo.',
  'If the take carries a KYC registry, a second council order points the pote at it — from then on the tag of every exit is read on-chain, never typed.': 'Si la toma lleva registro KYC, una segunda orden de consejo apunta el pote hacia él: desde entonces el tag de cada salida se lee on-chain, nunca se teclea.',
  'Create a client': 'Crea un cliente',
  'Name the client and give them their own XRPL wallet if they have one. The exchange assigns a deposit tag. KYC is the exchange\'s business — publishing it on-chain is optional.': 'Ponle nombre al cliente y su wallet XRPL propia si la tiene. El exchange le asigna un tag de depósito. El KYC es negocio del exchange: publicarlo on-chain es opcional.',
  'Optional: the exchange admin wallet on Flare (MetaMask) for the on-chain registry': 'Opcional: la wallet admin del exchange en Flare (MetaMask) para el registro on-chain',
  'The pote is born': 'El pote ha nacido',
  'Optional: a KYC registry on the take': 'Opcional: un registro KYC en la toma',
  'The tag is what the omnibus watcher uses to credit a deposit to the right client — like any exchange. It lives in the simulated ledger, and optionally on-chain in the registry.': 'El tag es lo que usa el vigía del ómnibus para abonar un depósito al cliente correcto, como cualquier exchange. Vive en el libro simulado y, opcionalmente, on-chain en el registro.',
  'Publishing on-chain writes approved + tag into ExchangeKycRegistry with the admin wallet. It is what lets the client exit to their slot at the exchange with the tag read from the chain.': 'Publicar on-chain escribe aprobado + tag en ExchangeKycRegistry con la wallet admin. Es lo que permite al cliente salir a su casilla del exchange con el tag leído de la cadena.',
  'The XLS-70 credential ceremony is the on-ledger version of KYC: an issuer signs, the client accepts in Xaman. It leaves the E3_CREDENTIAL receipt on its own.': 'La ceremonia de credencial XLS-70 es la versión on-ledger del KYC: un emisor firma, el cliente acepta en Xaman. Deja el recibo E3_CREDENTIAL sola.',
  'The client sets up Face ID': 'El cliente configura Face ID',
  'Switch sides. Face ID once creates the client\'s on-chain account on Flare — where their shares will live, in their name. Then they open their exchange account or link the client you created.': 'Cambia de lado. Un Face ID crea la cuenta on-chain del cliente en Flare, donde vivirán sus participaciones a su nombre. Después abre su cuenta en el exchange o vincula el cliente que creaste.',
  'The client, with Face ID (passkey)': 'El cliente, con Face ID (passkey)',
  'A phone with Face ID or a fingerprint — a computer only if it offers somewhere to keep a P-256 key': 'Un móvil con Face ID o huella — un ordenador solo si ofrece dónde guardar una llave P-256',
  'At least one client on the take': 'Al menos un cliente en la toma',
  'The passkey account is a smart account on Flare controlled only by the client\'s biometrics. Astryum cannot use it; the relayer only pays its gas.': 'La cuenta passkey es una smart account en Flare controlada solo por la biometría del cliente. Astryum no puede usarla; el relayer solo paga su gas.',
  'Linking to a client the exchange created attaches this account to that tag. Opening a new one assigns a fresh tag.': 'Vincularla a un cliente creado por el exchange ata esta cuenta a ese tag. Abrir una nueva asigna un tag nuevo.',
  'The client deposits XRP': 'El cliente deposita XRP',
  'Ask for deposit instructions: destination, tag and amount. Sign from the connected Xaman or send it from any wallet — the watcher credits it when the ledger validates it.': 'Pide instrucciones de depósito: destino, tag e importe. Firma desde la Xaman conectada o envíalo desde cualquier wallet: el vigía lo abona cuando el ledger lo valida.',
  'The client, in Xaman (or any XRPL wallet)': 'El cliente, en Xaman (o cualquier wallet XRPL)',
  'The client has an on-chain account': 'El cliente tiene cuenta on-chain',
  'Some XRP in the client\'s own wallet': 'Algo de XRP en la wallet propia del cliente',
  'The deposit is a normal XRPL payment to the omnibus with a DestinationTag. The exchange ledger mirrors the chain: nothing is credited that the ledger did not validate.': 'El depósito es un pago XRPL normal al ómnibus con DestinationTag. El libro del exchange refleja la cadena: no se abona nada que el ledger no haya validado.',
  'For the exit later, leave room: the FAssets floor is 5 FXRP per redemption, so a take should deposit at least ~6 XRP.': 'Para la salida de después, deja margen: el suelo de FAssets es 5 FXRP por redención, así que una toma debería depositar al menos ~6 XRP.',
  'Back at the exchange: the watcher reads the omnibus and credits every deposit by tag. Read-only — it signs nothing.': 'De vuelta en el exchange: el vigía lee el ómnibus y abona cada depósito por tag. Solo lectura: no firma nada.',
  'A client deposit is on the ledger': 'Hay un depósito de cliente en el ledger',
  'The watcher lists the omnibus transactions, matches the DestinationTag to a client and credits the simulated ledger. It also recognises returns from FAssets (an exit with tag) and payouts.': 'El vigía lista las transacciones del ómnibus, casa el DestinationTag con un cliente y abona el libro simulado. También reconoce retornos de FAssets (una salida con tag) y pagos.',
  'With autopilot on, this scan runs on its own every 20 seconds.': 'Con autopilot encendido, este escaneo corre solo cada 20 segundos.',
  'The exchange backend (autopilot)': 'El backend del exchange (autopilot)',
  'What a real exchange already has: a backend with its hot key that fulfils client requests. Turn it on for the take and the deposit → shares path becomes one tap for the client.': 'Lo que un exchange real ya tiene: un backend con su hot key que atiende las peticiones de los clientes. Enciéndelo para la toma y el camino depósito → participaciones se convierte en un toque para el cliente.',
  'The omnibus seed on the server (DEMO_EXCHANGE_AUTOSIGN_ENABLED)': 'La seed del ómnibus en el servidor (DEMO_EXCHANGE_AUTOSIGN_ENABLED)',
  'The key belongs to the simulated exchange — never to Astryum, never to a client. It refuses by construction: only the Core Vault or a registered client wallet as destination, only its own clients as receivers, a per-payment cap and a daily cap.': 'La llave es del exchange simulado: nunca de Astryum, nunca de un cliente. Rehúsa por construcción: solo el Core Vault o la wallet registrada de un cliente como destino, solo sus propios clientes como receptores, un tope por pago y un tope diario.',
  'A signed 0xFE is never re-sent: it stays "signed" until the controller reports it consumed. Refusals are receipts with their reason.': 'Un 0xFE firmado nunca se reenvía: queda «firmado» hasta que el controlador lo da por consumido. Las negativas son recibos con su motivo.',
  'Put the client\'s XRP to work': 'Pon a trabajar el XRP del cliente',
  'The exchange signs from its omnibus; the shares are minted to the client\'s account from the first block. The client signs nothing. Expect 2–5 minutes for the mint.': 'El exchange firma desde su ómnibus; las participaciones se mintan a la cuenta del cliente desde el primer bloque. El cliente no firma nada. Cuenta 2–5 minutos para el mint.',
  'The omnibus, in Xaman (0xFE with a 42-byte memo)': 'El ómnibus, en Xaman (0xFE con memo de 42 bytes)',
  'Xaman connected as the omnibus account': 'Xaman conectada como la cuenta ómnibus',
  'The client has an on-chain account and XRP at the exchange': 'El cliente tiene cuenta on-chain y XRP en el exchange',
  'Mode B, custodial: the omnibus pays the FAssets Core Vault with a 0xFE memo; the executor mints FXRP and deposits into the pote naming the client account as receiver. The ledger debits the client.': 'Modo B, custodial: el ómnibus paga al Core Vault de FAssets con un memo 0xFE; el ejecutor minta FXRP y deposita en el pote nombrando la cuenta del cliente como receptor. El libro debita al cliente.',
  'The receipt is E5_PUT_TO_WORK; the client sees the shares in their position when the mint lands.': 'El recibo es E5_PUT_TO_WORK; el cliente ve las participaciones en su posición cuando aterriza el mint.',
  'Direct the capital': 'Dirige el capital',
  'Send capital to a listed venue, or recall it to the buffer, by council order: XRPL → FDC → bridge. The council governs; the venues are the allowlist.': 'Manda capital a un destino listado, o recupéralo al colchón, por orden de consejo: XRPL → FDC → bridge. El consejo gobierna; los destinos son la whitelist.',
  'The council, in Xaman (a council order)': 'El consejo, en Xaman (una orden de consejo)',
  'Capital inside the pote (E5 landed)': 'Capital dentro del pote (E5 aterrizado)',
  'A council order is an XRPL payment with a memo the bridge understands. The FDC attests it; the relayer pays the proof and calls the bridge; the bridge checks the nonce and executes directTo or recall on the cage.': 'Una orden de consejo es un pago XRPL con un memo que el bridge entiende. La FDC lo atesta; el relayer paga la prueba y llama al bridge; el bridge comprueba el nonce y ejecuta directTo o recall en la jaula.',
  'The on-chain reading is bridge.consumedTxId — that is what the receipt E6_ORDER is verified against. Expect 2–5 minutes.': 'La lectura on-chain es bridge.consumedTxId: contra eso se verifica el recibo E6_ORDER. Cuenta 2–5 minutos.',
  'Make the cage say no': 'Haz que la jaula diga que no',
  'Now break the rules on purpose: more than the cap, below the buffer floor, or an unlisted venue. The cage refuses before anyone signs — and the refusal is the proof.': 'Ahora rompe las reglas a propósito: más del corte, por debajo del colchón, o un destino no listado. La jaula rehúsa antes de que nadie firme, y la negativa es la prueba.',
  'Any amount above the cap, or a venue id that is not listed': 'Cualquier importe por encima del corte, o un id de destino no listado',
  'There is no other door: the mandate only moves capital between listed venues, above the buffer floor, under the cap. The refusal is recorded as E7_DENIED with its reason — a receipt without a transaction.': 'No hay otra puerta: el mandato solo mueve capital entre destinos listados, por encima del colchón y bajo el corte. La negativa queda registrada como E7_DENIED con su motivo: un recibo sin transacción.',
  'This is the moment the demo exists for: the robbery is impossible by bytecode, not by trust.': 'Este es el momento para el que existe la demo: el robo es imposible por bytecode, no por confianza.',
  'The client leaves with one Face ID': 'El cliente sale con un Face ID',
  'Switch sides again. One signature redeems the shares and sends the XRP back — to their slot at the exchange with their tag, to their own wallet, or kept as FXRP. Nobody can stop it.': 'Cambia de lado otra vez. Una firma redime las participaciones y devuelve el XRP: a su casilla del exchange con su tag, a su propia wallet, o se lo queda en FXRP. Nadie puede impedirlo.',
  'The client, with Face ID (one batch)': 'El cliente, con Face ID (un solo lote)',
  'Shares in the client\'s account (E5 landed)': 'Participaciones en la cuenta del cliente (E5 aterrizado)',
  'At least ~6 XRP of value inside (FAssets floor: 5 FXRP)': 'Al menos ~6 XRP de valor dentro (suelo de FAssets: 5 FXRP)',
  'To the exchange = redeem + redeemWithTag in ONE signature; the tag comes from the registry on-chain, not typed. To their wallet = redeem + unmint. On a cooldown pote (policy B) the shares burn now and the amount is claimed when the clock ends.': 'Al exchange = redeem + redeemWithTag en UNA firma; el tag sale del registro on-chain, no se teclea. A su wallet = redeem + unmint. En un pote con cooldown (política B) las participaciones se queman ahora y el importe se cobra cuando acaba el reloj.',
  'The relayer pays gas and cannot decide. The receipt is U4_EXIT or U4_EXIT_XRP, verified on Flare; the return with tag shows up on the omnibus scan.': 'El relayer paga el gas y no puede decidir. El recibo es U4_EXIT o U4_EXIT_XRP, verificado en Flare; el retorno con tag aparece en el escaneo del ómnibus.',
  'The exchange\'s normal withdrawal rail: a real XRPL payment from the omnibus to the client\'s own wallet, refused by the ledger if it cannot cover it.': 'El raíl normal de retirada del exchange: un pago XRPL real del ómnibus a la wallet propia del cliente, rehusado por el libro si no lo cubre.',
  'The omnibus, in Xaman (an XRPL payment)': 'El ómnibus, en Xaman (un pago XRPL)',
  'The client has an XRPL wallet on file': 'El cliente tiene wallet XRPL registrada',
  'The client can request the withdrawal from their side; with autopilot on, the backend pays it on its next tick. The watcher records the payout as E8_WITHDRAW when the payment validates.': 'El cliente puede pedir la retirada desde su lado; con autopilot encendido, el backend la paga en su siguiente tick. El vigía registra el pago como E8_WITHDRAW cuando el pago se valida.',
  'Each receipt is a hash and a promise. Reading the chain measures the promise — then export the proof document.': 'Cada recibo es un hash y una promesa. Leer la cadena mide la promesa; después, exporta el documento de prueba.',
  'Receipts on the take': 'Recibos en la toma',
  'The backend never marks anything done by itself: every check is read from XRPL or Flare on demand. A failed check says why. The proof document is the same book, as markdown.': 'El backend nunca da nada por hecho por sí mismo: cada comprobación se lee de XRPL o Flare bajo demanda. Una comprobación fallida dice por qué. El documento de prueba es el mismo libro, en markdown.',
  // El gráfico v2 del Portfolio: scrub y tooltip.
  'vs start': 'vs inicio',
  // El export de Actividad es la pantalla.
  'Nothing to export in this window.': 'No hay nada que exportar en esta ventana.',
  'Exports exactly the list you see — same wallets, dates and types, one file. Astryum reports data; the filing is your advisor’s job.':
    'Exporta exactamente la lista que ves — mismas wallets, fechas y tipos, un solo fichero. Astryum reporta datos; la declaración es cosa de tu asesor.',
  'Carry — using': 'Carry — usas el',
  '% of your borrowing capacity': '% de tu capacidad de préstamo',
  'No saved conversations yet.': 'Aún no hay conversaciones guardadas.',
  'messages': 'mensajes',
  'Only in this browser — conversations delete themselves after 30 days. Cards with live numbers are not restored; ask again for fresh figures.':
    'Solo en este navegador — las conversaciones se borran solas a los 30 días. Las tarjetas con números vivos no se restauran; pide cifras frescas de nuevo.',
  'I have 10,000 XRP and need $200 without selling': 'Tengo 10.000 XRP y quiero sacar $200 sin vender',
  'Which option has the least risk?': '¿Cuál es la opción con menos riesgo?',
  'Send 5 XRP from my Xaman to my Flare wallet': 'Envía 5 XRP de mi Xaman a mi wallet de Flare',
  'Make my FXRP earn with no debt': 'Pon mis FXRP a rentar sin deuda',
  'What is the current Kinetic supply rate?': '¿Cuál es el tipo de supply actual de Kinetic?',
  'How much could I borrow against 1,000 XRP?': '¿Cuánto podría pedir prestado contra 1.000 XRP?',
  'What price would liquidate me?': '¿A qué precio me liquidaría?',
  // La forma corta del sub de tipología — la que renderiza EarnCatalog vía
  // t(ty.sub) dinámico (invisible para la auditoría): faltaba en ES y la
  // sección salía en inglés. Ahora también la usan puerta y tour.
  'Lend, stake, delegate or deposit in a vault — no debt, nothing that can be liquidated.':
    'Presta, haz stake, delega o deposita en una bóveda — sin deuda, nada que pueda liquidarse.',
  'Lend, stake, delegate or deposit in a vault — no debt, nothing that can be liquidated. The agent for this menu lives inside.':
    'Presta, haz stake, delega o deposita en una bóveda — sin deuda, nada que pueda liquidarse. El agente de este menú vive dentro.',
  'Your tokens stay as collateral and you borrow against them — this one can be liquidated. Its own agent lives inside.':
    'Tus tokens se quedan como colateral y pides prestado contra ellos — esto sí puede liquidarse. Su propio agente vive dentro.',
  'Strategies with no debt: lend, stake, delegate or deposit in a vault. Open one to see exactly what it does before you sign — and the agent inside this menu compiles one from your words.':
    'Estrategias sin deuda: presta, haz stake, delega o deposita en una bóveda. Abre una para ver exactamente qué hace antes de firmar — y el agente de este menú compila una a partir de tus palabras.',
  'Borrow against your tokens without selling them — what can be liquidated is said before you sign. This menu carries its own agent too.':
    'Pide prestado contra tus tokens sin venderlos — lo que puede liquidarse se dice antes de firmar. Este menú lleva también su propio agente.',
  'The agent, tuned for earning': 'El agente, afinado para rendir',
  'The agent, tuned for borrowing': 'El agente, afinado para pedir prestado',
  'Describe what your tokens should do — it compiles a no-debt strategy you review and sign. It never signs for you.':
    'Describe qué tienen que hacer tus tokens — compila una estrategia sin deuda que tú revisas y firmas. Nunca firma por ti.',
  'Describe the cash you need without selling — it compiles the loan for your review and signature. It never signs for you.':
    'Describe el dinero que necesitas sin vender — compila el préstamo para tu revisión y tu firma. Nunca firma por ti.',
  'Lend, stake or deposit in a vault — no debt, nothing that can be liquidated.':
    'Prestar, hacer staking o depositar en una vasija — sin deuda, nada que puedan liquidar.',
  'Get cash without selling': 'Sacar dinero sin vender',
  'Your tokens stay as collateral and you borrow against them — this one can be liquidated.':
    'Tus tokens quedan como aval y pides prestado contra ellos — esta sí puede liquidarse.',
  'Back the network and get paid': 'Apoyar la red y cobrar por ello',
  'Delegate to the FTSO — the tokens never leave your wallet.':
    'Delegar en el FTSO — los tokens no salen de tu wallet.',
  // Activos (el segundo paso)
  'In Xaman/XRPL, or already as FXRP on Flare': 'En Xaman/XRPL, o ya como FXRP en Flare',
  'The Flare network token, in an EVM wallet': 'El token de la red Flare, en una wallet EVM',
  'Ripple’s stablecoin, on Ethereum': 'La stablecoin de Ripple, en Ethereum',
  // El menú de orden
  'Default order': 'Orden por defecto',
  'Current rate': 'Tipo actual',
  'Without debt first': 'Sin deuda primero',
  // ('Market' ya existe arriba.)
  // Rutas hermanas (mismo mercado)
  'same market': 'mismo mercado',
  shared: 'compartido',
  See: 'Ver',
  'Same route as the carry, minus its last step: there you also borrow USDT0 against this same deposit.':
    'La misma ruta que el carry, menos su último paso: allí además pides USDT0 prestado contra este mismo depósito.',
  'Same route as lend-only, plus one step: the deposit is identical, and here you borrow USDT0 against it.':
    'La misma ruta que la de solo prestar, más un paso: el depósito es idéntico, y aquí pides USDT0 prestado contra él.',
  'The other side of this same market: the RLUSD you borrow here is the RLUSD someone lends in the other route.':
    'La otra cara de este mismo mercado: el RLUSD que pides prestado aquí es el que alguien presta en la otra ruta.',
  'The other side of this same market: the RLUSD you lend here is what someone borrows in the other route.':
    'La otra cara de este mismo mercado: el RLUSD que prestas aquí es el que alguien pide prestado en la otra ruta.',

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
  // Settings › Preferences — fila de idioma (mudada del sidebar)
  'Texts and number formats.': 'Los textos y el formato de los números.',
  // ── Cierre auditoría silenciosos: bandeja del ledger (G1), cancel de Xaman y los dos modales de vault ──
  '— we could not re-read it afterwards, so treat it as an estimate; your position shows the exact one.':
    '— no pudimos releerla después, así que tómala como estimación; tu posición muestra la exacta.',
  'a Claim button appears on your position when it is ready.':
    'aparecerá un botón de Reclamar en tu posición cuando esté lista.',
  'A ledger hash is 64 hexadecimal characters — copy it from the explorer.':
    'Un hash del ledger son 64 caracteres hexadecimales — cópialo del explorador.',
  'Available to claim from':
    'Disponible para reclamar desde',
  'Available to claim from (estimated)':
    'Disponible para reclamar desde (estimado)',
  'Cancelling… (press again to stop waiting)':
    'Cancelando… (pulsa otra vez para dejar de esperar)',
  'Check before composing again':
    'Compruébalo antes de volver a componer',
  'Claim settled — the FXRP is in your Smart Account on Flare.':
    'Reclamación liquidada — el FXRP está en tu Smart Account de Flare.',
  'Close and refresh my positions':
    'Cerrar y actualizar mis posiciones',
  'Close anyway':
    'Cerrar de todos modos',
  'could not be read on-chain':
    'no se pudo leer on-chain',
  'Fee charged by the vault':
    'Comisión que cobra la bóveda',
  'Firelight does NOT pay instantly: this redeem burns your stXRP now and queues the FXRP into a ~24h withdrawal period. Nothing arrives in this transaction — your position will keep showing the FXRP in flight with a Claim button, and one click releases it when the period ends (you see the estimated date before signing; the vault fixes the exact one when the exit is queued).':
    'Firelight NO paga al instante: este rescate quema tu stXRP ahora y mete el FXRP en un periodo de retirada de ~24 h. En esta transacción no llega nada — tu posición seguirá mostrando el FXRP en vuelo con un botón de Reclamar, y un clic lo libera cuando termine el periodo (ves la fecha estimada antes de firmar; la bóveda fija la exacta cuando se encola la salida).',
  'It IS in the explorer — record its hash':
    'SÍ está en el explorador — registra su hash',
  'It is NOT in the explorer — file it (proposer only)':
    'NO está en el explorador — archívala (solo quien la propuso)',
  'none for this release':
    'ninguna por esta liberación',
  'not quoted in this prepare':
    'no cotizada en esta preparación',
  'Open this account in the explorer':
    'Abrir esta cuenta en el explorador',
  'Paste the hash of the transaction you found. This records it here — we are not verifying it for you.':
    'Pega el hash de la transacción que encontraste. Esto lo registra aquí — no la estamos verificando por ti.',
  'quoted by your wallet before you approve':
    'la cotiza tu wallet antes de que apruebes',
  'Record this hash':
    'Registrar este hash',
  'Request registered. Reading the exact release date from the vault…':
    'Solicitud registrada. Leyendo de la bóveda la fecha exacta de liberación…',
  'Request registered. The date read before you signed was':
    'Solicitud registrada. La fecha que leímos antes de que firmaras era',
  'Request registered. Your money enters the exit queue — we could not read the release date; a Claim button appears on your position when it is ready.':
    'Solicitud registrada. Tu dinero entra en la cola de salida — no pudimos leer la fecha de liberación; aparecerá un botón de Reclamar en tu posición cuando esté lista.',
  'Request registered. Your money will be available on':
    'Solicitud registrada. Tu dinero estará disponible el',
  'The account already used this proposal’s seat, so this transaction MAY have executed. Nobody can broadcast it again — but do NOT compose it again until you have checked.':
    'La cuenta ya usó el asiento de esta propuesta, así que esta transacción PUDO ejecutarse. Nadie puede volver a difundirla — pero NO la compongas de nuevo hasta haberlo comprobado.',
  'The order went to Xaman and we could not read what happened next. Do NOT sign it again: a second dispatch pays a second carrier fee in XRP and takes a second nonce seat. Check your XRPL account and your position first.':
    'La orden salió hacia Xaman y no pudimos leer qué pasó después. NO la firmes otra vez: un segundo envío paga una segunda comisión de transporte en XRP y ocupa un segundo asiento de nonce. Comprueba antes tu cuenta XRPL y tu posición.',
  'The order went to Xaman and we could not read what happened next. Do NOT sign it again: a second dispatch pays a second carrier fee in XRP, takes a second nonce seat and would take a second amount out of the vault. Check your XRPL account and your position first.':
    'La orden salió hacia Xaman y no pudimos leer qué pasó después. NO la firmes otra vez: un segundo envío paga una segunda comisión de transporte en XRP, ocupa un segundo asiento de nonce y sacaría un segundo importe de la bóveda. Comprueba antes tu cuenta XRPL y tu posición.',
  'The transaction was sent to your wallet and we could not read its receipt. Do NOT sign it again — a second signature would take a second amount out of the vault. Check it on the explorer and reload your position.':
    'La transacción se envió a tu wallet y no pudimos leer su recibo. NO la firmes otra vez — una segunda firma sacaría un segundo importe de la bóveda. Compruébala en el explorador y recarga tu posición.',
  'The transaction was sent to your wallet and we could not read its receipt. Do NOT sign it again — check it on the explorer and reload your position.':
    'La transacción se envió a tu wallet y no pudimos leer su recibo. NO la firmes otra vez — compruébala en el explorador y recarga tu posición.',
  'The withdrawal period ended — this releases the FXRP into your Smart Account on Flare. Astryum charges nothing for this release, but the dispatch is mint-coupled: it pays a minting fee and an executor fee in XRP. The exact figures are shown before you sign.':
    'El periodo de retirada terminó — esto libera el FXRP en tu Smart Account de Flare. Astryum no cobra nada por esta liberación, pero el envío va acoplado al minteo: paga una comisión de minteo y una de executor en XRP. Las cifras exactas se muestran antes de que firmes.',
  'The withdrawal period ended — this releases the FXRP straight to your wallet. The only cost is the network fee (cents; your wallet shows the exact figure before signing). Astryum charges nothing for this release.':
    'El periodo de retirada terminó — esto libera el FXRP directo a tu wallet. El único coste es la comisión de red (céntimos; tu wallet muestra la cifra exacta antes de firmar). Astryum no cobra nada por esta liberación.',
  'Transaction hash (64 hexadecimal characters)':
    'Hash de la transacción (64 caracteres hexadecimales)',
  'We could not cancel this request in Xaman. It stays signable on your phone until the code expires — open Xaman and decline it there.':
    'No pudimos cancelar esta petición en Xaman. Sigue siendo firmable en tu móvil hasta que caduque el código — abre Xaman y recházala ahí.',
  'We could not confirm your signature':
    'No pudimos confirmar tu firma',
  'We could not quote the minting and executor fees of this dispatch — they are missing from the disclosure above, not zero. Check the exact amount in Xaman before you approve.':
    'No pudimos cotizar las comisiones de minteo y de executor de este envío — faltan en el desglose de arriba, no son cero. Comprueba el importe exacto en Xaman antes de aprobar.',
  'We could not read the XRP Ledger, so we do not know whether this proposal executed. That is a failure of ours, not a verdict — check it before composing anything again.':
    'No pudimos leer el XRP Ledger, así que no sabemos si esta propuesta se ejecutó. Es un fallo nuestro, no un veredicto — compruébalo antes de volver a componer nada.',
  'We did not get an answer from Xaman, so we cannot confirm this request is dead. It may still be signable on your phone — open Xaman and decline it there.':
    'No obtuvimos respuesta de Xaman, así que no podemos confirmar que esta petición esté muerta. Puede seguir siendo firmable en tu móvil — abre Xaman y recházala ahí.',
  'What the wallet reported:':
    'Lo que informó la wallet:',
  // ── Ronda 3 del cierre: asiento sin resolver, cancel de Xaman y la fecha real de salida del vault ──
  'and your exit joins the next one, so the FXRP is released after that — your position shows the exact date.':
    'y tu salida entra en el siguiente, así que el FXRP se libera después de esa fecha — tu posición muestra la exacta.',
  'checking…':
    'comprobando…',
  'Current withdrawal period ends':
    'El periodo de retirada actual termina',
  'Firelight does NOT pay instantly: this redeem burns your stXRP now and queues the FXRP into a ~24h withdrawal period. Nothing arrives in this transaction — your position will keep showing the FXRP in flight with a Claim button, and one click releases it when the period ends (the vault fixes the exact date when the exit is queued, and your position shows it).':
    'Firelight NO paga al instante: este rescate quema tu stXRP ahora y mete el FXRP en un periodo de retirada de ~24 h. En esta transacción no llega nada — tu posición seguirá mostrando el FXRP en vuelo con un botón de Reclamar, y un clic lo libera cuando termine el periodo (la bóveda fija la fecha exacta cuando se encola la salida, y tu posición la muestra).',
  'Go to the inbox to resolve it':
    'Ve a la bandeja para resolverla',
  'If it was signed, it is already on its way to the network — check your activity before signing again.':
    'Si se firmó, ya va camino de la red — comprueba tu actividad antes de volver a firmar.',
  'It is NOT in the explorer — file it':
    'NO está en el explorador — archívala',
  'Its last run FAILED before it was paused — it produced nothing to sign.':
    'Su último disparo FALLÓ antes de pausarla — no produjo nada que firmar.',
  'Prepare it again with fresh numbers — signing the same payload would be rejected the same way.':
    'Prepárala otra vez con cifras frescas — firmar el mismo payload se rechazaría igual.',
  'Request registered. We could not re-read the release date: the withdrawal period that was running when you signed ends on':
    'Solicitud registrada. No pudimos releer la fecha de liberación: el periodo de retirada que corría cuando firmaste termina el',
  'This field only takes a whole number — a value the vault cannot read as an integer arrives as 0, which composes an order nobody typed.':
    'Este campo solo admite un número entero — un valor que la bóveda no puede leer como entero llega como 0, y eso compone una orden que nadie escribió.',
  'This proposal never reached its quorum, so no complete transaction was ever assembled from it here. Any member can file it — after checking the account.':
    'Esta propuesta nunca alcanzó su quórum, así que aquí jamás se ensambló una transacción completa a partir de ella. Cualquier miembro puede archivarla — después de comprobar la cuenta.',
  'unknown':
    'desconocido',
  'unresolved':
    'sin resolver',
  'unresolved — the account already used its seat, so this MAY have executed':
    'sin resolver — la cuenta ya usó su asiento, así que esto PUDO ejecutarse',
  'unresolved — we could not read the ledger, so we do not know whether it executed':
    'sin resolver — no pudimos leer el ledger, así que no sabemos si se ejecutó',
  'Xaman had already answered this request before we could cancel it — it may have been signed on your phone. Open Xaman to see what happened.':
    'Xaman ya había respondido a esta petición antes de que pudiéramos cancelarla — puede haberse firmado en tu móvil. Abre Xaman para ver qué pasó.',
  'Your exit joins the NEXT withdrawal period, so the FXRP is released after that date, not on it. The vault fixes the exact date when the exit is queued, and your position shows it.':
    'Tu salida entra en el SIGUIENTE periodo de retirada, así que el FXRP se libera después de esa fecha, no en ella. La bóveda fija la fecha exacta cuando se encola la salida, y tu posición la muestra.',
  // Recibir con plegado funcional: el activo elige la pata
  'Which asset will you receive?': '¿Qué activo vas a recibir?',
  'FXRP lives on Flare, so it lands in this wallet’s Smart Account — operated from your own XRPL account. Same capital, shown inside this wallet.':
    'El FXRP vive en Flare, así que aterriza en la Smart Account de esta wallet — operada desde tu propia cuenta XRPL. El mismo capital, mostrado dentro de esta wallet.',
  // ── Rechazos del servidor legibles en la ceremonia del consejo ──
  'A previous proposal on this account is not settled yet, and composing another one now is how a council pays twice. Open the proposal inbox: register the transaction hash it produced, or file it — then compose again.':
    'Una propuesta anterior de esta cuenta todavía no está saldada, y componer otra ahora es como un consejo paga dos veces. Abre la bandeja de propuestas: registra el hash de la transacción que produjo, o archívala — y entonces compón de nuevo.',
  'The server refused this and did not explain why.':
    'El servidor lo rechazó y no explicó por qué.',
  // ── El carril del dinero: «ya salió, no lo firmes otra vez» ──
  'This council’s seat is committed to the sitting above':
    'El asiento de este consejo está comprometido con la sesión de arriba',
  'We could not confirm this council’s seat was handed back':
    'No pudimos confirmar que el asiento de este consejo haya quedado libre',
  'The council’s proposals could not be read.':
    'No se pudieron leer las propuestas del consejo.',
  'The operation was sent to your wallet and we could not confirm how it ended. Do NOT sign it again — it may already be on the chain, in full or in part. Check it on the explorer and reload your position.':
    'La operación se envió a tu wallet y no pudimos confirmar cómo terminó. NO la firmes otra vez — puede estar ya en la cadena, entera o en parte. Compruébala en el explorador y recarga tu posición.',
  'What we know so far:':
    'Lo que sabemos hasta ahora:',
  'Do NOT sign it again — it may already be on the chain. Check the explorer and reload your position before doing anything else.':
    'NO la firmes otra vez — puede estar ya en la cadena. Comprueba el explorador y recarga tu posición antes de hacer nada más.',
  'Do NOT sign it again — signing the same operation would repeat steps that are already out of your hands. Check the explorer and reload your position before doing anything else.':
    'NO la firmes otra vez — firmar la misma operación repetiría pasos que ya no están en tu mano. Comprueba el explorador y recarga tu posición antes de hacer nada más.',
  'Do NOT sign it again — signing the same operation would repeat the steps that already landed. Check the explorer and reload your position before doing anything else.':
    'NO la firmes otra vez — firmar la misma operación repetiría los pasos que ya entraron. Comprueba el explorador y recarga tu posición antes de hacer nada más.',
  'Part of this operation already went out, and the rest did not complete.':
    'Parte de esta operación ya salió, y el resto no llegó a completarse.',
  'this step did not complete, and everything before it already went out.':
    'este paso no llegó a completarse, y todo lo anterior ya salió.',
  'of the batch was rejected by the network. The steps before it already went through — do NOT sign this again, it would repeat them. Check the explorer and reload your position.':
    'del lote fue rechazado por la red. Los pasos anteriores ya pasaron — NO firmes esto otra vez, los repetiría. Compruébalo en el explorador y recarga tu posición.',

  // ── Rail institucional: F1-F3 + consola del operador ─────────────
  'Institutional potes': 'Potes institucionales',
  'The manager can work the capital; it can never decide whether you may leave.':
    'El gestor puede trabajar el capital; no puede decidir si te deja salir.',
  'Demo: Astryum plays the operator — no exchange uses this yet.':
    'Demo: Astryum hace de operador — ningún exchange lo usa todavía.',
  'The institutional module is not enabled on this environment.':
    'El módulo institucional no está activado en este entorno.',
  Client: 'Cliente',
  Operator: 'Operador',
  'My exits': 'Mis salidas',
  'Conservative policy': 'Política conservadora',
  'Yield policy': 'Política de rendimiento',
  'FXRP lending on Kinetic (isolated market) — synchronous venues only.':
    'Préstamo de FXRP en Kinetic (mercado aislado) — solo venues síncronos.',
  'FXRP staking on Firelight — its venue queues exits in 24h periods.':
    'Staking de FXRP en Firelight — su venue encola las salidas en periodos de 24 h.',
  'FXRP across two venues — Kinetic (immediate) and Firelight staking (24h-period exit queue). The operator splits the capital between them.':
    'FXRP en dos venues — Kinetic (inmediato) y staking en Firelight (cola de salida de 24 h). El operador reparte el capital entre ambos.',

  // Recorrido guiado de 11 pasos + código de los contratos (para el vídeo)
  'Guided demo': 'Demo guiada',
  Both: 'Ambos',
  'The whole circuit, in order. Read the code at each step to see what can and cannot be done — then do it, and check it on the explorer. Nothing here is faked: the contracts are live on Flare.':
    'El circuito entero, en orden. Lee el código en cada paso para ver qué se puede y qué no — luego hazlo y compruébalo en el explorador. Nada de esto es falso: los contratos están vivos en Flare.',
  'The exchange connects its XRPL wallet': 'El exchange conecta su wallet XRPL',
  'The exchange operates through its XRPL council wallet (a multisig quorum). That wallet — and only it — will command the vaults it creates. It connects once.':
    'El exchange opera con su wallet-consejo XRPL (un quórum multisig). Esa wallet —y solo ella— mandará sobre los vaults que cree. Se conecta una vez.',
  'The contracts, and what each one permits — and does NOT': 'Los contratos, y qué permite cada uno — y qué NO',
  'These are the live contracts. The rules are enforced by the code, not by us — read them: this is what makes the guarantee true instead of a promise.':
    'Estos son los contratos vivos. Las reglas las hace cumplir el código, no nosotros — léelas: es lo que hace la garantía verdad en vez de promesa.',
  'The exchange creates its vault': 'El exchange crea su vault',
  'One signature of the council mints the genesis capital and deploys the vault. It obeys only this exchange, forever (bridge binding). Repeatable: another council address births another vault.':
    'Una firma del consejo mintea el capital génesis y despliega el vault. Obedece solo a este exchange, para siempre (binding del bridge). Repetible: otra dirección de consejo nace otro vault.',
  'The user creates their exchange account (Face ID)': 'El user se crea su cuenta del exchange (Face ID)',
  'The user\'s on-chain account: a Flare passkey (their XRP stays in the exchange)':
    'La cuenta on-chain del user: una passkey de Flare (su XRP se queda en el exchange)',
  'The user sets up a passkey (Face ID) — this is their ON-CHAIN account, where their SHARES will live, under their sole control. On a computer that offers nowhere to keep the key, open the page on their phone. Their XRP itself stays in the exchange as a tag/memo — off-chain, in the exchange\'s books, like any exchange balance. That is not created here; the exchange assigns it.':
    'El user configura una passkey (Face ID) — esta es su cuenta ON-CHAIN, donde vivirán sus SHARES, bajo su control exclusivo. En un ordenador que no ofrece dónde guardar la llave, abre la página en su móvil. Su XRP se queda en el exchange como un tag/memo — off-chain, en los libros del exchange, como cualquier saldo de exchange. Eso no se crea aquí; lo asigna el exchange.',
  'The exchange funds the position — IT signs (custodial, mode B)':
    'El exchange fondea la posición — firma ÉL (custodial, modo B)',
  'This is the custodial entry: the EXCHANGE takes the user\'s custodied XRP (their tag in the omnibus) and, with ONE signature, mints it to FXRP and deposits it into the pote — with the shares going to the USER\'s passkey account. The user does NOT sign the entry (they already trusted the exchange with their XRP); but the shares are theirs. Set the funding account to the exchange, and the receiver to the user\'s passkey.':
    'Esta es la entrada custodial: el EXCHANGE coge el XRP custodiado del user (su tag en el omnibus) y, con UNA firma, lo mintea a FXRP y lo deposita en el pote — con las shares yendo a la cuenta passkey del USER. El user NO firma la entrada (ya confió su XRP al exchange); pero las shares son suyas. Pon la cuenta que fondea = el exchange, y el receiver = la passkey del user.',
  'The shares are the user\'s — a distinct on-chain claim': 'Las shares son del user — un derecho on-chain distinto',
  'The exchange put the money in, but the shares landed in the USER\'s passkey account — a distinct ERC-20 claim on the pote, not a line in the exchange\'s books. From here only the user\'s signature can move or redeem them. The money can only work where the allowlist says.':
    'El exchange puso el dinero, pero las shares aterrizaron en la cuenta passkey del USER — un derecho ERC-20 distinto sobre el pote, no una línea en los libros del exchange. Desde aquí solo la firma del user las mueve o redime. El dinero solo puede trabajar donde diga el allowlist.',
  'The client sets up a passkey — the key lives on their device and only they control it. No camera? Use Windows Hello PIN, or your phone via the cross-device prompt. The account address is derived from the passkey and costs nothing until first use.':
    'El cliente configura una passkey — la llave vive en su dispositivo y solo él la controla. ¿Sin cámara? Usa el PIN de Windows Hello, o tu móvil por el aviso cross-device. La dirección de la cuenta se deriva de la passkey y no cuesta nada hasta el primer uso.',
  'KYC is validated (by the exchange)': 'Se valida el KYC (del exchange)',
  'The exchange runs its own KYC (simulated here) and records it two ways, both real on-chain: an XLS-70 credential on XRPL, and an entry in its ExchangeKycRegistry — the vault\'s on-chain gate. Until the client is approved, the vault refuses their deposit.':
    'El exchange hace su KYC (aquí simulado) y lo registra de dos formas, ambas reales on-chain: una credencial XLS-70 en XRPL, y una entrada en su ExchangeKycRegistry — la puerta on-chain del vault. Hasta que el cliente esté aprobado, el vault rechaza su depósito.',
  'The user funds their exchange account': 'El user fondea su cuenta del exchange',
  'The client\'s FXRP arrives in their account (in the demo, seeded via the 0xFE mint or a transfer from the exchange). This is the capital they will put to work.':
    'El FXRP del cliente llega a su cuenta (en la demo, sembrado por el mint 0xFE o una transferencia del exchange). Es el capital que pondrá a trabajar.',
  'The user puts assets into the vault — seeing the rules': 'El user mete assets en el vault — viendo las reglas',
  'The client deposits with one Face ID. The vault checks the KYC gate and mints them shares. They can read the allowlist and the rules first — the money can only work where the policy says.':
    'El cliente deposita con una Face ID. El vault comprueba la puerta KYC y le acuña participaciones. Puede leer el allowlist y las reglas primero — el dinero solo puede trabajar donde diga la política.',
  'The exchange puts the capital to work (only vault actions)': 'El exchange pone el capital a trabajar (solo acciones del vault)',
  'The operator directs the capital across the allowlisted venues — choosing how much in each — with the concentration cap and the buffer floor enforced. This console lets it do ONLY the vault\'s actions; there is no door to extract.':
    'El operador dirige el capital entre los venues del allowlist —eligiendo cuánto en cada uno— con el cap de concentración y el suelo del colchón forzados. Esta consola le deja hacer SOLO las acciones del vault; no hay puerta para extraer.',
  'The user holds shares': 'El user tiene participaciones',
  'The client\'s shares are a direct claim on the pote — theirs, on their own account, not a credit against the exchange. The yield raises their value; only their signature can redeem them.':
    'Las participaciones del cliente son un derecho directo sobre el pote — suyas, en su propia cuenta, no un crédito contra el exchange. El yield sube su valor; solo su firma puede redimirlas.',
  'The user exits, and sees the money arrive': 'El user sale, y ve llegar el dinero',
  'The client decides to take out — one Face ID. The vault unwinds the venues by itself; the money lands at the exchange\'s custodial address (its AML rails). Immediate for the conservative pote, on a clock for the yield one. Nobody can stop it.':
    'El cliente decide sacar — una Face ID. El vault desmonta los venues él solo; el dinero aterriza en la dirección custodiada del exchange (sus raíles AML). Inmediato en el pote conservador, con reloj en el de rendimiento. Nadie puede impedirlo.',
  'The user withdraws to their own wallet': 'El user retira a su propia wallet',
  'From the exchange, the client withdraws to their personal wallet by the exchange\'s normal flow (its own system — simulated in the demo). In the sovereign model they can also send straight out with Face ID.':
    'Desde el exchange, el cliente retira a su wallet personal por el flujo normal del exchange (su propio sistema — simulado en la demo). En el modelo soberano también puede enviar directo con Face ID.',
  'User area (Face ID) — steps 4, 6–11': 'Área de usuario (Face ID) — pasos 4, 6-11',
  // Entrada/salida atómicas XRP↔pote (0xFE)
  'Fund the pote with XRP (atomic)': 'Meter XRP en el pote (atómico)',
  'Fund the pote with XRP': 'Meter XRP en el pote',
  'One XRPL payment: the user\'s XRP is minted to FXRP and deposited into the pote in the same transaction. The shares go to the user\'s Flare account.':
    'Un pago XRPL: el XRP del user se mintea a FXRP y se deposita en el pote en la misma transacción. Las participaciones van a la cuenta Flare del user.',
  'Or, in one atomic move (steps 6+7 together): the client\'s XRP goes straight into the pote — minted to FXRP and deposited in a single XRPL payment, shares to their Flare account. On exit, the reverse: the redeemed FXRP unmints to XRP back to their XRPL memo.':
    'O, en un movimiento atómico (pasos 6+7 juntos): el XRP del cliente va directo al pote — minteado a FXRP y depositado en un solo pago XRPL, participaciones a su cuenta Flare. Al salir, al revés: el FXRP redimido se desmintea a XRP de vuelta a su memo XRPL.',
  'Funding XRPL address (signs)': 'Dirección XRPL que fondea (firma)',
  'Pote address': 'Dirección del pote',
  'User Flare account (receives the shares)': 'Cuenta Flare del user (recibe las participaciones)',
  'The funding XRPL address is not valid': 'La dirección XRPL que fondea no es válida',
  'The pote address is not valid': 'La dirección del pote no es válida',
  'The user Flare account is not valid': 'La cuenta Flare del user no es válida',
  'Compose the atomic funding': 'Componer el fondeo atómico',
  'Signed. The executor is minting your XRP and depositing it into the pote — usually 2–5 minutes.':
    'Firmado. El executor está minteando tu XRP y depositándolo en el pote — normalmente 2-5 minutos.',
  // Verbo unmint (salir a XRP con tag on-chain)
  'To XRP': 'A XRP',
  'Send to XRP with Face ID': 'Enviar a XRP con Face ID',
  'The XRPL destination address is not valid': 'La dirección XRPL de destino no es válida',
  'Exchange XRPL address (your XRP comes back here, with your tag)':
    'Dirección XRPL del exchange (tu XRP vuelve aquí, con tu tag)',
  'The destination tag comes from the exchange registry on-chain — not typed.':
    'El destination tag sale del registro del exchange on-chain — no se teclea.',
  // Anclar la constitución del consejo (DIDSet)
  'Anchor the council constitution': 'Anclar la constitución del consejo',
  'Anchor the constitution (DIDSet)': 'Anclar la constitución (DIDSet)',
  'Compose the anchor (DIDSet)': 'Componer el ancla (DIDSet)',
  'Council XRPL address — sign via council (leave empty to use the ceded EVM director)':
    'Dirección XRPL del consejo — firma por el consejo (déjalo vacío para usar el director EVM cedido)',
  'Sign the council order': 'Firmar la orden del consejo',
  'This pote has no ceded director, so an EVM signature would be refused by the contract. Fill in the council XRPL address above — directing capital is then a council order, signed in Xaman.':
    'Este pote no tiene director cedido, así que una firma EVM la rechazaría el contrato. Rellena arriba la dirección XRPL del consejo — dirigir capital es entonces una orden del consejo, firmada en Xaman.',
  'Signed. Executing on Flare now — the FDC proof takes ~2-5 min; the capital appears in the venue shortly.':
    'Firmado. Ejecutándose en Flare ahora — la prueba FDC tarda ~2-5 min; el capital aparece en el venue en breve.',
  'Signed, but the relay did not start': 'Firmado, pero el relay no arrancó',
  'Withdraw the creator’s genesis capital': 'Sacar el capital génesis del creador',
  'The genesis (the seed the council deposited at birth) lives in the council’s Personal Account and only the council can move it: its PA redeems its own shares via one 0xFE payment, signed by the council quorum in Xaman. Fill the council XRPL address above.':
    'El génesis (la semilla que el consejo depositó al nacer el pote) vive en la Personal Account del consejo y solo el consejo puede moverlo: su PA redime sus propias participaciones con un pago 0xFE, firmado por el quórum del consejo en Xaman. Rellena arriba la dirección XRPL del consejo.',
  'Mint carrier (XRP)': 'Carrier del mint (XRP)',
  'Withdraw genesis to the creator': 'Sacar el génesis al creador',
  'Retry, freeing the seat': 'Reintentar liberando el asiento',
  'Only if the previous 0xFE payment on this seat was never signed':
    'Solo si el pago 0xFE anterior de este asiento no llegó a firmarse',
  'Council XRPL address': 'Dirección XRPL del consejo',
  'Constitution SHA-256 (64 hex)': 'SHA-256 de la constitución (64 hex)',
  'Document URI (optional — IPFS/HTTPS)': 'URI del documento (opcional — IPFS/HTTPS)',
  'The council XRPL address is not valid': 'La dirección XRPL del consejo no es válida',
  'The constitution hash must be 64 hex characters (a SHA-256)':
    'El hash de la constitución debe ser 64 hex (un SHA-256)',
  'Constitution anchored. The council can now birth its vault.':
    'Constitución anclada. El consejo ya puede hacer nacer su vault.',
  'Constitute the exchange council here (SignerList) — the whole Legacy governance flow, in place. Once the council has its quorum, anchor its constitution and birth the pote in the Exchange tab.':
    'Constituye aquí el consejo del exchange (SignerList) — el flujo de gobierno Legacy entero, en su sitio. Cuando el consejo tenga su quórum, ancla su constitución y haz nacer el pote en la pestaña Exchange.',
  'Step 0 for the exchange: anchor the SHA-256 of the governance document on XRPL (DIDSet). The pote cannot be born without it. The document never travels — only its fingerprint.':
    'Paso 0 del exchange: ancla el SHA-256 del documento de gobierno en XRPL (DIDSet). El pote no puede nacer sin él. El documento nunca viaja — solo su huella.',
  'First the council anchors its constitution on XRPL (DIDSet) — the rules precede the code. Then one signature mints the genesis and deploys the vault. It obeys only this exchange, forever (bridge binding). Repeatable: another council address births another vault.':
    'Primero el consejo ancla su constitución en XRPL (DIDSet) — las reglas preceden al código. Luego una firma mintea el génesis y despliega el vault. Obedece solo a este exchange, para siempre (binding del bridge). Repetible: otra dirección de consejo nace otro vault.',
  // contractDocs — código de los contratos
  'The vault (ERC-4626): cages the capital and only moves it to a fixed list of venues.':
    'El vault (ERC-4626): enjaula el capital y solo lo mueve a una lista fija de venues.',
  'No function extracts the principal': 'Ninguna función extrae el principal',
  'The exchange cannot withdraw the capital to any address — the function does not exist.':
    'El exchange no puede sacar el capital a ninguna dirección — la función no existe.',
  'Nobody can take your capital out except you, through your own redemption.':
    'Nadie puede sacar tu capital salvo tú, por tu propia redención.',
  'The director moves capital only within a typed allowlist': 'El director mueve capital solo dentro de un allowlist tipado',
  'The exchange puts capital to work ONLY in venues on the allowlist, capped by concentration and above the idle buffer. No generic call, ever.':
    'El exchange pone capital a trabajar SOLO en venues del allowlist, con cap de concentración y por encima del colchón. Ningún call genérico, jamás.',
  'Your money can only work in the venues the policy names — nowhere else.':
    'Tu dinero solo puede trabajar en los venues que nombra la política — en ningún otro sitio.',
  'Redemption is the holder\'s, and unwinds by itself': 'La redención es del titular, y se desmonta sola',
  'The exchange cannot block, delay or redirect a client\'s exit. It is not needed for the client to leave.':
    'El exchange no puede bloquear, retrasar ni redirigir la salida de un cliente. No hace falta para que el cliente salga.',
  'You exit on your own signature; the vault unwinds the positions for you. The cooldown is the one you accepted at entry.':
    'Sales con tu propia firma; el vault desmonta las posiciones por ti. El plazo de espera es el que aceptaste al entrar.',
  'The on-chain KYC gate (entry only)': 'La puerta KYC on-chain (solo entrada)',
  'Only clients the exchange approved (its KYC\'d users) may receive shares. Set by council order. Entry only — never the exit.':
    'Solo los clientes que el exchange aprobó (sus usuarios con KYC) pueden recibir participaciones. La pone el consejo por orden. Solo entrada — nunca la salida.',
  'You can only enter if your exchange approved you (KYC). Leaving is never gated.':
    'Solo puedes entrar si tu exchange te aprobó (KYC). Salir nunca se gatea.',
  'The operator\'s cut is public and capped at birth': 'El corte del operador es público y con tope de nacimiento',
  'This pote is open to clients, so the exchange earns at most 20% of the YIELD — never the principal — at public bps fixed when the pote was born and unchangeable after. Astryum takes 0.':
    'Este pote está abierto a clientes, así que el exchange gana como mucho el 20% del YIELD —nunca el principal— con bps públicos fijados al nacer el pote e inalterables después. Astryum se lleva 0.',
  'The operator\'s cut is on-chain, capped, and was fixed before you entered; the rest of the yield is yours. Nobody takes a cut of your principal.':
    'El corte del operador es on-chain, tiene tope y quedó fijado antes de que entraras; el resto del yield es tuyo. Nadie se lleva un corte de tu principal.',
  'Makes "XRPL governs" literal: only the exchange\'s XRPL council can command its vault.':
    'Hace literal «XRPL gobierna»: solo el consejo XRPL del exchange puede mandar sobre su vault.',
  'Only THIS council\'s signed order executes': 'Solo ejecuta la orden firmada de ESTE consejo',
  'Only the wallet that created the vault (its XRPL council, proven by FDC) can operate it as the exchange. No other wallet, for ever.':
    'Solo la wallet que creó el vault (su consejo XRPL, probado por FDC) puede operarlo como exchange. Ninguna otra wallet, jamás.',
  'The exchange that controls your vault is fixed at birth and can never be swapped.':
    'El exchange que controla tu vault se fija al nacer y no se puede cambiar jamás.',
  'The exchange\'s on-chain list of its KYC\'d clients — the vault\'s user gate.':
    'La lista on-chain del exchange de sus clientes con KYC — la puerta de usuarios del vault.',
  'The exchange approves its own clients': 'El exchange aprueba a sus propios clientes',
  'The exchange marks a client approved (KYC done). Only it (the admin) can. This is the tag/memo of its own users, on-chain.':
    'El exchange marca a un cliente aprobado (KYC hecho). Solo él (el admin) puede. Es el tag/memo de sus propios usuarios, on-chain.',
  'You appear here only if your exchange KYC\'d you — that is what lets you into its vault.':
    'Apareces aquí solo si tu exchange te hizo el KYC — es lo que te deja entrar en su vault.',
  'The user\'s account on Flare, controlled by their passkey (Face ID). Only they can move it.':
    'La cuenta del usuario en Flare, controlada por su passkey (Face ID). Solo él puede moverla.',
  'One face, any action — and nobody else': 'Una cara, cualquier acción — y nadie más',
  'The exchange (its relayer) can only CARRY a signature the user already made — it can never move the user\'s money.':
    'El exchange (su relayer) solo puede PORTAR una firma que el usuario ya hizo — jamás puede mover el dinero del usuario.',
  'You approve every action with your face; the signature commits the exact calls. No wallet, no gas, and only you can sign.':
    'Apruebas cada acción con tu cara; la firma compromete las calls exactas. Sin wallet, sin gas, y solo tú puedes firmar.',
  'Exit: immediate': 'Salida: inmediata',
  'Exit: 3 days': 'Salida: 3 días',
  'In the pote': 'En el pote',
  'operator cut (public)': 'corte del operador (público)',
  'Live figures unavailable right now — the chain, not this page, is the truth.':
    'Cifras en vivo no disponibles ahora mismo — la verdad es la cadena, no esta página.',
  'Reading the pote…': 'Leyendo el pote…',
  'No policy potes are deployed on this environment yet.':
    'Aún no hay potes de política desplegados en este entorno.',
  Exit: 'Salir',
  'you choose the exit speed NOW, not when you need the money':
    'la velocidad de salida la eliges AHORA, no cuando necesites el dinero',
  'Amount to deposit (FXRP)': 'Cantidad a depositar (FXRP)',
  'Your XRPL root account (this pote requires a credential)':
    'Tu cuenta raíz XRPL (este pote exige credencial)',
  'Review deposit': 'Revisar el depósito',
  'Waiting for your wallet…': 'Esperando a tu wallet…',
  'Signed. Your shares appear once the receipt is read — never before.':
    'Firmado. Tus participaciones aparecen cuando se lea el recibo — nunca antes.',
  'Could not read your share balance — try again. Nothing was signed.':
    'No pude leer tu saldo de participaciones — reintenta. No se firmó nada.',
  'Your shares': 'Tus participaciones',
  'estimated value': 'valor estimado',
  'You hold no shares of this pote': 'No tienes participaciones de este pote',
  'Review exit': 'Revisar la salida',
  'Exit requested. Your ticket appears in “My exits” with its clock — anyone can complete the claim when it matures; nobody can stop it.':
    'Salida pedida. Tu ticket aparece en «Mis salidas» con su reloj — cualquiera puede completar el cobro al vencer; nadie puede impedirlo.',
  'Signed. The pote unwinds the venues inside your own transaction.':
    'Firmado. El pote desmonta los venues dentro de tu propia transacción.',
  'Claimable in': 'Cobrable en',
  'Not yet — this exit matures in': 'Aún no — esta salida vence en',
  'Could not read the pote — nothing to show is NOT “you have nothing”.':
    'No pude leer el pote — que no se vea nada NO es «no tienes nada».',
  'Connect your XRPL account (Xaman) to take capital back out to XRP in one signature.':
    'Conecta tu cuenta XRPL (Xaman) para sacar tu capital de vuelta a XRP con una sola firma.',
  'Connect your XRPL account (Xaman) to birth your cage, open potes and direct capital.':
    'Conecta tu cuenta XRPL (Xaman) para crear tu jaula, abrir potes y dirigir capital.',
  'Signed. The network is proving it; your cage will appear here on its own in a couple of minutes.':
    'Firmado. La red lo está probando; tu jaula aparecerá aquí sola en un par de minutos.',
  'Enter a positive amount.':
    'Introduce un importe positivo.',
  'Signed. Relaying the proof to Flare…':
    'Firmado. Llevando la prueba a Flare…',
  'Relayed. The cage will execute the order once the proof lands.':
    'Entregada. La jaula ejecutará la orden en cuanto llegue la prueba.',
  'Your cage':
    'Tu jaula',
  'Could not read the cage right now. This says nothing about whether it exists — try again in a moment.':
    'No se pudo leer la jaula ahora mismo. Eso no dice nada sobre si existe — inténtalo en un momento.',
  'This account has no cage yet. One signature births it: a command contract that obeys only this account and never holds capital. Its list of destinations is written once, here, and never changes.':
    'Esta cuenta aún no tiene jaula. Una firma la crea: un contrato de mando que obedece solo a esta cuenta y nunca guarda capital. Su lista de destinos se escribe una vez, aquí, y no cambia jamás.',
  'Carrier (XRP) — what it mints stays in your Flare account to pay pote creation fees':
    'Carrier (XRP) — lo que mintea queda en tu cuenta de Flare para pagar las fees de creación de potes',
  'Eternal destination list (each one must already be approved by the Astryum registry)':
    'Lista eterna de destinos (cada uno tiene que estar ya aprobado en el registro de Astryum)',
  // 'Remove' ya existe mas arriba con la misma traduccion — no se redefine (TS1117).
  'Add destination':
    'Añadir destino',
  'Prepare the birth':
    'Preparar el nacimiento',
  'Birth of the cage':
    'Nacimiento de la jaula',
  // ── Demo Exchange · E2 en generación v2 (X4) ──
  'Generation v2: first the CAGE is born (one 0xFE signature), then the pote opens by council order — same button, two acts.':
    'Generación v2: primero nace la JAULA (una firma 0xFE) y después el pote se abre por orden de consejo — mismo botón, dos actos.',
  'Birth the cage (one 0xFE signature)': 'Nacer la jaula (una firma 0xFE)',
  'Open the pote (council order)': 'Abrir el pote (orden de consejo)',
  'Predicted cage': 'Jaula prevista',
  'Still reading the council generation from the chain — try again in a second.':
    'Aún leyendo la generación del consejo de la cadena — prueba en un segundo.',
  'Signed. The cage is being proven and born on Flare (~2–5 min); then open the pote with a council order — same button.':
    'Firmado. La red está probando la jaula y nace en Flare (~2–5 min); después abre el pote con una orden de consejo — mismo botón.',
  'Birth of the CAGE (v2) — the pote follows by council order.':
    'Nacimiento de la JAULA (v2) — el pote viene después por orden de consejo.',
  'Council order signed. The relayer pays the FDC proof and the pote opens on Flare (~2–5 min); it will appear here on its own.':
    'Orden de consejo firmada. El relayer paga la prueba FDC y el pote se abre en Flare (~2–5 min); aparecerá aquí solo.',
  'The Astryum venue registry has no active venue for this policy on this chain — list it first in /app/admin/registry.':
    'El registro de venues de Astryum no tiene ningún venue activo para esta política en esta chain — dalo de alta primero en /app/admin/registry.',
  'Point the pote at the KYC registry (council order)': 'Apuntar el pote al registro KYC (orden de consejo)',
  'Could not read the council generation from the chain — the birth button waits, because "could not read" is never "no cage".':
    'No se pudo leer la generación del consejo en la cadena — el botón de nacimiento espera, porque «no pude leer» nunca es «no hay jaula».',
  'Retry the read': 'Reintentar la lectura',
  'Reading the council generation from the chain…': 'Leyendo la generación del consejo en la cadena…',
  'The registry must be a 0x address (deploy ExchangeKycRegistry first)':
    'El registro debe ser una dirección 0x (despliega ExchangeKycRegistry primero)',
  'Save the registry on this run (unlocks the on-chain gate)': 'Guardar el registro en este run (desbloquea la puerta on-chain)',
  'Pick the client first': 'Elige primero el cliente',
  'The wallet must be an XRPL r-address': 'La wallet debe ser una r-address XRPL',
  'Client without an XRPL wallet': 'Cliente sin wallet XRPL',
  'Their XRPL wallet (r…)': 'Su wallet XRPL (r…)',
  'Save the wallet (unlocks the payout)': 'Guardar la wallet (desbloquea el payout)',
  'Council order signed. The pote points at the KYC registry in ~2–5 min — the exit with the client tag has its on-chain source from then on.':
    'Orden de consejo firmada. El pote apunta al registro KYC en ~2–5 min — la salida con el tag del cliente tiene fuente on-chain desde entonces.',
  'The pote and the KYC registry must both exist first.':
    'Antes tienen que existir el pote y el registro KYC.',
  'Eternal destinations':
    'Destinos eternos',
  'Potes':
    'Potes',
  'This cage handed over to its successor and commands nothing more.':
    'Esta jaula pasó el testigo a su sucesora y ya no manda nada.',
  'Open a pote':
    'Abrir un pote',
  // 'Name' ya existe mas arriba con la misma traduccion — no se redefine (TS1117).
  'Symbol':
    'Símbolo',
  'Cooldown (s)':
    'Cooldown (s)',
  'A queued venue (Firelight) needs a cooldown of at least 72h (259200s): with less, a redeem ticket matures before the withdrawal queue drains and the claim reverts. Raise the cooldown or unselect the queued venue.':
    'Un venue encolado (Firelight) exige un cooldown de al menos 72h (259200s): con menos, un ticket de salida madura antes de que drene la cola de retirada y el cobro revierte. Sube el cooldown o desmarca el venue encolado.',
  'Buffer floor (bps)':
    'Suelo del colchón (bps)',
  'Payees cap (bps, ≤ 2000 for an open pote)':
    'Tope de payees (bps, ≤ 2000 en un pote abierto)',
  'Initial venues (from the eternal list; kind must match the contract)':
    'Venues iniciales (de la lista eterna; el tipo tiene que coincidir con el contrato)',
  'not at birth':
    'no al nacer',
  'Prepare the order':
    'Preparar la orden',
  'Direct capital':
    'Dirigir capital',
  'free buffer':
    'colchón libre',
  'base units':
    'unidades base',
  'not ready yet':
    'aún no listo',
  'Direct':
    'Dirigir',
  'Recall':
    'Recuperar',
  'Accepted. The ledger now recognises this credential as yours; it will show as valid here in a moment.':
    'Aceptada. El ledger ya reconoce esta credencial como tuya; aparecerá como válida aquí en un momento.',
  'Your credentials on the ledger':
    'Tus credenciales en el ledger',
  'What the XRP Ledger says this account holds. Astryum does not issue credentials and cannot accept them for you: accepting is your signature, and it is what makes a credential count.':
    'Lo que el XRP Ledger dice que sostiene esta cuenta. Astryum no emite credenciales ni puede aceptarlas por ti: aceptar es tu firma, y es lo que hace que una credencial valga.',
  'Could not read the ledger right now. This says nothing about your credentials — try again in a moment.':
    'No se pudo leer el ledger ahora mismo. Eso no dice nada sobre tus credenciales — inténtalo en un momento.',
  'This account holds no credentials yet. When an issuer grants you one, it will appear here to accept.':
    'Esta cuenta aún no sostiene credenciales. Cuando un emisor te conceda una, aparecerá aquí para aceptarla.',
  // 'expires' ya existe mas arriba con la misma traduccion — no se redefine (TS1117).
  'no expiry':
    'sin caducidad',
  'Accept in Xaman':
    'Aceptar en Xaman',
  'Read before you sign: a credential on the ledger ties an identity to this account, publicly and permanently. Accepting is irreversible in practice.':
    'Lee antes de firmar: una credencial en el ledger ata una identidad a esta cuenta, en público y para siempre. Aceptar es irreversible en la práctica.',
  'Accept credential':
    'Aceptar credencial',
  'valid':
    'válida',
  'pending your acceptance':
    'pendiente de tu aceptación',
  'expiring soon':
    'caduca pronto',
  // 'expired' ya existe mas arriba con la misma traduccion — no se redefine (TS1117).
  'unreadable':
    'ilegible',
  'An exit that shows no clock here may simply not be readable right now — “could not read” is never “you have nothing”.':
    'Una salida sin reloj aquí puede ser simplemente ilegible ahora mismo — «no pude leer» nunca es «no tienes nada».',
  'Total assets': 'Activos totales',
  'Free buffer': 'Colchón libre',
  'Buffer floor': 'Suelo del colchón',
  'Queued out': 'En cola de salida',
  'Direct to venue': 'Dirigir al venue',
  'Recall to buffer': 'Retirar al colchón',
  DENIED: 'DENEGADO',
  'The mandate only moves capital between listed venues, above the buffer floor, under the cap. There is no other door — that is the product.':
    'El mandato solo mueve capital entre los venues listados, por encima del suelo del colchón y bajo el tope. No existe otra puerta — eso ES el producto.',
  'Could not read the pote.': 'No pude leer el pote.',
  constitution: 'constitución',
  'mandate expires': 'el mandato caduca',
  'sync vault': 'vault síncrono',
  'money market': 'mercado de dinero',
  'queued (24h periods)': 'con cola (periodos de 24 h)',

  // Onboarding custodial (modo B): el operador deposita por el cliente
  'Onboard a client (custodial)': 'Dar de alta a un cliente (custodial)',
  'You (the operator) pay and sign; the shares belong to the client. Only the client can redeem them — you never can. There is no new deposit: the capital was already yours to custody, this only changes its state.':
    'Tú (el operador) pagas y firmas; las participaciones son del cliente. Solo el cliente puede redimirlas — tú nunca. No hay depósito nuevo: el capital ya estaba bajo tu custodia, esto solo cambia su estado.',
  'Client address (receiver of the shares)': 'Dirección del cliente (receiver de las participaciones)',
  'Client XRPL root (checked against the credential gate)':
    'Raíz XRPL del cliente (se comprueba contra la puerta de credencial)',
  'Checking the credential…': 'Comprobando la credencial…',
  'This pote is not credential-gated.': 'Este pote no tiene puerta de credencial.',
  'Client cleared: a valid credential is on the ledger.':
    'Cliente admitido: hay una credencial válida en el ledger.',
  'Client NOT cleared: no valid credential from a configured issuer. Issue and accept it first.':
    'Cliente NO admitido: sin credencial válida de un emisor configurado. Emítela y acéptala primero.',
  'Connect the operator EVM wallet (Flare) to continue':
    'Conecta la wallet EVM del operador (Flare) para continuar',
  'The client address (receiver of the shares) is not valid':
    'La dirección del cliente (receiver de las participaciones) no es válida',
  'Review onboarding deposit': 'Revisar el depósito de alta',
  'Sign as operator': 'Firmar como operador',
  'Waiting for the operator wallet…': 'Esperando a la wallet del operador…',
  'Onboarded. The shares are on the client address once the receipt is read. From here, only the client can take them out — and you cannot stop them.':
    'Cliente dado de alta. Las participaciones están en la dirección del cliente en cuanto se lea el recibo. De aquí en adelante, solo el cliente puede sacarlas — y tú no puedes impedirlo.',

  // Ceremonia de credencial (escena 2): el emisor crea, el sujeto acepta
  'Issue credential (KYC)': 'Emitir credencial (KYC)',
  'Credential ceremony (KYC → consent)': 'Ceremonia de credencial (KYC → consentimiento)',
  'Verifiable credential link (optional)': 'Enlace a la credencial verificable (opcional)',
  'Where the issuer’s attestation (W3C VC / eIDAS QEAA) can be checked. A pointer only — no document goes on-chain.':
    'Dónde comprobar la atestación del emisor (VC W3C / QEAA eIDAS). Solo un puntero — ningún documento va a la cadena.',
  'Astryum composes the transactions; it never issues or accepts. The issuer signs the create (after its KYC), the subject signs the accept — that signature IS the consent. The credential always carries an expiry (I5).':
    'Astryum compone las transacciones; jamás emite ni acepta. El emisor firma la creación (tras su KYC), el sujeto firma la aceptación — esa firma ES el consentimiento. La credencial lleva caducidad siempre (I5).',
  'Issuer XRPL account (the exchange KYC)': 'Cuenta XRPL del emisor (el KYC del exchange)',
  'Subject XRPL account (the client root)': 'Cuenta XRPL del sujeto (la raíz del cliente)',
  'Expiry (days)': 'Caducidad (días)',
  'Start — issuer signs': 'Empezar — firma el emisor',
  'Issuer signs': 'Firma el emisor',
  'Subject accepts': 'El sujeto acepta',
  Done: 'Listo',
  'The ISSUER signs the credential in Xaman': 'El EMISOR firma la credencial en Xaman',
  'The SUBJECT signs the acceptance in Xaman': 'El SUJETO firma la aceptación en Xaman',
  'Scan with Xaman': 'Escanea con Xaman',
  'Open in Xaman': 'Abrir en Xaman',
  'The signature was cancelled.': 'La firma se canceló.',
  'The request expired before it was signed.': 'La petición caducó antes de firmarse.',
  'The credential is on the ledger and accepted by the client. The gated pote now admits their deposit.':
    'La credencial está en el ledger y aceptada por el cliente. El pote con puerta ya admite su depósito.',

  // Lado usuario con Face ID (passkey soberana)
  'Earn with Face ID': 'Genera rendimiento con Face ID',
  'Put your balance to work and take it back whenever you want. You approve everything with your face; only you can move your money.':
    'Pon tu saldo a trabajar y recupéralo cuando quieras. Apruebas todo con tu cara; solo tú puedes mover tu dinero.',
  'This surface is not enabled on this environment.': 'Esta superficie no está activada en este entorno.',
  'Set up Face ID': 'Configura Face ID',
  'One tap creates your key on THIS device. From here you approve everything with your face — no wallet, no seed phrase, no gas. Only you can move your money; nobody else, ever.':
    'Un toque crea tu llave en ESTE dispositivo. De aquí en adelante apruebas todo con tu cara — sin wallet, sin frase semilla, sin gas. Solo tú puedes mover tu dinero; nadie más, jamás.',
  'A name for this account': 'Un nombre para esta cuenta',
  'e.g. my savings': 'p. ej. mis ahorros',
  'Create my key with Face ID': 'Crear mi llave con Face ID',
  'This device does not support passkeys (Face ID / Touch ID). Open it on a phone or a modern browser.':
    'Este dispositivo no soporta passkeys (Face ID / Touch ID). Ábrelo en un móvil o un navegador moderno.',
  'Reading your account…': 'Leyendo tu cuenta…',
  // El alta que no llega a su cuenta, en palabras (passkeyErrors.ts)
  'Your key is ready on this device': 'Tu llave ya está en este dispositivo',
  'We could not read the account that belongs to it. Nothing is lost — the key stays on this device.':
    'No pudimos leer la cuenta que le corresponde. No se ha perdido nada — la llave sigue en este dispositivo.',
  'Sign in to Astryum first — your Face ID key is ready, and its account is read with your session.':
    'Inicia sesión en Astryum primero — tu llave Face ID ya está creada y su cuenta se lee con tu sesión.',
  'This server does not have Face ID accounts yet — nothing was created on-chain. Try again once it is updated.':
    'Este servidor aún no tiene cuentas Face ID — no se creó nada on-chain. Vuelve a intentarlo cuando se actualice.',
  'Face ID accounts are not configured on this server yet.': 'Las cuentas Face ID aún no están configuradas en este servidor.',
  'The server could not be reached — your key is safe on this device. Try again.':
    'No se pudo contactar con el servidor — tu llave está a salvo en este dispositivo. Vuelve a intentarlo.',
  'Your account could not be read from Flare right now — your key is safe on this device. Try again.':
    'Ahora mismo no se pudo leer tu cuenta en Flare — tu llave está a salvo en este dispositivo. Vuelve a intentarlo.',
  'No key was created — the window was closed, it timed out, or this computer had nowhere to keep this kind of key. Try again, or create it on your phone.':
    'No se creó ninguna llave — se cerró la ventana, caducó, o este ordenador no tenía dónde guardar este tipo de llave. Vuelve a intentarlo o créala en tu móvil.',
  // PC sin Bluetooth / Windows Hello en RSA: la llave se crea en el móvil (PasskeyGate)
  'Create it on your phone instead': 'Créala en tu móvil',
  'This computer cannot reach your phone — that needs Bluetooth. You do not need it: open this page on the phone itself.':
    'Este ordenador no puede llegar a tu móvil — para eso hace falta Bluetooth. No lo necesitas: abre esta página en el propio móvil.',
  'On Windows, Windows Hello often cannot make the kind of key this account needs (P-256), so it may not be offered. A phone can.':
    'En Windows, Windows Hello a menudo no puede crear el tipo de llave que necesita esta cuenta (P-256), así que puede no aparecer. Un móvil sí puede.',
  'Scan this with your phone camera: it opens this same page. Sign in there and create the key with Face ID or your fingerprint.':
    'Escanéalo con la cámara del móvil: abre esta misma página. Inicia sesión allí y crea la llave con Face ID o tu huella.',
  'Copy link': 'Copiar enlace',
  'The key then lives on that phone, so from then on you approve from the phone.':
    'La llave vivirá en ese móvil, así que a partir de ahí apruebas desde el móvil.',
  // Depósito del cliente como QR de Xaman (ClientApp U1)
  'Pay with Xaman (QR)': 'Pagar con Xaman (QR)',
  'Xaman will ask for the account {address}: this deposit is prepared for it.':
    'Xaman pedirá la cuenta {address}: este depósito está preparado para ella.',
  'Deposit {amount} XRP · tag {tag}': 'Depositar {amount} XRP · tag {tag}',
  // La tarjeta de KYC del cliente (ClientKycCard)
  'My KYC at the exchange': 'Mi KYC en el exchange',
  'Verified: the exchange registered the KYC of your account on the XRP Ledger.': 'Verificado: el exchange registró el KYC de tu cuenta en el XRP Ledger.',
  // 'expires' ya vive arriba (línea 886): una sola entrada por clave (TS1117).
  'Reading your credential from the ledger…': 'Leyendo tu credencial en el ledger…',
  'Check my KYC': 'Comprobar mi KYC',
  // La mesa: el KYC por casilla (ExchangeDesk E3, diseño B)
  'Registers this client KYC on the ledger: the root issues it on the omnibus and the omnibus accepts it':
    'Registra el KYC de este cliente en el ledger: la raíz lo emite sobre el omnibus y el omnibus lo acepta',
  // 'verified', 'expired' y 'could not read' ya viven en el diccionario (TS1117).
  KYC: 'KYC',
  'no KYC': 'sin KYC',
  'Issue KYC': 'Emitir KYC',
  'issued, not accepted': 'emitida, sin aceptar',
  'issued by the exchange root': 'emitida por la raíz del exchange',
  'see it on the ledger': 'verla en el ledger',
  'Taking your money out never needs this credential — if it expires, it is renewed and meanwhile your way out stays open.':
    'Sacar tu dinero no necesita nunca esta credencial — si caduca, se renueva, y mientras tanto tu salida sigue abierta.',
  // El KYC del exchange, en palabras del cliente (diseño B: el cliente no firma)
  'The exchange has not registered the KYC of your account yet. It does it from its side — you sign nothing. Taking your money out never needs it.':
    'El exchange aún no ha registrado el KYC de tu cuenta. Lo hace desde su lado — tú no firmas nada. Sacar tu dinero no lo necesita nunca.',
  'The exchange issued the KYC of your account and is finishing registering it on the ledger. It works as soon as that is done.':
    'El exchange emitió el KYC de tu cuenta y está terminando de registrarlo en el ledger. Funciona en cuanto acabe.',
  'The KYC of your account expired. The exchange renews it; taking your money out is open meanwhile.':
    'El KYC de tu cuenta ha caducado. El exchange lo renueva; mientras tanto, sacar tu dinero sigue abierto.',
  'Register your own XRPL wallet first: withdrawals to self-custody are paid there.':
    'Registra antes tu propia wallet XRPL: las retiradas a autocustodia se pagan ahí.',
  'Your credential could not be checked against the XRP Ledger right now — this does not mean you have none. Nothing moved; try again.':
    'Ahora mismo no se pudo comprobar tu credencial en el XRP Ledger — eso no significa que no la tengas. No se movió nada; vuelve a intentarlo.',
  // «Direct the capital»: qué hay, qué está libre y qué está en camino (ExchangeDesk E6)
  'Total in the pote': 'Total en el pote',
  'Free to direct (buffer)': 'Libre para dirigir (colchón)',
  'On its way to the pote: {xrp} XRP — the payment is signed and validated on XRPL; it becomes FXRP in the pote when an executor mints it.':
    'En camino al pote: {xrp} XRP — el pago está firmado y validado en XRPL; se convierte en FXRP dentro del pote cuando un executor lo acuña.',
  'It has been waiting for more than 10 minutes: check that an executor is running for this environment.':
    'Lleva más de 10 minutos esperando: comprueba que hay un executor en marcha en este entorno.',
  'The pote is empty: capital arrives when a client puts XRP to work and an executor mints it. There is nothing to direct yet.':
    'El pote está vacío: el capital llega cuando un cliente pone XRP a trabajar y un executor lo acuña. Todavía no hay nada que dirigir.',
  'Fill with the most you can direct': 'Poner el máximo dirigible',
  // El acceso a la cuenta del exchange (ExchangeClientApp)
  'This key does not work here? Use another one': '¿Esta llave no funciona aquí? Usa otra',
  'It only forgets the key in this browser; the key itself stays on your device. If your account key lives on your phone, open this page there.':
    'Solo olvida la llave en este navegador; la llave sigue en tu dispositivo. Si la llave de tu cuenta está en tu móvil, abre esta página allí.',
  'This key already has an account at {exchange}': 'Esta llave ya tiene una cuenta en {exchange}',
  'But it was opened with another Astryum account. Sign in with the account you used to open it — your balance and your shares are there.':
    'Pero se abrió con otra cuenta de Astryum. Entra con la cuenta con la que la abriste: ahí están tu saldo y tus participaciones.',
  'Your sign-in changed since you opened it: the exchange has to confirm it is you again with a claim code.':
    'Tu acceso cambió desde que la abriste: el exchange tiene que confirmar que eres tú con un código de reclamación.',
  'Directable now (keeps the {pct}% minimum buffer)': 'Dirigible ahora (deja el colchón mínimo del {pct}%)',
  'Deposit QR for a client': 'QR de depósito para un cliente',
  'Show it to the client: they scan it with Xaman and the XRP arrives at the omnibus with their tag.':
    'Enséñaselo al cliente: lo escanea con Xaman y el XRP llega al omnibus con su tag.',
  'Show deposit QR': 'Mostrar QR de depósito',
  'Deposit validated on the ledger ({hash}). The exchange credits it on its next read — a few seconds.':
    'Depósito validado en el ledger ({hash}). El exchange lo abona en su próxima lectura — unos segundos.',
  'This device refused to create the key. Try again, or use another browser.':
    'Este dispositivo rechazó crear la llave. Vuelve a intentarlo o usa otro navegador.',
  'This device cannot create the kind of key the account needs (P-256). Try another browser or device.':
    'Este dispositivo no puede crear el tipo de llave que necesita la cuenta (P-256). Prueba otro navegador o dispositivo.',
  'This page is not allowed to create passkeys on this address.': 'Esta página no tiene permiso para crear passkeys en esta dirección.',
  'Something went wrong — try again.': 'Algo salió mal — vuelve a intentarlo.',
  'Your account': 'Tu cuenta',
  Vault: 'Vault',
  'Take out': 'Sacar',
  'Your external wallet address': 'La dirección de tu wallet externa',
  'The destination wallet address is not valid': 'La dirección de la wallet de destino no es válida',
  'You hold no shares of this vault': 'No tienes participaciones de este vault',
  'Immediate exit: the vault unwinds itself inside your transaction.':
    'Salida inmediata: el vault se desmonta solo dentro de tu transacción.',
  'This vault has a cooldown. Your shares burn now and the amount is fixed; you claim it when the clock ends. Nobody can stop it.':
    'Este vault tiene un plazo de espera. Tus participaciones se queman ahora y el importe queda fijado; lo cobras cuando termine el reloj. Nadie puede impedirlo.',
  'Add with Face ID': 'Meter con Face ID',
  'Take out with Face ID': 'Sacar con Face ID',
  'Send with Face ID': 'Enviar con Face ID',
  'Done — verified on the blockchain.': 'Hecho — comprobado en la blockchain.',
  'See it on the explorer': 'Míralo en el explorador',
  'No vaults are available on this environment yet.': 'Aún no hay vaults disponibles en este entorno.',
  'Institutional demo': 'Demo institucional',
  Exchange: 'Exchange',
  'You are the exchange here: issue a credential, onboard a client (you pay, the shares are theirs), direct capital, harvest. Try to extract and the cage says no.':
    'Aquí eres el exchange: emites una credencial, das de alta a un cliente (pagas tú, las participaciones son suyas), diriges capital, cosechas. Intenta extraer y la jaula dice que no.',
  'You are the client here: set up Face ID once, then add, take out, or send to your own wallet — each with your face. You never touch a wallet or gas.':
    'Aquí eres el cliente: configuras Face ID una vez y luego metes, sacas o envías a tu propia wallet — cada acción con tu cara. Nunca tocas una wallet ni gas.',

  // Nacimiento del pote (escena 1): el consejo XRPL crea el vault
  'Create a vault': 'Crear un vault',
  'The council XRPL wallet deploys and controls the vault with one signature. A different council address births a different vault — create as many as you need.':
    'La wallet-consejo XRPL despliega y controla el vault con una firma. Una dirección de consejo distinta nace un vault distinto — crea tantos como necesites.',
  'Council XRPL address (deploys and controls the vault)': 'Dirección XRPL del consejo (despliega y controla el vault)',
  'Pote A — Conservative (immediate)': 'Pote A — Conservador (inmediato)',
  'Pote B — Yield (3-day exit)': 'Pote B — Rendimiento (salida 3 días)',
  'Genesis principal (XRP)': 'Principal génesis (XRP)',
  'One payment mints this XRP into FXRP and seeds the vault (the operator’s own genesis, inflation defense).':
    'Un pago mintea este XRP en FXRP y siembra el vault (el génesis propio del operador, defensa de inflación).',
  'Compose the birth for the council': 'Componer el nacimiento para el consejo',
  'Create this vault': 'Crear este vault',
  'Will live at': 'Vivirá en',
  'Start over with a new account (demo)': 'Empezar de cero con una cuenta nueva (demo)',
  'Signed. The executor is minting the XRP and running the birth — the vault is usually live on Flare in about 2–5 minutes.':
    'Firmado. El executor está minteando el XRP y ejecutando el nacimiento — el vault suele estar vivo en Flare en 2-5 minutos.',
  // ── Fusión Summary+Home: scope de flotas + raíl del Portfolio ──
  'Back to Summary': 'Volver al Summary',
  'Your fleets': 'Tus flotas',
  'Toggle what the page reads: everything together, your personal wallets, or your Legacies. The numbers re-scope in place — you never leave this screen.':
    'Cambia lo que lee la página: todo junto, tus wallets personales o tus Legacies. Los números se re-enfocan en el sitio — nunca sales de esta pantalla.',
  'This is your Summary: all your capital, across every fleet, in one place. A minute of tour and you will know where everything lives — skip and replay it any time from Settings.':
    'Este es tu Summary: todo tu capital, de todas las flotas, en un solo sitio. Un minuto de tour y sabrás dónde vive cada cosa — sáltalo y repítelo cuando quieras desde Ajustes.',
  'Every wallet and structure with its capital working. Open one to see its detail in Portfolio, or manage wallets from the door above.':
    'Cada wallet y estructura con su capital trabajando. Abre una para ver su detalle en Portfolio, o gestiona las wallets desde la puerta de arriba.',
  'No readings yet for this fleet.': 'Aún no hay lecturas de esta flota.',
  'Scope': 'Ámbito',
  'Filters': 'Filtros',
  // ── Fusión v2: el deck de flotas vuelve, estados sin wallet ──
  'Across all fleets': 'Entre todas las flotas',
  'Council-governed accounts: capital under rules that a quorum signs. Click one to govern it — the dashboard crosses to indigo without leaving this page.':
    'Cuentas gobernadas por consejo: capital bajo reglas que firma un quórum. Pulsa una para gobernarla — el dashboard cruza al índigo sin salir de esta página.',
  'Link MetaMask on Flare Mainnet or Xaman on XRPL — your open positions load here, read-only until you sign.':
    'Vincula MetaMask en Flare Mainnet o Xaman en XRPL — tus posiciones abiertas cargan aquí, solo-lectura hasta que firmas.',
  // ── Sección de capital trabajando + tercera puerta de Earn ──
  // OJO: el NOMBRE de la sección (la fila del menú) NO vive aquí — vive en
  // lib/nav/capitalSection.ts con sus dos idiomas juntos, porque un t(CONSTANTE)
  // es invisible para scripts/check-i18n.js y el castellano se publicaría en
  // inglés con el CI en verde. Lo de abajo sí son literales y sí se comprueban.
  'Managed': 'Con gestor',
  'Managed by a third party': 'Gestionado por un tercero',
  'You have no managed vaults': 'No tienes ninguna bóveda con gestor',
  'When you enter a vault run by a manager, it shows up here: what it holds, what it did, and how to leave. The manager is a third party — never Astryum.':
    'Cuando entres en una bóveda que lleva un gestor, aparece aquí: qué tiene dentro, qué ha hecho y cómo se sale. El gestor es un tercero — nunca Astryum.',
  'A manager can move your capital between the venues the contract allows, and nowhere else. It cannot send it to itself and it cannot withdraw it — the vault reverts, so it is not a policy you have to trust.':
    'Un gestor puede mover tu capital entre los sitios que el contrato permite, y a ningún otro. No puede enviárselo a sí mismo ni sacarlo — la bóveda revierte, así que no es una política que tengas que creerte.',
  'Managers open to new clients': 'Gestores abiertos a nuevos clientes',
  'No managers listed yet': 'Todavía no hay gestores listados',
  'This is where managers who take on clients will appear, with the vault they run and the rules that vault enforces. Astryum lists them; it never manages and never recommends one.':
    'Aquí aparecerán los gestores que aceptan clientes, con la bóveda que llevan y las reglas que esa bóveda impone. Astryum los lista; ni gestiona ni recomienda a ninguno.',
  'With a manager': 'Con un gestor',
  'Invest with a manager': 'Invierte con un gestor',
  'Put capital into a vault a professional runs. They choose the moves, inside limits the contract enforces — they can never withdraw your capital to themselves.':
    'Mete capital en una bóveda que lleva un profesional. Él elige los movimientos, dentro de los límites que impone el contrato — nunca puede sacar tu capital hacia sí mismo.',
  // ── Columnas del catálogo ─────────────────────────────
  // El subtítulo de la columna «earn» NO reutiliza el del outcome: ese dice
  // «presta, stakea o deposita en una bóveda», y delegar al FTSO no es ninguna
  // de las tres — los tokens no salen de tu wallet. Lo que SÍ es cierto de las
  // seis es que no hay deuda.
  'No debt and nothing that can be liquidated — each card says what it does with your tokens.':
    'Sin deuda y sin nada que pueda liquidarse — cada card dice qué hace con tus tokens.',
  // Tres subtítulos del viaje de la ruta que se pintaban con t() y no tenían
  // traducción — los cazó el checker al empezar a mirar el campo `sub`.
  // Salían en inglés en medio de una pantalla en castellano.
  'protocol rate': 'tipo del protocolo',
  'vault rate': 'tipo de la bóveda',
  'your wallet (Ethereum)': 'tu wallet (Ethereum)',
  // ── La puerta del gestor, con su nombre cerrado ───────────
  // «Invest with a manager» se cayó por lo que incía: sonaba a producto de
  // inversión nuestro y no decía de quién era el gestor. El título nombra la
  // cosa y el eyebrow carga el hecho que le falta.
  'Managed vaults': 'Bóvedas con gestor',
  'Run by a third party': 'Las lleva un tercero',
  'Vaults run by a professional who is not Astryum. They choose the moves, inside limits the contract enforces — they can never withdraw your capital to themselves.':
    'Bóvedas que lleva un profesional que no es Astryum. Él elige los movimientos, dentro de los límites que impone el contrato — nunca puede sacar tu capital hacia sí mismo.',
  // ── Cómo funciona una bóveda con gestor ─────────────────
  // «buscando rendimiento», NO «para generar rendimiento»: el trabajo del gestor
  // es buscarlo; que llegue no es nuestro para afirmarlo (invariante 9).
  'A manager puts your assets to work': 'Un gestor pone tus activos a trabajar',
  'Someone who does this professionally moves the capital inside the vault, seeking a return. They are a third party — never Astryum.':
    'Alguien que se dedica a esto mueve el capital dentro de la bóveda, buscando rendimiento. Es un tercero — nunca Astryum.',
  'You choose the vault, and with it the risk': 'Tú eliges la bóveda, y con ella el riesgo',
  'Each vault says which venues it allows before you enter. Picking one is picking what can happen to your capital — that choice stays yours and is never made for you.':
    'Cada bóveda dice qué sitios permite antes de que entres. Elegir una es elegir qué le puede pasar a tu capital — esa decisión es tuya y nunca se toma por ti.',
  'Code holds them, not trust': 'Lo sujeta el código, no la confianza',
  'The manager can only move capital inside the parameters you signed. Those parameters are locked in the contract: step outside them and the transaction reverts. Nothing here depends on the manager behaving.':
    'El gestor solo puede mover capital dentro de los parámetros que tú firmaste. Esos parámetros quedan fijados en el contrato: si se sale de ellos, la transacción revierte. Aquí nada depende de que el gestor se porte bien.',
  'They can never take your assets': 'Nunca puede quedarse con tus activos',
  'There is no route by which the manager sends your capital to itself or withdraws it. Not a policy, not a promise — the contract has no such function.':
    'No hay ninguna vía por la que el gestor se envíe tu capital ni lo saque. No es una política ni una promesa — el contrato no tiene esa función.',
  'You leave on your own': 'Sales tú solo',
  'Exiting does not need the manager’s permission. Each vault publishes how long its exit takes before you enter, and that clock is in the contract too.':
    'Salir no necesita el permiso del gestor. Cada bóveda publica cuánto tarda su salida antes de que entres, y ese reloj también está en el contrato.',
  // El límite de la protección, dicho en alto: el contrato impide que te quiten
  // los activos, no que pierdas dinero. Un «siempre protegido» a secas sería la
  // frase que alguien te cita después de una pérdida.
  'What the code does NOT do is stop you losing money. It keeps your assets out of the manager’s hands; it cannot keep a venue the vault allows from falling. That risk is exactly why you pick the vault and not them.':
    'Lo que el código NO hace es evitar que pierdas dinero. Mantiene tus activos fuera del alcance del gestor; no puede impedir que caiga un sitio que la bóveda permite. Ese riesgo es justo la razón de que la bóveda la elijas tú y no él.',
  'What you will be able to check before entering: which venues the vault allows, how long the exit takes, what the manager charges, and who the director is. All of it read from the contract, not from a brochure.':
    'Lo que podrás comprobar antes de entrar: qué sitios permite la bóveda, cuánto tarda la salida, cuánto cobra el gestor y quién es el director. Todo leído del contrato, no de un folleto.',
  // ── La card del gestor ────────────────────────────
  // El tick nombra SIEMPRE al emisor: «verificado» a secas invita a leer que lo
  // verificamos nosotros, y no somos verificador.
  'Verified by': 'Verificado por',
  'Self-declared': 'Autodeclarado',
  'Exit window': 'Salida',
  'Venues allowed': 'Sitios permitidos',
  'Max per venue': 'Máx. por sitio',
  'Inside': 'Dentro',
  'Entry gated': 'Entrada con puerta',
  'Its state could not be read right now — that is not the same as empty.':
    'Ahora mismo no se pudo leer su estado — que no es lo mismo que vacío.',
  'Reading the catalogue from the chain…': 'Leyendo el catálogo de la cadena…',
  'The catalogue could not be read right now. That is not the same as there being none — try again in a moment.':
    'Ahora mismo no se pudo leer el catálogo. Que no es lo mismo que no haya ninguno — inténtalo en un momento.',
  'Listed in no particular order — Astryum does not rank managers.':
    'Sin orden particular — Astryum no clasifica gestores.',
  // ── La mesa del gestor y las dos lentes de Bóvedas con gestor ──
  'Choose a manager': 'Elegir gestor',
  'Run a vault': 'Llevar una bóveda',
  'Your desk': 'Tu mesa',
  'Connect your XRPL account': 'Conecta tu cuenta XRPL',
  'A vault is governed by one XRPL account — yours. Connect it and this desk shows the vault it runs, or what it takes to open one.':
    'Una bóveda la gobierna una cuenta XRPL — la tuya. Conéctala y esta mesa te enseña la bóveda que lleva, o qué hace falta para abrir una.',
  'The vault you run': 'La bóveda que llevas',
  'Where you may take the capital': 'Adónde puedes llevar el capital',
  'This list is the whole cage. Anywhere outside it the contract reverts — including toward you.':
    'Esta lista es la jaula entera. Fuera de ella el contrato revierte — incluso hacia ti.',
  'No venues allowed yet.': 'Todavía no hay sitios permitidos.',
  'This account does not run a vault yet': 'Esta cuenta todavía no lleva ninguna bóveda',
  'Opening one is not a form yet: it needs your own parameters, and the rail still only knows the two fixed shapes of the demo. Rather than open a cage you did not choose, here is exactly what it will take.':
    'Abrir una todavía no es un formulario: necesita tus propios parámetros, y el raíl solo conoce las dos formas fijas de la demo. Antes que abrir una jaula que no elegiste, esto es exactamente lo que va a hacer falta.',
  'One vault per XRPL account.': 'Una bóveda por cuenta XRPL.',
  'The factory reverts on the second one. Running two — a careful one and a wider one, say — means two accounts.':
    'La factory revierte en la segunda. Llevar dos —una prudente y otra más amplia, por ejemplo— significa dos cuentas.',
  'It is created from your Personal Account, and that costs.':
    'Se crea desde tu Personal Account, y eso cuesta.',
  'The order travels XRPL to Flare and pays the FDC toll to be proven. It is a real cost of opening, not a fee Astryum charges.':
    'La orden viaja de XRPL a Flare y paga el peaje del FDC para probarse. Es un coste real de abrir, no una comisión de Astryum.',
  'You choose the cage before anyone puts money in.':
    'La jaula la eliges tú antes de que nadie meta dinero.',
  'Which venues it allows, how long its exit takes, how much may sit in any one place. Once set, it binds you too.':
    'Qué sitios permite, cuánto tarda su salida, cuánto puede haber en un solo sitio. Una vez puesta, te ata a ti también.',
  'The catalogue could not be read right now, so this desk cannot tell whether you already run a vault. That is not the same as you not having one.':
    'Ahora mismo no se pudo leer el catálogo, así que esta mesa no puede saber si ya llevas una bóveda. Que no es lo mismo que no tengas ninguna.',
  'immediate': 'inmediata',
  'ready in': 'lista en',
  // ── La consola del gestor: tres verbos ───────────────────
  'What you can move': 'Lo que puedes mover',
  // 'In the vault' e 'Idle' NO se redefinen aqui: ya existen mas arriba
  // ('En el vault' y 'Libre'). Duplicarlas rompe el objeto — TS1117 — y ademas
  // 'Libre' describe mejor el freeBalance que lo que yo habia escrito.
  'Untouchable floor': 'Suelo intocable',
  'Deployable now': 'Desplegable ahora',
  'The floor is yours to respect and your clients’ to cross: redemptions may dip into it, you may not.':
    'El suelo es tuyo para respetarlo y de tus clientes para cruzarlo: las salidas pueden meterse en él, tú no.',
  'Where the capital is': 'Dónde está el capital',
  'Room left here': 'Le cabe todavía',
  'Opens for entry in': 'Se abre a entradas en',
  'Retired — capital can only come out.': 'Retirado — el capital solo puede salir.',
  'Put in': 'Meter',
  'Pull out': 'Sacar',
  'Queue exit': 'Encolar salida',
  'Move — not wired yet': 'Mover — sin cablear',
  'This venue exits through a queue: pulling out starts the wait, it does not return the capital now.':
    'Este sitio sale por cola: sacar arranca la espera, no devuelve el capital ahora.',
  'No venues allowed yet — the council proposes them, and each one waits 30 days.':
    'Todavía no hay sitios permitidos — los propone el consejo, y cada uno espera 30 días.',
  'The cap is checked after the move, on real values — a venue may not credit exactly what you send, so treat this maximum as an estimate.':
    'El tope se comprueba después del movimiento y sobre valores reales — un sitio puede no acreditar exactamente lo que le mandas, así que este máximo es una estimación.',
  'Enter an amount.': 'Escribe una cantidad.',
  'That is more than this move allows right now.': 'Eso es más de lo que este movimiento permite ahora mismo.',
  'Astryum builds the call; your wallet signs it. It never signs for you.':
    'Astryum construye la llamada; la firma tu wallet. Nunca firma por ti.',
  'The cage refused': 'La jaula lo rechazó',
  'The vault state could not be read right now, so this console cannot tell you what you may move. Nothing is broken — try again in a moment.':
    'Ahora mismo no se pudo leer el estado de la bóveda, así que esta consola no puede decirte qué puedes mover. No hay nada roto — inténtalo en un momento.',
  // ── La constitución de una bóveda, en lectura ──────────────
  'Fixed at birth, forever': 'Fijado al nacer, para siempre',
  'How long a client waits after asking to leave. Neither the manager nor the council can change it.':
    'Lo que espera un cliente desde que pide salir. Ni el gestor ni el consejo pueden cambiarlo.',
  'The share that always stays liquid. The manager cannot cross it; a client leaving may.':
    'La parte que siempre queda líquida. El gestor no puede cruzarla; un cliente que sale, sí.',
  'Allowed venues': 'Sitios permitidos',
  'A new venue waits 30 days before any capital may enter it. That delay is the whole safety: being able to add a destination and send the money there the same day would be the power to take it.':
    'Un sitio nuevo espera 30 días antes de que pueda entrar capital. Esa espera es toda la seguridad: poder añadir un destino y mandar el dinero allí el mismo día sería el poder de llevárselo.',
  'opens in': 'se abre en',
  'open': 'abierto',
  'The most that may sit in any single venue. The council can move this; the manager cannot.':
    'Lo máximo que puede haber en un solo sitio. El consejo puede moverlo; el gestor no.',
  'Who holds authority': 'Quién tiene la autoridad',
  'The only address that can change what this vault is. Everything on this screen is its doing.':
    'La única dirección que puede cambiar lo que esta bóveda es. Todo lo de esta pantalla es obra suya.',
  'nobody — the council runs it itself': 'nadie — la lleva el propio consejo',
  'No direction has been granted, so only the council can move capital.':
    'No se ha cedido la dirección a nadie, así que solo el consejo puede mover capital.',
  'This mandate has already run out: the address is still on record, but its moves now revert.':
    'Este mandato ya se acabó: la dirección sigue anotada, pero sus movimientos ahora revierten.',
  'Runs out in': 'Se acaba en',
  'authority expires on its own and never renews itself.':
    'la autoridad caduca sola y nunca se renueva.',
  // 'Constitution' ya existe mas arriba — no se redefine (TS1117).
  'The cut': 'El reparto',
  'Nobody takes a cut: all yield stays in the vault.':
    'Nadie se lleva corte: todo el rendimiento se queda en la bóveda.',
  'The cut is taken from realised yield above each venue’s high-water mark — never from the capital you put in. Its ceiling was fixed when this pote was born and cannot be raised afterwards: it is in the contract, not in a policy.':
    'El corte sale del rendimiento realizado por encima de la marca de cada sitio — nunca del capital que metiste. Su techo quedó fijado al nacer este pote y no se puede subir después: está en el contrato, no en una política.',
  'What only the council may do': 'Lo que solo puede hacer el consejo',
  'Propose or retire a venue, move the per-venue cap, set the cut, grant or end direction, set the entry gate, amend the constitution, hand over the council, and evacuate a venue. The manager holds none of these — moving capital between venues that already exist is the whole of the job.':
    'Proponer o retirar un sitio, mover el tope por sitio, fijar el reparto, ceder o terminar la dirección, poner la puerta de entrada, enmendar la constitución, traspasar el consejo y evacuar un sitio. El gestor no tiene ninguno — mover capital entre sitios que ya existen es todo su trabajo.',
  'Reading the constitution…': 'Leyendo la constitución…',
  'The constitution could not be read right now. That is not the same as this vault having none.':
    'Ahora mismo no se pudo leer la constitución. Que no es lo mismo que esta bóveda no tenga ninguna.',
  // ── El aviso de autoridad, antes de firmar ───────────────────────
  'Your mandate over this vault has expired, so every action here would revert. Authority runs out on its own and never renews itself — the council has to grant it again.':
    'Tu mandato sobre esta bóveda ha caducado, así que cualquier acción de aquí revertiría. La autoridad se acaba sola y nunca se renueva — el consejo tiene que cederla otra vez.',
  'This wallet is neither the council nor the current director of this vault, so the contract will refuse every move. Nothing is broken: it was simply never granted to this address.':
    'Esta wallet no es ni el consejo ni el director actual de esta bóveda, así que el contrato va a rechazar cualquier movimiento. No hay nada roto: sencillamente nunca se le cedió a esta dirección.',
  'Your mandate over this vault ends in': 'Tu mandato sobre esta bóveda acaba en',
  'after that, every action reverts until the council grants it again.':
    'a partir de ahí, cada acción revierte hasta que el consejo la ceda otra vez.',

  // ── Demo Exchange v2 — exchange simulado, cadena real ──────────
  'A — conservative, immediate exit': 'A — conservadora, salida inmediata',
  'Allowlisted venues': 'Destinos permitidos',
  'Already born': 'Ya ha nacido',
  'AstryumVault (the cage)': 'AstryumVault (la jaula)',
  'Authority': 'Autoridad',
  'B — yield, 72h cooldown': 'B — rendimiento, espera de 72 h',
  'Behind the curtain': 'Detrás de la cortina',
  'Birth the pote': 'Crear el pote',
  'Birth the pote — one council signature (0xFE)': 'Crear el pote — una firma del consejo (0xFE)',
  'Cage': 'Jaula',
  'Client Flare account (optional, 0x… — or from User tab)': 'Cuenta Flare del cliente (opcional, 0x… — o desde la pestaña Usuario)',
  'Client XRPL wallet': 'Wallet XRPL del cliente',
  'Client XRPL wallet (optional, r…)': 'Wallet XRPL del cliente (opcional, r…)',
  'Client account (passkey)': 'Cuenta del cliente (passkey)',
  'Client asked the exchange to withdraw {xrp} XRP to their own wallet.': 'El cliente pidió al exchange retirar {xrp} XRP a su propia wallet.',
  'Client asked the exchange to put {xrp} XRP to work in the pote (mode B: the exchange signs; the shares are the client\'s).': 'El cliente pidió al exchange poner {xrp} XRP a trabajar en el pote (modo B: firma el exchange; las participaciones son del cliente).',
  'Client created with tag {tag}. They set up Face ID in the User tab; then register them on-chain here.': 'Cliente creado con el tag {tag}. Configura su Face ID en la pestaña Usuario; después regístralo on-chain aquí.',
  'Client deposits XRP at the exchange': 'El cliente deposita XRP en el exchange',
  'Client exits to XRP': 'El cliente sale a XRP',
  'Client exits with one signature': 'El cliente sale con una firma',
  'Client name (demo)': 'Nombre del cliente (demo)',
  'Client registered on-chain (KYC + tag)': 'Cliente registrado on-chain (KYC + tag)',
  'Clients: a tag, a Flare account, KYC on-chain': 'Clientes: un tag, una cuenta Flare, KYC on-chain',
  'Compose (omnibus signs in Xaman)': 'Componer (el ómnibus firma en Xaman)',
  'Compose the birth': 'Componer el nacimiento',
  'Compose the payout (omnibus signs)': 'Componer el pago (firma el ómnibus)',
  'Connect the exchange admin EVM wallet (Flare) to sign the registry call.': 'Conecta la wallet EVM del admin del exchange (Flare) para firmar la llamada al registro.',
  'Connect your XRPL wallet (Xaman) to sign the deposit — or send it from any wallet with the tag above.': 'Conecta tu wallet XRPL (Xaman) para firmar el depósito — o envíalo desde cualquier wallet con el tag de arriba.',
  'Constitution anchored. The council can now birth its pote (E2).': 'Constitución anclada. El consejo ya puede crear su pote (E2).',
  'Constitution of the exchange council…': 'Constitución del consejo del exchange…',
  'Cooldown pote: shares burned now, the amount is fixed; claimable when the clock ends.': 'Pote con espera: las participaciones se queman ahora y el importe queda fijado; se cobra cuando acaba el reloj.',
  'Council (signs every order in Xaman)': 'Consejo (firma cada orden en Xaman)',
  'Council XRPL account (the exchange authority)': 'Cuenta XRPL del consejo (la autoridad del exchange)',
  'Council anchors its constitution': 'El consejo ancla su constitución',
  'Council order signed. The relayer pays the FDC proof and executes bridge.execute on Flare (~2–5 min). Evidence → Read the chain shows consumedTxId when it lands.': 'Orden del consejo firmada. El relayer paga la prueba FDC y ejecuta bridge.execute en Flare (~2–5 min). En Evidencia → Leer la cadena aparece consumedTxId cuando aterriza.',
  'Council order: capital directed to a venue': 'Orden del consejo: capital dirigido a un destino',
  'Create client (assigns a tag)': 'Crear cliente (asigna un tag)',
  'Create the run': 'Crear la toma',
  'Credential ceremony (XLS-70)': 'Ceremonia de credencial (XLS-70)',
  'Credential ceremony (XLS-70, optional)': 'Ceremonia de credencial (XLS-70, opcional)',
  'Delete run': 'Borrar toma',
  'Delete this run and its receipts? The chain keeps its own record.': '¿Borrar esta toma y sus recibos? La cadena conserva su propio registro.',
  'Demo Exchange': 'Demo Exchange',
  'Deposit XRP': 'Depositar XRP',
  'Deposit signed ({hash}). The exchange ledger credits it when the ledger validates it — a few seconds.': 'Depósito firmado ({hash}). El libro del exchange lo abona cuando el ledger lo valida — unos segundos.',
  'Destination tag': 'Destination tag',
  'Direct the capital — by council order (XRPL → FDC → bridge)': 'Dirigir el capital — por orden del consejo (XRPL → FDC → bridge)',
  'E7 · To show "the robbery is impossible": direct more than the cap, below the buffer floor, or to a venue that is not listed — the cage refuses before anyone signs, and it is recorded.': 'E7 · Para enseñar «el robo imposible»: dirige más que el tope, por debajo del colchón, o a un destino no listado — la jaula se niega antes de que nadie firme, y queda registrado.',
  'Each receipt is a transaction hash and a promise. "Read the chain" measures the promise against XRPL and Flare — the backend never marks anything done by itself.': 'Cada recibo es un hash de transacción y una promesa. «Leer la cadena» mide la promesa contra XRPL y Flare — el backend nunca da nada por hecho por sí mismo.',
  'Evidence': 'Evidencia',
  'Exchange council': 'Consejo del exchange',
  'Exchange ledger': 'Libro del exchange',
  'Exchange omnibus': 'Ómnibus del exchange',
  'Exchange pays the client out': 'El exchange paga al cliente',
  'Exchange puts the client capital to work': 'El exchange pone a trabajar el capital del cliente',
  'ExchangeKycRegistry': 'ExchangeKycRegistry',
  'FAssets Core Vault': 'Core Vault de FAssets',
  'FDC': 'FDC',
  'Flare account': 'Cuenta Flare',
  'Flare · ERC-4626 · no extraction': 'Flare · ERC-4626 · sin extracción',
  'Flare · approved + tag': 'Flare · aprobado + tag',
  'Flare · the shares live here': 'Flare · aquí viven las participaciones',
  'Flare · verifies proof + nonce': 'Flare · verifica prueba + nonce',
  'Genesis XRP (the operator\'s own capital; its shares stay with the council)': 'XRP génesis (capital propio del operador; sus participaciones se quedan en el consejo)',
  'Get deposit instructions': 'Ver instrucciones de depósito',
  'Give the client a name': 'Ponle un nombre al cliente',
  'Give your account a name': 'Ponle un nombre a tu cuenta',
  'Immediate: the vault unwinds the venues inside your transaction. To the exchange = redeem + redeemWithTag in ONE signature; the tag comes from the registry, not typed.': 'Inmediata: el vault deshace los destinos dentro de tu transacción. Al exchange = redeem + redeemWithTag en UNA firma; el tag sale del registro, no se teclea.',
  'Infrastructure choreography lit by the receipts of this run': 'Coreografía de la infraestructura iluminada por los recibos de esta toma',
  'KYC not on-chain yet': 'KYC aún no on-chain',
  'KYC on-chain · tag': 'KYC on-chain · tag',
  'KYC registry on Flare (optional — read from the pote gate if empty)': 'Registro KYC en Flare (opcional — se lee de la puerta del pote si está vacío)',
  'Kinetic · Firelight (allowlisted)': 'Kinetic · Firelight (permitidos)',
  'Link': 'Vincular',
  'Look for the pote on the factory': 'Buscar el pote en la factory',
  'Mode B (custodial): the omnibus pays the Core Vault with a 42-byte 0xFE memo; the executor mints FXRP and deposits into the pote naming the client account as receiver. The client signs nothing and owns the shares from the first block.': 'Modo B (custodial): el ómnibus paga al Core Vault con un memo 0xFE de 42 bytes; el executor mintea FXRP y deposita en el pote nombrando receptora a la cuenta del cliente. El cliente no firma nada y es dueño de las participaciones desde el primer bloque.',
  'Mode B: the exchange signs, the client signs nothing; the shares are minted to the client account.': 'Modo B: firma el exchange, el cliente no firma nada; las participaciones se acuñan en la cuenta del cliente.',
  'Mode B: you sign nothing here — the exchange executes it from its omnibus and the shares are minted to YOUR account.': 'Modo B: aquí no firmas nada — el exchange lo ejecuta desde su ómnibus y las participaciones se acuñan en TU cuenta.',
  'New take': 'Nueva toma',
  'No KYC registry address on this run — set it in Runs to register clients on-chain.': 'Esta toma no tiene dirección de registro KYC — ponla en Tomas para registrar clientes on-chain.',
  'No clients yet.': 'Aún no hay clientes.',
  'No receipts yet — every step you run in the Exchange and User tabs lands here.': 'Aún no hay recibos — cada paso que ejecutes en las pestañas Exchange y Usuario aterriza aquí.',
  'No run selected — create one in Runs.': 'Ninguna toma seleccionada — crea una en Tomas.',
  'No runs yet.': 'Aún no hay tomas.',
  'No wallet on file — add your XRPL address at the exchange (E3) to withdraw.': 'Sin wallet registrada — añade tu dirección XRPL en el exchange (E3) para retirar.',
  'Note': 'Nota',
  'Nothing to unmint': 'Nada que desmintear',
  'Omnibus XRPL account (clients deposit here, with a tag)': 'Cuenta XRPL ómnibus (los clientes depositan aquí, con un tag)',
  'One Face ID: redeem + redeemWithTag → XRP back to the exchange, with my tag (read on-chain).': 'Un Face ID: redeem + redeemWithTag → el XRP vuelve al exchange, con mi tag (leído on-chain).',
  'One Face ID: redeem + unmint → XRP to my own wallet.': 'Un Face ID: redeem + unmint → XRP a mi propia wallet.',
  'One Face ID: redeem → FXRP stays in my account.': 'Un Face ID: redeem → el FXRP se queda en mi cuenta.',
  'One run = one council XRPL account (it births ONE pote) + one omnibus account (where clients deposit with a tag). Single-signature accounts are fine for a take. The council anchors its constitution and creates the pote in the Exchange tab.': 'Una toma = una cuenta XRPL de consejo (crea UN pote) + una cuenta ómnibus (donde los clientes depositan con un tag). Para una toma valen cuentas de firma única. El consejo ancla su constitución y crea el pote en la pestaña Exchange.',
  'Open my exchange account': 'Abrir mi cuenta en el exchange',
  'Passkeys are bound to the domain they were created on: record every take from the same URL.': 'Las passkeys quedan atadas al dominio donde se crearon: graba todas las tomas desde la misma URL.',
  'Paste the governance text (it never travels — only its SHA-256 is anchored), or paste the hash directly.': 'Pega el texto de gobierno (nunca viaja — solo se ancla su SHA-256), o pega el hash directamente.',
  'Pay a client out to their own wallet (exchange withdrawal)': 'Pagar a un cliente a su propia wallet (retirada del exchange)',
  'Pay the client out': 'Pagar al cliente',
  'Payout signed by the omnibus ({hash}). The watcher debits the ledger when the payment validates — press "Scan the omnibus".': 'Pago firmado por el ómnibus ({hash}). El vigía carga el libro cuando el pago se valida — pulsa «Escanear el ómnibus».',
  'Pick a client': 'Elige un cliente',
  'Pick your account': 'Elige tu cuenta',
  'Pote (the cage on Flare)': 'Pote (la jaula en Flare)',
  'Predicted pote': 'Pote previsto',
  'Proof document (.md)': 'Documento de prueba (.md)',
  'Put a client\'s XRP to work — the exchange signs, the shares are the client\'s': 'Poner a trabajar el XRP de un cliente — firma el exchange, las participaciones son del cliente',
  'Put the client capital to work': 'Poner a trabajar el capital del cliente',
  'Put to work': 'Poner a trabajar',
  'Read every receipt from the chain': 'Leer todos los recibos de la cadena',
  'Read the chain': 'Leer la cadena',
  'Refresh from the chain': 'Actualizar desde la cadena',
  'Register on-chain': 'Registrar on-chain',
  'Register your own XRPL wallet first (the exchange has it on file).': 'Registra antes tu propia wallet XRPL (el exchange la tiene en ficha).',
  'Registry': 'Registro',
  'Registry call sent. The chain will say approved + tag when it lands (Evidence → Read the chain).': 'Llamada al registro enviada. La cadena dirá aprobado + tag cuando aterrice (Evidencia → Leer la cadena).',
  'Relayer (gas)': 'Relayer (gas)',
  'Request recorded. The exchange executes it in the Exchange tab (E5); your shares appear here when the mint lands.': 'Petición registrada. El exchange la ejecuta en la pestaña Exchange (E5); tus participaciones aparecen aquí cuando aterriza el mint.',
  'Request withdrawal': 'Pedir retirada',
  'Runs': 'Tomas',
  'Scan the omnibus': 'Escanear el ómnibus',
  'Select or create a run first (Runs tab).': 'Selecciona o crea una toma primero (pestaña Tomas).',
  'Select or create a run first.': 'Selecciona o crea una toma primero.',
  'Send it from any XRPL wallet with that tag — or sign it here with your connected Xaman.': 'Envíalo desde cualquier wallet XRPL con ese tag — o fírmalo aquí con tu Xaman conectado.',
  'Set the KYC registry address on the run (Runs tab) first.': 'Pon antes la dirección del registro KYC en la toma (pestaña Tomas).',
  'Shares': 'Participaciones',
  'Sign with my Xaman': 'Firmar con mi Xaman',
  'Signed by the omnibus. The executor mints XRP → FXRP and deposits into the pote with the client as receiver (~2–5 min). Their shares will show in User → position.': 'Firmado por el ómnibus. El executor mintea XRP → FXRP y deposita en el pote con el cliente como receptor (~2–5 min). Sus participaciones saldrán en Usuario → posición.',
  'Signed. The executor mints the genesis and the pote is born on Flare in ~2–5 min. The receipt is in Evidence; read it from the chain when it lands.': 'Firmado. El executor mintea el génesis y el pote nace en Flare en ~2–5 min. El recibo está en Evidencia; léelo de la cadena cuando aterrice.',
  'Tag': 'Tag',
  'Take name': 'Nombre de la toma',
  'Take out everything with Face ID': 'Sacarlo todo con Face ID',
  'Take out — one Face ID': 'Sacar — un Face ID',
  'The XRPL address is not valid': 'La dirección XRPL no es válida',
  'The cage says no': 'La jaula dice que no',
  'The cage, live': 'La jaula, en vivo',
  'The client Flare account is not a valid 0x address': 'La cuenta Flare del cliente no es una dirección 0x válida',
  'The client XRPL address is not valid': 'La dirección XRPL del cliente no es válida',
  'The contracts, and what each permits — and does NOT': 'Los contratos, y qué permite cada uno — y qué NO',
  'The exchange authority: one XRPL account': 'La autoridad del exchange: una cuenta XRPL',
  'The exchange can move your capital between these venues only. It cannot take it out; only your signature redeems your shares.': 'El exchange solo puede mover tu capital entre estos destinos. No puede sacarlo; solo tu firma redime tus participaciones.',
  'The exchange has not opened its pote yet.': 'El exchange aún no ha abierto su pote.',
  'The exchange ledger holds {xrp} XRP for this client — it cannot put more to work than it holds.': 'El libro del exchange tiene {xrp} XRP de este cliente — no puede poner a trabajar más de lo que tiene.',
  'The exchange system on this page — client accounts, tags, the internal ledger — is simulated and labelled so. Everything that touches capital is real on Flare and XRPL mainnet and leaves a receipt you can read from the chain. Astryum plays the operator; no exchange uses this yet.': 'El sistema del exchange de esta página — cuentas de cliente, tags, el libro interno — es simulado y así se etiqueta. Todo lo que toca capital es real en Flare y XRPL mainnet y deja un recibo que puedes leer de la cadena. Astryum hace de operador; ningún exchange lo usa todavía.',
  'The exchange\'s normal withdrawal rail: a real XRPL payment from the omnibus to the client\'s own wallet, refused by the demo ledger if it cannot cover it.': 'El carril normal de retirada del exchange: un pago XRPL real del ómnibus a la propia wallet del cliente, rechazado por el libro demo si no puede cubrirlo.',
  'The mandate only moves capital between listed venues, above the buffer floor, under the cap. There is no other door — that is the product. Recorded in Evidence as proof.': 'El mandato solo mueve capital entre destinos listados, por encima del colchón, bajo el tope. No hay otra puerta — eso es el producto. Queda en Evidencia como prueba.',
  'The omnibus XRPL address is not valid': 'La dirección XRPL del ómnibus no es válida',
  'The omnibus: deposits by tag (watcher, read-only)': 'El ómnibus: depósitos por tag (vigía, solo lectura)',
  'The pote is born (one council signature)': 'Nace el pote (una firma del consejo)',
  'The pote is not born yet (E2).': 'El pote aún no ha nacido (E2).',
  'The registry address is not a valid 0x address': 'La dirección del registro no es una dirección 0x válida',
  'This account is not a client of the exchange yet. Open one (the exchange assigns your deposit tag), or link it to a client the exchange already created.': 'Esta cuenta aún no es cliente del exchange. Abre una (el exchange te asigna tu tag de depósito), o vincúlala a un cliente que el exchange ya haya creado.',
  'This client has no Flare account yet — they create it with Face ID in the User tab.': 'Este cliente aún no tiene cuenta Flare — la crea con Face ID en la pestaña Usuario.',
  'This pote has a cooldown: your shares burn now and the amount is fixed; you claim it when the clock ends. Nobody can stop it.': 'Este pote tiene espera: tus participaciones se queman ahora y el importe queda fijado; lo cobras cuando acaba el reloj. Nadie puede pararlo.',
  'Venues (allowlist)': 'Destinos (allowlist)',
  'What nobody can do, by bytecode: extract the principal (no such function), send capital off the allowlist, cross the buffer floor, or redeem for the client. The 30-day notice on any new venue is the client\'s exit window.': 'Lo que nadie puede hacer, por bytecode: extraer el principal (no existe la función), enviar capital fuera de la allowlist, cruzar el colchón, o redimir por el cliente. El aviso de 30 días de cualquier destino nuevo es la ventana de salida del cliente.',
  'Withdraw from the exchange to my wallet': 'Retirar del exchange a mi wallet',
  'Withdrawal requested. The exchange pays it out in the Exchange tab (E8).': 'Retirada pedida. El exchange la paga en la pestaña Exchange (E8).',
  'Working in the pote': 'Trabajando en el pote',
  'XRP at the exchange': 'XRP en el exchange',
  'XRP to put to work': 'XRP a poner a trabajar',
  'XRP ⇄ FXRP · 0xFE memo': 'XRP ⇄ FXRP · memo 0xFE',
  'XRPL · DIDSet': 'XRPL · DIDSet',
  'XRPL · SignerList': 'XRPL · SignerList',
  'XRPL · deposits by tag': 'XRPL · depósitos por tag',
  'Xaman · their own': 'Xaman · la suya',
  'XrplCouncilBridge': 'XrplCouncilBridge',
  'You are a client of the Demo Exchange here. Face ID once creates your on-chain account — that is where your shares live, in your name. You never touch a wallet, gas or FLR.': 'Aquí eres cliente del Demo Exchange. Un Face ID crea tu cuenta on-chain — ahí viven tus participaciones, a tu nombre. Nunca tocas una wallet, gas ni FLR.',
  'Your exchange account is ready. Your deposit tag is {tag}.': 'Tu cuenta en el exchange está lista. Tu tag de depósito es {tag}.',
  'Your on-chain account': 'Tu cuenta on-chain',
  'Your own XRPL wallet (optional, r… — for withdrawals)': 'Tu propia wallet XRPL (opcional, r… — para retiradas)',
  'Your wallet on file': 'Tu wallet en ficha',
  '{xrp} XRP from the omnibus → FXRP → deposit into the pote with receiver = {account}. Fees: {fees}.': '{xrp} XRP del ómnibus → FXRP → depósito en el pote con receptor = {account}. Comisiones: {fees}.',
  '…or link an existing client': '…o vincular un cliente existente',
  'anchored': 'anclada',
  'attests the XRPL payment': 'atestigua el pago XRPL',
  'buffer (free)': 'colchón (libre)',
  'buffer floor': 'colchón mínimo',
  'cage': 'jaula',
  'cap per venue': 'tope por destino',
  'check failed': 'comprobación fallida',
  'checks': 'comprobaciones',
  'constitution DID': 'DID de la constitución',
  'council (bridge)': 'consejo (bridge)',
  'deposit': 'depósito',
  'director': 'director',
  'e.g. take 4 — custodial': 'p. ej. toma 4 — custodial',
  'exchange': 'exchange',
  'exchange system · simulated': 'sistema del exchange · simulado',
  'explorer': 'explorador',
  'from → to': 'de → a',
  'hide checks': 'ocultar comprobaciones',
  'immediate exit': 'salida inmediata',
  'keep as FXRP in my account': 'quedármelo como FXRP en mi cuenta',
  'kind': 'tipo',
  'new movements credited': 'movimientos nuevos abonados',
  'no pote yet': 'aún sin pote',
  'no transaction — refused before signing': 'sin transacción — rechazado antes de firmar',
  // Una nota del libro no es una negativa de la jaula.
  'no transaction — a note in the book': 'sin transacción — nota del libro',
  'none — only the council': 'ninguno — solo el consejo',
  'not anchored': 'sin anclar',
  'not anchored yet': 'aún sin anclar',
  'not born yet': 'aún no ha nacido',
  'not read yet': 'sin leer aún',
  'not registered': 'sin registrar',
  'not verified yet': 'sin verificar aún',
  'omnibus': 'ómnibus',
  'other': 'otro',
  'pays gas · cannot decide': 'paga el gas · no decide',
  'pending Face ID': 'pendiente de Face ID',
  'policy': 'política',
  'pote': 'pote',
  'real · mainnet': 'real · mainnet',
  'receipts': 'recibos',
  'recorded, not read yet': 'registrado, sin leer aún',
  'refused before signing': 'rechazado antes de firmar',
  'return': 'retorno',
  'run': 'toma',
  'scanned': 'escaneado',
  'shares — yours, in your account': 'participaciones — tuyas, en tu cuenta',
  'simulated exchange · real chain': 'exchange simulado · cadena real',
  'simulated ledger, mirrors the XRPL': 'libro simulado, espejo del XRPL',
  'simulated · tag → balance': 'simulado · tag → saldo',
  'tag': 'tag',
  'to my own XRPL wallet': 'a mi propia wallet XRPL',
  'to my slot at the exchange (with my tag)': 'a mi casilla en el exchange (con mi tag)',
  'user': 'usuario',
  'venues': 'destinos',
  'when': 'cuándo',
  'with a failed check': 'con una comprobación fallida',
  // Exchange console + client surface (/app/admin/institutional/{exchange,client}) ---
  'Close profile': 'Cerrar perfil',
  'Close this exchange profile? Its ledger stays readable; the chain keeps its own record.': '¿Cerrar este perfil de exchange? Su libro sigue legible; la cadena guarda su propio registro.',
  'Council (governs the pote, signs every order)': 'Consejo (gobierna el pote, firma cada orden)',
  'Create the exchange profile': 'Crear el perfil del exchange',
  'Exchange name': 'Nombre del exchange',
  'Exchange profiles': 'Perfiles de exchange',
  'Give the exchange a name': 'Ponle nombre al exchange',
  'New exchange profile': 'Nuevo perfil de exchange',
  'No exchange profile selected.': 'Ningún perfil de exchange seleccionado.',
  'No exchange profiles yet.': 'Aún no hay perfiles de exchange.',
  'Omnibus (clients deposit here, with their tag)': 'Ómnibus (los clientes depositan aquí, con su tag)',
  'On-chain registry (optional)': 'Registro on-chain (opcional)',
  'One exchange = one council XRPL account (it governs ONE pote) + one omnibus account (where clients deposit with a tag). The council anchors its constitution and births the pote in Operate.': 'Un exchange = una cuenta XRPL de consejo (gobierna UN pote) + una cuenta ómnibus (donde los clientes depositan con tag). El consejo ancla su constitución y hace nacer el pote en Operar.',
  'none — entry is gated by the exchange itself': 'ninguno — la entrada la controla el propio exchange',
  'operating': 'operando',
  'since': 'desde',
  'Client surface →': 'Superficie del cliente →',
  'Create or select an exchange profile first.': 'Crea o selecciona antes un perfil de exchange.',
  'Exchange console': 'Consola del exchange',
  'Exchange console →': 'Consola del exchange →',
  'Finding your exchange…': 'Buscando tu exchange…',
  'My account': 'Mi cuenta',
  'No exchange is open for new accounts right now.': 'Ningún exchange admite cuentas nuevas ahora mismo.',
  'Open an account': 'Abrir una cuenta',
  'Opening your account…': 'Abriendo tu cuenta…',
  'Operator console →': 'Consola del operador →',
  'This device is not a client of any exchange yet. Choose the exchange to open your account with — your deposit tag is assigned there.': 'Este dispositivo aún no es cliente de ningún exchange. Elige con cuál abrir tu cuenta — tu tag de depósito se asigna allí.',
  'Your XRP at the exchange, working or not. Face ID once creates the on-chain account where your shares live — in your name. You never touch a wallet, gas or FLR.': 'Tu XRP en el exchange, trabajando o no. Un Face ID crea la cuenta on-chain donde viven tus participaciones — a tu nombre. Nunca tocas una wallet, gas ni FLR.',
  'Your controls, running on the ledger: who can deposit, who can order, what the capital may do, and what the client owns. Every action leaves a receipt you can read from the chain.': 'Tus controles, corriendo en el ledger: quién puede depositar, quién puede ordenar, qué puede hacer el capital y qué posee el cliente. Cada acción deja un recibo que puedes leer de la cadena.',
  'Your exchange': 'Tu exchange',
  'operator console': 'consola del operador',
  // ── Demo Exchange v2 · autopilot (la llave del exchange simulado) ─────────
  'Auto: put every deposit to work': 'Auto: poner a trabajar cada depósito',
  'Request sent. The exchange backend signs the mint on its next tick (~20 s); your shares appear here when the mint lands (~2–5 min).': 'Petición enviada. El backend del exchange firma el mint en su próximo tick (~20 s); tus participaciones aparecen aquí cuando aterriza el mint (~2–5 min).',
  'Withdrawal requested. The exchange backend pays it out to your wallet on its next tick.': 'Retirada pedida. El backend del exchange la paga a tu wallet en su próximo tick.',
  'A signed 0xFE is never re-sent: it stays "signed" until the MasterAccountController reports it consumed (delayed = wait), then "done". Refusals are receipts with their reason.': 'Un 0xFE firmado nunca se reenvía: queda «firmado» hasta que el MasterAccountController lo da por consumido (retrasado = esperar), y entonces «hecho». Las negativas son recibos con su motivo.',
  'Autopilot ON for this run — turn off': 'Autopilot ENCENDIDO para esta toma — apagar',
  'Caps (refuses above)': 'Topes (se niega por encima)',
  'Exchange backend (autopilot): the simulated exchange key fulfils client requests': 'Backend del exchange (autopilot): la llave del exchange simulado atiende las peticiones de los clientes',
  'Exchange key': 'Llave del exchange',
  'Loop': 'Bucle',
  'No client requests yet.': 'Aún no hay peticiones de clientes.',
  'SourceTag': 'SourceTag',
  'Tick now': 'Tick ahora',
  'Turn autopilot ON for this run': 'Encender el autopilot para esta toma',
  'autosign disabled (DEMO_EXCHANGE_AUTOSIGN_ENABLED)': 'autofirma apagada (DEMO_EXCHANGE_AUTOSIGN_ENABLED)',
  'does NOT open this run\'s omnibus': 'NO abre el ómnibus de esta toma',
  'every': 'cada',
  'hash / reason': 'hash / motivo',
  'last tick': 'último tick',
  'no seed on this environment': 'sin seed en este entorno',
  'opens this run\'s omnibus': 'abre el ómnibus de esta toma',
  'payment': 'pago',
  'running': 'en marcha',
  'seed unusable': 'seed inservible',
  'status': 'estado',
  'stopped': 'parado',
  // ── Planificar la jaula: los dos inmutables ────────────────
  // 'Of every' e 'in the vault, you could put' son fragmentos de UNA frase con
  // la cifra en medio. Si alguien los reescribe, que lea la frase entera en
  // VaultBirthPlanner antes de tocarlos. El resto son frases completas: se
  // partieron a proposito para no dejar una clave 'and' suelta en el diccionario.

  'Plan the cage': 'Planifica la jaula',
  'These two are set when the vault is born and nobody moves them afterwards — not you, not the council, not an amendment. Everything else about a vault can change; these cannot.':
    'Estos dos se fijan cuando nace la bóveda y después no los mueve nadie — ni tú, ni el consejo, ni una enmienda. Todo lo demás de una bóveda puede cambiar; esto no.',
  'Clients leave the moment they ask. In exchange you can only use venues that give the capital back immediately — anything that exits through a queue is off your menu.':
    'Tus clientes salen en el momento en que lo piden. A cambio solo puedes usar sitios que devuelven el capital al instante — todo lo que sale por cola queda fuera de tu menú.',
  'Long enough to unwind a venue that exits through a queue, so those stay available to you. Your clients wait this long after asking to leave.':
    'Suficiente para deshacer un sitio que sale por cola, así que esos te siguen disponibles. Tus clientes esperan esto desde que piden salir.',
  'Under a day is an awkward middle: your clients still wait, and it is not enough to unwind a venue that exits through a queue.':
    'Menos de un día es un término medio incómodo: tus clientes esperan igual, y no da para deshacer un sitio que sale por cola.',
  'Of every': 'De cada',
  'in the vault, you could put': 'en la bóveda, podrías poner',
  'to work — the rest always stays liquid so a client leaving never waits on your timing.':
    'a trabajar — el resto queda siempre líquido para que la salida de un cliente nunca dependa de que tú aciertes con el momento.',
  'At this level it stops being prudence and starts being a quarter of the vault that never works.':
    'A este nivel deja de ser prudencia y pasa a ser una cuarta parte de la bóveda que no trabaja nunca.',
  'You would be promising every future client: ask to leave and you wait':
    'Le estarías prometiendo a cada cliente futuro: pides salir y esperas',
  'And this much of the vault stays liquid for that exit, whatever I am doing with the rest:':
    'Y esta parte de la bóveda queda líquida para esa salida, haga yo lo que haga con el resto:',
  'Neither promise can be taken back.': 'Ninguna de las dos promesas se puede retirar.',
  'This screen decides, it does not sign: opening a vault with your own parameters is not wired yet, and a button here would open a cage you did not choose.':
    'Esta pantalla decide, no firma: abrir una bóveda con tus propios parámetros no está cableado todavía, y un botón aquí abriría una jaula que no elegiste.',
  // ── Correccion: los 30 dias son AVISO, no imposibilidad ────────
  // El texto anterior prometia que el gestor «nunca puede quedarse con tus
  // activos». En el pote v1 eso es FALSO — proposeVenue de un vault falso + 31
  // dias + directTo se lleva la mitad (AstryumCage.t.sol). Y en Bovedas con
  // gestor el gestor ES el consejo, asi que ese poder es suyo.
  'A manager puts your assets to work. You choose the vault and the risk — and the contract, not trust, keeps them to the parameters you signed.':
    'Un gestor pone tus activos a trabajar. Tú eliges la bóveda y el riesgo — y es el contrato, no la confianza, quien lo mantiene dentro de los parámetros que firmaste.',
  'A manager moves your capital only between destinations the vault already allows. Adding a new one is possible but takes 30 days before a single token can go there, which is your window to walk out.':
    'Un gestor mueve tu capital solo entre destinos que la bóveda ya permite. Añadir uno nuevo se puede, pero tarda 30 días antes de que pueda ir allí un solo token — y esa es tu ventana para marcharte.',
  'A new destination gives you 30 days to leave': 'Un destino nuevo te da 30 días para salir',
  'The person running the vault can add a destination, and that is the one power that could reach your capital. It cannot be used for 30 days — so the notice is the protection, and leaving in time is yours to do.':
    'Quien gobierna la bóveda puede añadir un destino, y ese es el único poder que podría alcanzar tu capital. No se puede usar durante 30 días — así que la protección es el aviso, y salir a tiempo te toca a ti.',
  'A new venue waits 30 days before any capital may enter it. Read that delay as NOTICE, not as impossibility: whoever governs this vault can add a destination, and that is the one power that could reach your capital. The 30 days are the month you have to leave first.':
    'Un sitio nuevo espera 30 días antes de que pueda entrar capital. Lee esa espera como AVISO, no como imposibilidad: quien gobierna esta bóveda puede añadir un destino, y ese es el único poder que podría alcanzar tu capital. Los 30 días son el mes que tienes para salir antes.',
  'Careful: this vault’s exit window is as long as that notice, so the month to leave is exactly the month you would need. Noticing a day late means not getting out before the new destination opens.':
    'Ojo: la ventana de salida de esta bóveda dura lo mismo que ese aviso, así que el mes para salir es exactamente el mes que necesitarías. Enterarte un día tarde es no llegar a salir antes de que el destino nuevo se abra.',
  // ── Bóvedas con gestor: catálogo, ficha y explicación ────────
  'Choose a vault': 'Elegir bóveda',
  'How managed vaults work': 'Cómo funcionan las bóvedas con gestor',
  'Worth two minutes before you put money anywhere near one.':
    'Merece dos minutos antes de acercar dinero a una.',
  'Keep it open': 'Déjalo abierto',
  'What the code does NOT do is stop you losing money. It keeps the manager inside the vault’s rules; it cannot keep a venue the vault allows from falling. That risk is exactly why you pick the vault and not them.':
    'Lo que el código NO hace es evitar que pierdas dinero. Mantiene al gestor dentro de las reglas de la bóveda; no puede impedir que caiga un sitio que la bóveda permite. Ese riesgo es justo la razón de que la bóveda la elijas tú y no él.',
  'Vaults open to new clients': 'Bóvedas abiertas a nuevos clientes',
  // El mosaico del catálogo: el dinero delante.
  'Yours': 'Tuyo',
  // Ajustes → Tus firmas: el recibo de la ceremonia legal.
  'Your signatures': 'Tus firmas',
  'What you accepted and read, with the version and the date. The texts are public pages; if one changes materially you will be asked to read and sign it again.':
    'Lo que aceptaste y leíste, con la versión y la fecha. Los textos son páginas públicas; si uno cambia de forma material se te pedirá leerlo y firmarlo de nuevo.',
  'Pending — the dashboard will ask you to read and sign before continuing.':
    'Pendiente — el panel te pedirá leer y firmar antes de continuar.',
  'Terms of use': 'Condiciones de uso',
  'Privacy notice': 'Aviso de privacidad',
  'accepted': 'aceptadas',
  'read': 'leído',
  'version': 'versión',
  'not signed yet': 'sin firmar todavía',
  'up to date': 'al día',
  'newer version pending': 'hay una versión nueva pendiente',
  'Read it again': 'Volver a leerlo',
  // Operar en mosaico: las tres puertas en columna.
  'move it': 'moverlo',
  'read it': 'leerla',
  'image, link, public page': 'imagen, enlace, página pública',
  // Mis Legacies como tarjetas de Wallets, con borrado en dos pasos.
  'Manage this Legacy': 'Gestionar este Legacy',
  'Stop tracking this Legacy': 'Dejar de seguir este Legacy',
  'This Legacy is here because the connected wallet is its council — there is no pointer to remove.':
    'Este Legacy está aquí porque la wallet conectada es su consejo — no hay ningún puntero que quitar.',
  'No vaults listed yet': 'Todavía no hay bóvedas listadas',
  'This is where vaults run by a manager will appear, with the rules each one enforces. Astryum lists them; it never manages and never recommends one.':
    'Aquí aparecerán las bóvedas que lleva un gestor, con las reglas que impone cada una. Astryum las lista; ni gestiona ni recomienda ninguna.',
  'Pick a vault — its cage, its destinations and who runs it unfold below.':
    'Elige una bóveda — su jaula, sus destinos y quién la lleva se despliegan debajo.',
  'Listed in no particular order — Astryum does not rank vaults.':
    'Sin orden particular — Astryum no clasifica bóvedas.',
  // ── La ficha de la bóveda ───────────────────────────────────
  'This vault': 'Esta bóveda',
  'Where this vault may take your capital': 'Adónde puede llevar tu capital esta bóveda',
  'This list is the whole cage: anywhere outside it, the contract reverts. Adding a new one takes 30 days, which is your month to leave if you do not like it.':
    'Esta lista es la jaula entera: fuera de ella, el contrato revierte. Añadir uno nuevo tarda 30 días, que son tu mes para salir si no te gusta.',
  'Astryum does not vouch for these destinations and does not name them: a familiar name over an address that is not really it is exactly what a fake venue would look like. Open each one in the explorer and check it yourself.':
    'Astryum no avala estos destinos ni les pone nombre: un nombre conocido sobre una dirección que no es la suya es exactamente la cara que pondría un sitio falso. Abre cada uno en el explorador y compruébalo tú.',
  'Lending market': 'Mercado de préstamo',
  'Vault (immediate exit)': 'Bóveda (salida inmediata)',
  'Vault (exit through a queue)': 'Bóveda (salida por cola)',
  'Who runs it': 'Quién la lleva',
  'The XRPL account that governs this vault. In a managed vault the manager is also its council, so this same account is the one that can add a destination — with the 30-day notice above.':
    'La cuenta XRPL que gobierna esta bóveda. En una bóveda con gestor, el gestor es también su consejo, así que esta misma cuenta es la que puede añadir un destino — con el aviso de 30 días de arriba.',
  'No credential shown for this account.': 'Esta cuenta no muestra ninguna credencial.',
  'The governing account could not be resolved for this vault.':
    'No se pudo resolver la cuenta que gobierna esta bóveda.',
  'Enter this vault': 'Entrar en esta bóveda',
  'Clients: a tag and a Flare account (KYC is the exchange own business)': 'Clientes: un tag y una cuenta Flare (el KYC es asunto del propio exchange)',
  'No on-chain registry on this run: entry is gated by the exchange itself, as in any exchange. Set a registry in Runs only if you want the gate written into the contract too.': 'Esta toma no tiene registro on-chain: la entrada la gatea el propio exchange, como en cualquier exchange. Pon un registro en Tomas solo si quieres además la puerta escrita en el contrato.',
  'Publish on-chain (optional)': 'Publicar on-chain (opcional)',
  'This is the part a real exchange already has: a backend with its hot key that watches the omnibus, credits deposits by tag and executes what its clients ask. Here that key belongs to the SIMULATED exchange — never to Astryum, never to a client — and it refuses by construction: only the Core Vault or a registered client wallet as destination, only the account of one of ITS OWN clients as the receiver of the shares, a per-payment cap and a daily cap. KYC is the exchange own business, as in any exchange; if the pote carries an on-chain gate, that gate has the last word.': 'Esta es la parte que un exchange real ya tiene: un backend con su llave caliente que vigila el ómnibus, abona los depósitos por tag y ejecuta lo que piden sus clientes. Aquí esa llave es del exchange SIMULADO — jamás de Astryum, jamás de un cliente — y se niega por construcción: solo el Core Vault o la wallet registrada de un cliente como destino, solo la cuenta de uno de SUS PROPIOS clientes como receptora de las participaciones, un tope por pago y un tope diario. El KYC es asunto del propio exchange, como en cualquier exchange; si el pote lleva puerta on-chain, esa puerta tiene la última palabra.',
  'free in your account (already taken out)': 'libre en tu cuenta (ya lo sacaste)',
  'Connect the omnibus account in Xaman to sign this — the connected one is a different account.': 'Conecta en Xaman la cuenta del ómnibus para firmar esto — la conectada es otra cuenta.',
  'Connect the omnibus account in Xaman to sign this.': 'Conecta en Xaman la cuenta del ómnibus para firmar esto.',
  'Connected in Xaman': 'Conectada en Xaman',
  'Signs': 'Firma',
  'nothing': 'nada',
  'the exchange omnibus (single signature, its own hot account)': 'el ómnibus del exchange (firma única, su propia cuenta caliente)',
  // ── Entrar, salir y el aviso que no se cierra ───────────────
  'This is not an ordinary vault.': 'Esto no es una bóveda normal.',
  'A person decides what happens to the capital inside it, day to day. The contract keeps them within the vault’s rules, but it cannot make their decisions good ones — you can lose money without anybody breaking a rule.':
    'Una persona decide qué pasa con el capital de dentro, día a día. El contrato la mantiene dentro de las reglas de la bóveda, pero no puede hacer que sus decisiones sean buenas — puedes perder dinero sin que nadie incumpla una regla.',
  'Not accredited': 'Sin acreditar',
  'This account shows no accreditation. A manager is required to hold one, so treat a vault without it as unresolved — not as approved.':
    'Esta cuenta no muestra acreditación. Un gestor está obligado a tener una, así que una bóveda sin ella queda sin resolver — no aprobada.',
  'Run by': 'La lleva',
  'manager unknown': 'gestor sin resolver',
  'destination': 'destino',
  'destinations': 'destinos',
  'Your position': 'Tu posición',
  'Connect your Flare wallet to see whether you are already in this vault.':
    'Conecta tu wallet de Flare para ver si ya estás en esta bóveda.',
  'You are not in this vault.': 'No estás en esta bóveda.',
  'Leave this vault': 'Salir de esta bóveda',
  'shares': 'participaciones',
  'Waiting for your signature…': 'Esperando tu firma…',
  'This vault has an exit window: your capital becomes claimable on':
    'Esta bóveda tiene plazo de salida: tu capital se podrá reclamar el',
  'Signed. Your position will show up here once the network confirms it.':
    'Firmado. Tu posición aparecerá aquí en cuanto la red lo confirme.',
  'Signed. If this vault has an exit window, the clock starts now.':
    'Firmado. Si esta bóveda tiene plazo de salida, el reloj empieza ahora.',
  'The per-account cap must be a number (0 = no cap).': 'El tope por cuenta tiene que ser un número (0 = sin tope).',
  'This account has no cage yet. One signature births it: a command contract that obeys only this account and never holds capital. Its potes can only work in destinations on the Astryum registry — the no-liquidation whitelist, which can grow.': 'Esta cuenta aún no tiene jaula. Una firma la hace nacer: un contrato de mando que obedece solo a esta cuenta y nunca guarda capital. Sus potes solo pueden trabajar en destinos del registro de Astryum — la lista sin liquidación, que puede crecer.',
  'Follow the Astryum registry as it stands each day (a venue approved tomorrow becomes available; one removed stops at once).': 'Seguir el registro de Astryum tal y como esté cada día (un destino aprobado mañana queda disponible; uno retirado deja de estarlo en el acto).',
  'Restrict this cage to its own eternal list — a subset of the registry, written once, never widened.': 'Restringir esta jaula a una lista propia y eterna — un subconjunto del registro, escrito una vez, que nunca se amplía.',
  'Destinations': 'Destinos',
  'follows the Astryum registry': 'sigue el registro de Astryum',
  'eternal': 'eternos',
  'Potes without creation fee left': 'Potes sin fee de creación restantes',
  'Max per account': 'Máximo por cuenta',
  '0 = no cap': '0 = sin tope',
  'Initial venues — from the Astryum registry (no-liquidation whitelist); more can be proposed later with a 30-day wait': 'Destinos iniciales — del registro de Astryum (lista sin liquidación); después se pueden proponer más, con 30 días de espera',
  'Could not read the registry right now — you can still open the pote without venues and propose them later.': 'No se ha podido leer el registro ahora mismo — puedes abrir el pote sin destinos y proponerlos después.',
  'No active venue on this chain yet.': 'Aún no hay ningún destino activo en esta cadena.',
  'This pote costs only gas.': 'Este pote solo cuesta el gas.',
  'The free potes are used up: this one pays the creation fee from your Flare account, straight to the Astryum treasury.': 'Los potes sin fee se han agotado: este paga la fee de creación desde tu cuenta de Flare, directa a la tesorería de Astryum.',
  'no cap': 'sin tope',
  'entries only; exits are never blocked': 'solo entradas; salir nunca se bloquea',
  'Set cap': 'Fijar tope',
  // ── Cobrar la salida y los guardas del modal ───────────────
  'Claim what is due': 'Cobrar lo que te toca',
  'This exit has matured. Claiming moves the capital to your wallet.':
    'Esta salida ha madurado. Cobrarla mueve el capital a tu wallet.',
  'This exit ticket is missing its number.': 'A este ticket de salida le falta su número.',
  'Signed. The capital is on its way to your wallet.':
    'Firmado. El capital va de camino a tu wallet.',
  'ready to claim': 'lista para cobrar',
  'claimable on': 'se cobra el',
  'waiting': 'esperando',
  'That is more than you hold.': 'Eso es más de lo que tienes.',
  'Your wallet is on another network. This vault lives on Flare.':
    'Tu wallet está en otra red. Esta bóveda vive en Flare.',
  'You need the vault’s asset already in your Flare wallet. Coming from XRP on the XRPL means bridging first — that step does not live in this modal yet.':
    'Necesitas el activo de la bóveda ya en tu wallet de Flare. Si vienes con XRP en el XRPL hay que puentear antes — ese paso todavía no vive en este modal.',
  // ── Los dos carriles para entrar: Flare o XRP ──────────────
  'I have it on Flare': 'Ya lo tengo en Flare',
  'I have XRP': 'Tengo XRP',
  'One signature in your Flare wallet. You need the vault’s asset already there.':
    'Una firma en tu wallet de Flare. Necesitas el activo de la bóveda ya ahí.',
  'One signature in Xaman. Your XRP travels to Flare, becomes the vault’s asset and goes in — all in the same move.':
    'Una firma en Xaman. Tu XRP viaja a Flare, se convierte en el activo de la bóveda y entra — todo en el mismo movimiento.',
  'Connect your XRPL account (Xaman) to continue': 'Conecta tu cuenta XRPL (Xaman) para continuar',
  'vaults under this account': 'bóvedas bajo esta cuenta',
  // ── De la otra sesión (jaula v2, mesa del gestor). Traducidas para no dejar
  // la rama roja; conviene que su autor las revise — es copy de producto.
  'A vault you run': 'Una bóveda que llevas',
  'Governed through the cage': 'Gobernada a través de la jaula',
  'One cage per XRPL account, as many potes as you need.':
    'Una jaula por cuenta XRPL, y tantos potes como necesites.',
  'Opening one is two orders from this account: birth your cage (one signature; it holds no capital and obeys only you), then open a pote with your own parameters. Here is what it takes, and below, the console that does it.':
    'Abrir una son dos órdenes desde esta cuenta: hacer nacer tu jaula (una firma; no guarda capital y solo te obedece a ti) y después abrir un pote con tus propios parámetros. Esto es lo que hace falta, y debajo, la consola que lo hace.',
  'The factory reverts on a second cage. The first three potes cost only gas; from the fourth on, the creation fee goes straight to the Astryum treasury.':
    'La factory revierte en una segunda jaula. Los tres primeros potes solo cuestan gas; a partir del cuarto, la fee de creación va directa a la tesorería de Astryum.',
  'Which venues it allows — only from the Astryum registry —, how long its exit takes, how much may sit in any one place, how much any one account may hold. Once set, it binds you too.':
    'Qué sitios permite —solo del registro de Astryum—, cuánto tarda su salida, cuánto puede haber en un solo sitio y cuánto puede tener una sola cuenta. Una vez puesta, te ata a ti también.',
  'max per account': 'máx. por cuenta',
  // ── El orden como GESTO del usuario, nunca de la pantalla ─────
  'Catalogue order': 'Orden del catálogo',
  'Shortest exit': 'Salida más corta',
  'Fewest destinations': 'Menos destinos',
  'Most capital': 'Más capital',
  'Listed in the order the chain returns them — Astryum does not rank vaults.':
    'En el orden en que los devuelve la cadena — Astryum no clasifica bóvedas.',
  'You chose this order. It is a filter, not a recommendation.':
    'Este orden lo elegiste tú. Es un filtro, no una recomendación.',
  'Astryum does not vouch for these destinations and does not name them: a familiar name over an address that is not really it is exactly what a fake venue would look like. Open each one in the explorer and check it yourself before putting money in.':
    'Astryum no avala estos destinos ni les pone nombre: un nombre conocido sobre una dirección que no es la suya es exactamente la cara que pondría un sitio falso. Abre cada uno en el explorador y compruébalo tú antes de meter dinero.',
  'This vault caps what any one account may hold at': 'Esta bóveda limita lo que una sola cuenta puede tener a',
  'The manager takes no cut — all realized yield capitalizes back into the vault.':
    'El gestor no se lleva ningún corte — todo el rendimiento realizado capitaliza de vuelta en la bóveda.',
  'The manager keeps': 'El gestor se lleva',
  'of the realized yield — never your principal; capped at creation and read from the ledger, not a promise.':
    'del rendimiento realizado — nunca tu principal; con techo fijado al crearla y leído del ledger, no una promesa.',
  // ── UI polish del lazo de managed vaults: inglés colado en pantalla castellana ──
  'Already in your account': 'Ya en tu cuenta',
  'Claiming to': 'Cobrando a',
  'Connect your Flare wallet — or pick your XRPL wallet above to enter with XRP':
    'Conecta tu wallet de Flare — o elige arriba tu wallet XRPL para entrar con XRP',
  'Flare': 'Flare',
  'Part of your position stays in the vault — you can take the rest out later.':
    'Parte de tu posición se queda en la bóveda — el resto lo puedes sacar más tarde.',
  'Receive as': 'Recibir como',
  'Redeem the shares held by this Flare wallet — one signature here.':
    'Rescata las participaciones de esta wallet de Flare — una firma aquí.',
  'Stays in your account': 'Se queda en tu cuenta',
  'The live share price, cap and exit terms are read on-chain and shown before you sign.':
    'El precio de la participación, el tope y las condiciones de salida se leen on-chain y se muestran antes de que firmes.',
  'This ticket is claimed by the XRPL account that owns it — connect or link that wallet to sign in Xaman.':
    'Este ticket lo cobra la cuenta XRPL que lo posee — conecta o vincula esa wallet para firmar en Xaman.',
  'This vault has an exit window: your shares burn now and the amount is fixed. Claimable on':
    'Esta bóveda tiene ventana de salida: tus participaciones se queman ya y el importe queda fijado. Cobrable el',
  'Unmint to native XRP': 'Unmint a XRP nativo',
  'Uses the FXRP already in your Personal Account — no mint, just the small 0xFE carrier.':
    'Usa el FXRP que ya hay en tu Personal Account — sin mint, solo el pequeño peaje 0xFE.',
  'Your shares live in this account’s Smart Account: one Xaman signature redeems them and sends XRP back to you.':
    'Tus participaciones viven en el Smart Account de esta cuenta: una firma en Xaman las rescata y te devuelve el XRP.',
  'the account that deposited and withdrew': 'la cuenta que depositó y retiró',
  'the account that holds these shares.': 'la cuenta que tiene estas participaciones.',
  'you collect it here when it matures (as FXRP in your account, or unmint to XRP then).':
    'lo cobras aquí cuando venza (como FXRP en tu cuenta, o haces Unmint a XRP entonces).',
  'Reading your positions from the chain…': 'Leyendo tus posiciones de la cadena…',
  'The chain could not be read right now — that is not the same as having none. Try again in a moment.':
    'No se ha podido leer la cadena ahora mismo — eso no es lo mismo que no tener ninguna. Prueba de nuevo en un momento.',
  'Vaults where you hold shares — across all your linked wallets and their Smart Accounts. The manager is a third party; only your signature moves your capital.':
    'Bóvedas donde tienes participaciones — en todas tus wallets vinculadas y sus Smart Accounts. El gestor es un tercero; solo tu firma mueve tu capital.',
  'Your wallet': 'Tu wallet',
  'Collect it to your account': 'Cóbralo a tu cuenta',
  'Pending to withdraw': 'Pendiente de retirar',
  'when the window ends': 'cuando termine la ventana',
  'Could not read this vault right now — that says nothing about what is inside.': 'No se ha podido leer esta bóveda ahora mismo — eso no dice nada de lo que hay dentro.',
  'The catalogue could not be read right now — showing the fixed demo potes instead.': 'No se ha podido leer el catálogo ahora mismo — se muestran los potes fijos de la demo.',
  'The director must be an EVM address (0x…).': 'El director tiene que ser una dirección EVM (0x…).',
  'Days must be a whole number between 1 and 365.': 'Los días tienen que ser un entero entre 1 y 365.',
  'Pick a venue from the registry.': 'Elige un destino del registro.',
  'The payee must be an EVM address (0x…).': 'El beneficiario tiene que ser una dirección EVM (0x…).',
  'The cut must be between 1 and': 'La comisión tiene que estar entre 1 y',
  'Director': 'Director',
  'until': 'hasta',
  'nobody — this account runs it by order': 'nadie — esta cuenta la dirige por orden',
  'Name a director': 'Nombrar un director',
  'An EVM address that may direct and recall capital between the venues that already exist — with MetaMask, no toll per order. It cannot add venues, change the cut or open potes. It expires by itself.': 'Una dirección EVM que puede dirigir y recuperar capital entre los destinos que ya existen — con MetaMask, sin peaje por orden. No puede añadir destinos, cambiar la comisión ni abrir potes. Caduca sola.',
  'Days': 'Días',
  'Name director': 'Nombrar director',
  'End cession': 'Retirar la cesión',
  'Propose a venue (from the Astryum registry; 30-day wait before it can receive capital)': 'Proponer un destino (del registro de Astryum; 30 días de espera antes de que pueda recibir capital)',
  'Every active venue of the registry is already in this pote.': 'Todos los destinos activos del registro ya están en este pote.',
  'Pick a venue': 'Elige un destino',
  'Propose': 'Proponer',
  'Your cut of the yield': 'Tu comisión sobre el rendimiento',
  'today': 'hoy',
  'none (everything capitalizes for depositors)': 'ninguna (todo capitaliza para los depositantes)',
  'empty = no cut': 'vacío = sin comisión',
  'Set cut': 'Fijar comisión',
  'In bps of the yield only, never of the principal; the cap of this generation is': 'En bps solo del rendimiento, nunca del principal; el tope de esta generación es',
  'DRY RUN — a local fork. Nothing here is real: no capital, no signatures, no chain.': 'ENSAYO — un fork local. Nada de esto es real: ni capital, ni firmas, ni cadena.',
  'The rehearsal backend is not answering': 'El backend del ensayo no responde',
  'Start it with': 'Arráncalo con',
  'and the env it prints.': 'y el env que imprime.',
  'Reading the cast…': 'Leyendo el reparto…',
  'Acting as (the "Run dry" buttons sign as this actor):': 'Actúas como (los botones «en seco» firman como este actor):',
  '+100 FXRP': '+100 FXRP',
  'Refresh': 'Refrescar',
  'Birth it dry (fork, no signature)': 'Nacer en seco (fork, sin firma)',
  'Run it dry (fork, no signature)': 'Ejecutar en seco (fork, sin firma)',
  'Dry run: your cage was born on the fork.': 'Ensayo: tu jaula ha nacido en el fork.',
  'Dry run: the order executed on the fork — same calldata, impersonated bridge, no FDC round.': 'Ensayo: la orden se ejecutó en el fork — misma calldata, bridge impersonado, sin ronda FDC.',
  'Pick an actor in the DRY RUN band (or connect a wallet).': 'Elige un actor en la banda de ENSAYO (o conecta una wallet).',
  'Entry gate (the partner’s KYC registry): only approved receivers may enter. Exits are never gated.': 'Puerta de entrada (el registro KYC del partner): solo receptores aprobados pueden entrar. Salir nunca tiene puerta.',
  'Point gate': 'Apuntar puerta',
  'Open to everyone': 'Abrir a todos',
  'KYC partner': 'Partner KYC',
  'KYC partner desk': 'Mesa del partner KYC',
  'Your registry, your clients': 'Tu registro, tus clientes',
  'The partner is the admin of its own on-chain registry. A manager points a vault at it (entry gate) and from then on the vault itself refuses any deposit whose receiver you have not approved. Astryum composes the call and never signs it.': 'El partner es el admin de su propio registro on-chain. Un gestor apunta su bóveda a él (puerta de entrada) y desde entonces la propia bóveda rechaza cualquier depósito cuyo receptor no hayas aprobado. Astryum compone el call y jamás lo firma.',
  'Registry address (ExchangeKycRegistry)': 'Dirección del registro (ExchangeKycRegistry)',
  'Deploy a rehearsal registry (dry run, you become admin)': 'Desplegar un registro de ensayo (en seco; tú eres el admin)',
  'Client EVM account (receives the shares)': 'Cuenta EVM del cliente (recibe las participaciones)',
  'XRPL destination tag': 'Destination tag XRPL',
  'Approve client': 'Aprobar cliente',
  'Revoke': 'Revocar',
  'Check status': 'Comprobar estado',
  'is approved in this registry.': 'está aprobado en este registro.',
  'is NOT approved in this registry.': 'NO está aprobado en este registro.',
  'Registry deployed on the fork; you are its admin.': 'Registro desplegado en el fork; eres su admin.',
  'Client approved on the fork.': 'Cliente aprobado en el fork.',
  'Client revoked on the fork.': 'Cliente revocado en el fork.',
  'Sent to your wallet — the registry admin signs; Astryum never does.': 'Enviado a tu wallet — firma el admin del registro; Astryum jamás.',
  'Connect the admin EVM wallet of this registry to sign.': 'Conecta la wallet EVM admin de este registro para firmar.',
  'The registry must be an EVM address (0x…).': 'El registro tiene que ser una dirección EVM (0x…).',
  'The client must be an EVM address (0x…) — the account that RECEIVES the shares.': 'El cliente tiene que ser una dirección EVM (0x…) — la cuenta que RECIBE las participaciones.',
  'The tag must be a 32-bit integer (0 … 4294967295).': 'El tag tiene que ser un entero de 32 bits (0 … 4294967295).',
  'Registry and client must be EVM addresses (0x…).': 'Registro y cliente tienen que ser direcciones EVM (0x…).',
  'The live check reads on-chain from the vault card; this button is for the dry run.': 'En vivo el estado se lee on-chain desde la ficha de la bóveda; este botón es del ensayo.',
  'The XRPL credential («Verified by X») is a separate, XRPL-native label the manager accepts in their own account — it never gates deposits by itself and Astryum never issues it.': 'La credencial XRPL («Verificado por X») es una etiqueta aparte, nativa de XRPL, que el gestor acepta en su propia cuenta — por sí sola nunca cierra depósitos, y Astryum jamás la emite.',
  'The XRP rail mints FXRP through XRPL + FDC — a real-rail step a local fork cannot run. In the dry run, enter through the Flare rail (FXRP directly); the XRP on-ramp is for the mainnet rehearsal.': 'El carril XRP mintea FXRP por XRPL + FDC — un paso de carril real que un fork local no puede ejecutar. En el ensayo, entra por el carril Flare (FXRP directo); la rampa de XRP es para el rodaje en mainnet.',

  // ── Contacto con el sitio (VenueContact) ──
  // El nombre del venue va FUERA de la clave, delante, en los dos idiomas:
  // «Kinetic built this — Astryum did not.» / «Kinetic lo construyó — Astryum
  // no.» Meterlo dentro obligaría a una clave por protocolo.
  'built this — Astryum did not.': 'lo construyó — Astryum no.',
  'Where to ask them': 'Dónde preguntarles',
  'their own channels': 'sus propios canales',
  'It publishes no channel we can link to.': 'No publica ningún canal que podamos enlazar.',
  'Checking your manager credential…': 'Comprobando tu credencial de gestor…',
  'Manager credential in force': 'Credencial de gestor vigente',
  'The ledger recognises your title, so your orders pass. It is a third party’s attestation, not Astryum’s — and it expires, so keep it renewed.': 'El ledger reconoce tu título, así que tus órdenes pasan. Es la atestación de un tercero, no de Astryum — y caduca, así que mantenla renovada.',
  'Manager credential required': 'Hace falta credencial de gestor',
  'A grouped, pro-rata vault is a collective vehicle: running one takes a valid manager credential': 'Una bóveda agrupada, pro-rata, es un vehículo colectivo: gobernarla exige una credencial de gestor vigente',
  'This account does not hold one yet, so the ledger will refuse its orders.': 'Esta cuenta todavía no la tiene, así que el ledger rechazará sus órdenes.',
  'Astryum never issues or verifies it. Request it from an accredited issuer; when it is granted, accept it in your credential tray below (that signature is yours). It attests your title off-ledger — no document ever goes on-chain.': 'Astryum no la emite ni la verifica. Pídesela a un emisor acreditado; cuando te la concedan, acéptala en tu bandeja de credenciales de abajo (esa firma es tuya). Atestigua tu título off-ledger — ningún documento va nunca a la cadena.',
  'Accepted issuers': 'Emisores acreditados',
  'No accredited issuer is configured yet — this is the partner still to be lined up.': 'Aún no hay ningún emisor acreditado configurado — este es el partner que queda por conseguir.',
  'Accepted issuers (on-ledger, XLS-70)': 'Emisores acreditados (on-ledger, XLS-70)',
  'Or present your partner credential (off-ledger)': 'O presenta tu credencial del partner (off-ledger)',
  'The partner verified your title off-chain and signed a credential. Paste it here (it stays in this browser) and it travels with your orders. No document goes on-chain.': 'El partner verificó tu título off-chain y firmó una credencial. Pégala aquí (se queda en este navegador) y viaja con tus órdenes. Ningún documento va a la cadena.',
  'Save credential': 'Guardar credencial',
  'Credential type': 'Tipo de credencial',
  'depositant': 'depositante',
  'manager title': 'título de gestor',
  'exchange licence': 'licencia de exchange',
  'treasury appointment': 'designación de la caja',
  'company registration': 'registro de la sociedad',
  'Open a policy A pote — immediate exit (council order)': 'Abrir un pote de política A — salida inmediata (orden de consejo)',
  'This pote has a 72-hour exit window: a client exit burns the shares now and the XRP is claimed after the window — the client app has no claim step yet. For the take, open a policy A pote; this one stays, with no capital.':
    'Este pote tiene una ventana de salida de 72 h: la salida de un cliente quema las participaciones ahora y el XRP se cobra al vencer — la app del cliente aún no tiene paso de cobro. Para la toma, abre un pote de política A; este se queda, sin capital.',
  'Your clients — they sign up themselves; here you watch them': 'Tus clientes — se dan de alta solos; aquí los ves',
  'A client opens your client site, creates their account with Face ID and appears here with their tag — nobody has to enrol them. KYC is the exchange own business, as in any exchange.':
    'Un cliente entra en tu sitio de cliente, crea su cuenta con Face ID y aparece aquí con su tag — nadie tiene que darlo de alta. El KYC es asunto del exchange, como en cualquier exchange.',
  'Create one by hand (invite or demo)': 'Crear uno a mano (invitación o demo)',
  'No clients yet — the first one appears the moment somebody signs up on your client site.':
    'Aún no hay clientes — el primero aparece en cuanto alguien se dé de alta en tu sitio de cliente.',
  'Your first client': 'Tu primer cliente',
  "The client opens your client site, creates their account with Face ID and appears on the desk with their deposit tag — you enrol nobody. Creating one by hand is there for an invite or a demo. KYC is the exchange's own business.":
    'El cliente entra en tu sitio de cliente, crea su cuenta con Face ID y aparece en la mesa con su tag de depósito — tú no das de alta a nadie. Crear uno a mano está para una invitación o una demo. El KYC es asunto del exchange.',
  // ── La constitución del EXCHANGE — solo las cláusulas nuevas; las
  // compartidas con la del gestor reutilizan sus claves de siempre. ──
  'CONSTITUTION OF A CUSTODIAL EXCHANGE ON THE RAIL': 'CONSTITUCIÓN DE UN EXCHANGE CUSTODIAL SOBRE EL RAÍL',
  'Root XRPL account (the exchange authority)': 'Cuenta XRPL raíz (la autoridad del exchange)',
  'Operating cash account (omnibus), by on-ledger appointment — initial': 'Cuenta de caja operativa (omnibus), por designación en el ledger — inicial',
  'Exchange (name or entity)': 'Exchange (nombre o entidad)',
  'Company registration (KYB) and licence (CASP), as anchored credentials of the root': 'Registro de la sociedad (KYB) y licencia (CASP), como credenciales ancladas de la raíz',
  'Jurisdiction of the exchange': 'Jurisdicción del exchange',
  'This document sets the rules under which the exchange named above holds its clients’ XRP and puts it to work on their behalf. The parts the smart contracts and the XRP Ledger enforce are stated as facts; the rest are commitments the exchange makes and can be held to. Only the fingerprint of this text is anchored on the XRP Ledger; the text itself lives off-chain and anyone can verify it against that fingerprint.':
    'Este documento fija las reglas bajo las que el exchange arriba nombrado custodia el XRP de sus clientes y lo pone a trabajar por cuenta de ellos. Lo que los contratos y el XRP Ledger hacen cumplir se enuncia como hecho; el resto son compromisos del exchange que se le pueden exigir. Solo la huella de este texto se ancla en el XRP Ledger; el texto vive off-chain y cualquiera puede verificarlo contra esa huella.',
  'The exchange offers its clients custody of XRP and, at their request, puts it to work in a grouped vault on Flare governed from the root account above through its cage. Each client is identified inside the exchange by a destination tag.':
    'El exchange ofrece a sus clientes custodia de XRP y, a petición suya, lo pone a trabajar en una bóveda agrupada en Flare gobernada desde la cuenta raíz de arriba a través de su jaula. Cada cliente se identifica dentro del exchange por un destination tag.',
  'The shares that working capital produces are NEVER the exchange’s: they are minted directly to each client’s own Flare account, and only that client’s signature can move or redeem them.':
    'Las participaciones que produce el capital trabajando JAMÁS son del exchange: se acuñan directamente en la cuenta Flare propia de cada cliente, y solo la firma de ese cliente puede moverlas o redimirlas.',
  'The root — authority and credentials': 'La raíz — autoridad y credenciales',
  'The exchange is identified by the root account above. Every act of governance — anchoring this document, giving birth to the cage, opening vaults, directing capital, appointing the cash account — carries that account’s signature and is public on the ledger.':
    'El exchange se identifica por la cuenta raíz de arriba. Cada acto de gobierno — anclar este documento, parir la jaula, abrir bóvedas, dirigir capital, designar la cuenta de caja — lleva la firma de esa cuenta y es público en el ledger.',
  'The root holds, and keeps in force, its credentials as XLS-70 objects: the licence of its sector (CASP) and the registration of its legal vehicle (KYB), each carrying the public register link as its evidence. Whoever relies on them opens the link and checks the register themselves.':
    'La raíz sostiene, y mantiene vigentes, sus credenciales como objetos XLS-70: la licencia de su sector (CASP) y el registro de su vehículo legal (KYB), cada una con el enlace del registro público como su evidencia. Quien confíe en ellas abre el enlace y comprueba el registro por su cuenta.',
  'If the root’s credentials lapse or are revoked, the ledger stops accepting its governance orders; clients’ exits remain unaffected.':
    'Si las credenciales de la raíz caducan o se revocan, el ledger deja de aceptar sus órdenes de gobierno; las salidas de los clientes no se ven afectadas.',
  'The operating cash account — the omnibus': 'La cuenta de caja operativa — el omnibus',
  'Clients deposit XRP at the omnibus account, identified by their destination tag. The omnibus signs the payments that put capital to work and the payouts back to clients’ own wallets — and nothing else.':
    'Los clientes depositan XRP en la cuenta omnibus, identificados por su destination tag. El omnibus firma los pagos que ponen el capital a trabajar y los reintegros a las wallets propias de los clientes — y nada más.',
  'The omnibus is defined by APPOINTMENT, not by address: it is the account that holds a live OMNIBUS credential issued by the root, renewed periodically. The account named above is the initial appointee.':
    'El omnibus se define por DESIGNACIÓN, no por dirección: es la cuenta que sostiene una credencial OMNIBUS vigente emitida por la raíz, renovada periódicamente. La cuenta arriba nombrada es la designada inicial.',
  'Changing the omnibus is an appointment act — a revocation and a new credential, both public on the ledger — announced to clients in advance. Deposit instructions always name the currently appointed account.':
    'Cambiar el omnibus es un acto de designación — una revocación y una credencial nueva, ambas públicas en el ledger — anunciado a los clientes con antelación. Las instrucciones de depósito nombran siempre la cuenta designada vigente.',
  'Revoking the appointment, or letting it lapse, halts the cash desk: no new capital is put to work and no payout is signed from that account. It never touches a client’s on-chain exit.':
    'Revocar la designación, o dejarla caducar, para la caja: no se pone capital nuevo a trabajar ni se firma reintegro alguno desde esa cuenta. Jamás toca la salida on-chain de un cliente.',
  'Capital put to work may go ONLY inside the cage: to destinations listed in the venue registry, within the per-destination cap, above the liquidity floor and respecting the exit window. These limits bind the exchange by construction; the contract refuses any order outside them.':
    'El capital puesto a trabajar solo puede ir DENTRO de la jaula: a destinos listados en el registro de venues, dentro del tope por destino, por encima del suelo de liquidez y respetando la ventana de salida. Estos límites atan al exchange por construcción; el contrato rechaza cualquier orden fuera de ellos.',
  'The exchange does not borrow against the vault, does not pledge its assets, and does not use clients’ working capital for any purpose other than the destinations allowed.':
    'El exchange no toma prestado contra la bóveda, no pignora sus activos y no usa el capital trabajando de los clientes para ningún fin distinto de los destinos permitidos.',
  'The exchange never asks a client to approve the exchange, an operator or any third party over the client’s shares. Any such request is outside this mandate and must be treated as an attack.':
    'El exchange jamás pide a un cliente que apruebe al exchange, a un operador o a un tercero sobre las participaciones del cliente. Cualquier petición así queda fuera de este mandato y debe tratarse como un ataque.',
  'Clients’ rights': 'Derechos de los clientes',
  'A client’s shares live in the client’s own account from the first block. The client exits the vault with their OWN signature, without any key, permission or availability of the exchange — that exit is never blocked, never gated and never capped.':
    'Las participaciones del cliente viven en su propia cuenta desde el primer bloque. El cliente sale de la bóveda con SU firma, sin ninguna llave, permiso ni disponibilidad del exchange — esa salida jamás se bloquea, jamás se gatea y jamás se capa.',
  'The value a client redeems returns to the omnibus tagged as theirs and is credited to their balance; on request, the exchange pays it out to the client’s own XRPL wallet.':
    'El valor que un cliente redime vuelve al omnibus etiquetado como suyo y se acredita a su saldo; a petición, el exchange lo paga a la wallet XRPL propia del cliente.',
  'The exit window and the liquidity floor are fixed when the vault is born and cannot be changed afterwards — not by the exchange, not by any council, not by an amendment to this document.':
    'La ventana de salida y el suelo de liquidez se fijan al nacer la bóveda y no pueden cambiarse después — ni por el exchange, ni por consejo alguno, ni por una enmienda a este documento.',
  'Every rule that governs a vault is readable on-chain by anyone, at any time, without asking the exchange.':
    'Toda regla que gobierna una bóveda es legible on-chain por cualquiera, en cualquier momento, sin pedírselo al exchange.',
  'Custody and compliance': 'Custodia y compliance',
  'The exchange custodies the XRP balances at the omnibus and keeps the books that attribute them by tag. Its legal duties as custodian — including any freeze the law requires — apply to what it custodies, and only to that: they never reach a client’s shares or their on-chain exit.':
    'El exchange custodia los saldos de XRP en el omnibus y lleva los libros que los atribuyen por tag. Sus deberes legales como custodio — incluida cualquier congelación que la ley exija — aplican a lo que custodia, y solo a eso: jamás alcanzan las participaciones de un cliente ni su salida on-chain.',
  'The exchange verifies its clients before serving them. Verification stays in the exchange’s books; the ledger carries only what is granted — never a refusal, never a document, never personal data.':
    'El exchange verifica a sus clientes antes de servirles. La verificación se queda en los libros del exchange; el ledger lleva solo lo concedido — jamás un rechazo, jamás un documento, jamás datos personales.',
  'Every fee the exchange charges is published and disclosed to the client before they act. No hidden fee.':
    'Toda comisión que cobra el exchange está publicada y se muestra al cliente antes de actuar. Ninguna comisión oculta.',
  'Capital at work, destinations, floor, window and every governance order are facts on the chain. The exchange’s reporting consists of those facts and never of projections.':
    'El capital trabajando, los destinos, el suelo, la ventana y cada orden de gobierno son hechos en la cadena. El reporting del exchange consiste en esos hechos y jamás en proyecciones.',
  'The exchange publishes a public profile (name, entity, contact, credential links) tied to the root account and keeps it truthful.':
    'El exchange publica un perfil público (nombre, entidad, contacto, enlaces de las credenciales) atado a la cuenta raíz y lo mantiene veraz.',
  'No amendment can change what the contract fixed at birth (exit window, liquidity floor, fee ceiling) nor weaken Articles 3.4 and 5.':
    'Ninguna enmienda puede cambiar lo que el contrato fijó al nacer (ventana de salida, suelo de liquidez, techo de comisión) ni debilitar los artículos 3.4 y 5.',
  'The exchange announces an amendment to clients before anchoring it, with enough time for anyone who disagrees to exit under the current rules.':
    'El exchange anuncia una enmienda a los clientes antes de anclarla, con tiempo suficiente para que quien no esté de acuerdo salga bajo las reglas vigentes.',
  'The exchange may wind the vault down by retiring all destinations and recalling capital, so every client can exit at pro-rata value and be paid out. The exchange cannot seize, sweep or redirect a client’s shares.':
    'El exchange puede liquidar la bóveda retirando todos los destinos y recuperando el capital, para que cada cliente salga a valor pro-rata y sea pagado. El exchange no puede incautar, barrer ni redirigir las participaciones de un cliente.',
  'This constitution is governed by the law of the exchange’s jurisdiction stated above. Nothing in it limits the rights clients have under the law that protects them.':
    'Esta constitución se rige por la ley de la jurisdicción del exchange arriba indicada. Nada en ella limita los derechos que los clientes tienen bajo la ley que los protege.',
  'Signed by anchoring from the root account': 'Firmada por anclaje desde la cuenta raíz',
  'KYB — the registration of your legal vehicle': 'KYB — el registro de tu vehículo legal',
  'Issue KYB without a link (demo)': 'Emitir KYB sin enlace (demo)',
  'CASP (your licence) and KYB (your legal vehicle), issued to THIS account and accepted in Xaman':
    'CASP (tu licencia) y KYB (tu vehículo legal), emitidas a ESTA cuenta y aceptadas en Xaman',
  'The entry of your company in the public register, as an XLS-70 credential with the register link as its evidence. It travels with the account, never with a document.':
    'El asiento de tu sociedad en el registro público, como credencial XLS-70 con el enlace del registro como su evidencia. Viaja con la cuenta, jamás con un documento.',
  'company register (your commercial registry)': 'registro de sociedades (tu registro mercantil)',
  'The ISSUANCE is real: the reference notary of this environment signs a real XLS-70 on mainnet, with a real expiry, and accepting it is your real signature. What it ATTESTS is not: no third party verified any licence or registration here. In production, regulated issuers sign; Astryum never issues.':
    'La EMISIÓN es real: el notario de referencia de este entorno firma una XLS-70 real en mainnet, con caducidad real, y aceptarla es tu firma real. Lo que ATESTA no lo es: aquí ningún tercero verificó licencia ni registro. En producción firman emisores regulados; Astryum jamás emite.',
  'Seven stations — pin this panel and the dashboard stays live beside it.': 'Siete estaciones: ancla este panel y el dashboard sigue vivo al lado.',
  'This exchange has not published a profile yet. The ledger facts below stand on their own.':
    'Este exchange aún no ha publicado perfil. Los hechos del ledger de abajo se sostienen solos.',
  'About your exchange — check it yourself': 'Sobre tu exchange — compruébalo tú',
  'What your clients see — your public credential zone': 'Lo que ven tus clientes — tu zona de credencial pública',
  'The appointment': 'La designación',
  'The root names its omnibus on the ledger: an OMNIBUS credential from the root, accepted by the omnibus — revoke it and the cash desk stops; exits never do':
    'La raíz nombra a su omnibus en el ledger: una credencial OMNIBUS de la raíz, aceptada por el omnibus — revócala y la caja se para; las salidas jamás',
  '~3 min · 2 signatures': '~3 min · 2 firmas',
  'the omnibus holds a live OMNIBUS credential issued by this root, read from XRPL':
    'el omnibus sostiene una credencial OMNIBUS vigente emitida por esta raíz, leída de XRPL',
  'The appointment — the root names its omnibus': 'La designación — la raíz nombra a su omnibus',
  'The hierarchy goes on the ledger: the root issues an OMNIBUS credential to the omnibus account, and the omnibus ACCEPTS — two signatures, both in your Xaman. With a short expiry, renewing IS the periodic act of responsibility over the cash desk; revoking it (or letting it lapse) beheads the desk without ever touching a client exit.':
    'La jerarquía va al ledger: la raíz emite una credencial OMNIBUS a la cuenta omnibus, y el omnibus la ACEPTA — dos firmas, las dos en tu Xaman. Con caducidad corta, renovarla ES el acto periódico de responsabilidad sobre la caja; revocarla (o dejarla caducar) descabeza la caja sin tocar jamás la salida de un cliente.',
  'Issuer (the root)': 'Emisor (la raíz)',
  'Subject (the omnibus)': 'Sujeto (el omnibus)',
  'Appointed: the omnibus holds a live OMNIBUS credential issued by this root.':
    'Nombrado: el omnibus sostiene una credencial OMNIBUS vigente emitida por esta raíz.',
  'Name the omnibus (2 signatures)': 'Nombrar el omnibus (2 firmas)',
  'Save the omnibus account first (station 1).': 'Guarda primero la cuenta omnibus (estación 1).',
  'Seven stations, once. You can leave at any station and come back: everything lives on the ledger, so the setup resumes exactly where reality is — each segment turns green when the chain says so, never before.':
    'Siete estaciones, una vez. Puedes salir en cualquiera y volver: todo vive en el ledger, así que el alta se reanuda exactamente donde está la realidad — cada tramo se pone verde cuando lo dice la cadena, nunca antes.',
  'The exchange profile: omnibus and policy — what Operate runs on, and where your users sign up':
    'El perfil del exchange: omnibus y política — sobre lo que corre Operar, y donde tus users se dan de alta',
  'The issuer signs, the subject accepts — that signature IS the consent.':
    'El emisor firma, el sujeto acepta — esa firma ES el consentimiento.',
  'Licence link (travels as the credential URI)': 'Enlace de la licencia (viaja como URI de la credencial)',
  'The link IS the credential: it is shown to anyone who relies on it, and they check it themselves. Astryum does not verify it. A pointer only — no document goes on-chain.':
    'El enlace ES la credencial: se enseña a quien confíe en ella, y lo comprueba él mismo. Astryum no lo verifica. Solo un puntero — ningún documento va on-chain.',
  'The credential points at': 'La credencial apunta a',
  'Astryum does not verify this link. Whoever relies on this credential checks it themselves — their responsibility, like any reference.':
    'Astryum no verifica este enlace. Quien confíe en esta credencial lo comprueba por su cuenta — su responsabilidad, como toda referencia.',
  'Your tag at the exchange': 'Tu tag en el exchange',
  'The contracts on the page are live on Flare. The vault has no function to extract the principal; the bridge only executes orders proven by the FDC; the passkey factory gives each client an account of their own.':
    'Los contratos de la página están vivos en Flare. La bóveda no tiene función para extraer el principal; el bridge solo ejecuta órdenes probadas por el FDC; la factory de passkeys da a cada cliente una cuenta propia.',
  "This take runs XRPL-only: identity lives in XLS-70 credentials on XRPL, and the exit carries the client's exchange tag. A tenant that wants the gate written into the contract too can point the pote at an on-chain registry later, with one council order.":
    'Esta toma va XRPL-only: la identidad vive en credenciales XLS-70 en XRPL, y la salida lleva el tag del cliente en el exchange. Un tenant que quiera la puerta escrita también en el contrato puede apuntar el pote a un registro on-chain después, con una orden de consejo.',
  'Nobody extra: the exchange assigns the tag in its own books; identity is XLS-70 on XRPL':
    'Nadie extra: el exchange asigna el tag en sus propios libros; la identidad es XLS-70 en XRPL',
  "The tag is what the omnibus watcher uses to credit a deposit to the right client — like any exchange. It lives in the exchange's books; the client's identity is the XLS-70 credential on XRPL.":
    'El tag es lo que el watcher del omnibus usa para acreditar cada depósito al cliente correcto — como en cualquier exchange. Vive en los libros del exchange; la identidad del cliente es la credencial XLS-70 en XRPL.',
  "To the exchange = redeem + redeemWithTag in ONE signature, tagged with the client's exchange tag so the return credits them. To their wallet = redeem + unmint. On a cooldown pote (policy B) the shares burn now and the amount is claimed when the clock ends.":
    'Al exchange = redeem + redeemWithTag en UNA firma, etiquetado con el tag del cliente para que la vuelta le acredite. A su wallet = redeem + unmint. En un pote con cooldown (política B) las participaciones se queman ahora y el importe se cobra al vencer.',
  'The credentials — on XRPL': 'Las credenciales — en XRPL',
  'Identity lives on the ledger that governs: XLS-70 credentials on the root (its licence to operate) and on the client (their KYC, portable). The issuer signs, the subject accepts — the ledger carries the YES, never the NO.':
    'La identidad vive en el ledger que gobierna: credenciales XLS-70 en la raíz (su licencia para operar) y en el cliente (su KYC, portable). El emisor firma, el sujeto acepta — el ledger lleva el SÍ, nunca el NO.',
  'Set up: root, credentials, constitution, cage, pote, desk — once.':
    'Montar: raíz, credenciales, constitución, jaula, pote, mesa — una vez.',
  'Become a tenant, station by station: root, credentials, constitution, cage, pote, desk':
    'Hazte tenant, estación a estación: raíz, credenciales, constitución, jaula, pote, mesa',
  'KYC registry (optional)': 'Registro KYC (opcional)',
  'Only if you want the gate written into the contract too — this take runs XRPL-only, identity lives in XLS-70':
    'Solo si quieres la puerta escrita también en el contrato — esta toma va XRPL-only, la identidad vive en XLS-70',
  'The gate (optional)': 'La puerta (opcional)',
  'Only with a registry: a council order points the pote at it — the contract refuses who is not approved':
    'Solo con registro: una orden de consejo apunta el pote hacia él — el contrato rechaza a quien no está aprobado',
  'Client created with tag {tag}. They set up Face ID in the User tab; their identity lives on XRPL (XLS-70).':
    'Cliente creado con el tag {tag}. Configura su Face ID en la pestaña User; su identidad vive en XRPL (XLS-70).',
  'One Face ID: redeem + redeemWithTag → XRP back to the exchange, tagged as mine.':
    'Un Face ID: redeem + redeemWithTag → el XRP vuelve al exchange, etiquetado como mío.',
  'Immediate: the vault unwinds the venues inside your transaction. To the exchange = redeem + redeemWithTag in ONE signature, tagged with your exchange tag so the return credits you.':
    'Inmediato: la bóveda deshace los venues dentro de tu transacción. Al exchange = redeem + redeemWithTag en UNA firma, etiquetado con tu tag del exchange para que la vuelta te acredite.',
  'Permissioned setup': 'Setup permissioned',
  'Permissioned setup (one-time)': 'Setup permissioned (una vez)',
  'This turns a vault into a permissioned one: the anchor becomes a gate, and an accredited issuer grants the manager’s credentials. Same screen for the demo and for production — only the issuing r-address changes. Astryum never signs and never issues.': 'Esto convierte un vault en uno permissioned: el ancla pasa a ser puerta, y un emisor acreditado concede las credenciales del gestor. Misma pantalla para la demo y para producción — solo cambia la r-address que emite. Astryum jamás firma ni emite.',
  'A · Turn the anchor into a gate': 'A · Convertir el ancla en puerta',
  'The anchor owner enables DepositAuth and preauthorizes the manager credential. From then on, a council order without the required credentials is rejected by XRPL consensus (tecNO_PERMISSION).': 'El dueño del ancla enciende DepositAuth y preautoriza la credencial de gestor. Desde ahí, una orden de consejo sin las credenciales exigidas la rechaza el consenso de XRPL (tecNO_PERMISSION).',
  'Anchor XRPL address (where council orders land)': 'Dirección XRPL del ancla (donde aterrizan las órdenes de consejo)',
  '1 · Enable DepositAuth': '1 · Encender DepositAuth',
  '2 · Authorize the manager credential': '2 · Autorizar la credencial de gestor',
  'Connected as': 'Conectado como',
  'connect the ANCHOR account to sign these.': 'conecta la cuenta del ANCLA para firmar esto.',
  'Signed. The anchor now enforces the gate on the ledger.': 'Firmado. El ancla ya hace cumplir la puerta en el ledger.',
  'The anchor must be an XRPL r-address.': 'El ancla tiene que ser una r-address XRPL.',
  'B · Issue the manager’s credentials': 'B · Emitir las credenciales del gestor',
  'The issuer signs one credential per type (AIFM licence, KYC identity) to the MANAGER’s XRPL account. Pick the type in the ceremony; the manager accepts each in their tray. In the demo the issuer is a test r-address in the allowlist; in production, a regulated one.': 'El emisor firma una credencial por tipo (licencia AIFM, identidad KYC) a la cuenta XRPL del GESTOR. Elige el tipo en la ceremonia; el gestor acepta cada una en su bandeja. En la demo el emisor es una r-address de prueba de la allowlist; en producción, una regulada.',
  'Open the credential ceremony': 'Abrir la ceremonia de credenciales',
  'C · The manager accepts each credential in their tray (in “Run a vault”). Only an accepted credential (lsfAccepted) is valid.': 'C · El gestor acepta cada credencial en su bandeja (en «Run a vault»). Solo una credencial aceptada (lsfAccepted) vale.',
  'Astryum never issues or verifies it, and never sees your documents. You verify directly with an accredited partner; when granted, it is issued to THIS account and you accept it in your tray below (that signature is yours). No document ever touches Astryum or the chain.': 'Astryum no la emite ni la verifica, y jamás ve tus documentos. Te verificas directamente con un partner acreditado; cuando te la concedan, se emite a ESTA cuenta y la aceptas en tu bandeja de abajo (esa firma es tuya). Ningún documento toca Astryum ni la cadena.',
  'Verify with': 'Verificarme con',
  // ── DomainBindingCard: los checks reproducibles del bot-notario ──
  'Domain binding — the notary’s reproducible checks': 'Binding de dominio — los checks reproducibles del notario',
  'Three facts back an AIFM credential, and anyone can re-run them: the account declares a domain, that domain declares the account back (xrp-ledger.toml), and the domain belongs to a firm on the regulator’s register. No judgement — just the checks.':
    'Tres hechos respaldan una credencial AIFM, y cualquiera puede re-ejecutarlos: la cuenta declara un dominio, ese dominio devuelve la declaración (xrp-ledger.toml), y el dominio es de una firma del registro del regulador. Sin juicio — solo los checks.',
  'Manager XRPL account': 'Cuenta XRPL del gestor',
  'Run the checks': 'Ejecutar los checks',
  'Binding complete — an issuer attesting this exercises no judgement.': 'Binding completo — un emisor que ateste esto no ejerce juicio.',
  'Declare your firm’s domain on this account': 'Declara el dominio de tu firma en esta cuenta',
  'You sign the AccountSet in Xaman. The other half is your firm’s website serving /.well-known/xrp-ledger.toml with this r-address — your web team does that; Astryum touches neither.':
    'El AccountSet lo firmas tú en Xaman. La otra mitad es que la web de tu firma sirva /.well-known/xrp-ledger.toml con esta r-address — eso lo hace tu equipo web; Astryum no toca ninguna de las dos.',
  'Declare domain': 'Declarar dominio',
  // ── La mesa del gestor en SALAS (patrón Legacy) + crear cuenta en Xaman ──
  'Manager title': 'Título de gestor',
  'Create the vault': 'Crear la bóveda',
  'Issuer setup (demo)': 'Setup del emisor (demo)',
  'The account that governs — connect it, or create a fresh one': 'La cuenta que gobierna — conéctala, o crea una nueva',
  'The credentials that let you run a grouped vault — and where to get them': 'Las credenciales que te dejan gobernar un vehículo agrupado — y dónde conseguirlas',
  'The governance document, anchored before the cage is born': 'El documento de gobierno, anclado antes de que nazca la jaula',
  'Birth your cage and open your pote, with your own parameters': 'Nace tu jaula y se abre tu pote, con tus propios parámetros',
  'Your vaults, their consoles and the orders to the cage': 'Tus bóvedas, sus consolas y las órdenes a la jaula',
  'The anchor gate and the credential ceremony — the issuer’s side': 'La puerta del ancla y la ceremonia de credenciales — el lado del emisor',
  'No vault yet — it is born in the Create room. The console below already speaks to your cage the moment it exists.':
    'Aún sin bóveda — nace en la sala Crear. La consola de abajo ya habla con tu jaula en cuanto exista.',
  'A dedicated account for your management': 'Una cuenta dedicada a tu gestión',
  'The account that governs a vault is public: clients see it, credentials attach to it, every order carries its signature. Use a FRESH account dedicated to managing — created in your Xaman, where its keys are born and stay.':
    'La cuenta que gobierna una bóveda es pública: los clientes la ven, las credenciales se le atan, cada orden lleva su firma. Usa una cuenta NUEVA dedicada a gestionar — creada en tu Xaman, donde sus claves nacen y se quedan.',
  'In Xaman: add a new account': 'En Xaman: añade una cuenta nueva',
  'In Xaman, tap the account switcher → “Add account” → “Create new account”. The keys are generated on your phone and never leave it — Astryum never sees them.':
    'En Xaman, toca el selector de cuentas → «Add account» → «Create new account». Las claves se generan en tu móvil y jamás salen de él — Astryum nunca las ve.',
  'Write the secret down, on paper': 'Apunta el secreto, en papel',
  'Xaman shows the family seed once. Write it on paper and keep it offline: it is the only copy, and whoever holds it holds the account.':
    'Xaman enseña la family seed una vez. Escríbela en papel y guárdala offline: es la única copia, y quien la tiene, tiene la cuenta.',
  'Activate it with XRP': 'Actívala con XRP',
  'An XRPL account exists once it receives its first XRP. Send it ~2 XRP from another account or an exchange: 1 stays locked as the base reserve; the rest covers credential reserves and fees.':
    'Una cuenta XRPL existe cuando recibe su primer XRP. Mándale ~2 XRP desde otra cuenta o un exchange: 1 queda bloqueado como reserva base; el resto cubre reservas de credenciales y fees.',
  'Connect it here': 'Conéctala aquí',
  'Back in Astryum, connect the new account from Wallets. This desk reads the ledger and lights up with it.':
    'De vuelta en Astryum, conecta la cuenta nueva desde Wallets. Esta mesa lee el ledger y se enciende con ella.',
  'Connect it from Wallets': 'Conectarla desde Wallets',
  // ── El registro de venues (scanner v2) — /app/admin/registry (X1) ──
  'Venue registry': 'Registro de venues',
  'The on-chain scanner every v2 pote consults. Propose, mature, activate — the governor signs each write.':
    'El scanner on-chain que todo pote v2 consulta. Proponer, madurar, activar — cada escritura la firma el governor.',
  'Astryum venue registry (the scanner)': 'Registro de venues de Astryum (el scanner)',
  'The on-chain whitelist every v2 pote consults. Empty registry = every pote is born with zero destinations. Proposals wait out the timelock; removal is immediate and only blocks NEW capital. The governor signs — Astryum never does.':
    'La whitelist on-chain que todo pote v2 consulta. Registro vacío = todo pote nace con cero destinos. Las altas esperan el timelock; la baja es inmediata y solo bloquea capital NUEVO. Firma el governor — Astryum jamás.',
  'The registry could not be read right now — that is not the same as it being empty.':
    'El registro no se pudo leer ahora mismo — que no es lo mismo que estar vacío.',
  'Reading the registry from the chain…': 'Leyendo el registro de la cadena…',
  'Governor': 'Governor',
  'Timelock': 'Timelock',
  'The registry is EMPTY: no pote can add a single venue until an entry is proposed, matured and activated.':
    'El registro está VACÍO: ningún pote puede añadir un solo venue hasta que un alta se proponga, madure y se active.',
  'pending': 'pendiente',
  'removed': 'retirado',
  'ripe — can be activated': 'maduro — se puede activar',
  'Activate': 'Activar',
  'Remove': 'Retirar',
  'Propose a venue (governor signs; enters after the timelock)': 'Proponer un venue (firma el governor; entra tras el timelock)',
  'with exit queue': 'con cola de salida',
  'Proposal sent — it matures with the timelock.': 'Alta enviada — madura con el timelock.',
  'Activation sent.': 'Activación enviada.',
  'Removal sent — immediate.': 'Baja enviada — inmediata.',
  'Connect the GOVERNOR wallet of the registry to sign.': 'Conecta la wallet del GOVERNOR del registro para firmar.',
  'The venue target must be an EVM address (0x…).': 'El venue tiene que ser una dirección EVM (0x…).',
  '(on the fork)': '(en el fork)',
  // ── El robot del notario (X3): pegar atestación → verificar → emitir ──
  'Automatic issuance — the notary verifies and issues': 'Emisión automática — el notario verifica y emite',
  'KYC: paste your Coinbase attestation (easscan) and sign a challenge with the attested EVM wallet. AIFM: the notary re-runs the domain and register checks. If the facts hold, the credential lands in your tray — accepting it is still your signature.':
    'KYC: pega tu atestación de Coinbase (easscan) y firma un reto con la wallet EVM atestada. AIFM: el notario re-ejecuta los checks de dominio y registro. Si los hechos aguantan, la credencial cae en tu bandeja — aceptarla sigue siendo tu firma.',
  'Paste your easscan attestation URL (it contains a 0x… uid).': 'Pega la URL de tu atestación en easscan (contiene un uid 0x…).',
  'Verify & issue KYC': 'Verificar y emitir KYC',
  'Run checks & issue AIFM': 'Ejecutar checks y emitir AIFM',
  'KYC credential issued': 'Credencial KYC emitida',
  'AIFM credential issued': 'Credencial AIFM emitida',
  'accept it in your tray below.': 'acéptala en tu bandeja, abajo.',
  'Which wallet is the manager?': '¿Qué wallet es la gestora?',
  // ── Los dos apartados de la mesa + el wizard de configuración ──
  'Configure the account': 'Configurar la cuenta',
  'Reading your vault from the chain…': 'Leyendo tu bóveda de la cadena…',
  'Your vault could not be read right now, so this desk cannot tell whether you already run one. That is not the same as you not having one.':
    'Tu bóveda no se pudo leer ahora mismo, así que esta mesa no sabe si ya llevas una. Eso no es lo mismo que no tenerla.',
  // ── La mesa sin repeticiones: un raíl, título en una línea, dos paneles ──
  'Required': 'Obligatoria',
  'Optional': 'Opcional',
  'Renew': 'Renovar',
  'Manager title in force': 'Título de gestor vigente',
  'Manager title pending': 'Título de gestor pendiente',
  'The ledger will refuse this account’s orders until it holds one.': 'El ledger rechazará las órdenes de esta cuenta hasta que lo tenga.',
  'Go to the Title station': 'Ir a la estación Título',
  // ── El puente del gestor: capital de un vistazo, destinos con nombre, identidad ──
  'Bring your clients': 'Trae a tus clientes',
  'Connect your Flare wallet (this vault’s director) — or open this desk from the XRPL account that governs it to move capital by council order.': 'Conecta tu wallet de Flare (la directora de esta bóveda) — o abre esta mesa desde la cuenta XRPL que la gobierna para mover capital por orden de consejo.',
  'Copy vault link': 'Copiar enlace de la bóveda',
  'Destinations — where the capital works': 'Destinos — donde trabaja el capital',
  'Empty vault': 'Bóveda vacía',
  'Exits have dipped into the floor: nothing is deployable until deposits or recalls bring the idle balance back above it.': 'Las salidas han mordido el suelo: nada es desplegable hasta que depósitos o recuperaciones devuelvan el saldo libre por encima.',
  'Floor': 'Suelo',
  'Moving straight between destinations is not available yet — pull out, then put in.': 'Mover directamente entre destinos aún no está disponible — saca y luego mete.',
  'No vault yet': 'Aún sin bóveda',
  'Open your first vault from here, or finish the setup in “Configure the account”. Once it exists, this desk becomes its bridge: capital, rules and identity in one place.': 'Abre tu primera bóveda desde aquí, o termina el alta en «Configurar la cuenta». En cuanto exista, esta mesa se convierte en su puente: capital, reglas e identidad en un solo sitio.',
  'Order signed. It travels XRPL → FDC → the vault (~2–5 min). The move shows here once it settles.': 'Orden firmada. Viaja XRPL → FDC → la bóveda (~2–5 min). El movimiento aparece aquí cuando asienta.',
  'Sign the council order in Xaman': 'Firma la orden de consejo en Xaman',
  'The capital, at a glance': 'El capital, de un vistazo',
  'Waiting for the first deposit. Your vault is already listed in Earn — the link below opens it straight on your card.': 'Esperando el primer depósito. Tu bóveda ya está listada en Earn — el enlace de abajo la abre directamente en tu carta.',
  'Your council signature': 'Tu firma de consejo',
  'Your public page': 'Tu página pública',
  'Your vault is listed in Earn like any other. This link opens Earn straight on your card, with your profile — how a manager brings their own clients. Astryum lists; it never recommends.': 'Tu bóveda está listada en Earn como cualquier otra. Este enlace abre Earn directamente en tu carta, con tu perfil — así trae un gestor a sus propios clientes. Astryum lista; nunca recomienda.',
  'Your vaults': 'Tus bóvedas',
  'in the vault': 'en la bóveda',
  'no destination yet': 'aún sin destino',
  'of the vault': 'de la bóveda',
  // ── Qué pasa con tus tokens en una bóveda gestionada ──
  'Accreditation: reading the ledger…': 'Acreditación: leyendo el ledger…',
  'vaults: reading…': 'bóvedas: leyendo…',
  'Self-issued — not a verification': 'Auto-emitida — no es una verificación',
  'Issuer not on the gate’s list': 'Emisor fuera de la lista de la puerta',
  'Why there is no single APY here: what the vault earns is the mix of what the manager places at each destination, and when. Below, each destination shows the rate its protocol publishes right now — that protocol’s number, not Astryum’s, and it changes constantly. A destination can also lose money.': 'Por qué aquí no hay un único APY: lo que gana la bóveda es la mezcla de lo que el gestor coloca en cada destino, y cuándo. Abajo, cada destino enseña el tipo que su protocolo publica ahora mismo — la cifra de ese protocolo, no de Astryum, y cambia constantemente. Un destino también puede perder dinero.',
  'Reading today’s rate from the protocol…': 'Leyendo el tipo de hoy del protocolo…',
  'check it there': 'compruébalo allí',
  'today, at': 'hoy, en',
  'The protocol’s figure, not a promise: it moves every block and applies only to what the manager places there.': 'La cifra del protocolo, no una promesa: se mueve cada bloque y solo aplica a lo que el gestor coloque allí.',
  'Lends the vault’s FXRP to over-collateralised borrowers on Kinetic. The vault earns the supply interest that market sets at each moment.': 'Presta el FXRP de la bóveda a prestatarios sobrecolateralizados en Kinetic. La bóveda gana el interés de depósito que ese mercado fija a cada momento.',
  'Deposits the vault’s FXRP in Firelight’s stXRP vault. The vault earns whatever that vault distributes to its depositors.': 'Deposita el FXRP de la bóveda en el vault stXRP de Firelight. La bóveda gana lo que ese vault reparte a sus depositantes.',
  'A lending market: the FXRP is lent to borrowers and the vault earns the supply rate that market sets.': 'Un mercado de préstamo: el FXRP se presta a prestatarios y la bóveda gana el tipo de depósito que fija ese mercado.',
  'A vault with immediate exit: the FXRP is deposited there and the vault earns what it distributes.': 'Un vault con salida inmediata: el FXRP se deposita allí y la bóveda gana lo que reparte.',
  'A vault that exits through a queue: the FXRP is deposited there and the vault earns what it distributes; getting it back takes that queue.': 'Un vault que sale por cola: el FXRP se deposita allí y la bóveda gana lo que reparte; recuperarlo pasa por esa cola.',
  'What happens to your tokens here': 'Qué pasa aquí con tus tokens',
  'Not a loan, no collateral.': 'Ni préstamo ni colateral.',
  'You deposit': 'Depositas',
  'and receive shares': 'y recibes participaciones',
  'in your own wallet — one proportional slice of the vault.': 'en tu propia wallet — una porción proporcional de la bóveda.',
  'You deposit the vault’s asset and receive shares in your own wallet — one proportional slice of the vault.': 'Depositas el activo de la bóveda y recibes participaciones en tu propia wallet — una porción proporcional de la bóveda.',
  'The manager can only move the pooled capital into the destinations below. What those destinations produce stays in the vault, pro-rata to your shares.': 'El gestor solo puede mover el capital común a los destinos de abajo. Lo que esos destinos producen se queda en la bóveda, a prorrata de tus participaciones.',
  'This vault has no destination yet: your capital would sit idle inside it until the manager proposes one — and any new destination waits 30 days, which is your month to leave.': 'Esta bóveda aún no tiene destino: tu capital estaría parado dentro hasta que el gestor proponga uno — y todo destino nuevo espera 30 días, que es tu mes para salir.',
  'The manager’s fee applies to what the vault produces — never to your principal. Exit:': 'La comisión del gestor se aplica a lo que produce la bóveda — nunca a tu principal. Salida:',
  'always stays liquid for exits.': 'queda siempre líquido para las salidas.',
  'The rate is the destination’s and changes constantly; a destination can also lose money. Astryum lists these facts and promises no return.': 'El tipo es del destino y cambia constantemente; un destino también puede perder dinero. Astryum lista estos hechos y no promete rendimiento.',
  'no destination yet — capital would sit idle': 'aún sin destino — el capital estaría parado',
  'Not a loan, no collateral': 'Ni préstamo ni colateral',
  'You deposit the asset and receive shares of the vault in your own wallet. Nothing is borrowed and nothing of yours is pledged: the vault pools the capital and the manager moves it — only inside the rules — to destinations that produce something, which stays in the vault pro-rata to your shares.': 'Depositas el activo y recibes participaciones de la bóveda en tu propia wallet. Nada se pide prestado y nada tuyo se pignora: la bóveda junta el capital y el gestor lo mueve — solo dentro de las reglas — a destinos que producen algo, que se queda en la bóveda a prorrata de tus participaciones.',
  // ── Robustez del flujo del gestor + creador personalizable ──
  'Your vault is born and listed. It appears in Operate now.': 'Tu bóveda ha nacido y está listada. Ya aparece en Operar.',
  'Still not visible after ten minutes. The order is signed and relayed; the proof can take longer — open Operate later and press Refresh. Do not sign it again.': 'Sigue sin verse pasados diez minutos. La orden está firmada y relayada; la prueba puede tardar más — abre Operar más tarde y pulsa Refrescar. No la vuelvas a firmar.',
  'Waiting for the proof to land on Flare — usually 2 to 5 minutes. This screen checks every 15 seconds; you can leave and come back.': 'Esperando a que la prueba llegue a Flare — normalmente de 2 a 5 minutos. Esta pantalla comprueba cada 15 segundos; puedes salir y volver.',
  'Type a name first — the symbol derives from it.': 'Escribe primero un nombre — el símbolo se deriva de él.',
  'Derived from the name — pick the one you prefer.': 'Derivado del nombre — elige el que prefieras.',
  'An operation window closed after an error': 'Una ventana de operación se cerró tras un error',
  'Nothing was signed by that window after the error. Open it again from where you started; if it keeps happening, tell us what you were doing.': 'Esa ventana no firmó nada después del error. Vuelve a abrirla desde donde empezaste; si se repite, cuéntanos qué estabas haciendo.',
  'Connect your wallet (Xaman or Flare) to see whether you are already in this vault.': 'Conecta tu wallet (Xaman o Flare) para ver si ya estás en esta bóveda.',
  'Could not reach the server': 'No se pudo llegar al servidor',
  'Reading the gate and your credentials…': 'Leyendo la puerta y tus credenciales…',
  'Signed, but the relay refused': 'Firmada, pero el relay se negó',
  'The gate or the ledger could not be read right now, so nothing here is marked in force — that says nothing about your credentials.': 'La puerta o el ledger no se pudieron leer ahora mismo, así que aquí nada se marca como vigente — eso no dice nada de tus credenciales.',
  'vault of your cage could not be read right now and is not shown — that is not the same as it not existing.': 'bóveda de tu jaula no se pudo leer ahora mismo y no se muestra — eso no es lo mismo que no exista.',
  'vaults of your cage could not be read right now and are not shown — that is not the same as them not existing.': 'bóvedas de tu jaula no se pudieron leer ahora mismo y no se muestran — eso no es lo mismo que no existan.',
  'Vault stations': 'Estaciones de la bóveda',
  'Presets': 'Ajustes rápidos',
  'Liquid': 'Líquida',
  'Balanced': 'Equilibrada',
  'Patient': 'Paciente',
  'No cap': 'Sin tope',
  'The ledger gate requires your manager title before opening a vault — finish the Title station first.': 'La puerta del ledger exige tu título de gestor antes de abrir una bóveda — completa primero la estación Título.',
  'Choose the image clients will see on the card — you can change it later from Operate.': 'Elige la imagen que los clientes verán en la carta — puedes cambiarla después desde Operar.',
  'Clients leave the moment they ask; a fifth stays liquid for that.': 'Los clientes salen en cuanto lo piden; una quinta parte queda líquida para eso.',
  'Three days to leave; a tenth stays liquid.': 'Tres días para salir; una décima parte queda líquida.',
  'A week to leave; a twentieth stays liquid — room for slower venues.': 'Una semana para salir; una vigésima parte queda líquida — margen para destinos más lentos.',
  'Applied — the sliders are yours to fine-tune.': 'Aplicado — los deslizadores son tuyos para afinar.',
  // ── La jaula avisa antes de pulsar si falta el Título ──
  'The ledger will refuse this birth until the Title station is complete: every required credential, from an accepted issuer, accepted in your Xaman.': 'El ledger rechazará este nacimiento hasta que la estación Título esté completa: todas las credenciales exigidas, de un emisor aceptado, aceptadas en tu Xaman.',
  // ── La constitución completa, doce artículos ──
  'Article': 'Artículo',
  'CONSTITUTION OF A MANAGED GROUPED VEHICLE': 'CONSTITUCIÓN DE UN VEHÍCULO AGRUPADO GESTIONADO',
  'Manager (name or entity)': 'Gestor (nombre o entidad)',
  'Jurisdiction of the manager': 'Jurisdicción del gestor',
  'Contact': 'Contacto',
  'PREAMBLE': 'PREÁMBULO',
  'This document sets the rules under which the account named above manages capital that other people deposit in the grouped vaults it governs. The parts the smart contract enforces are stated as facts; the rest are commitments the manager makes and can be held to. Only the fingerprint of this text is anchored on the XRP Ledger; the text itself lives off-chain and anyone can verify it against that fingerprint.': 'Este documento fija las reglas bajo las que la cuenta arriba indicada gestiona capital que otras personas depositan en las bóvedas agrupadas que gobierna. Lo que el contrato inteligente hace cumplir se enuncia como hecho; el resto son compromisos que el gestor asume y que se le pueden exigir. Solo la huella de este texto se ancla en el XRP Ledger; el texto vive fuera de la cadena y cualquiera puede cotejarlo con esa huella.',
  'Object and nature': 'Objeto y naturaleza',
  'The vehicle is a set of grouped, pro-rata vaults deployed on Flare and governed from the XRPL account above (the “manager”). Each vault issues standard shares to whoever deposits; each share represents a proportional part of the vault’s assets.': 'El vehículo es un conjunto de bóvedas agrupadas, a prorrata, desplegadas en Flare y gobernadas desde la cuenta XRPL arriba indicada (el «gestor»). Cada bóveda emite participaciones estándar a quien deposita; cada participación representa una parte proporcional de los activos de la bóveda.',
  'The vehicle is non-custodial. Depositors hold their shares in their own wallets at all times. Neither the manager nor Astryum ever holds, moves or can move a depositor’s shares.': 'El vehículo es no custodial. Los depositantes guardan sus participaciones en sus propias wallets en todo momento. Ni el gestor ni Astryum tienen, mueven ni pueden mover jamás las participaciones de un depositante.',
  'Astryum is the interface that lists the vault and composes the transactions the manager signs. It is not a party to this constitution: it does not sign, does not custody, does not manage capital and does not recommend this vehicle to anyone.': 'Astryum es la interfaz que lista la bóveda y compone las transacciones que el gestor firma. No es parte de esta constitución: no firma, no custodia, no gestiona capital y no recomienda este vehículo a nadie.',
  'The manager': 'El gestor',
  'The manager is identified by the XRPL account above. Every order to the vaults carries that account’s signature and is public on the ledger.': 'El gestor se identifica por la cuenta XRPL arriba indicada. Toda orden a las bóvedas lleva la firma de esa cuenta y es pública en el ledger.',
  'The manager holds, and keeps in force, the credentials the ledger requires to run grouped vaults (identity and licence, XLS-70), issued by an accredited third party — never by Astryum and never by the manager itself.': 'El gestor sostiene, y mantiene vigentes, las credenciales que el ledger exige para llevar bóvedas agrupadas (identidad y licencia, XLS-70), emitidas por un tercero acreditado — nunca por Astryum y nunca por el propio gestor.',
  'The manager acts with the diligence of a professional entrusted with other people’s capital, and in the sole interest of the depositors as a whole.': 'El gestor actúa con la diligencia de un profesional al que se le confía capital ajeno, y en el interés exclusivo del conjunto de los depositantes.',
  'Limits of the mandate — the cage': 'Límites del mandato — la jaula',
  'The manager may direct capital ONLY inside the cage: to destinations listed in the venue registry, within the per-destination cap, above the liquidity floor and respecting the exit window. These limits bind the manager by construction; the contract refuses any order outside them.': 'El gestor solo puede dirigir capital DENTRO de la jaula: a destinos listados en el registro de venues, dentro del tope por destino, por encima del suelo de liquidez y respetando la ventana de salida. Estos límites atan al gestor por construcción; el contrato rechaza cualquier orden fuera de ellos.',
  'Adding a destination is a public proposal that waits at least 30 days before a single token can go there. Retiring a destination is immediate and only stops NEW capital from entering it.': 'Añadir un destino es una propuesta pública que espera al menos 30 días antes de que un solo token pueda ir allí. Retirar un destino es inmediato y solo impide que entre capital NUEVO.',
  'The manager does not borrow against the vault, does not pledge its assets, does not lend them outside the cage and does not use them for any purpose other than the destinations allowed.': 'El gestor no se endeuda contra la bóveda, no pignora sus activos, no los presta fuera de la jaula y no los usa para ningún fin distinto de los destinos permitidos.',
  'The manager never asks a depositor to approve the manager, a director or any third party over the depositor’s shares. Any such request is outside this mandate and must be treated as an attack.': 'El gestor nunca pide a un depositante que apruebe al gestor, a un director ni a ningún tercero sobre sus participaciones. Cualquier petición así está fuera de este mandato y debe tratarse como un ataque.',
  'Depositors’ rights': 'Derechos de los depositantes',
  'Exits are never blocked, never gated and never capped. A depositor who asks to leave receives the pro-rata value of their shares after the exit window fixed at the vault’s birth.': 'Las salidas nunca se bloquean, nunca se condicionan y nunca se limitan. Un depositante que pide salir recibe el valor a prorrata de sus participaciones tras la ventana de salida fijada al nacer la bóveda.',
  'The exit window and the liquidity floor are fixed when the vault is born and cannot be changed afterwards — not by the manager, not by any council, not by an amendment to this document.': 'La ventana de salida y el suelo de liquidez se fijan al nacer la bóveda y no pueden cambiarse después — ni por el gestor, ni por ningún consejo, ni por una enmienda a este documento.',
  'The liquidity floor exists for depositors: redemptions may draw on it; the manager may not.': 'El suelo de liquidez existe para los depositantes: los reembolsos pueden tomar de él; el gestor no.',
  'Every rule that governs a vault is readable on-chain by anyone, at any time, without asking the manager.': 'Toda regla que gobierna una bóveda es legible en la cadena por cualquiera, en cualquier momento, sin pedírselo al gestor.',
  'Fees': 'Comisiones',
  'The manager’s fee applies to yield only — never to principal. A vault that produced nothing charges nothing.': 'La comisión del gestor se aplica solo al rendimiento — nunca al principal. Una bóveda que no produjo nada no cobra nada.',
  'The ceiling of the fee is fixed at the vault’s birth and cannot be raised. The rate actually applied is published on-chain and is always at or below that ceiling.': 'El techo de la comisión se fija al nacer la bóveda y no puede subirse. El tipo realmente aplicado se publica en la cadena y está siempre en ese techo o por debajo.',
  'No entry fee, no exit fee, no hidden fee. Whatever the network itself charges (gas, crossing tolls) is disclosed before the depositor signs.': 'Sin comisión de entrada, sin comisión de salida, sin comisión oculta. Lo que cobra la propia red (gas, peajes de cruce) se declara antes de que el depositante firme.',
  'Transparency and reporting': 'Transparencia e información',
  'Capital, destinations, floor, window, fee and every order are facts on the chain. The manager’s reporting consists of those facts and never of projections.': 'Capital, destinos, suelo, ventana, comisión y cada orden son hechos en la cadena. La información del gestor consiste en esos hechos y nunca en proyecciones.',
  'The manager makes no promise of return, guarantees nothing and describes past results, if at all, as what happened — never as what will happen.': 'El gestor no promete rendimiento, no garantiza nada y describe los resultados pasados, si lo hace, como lo que ocurrió — nunca como lo que ocurrirá.',
  'The manager publishes a public profile (name, entity, contact) tied to this account and keeps it truthful.': 'El gestor publica un perfil público (nombre, entidad, contacto) ligado a esta cuenta y lo mantiene veraz.',
  'Conflicts of interest': 'Conflictos de interés',
  'The manager discloses any interest it holds in a destination before proposing it, and never proposes a destination it controls without saying so in the proposal.': 'El gestor declara cualquier interés que tenga en un destino antes de proponerlo, y nunca propone un destino que controle sin decirlo en la propuesta.',
  'The manager does not front-run, does not trade against the vault and does not use information from the vault for its own account.': 'El gestor no se adelanta a las órdenes, no opera contra la bóveda y no usa información de la bóveda por cuenta propia.',
  'Delegation': 'Delegación',
  'The manager may name a director — an EVM address allowed to move capital inside the cage — for a fixed term that expires by itself and never renews on its own. The manager remains responsible for everything the director does.': 'El gestor puede nombrar un director — una dirección EVM autorizada a mover capital dentro de la jaula — por un plazo fijo que caduca solo y nunca se renueva por sí mismo. El gestor sigue siendo responsable de todo lo que haga el director.',
  'The manager can revoke a director at any time. A director cannot change any rule, add a destination, touch fees or affect a depositor’s exit.': 'El gestor puede revocar a un director en cualquier momento. Un director no puede cambiar ninguna regla, añadir un destino, tocar comisiones ni afectar a la salida de un depositante.',
  'Amendments': 'Enmiendas',
  'This document may be amended by anchoring a new fingerprint from the same account. The previous fingerprint remains on the ledger’s history: amendments are visible, not silent.': 'Este documento puede enmendarse anclando una nueva huella desde la misma cuenta. La huella anterior queda en el historial del ledger: las enmiendas son visibles, no silenciosas.',
  'No amendment can change what the contract fixed at birth (exit window, liquidity floor, fee ceiling) nor weaken Article 4.': 'Ninguna enmienda puede cambiar lo que el contrato fijó al nacer (ventana de salida, suelo de liquidez, techo de comisión) ni debilitar el Artículo 4.',
  'The manager announces an amendment to depositors before anchoring it, with enough time for anyone who disagrees to exit under the current rules.': 'El gestor anuncia una enmienda a los depositantes antes de anclarla, con tiempo suficiente para que quien no esté de acuerdo salga bajo las reglas vigentes.',
  'Wind-down': 'Liquidación',
  'The manager may wind a vault down by retiring all destinations and recalling capital to the vault, so every depositor can exit at pro-rata value. The manager cannot seize, sweep or redirect that capital.': 'El gestor puede liquidar una bóveda retirando todos los destinos y recuperando el capital a la bóveda, para que cada depositante salga a valor a prorrata. El gestor no puede apropiarse de ese capital, barrerlo ni redirigirlo.',
  'If the manager’s credentials lapse, the ledger stops accepting its orders; depositors’ exits remain unaffected.': 'Si las credenciales del gestor caducan, el ledger deja de aceptar sus órdenes; las salidas de los depositantes no se ven afectadas.',
  'Applicable law': 'Ley aplicable',
  'This constitution is governed by the law of the manager’s jurisdiction stated above. Nothing in it limits the rights depositors have under the law that protects them.': 'Esta constitución se rige por la ley de la jurisdicción del gestor arriba indicada. Nada en ella limita los derechos que los depositantes tienen bajo la ley que los protege.',
  'Disputes between the manager and a depositor are between them. Astryum is not a party and does not arbitrate.': 'Las disputas entre el gestor y un depositante son entre ellos. Astryum no es parte y no arbitra.',
  'Anchoring': 'Anclaje',
  'This document is anchored by its SHA-256 fingerprint on the XRP Ledger, in the DID of the managing account (XLS-40). The text itself never goes on-chain.': 'Este documento se ancla por su huella SHA-256 en el XRP Ledger, en el DID de la cuenta gestora (XLS-40). El texto en sí nunca va a la cadena.',
  'The canonical copy of the text lives at the URI recorded next to the fingerprint. Any copy that does not match the fingerprint is not this constitution.': 'La copia canónica del texto vive en el URI registrado junto a la huella. Cualquier copia que no coincida con la huella no es esta constitución.',
  'Signed by anchoring from the managing account': 'Firmada por anclaje desde la cuenta gestora',
  // ── Credencial válida pero de emisor no aceptado: decirlo ──
  'Held, but not from an accepted issuer': 'La tienes, pero no de un emisor aceptado',
  'The ledger holds this credential, issued by': 'El ledger tiene esta credencial, emitida por',
  'this very account — self-issued': 'esta misma cuenta — auto-emitida',
  'The gate only counts issuers on its list': 'La puerta solo cuenta los emisores de su lista',
  'Ask your issuer to grant it from an accepted key; it will then appear below to accept.': 'Pide a tu emisor que la conceda desde una llave aceptada; entonces aparecerá abajo para aceptarla.',
  'this very account': 'esta misma cuenta',
  'Accepted issuer — this one counts for the manager gate.': 'Emisor aceptado — esta cuenta para la puerta del gestor.',
  'Not an accepted issuer — the manager gate ignores this one.': 'Emisor no aceptado — la puerta del gestor no la tiene en cuenta.',
  // ── La guía «Verifícate con Coinbase», paso a paso con capturas ──
  'Create your Coinbase account': 'Crea tu cuenta de Coinbase',
  'At coinbase.com: email, password and the confirmation email. If you already have an account, skip to the next step.': 'En coinbase.com: correo, contraseña y el correo de confirmación. Si ya tienes cuenta, salta al siguiente paso.',
  'Create an account at Coinbase': 'Crear una cuenta en Coinbase',
  'Verify your identity at Coinbase': 'Verifica tu identidad en Coinbase',
  'Coinbase asks for your ID document and a selfie, in its own app. Those documents stay with Coinbase — Astryum never sees them.': 'Coinbase te pide el documento de identidad y un selfie, en su propia app. Esos documentos se quedan en Coinbase — Astryum nunca los ve.',
  'Coinbase help: verify your identity': 'Ayuda de Coinbase: verificar tu identidad',
  'Open Coinbase’s onchain verification': 'Abre la verificación onchain de Coinbase',
  'This is the page that writes the public proof: “this wallet belongs to a verified Coinbase account”. No personal data goes on-chain.': 'Es la página que escribe la prueba pública: «esta wallet pertenece a una cuenta verificada de Coinbase». Ningún dato personal va a la cadena.',
  'coinbase.com/onchain-verify': 'coinbase.com/onchain-verify',
  'Connect the wallet you will use in Astryum': 'Conecta la wallet que usarás en Astryum',
  'Connect the SAME EVM wallet (MetaMask) you connect in Astryum. The proof is issued to that address — a different wallet means Astryum cannot find it.': 'Conecta la MISMA wallet EVM (MetaMask) que conectas en Astryum. La prueba se emite a esa dirección — con otra wallet Astryum no puede encontrarla.',
  'Coinbase help: onchain verification': 'Ayuda de Coinbase: verificación onchain',
  'Mint the “Verified account” attestation': 'Mintea la atestación «Verified account»',
  'One click, free. When Coinbase shows the green tick, the attestation exists on the Base chain and you are done at Coinbase.': 'Un clic, gratis. Cuando Coinbase enseña el tick verde, la atestación existe en la cadena Base y has terminado en Coinbase.',
  'Back in Astryum: check and issue': 'De vuelta en Astryum: comprobar y emitir',
  'In the Title station, with that MetaMask wallet connected, press “Verify & issue what is missing”. Astryum finds your attestation by itself.': 'En la estación Título, con esa wallet de MetaMask conectada, pulsa «Verificar y emitir lo que falte». Astryum encuentra tu atestación sola.',
  'Sign the challenge in MetaMask': 'Firma el reto en MetaMask',
  'One signature ties your EVM wallet to your XRPL manager account. Nothing is sent to any chain and it costs nothing.': 'Una firma ata tu wallet EVM a tu cuenta XRPL de gestor. Nada se envía a ninguna cadena y no cuesta nada.',
  'Accept the credential in Xaman': 'Acepta la credencial en Xaman',
  'The notary issues the KYC credential to your XRPL account; it only counts once you accept it — one signature in your Xaman.': 'El notario emite la credencial KYC a tu cuenta XRPL; solo cuenta cuando la aceptas — una firma en tu Xaman.',
  'Eight screens, most of them at Coinbase. The only thing that reaches Astryum is a public fact on the Base chain: your wallet belongs to a verified account.': 'Ocho pantallas, casi todas en Coinbase. Lo único que llega a Astryum es un hecho público en la cadena Base: tu wallet pertenece a una cuenta verificada.',
  'The links open Coinbase’s official help and pages. Astryum neither creates nor stores identity documents; it reads the public attestation and composes what you sign.': 'Los enlaces abren la ayuda y las páginas oficiales de Coinbase. Astryum ni crea ni guarda documentos de identidad; lee la atestación pública y compone lo que tú firmas.',
  'Step by step: set up Coinbase': 'Paso a paso: configurar Coinbase',
  'Verify yourself with Coinbase': 'Verifícate con Coinbase',
  'Screen by screen — from creating the account to accepting the credential in Xaman.': 'Pantalla a pantalla — desde crear la cuenta hasta aceptar la credencial en Xaman.',
  // ── La mesa en ventana anclable + la estación Título ordenada ──
  'Opens your Manager desk from Earn → Managed vaults: the vaults you run and your certification. Off any time.': 'Abre tu mesa del gestor desde Earn → Managed vaults: las bóvedas que llevas y tu certificación. Se apaga cuando quieras.',
  'If you manage third-party capital as a certified financial manager, declare it and your desk opens from here — Earn → Managed vaults. You can switch it off any time from Settings.': 'Si gestionas capital de terceros como gestor financiero certificado, decláralo y tu mesa se abre desde aquí — Earn → Managed vaults. Puedes apagarlo cuando quieras desde Settings.',
  'Do you manage third-party capital?': '¿Gestionas capital de terceros?',
  'Set up your account, then run your vaults': 'Configura tu cuenta y luego lleva tus bóvedas',
  'full page': 'página completa',
  'In force': 'Vigente',
  'in force': 'vigentes',
  'Expired — renew': 'Caducada — renueva',
  'Not held yet': 'Aún no la tienes',
  'KYC — who you are': 'KYC — quién eres',
  'Verified by Coinbase. Astryum reads the public attestation of the EVM wallet you connect; no document ever touches Astryum.': 'Verificada por Coinbase. Astryum lee la atestación pública de la wallet EVM que conectes; ningún documento toca Astryum.',
  'AIFM — your licence to manage': 'AIFM — tu licencia para gestionar',
  'Three public facts the notary re-checks: your account declares a domain, that domain’s xrp-ledger.toml lists this account, and the domain is in the AIFM register. Or your issuer grants it directly.': 'Tres hechos públicos que el notario re-comprueba: tu cuenta declara un dominio, el xrp-ledger.toml de ese dominio lista esta cuenta, y el dominio está en el registro de AIFM. O tu emisor te la concede directamente.',
  'To run a grouped vault, this XRPL account must hold these credentials. The ledger checks them on every order — Astryum neither issues nor verifies them; it reads them and composes what you sign.': 'Para llevar una bóveda agrupada, esta cuenta XRPL debe sostener estas credenciales. El ledger las comprueba en cada orden — Astryum ni las emite ni las verifica; las lee y compone lo que tú firmas.',
  'The ledger gate is off in this environment — nothing is required yet, but everything here already works.': 'La puerta del ledger está apagada en este entorno — aún no se exige nada, pero todo esto ya funciona.',
  'Let the notary check and issue': 'Que el notario compruebe y emita',
  'the one you connected at Coinbase': 'la que conectaste en Coinbase',
  'No EVM wallet connected — connect the one you used at Coinbase (Wallets → MetaMask) for the KYC leg.': 'Sin wallet EVM conectada — conecta la que usaste en Coinbase (Wallets → MetaMask) para la pata KYC.',
  'Verify & issue what is missing': 'Verificar y emitir lo que falte',
  'accept it below': 'acéptala abajo',
  'Your issuer grants the credentials to this account; when one arrives, it appears below to accept.': 'Tu emisor concede las credenciales a esta cuenta; cuando llegue una, aparece abajo para aceptarla.',
  'Accept it in your Xaman — that signature is what makes it count': 'Acéptala en tu Xaman — esa firma es la que la hace valer',
  'More: accepted issuers, partner credential, the certifier': 'Más: emisores aceptados, credencial del partner, la certificadora',
  // ── La firma de la credencial, arriba y a la vista ──
  'Your signature is needed': 'Hace falta tu firma',
  'credential to accept': 'credencial por aceptar',
  'credentials to accept': 'credenciales por aceptar',
  'An issuer granted this account a credential. It only counts once YOU accept it — one signature in your Xaman, nothing else.': 'Un emisor ha concedido una credencial a esta cuenta. Solo cuenta cuando TÚ la aceptas — una firma en tu Xaman, nada más.',
  'Nothing accepted yet — the credentials above are waiting for your signature.': 'Aún nada aceptado — las credenciales de arriba esperan tu firma.',
  'Issued. Now accept it: the signature card below is waiting for your Xaman.': 'Emitida. Ahora acéptala: la tarjeta de firma de abajo espera tu Xaman.',
  // ── El notario encuentra la atestación solo: sin pegar ──
  'KYC: Astryum finds the Coinbase attestation of the EVM wallet you have connected — the one you connected at Coinbase — and you sign one challenge with it. AIFM: the notary re-runs the domain and register checks. If the facts hold, the credential lands in your tray — accepting it is still your signature.': 'KYC: Astryum encuentra la atestación de Coinbase de la wallet EVM que tienes conectada — la misma que conectaste en Coinbase — y firmas un reto con ella. AIFM: el notario re-ejecuta los checks de dominio y registro. Si los hechos aguantan, la credencial cae en tu bandeja — aceptarla sigue siendo tu firma.',
  'Connected EVM wallet': 'Wallet EVM conectada',
  'EVM wallet linked to your account': 'Wallet EVM enlazada a tu cuenta',
  'the one you verified at Coinbase. Not connected in this browser: MetaMask will be asked to connect it when it has to sign.':
    'la que verificaste en Coinbase. Sin sesión en este navegador: cuando toque firmar, se pedirá conectarla en MetaMask.',
  'Connect it now': 'Conectarla ahora',
  'Connect MetaMask with': 'Conecta MetaMask con',
  'to sign the binding, then press again.': 'para firmar el vínculo, y vuelve a pulsar.',
  'No EVM wallet connected — connect the one you used at Coinbase to issue the KYC leg.': 'Sin wallet EVM conectada — conecta la que usaste en Coinbase para emitir la pata KYC.',
  'Check my Coinbase verification & issue (KYC + AIFM)': 'Comprobar mi verificación de Coinbase y emitir (KYC + AIFM)',
  'Paste the attestation link yourself (if the automatic lookup fails)': 'Pegar el enlace de la atestación a mano (si la búsqueda automática falla)',
  'Issue from this link': 'Emitir desde este enlace',
  // ── La comunidad de managed vaults: cara, persona/agente, apoyos e imagen de bóveda ──
  'A person': 'Una persona',
  'AI agent': 'Agente de IA',
  'AI agents': 'Agentes de IA',
  'An AI agent': 'Un agente de IA',
  'Back to community': 'Volver a la comunidad',
  'Community': 'Comunidad',
  'Community of managers': 'Comunidad de gestores',
  'Credential on some vaults': 'Credencial en algunas bóvedas',
  'Log in to support this manager.': 'Inicia sesión para apoyar a este gestor.',
  'Managers appear here as soon as they run a vault or publish a profile. Support is given by users, one vote each.': 'Los gestores aparecen aquí en cuanto llevan una bóveda o publican un perfil. El apoyo lo dan los usuarios, un voto cada uno.',
  'Most supported': 'Más apoyados',
  'Most vaults': 'Más bóvedas',
  'My profile photo': 'Mi foto de perfil',
  'Newest': 'Más recientes',
  'No image': 'Sin imagen',
  'No vaults yet': 'Aún sin bóvedas',
  'Nobody here yet': 'Aún no hay nadie',
  'On the card': 'En la carta',
  'Open full profile': 'Abrir el perfil completo',
  'Open profile': 'Abrir perfil',
  'People': 'Personas',
  'Person': 'Persona',
  'Photo': 'Foto',
  'Pick an emblem, use your profile photo, or leave it without one — clients see it on the card in Earn. Without a choice, the card shows your profile photo or your account mark.': 'Elige un emblema, usa tu foto de perfil o déjala sin imagen — los clientes la ven en la carta de Earn. Sin elección, la carta enseña tu foto de perfil o la marca de tu cuenta.',
  'Prove this account is yours: sign once in Xaman (nothing is sent to the ledger, no cost). Astryum never signs.': 'Demuestra que esta cuenta es tuya: firma una vez en Xaman (nada se envía al ledger, sin coste). Astryum nunca firma.',
  'Reading the community…': 'Leyendo la comunidad…',
  'See your page in the community': 'Ver tu página en la comunidad',
  'Support': 'Apoyar',
  'Support is given by users, one vote per account, counted on the server. The order you see is the one you chose — it is not a recommendation, and “verified” is a ledger fact, not an opinion.': 'El apoyo lo dan los usuarios, un voto por cuenta, contado en el servidor. El orden que ves es el que has elegido — no es una recomendación, y «verificado» es un hecho del ledger, no una opinión.',
  'Supported': 'Apoyado',
  'Supporting a manager is a community vote, counted on the server — one per account. It surfaces managers through a sort you choose, never as Astryum vouching for anyone.': 'Apoyar a un gestor es un voto de la comunidad, contado en el servidor — uno por cuenta. Da visibilidad a través de un orden que tú eliges, nunca como aval de Astryum a nadie.',
  'The catalogue could not be read right now — vault counts and credentials may be missing.': 'El catálogo no se pudo leer ahora mismo — pueden faltar el número de bóvedas y las credenciales.',
  'The community tally could not be read right now — names and support may be missing. That says nothing about anyone.': 'El recuento de la comunidad no se pudo leer ahora mismo — pueden faltar nombres y apoyos. Eso no dice nada de nadie.',
  'This account is run by': 'Esta cuenta la lleva',
  'To use your photo, put one on your public profile first —': 'Para usar tu foto, ponla primero en tu perfil público —',
  'Use my account photo': 'Usar la foto de mi cuenta',
  'Vault image': 'Imagen de la bóveda',
  'Vaults, capital and accreditation are chain facts, not results. Astryum lists them; it never manages and never recommends one.': 'Bóvedas, capital y acreditación son hechos de la cadena, no resultados. Astryum las lista; nunca gestiona ni recomienda ninguna.',
  'Who runs vaults here — people and AI agents, verified or not — with their vaults and the support other users gave them. Astryum lists; it never ranks or vouches.': 'Quién lleva bóvedas aquí — personas y agentes de IA, verificados o no — con sus bóvedas y el apoyo que les han dado otros usuarios. Astryum lista; nunca ordena ni avala.',
  'Your account has no photo yet — add one in Settings → Profile.': 'Tu cuenta aún no tiene foto — añádela en Settings → Perfil.',
  'or an https:// link': 'o un enlace https://',
  'station “Public profile”': 'estación «Perfil público»',
  'supporters': 'apoyos',
  'vault': 'bóveda',
  // ── Operate como galería de potes ──
  'Your vaults — pick one to move its capital, or open a new one': 'Tus bóvedas — elige una para mover su capital, o abre una nueva',
  'New vault': 'Nueva bóveda',
  'No vault yet — open your first with the + above, or finish setup in “Configure the account”.':
    'Aún sin bóveda — abre la primera con el + de arriba, o termina el alta en «Configurar la cuenta».',
  'Operate': 'Operar',
  'The whole setup, station by station: dedicated account, first verification, constitution, cage and first vault':
    'El alta entera, estación a estación: cuenta dedicada, primera verificación, constitución, jaula y primer vault',
  'Your vaults, their consoles, orders to the cage — and credential renewal':
    'Tus bóvedas, sus consolas, las órdenes a la jaula — y la renovación de credenciales',
  'No vault yet — the whole setup lives in “Configure the account”. The console below already speaks to your cage the moment it exists.':
    'Aún sin bóveda — el alta entera vive en «Configurar la cuenta». La consola de abajo ya habla con tu jaula en cuanto exista.',
  'A DEDICATED account, used for managing and nothing else — pick it or create it':
    'Una cuenta DEDICADA, solo para gestionar — elígela o créala',
  'The first-time verification: KYC and AIFM credentials, issued to THIS account':
    'La primera verificación: las credenciales KYC y AIFM, emitidas a ESTA cuenta',
  'Template or your own document; the fingerprint computes itself and anchors with 1 signature':
    'Plantilla o tu documento; la huella se calcula sola y se ancla con 1 firma',
  'The cage is born obeying this account; then the first pote, with your parameters':
    'La jaula nace obedeciendo a esta cuenta; después el primer pote, con tus parámetros',
  'Cage & first vault': 'Jaula y primer vault',
  '~2 min · Xaman': '~2 min · Xaman',
  '~10 min · partner + your signatures': '~10 min · partner + tus firmas',
  '~5 min · 1 signature': '~5 min · 1 firma',
  '~5 min · signatures + FDC toll': '~5 min · firmas + peaje FDC',
  // El wizard: la estación de la constitución (fácil, como el Legacy)
  'Constitution of the managed grouped vehicle': 'Constitución del vehículo agrupado gestionado',
  'Managing XRPL account': 'Cuenta XRPL gestora',
  'The manager directs capital ONLY inside the cage: whitelisted venues, the exit window and the buffer floor bind the manager too.':
    'La gestora dirige el capital SOLO dentro de la jaula: los destinos de la whitelist, la ventana de salida y el suelo del colchón la atan también a ella.',
  'Depositor exits are never blocked, never gated, never capped.':
    'Las salidas de los depositantes jamás se bloquean, jamás llevan puerta, jamás llevan tope.',
  'The manager’s fee applies to yield only — never to principal.':
    'La comisión de la gestora aplica solo al rendimiento — jamás al principal.',
  'This document is anchored by its SHA-256 fingerprint on XRPL (XLS-40). The text itself never goes on-chain.':
    'Este documento se ancla por su huella SHA-256 en XRPL (XLS-40). El texto en sí jamás va a la cadena.',
  'Write or paste the document first — the fingerprint computes itself.':
    'Escribe o pega el documento primero — la huella se calcula sola.',
  'The link must be https:// or ipfs:// (optional).': 'El enlace debe ser https:// o ipfs:// (opcional).',
  'Anchor the constitution (DIDSet) — your signature': 'Anclar la constitución (DIDSet) — tu firma',
  'The constitution — template or your own': 'La constitución — plantilla o la tuya',
  'Nobody writes a constitution from a blank page: start from the template and edit freely, or paste your own document. Only its fingerprint is anchored — the text never leaves this browser.':
    'Nadie escribe una constitución desde la página en blanco: parte de la plantilla y edítala libremente, o pega tu propio documento. Solo se ancla su huella — el texto jamás sale de este navegador.',
  'Start from the template': 'Partir de la plantilla',
  'Paste my own document': 'Pegar mi documento',
  'Paste the full text of your governance document…': 'Pega el texto completo de tu documento de gobierno…',
  'Where the document lives (optional — https/ipfs)': 'Dónde vive el documento (opcional — https/ipfs)',
  'Anchored to account': 'Anclada a la cuenta',
  'this one — set automatically': 'esta — puesta automáticamente',
  '(computes as you write)': '(se calcula mientras escribes)',
  'Anchor the fingerprint (DIDSet — 1 signature)': 'Anclar la huella (DIDSet — 1 firma)',
  // El rail con detección real + la estación propia de la jaula
  'Setup stations': 'Estaciones del alta',
  'First vault': 'Primer vault',
  'Born with one 0xFE signature, obeying this account for ever': 'Nace con una firma 0xFE, obedeciendo a esta cuenta para siempre',
  'The pote opens inside the cage, with your parameters': 'El pote se abre dentro de la jaula, con tus parámetros',
  '~3 min · 1 signature + toll': '~3 min · 1 firma + peaje',
  '~5 min · 1 signature + FDC toll': '~5 min · 1 firma + peaje FDC',
  'The setup': 'El alta',
  'Six stations. You can leave at any station and come back: everything lives on the ledger, so the setup resumes exactly where reality is — each circle turns green when the chain says so, never before.':
    'Seis estaciones. Puedes salir en cualquiera y volver: todo vive en el ledger, así que el alta retoma exactamente donde la realidad está — cada círculo se pone en verde cuando la cadena lo dice, jamás antes.',
  'What you need: your phone with Xaman, a DEDICATED new account (~5 XRP covers reserves and fees), and your Coinbase verification for the KYC leg.':
    'Qué necesitas: tu móvil con Xaman, una cuenta nueva DEDICADA (~5 XRP cubren reservas y fees), y tu verificación de Coinbase para la pata KYC.',
  'Already anchored on the ledger': 'Ya anclada en el ledger',
  'Anchoring again replaces the fingerprint.': 'Volver a anclar sustituye la huella.',
  'Your cage is born and obeys this account': 'Tu jaula ha nacido y obedece a esta cuenta',
  'One cage per XRPL account, for ever. Next station: the first vault opens inside it.':
    'Una jaula por cuenta XRPL, para siempre. Siguiente estación: el primer vault se abre dentro.',
  'Birth your cage': 'Haz nacer tu jaula',
  'One signature (0xFE) from THIS account makes the cage exist on Flare, obeying only this account — no key of Astryum anywhere.':
    'Una firma (0xFE) de ESTA cuenta hace existir la jaula en Flare, obedeciendo solo a esta cuenta — sin ninguna llave de Astryum en ningún sitio.',
  'The cage holds no capital and follows the Astryum venue registry. Its rules will bind you too.':
    'La jaula no guarda capital y sigue el registro de venues de Astryum. Sus reglas te atarán también a ti.',
  'The XRP below rides with the order to pay the crossing; the cage appears here on its own once proven.':
    'El XRP de abajo viaja con la orden para pagar el cruce; la jaula aparecerá aquí sola en cuanto se pruebe.',
  'XRP that rides with the order': 'XRP que viaja con la orden',
  'Birth the cage — your 0xFE signature': 'Nacer la jaula — tu firma 0xFE',
  'Signed. The network is proving it; this station will turn green on its own in a couple of minutes.':
    'Firmado. La red lo está probando; esta estación se pondrá en verde sola en un par de minutos.',
  'Compose the birth (1 signature)': 'Componer el nacimiento (1 firma)',
  // La jaula a un botón + la estación 6: el perfil público
  'The cage locks NO capital, ever: from now on every order of this account passes through it, and that is all it does.':
    'La jaula NO bloquea capital, jamás: desde ahora cada orden de esta cuenta pasa por ella, y eso es todo lo que hace.',
  'The order carries a fixed': 'La orden lleva un fijo de',
  'it only pays the crossing (FDC) and the contract creation gas. The cage appears here on its own once proven.':
    'solo paga el cruce (FDC) y el gas de crear el contrato. La jaula aparecerá aquí sola en cuanto se pruebe.',
  'it pays the crossing toll; whatever is left is minted as FXRP into YOUR Personal Account — your money, and the fuel for future costs — always paid FROM XRPL. The first 3 potes carry NO Astryum fee (the network always charges its own). The cage appears here on its own once proven.':
    'paga el peaje del cruce; lo que sobre se mintea como FXRP en TU Personal Account — dinero tuyo, y la gasolina de futuros costes — siempre pagados DESDE XRPL. Los 3 primeros potes no llevan fee de Astryum (la red siempre cobra lo suyo). La jaula aparecerá aquí sola en cuanto se pruebe.',
  'Public profile': 'Perfil público',
  'The card clients review before depositing — your word plus the ledger’s facts':
    'La ficha que el cliente revisa antes de depositar — tu palabra más los hechos del ledger',
  '~3 min · here': '~3 min · aquí',
  'What clients read before putting capital in your vault. It is your word, clearly labelled as such — the verified part (credentials, expiry, the proof on Base) is read from the ledger and cannot be typed.':
    'Lo que el cliente lee antes de poner capital en tu vault. Es tu palabra, etiquetada como tal — la parte verificada (credenciales, caducidad, la prueba en Base) se lee del ledger y no se puede teclear.',
  'Entity / firm (optional)': 'Entidad / firma (opcional)',
  'Bio (optional)': 'Bio (opcional)',
  'Photo URL (optional — https)': 'URL de la foto (opcional — https)',
  'Website (optional — https)': 'Web (opcional — https)',
  'X / Twitter handle (optional)': 'Usuario de X / Twitter (opcional)',
  'Profile saved — clients will see it in your public card.': 'Perfil guardado — los clientes lo verán en tu ficha pública.',
  'How clients will see it': 'Cómo lo verán los clientes',
  // ManagerPublicProfile (la ficha pública)
  'The profile could not be read right now — that says nothing about the manager.':
    'El perfil no se pudo leer ahora mismo — eso no dice nada del gestor.',
  'Reading the profile…': 'Leyendo el perfil…',
  'Website': 'Web',
  'Self-declared by the account’s proven owner — their word, clearly labelled. The facts below are read from the ledger.':
    'Auto-declarado por el dueño probado de la cuenta — su palabra, etiquetada como tal. Los hechos de abajo se leen del ledger.',
  'This manager has not published a profile yet. The ledger facts below stand on their own.':
    'Este gestor aún no ha publicado perfil. Los hechos del ledger de abajo se sostienen solos.',
  'Verified on the ledger': 'Verificado en el ledger',
  'No credential in force right now.': 'Ninguna credencial vigente ahora mismo.',
  'View proof': 'Ver la prueba',
  'Open the register entry': 'Abrir la entrada del registro',
  'Astryum brings on-chain the link each credential declares — it does NOT verify or certify the licence. Open it, check the register yourself, and decide whether to trust: it’s your call and your responsibility.':
    'Astryum trae on-chain el enlace que declara cada credencial — NO verifica ni certifica la licencia. Ábrelo, compruébalo tú en el registro y decide si confías: es tu decisión y tu responsabilidad.',
  'Retire venue (30-day fuse)': 'Retirar venue (mecha de 30 días)',
  'Evacuate venue now': 'Evacuar el venue ya',
  'Max per venue (bps)': 'Techo por venue (bps)',
  'Basis points must be 0–10000.': 'Los puntos básicos van de 0 a 10000.',
  'Verify & issue both (KYC + AIFM)': 'Verificar y emitir los dos (KYC + AIFM)',
  'issued': 'emitida',
  'already in force': 'ya vigente',
  'accept what is pending in your tray below.': 'acepta lo pendiente en tu bandeja, abajo.',
  'A vault obeys ONE XRPL account. Pick which of your connected wallets acts as the manager — credentials, cage and orders on this desk all follow this choice.':
    'Una bóveda obedece a UNA cuenta XRPL. Elige cuál de tus wallets conectadas actúa como gestora — las credenciales, la jaula y las órdenes de esta mesa siguen esa elección.',
  // ── Certificación del gestor: circuito real XLS-70 (corrección — el FDC
  //    no puede llevar nada a XRPL; la credencial ES el raíl) ──
  'Astryum neither creates nor custodies certification documents. Your details and your identity document go directly to the independent certifying company, through their channels — they never touch Astryum. Once they certify you, the credential is issued to your XRPL account (XLS-70); you accept it in your tray, and the ledger itself enforces it on every vault you run.':
    'Astryum ni crea ni custodia documentos de certificación. Tus datos y tu documento de identidad van directamente a la certificadora independiente, por sus canales — jamás tocan Astryum. Cuando te certifica, la credencial se emite a tu cuenta XRPL (XLS-70); la aceptas en tu bandeja, y el propio ledger la hace cumplir en cada bóveda que llevas.',
  'Credential issued to your XRPL account (XLS-70)': 'Credencial emitida a tu cuenta XRPL (XLS-70)',
  'You accept it in your tray — the ledger enforces it': 'La aceptas en tu bandeja — el ledger la hace cumplir',
  'Step 0: anchor the SHA-256 of the governance document on XRPL (DIDSet). The pote cannot be born without it. The document never travels — only its fingerprint.':
    'Paso 0: ancla el SHA-256 del documento de gobierno en XRPL (DIDSet). El pote no puede nacer sin él. El documento nunca viaja — solo su huella.',
  'The manager account must be an XRPL r-address.': 'La cuenta del gestor tiene que ser una r-address XRPL.',
  'The checks could not be read right now — that says nothing about the binding itself.': 'Los checks no se pudieron leer ahora mismo — eso no dice nada del binding en sí.',

  // ── Reorg Managed vaults: Earn = solo el catálogo; la mesa del
  //    gestor a /app/manager (sidebar condicional) y la auditora a /app/partner
  //    (solo URL). Perfil profesional en Settings + sub-paso del onboarding. ──
  'Professional': 'Profesional',
  'Manager desk': 'Mesa del gestor',
  'Create and govern the vaults you run, and the certification that backs you. Clients never see this page — they find your vaults in Earn.':
    'Crea y gobierna las bóvedas que llevas, y la certificación que te respalda. Los clientes nunca ven esta página — tus bóvedas las encuentran en Earn.',
  'Before anything': 'Antes de nada',
  'This desk is for vault managers': 'Esta mesa es para gestores de bóvedas',
  'If you manage third-party capital as a certified financial manager, declare it and this desk joins your sidebar. You can switch it off any time from Settings.':
    'Si gestionas capital de terceros como gestor financiero certificado, decláralo y esta mesa se añade a tu menú lateral. Puedes apagarlo cuando quieras desde Ajustes.',
  'I am a vault manager': 'Soy gestor de bóvedas',
  'Your on-chain registry and your clients. Astryum composes the calls; the admin of the registry — you — signs every one.':
    'Tu registro on-chain y tus clientes. Astryum compone las llamadas; el admin del registro — tú — firma todas.',
  'The vaults you run moved to their own desk —': 'Las bóvedas que llevas se mudaron a su propia mesa —',
  'open Manager desk': 'abrir la Mesa del gestor',
  'Because you declared yourself a manager: create and govern the vaults you run, and your certification. Clients find your vaults inside Earn.':
    'Porque te declaraste gestor: crea y gobierna las bóvedas que llevas, y tu certificación. Los clientes encuentran tus bóvedas dentro de Earn.',
  'Vault manager': 'Gestor de bóvedas',
  'I manage third-party capital': 'Gestiono capital de terceros',
  'Adds the Manager desk to your sidebar: the vaults you run and your certification. Off any time.':
    'Añade la Mesa del gestor a tu menú lateral: las bóvedas que llevas y tu certificación. Se apaga cuando quieras.',
  'Manager: on': 'Gestor: activado',
  'Manager: off': 'Gestor: desactivado',
  'Open Manager desk': 'Abrir la Mesa del gestor',
  // La tarjeta de certificación (KYC del gestor) — nace tapada (PreviewOnly).
  'Manager certification (KYC)': 'Certificación del gestor (KYC)',
  'Your certification, verified by an auditor — never by Astryum':
    'Tu certificación, verificada por una auditora — nunca por Astryum',
  'What you fill here travels to an independent contract auditor. If they certify you, the verdict is anchored on their chain, the FDC carries it to XRPL, and every vault you open links back to it. Astryum neither certifies nor decides — it only shows what the ledger says.':
    'Lo que rellenas aquí viaja a una auditora de contratos independiente. Si te certifica, el veredicto se ancla en su chain, el FDC lo lleva a XRPL, y cada bóveda que abras queda vinculada a él. Astryum ni certifica ni decide — solo enseña lo que dice el ledger.',
  'Draft': 'Borrador',
  'Sent to the auditor': 'Enviado a la auditora',
  'Under review': 'En revisión',
  'Certified on-chain': 'Certificado on-chain',
  'Linked on XRPL (FDC)': 'Vinculado en XRPL (FDC)',
  'Draft saved in this browser. Nothing has been sent anywhere.':
    'Borrador guardado en este navegador. No se ha enviado nada a ningún sitio.',
  'Legal name': 'Nombre legal',
  'Licence or registration number': 'Número de licencia o registro',
  'Jurisdiction that issued it': 'Jurisdicción que lo emitió',
  'Replace the certification document': 'Sustituir el documento de certificación',
  'Attach your certification document': 'Adjunta tu documento de certificación',
  'Save draft': 'Guardar borrador',
  'Send to the auditor': 'Enviar a la auditora',
  'The certification rail is not connected yet': 'El raíl de certificación aún no está conectado',
  'The rail to the auditor is not connected yet — your draft stays in this browser until it is.':
    'El raíl hacia la auditora aún no está conectado — tu borrador se queda en este navegador hasta que lo esté.',
  'Fill the three fields and attach the document to complete the draft.':
    'Rellena los tres campos y adjunta el documento para completar el borrador.',

  // ── El catálogo de bóvedas con la mano de Earn + perfil del gestor ──
  'Pick a vault — its cage, its destinations and who runs it unfold beside it.':
    'Elige una bóveda — su jaula, sus destinos y quién la lleva se despliegan al lado.',
  'See profile': 'Ver perfil',
  'Manager of this vault': 'Gestor de esta bóveda',
  // «Astryum made» = bóveda sin gestor tercero. NUNCA «gestionada por Astryum»:
  // Astryum no gestiona capital de nadie (invariantes #1/#8).
  'Demo vault — no third-party manager runs it': 'Bóveda de demostración — no la lleva ningún gestor externo',
  'Demo vaults by Astryum — no third-party manager runs these.':
    'Bóvedas de demostración de Astryum — no las lleva ningún gestor externo.',
  'Vaults': 'Bóvedas',
  'Capital inside': 'Capital dentro',
  'Depositors': 'Depositantes',
  'How many accounts sit in each vault is not on the public chain read yet — the slot will fill when that read lands. Nothing here is a performance figure: vaults, capital and accreditation are chain facts, not results.':
    'Cuántas cuentas hay dentro de cada bóveda aún no se lee de la cadena pública — el hueco se llenará cuando llegue esa lectura. Nada de aquí es una cifra de rendimiento: bóvedas, capital y acreditación son hechos de la cadena, no resultados.',
  'The vaults this manager runs': 'Las bóvedas que lleva este gestor',
  'No open vaults right now.': 'Ninguna bóveda abierta ahora mismo.',
  'Community support': 'Apoyo de la comunidad',
  'Supporting a manager is a community vote: when the public tally arrives, the most supported managers can be surfaced through a sort you choose — never as a default order, and never as Astryum vouching for anyone.':
    'Apoyar a un gestor es un voto de la comunidad: cuando llegue el recuento público, los gestores más apoyados podrán destacarse mediante un orden que elijas tú — nunca como orden por defecto, y nunca como aval de Astryum.',
  'Support this manager': 'Apoyar a este gestor',
  'Supported by you — withdraw': 'Apoyado por ti — retirar',
  'Your vote is kept in this browser for now and joins the public tally when that rail exists.':
    'Tu voto se guarda de momento en este navegador y se sumará al recuento público cuando exista ese raíl.',
  'Supported by you': 'Apoyados por ti',
  // La frase de la card por identidad — jamás «La lleva Astryum made».
  'Demo vault — no third-party manager': 'Bóveda de demostración — sin gestor externo',
  'Manager unresolved': 'Gestor sin resolver',
  'Could not read': 'No se pudo leer',
  'Credential on': 'Credencial en',
  'vaults': 'bóvedas',
  'vaults could not be read and are not in the sum.': 'bóvedas sin lectura — no entran en la suma.',
  'Copying failed here — select the link by hand:': 'Aquí no se pudo copiar — selecciona el enlace a mano:',
  'Delete draft': 'Borrar borrador',
  'Draft deleted from this browser.': 'Borrador borrado de este navegador.',
  // ── Govern en CINCO salas (2ª pasada): cada pestaña responde
  //    una pregunta. 'Capital', 'Council' y 'Activity' ya existen arriba. ──
  'What is inside and what it produces': 'Qué hay dentro y qué produce',
  'Who commands, with which quorum': 'Quién manda, y con qué quórum',
  'Orders': 'Órdenes',
  'Compose what the quorum will sign': 'Componer lo que firmará el quórum',
  'Inbox': 'Bandeja',
  'Sign what is already composed': 'Firmar lo ya compuesto',
  'What has happened, with its on-chain proof': 'Qué ha pasado, con su prueba on-chain',
  'Composing an order signs nothing: it lands in the inbox and waits there for the quorum.':
    'Componer una orden no firma nada: cae en la bandeja y allí espera al quórum.',
  'Read straight from the chain. Moving any of it takes an order and the quorum — never Astryum.':
    'Leído directamente de la cadena. Mover cualquier parte exige una orden y el quórum — jamás Astryum.',
  'Every entry here happened on-chain and can be opened at its proof.':
    'Cada entrada de aquí ocurrió on-chain y se puede abrir en su prueba.',
  // ── Capital del Legacy, sin huecos mudos. ──
  'No cage — and that is the point': 'Sin jaula — y es justo lo que pediste',
  'This is your own wallet held by a quorum: its capital stays on the account, reachable by your signatures. A cage is a one-way door and reinforcing deliberately does not open it.':
    'Esta es tu propia wallet, sostenida por un quórum: su capital se queda en la cuenta, al alcance de tus firmas. Una jaula es una puerta de un solo sentido, y reforzar no la abre a propósito.',
  'The cage could not be read': 'No se pudo leer la jaula',
  'That is not the same as it being empty: whatever this Legacy holds is on Flare and untouched. Try again in a moment.':
    'Eso no es lo mismo que esté vacía: lo que este Legacy tenga sigue en Flare, intacto. Prueba otra vez en un momento.',
  'On the account (XRPL)': 'En la cuenta (XRPL)',
  'Spendable after the ledger reserves:': 'Disponible tras las reservas del ledger:',
  'Moving it takes an order and the quorum.': 'Moverlo exige una orden y el quórum.',
  'The account balance could not be read right now — that is not the same as it being zero.':
    'El saldo de la cuenta no se pudo leer ahora mismo — eso no es lo mismo que sea cero.',
  // Gobernar como operación — el subtítulo del host.
  'the quorum signs — Astryum never does': 'firma el quórum — Astryum jamás',
  // La certificación como REFERRAL: ni creación ni custodia de
  // documentos — la tarjeta explica el circuito y la puerta va por env.
  'You get certified at the certifier — never at Astryum':
    'Te certificas en la certificadora — nunca en Astryum',
  'Astryum neither creates nor custodies certification documents. Your details and your identity document go directly to the independent certifying company, through their channels — they never touch Astryum. Once they certify you, the verdict is anchored on their chain, the FDC carries it to XRPL, and every vault you open links back to it.':
    'Astryum ni crea ni custodia documentos de certificación. Tus datos y tu documento identificativo van directamente a la empresa certificadora independiente, por sus canales — jamás tocan Astryum. Cuando te certifica, el veredicto se ancla en su chain, el FDC lo lleva a XRPL, y cada bóveda que abras queda vinculada a él.',
  'Get certified at the certifying company': 'Certifícate en la empresa certificadora',
  'Go to the certifying company': 'Ir a la empresa certificadora',
  'Get certified at': 'Certifícate en',
  'The certifying company is not announced yet': 'La empresa certificadora aún no está anunciada',
  'The certifying company is being selected — this door opens the moment it exists.':
    'La empresa certificadora se está eligiendo — esta puerta se abre en cuanto exista.',
  'You leave Astryum: what you submit there is between you and the certifier.':
    'Sales de Astryum: lo que entregues allí queda entre tú y la certificadora.',
  // ── VaultCreator: el creador de vaults interactivo — cinco
  //    estaciones, card viva del catálogo y hoja de promesas. ──
  // ('Create a vault' ya existe arriba.)
  'Identity': 'Identidad',
  'The two promises': 'Las dos promesas',
  'Review & open': 'Revisar y abrir',
  'Founder tunnel — signing disabled': 'Túnel de fundador — firma desactivada',
  'The name and the share symbol are what clients see first — on the card, in their wallet, on every receipt.':
    'El nombre y el símbolo de las participaciones son lo primero que ve el cliente — en la card, en su wallet, en cada recibo.',
  'e.g. Prudent FXRP yield': 'p.ej. Rendimiento FXRP prudente',
  'Share symbol': 'Símbolo de las participaciones',
  'Depositors receive shares under this symbol — standard tokens in their own wallet, never in yours.':
    'Los depositantes reciben participaciones bajo este símbolo — tokens estándar en su propia wallet, jamás en la tuya.',
  'works': 'trabaja',
  'No cap: one account could hold the whole vault. A cap keeps any single client from dominating your exits.':
    'Sin tope: una sola cuenta podría tener la bóveda entera. Un tope evita que un único cliente domine tus salidas.',
  'Entries only; exits are never blocked': 'Solo entradas; las salidas nunca se bloquean',
  'Ceiling of your cut (set at birth)': 'Tope de tu comisión (se fija al nacer)',
  'The actual cut is set later, in the console, and can move — but never above this ceiling, and only ever on the yield, not the principal. Zero here means zero for ever.':
    'La comisión real se fija después, en la consola, y puede moverse — pero nunca por encima de este tope, y siempre solo sobre el rendimiento, jamás sobre el principal. Cero aquí es cero para siempre.',
  'Read the promise sheet beside the card. Neither promise can be taken back.':
    'Lee la hoja de promesas junto a la card. Ninguna promesa se puede retirar.',
  'Founder tunnel: this is exactly what a manager will sign, but the tunnel does not sign — connect a manager account on the desk to open it for real.':
    'Túnel de fundador: esto es exactamente lo que firmará un gestor, pero el túnel no firma — conecta una cuenta de gestor en la mesa para abrirla de verdad.',
  'Reading your cage…': 'Leyendo tu jaula…',
  'First, one signature births your cage — a command contract that obeys only your account and never holds capital. It follows the Astryum registry; an eternal own-list is the advanced path in the console below.':
    'Primero, una firma hace nacer tu jaula — un contrato de mando que solo obedece a tu cuenta y jamás custodia capital. Sigue al registro de Astryum; la lista eterna propia es la vía avanzada, en la consola de abajo.',
  'If the birth refuses, anchor the council constitution first — the card above this creator does it.':
    'Si el nacimiento se niega, ancla antes la constitución del consejo — la tarjeta encima de este creador lo hace.',
  'Name and symbol first — station 1.': 'Nombre y símbolo primero — estación 1.',
  'What clients will see in Earn': 'Lo que los clientes verán en Earn',
  'Your vault': 'Tu bóveda',
  'Run by you': 'La llevas tú',
  'The promise sheet': 'La hoja de promesas',
  'Each station you pass writes its promise here.': 'Cada estación que pasas escribe aquí su promesa.',
  'Any account may hold any size — no per-account cap.':
    'Cualquier cuenta puede tener cualquier tamaño — sin tope por cuenta.',
  'Your cut is capped at zero for ever: every unit of yield capitalizes for depositors.':
    'Tu comisión queda topada a cero para siempre: cada unidad de rendimiento capitaliza para los depositantes.',
  'Your cut can never exceed': 'Tu comisión nunca puede superar el',
  'of the yield — never of the principal.': 'del rendimiento — jamás del principal.',
  'It opens with no destinations — each one you propose later waits 30 days before a single token can go there.':
    'Abre sin destinos — cada uno que propongas después espera 30 días antes de que un solo token pueda ir allí.',
  'It can only work in the': 'Solo puede trabajar en los',
  'destination you chose — adding one later takes 30 days.':
    'destino que elegiste — añadir otro después tarda 30 días.',
  'destinations you chose — adding one later takes 30 days.':
    'destinos que elegiste — añadir otro después tarda 30 días.',
  // El flag de gestor viaja a la cuenta — el aviso del fallo.
  'The change did not reach your account — it was undone. Try again in a moment; without it, other browsers would not see it.':
    'El cambio no llegó a tu cuenta — se ha deshecho. Prueba de nuevo en un momento; sin él, los demás navegadores no lo verían.',
  'You support this manager': 'Apoyas a este gestor',
  'Copy profile link': 'Copiar enlace del perfil',
  'Link copied': 'Enlace copiado',
  'The link opens Earn directly on this profile — how a manager brings their own clients.':
    'El enlace abre Earn directamente en este perfil — así trae un gestor a sus propios clientes.',
  // ── El ajuste de movimiento (components/settings/MotionSettings.tsx) ──
  Motion: 'Movimiento',
  'How much the interface moves, and with which face. One setting, every screen.':
    'Cuánto se mueve la interfaz, y con qué cara. Un ajuste, todas las pantallas.',
  Full: 'Completo',
  Calm: 'Sereno',
  Minimal: 'Mínimo',
  'Living scenes on the doors, the routes as a hand of cards that tilts and opens under the cursor, breathing dots and cursor sheens.':
    'Escenas vivas en las puertas, las rutas como una mano de cartas que se inclina y se abre bajo el cursor, puntos que respiran y reflejos que siguen al ratón.',
  'Engraved emblems that turn and breathe slowly, the routes on a flat shelf that lifts a touch under the cursor, dots with a soft halo. Slow and small — the light follows the cursor with a lag.':
    'Emblemas grabados que giran y respiran despacio, las rutas en una estantería plana que sube un punto bajo el cursor, puntos con un halo suave. Lento y pequeño — la luz sigue al cursor con retardo.',
  'Text first: doors and routes become lists, buttons go flat and square, no shadows, no transitions.':
    'Texto primero: puertas y rutas se vuelven listas, los botones quedan planos y rectos, sin sombras, sin transiciones.',
  'Hover or tap to try it.': 'Pasa el ratón o toca para probarlo.',
  'Doors: living scene': 'Puertas: escena viva',
  'Doors: slow emblem': 'Puertas: emblema lento',
  'Doors: list rows': 'Puertas: filas de lista',
  'Routes: hand of cards': 'Rutas: mano de cartas',
  'Routes: flat shelf': 'Rutas: estantería plana',
  'Routes: list': 'Rutas: lista',
  'Dots: breathing': 'Puntos: respiran',
  'Dots: soft halo': 'Puntos: halo suave',
  'Dots: plain': 'Puntos: lisos',
  'A route': 'Una ruta',
  'Another route': 'Otra ruta',
};

// El exchange PRODUCTIZADO: la cuenta del cliente (ExchangeClientApp) y
// la consola del exchange (ExchangeConsole). Bloque propio y extendido PRIMERO:
// si una clave ya existía arriba, manda la de arriba (ni duplicados ni cambios
// de copy ya publicada). Consola dice «pote»; cliente dice «vault».
const EXCHANGE_PRODUCT: Record<string, string> = {
  'Sign in to your exchange account': 'Entra en tu cuenta del exchange',
  'Your passkey is the key: it opens your account and confirms every movement inside it — the vault and your withdrawals. It lives on your device; nobody else holds it, not the exchange and not Astryum.': 'Tu passkey es la llave: abre tu cuenta y confirma cada movimiento dentro de ella — el vault y tus retiradas. Vive en tu dispositivo; no la tiene nadie más, ni el exchange ni Astryum.',
  'Sign in with passkey': 'Entrar con passkey',
  'You deposit with your tag, like at any exchange.': 'Depositas con tu tag, como en cualquier exchange.',
  'What works is in your name': 'Lo que trabaja, a tu nombre',
  'Your shares live in an account only your passkey opens.': 'Tus participaciones viven en una cuenta que solo abre tu passkey.',
  'Taking it out of the vault is yours': 'Sacar del vault es cosa tuya',
  'One passkey confirmation. It never depends on the exchange or on your KYC.': 'Una confirmación con tu passkey. Nunca depende del exchange ni de tu KYC.',
  'KYC could not be read': 'No se pudo leer el KYC',
  'Reading KYC…': 'Leyendo el KYC…',
  'KYC verified': 'KYC verificado',
  'KYC pending at the exchange': 'KYC pendiente en el exchange',
  'Hello, {name}': 'Hola, {name}',
  'Your XRP at the exchange and what works in the vault, in your name.': 'Tu XRP en el exchange y lo que trabaja en el vault, a tu nombre.',
  'Passkey · this device': 'Passkey · este dispositivo',
  'your tag': 'tu tag',
  'The exchange assigns your deposit tag — your slot in its account. From then on this page is your account there.': 'El exchange te asigna tu tag de depósito — tu casilla en su cuenta. Desde entonces esta página es tu cuenta allí.',
  'Your name': 'Tu nombre',
  'e.g. Lucía Ferrer': 'p. ej. Lucía Ferrer',
  'Before any money comes in, the exchange registers your KYC on the XRP Ledger. You sign nothing for it.': 'Antes de que entre dinero, el exchange registra tu KYC en el XRP Ledger. Tú no firmas nada para eso.',
  'The exchange opened this account with your passkey, but it is not yours yet. Enter the claim code the exchange gave you — until then nothing here can be changed.': 'El exchange abrió esta cuenta con tu passkey, pero aún no es tuya. Escribe el código que te dio el exchange — hasta entonces aquí no se puede cambiar nada.',
  'Claim code from the exchange (XXXX-XXXX-…)': 'Código del exchange (XXXX-XXXX-…)',
  'On its way': 'En camino',
  'Sending': 'Enviando',
  'Refused': 'Rechazado',
  'Queued': 'En cola',
  'Into the vault': 'Meter en el vault',
  'Withdrawal to your wallet': 'Retirada a tu wallet',
  'on the XRP Ledger': 'en el XRP Ledger',
  'the exchange executes it from its account': 'el exchange lo ejecuta desde su cuenta',
  'the exchange pays it from its account': 'el exchange lo paga desde su cuenta',
  'Back from the vault': 'Vuelta del vault',
  'Credited': 'Abonado',
  'Seen on the ledger': 'Visto en el ledger',
  'Out of the vault': 'Salida del vault',
  'Signed with your passkey': 'Firmado con tu passkey',
  'Nothing yet — your first deposit appears here on its own.': 'Nada todavía — tu primer depósito aparece aquí solo.',
  'XRP at the exchange + FXRP in the vault. FXRP is minted and redeemed 1:1 against XRP, minus fees.': 'XRP en el exchange + FXRP en el vault. El FXRP se acuña y se rescata 1:1 contra XRP, menos comisiones.',
  'tag {tag} · held by {exchange}': 'tag {tag} · custodiado por {exchange}',
  'shares · in your account': 'participaciones · en tu cuenta',
  'could not be read just now': 'no se pudo leer ahora mismo',
  'reading…': 'leyendo…',
  'no vault yet': 'aún no hay vault',
  'on the way': 'en camino',
  'Free in your account': 'Libre en tu cuenta',
  'what you took out of the vault and kept': 'lo que sacaste del vault y te quedaste',
  'registered by {exchange} on the XRP Ledger': 'registrado por {exchange} en el XRP Ledger',
  'The exchange registers it from its side; you sign nothing. Money comes in once it is done — taking money out never needs it.': 'El exchange lo registra desde su lado; tú no firmas nada. El dinero entra cuando está hecho — sacar dinero nunca lo necesita.',
  'See it in your profile': 'Verlo en tu perfil',
  'The vault': 'El vault',
  'Go to the vault': 'Ir al vault',
  'The vault could not be read just now.': 'El vault no se pudo leer ahora mismo.',
  'The exchange has not opened its vault yet.': 'El exchange aún no ha abierto su vault.',
  '{h} h window': 'ventana de {h} h',
  'Immediate': 'Inmediata',
  'Send XRP to the exchange account with your tag. It is credited to you as soon as the ledger validates it.': 'Envía XRP a la cuenta del exchange con tu tag. Se te abona en cuanto el ledger lo valida.',
  'How much': 'Cuánto',
  'Prepare the deposit': 'Preparar el depósito',
  'Address of {exchange}': 'Dirección de {exchange}',
  'Destination tag · yours': 'Tag de destino · el tuyo',
  'Always include tag {tag}. Without it the exchange cannot tell the deposit is yours.': 'Incluye siempre el tag {tag}. Sin él, el exchange no puede saber que el depósito es tuyo.',
  'Sign with my connected Xaman': 'Firmar con mi Xaman conectado',
  'Change the amount': 'Cambiar el importe',
  'The deposit is signed by the wallet where your XRP is. A passkey does not sign on the XRP Ledger: you use it for what happens inside your account — the vault and your withdrawals.': 'El depósito lo firma la wallet donde está tu XRP. Una passkey no firma en el XRP Ledger: la usas para lo que pasa dentro de tu cuenta — el vault y tus retiradas.',
  'Your deposits': 'Tus depósitos',
  'No deposits seen yet. They show up here on their own.': 'Aún no se ve ningún depósito. Aparecen aquí solos.',
  'Put XRP into the vault': 'Meter XRP en el vault',
  'From your balance at the exchange. The shares arrive in your account, in your name.': 'Desde tu saldo en el exchange. Las participaciones llegan a tu cuenta, a tu nombre.',
  'In the name of': 'A nombre de',
  'your account': 'tu cuenta',
  'Who executes it': 'Quién lo ejecuta',
  'from its account': 'desde su cuenta',
  'The FAssets minting fee is charged by the protocol when your XRP becomes FXRP. The exact figure is on your receipt.': 'La comisión de acuñación de FAssets la cobra el protocolo cuando tu XRP pasa a FXRP. La cifra exacta sale en tu recibo.',
  'Put it into the vault': 'Meterlo en el vault',
  'Put every deposit into the vault': 'Meter cada depósito en el vault',
  'Each credited deposit goes in automatically, with the same fees. You can switch it off at any time.': 'Cada depósito abonado entra solo, con las mismas comisiones. Puedes apagarlo cuando quieras.',
  'Your last entry': 'Tu última entrada',
  'Requested': 'Pedido',
  'Paid by the exchange on the XRP Ledger': 'Pagado por el exchange en el XRP Ledger',
  'Shares in your account': 'Participaciones en tu cuenta',
  'minting FXRP — usually a few minutes': 'acuñando FXRP — suele tardar unos minutos',
  'Always liquid': 'Siempre líquido',
  'Cap per venue': 'Tope por venue',
  'The exchange can only move your capital between the venues this vault allows. It cannot take it out: only your passkey redeems your shares.': 'El exchange solo puede mover tu capital entre los venues que este vault permite. No puede sacarlo: solo tu passkey rescata tus participaciones.',
  'as XRP to': 'como XRP a',
  'as XRP into your slot, tag {tag}': 'como XRP a tu casilla, tag {tag}',
  'as FXRP, claimable when the window ends': 'como FXRP, reclamable cuando acabe la ventana',
  'as FXRP in your passkey account': 'como FXRP en tu cuenta de passkey',
  'Take it out of the vault': 'Sacar del vault',
  'Before your passkey — what this signature does': 'Antes de tu passkey — qué hace esta firma',
  'The destination you picked is not used by this pote: with an exit window the exit is a ticket for your Face ID account, not a transfer to the XRP Ledger.': 'Este pote no usa el destino que elegiste: con ventana de salida, la salida es un ticket para tu cuenta Face ID, no una transferencia al XRP Ledger.',
  'Astryum service fee: {pct}% of your shares ({shares} base shares), deducted in this same signature.': 'Comisión de servicio de Astryum: {pct}% de tus participaciones ({shares} participaciones base), descontada en esta misma firma.',
  'Astryum service fee: none composed in this exit.': 'Comisión de servicio de Astryum: ninguna en esta salida.',
  'Astryum service fee: the server did not return the figure — unavailable here, not zero.': 'Comisión de servicio de Astryum: el servidor no devolvió la cifra — no disponible aquí, no es cero.',
  'Confirm with passkey': 'Confirmar con passkey',
  'Leave it empty to take everything out.': 'Déjalo vacío para sacarlo todo.',
  'Where to': 'A dónde',
  'Review the exit': 'Revisar la salida',
  'Your position could not be read just now. The button stays: it reads again when you press it, and the vault only redeems the shares you hold.': 'Tu posición no se pudo leer ahora mismo. El botón sigue: vuelve a leerla al pulsarlo, y el vault solo rescata las participaciones que tienes.',
  'Taking money out of the vault never depends on the exchange or on your KYC: your passkey signs and the contract executes.': 'Sacar dinero del vault nunca depende del exchange ni de tu KYC: tu passkey firma y el contrato ejecuta.',
  'Withdraw XRP from the exchange': 'Retirar XRP del exchange',
  'Who pays it': 'Quién lo paga',
  'Withdraw to my wallet': 'Retirar a mi wallet',
  'Last withdrawal': 'Última retirada',
  'To withdraw to self-custody, first set your withdrawal wallet below.': 'Para retirar a autocustodia, primero fija abajo tu wallet de retiradas.',
  'Withdrawing never depends on your KYC.': 'Retirar nunca depende de tu KYC.',
  'Client of {exchange} since {date}': 'Cliente de {exchange} desde {date}',
  'Your tag': 'Tu tag',
  'Account of your shares': 'Cuenta de tus participaciones',
  'on Flare · only your passkey opens it': 'en Flare · solo la abre tu passkey',
  'Withdrawal wallet': 'Wallet de retiradas',
  'proven yours': 'probada como tuya',
  'not set yet': 'aún sin fijar',
  'Passkey': 'Passkey',
  'this device': 'este dispositivo',
  'To my XRPL wallet': 'A mi wallet XRPL',
  'To my account at the exchange': 'A mi cuenta en el exchange',
  'Keep it in my account': 'Dejarlo en mi cuenta',
  'Enter the claim code the exchange gave you': 'Escribe el código que te dio el exchange',
  'This exchange account is yours now.': 'Esta cuenta del exchange ya es tuya.',
  'Request sent. The exchange executes it from its omnibus in a few seconds; your shares appear here when the mint lands (~2–5 min).': 'Petición enviada. El exchange la ejecuta desde su ómnibus en unos segundos; tus participaciones aparecen aquí cuando llega la acuñación (~2–5 min).',
  'Could not read your position in the pote right now — nothing was signed. Try again in a moment.': 'No se pudo leer tu posición en el pote ahora mismo — no se firmó nada. Prueba de nuevo en un momento.',
  'Cooldown pote: shares burned now, the amount is fixed in FXRP; claimable at maturity into my Face ID account.': 'Pote con ventana: participaciones quemadas ahora, importe fijado en FXRP; reclamable al vencimiento en mi cuenta Face ID.',
  'Withdrawal requested. The exchange pays it out to your wallet in a few seconds.': 'Retirada pedida. El exchange te la paga en tu wallet en unos segundos.',
  'Opening your exchange…': 'Abriendo tu exchange…',
  'Two new accounts, the licence, the constitution, the cage, the pote and the desk — become a tenant of the rail.': 'Dos cuentas nuevas, la licencia, la constitución, la jaula, el pote y la mesa — hazte inquilino del raíl.',
  '~40 min · Xaman': '~40 min · Xaman',
  'The XRPL wallet connected here is not the root of this exchange. You can read everything; to sign its orders in Xaman, connect {root}.': 'La wallet XRPL conectada aquí no es la raíz de este exchange. Puedes leerlo todo; para firmar sus órdenes en Xaman, conecta {root}.',
  'A signature of the exchange is waiting in Xaman — the other tabs come back once it settles or is refused.': 'Hay una firma del exchange esperando en Xaman — las demás pestañas vuelven cuando se liquide o se rechace.',
  'Your exchanges': 'Tus exchanges',
  'New exchange': 'Nuevo exchange',
  'Your connected wallet governs this exchange': 'Tu wallet conectada gobierna este exchange',
  'Exchange · operator console': 'Exchange · consola del operador',
  'Your clients, their KYC, the omnibus and your potes. The autopilot executes what your clients ask; you approve KYC and direct the capital.': 'Tus clientes, su KYC, el ómnibus y tus potes. El autopilot ejecuta lo que piden tus clientes; tú apruebas el KYC y diriges el capital.',
  'Autopilot on': 'Autopilot activo',
  'Autopilot not running': 'Autopilot parado',
  'Reading autopilot…': 'Leyendo el autopilot…',
  'root': 'raíz',
  'last cycle': 'último ciclo',
  'every {s} s': 'cada {s} s',
  'XRP of your clients': 'XRP de tus clientes',
  'credited to their tags at the exchange': 'abonado en sus tags del exchange',
  '{n} waiting for your KYC': '{n} esperan tu KYC',
  'all with KYC in force': 'todos con KYC vigente',
  '{n} venues allowed': '{n} venues permitidos',
  'Autopilot today': 'Autopilot hoy',
  'cap {n} XRP per payment': 'tope de {n} XRP por pago',
  'Omnibus, live': 'Ómnibus en vivo',
  'See all': 'Ver todo',
  'Waiting for you': 'Pendiente de ti',
  'Nothing pending. New clients appear here as soon as they sign up.': 'Nada pendiente. Los clientes nuevos aparecen aquí en cuanto se dan de alta.',
  'The KYC gate is off on this environment.': 'La puerta de KYC está apagada en este entorno.',
  'Approve KYC': 'Aprobar KYC',
  'Autopilot': 'Autopilot',
  'always on': 'siempre activo',
  'Omnibus key': 'Llave del ómnibus',
  'opens this omnibus': 'abre este ómnibus',
  'another omnibus': 'otro ómnibus',
  'Cycle': 'Ciclo',
  'Caps': 'Topes',
  'The autopilot is paused for this exchange: client requests wait until it runs.': 'El autopilot está en pausa para este exchange: las peticiones de los clientes esperan hasta que arranque.',
  'Turn the autopilot on': 'Encender el autopilot',
  'It executes what your clients ask, within its caps. It never moves anyone’s money on its own initiative.': 'Ejecuta lo que piden tus clientes, dentro de sus topes. Nunca mueve el dinero de nadie por iniciativa propia.',
  'Control the pote': 'Controlar el pote',
  'The pote is empty: capital arrives when a client puts XRP into it.': 'El pote está vacío: el capital llega cuando un cliente mete XRP.',
  'liquid floor': 'suelo líquido',
  'Buffer': 'Colchón',
  'floor': 'suelo',
  'Return': 'Vuelta',
  'FAssets redemption back to the client tag': 'Rescate de FAssets de vuelta al tag del cliente',
  'Seen': 'Visto',
  'Withdrawal': 'Retirada',
  'to the client wallet': 'a la wallet del cliente',
  'Paid': 'Pagado',
  'Mint FXRP into the pote for the client': 'Acuñar FXRP en el pote para el cliente',
  'Instruction to Flare (not linked to a client)': 'Instrucción a Flare (sin cliente asociado)',
  'On its way to the pote': 'En camino al pote',
  'Unlinked': 'Sin asociar',
  'no tag': 'sin tag',
  'Tag without an account': 'Tag sin cuenta',
  'No tag': 'Sin tag',
  'Reading the omnibus…': 'Leyendo el ómnibus…',
  'The omnibus could not be read just now — this says nothing about the money in it. It retries on its own.': 'El ómnibus no se pudo leer ahora mismo — eso no dice nada del dinero que tiene. Lo reintenta solo.',
  'No movements on the omnibus yet.': 'Aún no hay movimientos en el ómnibus.',
  'Time': 'Hora',
  'Detail': 'Detalle',
  'Omnibus account': 'Cuenta ómnibus',
  'Today in': 'Hoy entra',
  'Today out': 'Hoy sale',
  'Live · every {s} s': 'En vivo · cada {s} s',
  'read at': 'leído a las',
  'In': 'Entradas',
  'To resolve': 'Por resolver',
  'Read now': 'Leer ahora',
  'A payment without a tag, or with a tag no account has, is not credited to anyone. The autopilot never pays it back on its own: it only pays registered client wallets.': 'Un pago sin tag, o con un tag que no tiene ninguna cuenta, no se abona a nadie. El autopilot nunca lo devuelve solo: únicamente paga a wallets registradas de clientes.',
  'KYC pending': 'KYC pendiente',
  'Read KYC again': 'Releer el KYC',
  'At the exchange': 'En el exchange',
  'no passkey yet': 'aún sin passkey',
  'Issued, not accepted': 'Emitida, sin aceptar',
  'Pick a client to see their account and approve their KYC.': 'Elige un cliente para ver su cuenta y aprobar su KYC.',
  'passkey account': 'cuenta de passkey',
  'Credential': 'Credencial',
  'Issued by': 'Emite',
  'your root': 'tu raíz',
  'Held by': 'La guarda',
  'your omnibus': 'tu ómnibus',
  'You confirm that your exchange completed the KYC of this person with its own processes. It is recorded on the XRP Ledger, public and dated.': 'Confirmas que tu exchange completó el KYC de esta persona con sus propios procesos. Queda registrado en el XRP Ledger, público y con fecha.',
  'Approve KYC in Xaman': 'Aprobar el KYC en Xaman',
  'The root issues it and the omnibus accepts it — both are your accounts; the client signs nothing. It is the record of your process, not a portable credential of the client. Withdrawals never depend on it.': 'La emite la raíz y la acepta el ómnibus — las dos son cuentas tuyas; el cliente no firma nada. Es el registro de tu proceso, no una credencial portable del cliente. Las retiradas nunca dependen de ella.',
  'KYC in force: this client can deposit and enter the pote.': 'KYC vigente: este cliente puede depositar y entrar en el pote.',
  'Reading your potes…': 'Leyendo tus potes…',
  'No pote open yet.': 'Aún no hay ningún pote abierto.',
  'Some potes could not be read just now — the list may be incomplete.': 'Algunos potes no se pudieron leer ahora mismo — la lista puede estar incompleta.',
  'A pote is opened by the root of the exchange in Xaman. Connect {root} to sign it.': 'Un pote lo abre la raíz del exchange en Xaman. Conecta {root} para firmarlo.',
  'Client entries go to another pote. This one is directed here, but clients do not enter it.': 'Las entradas de los clientes van a otro pote. Este se dirige desde aquí, pero los clientes no entran en él.',
  'Use it for client entries': 'Usarlo para las entradas de clientes',
  'What your clients see': 'Lo que ven tus clientes',
  'Structure on the ledger': 'Estructura en el ledger',
  'Root · governance': 'Raíz · gobierno',
  'issues credentials, opens potes, signs orders · Xaman': 'emite credenciales, abre potes, firma órdenes · Xaman',
  'Omnibus · client account': 'Ómnibus · cuenta de clientes',
  'receives by tag · its key is used by the autopilot': 'recibe por tag · su llave la usa el autopilot',
  'Clients pote': 'Pote de clientes',
  'ERC-4626 on Flare': 'ERC-4626 en Flare',
  'Omnibus appointment': 'Nombramiento del ómnibus',
  'the root names its omnibus (XLS-70 OMNIBUS)': 'la raíz nombra a su ómnibus (XLS-70 OMNIBUS)',
  'on the ledger': 'en el ledger',
  'not found': 'no encontrado',
  '{n} with KYC in force': '{n} con KYC vigente',
  'Back to the new account view': 'Volver a la cuenta nueva',
  'Previous version of this page': 'Versión anterior de esta página',
  'Operator console': 'Consola del operador',
  'Back to the console': 'Volver a la consola',
  'Station desk (setup, tour, v1)': 'Mesa por estaciones (alta, tour, v1)',

  // ── La portada del exchange: dos puertas, y dentro sus dos patas ──
  Create: 'Crear',
  'What do you want to do?': '¿Qué quieres hacer?',
  'Two doors, and behind each one the same two sides: the exchange that operates, and the client who uses it.':
    'Dos puertas, y detrás de cada una los mismos dos lados: el exchange que opera y el cliente que lo usa.',
  // Qué es esto — y qué no es: Astryum no es un exchange; es la estructura de uno
  'What this is — and what it is not': 'Qué es esto — y qué no es',
  'Astryum is not an exchange.': 'Astryum no es un exchange.',
  'It is the structure of one, built on the network, so that a company holding the credential to serve clients can create its own exchange here and operate it with them.':
    'Es la estructura de uno, construida sobre la red, para que una empresa con la credencial para atender clientes cree aquí su propio exchange y lo opere con ellos.',
  'What the company creates': 'Lo que la empresa crea',
  'A root of authority on XRPL, an omnibus it names and controls with its own keys, a register of the clients it approves, and the potes on Flare where their capital works.':
    'Una raíz de autoridad en XRPL, un ómnibus que ella nombra y controla con sus propias llaves, un registro de los clientes que aprueba y los potes en Flare donde trabaja su capital.',
  'What the company brings': 'Lo que la empresa pone',
  "Its own authorisation to serve clients, its own keys, its own books and its own clients. Its credential is an object on the ledger, on the root account of the exchange, that anyone can verify; approving a client is the exchange's decision, never Astryum's.":
    'Su propia autorización para atender clientes, sus llaves, sus libros y sus clientes. Su credencial es un objeto en el ledger, en la cuenta raíz del exchange, que cualquiera puede verificar; aprobar a un cliente lo decide el exchange, nunca Astryum.',
  'What Astryum does — and never does': 'Lo que Astryum hace — y lo que nunca hace',
  "Astryum builds the structure and prepares every action for the operator to sign. It never signs, never holds anyone's funds and never approves a client.":
    'Astryum construye la estructura y prepara cada acción para que la firme el operador. Nunca firma, nunca guarda fondos de nadie y nunca aprueba a un cliente.',
  "It runs on mainnet today: every deposit, every order and every exit leaves a receipt you can verify on-chain, and a client's way out of the vault is signed with the client's own passkey, not with the exchange's key.":
    'Funciona hoy en mainnet: cada depósito, cada orden y cada salida deja un recibo verificable en cadena, y la salida del cliente del vault se firma con la passkey del propio cliente, no con la llave del exchange.',
  'Already there': 'Ya estás dentro',
  'From scratch': 'Desde cero',
  'Go into an exchange you already operate, or into the client account your passkey opens.':
    'Entra en un exchange que ya operas, o en la cuenta de cliente que abre tu passkey.',
  'Bring a new exchange into being, or open your own client account at one of them.':
    'Haz nacer un exchange nuevo, o abre tu propia cuenta de cliente en uno de ellos.',
  'Enter the exchange': 'Entrar al exchange',
  'The desk that operates it: clients, omnibus, potes, profile and audit.':
    'La mesa que lo opera: clientes, ómnibus, potes, perfil y auditoría.',
  'Enter as a client': 'Entrar como cliente',
  'Your account at the exchange: deposit, vault, withdraw. Your passkey opens it.':
    'Tu cuenta en el exchange: depositar, vault, retirar. La abre tu passkey.',
  'Create an exchange': 'Crear un exchange',
  'The full setup, station by station — and then the rehearsal, before any real client.':
    'El alta completa, estación por estación — y después el ensayo, antes de ningún cliente de verdad.',
  'Create a client account': 'Crear una cuenta de cliente',
  'Your own account at an exchange that is taking clients. Your passkey is the key.':
    'Tu propia cuenta en un exchange que admite clientes. Tu passkey es la llave.',
  'Exchange home': 'Portada del exchange',
  'This key does not have an account at any exchange yet': 'Esta llave aún no tiene cuenta en ningún exchange',
  'Nothing is missing and nothing was lost: no account has been opened with this passkey. Opening one takes a name and a moment.':
    'No falta nada ni se ha perdido nada: con esta passkey no se ha abierto ninguna cuenta todavía. Abrir una es un nombre y un momento.',

  // ── El ensayo guiado, recién nacido el exchange ──
  'Your exchange is born': 'Tu exchange ha nacido',
  'Rehearse it before you operate it': 'Ensáyalo antes de operarlo',
  'Walk the whole circuit here first — the setup stations, a deposit, the vault and an exit — with the guided tour beside you. It is the same desk you will operate with, so what works here works there.':
    'Recorre aquí el circuito entero — las estaciones del alta, un depósito, el vault y una salida — con el tour guiado al lado. Es la misma mesa con la que vas a operar, así que lo que funcione aquí funciona allí.',
  'Start the rehearsal': 'Empezar el ensayo',
  'Skip for now': 'Saltar por ahora',
  'Skipping is not losing it: the button above brings the station desk back any time.':
    'Saltarlo no es perderlo: el botón de arriba vuelve a traer la mesa por estaciones cuando quieras.',
  // KYC con UNA firma: la raíz emite, el autopilot acepta desde el ómnibus.
  'Approve KYC · one root signature in Xaman': 'Aprobar KYC · una firma de la raíz en Xaman',
  'KYC {type} · {name}': 'KYC {type} · {name}',
  'Issued by your root. The autopilot accepts it from the omnibus in a few seconds — this panel updates on its own.': 'Emitida por tu raíz. El autopilot la acepta desde el ómnibus en unos segundos — este panel se actualiza solo.',
  'The root issues it (one signature, yours) and the autopilot accepts it from the omnibus — the client signs nothing. It is the record of your process, not a portable credential of the client. Withdrawals never depend on it.': 'La emite la raíz (una firma, la tuya) y el autopilot la acepta desde el ómnibus — el cliente no firma nada. Es el registro de tu proceso, no una credencial portable del cliente. Las retiradas nunca dependen de ella.',
  'Two-signature ceremony (when the autopilot is not running)': 'Ceremonia de dos firmas (cuando el autopilot no está en marcha)',
  'Issued — the autopilot accepts it from the omnibus on its next cycle. If the autopilot is not running, finish with the two-signature ceremony.': 'Emitida — el autopilot la acepta desde el ómnibus en su próximo ciclo. Si el autopilot no está en marcha, termina con la ceremonia de dos firmas.',

  // La nota de un pago XRP nativo (Wallets → Movimientos → Enviar).
  'Memo': 'Memo',
  'Only digits — e.g. 101': 'Solo cifras — p. ej. 101',
  'That tag is too large for XRPL (the maximum is 4294967295).':
    'Ese tag es demasiado grande para XRPL (el máximo es 4294967295).',
  'Exchanges credit the deposit by this number. If they gave you one, sending without it loses the payment inside their account.':
    'Los exchanges acreditan el depósito por este número. Si te dieron uno, enviar sin él pierde el pago dentro de su cuenta.',
  'A reference for the recipient': 'Una referencia para quien lo recibe',
  'Max': 'Máx.',
  'not connected here': 'sin sesión aquí',
  'The exchange has not opened its vault yet, so there is nothing to take out.':
    'El exchange todavía no ha abierto su bóveda, así que no hay nada que sacar.',
  'You hold no shares of this vault yet. Put XRP to work first and your shares will show up here.':
    'Todavía no tienes participaciones de esta bóveda. Pon XRP a trabajar y aparecerán aquí.',
  'Write a number with up to 6 decimals, or leave it empty to take everything out.':
    'Escribe un número con hasta 6 decimales, o déjalo vacío para sacarlo todo.',
  'Everything you hold in the vault leaves — the contract redeems your shares, so no dust is left behind.':
    'Sale todo lo que tienes en la bóveda — el contrato redime tus participaciones, así que no queda ningún resto.',
  'The root {root} is connected, but another account is the active one — and the active account is who signs.':
    'La raíz {root} está conectada, pero la activa es otra cuenta — y quien firma es la activa.',
  'Sign with the root': 'Firmar con la raíz',
  'The XRP is paid by a FAssets agent, so the tag is the only thing that can travel inside that payment — a free-text memo is not possible on a redemption.':
    'El XRP lo paga un agente de FAssets, así que el tag es lo único que puede viajar dentro de ese pago — en una redención no cabe un memo de texto libre.',
  'Turn the FXRP in your Astryum account back into native XRP, paid by a FAssets agent to the XRPL address you choose.':
    'Convierte el FXRP de tu cuenta Astryum en XRP nativo, que paga un agente de FAssets a la dirección XRPL que elijas.',
  'Free text that travels with the payment and stays public on the ledger forever. Never write anything private here.':
    'Texto libre que viaja con el pago y queda público en el ledger para siempre. No escribas aquí nada privado.',

  // Exchange 2.0: las ESTRUCTURAS cautivas que nacen bajo un tenant —
  // una familia o una sociedad con su propia cuenta XRPL, gobernada por quorum y
  // sin llave de nadie cuando se cierra la puerta.
  'A family or a company that lives inside this exchange gets its own XRPL account, governed by a quorum. Once its door is closed, nobody holds a key to it — not its holder, not this exchange, not Astryum. Only the quorum acts.':
    'Una familia o una sociedad que vive dentro de este exchange tiene su propia cuenta XRPL, gobernada por un quórum. Una vez cerrada su puerta, nadie tiene una llave de ella — ni su titular, ni este exchange, ni Astryum. Solo actúa el quórum.',
  'New structure': 'Nueva estructura',
  'No structures yet': 'Todavía no hay estructuras',
  'A deposit box is a destination tag and needs none of this. A structure is for a client that is a legal vehicle: a family with a council, a company with a board.':
    'Una casilla es un destination tag y no necesita nada de esto. Una estructura es para un cliente que es un vehículo legal: una familia con consejo, una sociedad con órgano.',
  'Reading the ledger…': 'Leyendo el ledger…',
  'The account is created by its holder, in their own wallet app — Astryum never generates a key. Paste its address here; the reserve is sponsored by the omnibus and charged afterwards.':
    'La cuenta la crea su titular, en su propia app de wallet — Astryum no genera ninguna llave. Pega aquí su dirección; la reserva la patrocina el omnibus y se cobra después.',
  'XRPL address of the new account': 'Dirección XRPL de la cuenta nueva',
  'What the holder calls it — never personal data': 'Como lo llame su titular — jamás datos personales',
  'Whose patrimony it holds': 'De quién es el patrimonio',
  'Quorum (weight that must sign)': 'Quórum (peso que tiene que firmar)',
  'Designation by the root': 'Designación de la raíz',
  'The exchange names it as its own, for 90 days': 'El exchange la nombra suya, durante 90 días',
  'Family / Legacy': 'Familia / Legacy',
  'Company': 'Sociedad',
  'Deposit box': 'Casilla',
  'Hosted — the holder governs it': 'Alojada — la gobierna su titular',
  'Custody — the exchange governs it': 'Custodia — la gobierna el exchange',
  'Seats': 'Asientos',
  'Whose hand holds each seat is the whole custody question: if the exchange reaches the quorum on its own, it can move this money without its holder.':
    'De quién es cada asiento es toda la cuestión de la custodia: si el exchange alcanza el quórum por sí solo, puede mover este dinero sin su titular.',
  'Add a seat': 'Añadir un asiento',
  'the holder': 'el titular',
  'the exchange': 'el exchange',
  'Check it': 'Compruébalo',
  'Declare the structure': 'Declarar la estructura',
  'This cannot be declared as it stands': 'Así no se puede declarar',
  'The omnibus sponsors {amount} XRP; {back} XRP come back if the structure is ever wound up.':
    'El omnibus patrocina {amount} XRP; {back} XRP vuelven si algún día se deshace la estructura.',
  'Quorum margin: {margin} — seats that can be lost before this structure freezes for good.':
    'Margen de quórum: {margin} — asientos que se pueden perder antes de que esta estructura se congele para siempre.',
  'Sponsor the reserve': 'Patrocinar la reserva',
  'Seat the signers': 'Sentar a los firmantes',
  'Rehearse on-chain': 'Ensayar en cadena',
  'Name it on the ledger': 'Nombrarla en el ledger',
  'Close the door': 'Cerrar la puerta',
  'the omnibus signs': 'firma el omnibus',
  'the birth key signs': 'firma la llave de nacimiento',
  'the quorum of the structure signs': 'firma el quórum de la estructura',
  'the quorum of the root signs': 'firma el quórum de la raíz',
  'quorum {q} of {w}': 'quórum {q} de {w}',
  'no key — only its quorum': 'sin llave — solo su quórum',
  'signer list on the ledger ✓': 'lista de firmantes en el ledger ✓',
  'no signer list yet': 'todavía sin lista de firmantes',
  'the ledger could not be read': 'no se pudo leer el ledger',
  '{done} of {total} steps': '{done} de {total} pasos',
  'Prepare: {step}': 'Preparar: {step}',
  'This one cannot be undone.': 'Este paso no se deshace.',
  'The ceremony is complete. This account has no key: only its quorum can act, and anyone can check it on the ledger.':
    'La ceremonia está completa. Esta cuenta no tiene llave: solo puede actuar su quórum, y cualquiera puede comprobarlo en el ledger.',
  'Signs: {account}': 'Firma: {account}',
  // Exchange 2.0 (encuadre corregido del fundador): la autoridad es del
  // USUARIO — su cuenta personal se sienta en las demas y las comanda.
  'One person, several XRPL accounts: the personal one sits in the signer list of the others and commands them — alone, or as one of a quorum. Once an account closes its door, nobody holds a key to it at all: only whoever is seated can move it.':
    'Una persona, varias cuentas XRPL: la personal se sienta en la lista de firmantes de las demas y las comanda — sola, o como una de varias. Cuando una cuenta cierra su puerta, ya no hay llave de ella en ninguna parte: solo puede moverla quien esta sentado.',
  'No commanded accounts yet': 'Todavia no hay cuentas comandadas',
  'A deposit box is a destination tag and needs none of this. A commanded account is for what is a vehicle: the family, the company.':
    'Una casilla es un destination tag y no necesita nada de esto. Una cuenta comandada es para lo que es un vehiculo: la familia, la sociedad.',
  'The account is created by its holder, in their own wallet app — Astryum never generates a key. Paste its address here; the reserve is sponsored and charged afterwards.':
    'La cuenta la crea su titular, en su propia app de wallet — Astryum no genera ninguna llave. Pega aqui su direccion; la reserva se patrocina y se cobra despues.',
  'The personal account that commands it': 'La cuenta personal que la comanda',
  'How it is commanded': 'Como se comanda',
  'My personal account commands it alone': 'Mi cuenta personal la manda sola',
  'A quorum commands it, and my personal account is one of them': 'La manda un quorum, y mi cuenta personal es una de ellos',
  'Designation by the personal account': 'Designacion de la cuenta personal',
  'My personal account names it as mine, for 90 days': 'Mi cuenta personal la nombra mia, durante 90 dias',
  'Will it pay by itself through a credential gate?': 'Pagara ella misma a traves de una puerta de credencial?',
  'It sends its own payments to a gated destination': 'Manda sus propios pagos a un destino con puerta',
  'Whose seat each one is decides who can move this money. A third party that reaches the quorum on its own can move it without you. And with a single seat the door can never be closed: losing that one key would leave the account dead with its money inside.':
    'De quien es cada asiento decide quien puede mover este dinero. Un tercero que alcance el quorum por si solo puede moverlo sin ti. Y con un unico asiento la puerta no se puede cerrar nunca: perder esa llave dejaria la cuenta muerta con su dinero dentro.',
  'my personal account': 'mi cuenta personal',
  'someone in my circle': 'alguien de mi circulo',
  'a third party': 'un tercero',
  'Declare this account': 'Declarar esta cuenta',
  'Commanded by {root}': 'La comanda {root}',
  'the funding account signs': 'firma la cuenta que patrocina',
  'the personal account signs': 'firma la cuenta personal',
  'the seats of this account sign': 'firman los asientos de esta cuenta',
  'Before you sign, what is true here': 'Antes de firmar, lo que aqui es verdad',
};

// ── Copy que la ventana escribió sin su entrada en castellano (release) ──
// `npm run check:i18n` bloquea el CI de `main` y la rama build/ventana-21sep nunca
// lo vio correr: al medirlo sobre el candidato del release salieron 157 cadenas en
// inglés. Casi todas son de las que más importa que se entiendan — rechazos del
// servidor, lecturas ilegibles y «NO vuelvas a firmar». Viven en su propio bloque,
// al final, para no cruzarse con las ediciones en curso de ES y PAGES. Se pueden
// repartir por sus secciones cuando convenga: el comprobador lee el fichero entero.
const RELEASE_COPY: Record<string, string> = {
  'This desk is open to the founders only for now.': 'Esta mesa está abierta solo a los fundadores por ahora.',
  '(its title is not shown to you)': '(su título no se te muestra)',
  '(on this screen)': '(en esta pantalla)',
  'A previous signature could not be confirmed, so direct and recall are paused on this screen. Check the pote and the explorer first — reload the page to use them again.':
    'Una firma anterior no se pudo confirmar, así que dirigir y retirar están en pausa en esta pantalla. Comprueba primero el pote y el explorador — recarga la página para volver a usarlos.',
  'A previous signature could not be confirmed, so moving capital is paused on this screen. Check the vault above and the explorer first — reload the page to move capital again.':
    'Una firma anterior no se pudo confirmar, así que mover capital está en pausa en esta pantalla. Comprueba primero el vault de arriba y el explorador — recarga la página para volver a mover capital.',
  'A signature of the exchange is in flight at the desk — the other tabs come back once the ledger settles or refuses it.':
    'Hay una firma del exchange en vuelo en la mesa — las demás pestañas vuelven cuando el ledger la liquide o la rechace.',
  'A signature of this step is in flight or unconfirmed — Back returns once the ledger settles it or refuses it.':
    'Hay una firma de este paso en vuelo o sin confirmar — «Atrás» vuelve cuando el ledger la liquide o la rechace.',
  'A spent order is on hold above: new orders wait until you confirm you checked it. Recall to buffer does not wait — an exit is never held back.':
    'Hay una orden gastada en espera arriba: las órdenes nuevas esperan hasta que confirmes que la has revisado. Retirar al colchón no espera — una salida nunca se retiene.',
  'Accredited issuer': 'Emisor acreditado',
  'Another payload of this account is collecting signatures': 'Otro payload de esta cuenta está recogiendo firmas',
  'Another payload of this account is holding the same Sequence': 'Otro payload de esta cuenta retiene el mismo Sequence',
  "Ask the server to free this payout? It frees the seat only once its window (XRPL ledger {lls}) has passed and the omnibus history proves the payment never landed. Until then nothing is freed and your client's XRP stays reserved.":
    '¿Pedir al servidor que libere este pago? Solo libera el asiento cuando su ventana (ledger XRPL {lls}) ha pasado y el historial del omnibus prueba que el pago nunca llegó. Hasta entonces no se libera nada y el XRP de tu cliente sigue reservado.',
  'Ask the server to free this put-to-work? It frees the seat only once its 0xFE can no longer be signed and the omnibus history proves it never left. One that was signed is recorded, never released.':
    '¿Pedir al servidor que libere esta puesta a trabajar? Solo libera el asiento cuando su 0xFE ya no se puede firmar y el historial del omnibus prueba que nunca salió. Una que se firmó queda registrada, nunca se libera.',
  'Astryum only chooses which issuers it accepts — no ranking. Typing is the fallback.':
    'Astryum solo elige qué emisores acepta — sin ranking. Escribirlo a mano es la alternativa.',
  'Before Face ID — what this signature does': 'Antes de Face ID — qué hace esta firma',
  'Burned on Flare — verified on the blockchain. The XRP arrives when the FAssets agent pays it (minutes to hours).':
    'Quemado en Flare — verificado en la blockchain. El XRP llega cuando el agente de FAssets lo paga (de minutos a horas).',
  'Check the account in the explorer before doing anything else.': 'Comprueba la cuenta en el explorador antes de hacer nada más.',
  'Check the ledger': 'Comprobar el ledger',
  'Claim code for {label} (tag {tag}) — shown only once:': 'Código de reclamación para {label} (tag {tag}) — se muestra una sola vez:',
  'Claim sent — check before claiming again': 'Reclamación enviada — compruébala antes de reclamar otra vez',
  'Compose another order anyway': 'Componer otra orden igualmente',
  'Compose another order anyway? Signing both would send the same instruction twice.':
    '¿Componer otra orden igualmente? Firmar las dos enviaría la misma instrucción dos veces.',
  'Confirm with Face ID': 'Confirmar con Face ID',
  'Connect the XRPL account (Xaman) that owns this exit to claim it.': 'Conecta la cuenta XRPL (Xaman) dueña de esta salida para reclamarla.',
  'Connect your Flare wallet or your XRPL account (Xaman) to see your exits from':
    'Conecta tu wallet de Flare o tu cuenta XRPL (Xaman) para ver tus salidas de',
  'Could not read the free FXRP in this wallet (nor the protocol minimum) — «Position + wallet» is not offered until it reads.':
    'No se pudo leer el FXRP libre de esta wallet (ni el mínimo del protocolo) — «Posición + wallet» no se ofrece hasta que se lea.',
  'Could not read the free FXRP in this wallet, so an amount above the position cannot be checked. Retry the read first.':
    'No se pudo leer el FXRP libre de esta wallet, así que una cantidad por encima de la posición no se puede comprobar. Reintenta primero la lectura.',
  'Could not read the pote right now — you can still ask; the exchange and the pote check it.':
    'No se pudo leer el pote ahora mismo — puedes pedirlo igualmente; el exchange y el pote lo comprueban.',
  'Could not read the protocol minimum per redemption right now.': 'No se pudo leer ahora mismo el mínimo del protocolo por redención.',
  'Could not read this pot right now — nothing to show is NOT “you have nothing”. Your exits are where they were.':
    'No se pudo leer este pote ahora mismo — que no haya nada que mostrar NO es «no tienes nada». Tus salidas están donde estaban.',
  'Could not read your account on the chain right now.': 'No se pudo leer tu cuenta en la cadena ahora mismo.',
  'Could not read your position in this vault right now. That is not the same as not being in it — your capital is where it was.':
    'No se pudo leer tu posición en este vault ahora mismo. Eso no es lo mismo que no estar en él — tu capital está donde estaba.',
  'Could not read your position right now.': 'No se pudo leer tu posición ahora mismo.',
  'Could not refresh the free FXRP in this wallet — showing the last read.':
    'No se pudo actualizar el FXRP libre de esta wallet — se muestra la última lectura.',
  'Could not refresh your position — showing the last read.': 'No se pudo actualizar tu posición — se muestra la última lectura.',
  'Could not resolve the Flare account of your XRPL wallet, so exits waiting there cannot be shown. That is not the same as having none.':
    'No se pudo resolver la cuenta de Flare de tu wallet XRPL, así que las salidas que esperan allí no se pueden mostrar. Eso no es lo mismo que no tener ninguna.',
  'Could not resolve the Flare account of your XRPL wallet, so shares held there cannot be seen right now. That is not the same as not being in this vault.':
    'No se pudo resolver la cuenta de Flare de tu wallet XRPL, así que las shares que hay allí no se pueden ver ahora mismo. Eso no es lo mismo que no estar en este vault.',
  "Couldn't reach the server to prepare this — nothing was sent to your wallet.":
    'No se pudo contactar con el servidor para preparar esto — no se envió nada a tu wallet.',
  "Couldn't read part of your {protocol} positions for one of your wallets: the rows below are what could be read, and one or more markets are missing. That is not the same as having none there.":
    'No se pudo leer parte de tus posiciones de {protocol} en una de tus wallets: las filas de abajo son lo que se pudo leer, y faltan uno o más mercados. Eso no es lo mismo que no tener ninguna allí.',
  "Couldn't read the Flare positions of some of your wallets, so they may be missing from this board. That is not the same as having none.":
    'No se pudieron leer las posiciones de Flare de algunas de tus wallets, así que pueden faltar en este tablero. Eso no es lo mismo que no tener ninguna.',
  "Couldn't read this position's live balances just now, so this step can't tell what is left. Nothing is skipped or marked complete until the chain answers.":
    'No se pudieron leer ahora mismo los saldos en vivo de esta posición, así que este paso no puede saber qué queda. Nada se salta ni se marca como completo hasta que la cadena responda.',
  "Couldn't read your Ethereum position, so it isn't on this board. If you have one open, it's still open.":
    'No se pudo leer tu posición de Ethereum, así que no está en este tablero. Si tienes una abierta, sigue abierta.',
  "Couldn't read your managed vaults": 'No se pudieron leer tus bóvedas con gestor',
  "Couldn't read your {protocol} positions for one of your wallets, so they aren't on this board. That is not the same as having none — if you have one open, it is still open on-chain.":
    'No se pudieron leer tus posiciones de {protocol} en una de tus wallets, así que no están en este tablero. Eso no es lo mismo que no tener ninguna — si tienes una abierta, sigue abierta on-chain.',
  'Demo: the server signs the create (no issuer Xaman)': 'Demo: el servidor firma la creación (sin Xaman del emisor)',
  'Do not register it and do not broadcast these signatures again: withdraw this proposal, fix the cause and compose it again, then collect fresh signatures.':
    'No la registres ni vuelvas a difundir estas firmas: retira esta propuesta, arregla la causa y compónla de nuevo, y después recoge firmas nuevas.',
  'Free its place in the queue': 'Liberar su sitio en la cola',
  'Free the seat': 'Liberar el asiento',
  'Hand it to the client out of band — in person or by phone, never in a public channel. Whoever presents it first becomes the owner of this exchange account; it cannot be shown again.':
    'Entrégaselo al cliente fuera de banda — en persona o por teléfono, nunca por un canal público. Quien lo presente primero pasa a ser el dueño de esta cuenta del exchange; no se puede volver a mostrar.',
  'I handed it over — hide it': 'Ya lo he entregado — ocultarlo',
  'If it keeps failing, sign in again with the wallet that controls this account.':
    'Si sigue fallando, vuelve a entrar con la wallet que controla esta cuenta.',
  'In flight — the same client cannot be paid again until each one settles or is released:':
    'En vuelo — al mismo cliente no se le puede volver a pagar hasta que cada uno se liquide o se libere:',
  'In your Flare account — claimed with one signature in Xaman': 'En tu cuenta de Flare — se reclama con una firma en Xaman',
  'Issuing on the server…': 'Emitiendo en el servidor…',
  'It applied and failed: nothing moved, but the network fee was charged and the Sequence was spent, so these signatures can never be broadcast again. Do not register it — withdraw this proposal, fix the cause and compose it again, then collect fresh signatures.':
    'Se aplicó y falló: no se movió nada, pero se cobró la comisión de red y se gastó el Sequence, así que estas firmas ya no se pueden difundir nunca. No la registres — retira esta propuesta, arregla la causa y compónla de nuevo, y después recoge firmas nuevas.',
  'Its place in the omnibus queue is free again — prepare this one again when you want.':
    'Su sitio en la cola del omnibus vuelve a estar libre — prepárala otra vez cuando quieras.',
  'Keep it as FXRP in your Flare account': 'Dejarlo como FXRP en tu cuenta de Flare',
  'Kinetic code': 'Código de Kinetic',
  'Leave it': 'Dejarlo',
  'Mark external (not a client movement)': 'Marcar como externo (no es un movimiento de cliente)',
  'Marked external — nothing was debited. Release the reservation again.': 'Marcado como externo — no se debitó nada. Libera la reserva de nuevo.',
  'New claim code': 'Nuevo código de reclamación',
  'No pending exits in': 'No hay salidas pendientes en',
  'Nobody owns this client yet: issue a one-time claim code to hand to them':
    'Este cliente aún no tiene dueño: emite un código de reclamación de un solo uso para entregárselo',
  'Nothing moved and nothing was charged. Prepare it again: signing this one would be answered the same way. Its seat frees itself when its ledger window passes.':
    'No se movió nada ni se cobró nada. Prepárala otra vez: firmar esta recibiría la misma respuesta. Su asiento se libera solo cuando pase su ventana de ledger.',
  'Nothing was prepared and nothing was signed: this exit is exactly where it was.':
    'No se preparó nada ni se firmó nada: esta salida está exactamente donde estaba.',
  'Nothing was prepared and nothing was signed: your money is exactly where it was.':
    'No se preparó nada ni se firmó nada: tu dinero está exactamente donde estaba.',
  'One of your accounts could not be read — this may not be your whole position.':
    'Una de tus cuentas no se pudo leer — puede que esta no sea tu posición completa.',
  'Optional — leave it empty and your account opens anyway; you can add the wallet later. It has to be proven yours: the wallet you signed in with, or one bound to your account by signature in Wallets. If it is not, the account still opens and only the wallet is refused.':
    'Opcional — déjalo vacío y tu cuenta se abre igualmente; puedes añadir la wallet más tarde. Tiene que estar probado que es tuya: la wallet con la que entraste, o una vinculada a tu cuenta por firma en Wallets. Si no lo es, la cuenta se abre igualmente y solo se rechaza la wallet.',
  'Or link it to this account by signing the binding challenge, then repeat this action.':
    'O vincúlala a esta cuenta firmando el reto de vinculación, y repite esta acción.',
  'Or register it from Wallets by signing the binding challenge, then open this inbox again.':
    'O regístrala desde Wallets firmando el reto de vinculación, y vuelve a abrir esta bandeja.',
  'Or write to us: an administrator can check that date. Re-linking the wallet will not help.':
    'O escríbenos: un administrador puede comprobar esa fecha. Volver a vincular la wallet no servirá.',
  'Or write to us: an administrator can repair the security record. Re-linking the wallet will not help.':
    'O escríbenos: un administrador puede reparar el registro de seguridad. Volver a vincular la wallet no servirá.',
  'Or write to us: an administrator can see whether this account record was removed and restore it.':
    'O escríbenos: un administrador puede ver si este registro de cuenta se eliminó y restaurarlo.',
  'Order validated on the ledger.': 'Orden validada en el ledger.',
  'Other account (enter manually)…': 'Otra cuenta (introducir a mano)…',
  'Other sections, vaults and accounts stay closed until this signature is resolved.':
    'Las demás secciones, vaults y cuentas siguen cerradas hasta que esta firma se resuelva.',
  'Part of the withdrawal queue could not be read just now. The entries shown are real; anything queued in an unread period is still queued — it retries on its own.':
    'Parte de la cola de retirada no se pudo leer ahora mismo. Las entradas que se muestran son reales; lo encolado en un periodo sin leer sigue encolado — se reintenta solo.',
  'Re-read your position before signing again — the amount may be larger than what it holds.':
    'Vuelve a leer tu posición antes de firmar otra vez — la cantidad puede ser mayor que lo que contiene.',
  'Reading your exits from': 'Leyendo tus salidas de',
  'Reading your position…': 'Leyendo tu posición…',
  'Review the deposit': 'Revisa el depósito',
  'Review the exit to XRP': 'Revisa la salida a XRP',
  'Review the send': 'Revisa el envío',
  'Select the accredited issuer…': 'Selecciona el emisor acreditado…',
  'Sequence': 'Sequence',
  'Sign in with that wallet — the login itself is the signature.': 'Entra con esa wallet — el propio inicio de sesión es la firma.',
  'Sign in with the wallet that holds your seat — the login itself is the signature.':
    'Entra con la wallet que tiene tu asiento — el propio inicio de sesión es la firma.',
  'Sign without a dry-run — nothing could check this in advance': 'Firmar sin simulación — nada pudo comprobar esto de antemano',
  'Signed. On its way.': 'Firmado. En camino.',
  'Skips the domain/register checks — shoot only, never a real regulatory attestation. The subject still accepts in their own Xaman.':
    'Se salta las comprobaciones de dominio/registro — solo para el rodaje, nunca una atestación regulatoria real. El sujeto sigue aceptando en su propia Xaman.',
  'Start — server issues (demo)': 'Empezar — emite el servidor (demo)',
  'That Sequence has already been used': 'Ese Sequence ya se ha usado',
  'The 0xFE payment behind this exit is no longer waiting to be signed — it was signed, executed or replaced. Check its state before composing anything, and prepare the exit again from its own screen if it is really gone.':
    'El pago 0xFE de esta salida ya no está esperando firma — se firmó, se ejecutó o se sustituyó. Comprueba su estado antes de componer nada, y prepara la salida otra vez desde su propia pantalla si de verdad ha desaparecido.',
  'The Flare account of your XRPL wallet could not be resolved — shares held there are not counted here.':
    'La cuenta de Flare de tu wallet XRPL no se pudo resolver — las shares que hay allí no se cuentan aquí.',
  'The Flare account of your XRPL wallet could not be resolved: exits waiting there may be missing from this list.':
    'La cuenta de Flare de tu wallet XRPL no se pudo resolver: las salidas que esperan allí pueden faltar en esta lista.',
  'The exchange gives the claim code only to the person it opened the account for — in person or by phone.':
    'El exchange entrega el código de reclamación solo a la persona para la que abrió la cuenta — en persona o por teléfono.',
  'The exchange opened this account with your Face ID account, but it is not yours yet. Enter the claim code the exchange gave you to make it yours — until then nothing here can be changed.':
    'El exchange abrió esta cuenta con tu cuenta de Face ID, pero todavía no es tuya. Escribe el código de reclamación que te dio el exchange para hacerla tuya — hasta entonces aquí no se puede cambiar nada.',
  'The exit pass of this transaction expired (it lasts 15 minutes). Prepare the exit again from its own screen and sign it with the quorum; nothing was signed.':
    'El pase de salida de esta transacción ha caducado (dura 15 minutos). Prepara la salida otra vez desde su propia pantalla y fírmala con el quórum; no se firmó nada.',
  'The exit pass that came with this transaction is not for these exact bytes and this account, so the server did not take it. Prepare the exit again from its own screen — nothing was signed.':
    'El pase de salida que venía con esta transacción no es para estos bytes exactos y esta cuenta, así que el servidor no lo aceptó. Prepara la salida otra vez desde su propia pantalla — no se firmó nada.',
  'The ledger had not validated this transaction when we stopped waiting, so it is not registered yet. Check it in the explorer, then register it here.':
    'El ledger no había validado esta transacción cuando dejamos de esperar, así que aún no está registrada. Compruébala en el explorador y después regístrala aquí.',
  'The ledger validated this transaction with a failure result, so it did not take effect and its network fee was charged. Check the account before starting the ceremony again.':
    'El ledger validó esta transacción con un resultado de fallo, así que no tuvo efecto y se cobró su comisión de red. Comprueba la cuenta antes de empezar la ceremonia otra vez.',
  'The network refused this transaction before it entered a ledger. Nothing moved.':
    'La red rechazó esta transacción antes de que entrara en un ledger. No se movió nada.',
  "The omnibus sent 0xFE payments that no record accounts for. If one is this client's, record it; if it is not a client movement, mark it external:":
    'El omnibus envió pagos 0xFE de los que ningún registro da cuenta. Si alguno es de este cliente, regístralo; si no es un movimiento de cliente, márcalo como externo:',
  "The omnibus you name here becomes this exchange's declared cash desk: only this desk prepares transactions against it, and a stranger's request on that account is refused. Its key never reaches Astryum.":
    'El omnibus que nombres aquí pasa a ser la caja declarada de este exchange: solo esta mesa prepara transacciones contra él, y la petición de un extraño sobre esa cuenta se rechaza. Su llave nunca llega a Astryum.',
  'The other lenses stay closed until this signature is resolved.': 'Las demás lentes siguen cerradas hasta que esta firma se resuelva.',
  'The payment went to Xaman and we could not confirm how it ended. Do NOT sign it again — it may already be on the ledger. Check the hash and your account history first.':
    'El pago fue a Xaman y no pudimos confirmar cómo acabó. NO lo vuelvas a firmar — puede que ya esté en el ledger. Comprueba primero el hash y el historial de tu cuenta.',
  'The request that went out': 'La petición que salió',
  "The reservation was released by itself once its window closed: its 0xFE can never land, and the client's XRP is free again.":
    'La reserva se liberó sola al cerrarse su ventana: su 0xFE ya no puede llegar, y el XRP del cliente vuelve a estar libre.',
  'The server could not match this transaction to an exit it composed for this account, so it took the general door instead. If this is an exit, prepare it again from its own screen: exits are never closed.':
    'El servidor no pudo casar esta transacción con una salida que hubiera compuesto para esta cuenta, así que tomó la puerta general. Si esto es una salida, prepárala otra vez desde su propia pantalla: las salidas nunca se cierran.',
  'The server could not read what this transaction is right now, so it could not confirm it is the exit it composed. Nothing was pinned and nothing was signed — try again in a moment; an exit is never closed, only unread.':
    'El servidor no pudo leer ahora mismo qué es esta transacción, así que no pudo confirmar que es la salida que compuso. No se fijó nada ni se firmó nada — inténtalo en un momento; una salida nunca está cerrada, solo sin leer.',
  'The server had no place of this one to free: either it was never taken, or that signature already landed. Check the omnibus account history before preparing it again.':
    'El servidor no tenía ningún sitio de esta que liberar: o nunca se ocupó, o esa firma ya llegó. Comprueba el historial de la cuenta omnibus antes de prepararla otra vez.',
  'The server refused this exit. Nothing was prepared and nothing was signed.': 'El servidor rechazó esta salida. No se preparó nada ni se firmó nada.',
  'The server refused this operation. Nothing was prepared and nothing was signed.': 'El servidor rechazó esta operación. No se preparó nada ni se firmó nada.',
  'The server warned about this account’s Sequence': 'El servidor avisó sobre el Sequence de esta cuenta',
  'The steps before it already went through — do NOT sign this again, it would repeat them.':
    'Los pasos anteriores ya se completaron — NO vuelvas a firmar esto, los repetiría.',
  'The transaction was mined and the network fee was spent, but the protocol refused the operation and nothing moved':
    'La transacción se minó y la comisión de red se gastó, pero el protocolo rechazó la operación y no se movió nada',
  'The transaction went to Xaman and we could not confirm how it ended. Do NOT sign it again — it may already be on the ledger. Check the hash and your account history first.':
    'La transacción fue a Xaman y no pudimos confirmar cómo acabó. NO la vuelvas a firmar — puede que ya esté en el ledger. Comprueba primero el hash y el historial de tu cuenta.',
  'The withdrawal queue of one of your accounts could not be read just now. Anything you queued is still queued — what you see here is the last read, not a fresh one. It retries on its own.':
    'La cola de retirada de una de tus cuentas no se pudo leer ahora mismo. Lo que encolaste sigue encolado — lo que ves aquí es la última lectura, no una nueva. Se reintenta solo.',
  'This amount is below what FAssets converts back to XRP. It can still be claimed: as FXRP, into your own Flare account — you can convert it to XRP later, once it is enough.':
    'Esta cantidad está por debajo de lo que FAssets convierte de vuelta a XRP. Aun así se puede reclamar: como FXRP, en tu propia cuenta de Flare — podrás convertirla a XRP más adelante, cuando sea suficiente.',
  'This council already has too many live orders, so the server did not compose another one. Settle or let the pending ones age out first — this is a queue of ours, not a refusal of the cage.':
    'Este consejo ya tiene demasiadas órdenes vivas, así que el servidor no compuso otra. Liquida las pendientes o deja que caduquen primero — esto es una cola nuestra, no un rechazo de la jaula.',
  'This hash is not the transaction of this proposal — it was not registered.': 'Este hash no es la transacción de esta propuesta — no se registró.',
  'This is not the cage refusing: nothing was recorded and nothing was signed. Compose another one only if you mean the capital to move again.':
    'Esto no es la jaula rechazando: no se registró nada ni se firmó nada. Compón otra solo si quieres que el capital se mueva otra vez.',
  'This pote has an exit window: your shares burn now and the amount is fixed in FXRP; you claim it into your Face ID account when the window ends. Nobody can stop that claim.':
    'Este pote tiene una ventana de salida: tus shares se queman ahora y la cantidad queda fijada en FXRP; la reclamas en tu cuenta de Face ID cuando termina la ventana. Nadie puede impedir esa reclamación.',
  'This prepared transaction can no longer be used —': 'Esta transacción preparada ya no se puede usar —',
  'This transaction already went to Xaman. Check the omnibus account history before preparing it again.':
    'Esta transacción ya fue a Xaman. Comprueba el historial de la cuenta omnibus antes de prepararla otra vez.',
  'This transaction reached the ledger and FAILED — nothing moved.': 'Esta transacción llegó al ledger y FALLÓ — no se movió nada.',
  'This transaction was not pinned to that seat': 'Esta transacción no se fijó a ese asiento',
  'Too small to convert back to XRP': 'Demasiado pequeña para convertirla de vuelta a XRP',
  'Try again in a moment — this one really does clear on its own.': 'Inténtalo en un momento — esto sí que se resuelve solo.',
  'Try again later — the record is dated ahead of our clock, and time clears this on its own.':
    'Inténtalo más tarde — el registro tiene una fecha por delante de nuestro reloj, y el tiempo lo resuelve solo.',
  'Try reading them again': 'Intentar leerlas otra vez',
  'Validated on the ledger': 'Validada en el ledger',
  'Waiting for the ledger to validate…': 'Esperando a que el ledger valide…',
  'We could not confirm this transaction is an exit': 'No pudimos confirmar que esta transacción sea una salida',
  'We could not read this account’s proposal inbox': 'No pudimos leer la bandeja de propuestas de esta cuenta',
  'Why is this omnibus 0xFE not a client movement? The reason stays on the receipt book.':
    '¿Por qué este 0xFE del omnibus no es un movimiento de cliente? El motivo queda en el libro de recibos.',
  'Xaman reports it signed and sent, but the ledger had not validated the transaction when we stopped waiting. Do NOT sign it again: check this hash on the explorer and your account history first.':
    'Xaman informa de que se firmó y se envió, pero el ledger no había validado la transacción cuando dejamos de esperar. NO la vuelvas a firmar: comprueba primero este hash en el explorador y el historial de tu cuenta.',
  'Xaman reports it signed, but it returned no transaction hash. Check the account history before doing anything again — do NOT sign it again.':
    'Xaman informa de que se firmó, pero no devolvió ningún hash de transacción. Comprueba el historial de la cuenta antes de hacer nada otra vez — NO la vuelvas a firmar.',
  'You can still open the exit below: the contract checks what you hold, not this screen.':
    'Aun así puedes abrir la salida de abajo: el contrato comprueba lo que tienes, no esta pantalla.',
  "Your Ethereum position couldn't be read from your region, so it isn't drawn on this board. If you have one open, it is still open on-chain — and leaving it is never blocked: the exit doors below prepare straight from the chain.":
    'Tu posición de Ethereum no se pudo leer desde tu región, así que no se dibuja en este tablero. Si tienes una abierta, sigue abierta on-chain — y salir de ella nunca se bloquea: las puertas de salida de abajo preparan directamente desde la cadena.',
  'Your account is open, but the withdrawal wallet was not saved: {reason}': 'Tu cuenta está abierta, pero la wallet de retiradas no se guardó: {reason}',
  'Your live supply could not be read, so this amount was not checked against your balance — and the dry-run could not run either: NOTHING has checked this operation. Kinetic does not reject a withdrawal larger than your position: it returns a code, the transaction mines, you pay gas and nothing moves — and your wallet will not warn you. Go back and retry the read before signing.':
    'Tu supply en vivo no se pudo leer, así que esta cantidad no se comprobó contra tu saldo — y la simulación tampoco pudo ejecutarse: NADA ha comprobado esta operación. Kinetic no rechaza una retirada mayor que tu posición: devuelve un código, la transacción se mina, pagas gas y no se mueve nada — y tu wallet no te avisará. Vuelve atrás y reintenta la lectura antes de firmar.',
  'Your live supply could not be read, so this amount was not checked against your balance. Kinetic does not reject a withdrawal larger than your position: it returns a code, the transaction mines, you pay gas and nothing moves — and your wallet will not warn you. The dry-run verdict below is the check.':
    'Tu supply en vivo no se pudo leer, así que esta cantidad no se comprobó contra tu saldo. Kinetic no rechaza una retirada mayor que tu posición: devuelve un código, la transacción se mina, pagas gas y no se mueve nada — y tu wallet no te avisará. El veredicto de la simulación de abajo es la comprobación.',
  "Your session couldn't read your Ethereum position, so it isn't on this board. If you have one open, it's still open — sign in again to see it here.":
    'Tu sesión no pudo leer tu posición de Ethereum, así que no está en este tablero. Si tienes una abierta, sigue abierta — vuelve a entrar para verla aquí.',
  'Your shares are exactly where they were. Change the amount, or try again in a moment — and write to us if it keeps refusing.':
    'Tus shares están exactamente donde estaban. Cambia la cantidad, o inténtalo en un momento — y escríbenos si sigue rechazándolo.',
  'Your vaults could not be read again right now. What you see is the last reading, kept on screen while a signature is open.':
    'Tus vaults no se pudieron volver a leer ahora mismo. Lo que ves es la última lectura, mantenida en pantalla mientras hay una firma abierta.',
  'Your withdrawal wallet is on file.': 'Tu wallet de retiradas está registrada.',
  'could not be read': 'no se pudo leer',
  'its account already used that sequence number': 'su cuenta ya usó ese número de secuencia',
  'its ledger window passed before it was signed': 'su ventana de ledger pasó antes de que se firmara',
  'no answer': 'sin respuesta',
  'not read': 'sin leer',
  'proposal': 'propuesta',
  'the cage refused this order': 'la jaula rechazó esta orden',
  'the live balance did not answer, so no ceiling is shown. Kinetic does not reject a withdrawal larger than your position: it returns a code, the transaction mines, you pay gas and nothing moves. The dry-run on the next step is the check.':
    'el saldo en vivo no respondió, así que no se muestra ningún techo. Kinetic no rechaza una retirada mayor que tu posición: devuelve un código, la transacción se mina, pagas gas y no se mueve nada. La simulación del paso siguiente es la comprobación.',
  "this position's live collateral and debt did not answer, so no figures are shown. Retry the read before repaying.":
    'el colateral y la deuda en vivo de esta posición no respondieron, así que no se muestran cifras. Reintenta la lectura antes de pagar.',
  "today's spend could not be read — entries stop until it can be; a client's payout still goes out and is written into the receipts":
    'el gasto de hoy no se pudo leer — las entradas se paran hasta que se pueda; el pago a un cliente sigue saliendo y se anota en los recibos',
};

const TABLES: Record<Lang, Record<string, string>> = { es: { ...EXCHANGE_PRODUCT, ...ES, ...PAGES, ...RELEASE_COPY }, en: {} };

export function translate(lang: Lang, s: string): string {
  if (lang === 'en') return s;
  return TABLES[lang][s] ?? s;
}
