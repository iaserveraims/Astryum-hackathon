/**
 * TransakProvider
 *
 * On/off-ramp quotes and supported assets via the Transak Partner API.
 * MiCA-aware — Transak executes the fiat transaction, Astryum never custodies funds.
 *
 * Requires: TRANSAK_API_KEY (from dashboard.transak.com)
 * Optional: TRANSAK_ENVIRONMENT=staging|production (default: production)
 *
 * Capabilities:
 *   onramp.getQuote          — estimated crypto/fiat amount before opening the widget
 *   onramp.getSupportedAssets — supported fiat currencies + crypto currencies
 */
import type {
  IProvider,
  ProviderHealth,
  ProviderCallContext,
  ProviderCallResult,
  Capability,
} from '../../interfaces/IProvider';

const TRANSAK_ENV = process.env.TRANSAK_ENVIRONMENT ?? 'production';
const BASE_URL =
  TRANSAK_ENV === 'staging' ? 'https://api-stg.transak.com' : 'https://api.transak.com';
// The embeddable white-label WIDGET lives on a different host than the API.
const WIDGET_BASE_URL =
  TRANSAK_ENV === 'staging' ? 'https://global-stg.transak.com' : 'https://global.transak.com';
const PARTNER_API_KEY = process.env.TRANSAK_API_KEY ?? '';

export interface TransakQuote {
  fiatCurrency: string;
  cryptoCurrency: string;
  fiatAmount: number;
  cryptoAmount: number;
  conversionPrice: number;
  totalFee: number;
  feeBreakdown: Array<{ id: string; name: string; value: number; isIncluded: boolean }>;
  nonce: string;
  isBestRate: boolean;
  provider: string;
}

const CAPS: ReadonlyArray<Capability> = Object.freeze([
  'onramp.getQuote',
  'onramp.getSupportedAssets',
]);

export interface TransakWidgetParams {
  walletAddress: string;       // crypto is delivered HERE — the user's own wallet (non-custodial)
  cryptoCurrency: string;      // e.g. 'USDC', 'ETH', 'XRP'
  fiatCurrency?: string;       // e.g. 'EUR', 'USD'
  fiatAmount?: number;
  network?: string;            // e.g. 'ethereum', 'flare'
  side?: 'BUY' | 'SELL';
  partnerOrderId?: string;     // correlate the widget order with our intent / webhook
  redirectURL?: string;
}

/**
 * Build the embeddable Transak widget URL (white-label). Pure URL construction —
 * Transak's apiKey is the public widget identifier (no HMAC URL signing, unlike
 * MoonPay). The crypto is delivered to the user's own wallet; Astryum never
 * custodies or executes. Throws if TRANSAK_API_KEY is unset.
 */
export function buildTransakWidgetUrl(params: TransakWidgetParams): string {
  if (!PARTNER_API_KEY) throw new Error('TransakProvider: TRANSAK_API_KEY not set');
  const qs = new URLSearchParams({
    apiKey: PARTNER_API_KEY,
    productsAvailed: params.side ?? 'BUY',
    walletAddress: params.walletAddress,
    cryptoCurrencyCode: params.cryptoCurrency.toUpperCase(),
    // Lock the destination to the user's wallet so funds can't be redirected.
    disableWalletAddressForm: 'true',
    ...(params.fiatCurrency && { fiatCurrency: params.fiatCurrency.toUpperCase() }),
    ...(params.fiatAmount != null && { fiatAmount: String(params.fiatAmount) }),
    ...(params.network && { network: params.network.toLowerCase() }),
    ...(params.partnerOrderId && { partnerOrderId: params.partnerOrderId }),
    ...(params.redirectURL && { redirectURL: params.redirectURL }),
  });
  return `${WIDGET_BASE_URL}?${qs.toString()}`;
}

class TransakProvider implements IProvider {
  readonly id = 'transak';
  readonly type = 'data' as const;
  readonly capabilities = CAPS;
  readonly trustLevel = 'indexer_verified' as const;
  readonly priority = 70;

