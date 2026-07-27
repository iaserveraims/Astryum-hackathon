'use client';

/**
 * useWalletPartner — Single-purpose hook to send an unsigned intent to the
 * connected wallet partner for the user to authorize.
 *
 * REGULATORY BOUNDARY (CLAUDE.md §0):
 *   - Astryum builds the unsigned tx (CalldataBuilder, backend)
 *   - Astryum sends it to the connected wallet partner via wagmi
 *   - The wallet partner shows it to the user and transmits if authorized
 *   - Astryum never broadcasts, never custodies keys, never relays
 *
 * This hook returns:
 *   - address:      connected wallet partner account (or null)
 *   - chainId:      current chain on the wallet partner
 *   - isConnected:  true if a wallet partner is connected
 *   - openConnect:  open AppKit modal so user can pick a wallet partner
 *   - openAccount:  open AppKit account view
 *   - switchChain:  request wallet partner to switch chain
 *   - sendIntent:   forward unsigned calldata to wallet partner for signing
 */

import { useCallback } from 'react';
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSendTransaction,
  useSwitchChain,
} from 'wagmi';
import { useSendCalls } from 'wagmi/experimental';
import { getAppKitModal } from './appkit';
import { startPending, toSettled, type SettlementState } from '../settlement/settlement';

export interface IntentTx {
  /** Target contract address */
  to: string;
  /** ABI-encoded calldata from CalldataBuilder */
  data: string;
  /** Wei value as decimal string (for payable functions) */
  value?: string;
  /** Optional gas limit hint */
  gasLimit?: string;
  /** Chain on which to send */
  chainId: number;
}

export interface SendIntentResult {
  /** Tx hash returned by the wallet partner after broadcast */
  txHash: `0x${string}`;
}

export interface SendIntentCallsResult {
  /** On-chain ref: tx hash (single/sequential) or the EIP-5792 bundle id. */
  txHash: `0x${string}`;
  /**
   * Settlement handle, per rail (lib/settlement). 'settled' ONLY when this hook
   * already awaited the real receipt (single/sequential rails); the 5792 rail —
   * and a single-call whose receipt read failed — hand back 'pending', and the
   * caller MUST follow it via useSettlement before painting any success.
   */
  handle: SettlementState;
}

