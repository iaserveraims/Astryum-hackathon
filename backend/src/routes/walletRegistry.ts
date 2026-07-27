/**
 * Wallet Registry Routes for Astryum Private Beta
 *
 * API endpoints for managing registered wallets.
 * These endpoints are admin-only in the private beta.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getWalletRegistry, RegisteredWallet } from '../services/WalletRegistry';
import { isWalletAllowed } from '../config/allowlist.config';
import { prisma } from '../database/prismaClient';
import { ecosystemForCaip2, ecosystemFromNetworkLabel } from '../services/walletRouting/ecosystem';
import { requireSiweAuth } from '../middleware/requireSiweAuth';
import {
  turnkeyEmbeddedService,
  TurnkeyNotConfiguredError,
  type PasskeyAttestation,
} from '../services/wallet/TurnkeyEmbeddedService';

const router = Router();

// ─── D1 · Embedded wallet "create" gate (Turnkey) ────────────────────────────
//
// GET  /api/wallets/embedded/status  → whether the create gate is available
// POST /api/wallets/embedded/create  → create a user-controlled embedded wallet
//
// The user's passkey (registered client-side) is the sub-org's ROOT authenticator
// → exclusive user control + exportable keys. Astryum never sees the private key.
// Defined BEFORE GET /:address so "embedded" is not parsed as an address.

// Hackathon-demo switch: the whole "create" gate (front + back) stays off unless
// EMBEDDED_WALLET_ENABLED=true. The Turnkey code path is preserved intact behind it.
const embeddedWalletEnabled = () => process.env.EMBEDDED_WALLET_ENABLED === 'true';

router.get('/embedded/status', (_req: Request, res: Response) => {
  if (!embeddedWalletEnabled()) {
    return res.json({
      available: false,
      provider: 'turnkey',
      custodyModel: 'user_controlled',
      exportable: true,
      reason: 'DISABLED_FOR_DEMO',
    });
  }
  const reason = turnkeyEmbeddedService.unavailableReason();
  return res.json({
    available: reason === null,
    provider: 'turnkey',
    custodyModel: 'user_controlled',
    exportable: true,
    reason: reason ?? undefined,
  });
});

router.post('/embedded/create', requireSiweAuth, async (req: Request, res: Response) => {
  if (!embeddedWalletEnabled()) {
    return res.status(503).json({ success: false, error: 'EMBEDDED_WALLET_DISABLED', detail: 'Embedded wallet creation is disabled for the demo.' });
  }
  const userId = req.siwe!.userId;
  const passkey = req.body?.passkey as PasskeyAttestation | undefined;
  if (!passkey) {
    return res.status(400).json({ success: false, error: 'MISSING_PASSKEY', detail: 'passkey attestation required' });
  }

  try {
    const { subOrgId, address } = await turnkeyEmbeddedService.createWallet(userId, passkey);

    // Persist into the unified wallets table (same pattern as /connect). The
    // embedded metadata lives in `permissions` so no schema migration is needed.
    const wallet = await prisma.$transaction(async (tx) => {
      // Same gate as /connect: mirror the one-primary partial index, never the
      // purpose-based count (see the comment there).
      const isFirstEvm =
        (await tx.wallet.count({
          where: { userId, ecosystem: 'evm', isPrimary: true },
        })) === 0;

      return tx.wallet.create({
        data: {
          userId,
          walletType: 'turnkey_embedded',
          address,
          network: 'ethereum',
          chainId: 1,
          caip2: 'eip155:1',
          ecosystem: 'evm',
          nickname: 'Embedded wallet',
          isConnected: true,
          isPrimary: isFirstEvm,
          purpose: 'sign',
          permissions: {
            embedded: {
              provider: 'turnkey',
              subOrgId,
              custodyModel: 'user_controlled',
              exportable: true,
            },
          },
        },
      });
    });

    return res.status(201).json({ success: true, data: { wallet, subOrgId } });
  } catch (err) {
    if (err instanceof TurnkeyNotConfiguredError) {
      return res.status(503).json({ success: false, error: 'PARTNER_NOT_CONFIGURED', detail: err.message });
    }
    if ((err as Error).message === 'PASSKEY_ATTESTATION_REQUIRED') {
      return res.status(400).json({ success: false, error: 'INVALID_PASSKEY' });
    }
    console.error('[wallets/embedded/create] failed:', err);
    return res.status(500).json({ success: false, error: 'CREATE_FAILED', detail: (err as Error).message });
  }
});

// ─── Block G (2026-06-02) — wallet connect / destination_only flows ─────────
//
// POST /api/wallets/connect
//   Persists a freshly-connected (or manually-pasted) wallet into the unified
//   `wallets` table with the right ecosystem + purpose + auto-isPrimary.
//
// Behaviors:
//   - `ecosystem` auto-derives from caip2 or network if not provided
//   - `isPrimary` defaults to true when the user has NO other wallets in this
//     ecosystem yet (atomic check inside a transaction)
//   - `purpose` defaults to 'sign'; 'destination_only' supported for the
//     manual-paste flow described in the Block G design (no signing capable)
//   - When a Wallet already exists for (userId, address, network), the
//     endpoint UPGRADES its purpose:
//       'watch' + reconnect with sign capability → 'both'
//       'destination_only' + later connect with signing → 'both'

const ConnectWalletSchema = z.object({
  address:     z.string().min(1),
  walletType:  z.string().min(1),
  network:     z.string().min(1),
  chainId:     z.number().int().optional(),
  caip2:       z.string().optional(),
  ecosystem:   z.enum(['evm', 'solana', 'xrpl', 'aptos', 'cosmos', 'stellar', 'algorand', 'bitcoin']).optional(),
  purpose:     z.enum(['sign', 'watch', 'both', 'destination_only']).default('sign'),
  nickname:    z.string().optional(),
});

router.post('/connect', requireSiweAuth, async (req: Request, res: Response) => {
  const userId = req.siwe?.userId;
  if (!userId) {
    return res.status(401).json({ success: false, error: 'UNAUTHENTICATED' });
  }
  const parsed = ConnectWalletSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'INVALID_BODY', issues: parsed.error.issues });
  }
  const d = parsed.data;

  // Early-access deposit ceiling (founder 2026-07-19): with TRIAL_WALLET_CAP_USD
  // set, a wallet cannot be connected if the user's connected wallets plus this
  // one would hold more than the cap. Dynamic import so the engine's module
  // graph loads only when the trial flag is actually on.
  if ((process.env.TRIAL_WALLET_CAP_USD ?? '').trim()) {
    const { checkTrialCap } = await import('../services/TrialCapService');
    const verdict = await checkTrialCap(userId, d.address);
    if (verdict.ok !== true) {
      if (verdict.code === 'TRIAL_CAP_EXCEEDED') {
        return res.status(403).json({
          success: false,
          error: 'TRIAL_CAP_EXCEEDED',
          detail: `Early access is capped at $${verdict.capUsd} across connected wallets; adding this wallet reaches ~$${Math.ceil(verdict.totalUsd)}.`,
          capUsd: verdict.capUsd,
          totalUsd: verdict.totalUsd,
        });
      }
      // Fail-closed: a ceiling that lets wallets through when pricing is down
      // is not a ceiling. Retryable.
      return res.status(503).json({
        success: false,
        error: 'TRIAL_VALUATION_UNAVAILABLE',
        detail: 'Could not verify the wallet value for the early-access cap. Try again in a moment.',
      });
    }
  }

  const derivedEcosystem =
    d.ecosystem ??
    ecosystemForCaip2(d.caip2) ??
    ecosystemFromNetworkLabel(d.network) ??
    'evm';

  // The whole connect runs as one transaction. `forceNonPrimary` is the retry
  // path for the rare concurrent race on the one-primary-per-ecosystem index.
  const runConnect = (forceNonPrimary: boolean) =>
    prisma.$transaction(async (tx) => {
      // Look up existing row by the unique tuple (userId, address, network).
      const existing = await tx.wallet.findUnique({
        where: { userId_address_network: { userId, address: d.address, network: d.network } },
      });

      // A signature-proven read_and_receive binding (e.g. created at SIWE login,
      // or when the user connects an extra wallet and signs) means this address
      // is tx-capable — so it must be persisted as sign-capable ('both') even if
      // the client only sends purpose 'watch'. The per-tx confirmation in the
      // user's wallet is still the execution gate.
      const txBinding = await tx.walletBinding.findFirst({
        where: { userId, address: d.address, isActive: true, mode: 'read_and_receive' },
        select: { id: true },
      });
      const incomingCanSign = d.purpose === 'sign' || d.purpose === 'both' || !!txBinding;

      if (existing) {
        // Upgrade purpose if applicable. Rules:
        //   - destination_only + new connect with sign capability → 'both'
        //   - watch + reconnect with sign capability               → 'both'
        //   - everything else → keep existing purpose
        let upgradedPurpose = existing.purpose;
        if (incomingCanSign && (existing.purpose === 'destination_only' || existing.purpose === 'watch')) {
          upgradedPurpose = 'both';
        }
        const updated = await tx.wallet.update({
          where: { id: existing.id },
          data: {
            walletType: d.walletType,
            chainId: d.chainId ?? existing.chainId,
            caip2: d.caip2 ?? existing.caip2,
            ecosystem: derivedEcosystem,
            nickname: d.nickname ?? existing.nickname,
            isConnected: true,
            lastActivity: new Date(),
            purpose: upgradedPurpose,
          },
        });
        return { wallet: updated, upgraded: existing.purpose !== upgradedPurpose };
      }

      // A watch/destination connect that already has a tx-binding is stored as
      // 'both' so the execution router (which filters purpose IN sign|both) sees it.
      const effectivePurpose: typeof d.purpose =
        incomingCanSign && (d.purpose === 'watch' || d.purpose === 'destination_only')
          ? 'both'
          : d.purpose;

      // Auto-nickname for tracked wallets: "<Chain> <n>" per user+rail
      // (XRPL 1, XRPL 2… / Flare 1, Flare 2…). Applies only when the client
      // sent no nickname; n = highest existing suffix + 1, so deleting a
      // middle wallet never produces a duplicate name.
      let autoNickname: string | null = null;
      if (!d.nickname) {
        const autoLabel =
          derivedEcosystem === 'xrpl'
            ? 'XRPL'
            : derivedEcosystem === 'evm' && (d.chainId === 14 || d.chainId == null)
              ? 'Flare'
              : null;
        if (autoLabel) {
          const siblings = await tx.wallet.findMany({
            where: { userId, ecosystem: derivedEcosystem },
            select: { nickname: true },
          });
          const re = new RegExp(`^${autoLabel} (\\d+)$`);
          const maxN = siblings.reduce((m: number, w: { nickname: string | null }) => {
            const match = w.nickname?.match(re);
            return match ? Math.max(m, Number(match[1])) : m;
          }, 0);
          autoNickname = `${autoLabel} ${maxN + 1}`;
        }
      }

      // Auto-isPrimary gate. It MUST mirror the DB invariant exactly — the
      // partial unique index allows ONE isPrimary=true per (userId, ecosystem).
      // Counting sign/both wallets here (the old gate) 500'd when a user added
      // a second watch-only wallet of the same ecosystem: neither counted, so
      // BOTH got isPrimary=true and the index rejected the second insert.
      const isFirstInEcosystem =
        !forceNonPrimary &&
        effectivePurpose !== 'destination_only' &&
        (await tx.wallet.count({
          where: { userId, ecosystem: derivedEcosystem, isPrimary: true },
        })) === 0;

      const created = await tx.wallet.create({
        data: {
          userId,
          walletType: d.walletType,
          address: d.address,
          network: d.network,
          chainId: d.chainId ?? null,
          caip2: d.caip2 ?? null,
          nickname: d.nickname ?? autoNickname,
          isConnected: true,
          permissions: {},
          ecosystem: derivedEcosystem,
          isPrimary: isFirstInEcosystem,
          purpose: effectivePurpose,
        },
      });
      return { wallet: created, upgraded: false };
    });

  try {
    let result;
    try {
      result = await runConnect(false);
    } catch (err) {
      // Concurrent race on the one-primary-per-ecosystem partial index: another
      // insert won primary between our count and create. Retry as non-primary.
      if ((err as { code?: string }).code === 'P2002') {
        result = await runConnect(true);
      } else {
        throw err;
      }
    }

    return res.json({
      success: true,
      data: {
        wallet: result.wallet,
        ecosystem: derivedEcosystem,
        purposeUpgraded: result.upgraded,
      },
    });
  } catch (err) {
    console.error('[wallets/connect] failed:', err);
    return res.status(500).json({ success: false, error: 'CONNECT_FAILED', detail: (err as Error).message });
  }
});

// ─── GET /api/wallets/mine ──────────────────────────────────────────────────
//
// List the AUTHENTICATED user's wallets from the unified `wallets` table, joined
// with their active tx-bindings. This is the source of truth for the Wallets tab:
//
//   - `wallets` table → the LIST (every connected/watched/pasted wallet)
//   - `wallet_bindings` table → the tx PROOF (mode read_and_receive)
//
// Each returned wallet is annotated with `txAuthorized` so the frontend can show
// "Read-only" vs "Tx enabled" without a second round-trip. A wallet is tx-enabled
// only when it has an active read_and_receive binding (signature-proven) OR its
// purpose was already upgraded to sign/both.
//
// MUST be defined BEFORE GET /:address so "mine" is not treated as an address.
router.get('/mine', requireSiweAuth, async (req: Request, res: Response) => {
  const userId = req.siwe!.userId;
  try {
    const [wallets, bindings] = await Promise.all([
      prisma.wallet.findMany({
        where: { userId },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      }),
      prisma.walletBinding.findMany({
        where: { userId, isActive: true },
        select: { id: true, address: true, chainType: true, mode: true },
      }),
    ]);

    const key = (addr: string, eco: string) => `${addr.toLowerCase()}:${eco}`;
    const bindMap = new Map<string, { id: string; mode: string }>();
    for (const b of bindings) {
      // chainType ('evm'|'solana'|'xrpl'|'bitcoin') aligns with ecosystem for our
      // current EVM-first flow; bitcoin has no Wallet rows yet.
      bindMap.set(key(b.address, b.chainType), { id: b.id, mode: b.mode });
    }

    const data = wallets.map((w) => {
      const bind = bindMap.get(key(w.address, w.ecosystem));
      const txAuthorized =
        bind?.mode === 'read_and_receive' || w.purpose === 'sign' || w.purpose === 'both';
      return {
        ...w,
        bindingId: bind?.id ?? null,
        bindingMode: bind?.mode ?? null,
        txAuthorized,
        // Counts toward dashboard monetary totals unless explicitly excluded.
        color:
          ((w.permissions as Record<string, unknown> | null)?.color as string | null | undefined) ?? null,
        icon:
          ((w.permissions as Record<string, unknown> | null)?.icon as string | null | undefined) ?? null,
        includeInPortfolio:
          ((w.permissions as Record<string, unknown> | null)?.includeInPortfolio as
            | boolean
            | undefined) !== false,
      };
    });

    return res.json({ success: true, data: { wallets: data, total: data.length } });
  } catch (err) {
    console.error('[wallets/mine] failed:', err);
    return res.status(500).json({ success: false, error: 'LIST_FAILED', detail: (err as Error).message });
  }
});

// ─── DELETE /api/wallets/mine/:id ───────────────────────────────────────────
//
// Remove one of the authenticated user's wallets from their list. Tries a hard
// delete; if FK relations (positions, intents, …) block it, falls back to a soft
// disconnect so the row drops out of the active list without violating
// constraints. MUST precede DELETE /:address.
router.delete('/mine/:id', requireSiweAuth, async (req: Request, res: Response) => {
  const userId = req.siwe!.userId;
  const existing = await prisma.wallet.findFirst({
    where: { id: req.params.id, userId },
    select: { id: true, address: true, ecosystem: true },
  });
  if (!existing) {
    return res.status(404).json({ success: false, error: 'WALLET_NOT_FOUND' });
  }

  try {
    await prisma.wallet.delete({ where: { id: existing.id } });
  } catch {
    // FK relations exist — soft-remove instead so the user still gets it off the
    // list. purpose='watch' demotes it from any tx capability too.
    await prisma.wallet.update({
      where: { id: existing.id },
      data: { isConnected: false, isPrimary: false, purpose: 'watch' },
    });
  }

  // Also deactivate any tx-binding for this address so it can't authorize later.
  await prisma.walletBinding.updateMany({
    where: { userId, address: existing.address.toLowerCase(), isActive: true },
    data: { isActive: false },
  });

  return res.json({ success: true });
});

// ─── PATCH /api/wallets/mine/:id ────────────────────────────────────────────
//
// Edit one of the authenticated user's wallets. Currently supports:
//   - `nickname`  → rename (empty string / null clears it)
//   - `isPrimary` → make this the primary wallet for its ecosystem. A partial
//                   unique index allows exactly one primary per (userId,
//                   ecosystem), so we demote the previous primary in the same
//                   transaction. Only sign-capable wallets may be primary.
// MUST precede PATCH /:address so "mine" is not treated as an address.
const UpdateWalletSchema = z.object({
  nickname: z.string().max(64).nullable().optional(),
  isPrimary: z.literal(true).optional(),
  /** Whether this wallet counts toward the dashboard's monetary totals.
   *  Persisted inside `permissions` JSON (no schema migration); default true. */
  includeInPortfolio: z.boolean().optional(),
  /** Personal colour tag (hex) shown across Summary/Portfolio — identity, not
   *  data. Persisted inside `permissions` JSON; null clears it. */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  /** Personal glyph tag (slug, e.g. 'comet', 'saturn') shown across
   *  Summary/Portfolio next to the colour — identity, not data. Same storage
   *  as `color`: persisted inside `permissions` JSON; null clears it. */
  icon: z.string().regex(/^[a-z-]{1,24}$/).nullable().optional(),
});

