// src/middleware/validation.ts
import { Request, Response, NextFunction } from 'express';
// Lightweight Zod type guard without importing zod types directly
type MaybeZodSchema = { safeParse?: (data: any) => { success: boolean; data?: any; error?: any } } | undefined;
import Joi from 'joi';
import { clientIp } from './clientIp';

// Validation schemas
export const workspaceSchema = Joi.object({
  name: Joi.string().required().max(100),
  type: Joi.string().valid('lending', 'yield', 'risk', 'custom').required(),
  description: Joi.string().max(500),
  settings: Joi.object({
    autoProtection: Joi.boolean(),
    gasOptimization: Joi.boolean(),
    multiProtocolSync: Joi.boolean(),
    riskThresholds: Joi.object({
      healthFactorWarning: Joi.number().min(1),
      healthFactorCritical: Joi.number().min(1),
      ltvWarning: Joi.number().min(0).max(100),
      ltvCritical: Joi.number().min(0).max(100)
    })
  })
});

export const instanceSchema = Joi.object({
  workspaceId: Joi.string().required(),
  name: Joi.string().required().max(100),
  protocol: Joi.string().valid('aave', 'compound', 'moai finance', 'uniswap', 'curve', 'yearn', 'other').required(),
  network: Joi.string().valid('ethereum', 'polygon', 'arbitrum', 'optimism', 'xrpl', 'bsc', 'avalanche').required(),
  address: Joi.string().required(),
  collateral: Joi.object({
    amount: Joi.number().min(0).required(),
    symbol: Joi.string().required(),
    usdValue: Joi.number().min(0).required(),
    price: Joi.number().min(0).required()
  }).required(),
  debt: Joi.object({
    amount: Joi.number().min(0).required(),
    symbol: Joi.string().required(),
    usdValue: Joi.number().min(0).required()
  }).required(),
  healthFactor: Joi.number().min(0).required(),
  ltv: Joi.number().min(0).max(100).required(),
  liquidationThreshold: Joi.number().min(0).max(100).required()
});

export const userSchema = Joi.object({
  address: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
  email: Joi.string().email().optional(),
  username: Joi.string().max(50).optional(),
  preferences: Joi.object({
    theme: Joi.string().valid('light', 'dark'),
    expertMode: Joi.boolean(),
    notifications: Joi.object({
      email: Joi.boolean(),
      discord: Joi.boolean(),
      telegram: Joi.boolean(),
      push: Joi.boolean()
    }),
    riskTolerance: Joi.string().valid('conservative', 'moderate', 'aggressive'),
    defaultSlippage: Joi.number().min(0.1).max(10),
    autoExecute: Joi.boolean(),
    currency: Joi.string().valid('USD', 'EUR', 'GBP')
  })
});

type SchemaKey = 'workspace' | 'instance' | 'user';

const schemas: Record<SchemaKey, Joi.ObjectSchema> = {
  workspace: workspaceSchema,
  instance: instanceSchema,
  user: userSchema,
};

export function validateRequest(arg: SchemaKey | MaybeZodSchema = 'workspace') {
  // Zod schema path (flows.ts passes a zod schema)
  if (arg && typeof (arg as any).safeParse === 'function') {
    const zodSchema = arg as any;
    return (req: Request, res: Response, next: NextFunction) => {
      req.body = sanitizeInput(req.body);
      const result = zodSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: result.error?.errors?.map((e: any) => ({ message: e.message, path: e.path })) || []
        });
      }
      req.body = result.data;
      next();
    };
  }

  // Joi schema path (default)
  const type = (arg as SchemaKey) || 'workspace';
  const schema = schemas[type];
  return (req: Request, res: Response, next: NextFunction) => {
    req.body = sanitizeInput(req.body);
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true
    });
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: error.details.map(d => ({ message: d.message, path: d.path }))
      });
    }
    req.body = value;
    next();
  };
}

// Input sanitization function to prevent XSS and injection attacks
function sanitizeInput(obj: any): any {
  if (typeof obj === 'string') {
    return obj
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
      .replace(/javascript:/gi, '') // Remove javascript: URLs
      .replace(/\son\w+\s*=\s*['""][^'"'"]*['"'"]/gi, '') // Remove on* event handlers
      .replace(/data:\s*text\/html/gi, 'data:text/plain') // Prevent HTML data URLs
      .substring(0, 10000) // Limit length to prevent DoS
      .trim();
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeInput);
  }

  if (obj && typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      // Sanitize key names and values
      const sanitizedKey = typeof key === 'string' ? sanitizeInput(key) : key;
      sanitized[sanitizedKey] = sanitizeInput(value);
    }
    return sanitized;
  }

  return obj;
}

// Rate limiting for security
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
// Full-map sweep at most once a minute — the per-bucket expiry check below
// still resets each caller's own window on read.
const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanupAt = 0;

export const rateLimit = (maxRequests: number = 100, windowMs: number = 15 * 60 * 1000) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Health check is a lightweight probe — never consume quota
    if (req.path === '/health') return next();

    // clientIp(): the app does not trust proxy, so behind Railway req.ip is the
    // proxy address — one shared bucket for every visitor (same fix as the
    // waitlist/auth/admin limiters).
    const clientIP = clientIp(req);
    const currentTime = Date.now();

    // Clean expired entries (bounded: one pass per CLEANUP_INTERVAL_MS)
    if (currentTime - lastCleanupAt >= CLEANUP_INTERVAL_MS) {
      lastCleanupAt = currentTime;
      for (const [ip, data] of rateLimitMap.entries()) {
        if (currentTime > data.resetTime) {
          rateLimitMap.delete(ip);
        }
      }
    }

    // Get or create rate limit data for this IP
    let rateLimitData = rateLimitMap.get(clientIP);
    if (!rateLimitData || currentTime > rateLimitData.resetTime) {
      rateLimitData = {
        count: 0,
        resetTime: currentTime + windowMs
      };
      rateLimitMap.set(clientIP, rateLimitData);
    }

    rateLimitData.count++;

    if (rateLimitData.count > maxRequests) {
      return res.status(429).json({
        error: 'Too many requests',
        message: 'Rate limit exceeded',
        retryAfter: Math.ceil((rateLimitData.resetTime - currentTime) / 1000)
      });
    }

    // Add rate limit headers
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - rateLimitData.count));
    res.setHeader('X-RateLimit-Reset', new Date(rateLimitData.resetTime).toISOString());

    next();
  };
};
