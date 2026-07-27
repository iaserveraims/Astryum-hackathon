import { Request, Response, NextFunction } from 'express';

const FLARE_CHAIN_ID = 14;

/**
 * V1 FINAL chain guard — rejects any request body where `chainId` is present
 * and ≠ Flare Mainnet (14). Mounted on V1 routes that mutate state via tx
 * (intents, execution, simulate). Does NOT touch SIWE auth nor read-only
 * endpoints (portfolio/positions/risk read explicit chainId in query, not body).
 *
 * Behaviour:
 *  - body.chainId === undefined  → pass (route-level zod will set default 14)
 *  - body.chainId === 14         → pass
 *  - body.chainId !== 14         → 400 unsupported_chain
 *
 * V1 explicitly excludes Songbird, Coston2, Ethereum, Solana, XRPL, etc.
 */
export function requireFlareMainnet(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const chainId = (req.body as Record<string, unknown> | undefined)?.chainId;
  if (chainId === undefined || chainId === null) {
    return next();
  }
  if (Number(chainId) === FLARE_CHAIN_ID) {
    return next();
  }
  res.status(400).json({
    error: 'unsupported_chain',
    expected: FLARE_CHAIN_ID,
    received: Number(chainId),
    hint: 'Astryum V1 FINAL operates only on Flare Mainnet (chainId 14).',
  });
}

export const FLARE_MAINNET_CHAIN_ID = FLARE_CHAIN_ID;
