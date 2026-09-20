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
  useConfig,
  useSendTransaction,
  useSwitchChain,
} from 'wagmi';
import { getPublicClient } from '@wagmi/core';
import { useSendCalls } from 'wagmi/experimental';
import { getAppKitModal } from './appkit';
import {
  startPending,
  toSettled,
  ceilingForRail,
  type SettlementState,
} from '../settlement/settlement';
import { RECEIPT_UNREAD, sequentialStepError } from './inFlightError';

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

/**
 * batch-evm (2026-08-20) — does this wallet genuinely NOT speak EIP-5792?
 *
 * The sequential fallback below re-sends EVERY call. That is the right answer
 * to exactly ONE fact — the wallet does not implement `wallet_sendCalls` — and
 * a catastrophic answer to any other: a batch the wallet ACCEPTED whose reply
 * we lost (transport timeout, dropped socket, -32002 "request already pending")
 * was being sent AGAIN in full, real money moving twice, with no receipt read
 * in between and nothing said on screen. That is «no pude leer» ≠ «falló»
 * inside the same function that fixed it for the sequential rail. A plain user
 * rejection of the batch was just as bad in a different way: it silently became
 * N popups nobody asked for.
 *
 * So the fallback is opt-IN and narrow: EIP-1193 4200 (Unsupported Method),
 * JSON-RPC -32601 (Method not found) and the prose providers wrap them in —
 * MetaMask's «does not exist / is not available», WalletConnect's «Unsupported
 * methods requested», viem/wagmi's named errors. Everything else is re-thrown
 * and classified by `signOutcome`: a rejection stays a rejection (retry is the
 * correct offer there, nothing left), and an unknown after the hand-off ends in
 * the amber "do NOT sign again" state.
 *
 * Being too NARROW costs a wallet one honest error it can retry from a clean
 * slate; being too broad costs a double execution. Narrow is the safe side.
 */
const BATCH_UNSUPPORTED_CODES = new Set<number>([4200, -32601]);
const BATCH_UNSUPPORTED_TEXT: RegExp[] = [
  /unsupported method/i, // EIP-1193 4200 prose · WalletConnect "Unsupported methods requested"
  /method not (found|supported|available|implemented)/i,
  /does not exist \/ is not available/i, // MetaMask's -32601 prose, verbatim
  /(wallet_)?sendCalls.{0,60}?(not (supported|available)|does not exist|unsupported)/i,
  /(not (supported|available)|unsupported|does not support).{0,60}?(wallet_)?sendCalls/i,
  /MethodNotSupported|UnsupportedProviderMethod|UnsupportedMethod/i,
];

