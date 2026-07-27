'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { stepUpBus } from '../../services/stepUpBus';
import { useStepUp } from '../../hooks/useStepUp';
import StepUpSignatureModal from './StepUpSignatureModal';

/**
 * StepUpModalHost — global listener for STEP_UP_REQUIRED. When any API call is
 * gated by a lock, this prompts the signature once, caches the grant, and
 * refetches queries so protected reads recover automatically app-wide. Mounted
 * once under the QueryClientProvider.
 */
export default function StepUpModalHost() {
  const { ensureGrant, pending, error, clearError } = useStepUp();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [feature, setFeature] = useState('');
  const [action, setAction] = useState<'read' | 'write'>('read');
  const openRef = useRef(false);

  useEffect(() => {
    const unsub = stepUpBus.subscribe(({ feature: f, action: a }) => {
      // Only one prompt at a time; ignore duplicate 403s while open.
      if (openRef.current) return;
      openRef.current = true;
      setFeature(f);
      setAction(a === 'write' ? 'write' : 'read');
      clearError();
      setOpen(true);
    });
    return unsub;
  }, [clearError]);

  const close = () => {
    openRef.current = false;
    setOpen(false);
  };

  const onConfirm = async () => {
    try {
      await ensureGrant(feature, action);
      close();
      // Refetch everything — the gated read/write now carries the fresh grant.
      queryClient.invalidateQueries();
    } catch {
      // error is surfaced in the modal; keep it open for retry/cancel
    }
  };

  return (
    <StepUpSignatureModal
      open={open}
      feature={feature}
      action={action}
      pending={pending}
      error={error}
      onConfirm={onConfirm}
      onCancel={close}
    />
  );
}
