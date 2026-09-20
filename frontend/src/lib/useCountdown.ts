'use client';

/**
 * useCountdown — the one countdown of the app, extracted from XamanQRModal
 * (regla «lógica pura enterrada = lógica sin red», 2026-08-21): the Xaman QR
 * keeps its m:ss behaviour by IMPORTING this, and the institutional exit clock
 * (F3) gets the day-scale formatter without growing a second setInterval idiom.
 *
 * `formatDaySpan` is pure and tested; the hook only owns the interval.
 */

import { useEffect, useState } from 'react';

/** m:ss remaining; `expired` once a known deadline has passed. */
export function useCountdown(expiresAt?: number): { label: string | null; expired: boolean } {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!expiresAt) {
      setLeft(null);
      return;
    }
    const tick = () => setLeft(Math.max(0, expiresAt - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  if (left == null) return { label: null, expired: false };
  if (left <= 0) return { label: null, expired: true };
  const total = Math.round(left / 1000);
  return { label: `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`, expired: false };
}

/**
 * Day-scale remaining time, honest at every magnitude:
 *   ≥ 48h → "2d 3h" · ≥ 1h → "5h 12m" · < 1h → "12:05" (m:ss).
 * Zero or negative → null (the caller decides what "ya" looks like).
 */
export function formatDaySpan(secondsLeft: number): string | null {
  if (!Number.isFinite(secondsLeft) || secondsLeft <= 0) return null;
  const s = Math.floor(secondsLeft);
  if (s >= 48 * 3600) {
    const days = Math.floor(s / 86_400);
    const hours = Math.floor((s % 86_400) / 3600);
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (s >= 3600) {
    const hours = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The F3 hook: seconds-precision clock against a unix-seconds deadline. */
export function useDeadlineClock(deadlineSec?: number): { label: string | null; reached: boolean } {
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!deadlineSec) return;
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, [deadlineSec]);
  if (!deadlineSec) return { label: null, reached: false };
  const left = deadlineSec - nowSec;
  if (left <= 0) return { label: null, reached: true };
  return { label: formatDaySpan(left), reached: false };
}