  async health(): Promise<ProviderHealth> {
    if (!PARTNER_API_KEY) {
      return {
        status: 'disabled',
        lastCheckAt: new Date().toISOString(),
        reason: 'TRANSAK_API_KEY not set',
      };
    }
    const start = Date.now();
    try {
      const resp = await fetch(
        `${BASE_URL}/api/v2/currencies/fiat-currencies?partnerApiKey=${PARTNER_API_KEY}`,
        { signal: AbortSignal.timeout(5000) },
      );
      return {
        status: resp.status < 500 ? 'healthy' : 'degraded',
        latencyMs: Date.now() - start,
        lastCheckAt: new Date().toISOString(),
        reason: resp.status < 500 ? undefined : `HTTP ${resp.status}`,
      };
    } catch (err) {
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        lastCheckAt: new Date().toISOString(),
        reason: (err as Error).message,
      };
    }
  }

  async call<TIn, TOut>(
    capability: Capability,
    input: TIn,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<TOut>> {
    if (!PARTNER_API_KEY) throw new Error('TransakProvider: TRANSAK_API_KEY not set');

    const source = {
      providerId: this.id,
      providerType: this.type,
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      traceId: ctx.traceId,
    } as const;

    const inp = input as Record<string, unknown>;

    switch (capability) {
      case 'onramp.getQuote': {
        const {
          fiatCurrency = 'USD',
          cryptoCurrency,
          fiatAmount,
          cryptoAmount,
          isBuyOrSell = 'BUY',
          network,
        } = inp;

        if (!cryptoCurrency) throw new Error('TransakProvider: cryptoCurrency required');
        if (fiatAmount == null && cryptoAmount == null)
          throw new Error('TransakProvider: fiatAmount or cryptoAmount required');

        const params = new URLSearchParams({
          fiatCurrency: String(fiatCurrency),
          cryptoCurrency: String(cryptoCurrency),
          isBuyOrSell: String(isBuyOrSell),
          partnerApiKey: PARTNER_API_KEY,
        });
        if (fiatAmount != null) params.set('fiatAmount', String(fiatAmount));
        if (cryptoAmount != null) params.set('cryptoAmount', String(cryptoAmount));
        if (network) params.set('network', String(network));

        const resp = await fetch(`${BASE_URL}/api/v2/quotes/?${params}`, {
          signal: AbortSignal.timeout(10_000),
        });
        if (!resp.ok) {
          const errBody = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
          throw new Error(
            `TransakProvider getQuote error: HTTP ${resp.status} — ${JSON.stringify(errBody)}`,
          );
        }
        const body = (await resp.json()) as { response?: TransakQuote };
        return { data: body.response as unknown as TOut, source, cached: false };
      }

      case 'onramp.getSupportedAssets': {
        const [fiatsResp, cryptosResp] = await Promise.all([
          fetch(
            `${BASE_URL}/api/v2/currencies/fiat-currencies?partnerApiKey=${PARTNER_API_KEY}`,
            { signal: AbortSignal.timeout(10_000) },
          ),
          fetch(
            `${BASE_URL}/api/v2/currencies/crypto-currencies?partnerApiKey=${PARTNER_API_KEY}`,
            { signal: AbortSignal.timeout(10_000) },
          ),
        ]);
        const [fiatBody, cryptoBody] = await Promise.all([
          fiatsResp.json() as Promise<{ response?: unknown[] }>,
          cryptosResp.json() as Promise<{ response?: unknown[] }>,
        ]);
        return {
          data: {
            fiat: fiatBody.response ?? [],
            crypto: cryptoBody.response ?? [],
          } as unknown as TOut,
          source,
          cached: false,
        };
      }

      default:
        throw new Error(`TransakProvider: unsupported capability '${capability}'`);
    }
  }
}

export const transakProvider = new TransakProvider();
