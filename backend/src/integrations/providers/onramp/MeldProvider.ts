/**
 * MeldProvider
 *
 * On/off-ramp quote aggregator. Compares quotes from MoonPay, Transak, Banxa,
 * Stripe, and other providers in a single POST call.
 * MiCA-aware — Meld/partner executes, Astryum never custodies funds.
 *
 * Requires: MELD_API_KEY (from meld.io dashboard)
 * Optional: MELD_API_URL (default: https://api.meld.io)
 *
 * Capabilities:
 *   onramp.getQuotes   — aggregated quotes from all active providers
 *   onramp.getProviders — list available on-ramp providers and their status
 */
import type {
  IProvider,
  ProviderHealth,
  ProviderCallContext,
  ProviderCallResult,
  Capability,
} from '../../interfaces/IProvider';

const BASE_URL = process.env.MELD_API_URL ?? 'https://api.meld.io';
const MELD_API_KEY = process.env.MELD_API_KEY ?? '';

export interface MeldOnrampQuote {
  serviceProvider: string;
  sourceAmount: number;
  sourceCurrencyCode: string;
  destinationAmount: number;
  destinationCurrencyCode: string;
  exchangeRate: number;
  totalFee: number;
  networkFee?: number;
  transactionFee?: number;
  paymentMethodType: string;
  paymentMethodName: string;
  countryCode?: string;
  executionEstimate?: string;
}

const CAPS: ReadonlyArray<Capability> = Object.freeze([
  'onramp.getQuotes',
  'onramp.getProviders',
]);

class MeldProvider implements IProvider {
  readonly id = 'meld';
  readonly type = 'data' as const;
  readonly capabilities = CAPS;
  readonly trustLevel = 'indexer_verified' as const;
  readonly priority = 68;

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'MELD-API-KEY': MELD_API_KEY,
    };
  }

  async health(): Promise<ProviderHealth> {
    if (!MELD_API_KEY) {
      return {
        status: 'disabled',
        lastCheckAt: new Date().toISOString(),
        reason: 'MELD_API_KEY not set',
      };
    }
    const start = Date.now();
    try {
      const resp = await fetch(`${BASE_URL}/service-providers`, {
        headers: this.headers,
        signal: AbortSignal.timeout(5000),
      });
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
    if (!MELD_API_KEY) throw new Error('MeldProvider: MELD_API_KEY not set');

    const source = {
      providerId: this.id,
      providerType: this.type,
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      traceId: ctx.traceId,
    } as const;

    const inp = input as Record<string, unknown>;

    switch (capability) {
      case 'onramp.getQuotes': {
        const {
          sourceCurrencyCode = 'USD',
          destinationCurrencyCode,
          sourceAmount,
          countryCode,
          paymentMethodType,
        } = inp;

        if (!destinationCurrencyCode)
          throw new Error('MeldProvider: destinationCurrencyCode required');
        if (sourceAmount == null) throw new Error('MeldProvider: sourceAmount required');

        const body: Record<string, unknown> = {
          sourceCurrencyCode: String(sourceCurrencyCode),
          destinationCurrencyCode: String(destinationCurrencyCode),
          sourceAmount: Number(sourceAmount),
        };
        if (countryCode) body.countryCode = String(countryCode);
        if (paymentMethodType) body.paymentMethodType = String(paymentMethodType);

        const resp = await fetch(`${BASE_URL}/service-providers/crypto-onramp/quotes`, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(12_000),
        });
        if (!resp.ok) {
          const errBody = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
          throw new Error(
            `MeldProvider getQuotes error: HTTP ${resp.status} — ${JSON.stringify(errBody)}`,
          );
        }
        const result = (await resp.json()) as { quotes?: MeldOnrampQuote[] };
        return { data: (result.quotes ?? result) as unknown as TOut, source, cached: false };
      }

      case 'onramp.getProviders': {
        const resp = await fetch(`${BASE_URL}/service-providers`, {
          headers: this.headers,
          signal: AbortSignal.timeout(10_000),
        });
        if (!resp.ok) throw new Error(`MeldProvider getProviders error: HTTP ${resp.status}`);
        const result = await resp.json();
        return { data: result as unknown as TOut, source, cached: false };
      }

      default:
        throw new Error(`MeldProvider: unsupported capability '${capability}'`);
    }
  }
}

export const meldProvider = new MeldProvider();
