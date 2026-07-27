// Boot trace — must appear in Railway logs even if downstream imports crash.
// If you only see "Starting Container" + prisma output but NOT this line,
// node is failing before any user code runs.
console.log('[BOOT] node entry reached, pid=' + process.pid + ' node=' + process.version);
process.on('uncaughtException', (e) => { console.error('[BOOT] uncaughtException:', e); });
process.on('unhandledRejection', (e) => { console.error('[BOOT] unhandledRejection:', e); });

import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import winston from 'winston';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { rateLimit } from './middleware/validation';

// Cargar variables de entorno
dotenv.config();

// Configurar logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'defibro-backend' },
  transports: [
    ...(process.env.NODE_ENV !== 'production' ? [
      new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
      new winston.transports.File({ filename: 'logs/combined.log' }),
    ] : []),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ],
});

// Crear aplicación Express
const app: Application = express();
const server = createServer(app);

// Allowed CORS origins (comma-separated list in CORS_ORIGIN env)
// Supports wildcards: https://*.vercel.app  or  https://*.example.com
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// Convert wildcard entries (e.g. https://*.vercel.app) into RegExp
const originMatchers: Array<string | RegExp> = allowedOrigins.map((o) => {
  if (o.includes('*')) {
    const escaped = o.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]+');
    return new RegExp(`^${escaped}$`);
  }
  return o;
});

const isOriginAllowed = (origin: string): boolean =>
  originMatchers.some((m) => (m instanceof RegExp ? m.test(origin) : m === origin));

// Configurar Socket.IO with security
const io = new SocketIOServer(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || isOriginAllowed(origin)) return callback(null, true);
      return callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket'],
  path: '/ws',
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true,
  }
});

// Middleware de seguridad
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false
}));

// CORS — soporta lista de orígenes separada por comas en CORS_ORIGIN
// Wildcards permitidos: https://*.vercel.app
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (isOriginAllowed(origin)) return callback(null, true);
    return callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  // PATCH is required for wallet rename / set-primary / binding-mode
  // (PATCH /api/wallets/mine/:id, /bindings/:id/mode). Its absence made the
  // CORS preflight reject those calls → "Failed to fetch" in the Wallets tab.
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  // x-admin-key: the founders-panel static door (adminPanel.ts). A custom
  // header triggers a CORS preflight — without it listed here the browser
  // blocked the request before it ever reached the backend, so the panel
  // failed even with ADMIN_PANEL_KEY correctly seeded.
  // x-admin-session: the 2h panel session token that replaced the raw key on
  // every overview call (2026-07-23 hardening). Same preflight caveat.
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-admin-key', 'x-admin-session']
}));

// Security: Rate limiting — 500 req/15 min for a private single-user app with real-time features
app.use(rateLimit(500, 15 * 60 * 1000));

