'use client';

/**
 * /register — redirect shim (founder 2026-07-19).
 *
 * Account creation lives INSIDE /login (the access-pass card, mode "create"):
 * one door, one artifact. This route survives only so old links don't 404.
 * The former ?demo=1 public flow is GONE — the plan moved from a mock-data
 * demo to a capped early-access of the real dashboard; until that opens, the
 * beta gate applies to everyone (login itself bounces to the landing without
 * the session flag).
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function RegisterPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/login?mode=create');
  }, [router]);
  return null;
}