router.patch('/mine/:id', requireSiweAuth, async (req: Request, res: Response) => {
  const userId = req.siwe!.userId;
  const parsed = UpdateWalletSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'INVALID_BODY', issues: parsed.error.issues });
  }
  const { nickname, isPrimary, includeInPortfolio, color, icon } = parsed.data;

  const existing = await prisma.wallet.findFirst({
    where: { id: req.params.id, userId },
    select: { id: true, ecosystem: true, purpose: true, permissions: true },
  });
  if (!existing) {
    return res.status(404).json({ success: false, error: 'WALLET_NOT_FOUND' });
  }

  if (isPrimary && existing.purpose !== 'sign' && existing.purpose !== 'both') {
    return res.status(409).json({
      success: false,
      error: 'NOT_TX_CAPABLE',
      detail: 'Only a tx-enabled wallet can be set as primary. Enable transactions first.',
    });
  }

  try {
    const wallet = await prisma.$transaction(async (tx) => {
      if (isPrimary) {
        // Demote any current primary in the same ecosystem before promoting.
        await tx.wallet.updateMany({
          where: { userId, ecosystem: existing.ecosystem, isPrimary: true, id: { not: existing.id } },
          data: { isPrimary: false },
        });
      }
      return tx.wallet.update({
        where: { id: existing.id },
        data: {
          ...(nickname !== undefined ? { nickname: nickname?.trim() || null } : {}),
          ...(isPrimary ? { isPrimary: true } : {}),
          // Merged into the permissions JSON so no schema migration is needed.
          ...(includeInPortfolio !== undefined || color !== undefined || icon !== undefined
            ? {
                permissions: {
                  ...((existing.permissions as Record<string, unknown> | null) ?? {}),
                  ...(includeInPortfolio !== undefined ? { includeInPortfolio } : {}),
                  ...(color !== undefined ? { color } : {}),
                  ...(icon !== undefined ? { icon } : {}),
                },
              }
            : {}),
        },
      });
    });
    return res.json({ success: true, data: { wallet } });
  } catch (err) {
    console.error('[wallets/mine PATCH] failed:', err);
    return res.status(500).json({ success: false, error: 'UPDATE_FAILED', detail: (err as Error).message });
  }
});

