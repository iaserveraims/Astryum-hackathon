// src/middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { GATE_COOKIE, GATE_TTL_MS, gateMode, signGateToken, verifyGateToken } from './accessGate';

// Pre-launch access gate (2026-07-23): these surfaces require the signed
// httpOnly gate cookie minted by /api/access-gate. Everything else (landing,
// /early-access, public assets) stays open. The check runs SERVER-SIDE on
// every matching request — client JS cannot bypass it.
const GATED_PATHS = [/^\/app(\/|$)/, /^\/login(\/|$)/, /^\/register(\/|$)/, /^\/forgot-password(\/|$)/];

export async function middleware(request: NextRequest) {
  // Add CORS headers for API routes
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const response = NextResponse.next();

    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    return response;
  }

  // Handle preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  const path = request.nextUrl.pathname;
  if (GATED_PATHS.some((re) => re.test(path))) {
    const mode = gateMode({
      open: process.env.ACCESS_GATE_OPEN,
      code: process.env.ACCESS_GATE_CODE,
      secret: process.env.ACCESS_GATE_SECRET,
      nodeEnv: process.env.NODE_ENV,
    });

    if (mode === 'closed') {
      // Production without gate envs: nobody enters. Silent bounce home —
      // the door does not advertise itself.
      return NextResponse.redirect(new URL('/', request.url));
    }

    if (mode === 'enforced') {
      const secret = process.env.ACCESS_GATE_SECRET as string;
      const cookie = request.cookies.get(GATE_COOKIE)?.value;
      const verdict = await verifyGateToken(secret, cookie);
      if (!verdict.valid) {
        return NextResponse.redirect(new URL('/', request.url));
      }
      // Sliding renewal: past half-life, countersign a fresh week so an
      // active founder/judge never gets bounced mid-session.
      if (verdict.expiresAtMs - Date.now() < GATE_TTL_MS / 2) {
        const response = NextResponse.next();
        const expiresAtMs = Date.now() + GATE_TTL_MS;
        response.cookies.set(GATE_COOKIE, await signGateToken(secret, expiresAtMs), {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          path: '/',
          maxAge: Math.floor(GATE_TTL_MS / 1000),
        });
        return response;
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/api/:path*',
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
