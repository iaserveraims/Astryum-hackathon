'use client';

import { useState, useCallback } from 'react';
import { apiService } from '../services/api';
import { isStepUpRequired } from '../services/stepUpError';
import { useAuthStore } from '../stores/authStore';
import { translateError } from '../lib/errors/translateError';
import { useT } from '../i18n/LanguageProvider';

/**
 * useStepUp — runs the "prove you still control a linked wallet" handshake and
 * caches the resulting short-lived grant in the auth store (in memory only).
 *
 *   challenge → personal_sign → verify → grant
 *
 * personal_sign here is APP-LEVEL auth, NOT a DeFi transaction. The wallet's own
 * popup is the user-facing confirmation; the optional StepUpSignatureModal just
 * explains why it's happening.
 *
 * - ensureGrant(feature, action): returns a valid grant token, prompting a
 *   signature only if none is cached.
 * - withStepUp(feature, action, fn): runs fn(grant?), and if the backend replies
 *   STEP_UP_REQUIRED, runs the handshake once and retries.
 */
export function useStepUp() {
  const getValidGrant = useAuthStore((s) => s.getValidGrant);
  const setStepUpGrant = useAuthStore((s) => s.setStepUpGrant);
  const { t } = useT();

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFeature, setActiveFeature] = useState<string | null>(null);

  const runHandshake = useCallback(
    async (feature: string, action: string): Promise<string> => {
      const eth = (typeof window !== 'undefined' && (window as any).ethereum) || null;
      if (!eth) {
        throw new Error(
          'No wallet detected. Connect a linked wallet to confirm this action.'
        );
      }
      setPending(true);
      setError(null);
      setActiveFeature(feature);
      try {
        const accounts: string[] = await eth.request({ method: 'eth_requestAccounts' });
        const address = (accounts[0] || '').toLowerCase();
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
          throw new Error('Invalid wallet address from provider.');
        }

        const challenge = await apiService.post<{ nonce: string; message: string; expiresAt: string }>(
          '/security/step-up/challenge',
          { feature, action, address }
        );

        const signature: string = await eth.request({
          method: 'personal_sign',
          params: [challenge.message, address],
        });

        const grant = await apiService.post<{ grantToken: string; expiresAt: string }>(
          '/security/step-up/verify',
          { feature, action, address, nonce: challenge.nonce, message: challenge.message, signature }
        );

        setStepUpGrant(feature, action, {
          token: grant.grantToken,
          expiresAt: Date.parse(grant.expiresAt),
        });
        return grant.grantToken;
      } catch (e: any) {
        // Declining is a choice — translateError renders it calm, not as a
        // red "User rejected the request." from the provider.
        setError(translateError(e, t).message);
        throw e;
      } finally {
        setPending(false);
        setActiveFeature(null);
      }
    },
    [setStepUpGrant]
  );

  const ensureGrant = useCallback(
    async (feature: string, action: string): Promise<string> => {
      const cached = getValidGrant(feature, action);
      if (cached) return cached;
      return runHandshake(feature, action);
    },
    [getValidGrant, runHandshake]
  );

  const withStepUp = useCallback(
    async <T>(feature: string, action: string, fn: (grant?: string) => Promise<T>): Promise<T> => {
      const cached = getValidGrant(feature, action) ?? undefined;
      try {
        return await fn(cached);
      } catch (e) {
        if (isStepUpRequired(e)) {
          const grant = await ensureGrant(feature, action);
          return fn(grant);
        }
        throw e;
      }
    },
    [getValidGrant, ensureGrant]
  );

  return { ensureGrant, withStepUp, pending, error, activeFeature, clearError: () => setError(null) };
}