/**
 * GET /api/wallets
 *
 * List all registered wallets
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const registry = getWalletRegistry();
    const wallets = registry.getAll();

    // Option to filter by active status
    const activeOnly = req.query.active === 'true';

    const result = activeOnly
      ? wallets.filter(w => w.isActive)
      : wallets;

    res.json({
      success: true,
      data: {
        wallets: result,
        total: result.length,
        activeCount: wallets.filter(w => w.isActive).length,
      },
    });
  } catch (error) {
    console.error('[WalletRegistry API] Error listing wallets:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list wallets',
    });
  }
});

/**
 * GET /api/wallets/check/:address
 *
 * Check if an address is registered and/or in allowlist
 * NOTE: This route MUST be defined BEFORE /:address to avoid shadowing
 */
router.get('/check/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const registry = getWalletRegistry();

    res.json({
      success: true,
      data: {
        address,
        isRegistered: registry.isRegistered(address),
        isInAllowlist: isWalletAllowed(address),
        wallet: registry.get(address) || null,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to check wallet',
    });
  }
});

/**
 * GET /api/wallets/:address
 *
 * Get a specific wallet
 */
router.get('/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const registry = getWalletRegistry();
    const wallet = registry.get(address);

    if (!wallet) {
      res.status(404).json({
        success: false,
        error: 'Wallet not found',
        message: `Wallet ${address} is not registered`,
      });
      return;
    }

    res.json({
      success: true,
      data: wallet,
    });
  } catch (error) {
    console.error('[WalletRegistry API] Error getting wallet:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get wallet',
    });
  }
});

