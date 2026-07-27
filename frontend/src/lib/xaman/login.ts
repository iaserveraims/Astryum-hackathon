"use client";

import { getXumm } from './client';

// Performs Xaman Sign In (QR on desktop, deeplink on mobile)
// Returns the authorization result, including XRPL account if authorized.
export async function loginWithXaman(): Promise<any> {
  const xumm = getXumm();
  if (!xumm) {
    throw new Error('Xaman is not configured. Set NEXT_PUBLIC_XAMAN_API_KEY to enable Xaman login.');
  }
  const auth = await xumm.authorize();
  return auth;
}