export function isBatchUnsupported(e: unknown): boolean {
  if (typeof e === 'string') return BATCH_UNSUPPORTED_TEXT.some((re) => re.test(e));
  // viem/wagmi nest the provider error under `cause`; the code and the prose can
  // sit at different depths, so both are looked for along the whole chain.
  let cur: unknown = e;
  for (let hop = 0; hop < 5 && cur != null; hop += 1) {
    const x = cur as {
      code?: unknown;
      name?: string;
      shortMessage?: string;
      details?: string;
      message?: string;
      cause?: unknown;
    };
    const raw = x.code;
    const code =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && /^-?\d+$/.test(raw)
          ? Number(raw)
          : undefined;
    if (code !== undefined && BATCH_UNSUPPORTED_CODES.has(code)) return true;
    const text = [x.name, x.shortMessage, x.details, x.message]
      .filter((s): s is string => typeof s === 'string' && s.length > 0)
      .join(' · ');
    if (text && BATCH_UNSUPPORTED_TEXT.some((re) => re.test(text))) return true;
    cur = x.cause;
  }
  return false;
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
  const config = useConfig();

  /**
   * El lector de recibos TIENE que ser el de la cadena de la transacción.
   * `usePublicClient()` a secas devuelve el de la cadena conectada EN EL
   * RENDER: en un carril de dos patas que empieza en Flare y cambia a
   * Ethereum, el hook seguía apuntando al RPC de Flare y esperaba allí un
   * hash de Ethereum — nunca aparecía, saltaba el timeout y se decía
   * «Step 1/2 failed» con el approve ya minado y pagado. Se resuelve por
   * chainId en el momento de la llamada, después del switch.
   */
  const receiptClient = useCallback(
    (chainId: number) => {
      try {
        return getPublicClient(config, { chainId }) ?? null;
      } catch {
        // Cadena no registrada en el config → no sabemos leer el recibo, y se
        // dice (pending), jamás se pinta verde sin haberlo leído.
        return null;
      }
    },
    [config],
  );

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
        const pending = startPending('evm', txHash, undefined, chainId);
        const client = receiptClient(chainId);
        if (client) {
          const receipt = await client.waitForTransactionReceipt({ hash: txHash }).catch(() => null);
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
        return { txHash: id as `0x${string}`, handle: startPending('evm-5792', id, undefined, chainId) };
      } catch (batchErr) {
        // batch-evm (2026-08-20). THE FALLBACK IS NOT A CATCH-ALL. Until this
        // line the `catch` did not even bind the error: ANY death of
        // `sendCallsAsync` was read as «this wallet does not speak EIP-5792»
        // and fell through to the sequential rail, which re-sends EVERY call.
        // A bundle the wallet had already ACCEPTED but whose reply was lost was
        // therefore executed a SECOND time, in full. Only a genuine
        // not-implemented answer may downgrade the rail; anything else is the
        // caller's to classify (see `isBatchUnsupported` above).
        if (!isBatchUnsupported(batchErr)) throw batchErr;

        // No EIP-5792 — sign each call sequentially in order (approve → action).
        //
        // CRITICAL: wait for EACH receipt before sending the next. Later calls
        // depend on earlier state (mint needs the approve mined; borrow needs
        // the supply + enterMarkets mined) — without waiting, the wallet
        // estimates gas against the pre-tx state and the dependent call fails,
        // leaving a HALF-OPEN position (the 2026-07-14 kinetic lend-without-
        // borrow bug). When a step dies with earlier steps already out, the
        // whole array stops being retryable — see the catch below.
        // batch-evm (2026-08-20): `last` is the hash of the last step we know
        // COMPLETED — never the hash of the step that is dying. It used to be
        // one variable for both, and `sequentialStepError` handed that hash to
        // the amber panel: the user read «1 earlier step is already on the
        // chain» over a «Check it on the explorer →» link pointing at a tx the
        // explorer marks FAILED. The check we asked for contradicted the
        // warning, and «nothing went in, I'll sign again» was one click away.
        // The current step's hash lives in `sent` and is used where it IS the
        // right one: the revert message and the in-flight report of THIS step.
        let last: `0x${string}` = '0x';
        const seqClient = receiptClient(chainId);
        for (let i = 0; i < calls.length; i++) {
          const c = calls[i];
          let sent: `0x${string}` = '0x';
          try {
            sent = await sendTransactionAsync({
              to: c.to as `0x${string}`,
              data: c.data as `0x${string}`,
              value: c.value ? BigInt(c.value) : BigInt(0),
              ...(c.gasLimit ? { gas: BigInt(c.gasLimit) } : {}),
              chainId,
            });
            if (seqClient) {
              // NO PODER LEER EL RECIBO NO ES QUE LA TRANSACCIÓN HAYA FALLADO.
              // Sin este catch, el timeout de viem (180 s por defecto, y el RPC
              // público de chain 1 se atasca) subía por el catch de abajo y se
              // anunciaba «Step 2/2 failed» sobre un depósito QUE SE ESTABA
              // MINANDO. El usuario concluye que no entró y firma otra vez:
              // deposita dos veces, o pide prestado dos veces. El propio repo
              // ya lo tiene escrito — ETHEREUM_SETTLE_CEILING_MS dice que en
              // Ethereum 180 s es «va lento», no «falló» — y el carril de una
              // sola llamada ya lo hace bien 50 líneas más arriba. Solo el
              // secuencial, que es justo el que usa MetaMask, lo confundía.
              // El techo lo pone la CADENA, no una constante suelta: en Flare
              // un recibo llega en segundos (90 s de margen sobra) y en
              // Ethereum hace falta el triple. Es la misma fuente que usa la
              // máquina de settlement, así que las dos mitades del producto
              // dicen lo mismo sobre cuándo algo «va lento».
              const receipt = await seqClient
                .waitForTransactionReceipt({ hash: sent, timeout: ceilingForRail('evm', chainId) })
                .catch(() => null);
              if (receipt && receipt.status !== 'success') {
                throw new Error(`transaction reverted (${sent.slice(0, 12)}…)`);
              }
              if (!receipt) {
                // Se para el bucle —mandar la pata dependiente sin saber si la
                // anterior entró es cómo se abre una posición a medias— pero se
                // dice la verdad: está EN VUELO, no ha fallado. Y sobre todo se
                // dice lo único que evita el doble gasto: no la vuelvas a firmar.
                // El mensaje NO se redacta aquí. Este hook no tiene `t()` —
                // es la capa de wallet, no de UI— así que una frase construida
                // con plantilla se quedaría en inglés PARA SIEMPRE. Y resulta
                // que es la frase más importante del producto: la única que
                // evita firmar dos veces lo que ya salió. Aquí se reporta el
                // HECHO (código + hash + en qué paso), y cada puerta lo dice en
                // el idioma del usuario (lib/wallet/inFlightError).
                throw Object.assign(
                  new Error(
                    `Step ${i + 1}/${calls.length} is IN FLIGHT — sent, but not confirmed yet. ` +
                      `Do NOT sign it again.`,
                  ),
                  { code: RECEIPT_UNREAD, txHash: sent, stepIndex: i, totalSteps: calls.length },
                );
              }
            }
            // This step is done as far as we can tell: with a receipt reader it
            // was READ successful; without one it is SENT and nothing else was
            // going to read it. Either way it is now the newest hash a later
            // failure may honestly point the user at.
            last = sent;
          } catch (e) {
            // metamask-parcial (2026-08-20). LEER Y QUE SALGA A MEDIAS TAMPOCO
            // ES QUE HAYA FALLADO. Aquí se envolvía cualquier muerte de un paso
            // en un `Error` corriente que llevaba DENTRO las palabras de la
            // wallet, y esas palabras son las que clasifican el resultado aguas
            // abajo: con el paso 1 ya minado, un «User rejected the request» en
            // el paso 2 acababa en «Nothing moved — try again whenever you
            // like» con el botón de firmar puesto, y ese botón reenvía el ARRAY
            // ENTERO — se paga otra vez el paso que ya entró. El sufijo «the
            // first N steps are already on-chain» decía la verdad en una frase
            // que nadie leía y que el clasificador ignoraba.
            //
            // La decisión completa (en vuelo / parcial / murió el primer paso)
            // vive ahora en `lib/wallet/inFlightError.sequentialStepError`, que
            // es pura y se ejecuta en un test. Este bucle sólo aporta lo que
            // sabe: en qué paso está, cuál fue el último hash y si esta cadena
            // tenía lector de recibos (sin él, los pasos anteriores están
            // MANDADOS, no confirmados, y nadie va a decir «en cadena» de algo
            // que no ha leído).
            throw sequentialStepError(e, {
              index: i,
              total: calls.length,
              lastTxHash: last,
              receiptsReadable: Boolean(seqClient),
            });
          }
        }
        // Every step awaited its real receipt above — the last hash IS confirmed
        // (or pending when no client for THIS chain could read receipts, same
        // honesty as the single-call rail).
        const pending = startPending('evm', last, undefined, chainId);
        return { txHash: last, handle: seqClient ? toSettled(pending) : pending };
      }
    },
    [address, isConnected, currentChainId, sendCallsAsync, sendTransactionAsync, switchChainAsync, openConnect, receiptClient],
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