/**
 * POST /api/wallets
 *
 * Register a new wallet
 *
 * Body:
 * - address: string (required)
 * - label: string (optional)
 * - addToAllowlist: boolean (optional, default false)
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { address, label, addToAllowlist } = req.body;

    if (!address) {
      res.status(400).json({
        success: false,
        error: 'Address required',
        message: 'Please provide a wallet address to register',
      });
      return;
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      res.status(400).json({
        success: false,
        error: 'Invalid address format',
        message: 'Address must be a valid Ethereum-style address (0x...)',
      });
      return;
    }

    const registry = getWalletRegistry();

    // Check if already registered
    if (registry.isRegistered(address)) {
      res.status(409).json({
        success: false,
        error: 'Already registered',
        message: `Wallet ${address} is already registered`,
        data: registry.get(address),
      });
      return;
    }

    // Check allowlist (unless adding to it)
    if (!addToAllowlist && !isWalletAllowed(address)) {
      res.status(403).json({
        success: false,
        error: 'Not in allowlist',
        message: `Wallet ${address} is not in the allowlist. ` +
                 `Add it to allowlist.config.ts or set addToAllowlist=true.`,
      });
      return;
    }

    const wallet = registry.register(address, label, addToAllowlist);

    console.log(`[WalletRegistry API] Registered wallet: ${address}`);

    res.status(201).json({
      success: true,
      message: 'Wallet registered successfully',
      data: wallet,
    });
  } catch (error: any) {
    console.error('[WalletRegistry API] Error registering wallet:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to register wallet',
      message: error.message,
    });
  }
});

/**
 * PATCH /api/wallets/:address
 *
 * Update a registered wallet
 *
 * Body:
 * - label: string (optional)
 * - isActive: boolean (optional)
 */
