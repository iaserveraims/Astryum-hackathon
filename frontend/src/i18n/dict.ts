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
  healthy: 'saludable',
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
  'Automations leave prepared intents here when they fire.': 'Las automatizaciones dejan aquí los intents preparados cuando saltan.',
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
    'Esta regla no tiene umbral editable — aquí solo puede cambiar su cooldown.',
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
  'Network fee': 'Fee de red',
  'Astryum fee': 'Fee de Astryum',
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
  'Govern the productive capital from XRPL, literally: the quorum signs ONE 1-drop transaction committing the exact order; the Flare Data Connector proves it; the bridge executes only those bytes against the vault. No order can extract the principal — that function does not exist.':
    'Gobierna el capital productivo desde XRPL, literalmente: el quórum firma UNA transacción de 1 drop que compromete la orden exacta; el Flare Data Connector la prueba; el bridge ejecuta solo esos bytes contra el vault. Ninguna orden puede extraer el principal — esa función no existe.',
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
  'Pending fields are marked [PENDIENTE] in the text — fill them here or edit them there.':
    'Los campos pendientes quedan marcados [PENDIENTE] en el texto — rellénalos aquí o edítalos allí.',
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
};

const TABLES: Record<Lang, Record<string, string>> = { es: { ...ES, ...PAGES }, en: {} };

export function translate(lang: Lang, s: string): string {
  if (lang === 'en') return s;
  return TABLES[lang][s] ?? s;
}