// Middleware de parsing with security limits
app.use(
  express.json({
    limit: '1mb', // Reduced from 10mb for security
    // Capture raw bytes so partner webhooks can be HMAC-verified (S4 P26).
    verify: (req, _res, buf) => {
      (req as unknown as { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Middleware de logging
app.use((req: Request, res: Response, next: NextFunction) => {
  logger.info(`${req.method} ${req.url}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });
  next();
});

// Health check — Postgres-only post Mongo migration. Returns 200 even when
// downstream services are degraded, so Railway's healthcheck only fails on a
// hard process crash (which is what we want).
app.get('/health', async (_req: Request, res: Response) => {
  res.status(200).json({
    uptime: process.uptime(),
    message: 'OK',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0',
    services: {
      websocket: io.engine.clientsCount > 0 ? 'active' : 'inactive'
    }
  });
});

// ✅ REPARADO: API Routes with proper structure
app.get('/api/status', (req: Request, res: Response) => {
  res.json({
    status: 'running',
    timestamp: new Date().toISOString(),
    message: 'DeFibro API is running successfully!',
    endpoints: {
      health: '/health',
      status: '/api/status'
    }
  });
});

// V1 Auth (SIWE) router is mounted below at line ~203. The legacy 501 stub was removed.
// V1 Portfolio router is mounted below at line ~206. The legacy 501 stub was removed.

// Wire all routes dynamically so a single broken route never crashes the server
try {
  const ftsoRouter = require('./routes/ftso').default;
  app.use('/api/ftso', ftsoRouter);
} catch (err) {
  logger.warn('Routes wiring warning (ftso):', err);
}

// Resilient per-router mount: a failure loading any one router (missing
// module, env-var crash, etc.) must NOT prevent the rest from mounting.
// Previously a single try/catch wrapped all 20 requires, so /api/auth would
// silently fail to mount if e.g. /api/devices' import threw at load time.
function mountRouter(
  mountPath: string,
  loader: () => any,
  ...middlewares: any[]
): void {
  try {
    const router = loader();
    if (middlewares.length > 0) {
      app.use(mountPath, ...middlewares, router);
    } else {
      app.use(mountPath, router);
    }
  } catch (err) {
    logger.warn(`Failed to mount ${mountPath}`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

let requireSiweAuth: any = (_req: any, _res: any, next: any) => next();
let requireFlareMainnet: any = (_req: any, _res: any, next: any) => next();
// Step-up guards — no-op unless STEP_UP_ENABLED=1 AND the user opted in.
// stepUpGuard enforces read+write; stepUpWriteGuard only mutating methods.
let stepUpWriteGuard: any = (_feature: string) => (_req: any, _res: any, next: any) => next();
let stepUpGuard: any = (_feature: string) => (_req: any, _res: any, next: any) => next();
try {
  requireSiweAuth = require('./middleware/requireSiweAuth').requireSiweAuth;
  requireFlareMainnet = require('./middleware/chainGuard').requireFlareMainnet;
  stepUpWriteGuard = require('./middleware/requireStepUp').stepUpWriteGuard;
  stepUpGuard = require('./middleware/requireStepUp').stepUpGuard;
} catch (err) {
  logger.error('CRITICAL: failed to load auth/chain middleware', { err });
}

// Public auth — mount FIRST and on its own so a downstream loader failure
// can never prevent SIWE from working.
mountRouter('/api/auth', () => require('./routes/auth').default);
// Passkey (WebAuthn) login + device registration. register/* self-gate with SIWE.
mountRouter('/api/auth/passkey', () => require('./routes/passkey').default);

// MoneyFlows / canvas / data / wallets
mountRouter('/api/wallets', () => require('./routes/walletRegistry').default);
// Tx-bindings (prueba de propiedad por firma) — el frontend (walletLinkService)
// llama initiate/confirm/:id/mode/:id; se podó por error en e8f6f58 y volvió.
mountRouter('/api/wallets/bindings', () => require('./routes/walletBindings').default, requireSiweAuth, stepUpGuard('wallet_security'));
// Governed-account registry (authority switcher): pointers to the councils the
// user governs/observes — state is always read fresh from the ledger.
mountRouter('/api/governed-accounts', () => require('./routes/governedAccounts').default, requireSiweAuth);
// Admin panel (founders only, read-only): DB counts + waitlist. Mounted
// WITHOUT the global SIWE wrapper on purpose: the gate lives inside the
// router (static ADMIN_PANEL_KEY door — usable session-less — plus the
// SIWE+ADMIN_EMAILS door). 404s outright when neither env is set.
mountRouter('/api/admin-panel', () => require('./routes/adminPanel').default);
// Executor 0xFE ops (founders only): lista de dispatches atascados + desatasco
// (retry/park). Mismas puertas que el panel (requireAdmin DENTRO del router);
// router propio para que adminPanel siga siendo read-only por construcción.
mountRouter('/api/admin-executor', () => require('./routes/adminExecutor').default);
// Council proposals (governed-mode inbox): pinned unsigned txs + verified
// member blobs. Combine + broadcast stay in the browser (prepare-only).
mountRouter('/api/council/proposals', () => require('./routes/councilProposals').default, requireSiweAuth);
// Astryum treasury (Turnkey org-controlled) — status public, addresses SIWE-gated
// D8 — KWYH (GoPlus) + Approval & Exposure Center
// Cross-cutting — per-jurisdiction module availability (geofence DeFi execution)
mountRouter('/api/jurisdiction', () => require('./routes/jurisdiction').default);
// PUBLIC (no auth): live Flare gas + XRPL fee for the dashboard header — reads
// only public chain telemetry, cached 30s in-process.
mountRouter('/api/network', () => require('./routes/networkStatus').default);
// Platform status light (Astryum Orbit System): GET is public; the PUT that
// flips online/offline sits behind adminPanel's requireAdmin inside the router.
mountRouter('/api/platform', () => require('./routes/platformStatus').default);
// PUBLIC (no auth): early-access waitlist capture from the landing. Write-only
// (no read endpoint), idempotent, rate-limited in-process.
mountRouter('/api/waitlist', () => require('./routes/waitlist').default);
// Block G — bundle lifecycle endpoints (cross-ecosystem multi-step intents)
// P17 — Wallet Binding (read vs read_and_receive, signature-proven ownership)
// Step-Up Signature Locks — configurable per-feature read/write protection
mountRouter('/api/security/step-up', () => require('./routes/securityStepUp').default, requireSiweAuth);
mountRouter('/api/positions', () => require('./routes/positions').default, requireSiweAuth);
// PUBLIC (no auth): watch-only scan funnel — reads only public on-chain data.

// V1 routes — gated by SIWE
mountRouter('/api/portfolio', () => require('./routes/portfolio').default, requireSiweAuth);
mountRouter('/api/risk', () => require('./routes/risk').default, requireSiweAuth);
// /api/intents serves BOTH the legacy V1 IntentEngine (Flare-only) and the V2
// CalldataBuilder path (multichain Safe Markets: Aave/Compound/Morpho on
// Ethereum/Arbitrum/Base/Polygon/Optimism). The chain guard can't sit at the
// mount level or it would 400 every non-Flare V2 intent. V1 Flare-only
// semantics are enforced inside the route's V1 branch instead.
// Flare mainnet DEMO — the two live Earn entradas (E1 FXRP via Xaman, E2 FLR via
// EVM). Prepare-only: returns unsigned XRPL Payment / EVM calls. Gated inside the
// route by FLARE_DEFI_ENABLED (#8) + geofence (#5).
mountRouter('/api/flare-demo', () => require('./routes/flareDemo').default, requireSiweAuth);
// XRPL native DeFi builders (escrow/DEX/AMM) — prepare-only: returns unsigned
// txjson for Xaman + disclosure. Gated inside the route by XRPL_DEFI_ENABLED
// (#10) + geofence (#5); the read-only vigía/amm-info endpoints stay open.
mountRouter('/api/xrpl-defi', () => require('./routes/xrplDefi').default, requireSiweAuth);
// Wallets page — native FLR/XRP transfer prepare (prepare-only, unsigned payload
// + disclosure). A wallet-to-wallet payment is NOT DeFi execution, so it is not
// behind FLARE_DEFI_ENABLED/geofence — same availability tier as fiat/monitoring.
mountRouter('/api/wallet-transfer', () => require('./routes/walletTransfer').default, requireSiweAuth);
// Saved destination addresses for the Send flow (pruned in e8f6f58, restored).
// UX data only — labels + public addresses; the route self-gates with SIWE.
mountRouter('/api/address-book', () => require('./routes/addressBook').default);
mountRouter('/api/rules', () => require('./routes/rules').default, requireSiweAuth, stepUpGuard('rules_alerts'));
// The signing surface for automation-prepared intents (/app/intents reads it).
// Read + user-lifecycle only — the signature happens in the user's wallet.
mountRouter('/api/intents', () => require('./routes/intents').default, requireSiweAuth);
// User-scoped form preferences (rule prefills cross-device) — UX data only,
// never keys/funds/payloads. SIWE-scoped to the owner.
mountRouter('/api/preferences', () => require('./routes/preferences').default, requireSiweAuth);
// F1 — CanonicalMoneyFlow (estrategia conjunta): translate (deterministic
// dry-run), list-by-canonicalRef and capability matrix. READ-ONLY module —
// rule creation still goes exclusively through POST /api/rules above.
mountRouter('/api/moneyflows', () => require('./routes/moneyflows').default, requireSiweAuth, stepUpGuard('rules_alerts'));
mountRouter('/api/alerts', () => require('./routes/alerts').default, requireSiweAuth, stepUpGuard('rules_alerts'));

// V1.1 Control Plane — Integration Registry + Router
mountRouter('/api/integrations', () => require('./routes/integrations').default);
mountRouter('/api/activity', () => require('./routes/activity').default, requireSiweAuth);
// V1.1 S3 — Wallet Watchlist + Capital Map (universal read layer)
// NOTE: mounted at /api/wallets/watchlist (not /api/wallets) to avoid shadowing
// the public walletRegistry which is already mounted at /api/wallets above.
// V1.1 S4 — Partner Intent + MoonPay. No blanket auth: /session* self-gate with
// SIWE; /webhook (HMAC-verified) and /capabilities are public.

// S2 — Multi-chain DeFi Discovery

// V1.2 — KYC / Identity (Crossmint)
// POST /api/kyc/webhook is public (HMAC-authenticated by Crossmint)
// POST /api/kyc/initiate + GET /api/kyc/status are SIWE-gated inside the router

// A6 — Transfer (native + ERC-20, prepare-only, user signs externally)

// P6.3 — Address Book (saved recipients for wallet-to-wallet transfers)

// S5 — Trigger rules (notify only, never auto-execute)

// S6 — Tax events + exports (all endpoints require auth)

// S7 — AI chat with real user context + response guard
mountRouter('/api/ai/chat', () => require('./routes/aiChat').default, requireSiweAuth);

// S9 — Swap via 1inch with embedded integrator fee (revenue model)

// Stellar lending (Blend) — in-app backend-built Soroban XDR → Freighter sign

// V2 S1 — DefiLlama protocol pool registry (public read, admin-only sync trigger)

// V2 S4.5 — IntentAuthorizationSession (SIWE-gated, no txHash ever stored)

// V2 S9 — Admin: referral attribution dashboard (ADMIN_API_KEY required, not SIWE)

// P-AGENT-1/2/3 — AI Agent (chat SSE, MCP connections, documents, rules)
mountRouter('/api/agent', () => require('./routes/agent').default, requireSiweAuth);

// PRODUCT ASSISTANT — PUBLIC (no auth), stateless, no tools, no user data. A
// manual/GPS of the Astryum app for non-crypto users. Sees nothing of the user;
// stays out of the signing path by construction. Rate-limited in-process (it
// spends Astryum's own Anthropic key).
mountRouter('/api/product-assistant', () => require('./routes/productAssistant').default);

// LEGACY ASSISTANT ("Descubrir") — PUBLIC (no auth), stateless, no tools, no user
// data. Helps a non-expert find WHICH Legacy setup fits and explains the journey;
// works on abstract intent only (real names/addresses stay in the browser). Stays
// out of the signing path by construction. Rate-limited (spends Astryum's key).
mountRouter('/api/legacy-assistant', () => require('./routes/legacyAssistant').default);

// STRATEGY ASSISTANT — SIWE-gated LLM that interprets NL (amount, target, risk intent)
// and presents a NEUTRAL metrics table (numbers from the tested KineticIsoMath, live
// rates). No tools; never builds/signs the payload — the user reviews + signs in the
// prepare→sign modal (path of firma untouched). (Fix 2)
mountRouter('/api/strategy-assistant', () => require('./routes/strategyAssistant').default, requireSiweAuth);

// P-CANONICAL-BRIDGE — real-time SSE bridge from DefiLlama + anomaly detection (public read)

// P-GOALS-LAYER — goals, feasibility analysis, manager proposals

// P-DELEGATION — manager profiles, proposals, mandates, backup strategies

// P-GROWTH — public referral click tracking

app.use('/api/defi', (req: Request, res: Response) => {
  res.status(501).json({ 
    message: 'DeFi protocols endpoint - Coming soon!',
    supportedProtocols: ['Aave', 'Compound', 'Uniswap', 'SushiSwap'],
    availableSoon: true
  });
});

// Socket message rate limiting per connection
const socketRateLimits = new Map<string, { count: number; resetTime: number }>();

// WebSocket message validation
function validateWebSocketMessage(data: any): boolean {
  try {
    if (!data || typeof data !== 'object') return false;

    // Check message type
    const validTypes = ['subscribe_prices', 'subscribe_instances', 'ai_chat', 'message'];
    if (!validTypes.includes(data.type)) return false;

    // Validate content length
    if (data.content && typeof data.content === 'string' && data.content.length > 10000) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

// ✅ SECURED: Socket.IO handling with security
io.on('connection', (socket) => {
  const clientIP = socket.handshake.address;

  logger.info('Nueva conexión WebSocket establecida', {
    id: socket.id,
    ip: clientIP,
    userAgent: socket.handshake.headers['user-agent']
  });

  // Initialize rate limiting for this socket
  socketRateLimits.set(socket.id, { count: 0, resetTime: Date.now() + 60000 });

  // Rate limiting check function
  function checkRateLimit(socketId: string): boolean {
    const now = Date.now();
    let rateData = socketRateLimits.get(socketId);

    if (!rateData || now > rateData.resetTime) {
      rateData = { count: 0, resetTime: now + 60000 };
      socketRateLimits.set(socketId, rateData);
    }

    rateData.count++;
    return rateData.count <= 60; // Max 60 messages per minute
  }

  // Manejar mensajes genéricos
  socket.on('message', (data) => {
    try {
      // Rate limiting check
      if (!checkRateLimit(socket.id)) {
        socket.emit('error', {
          type: 'rate_limit_exceeded',
          message: 'Too many messages',
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Validate message
      if (!validateWebSocketMessage(data)) {
        socket.emit('error', {
          type: 'invalid_message',
          message: 'Invalid message format',
          timestamp: new Date().toISOString()
        });
        return;
      }

      logger.info('Mensaje WebSocket recibido:', {
        socketId: socket.id,
        type: data.type,
        timestamp: new Date().toISOString()
      });

      // ✅ MEJORADO: Respuesta más estructurada
      const response = {
        type: 'echo',
        data: data,
        timestamp: new Date().toISOString(),
        clientId: generateClientId(),
        server: 'defibro-backend'
      };

      // Echo only back to the sender — never broadcast a client's message to
      // every connected socket (cross-client leakage / abuse vector, audit P1-3).
      socket.emit('message', response);
    } catch (error) {
      logger.error('Error procesando mensaje WebSocket:', error);
      
      // Enviar error de vuelta al cliente
      socket.emit('error', {
        type: 'error',
        message: 'Invalid message format',
        timestamp: new Date().toISOString()
      });
    }
  });

  // Manejar suscripciones a precios
  socket.on('subscribe_prices', (data) => {
    if (!checkRateLimit(socket.id)) {
      socket.emit('error', { type: 'rate_limit_exceeded', message: 'Too many subscription requests' });
      return;
    }

    logger.info('Cliente suscribiendo a precios:', { socketId: socket.id, data });
    socket.join('prices');
    socket.emit('subscription_confirmed', { type: 'prices', timestamp: new Date().toISOString() });
  });

  // Manejar suscripciones a instancias (datos de usuario → requiere auth)
  socket.on('subscribe_instances', (_data) => {
    if (!checkRateLimit(socket.id)) {
      socket.emit('error', { type: 'rate_limit_exceeded', message: 'Too many subscription requests' });
      return;
    }

    const userId = socket.data?.userId as string | undefined;
    if (!userId) {
      socket.emit('error', { type: 'auth_required', message: 'Authenticate the socket (emit "auth") before subscribing to instances' });
      return;
    }

    // User-scoped delivery uses the per-user room `user:<id>` joined at auth — no
    // shared room, so instance events never fan out across clients (audit P1-3).
    logger.info('Cliente suscribiendo a instancias:', { socketId: socket.id, userId });
    socket.emit('subscription_confirmed', { type: 'instances', timestamp: new Date().toISOString() });
  });

  // AI chat over WebSocket — real assistant, authenticated. No mock/echo path:
  // the socket must be authenticated (emit `auth` first) and the response comes
  // from the same guarded pipeline as POST /api/ai/chat.
  socket.on('ai_chat', async (data) => {
    if (!checkRateLimit(socket.id)) {
      socket.emit('error', { type: 'rate_limit_exceeded', message: 'Too many AI chat requests' });
      return;
    }

    const userId = socket.data?.userId as string | undefined;
    if (!userId) {
      socket.emit('error', {
        type: 'auth_required',
        message: 'Authenticate the socket (emit "auth" with your JWT) before using AI chat',
      });
      return;
    }

    // Validate AI chat message (mirror the HTTP route's 2000-char limit)
    if (!data || !data.content || typeof data.content !== 'string' || data.content.length > 2000) {
      socket.emit('error', { type: 'invalid_ai_message', message: 'Invalid AI chat message format' });
      return;
    }

    logger.info('Mensaje AI chat recibido:', { socketId: socket.id, userId, contentLength: data.content.length });
    try {
      const { generateAiChatResponse } = require('./routes/aiChat');
      const { response } = await generateAiChatResponse(userId, data.content);
      socket.emit('message', JSON.stringify({
        type: 'ai_response',
        messageId: data.messageId,
        content: response,
        timestamp: new Date().toISOString(),
      }));
    } catch (err) {
      logger.error('AI chat (ws) failed:', { socketId: socket.id, error: (err as Error)?.message });
      socket.emit('error', { type: 'ai_chat_failed', message: 'AI chat failed' });
    }
  });

  // Auth handshake: client sends JWT immediately after connecting.
  // On success the socket joins room `user:<userId>` for targeted delivery.
  socket.on('auth', async (token: string) => {
    try {
      if (typeof token !== 'string' || token.length > 2048) {
        socket.emit('auth:error', { reason: 'invalid_token' });
        return;
      }
      const { verifyToken } = require('./services/SiweAuth');
      const payload: { userId: string; sessionId: string; walletAddress: string } | null =
        await verifyToken(token).catch(() => null);
      if (payload?.userId) {
        socket.join(`user:${payload.userId}`);
        socket.data.userId = payload.userId;
        socket.emit('auth:ok', { userId: payload.userId });
        logger.info('WS auth OK', { socketId: socket.id, userId: payload.userId });
      } else {
        socket.emit('auth:error', { reason: 'invalid_token' });
      }
    } catch {
      socket.emit('auth:error', { reason: 'invalid_token' });
    }
  });

  socket.on('disconnect', (reason) => {
    logger.info('Conexión WebSocket cerrada', {
      socketId: socket.id,
      reason,
      timestamp: new Date().toISOString()
    });

    // Clean up rate limiting data
    socketRateLimits.delete(socket.id);
  });

  socket.on('error', (error) => {
    logger.error('Error en WebSocket:', error);
  });

  // ✅ MEJORADO: Mensaje de bienvenida más informativo
  socket.emit('message', JSON.stringify({
    type: 'welcome',
    message: 'Conectado a DeFibro WebSocket',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    features: ['Real-time prices', 'Portfolio updates', 'Strategy notifications']
  }));
});

// ✅ MEJORADO: Función para generar ID único del cliente
function generateClientId(): string {
  return Math.random().toString(36).substring(2, 15) +
         Math.random().toString(36).substring(2, 15);
}

// Redact obviously-sensitive fields before they reach logs (audit P1-7). Shallow
// pass over top-level keys: masks tokens/secrets/signatures/keys/KYC ids, truncates
// long strings, and collapses nested objects so request bodies can't leak values.
const SENSITIVE_LOG_KEY = /(token|secret|password|passwd|authorization|signature|api[_-]?key|private[_-]?key|mnemonic|seed|jwt|cookie|otp|pin|ssn|kyc)/i;
function redactForLog(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return `[array(${value.length})]`;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_LOG_KEY.test(k)) out[k] = '[redacted]';
    else if (typeof v === 'string') out[k] = v.length > 256 ? `${v.slice(0, 256)}…` : v;
    else if (v && typeof v === 'object') out[k] = '[object]';
    else out[k] = v;
  }
  return out;
}

// Real FTSO price broadcasts — push live Flare oracle prices to subscribed WebSocket clients every 30s.
// No mock data. If the oracle call fails the interval is skipped silently.
let _ftsoWsClient: import('./flare/ftso/FTSOClient').FTSOClient | null = null;
function getFtsoWsClient() {
  if (!_ftsoWsClient) {
    const { FTSOClient } = require('./flare/ftso/FTSOClient');
    _ftsoWsClient = new FTSOClient({
      network: 'flare',
      rpcUrl: process.env.FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc',
    });
  }
  return _ftsoWsClient;
}

const PRICE_WS_SYMBOLS = ['FLR', 'XRP', 'BTC', 'ETH', 'USDT', 'USDC'];
const marketUpdateInterval = setInterval(async () => {
  if (io.engine.clientsCount === 0) return;
  try {
    const client = getFtsoWsClient();
    const prices = await client.getCurrentPrices(PRICE_WS_SYMBOLS);
    for (const p of prices) {
      if (!p.priceUSD) continue;
      const priceUpdate = {
        type: 'price_update',
        symbol: p.symbol,
        price: parseFloat(p.priceUSD),
        source: 'ftso',
        isFresh: p.isFresh,
        timestamp: new Date().toISOString(),
      };
      io.to('prices').emit('message', JSON.stringify(priceUpdate));
      io.to('prices').emit('price_update', priceUpdate);
    }
    logger.debug('FTSO price update sent to clients', { activeClients: io.engine.clientsCount, symbols: PRICE_WS_SYMBOLS });
  } catch (err) {
    logger.warn('FTSO WebSocket price update failed', { err: (err as Error).message });
  }
}, 30000); // Every 30s — aligned with FTSO 90s cycle

// ✅ REPARADO: Middleware de manejo de errores mejorado
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Error no controlado:', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    body: redactForLog(req.body),
    query: redactForLog(req.query),
    ip: req.ip
  });

  // ✅ MEJORADO: Respuesta de error más detallada pero segura
  const errorResponse = {
    error: 'Error interno del servidor',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Algo salió mal',
    timestamp: new Date().toISOString(),
    requestId: generateClientId()
  };

  res.status(500).json(errorResponse);
});

// ✅ REPARADO: Ruta 404 mejorada
app.use('*', (req: Request, res: Response) => {
  logger.warn('Endpoint no encontrado', {
    url: req.originalUrl,
    method: req.method,
    ip: req.ip
  });

  res.status(404).json({
    error: 'Endpoint no encontrado',
    url: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString(),
    availableEndpoints: ['/health', '/api/status', '/api/auth', '/api/portfolio', '/api/strategies', '/api/defi']
  });
});

// ✅ REPARADO: Función de inicio del servidor mejorada
async function startServer() {
  try {
    console.log('[BOOT] startServer() called');

    // Invariant #1 — refuse to boot if a custodial EVM signing key is present.
    // Astryum NEVER signs/custodies; with no key reachable, even the deprecated
    // FlareFinanceConnector relic cannot sign. See config/bootGuards.ts.
    const { assertNoCustodialKeys, assertNotProductionDatabase } = require('./config/bootGuards');
    assertNoCustodialKeys();
    console.log('[BOOT] custodial-key guard passed (invariant #1)');

    // "Seguridad no ganada" — refuse to boot a DEV/LOCAL process against the PROD
    // database (a localhost + ALLOW_NO_AUTH backend was found on prod Supabase;
    // one careless write/seed/migration = real user data). Allowed only under
    // NODE_ENV=production (the genuine deploy) or CONFIRM_PROD_DB=1. See bootGuards.ts.
    assertNotProductionDatabase();
    console.log('[BOOT] prod-database guard passed');

    // Demo cap sanity (open MVP): if DEMO_MAX_XRP_PER_TX is at/below the direct-mint
    // fee floor (~0.3 XRP), every mint would fail computeNetMint — warn so the demo
    // isn't silently rejecting all transactions. Fail-closed default (1 XRP) needs no env.
    const { assertDemoCapSane } = require('./config/demoCap');
    assertDemoCapSane();
    console.log('[BOOT] demo-cap sanity checked');

    // Restore the executor's accrued daily fee spend from the DB so the budget born from
    // the 244-repay incident survives a redeploy (§1). Best-effort (no DB ⇒ fresh window).
    const { loadFeeLedger } = require('./services/flare/ExecutorFuelService');
    await loadFeeLedger();
    console.log('[BOOT] executor fee-ledger restored');

    const PORT = parseInt(process.env.PORT || '3001', 10);
    const HOST = process.env.HOST || '0.0.0.0';

    // Reconcile `chains` with CHAIN_REGISTRY. Rows referenced by FK (wallets,
    // positions, snapshots, intents) must exist or every write for that chain
    // dies on a foreign-key violation. Create-only — never clobbers curated rows.
    try {
      const { ensureChainsSeeded } = require('./database/ensureChainsSeeded');
      const { created, existing } = await ensureChainsSeeded();
      console.log(
        `[BOOT] chains reconciled — ${existing} present, ${created.length} created` +
          (created.length ? ` (${created.join(', ')})` : '')
      );
    } catch (err) {
      logger.error('[BOOT] chain reconcile failed (continuing):', (err as Error).message);
    }

    // V1.1: initialize the Flare RPC singleton before binding listen so the
    // ProviderHealthService and any chain-touching engine has a live provider
    // on first probe. Without this, flare-rpc reports "HTTP provider not
    // initialized" and every chain.* capability returns 503 until something
    // happens to call initialize() — which nothing does.
    try {
      const { getFlareProvider } = require('./services/FlareProvider');
      console.log('[BOOT] initializing FlareProvider...');
      await getFlareProvider().initialize();
      console.log('[BOOT] FlareProvider initialized');
    } catch (err) {
      logger.error('[BOOT] FlareProvider init failed (continuing):', (err as Error).message);
    }

    console.log('[BOOT] about to listen on', HOST + ':' + PORT);
    server.listen(PORT, HOST, () => {
      console.log('[BOOT] server.listen callback fired — accepting requests');
      logger.info(`🚀 Servidor DeFibro iniciado en http://${HOST}:${PORT}`);
      logger.info(`📊 Health check disponible en http://${HOST}:${PORT}/health`);
      logger.info(`🔌 WebSocket disponible en ws://${HOST}:${PORT}`);
      logger.info(`🌍 Entorno: ${process.env.NODE_ENV || 'development'}`);
    });

    // V1 Intent Engine: cron expirador (60s)
    try {
      const { IntentEngine } = require('./engines/intent/IntentEngine');
      const intentExpireTimer = setInterval(() => {
        IntentEngine.getInstance()
          .expireStaleIntents()
          .then((n: number) => {
            if (n > 0) logger.info(`[intents] expired ${n} stale intent(s)`);
          })
          .catch((err: Error) => logger.warn('[intents] expire failed:', err.message));
      }, 60_000);
      const stop = () => clearInterval(intentExpireTimer);
      process.on('SIGTERM', stop);
      process.on('SIGINT', stop);
    } catch (err) {
      logger.warn('IntentEngine cron not started:', err);
    }

    // V1.1 Control Plane: provider health probe (60s)
    try {
      const { providerHealthService } = require('./integrations/registry/ProviderHealthService');
      providerHealthService.start();
      const stopHealth = () => providerHealthService.stop();
      process.on('SIGTERM', stopHealth);
      process.on('SIGINT', stopHealth);
    } catch (err) {
      logger.warn('ProviderHealthService not started:', err);
    }

    // Vigía XRPL agentizado (Ola 1 economía agéntica): amendments gated, flags
    // de emisores, venues del sidechain, FAssets/FBTC — pasada diaria read-only,
    // push al operador solo cuando un gate se desbloquea. XRPL_WATCH_DISABLED=true apaga.
    try {
      const { xrplWatchScheduler } = require('./services/XrplWatchScheduler');
      xrplWatchScheduler.start();
      const stopXrplWatch = () => xrplWatchScheduler.stop();
      process.on('SIGTERM', stopXrplWatch);
      process.on('SIGINT', stopXrplWatch);
    } catch (err) {
      logger.warn('XrplWatchScheduler not started:', err);
    }

    // Keeper de escrows XRPL (Ola 3 economía agéntica — ejecutor permissionless):
    // dispara EscrowFinish/EscrowCancel vencidos de las cuentas vigiladas con la
    // cuenta PROPIA del keeper (jamás claves de usuario; ver frontera MiCA en el
    // header del servicio). Apagado salvo XRPL_KEEPER_ENABLED=true + seed + cuentas.
    try {
      const { xrplEscrowKeeper } = require('./services/XrplEscrowKeeper');
      xrplEscrowKeeper.start();
      const stopKeeper = () => xrplEscrowKeeper.stop();
      process.on('SIGTERM', stopKeeper);
      process.on('SIGINT', stopKeeper);
    } catch (err) {
      logger.warn('XrplEscrowKeeper not started:', err);
    }

    // V1.1 Activity sync: refresh recent activity for registered wallets (5 min)
    try {
      const { activityService } = require('./services/ActivityService');
      const { prisma } = require('./database/prismaClient');
      const activityTimer = setInterval(async () => {
        try {
          const wallets: { address: string }[] = await prisma.wallet.findMany({
            where: { chainId: 14 },
            select: { address: true },
            take: 50,
          });
          for (const w of wallets) {
            await activityService.refreshFromExplorer(w.address).catch(() => undefined);
          }
        } catch (err) {
          logger.warn('[activity] sync failed:', (err as Error).message);
        }
      }, 5 * 60_000);
      const stopActivity = () => clearInterval(activityTimer);
      process.on('SIGTERM', stopActivity);
      process.on('SIGINT', stopActivity);
    } catch (err) {
      logger.warn('ActivityService cron not started:', err);
    }

    // V1 Automation Engine: prepare-only worker tick (60s)
    try {
      const { AutomationEngine } = require('./engines/automation/AutomationEngine');
      const automationTimer = setInterval(() => {
        AutomationEngine.getInstance()
          .tick()
          .then((res: { ruleCount: number; firedCount: number }) => {
            if (res.firedCount > 0) {
              logger.info(`[automation] ${res.firedCount}/${res.ruleCount} rule(s) fired`);
            }
          })
          .catch((err: Error) => logger.warn('[automation] tick failed:', err.message));
      }, 60_000);
      const stopAuto = () => clearInterval(automationTimer);
      process.on('SIGTERM', stopAuto);
      process.on('SIGINT', stopAuto);
    } catch (err) {
      logger.warn('AutomationEngine cron not started:', err);
    }

    // Control Plane: TriggerRule evaluation (60s) — notifies only, never auto-executes
    try {
      const { intentTriggerService, triggerBus } = require('./services/IntentTriggerService');

      // Forward fired-rule events to the owner's WS room
      triggerBus.on('rule:fired', (payload: { userId: string; [key: string]: unknown }) => {
        io.to(`user:${payload.userId}`).emit('rule:fired', payload);
      });

      const triggerTimer = setInterval(async () => {
        try {
          const fired = await intentTriggerService.evaluateAll();
          if (fired.length > 0) {
            logger.info(`[triggers] ${fired.length} rule(s) fired notifications`);
          }
        } catch (err) {
          logger.warn('[triggers] evaluation failed:', (err as Error).message);
        }
      }, 60_000);
      const stopTriggers = () => clearInterval(triggerTimer);
      process.on('SIGTERM', stopTriggers);
      process.on('SIGINT', stopTriggers);
    } catch (err) {
      logger.warn('IntentTriggerService cron not started:', err);
    }

    // 0xFE executor — ejecuta los direct-mints que los usuarios YA firmaron en
    // Xaman (decisión fundador 2026-07-12). Cero discreción: el contrato solo
    // acepta los bytes exactos comprometidos por la firma (invariante #8);
    // la clave del executor paga attestation FDC + gas, jamás toca claves de
    // usuario (#1/#2). Doble flag (#10): FLARE_EXECUTOR_ENABLED + la PK.
    try {
      if (process.env.FLARE_EXECUTOR_ENABLED === 'true' && process.env.FLARE_EXECUTOR_PK) {
        const { directMintExecutorWatcher } = require('./services/flare/DirectMintExecutorService');
        directMintExecutorWatcher.start();
        const stopExecutor = () => directMintExecutorWatcher.stop();
        process.on('SIGTERM', stopExecutor);
        process.on('SIGINT', stopExecutor);
        logger.info('[0xFE-executor] watcher started — pending direct mints will execute automatically');
      } else {
        logger.warn(
          '[0xFE-executor] NOT started — set FLARE_EXECUTOR_ENABLED=true + FLARE_EXECUTOR_PK. ' +
            'Sin executor, cada Payment 0xFE firmado en Xaman queda aparcado en el Core Vault.',
        );
      }
    } catch (err) {
      logger.warn('DirectMintExecutorWatcher not started:', err);
    }

    // Control Plane: DefiLlama sync (startup + every 6h for pools, 24h for protocol contracts)
    try {
      const { defiLlamaProvider } = require('./integrations/providers/data/DefiLlamaProvider');

      const syncProtocols = async () => {
        try {
          const count = await defiLlamaProvider.syncProtocolRegistry();
          logger.info(`[defillama] synced ${count} protocol contracts`);
        } catch (err) {
          logger.warn('[defillama] protocol sync failed:', (err as Error).message);
        }
      };

      const syncPools = async () => {
        try {
          const count = await defiLlamaProvider.syncPoolRegistry();
          logger.info(`[defillama] synced ${count} yield pools`);
        } catch (err) {
          logger.warn('[defillama] pool sync failed:', (err as Error).message);
        }
      };

      // Run both immediately on startup (non-blocking)
      syncProtocols();
      syncPools();

      // Protocol contracts every 24h, pools every 6h
      const protocolTimer = setInterval(syncProtocols, 24 * 60 * 60_000);
      const poolTimer = setInterval(syncPools, 6 * 60 * 60_000);
      process.on('SIGTERM', () => { clearInterval(protocolTimer); clearInterval(poolTimer); });
      process.on('SIGINT', () => { clearInterval(protocolTimer); clearInterval(poolTimer); });
    } catch (err) {
      logger.warn('DefiLlamaProvider sync not started:', err);
    }

    // P-CANONICAL-BRIDGE — start in-memory DefiLlama poller + SSE bridge
    try {
      const { canonicalBridgeService } = require('./services/CanonicalBridgeService');
      canonicalBridgeService.start();
      const stopBridge = () => canonicalBridgeService.stop();
      process.on('SIGTERM', stopBridge);
      process.on('SIGINT', stopBridge);
    } catch (err) {
      logger.warn('CanonicalBridgeService failed to start:', err);
    }


  } catch (error) {
    logger.error('Error iniciando servidor:', error);
    process.exit(1);
  }
}

// ✅ REPARADO: Manejo de señales de cierre mejorado
async function gracefulShutdown(signal: string) {
  logger.info(`Recibida señal ${signal}, cerrando servidor...`);
  
  try {
    // Limpiar intervalo de actualizaciones
    clearInterval(marketUpdateInterval);
    
    // Cerrar conexiones Socket.IO
    io.close();

    // Cerrar servidor HTTP
    server.close(() => {
      logger.info('Servidor cerrado correctamente');
      process.exit(0);
    });
    
    // Timeout de emergencia
    setTimeout(() => {
      logger.error('Cierre forzado del servidor');
      process.exit(1);
    }, 10000);
    
  } catch (error) {
    logger.error('Error durante el cierre del servidor:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ✅ REPARADO: Manejo de errores no capturados mejorado
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // No salir del proceso inmediatamente, pero loggear el error
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  // Para excepciones no capturadas, es mejor salir del proceso
  gracefulShutdown('uncaughtException');
});

// ✅ MEJORADO: Iniciar servidor solo si este archivo es ejecutado directamente
if (require.main === module) {
  startServer().catch((error) => {
    logger.error('Error fatal al iniciar servidor:', error);
    process.exit(1);
  });
}

export { app, server, io, logger };
