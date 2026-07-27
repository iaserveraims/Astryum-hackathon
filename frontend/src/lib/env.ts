// src/lib/env.ts
// Single source of truth for environment-derived URLs (audit P1-9).
// Build-time validation: production builds must NOT fall back to localhost.

function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

function resolveUrl(name: string, raw: string | undefined, devDefault: string): string {
  const v = raw?.trim();
  if (v) {
    if (isProd() && /localhost|127\.0\.0\.1/.test(v)) {
      throw new Error(`[env] ${name} points to localhost in a production build — set a real URL.`);
    }
    return v;
  }
  if (isProd()) {
    throw new Error(`[env] ${name} is required in production builds (no localhost fallback).`);
  }
  return devDefault;
}

const API_BASE = resolveUrl(
  'NEXT_PUBLIC_API_URL',
  process.env.NEXT_PUBLIC_API_URL,
  'http://localhost:8000/api',
).replace(/\/+$/, '');

const WS_URL = resolveUrl('NEXT_PUBLIC_WS_URL', process.env.NEXT_PUBLIC_WS_URL, 'ws://localhost:8000');

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL?.trim() || 'http://localhost:3000').replace(/\/+$/, '');

/** The single API base. Includes the `/api` suffix per project convention. */
export function getApiBase(): string {
  return API_BASE;
}

/** The single WebSocket origin/URL. */
export function getWsUrl(): string {
  return WS_URL;
}

export function getAppUrl(): string {
  return APP_URL;
}

export const env = {
  // App
  NODE_ENV: process.env.NODE_ENV || 'development',

  // URLs (resolved + validated above)
  NEXT_PUBLIC_APP_URL: APP_URL,
  NEXT_PUBLIC_API_URL: API_BASE,
  NEXT_PUBLIC_WS_URL: WS_URL,

  // Features
  NEXT_PUBLIC_ENABLE_ANALYTICS: process.env.NEXT_PUBLIC_ENABLE_ANALYTICS === 'true',
  NEXT_PUBLIC_ENABLE_AI: process.env.NEXT_PUBLIC_ENABLE_AI === 'true',

  // Development
  NEXT_PUBLIC_DEBUG: process.env.NEXT_PUBLIC_DEBUG === 'true',
} as const;