export function useWalletPartner() {
  const { address, isConnected, connector } = useAccount();
  const currentChainId = useChainId();
  const { sendTransactionAsync } = useSendTransaction();
  const { sendCallsAsync } = useSendCalls();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient();

  const openConnect = useCallback(() => {
    // Explicit Connect view: with a live session a plain open() shows the
    // Account view instead of the wallet list, hiding the WalletConnect QR.
    getAppKitModal().open({ view: 'Connect' });
  }, []);

  const openAccount = useCallback(() => {
    getAppKitModal().open({ view: 'Account' });
  }, []);

  /**
   * Send a Astryum intent to the connected wallet partner for user authorization.
   *
   * Flow:
   *   1. Verify wallet partner connected (otherwise open AppKit modal)
   *   2. If wallet partner is on the wrong chain, request switch
   *   3. Forward unsigned tx via wagmi.sendTransaction → wallet partner popup
   *   4. User reviews and signs in the wallet partner UI
   *   5. Wallet partner broadcasts to the network
   *   6. Return tx hash to caller
   *
   * Astryum never sees the signature. Astryum never calls broadcast.
   */
  const sendIntent = useCallback(
    async (tx: IntentTx): Promise<SendIntentResult> => {
      if (!isConnected || !address) {
        openConnect();
        throw new Error('WALLET_PARTNER_NOT_CONNECTED');
      }

      if (currentChainId !== tx.chainId) {
        await switchChainAsync({ chainId: tx.chainId });
      }

      const txHash = await sendTransactionAsync({
        to: tx.to as `0x${string}`,
        data: tx.data as `0x${string}`,
        value: tx.value ? BigInt(tx.value) : BigInt(0),
        ...(tx.gasLimit ? { gas: BigInt(tx.gasLimit) } : {}),
        chainId: tx.chainId,
      });

      return { txHash };
    },
    [address, isConnected, currentChainId, sendTransactionAsync, switchChainAsync, openConnect],
  );

  /**
   * EIP-5792 batch: send several calls (e.g. [approve, supply]) for ONE user
   * signature on wallets that support `wallet_sendCalls` (Coinbase Wallet, newer
   * MetaMask). Falls back to sequential `eth_sendTransaction` (approve → action)
   * on wallets without 5792 — correct everywhere, just N signatures.
   *
   * Astryum still never signs and never broadcasts: the wallet partner does both.
   */
  const sendIntentCalls = useCallback(
    async (calls: IntentTx[]): Promise<SendIntentCallsResult> => {
      if (!isConnected || !address) {
        openConnect();
        throw new Error('WALLET_PARTNER_NOT_CONNECTED');
      }
      if (calls.length === 0) throw new Error('NO_CALLS');
      const chainId = calls[0].chainId;
      if (currentChainId !== chainId) {
        await switchChainAsync({ chainId });
      }

      // Single call → plain sendTransaction (no batching benefit). Wait for
      // the receipt so "done" means MINED — the boards rescan on completion
      // and must see the post-action state, not the mempool.
      if (calls.length === 1) {
        const c = calls[0];
        const txHash = await sendTransactionAsync({
          to: c.to as `0x${string}`,
          data: c.data as `0x${string}`,
          value: c.value ? BigInt(c.value) : BigInt(0),
          ...(c.gasLimit ? { gas: BigInt(c.gasLimit) } : {}),
          chainId,
        });
        const pending = startPending('evm', txHash);
        if (publicClient) {
          const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash }).catch(() => null);
          if (receipt && receipt.status !== 'success') {
            throw new Error(`transaction reverted (${txHash.slice(0, 12)}…)`);
          }
          if (receipt) return { txHash, handle: toSettled(pending) };
        }
        // No client / receipt read failed: NOT confirmed — hand back pending so
        // the caller keeps watching instead of assuming the old silent green.
        return { txHash, handle: pending };
      }

      // EIP-5792 atomic batch → one confirmation.
      try {
        const result = (await sendCallsAsync({
          calls: calls.map((c) => ({
            to: c.to as `0x${string}`,
            data: c.data as `0x${string}`,
            value: c.value ? BigInt(c.value) : BigInt(0),
          })),
        })) as unknown as { id?: string } | string;
        const id = typeof result === 'string' ? result : (result?.id ?? '0x');
        // The wallet returned a bundle id, NOT a receipt — this rail is the one
        // that painted the premature green. Success now comes only from the
        // settlement machine (wallet_getCallsStatus, every receipt a success).
        return { txHash: id as `0x${string}`, handle: startPending('evm-5792', id) };
      } catch {
        // No EIP-5792 — sign each call sequentially in order (approve → action).
        //
        // CRITICAL: wait for EACH receipt before sending the next. Later calls
        // depend on earlier state (mint needs the approve mined; borrow needs
        // the supply + enterMarkets mined) — without waiting, the wallet
        // estimates gas against the pre-tx state and the dependent call fails,
        // leaving a HALF-OPEN position (the 2026-07-14 kinetic lend-without-
        // borrow bug). On any failure, say exactly which step died and that
        // the earlier steps are already on-chain.
        let last: `0x${string}` = '0x';
        for (let i = 0; i < calls.length; i++) {
          const c = calls[i];
          try {
            last = await sendTransactionAsync({
              to: c.to as `0x${string}`,
              data: c.data as `0x${string}`,
              value: c.value ? BigInt(c.value) : BigInt(0),
              ...(c.gasLimit ? { gas: BigInt(c.gasLimit) } : {}),
              chainId,
            });
            if (publicClient) {
              const receipt = await publicClient.waitForTransactionReceipt({ hash: last });
              if (receipt.status !== 'success') {
                throw new Error(`transaction reverted (${last.slice(0, 12)}…)`);
              }
            }
          } catch (e) {
            const msg = (e as { shortMessage?: string; message?: string });
            throw new Error(
              `Step ${i + 1}/${calls.length} failed: ${msg.shortMessage ?? msg.message ?? String(e)}` +
                (i > 0 ? ` — the first ${i} step${i > 1 ? 's are' : ' is'} already on-chain.` : ''),
            );
          }
        }
        // Every step awaited its real receipt above — the last hash IS confirmed
        // (or pending when no publicClient could read receipts, same honesty as
        // the single-call rail).
        const pending = startPending('evm', last);
        return { txHash: last, handle: publicClient ? toSettled(pending) : pending };
      }
    },
    [address, isConnected, currentChainId, sendCallsAsync, sendTransactionAsync, switchChainAsync, openConnect, publicClient],
  );

  return {
    address: address ?? null,
    chainId: currentChainId,
    isConnected,
    walletPartnerName: connector?.name ?? null,
    walletPartnerIcon: connector?.icon ?? null,
    openConnect,
    openAccount,
    sendIntent,
    sendIntentCalls,
  };
}