router.patch('/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const { label, isActive } = req.body;

    const registry = getWalletRegistry();

    if (!registry.isRegistered(address)) {
      res.status(404).json({
        success: false,
        error: 'Wallet not found',
        message: `Wallet ${address} is not registered`,
      });
      return;
    }

    // Update label if provided
    if (label !== undefined) {
      registry.updateLabel(address, label);
    }

    // Update active status if provided
    if (isActive !== undefined) {
      registry.setActive(address, isActive);
    }

    const updated = registry.get(address);

    res.json({
      success: true,
      message: 'Wallet updated successfully',
      data: updated,
    });
  } catch (error: any) {
    console.error('[WalletRegistry API] Error updating wallet:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update wallet',
      message: error.message,
    });
  }
});

/**
 * DELETE /api/wallets/:address
 *
 * Unregister a wallet
 */
router.delete('/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const registry = getWalletRegistry();

    if (!registry.isRegistered(address)) {
      res.status(404).json({
        success: false,
        error: 'Wallet not found',
        message: `Wallet ${address} is not registered`,
      });
      return;
    }

    registry.unregister(address);

    console.log(`[WalletRegistry API] Unregistered wallet: ${address}`);

    res.json({
      success: true,
      message: 'Wallet unregistered successfully',
    });
  } catch (error: any) {
    console.error('[WalletRegistry API] Error unregistering wallet:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to unregister wallet',
      message: error.message,
    });
  }
});

/**
 * POST /api/wallets/:address/activate
 *
 * Activate monitoring for a wallet
 */
router.post('/:address/activate', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const registry = getWalletRegistry();

    if (!registry.isRegistered(address)) {
      res.status(404).json({
        success: false,
        error: 'Wallet not found',
      });
      return;
    }

    registry.setActive(address, true);

    res.json({
      success: true,
      message: 'Wallet monitoring activated',
      data: registry.get(address),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to activate wallet',
    });
  }
});

/**
 * POST /api/wallets/:address/deactivate
 *
 * Deactivate monitoring for a wallet
 */
router.post('/:address/deactivate', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const registry = getWalletRegistry();

    if (!registry.isRegistered(address)) {
      res.status(404).json({
        success: false,
        error: 'Wallet not found',
      });
      return;
    }

    registry.setActive(address, false);

    res.json({
      success: true,
      message: 'Wallet monitoring deactivated',
      data: registry.get(address),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to deactivate wallet',
    });
  }
});

export default router;
