"use client";

// Minimal Xaman (Xumm) client singleton for browser usage
import { Xumm } from 'xumm';

let xummInstance: Xumm | null = null;

// Returns null if running server-side or if NEXT_PUBLIC_XAMAN_API_KEY is not configured.
// Callers must check for null before using the instance.
export function getXumm(): Xumm | null {
  if (typeof window === 'undefined') {
    return null;
  }

  if (!xummInstance) {
    const apiKey = process.env.NEXT_PUBLIC_XAMAN_API_KEY;
    if (!apiKey) {
      return null;
    }
    xummInstance = new Xumm(apiKey);
  }
  return xummInstance;
}

