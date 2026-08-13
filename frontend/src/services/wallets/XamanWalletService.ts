import { WalletService, WalletAccount, WalletBalance, TokenBalance, ChainType } from '../../lib/types/wallet';
import { Client, Wallet as XRPLWallet } from 'xrpl';
import { emitXamanPayload, emitXamanStatus } from '../../lib/xaman/payloadBus';

/**
 * One-line human summary of an unsigned XRPL transaction, for the signing
 * modal. Derived from the REAL txjson — returns undefined rather than guessing
 * when the shape is unfamiliar, so the modal shows nothing instead of a
 * placeholder (PRODUCT.md: real data over aesthetic placeholders).
 */
function describeXrplTx(tx: XRPLTransaction): string | undefined {
  const type = tx?.TransactionType;
  if (!type) return undefined;
  const amount = (tx as { Amount?: unknown }).Amount;
  if (typeof amount === 'string' && /^\d+$/.test(amount)) {
    // XRP is quoted in drops on the wire; 1 XRP = 1e6 drops.
    const xrp = Number(amount) / 1_000_000;
    if (Number.isFinite(xrp)) {
      return `${type} · ${xrp.toLocaleString('es-ES', { maximumFractionDigits: 6 })} XRP`;
    }
  }
  if (amount && typeof amount === 'object') {
    const { value, currency } = amount as { value?: string; currency?: string };
    if (value && currency) return `${type} · ${value} ${currency}`;
  }
  return type;
}

// Extended interfaces for Xaman-specific functionality
interface XamanWalletMetadata {
  walletName?: string;
  walletVersion?: string;
  connectedAt?: Date;
  lastActivity?: Date;
  accountIndex?: number;
  connectionId?: string;
}

interface XamanWalletAccount extends Omit<WalletAccount, 'metadata'> {
  metadata?: XamanWalletMetadata;
}

export interface XRPLTransaction {
  TransactionType: string;
  Account: string;
  Destination?: string;
  Amount?: string | object;
  Fee?: string;
  Sequence?: number;
  LastLedgerSequence?: number;
  [key: string]: any;
}

// Xaman Payload Types
export interface XamanPayloadResponse {
  uuid: string;
  next: {
    always: string;
    no_push: string;
  };
  refs: {
    qr_png: string;
    qr_matrix: string;
    qr_uri_quality_opts: string[];
    websocket_status: string;
  };
  pushed: boolean;
}

export interface XamanPayloadStatus {
  meta: {
    exists: boolean;
    uuid: string;
    multisign: boolean;
    submit: boolean;
    pathfinding: {
      currency: string;
      issuer?: string;
    };
    resolved_at?: string;
    signed?: boolean;
    cancelled?: boolean;
    expired?: boolean;
    app_opened?: boolean;
    return_url_app?: string;
    return_url_web?: string;
  };
  application: {
    name: string;
    description: string;
    disabled: number;
    uuidv4: string;
    icon_url: string;
    issued_user_token?: string;
  };
  payload: {
    tx_type: string;
    tx_destination: string;
    tx_destination_tag?: number;
    request_json: any;
    created_at: string;
    expires_at: string;
    expires_in_seconds: number;
  };
  response?: {
    hex: string;
    txid: string;
    resolved_at: string;
    dispatched_to: string;
    multisign_account?: string;
    account: string;
  };
  custom_meta?: {
    identifier?: string;
    blob?: any;
    instruction?: string;
  };
}

// Error types for better error handling
export enum XamanErrorType {
  API_KEY_MISSING = 'API_KEY_MISSING',
  NETWORK_ERROR = 'NETWORK_ERROR',
  API_ERROR = 'API_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  USER_CANCELLED = 'USER_CANCELLED',
  INVALID_RESPONSE = 'INVALID_RESPONSE',
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  XRPL_ERROR = 'XRPL_ERROR'
}

export interface XamanError {
  type: XamanErrorType;
  message: string;
  originalError?: any;
  details?: Record<string, any>;
  timestamp: Date;
  retryable: boolean;
}

// Network configuration with fallbacks
interface NetworkConfig {
  primary: string;
  fallbacks: string[];
  timeout: number;
}

const XRPL_NETWORKS: Record<string, NetworkConfig> = {
  mainnet: {
    primary: 'wss://xrplcluster.com/',
    fallbacks: [
      'wss://s1.ripple.com/',
      'wss://s2.ripple.com/',
      'wss://xrpl.ws/'
    ],
    timeout: 10000
  }
};

export class XamanWalletService implements WalletService {
  private client: Client;
  private _isConnected: boolean = false;
  private currentAccount: XamanWalletAccount | null = null;
  private accountChangeCallbacks: Array<(account: XamanWalletAccount | null) => void> = [];
  private disconnectCallbacks: Array<() => void> = [];
  private connectionPromise: Promise<XamanWalletAccount> | null = null;
  private errorCallbacks: Array<(error: XamanError) => void> = [];

  // Enhanced multi-account support like MetaMask
  private connectedAccounts: Map<string, XamanWalletAccount> = new Map();
  private payloadPool: Map<string, {
    payload: XamanPayloadResponse;
    status: XamanPayloadStatus | null;
    websocket: WebSocket | null;
    pollInterval: NodeJS.Timeout | null;
    accountAddress: string;
    lastActivity: Date;
    isActive: boolean;
  }> = new Map();
  private maxConnections: number = 15; // Support up to 15 concurrent connections
  private balanceCache: Map<string, { balance: WalletBalance; timestamp: number }> = new Map();
  private readonly BALANCE_CACHE_TTL = 30000; // 30 seconds
  private readonly PAYLOAD_TIMEOUT = 300000; // 5 minutes
  private readonly POLL_INTERVAL = 2000; // 2 seconds
  private readonly API_TIMEOUT = 15000; // 15 seconds
  private readonly MAX_RETRY_ATTEMPTS = 3;
  private readonly BASE_RETRY_DELAY = 1000; // 1 second
  // Mock payloads are a dev-only convenience — in production a broken Xaman
  // route must surface as an error, never as a fake connect flow.
  private readonly FALLBACK_MODE_ENABLED = process.env.NODE_ENV !== 'production';

  constructor() {
    // Validate environment and setup client with fallbacks
    this.validateEnvironment();
    this.client = this.createXRPLClient();
    this.setupErrorHandling();
    this.attemptReconnection();
  }

  /**
   * Validates required environment variables and configuration
   */
  private validateEnvironment(): void {
    // Credentials are server-only (XAMAN_API_KEY / XAMAN_API_SECRET) and are read
    // by the /api/xaman/* route handlers. They are intentionally NOT exposed to
    // the client, so in the browser we can't (and shouldn't) see them.
    const serverVars = ['XAMAN_API_KEY', 'XAMAN_API_SECRET'] as const;
    const hasServerVars = serverVars.every((k) => {
      const v = process.env[k];
      return v && v.trim() !== '';
    });

    const isBrowser = typeof window !== 'undefined';
    if (!hasServerVars && !isBrowser) {
      console.warn('Xaman environment validation: missing server env (XAMAN_API_KEY/XAMAN_API_SECRET). The /api/xaman/* routes will fail until they are set.');
    }

    // No hard failure here; the server API routes enforce credentials strictly.
  }

  /**
   * Creates XRPL client with fallback support
   */
  private createXRPLClient(): Client {
    const network = XRPL_NETWORKS.mainnet;

    try {
      return new Client(network.primary, {
        connectionTimeout: network.timeout
      });
    } catch (error) {
      console.warn('Failed to create primary XRPL client, trying fallback:', error);

      for (const fallbackUrl of network.fallbacks) {
        try {
          return new Client(fallbackUrl, {
            connectionTimeout: network.timeout
          });
        } catch (fallbackError) {
          console.warn(`Fallback XRPL client failed: ${fallbackUrl}`, fallbackError);
        }
      }

      // If all fail, return default but log error
      const xamanError: XamanError = {
        type: XamanErrorType.CONNECTION_FAILED,
        message: 'Failed to connect to any XRPL server. Using default client.',
        originalError: error,
        timestamp: new Date(),
        retryable: true
      };

      this.notifyError(xamanError);
      return new Client(network.primary);
    }
  }

  async connect(): Promise<WalletAccount> {
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = this.performConnection();
    return this.connectionPromise;
  }

  private async performConnection(): Promise<WalletAccount> {
    try {
      // Create Xaman payload for sign-in with fallback
      const payload = await this.createSignInPayloadWithFallback();

      if (!payload) {
        const error: XamanError = {
          type: XamanErrorType.CONNECTION_FAILED,
          message: 'Failed to create Xaman sign-in payload. Please check your API configuration and network connection.',
          details: {
            helpText: 'Ensure XAMAN_API_KEY and XAMAN_API_SECRET are configured server-side (frontend .env.local / Vercel env)',
            troubleshootingUrl: 'https://docs.xumm.dev/getting-started#troubleshooting'
          },
          timestamp: new Date(),
          retryable: true
        };
        this.notifyError(error);
        throw error;
      }

      // Surface the QR / deeplink to the UI so the user can sign. Skip the
      // mock fallback payload (no real QR). The globally-mounted XamanQRModal
      // listens on the payload bus and renders payload.refs.qr_png.
      if (payload.uuid && !payload.uuid.startsWith('mock-')) {
        emitXamanPayload({
          uuid: payload.uuid,
          qrPng: payload.refs?.qr_png,
          deeplink: payload.next?.always,
          purpose: 'signin',
          // options.expire is 300s on every payload we create — feed the
          // modal's countdown so the QR never dies in silence (F6).
          expiresAt: Date.now() + this.PAYLOAD_TIMEOUT,
          pushed: payload.pushed === true,
        });
      }

      // Start monitoring payload status
      const account = await this.waitForPayloadCompletion(payload);

      // Payload resolved (signed/cancelled/expired) — the QR is no longer useful.
      emitXamanPayload(null);

      if (!account) {
        const error: XamanError = {
          type: XamanErrorType.USER_CANCELLED,
          message: 'Connection was cancelled by user or timed out. Please try again.',
          details: {
            payloadId: payload.uuid,
            helpText: 'Make sure to complete the sign-in process in the Xaman app within 5 minutes'
          },
          timestamp: new Date(),
          retryable: true
        };
        this.notifyError(error);
        throw error;
      }

      // Store account in connected accounts pool
      this.connectedAccounts.set(account.id, account);
      this.currentAccount = account;
      this._isConnected = true;
      this.connectionPromise = null;

      // Connect to XRPL with fallback. Best-effort: the wallet is already
      // signed-in and usable for signing; a flaky XRPL node must not fail the
      // connection. The client reconnects lazily on the next balance read.
      try {
        await this.connectToXRPLWithFallback();
      } catch (error) {
        console.warn('Xaman sign-in: XRPL node connection failed (non-fatal):', error);
      }

      // Persist connection information
      this.persistConnectionState([account]);

      // Notify listeners
      this.accountChangeCallbacks.forEach(callback => callback(account));

      return account;
    } catch (error: any) {
      this.connectionPromise = null;

      // Connection aborted/failed — close any open QR modal.
      emitXamanPayload(null);

      // Re-throw XamanErrors as-is
      if (error.type && Object.values(XamanErrorType).includes(error.type)) {
        throw error;
      }

      // Convert other errors to XamanError
      const xamanError: XamanError = {
        type: XamanErrorType.CONNECTION_FAILED,
        message: `Xaman connection failed: ${error.message || 'Unknown error'}`,
        originalError: error,
        timestamp: new Date(),
        retryable: true
      };

      console.error('Failed to connect to Xaman:', xamanError);
      this.notifyError(xamanError);
      throw xamanError;
    }
  }

  /**
   * Notifies error callbacks about failures
   */
  private notifyError(error: XamanError): void {
    this.errorCallbacks.forEach(callback => {
      try {
        callback(error);
      } catch (callbackError) {
        console.error('Error in error callback:', callbackError);
      }
    });
  }

  /**
   * Registers error callback
   */
  public onError(callback: (error: XamanError) => void): void {
    this.errorCallbacks.push(callback);
  }

  /**
   * Performs HTTP request with retry logic and proper error handling
   */
  private async performApiRequest(
    url: string,
    options: RequestInit,
    retryCount: number = 0
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.API_TIMEOUT);

    try {
      // Add abort signal and CORS-friendly options
      const requestOptions = {
        ...options,
        signal: controller.signal,
        mode: 'cors' as RequestMode,
        credentials: 'omit' as RequestCredentials,
        cache: 'no-cache' as RequestCache,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Cache-Control': 'no-cache',
          ...options.headers
        }
      };

      const response = await fetch(url, requestOptions);
      clearTimeout(timeoutId);

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter ? parseInt(retryAfter) * 1000 : this.calculateRetryDelay(retryCount);

        if (retryCount < this.MAX_RETRY_ATTEMPTS) {
          console.warn(`Rate limited, retrying after ${delay}ms (attempt ${retryCount + 1}/${this.MAX_RETRY_ATTEMPTS})`);
          await this.delay(delay);
          return this.performApiRequest(url, options, retryCount + 1);
        }
      }

      // Handle other 5xx errors with retry
      if (response.status >= 500 && retryCount < this.MAX_RETRY_ATTEMPTS) {
        const delay = this.calculateRetryDelay(retryCount);
        console.warn(`Server error ${response.status}, retrying after ${delay}ms (attempt ${retryCount + 1}/${this.MAX_RETRY_ATTEMPTS})`);
        await this.delay(delay);
        return this.performApiRequest(url, options, retryCount + 1);
      }

      return response;
    } catch (error: any) {
      clearTimeout(timeoutId);

      // Handle network errors with retry
      if (this.isRetryableError(error) && retryCount < this.MAX_RETRY_ATTEMPTS) {
        const delay = this.calculateRetryDelay(retryCount);
        console.warn(`Network error, retrying after ${delay}ms (attempt ${retryCount + 1}/${this.MAX_RETRY_ATTEMPTS}):`, error.message);
        await this.delay(delay);
        return this.performApiRequest(url, options, retryCount + 1);
      }

      // Convert error to XamanError format
      const xamanError: XamanError = {
        type: error.name === 'AbortError' ? XamanErrorType.TIMEOUT_ERROR : XamanErrorType.NETWORK_ERROR,
        message: error.name === 'AbortError'
          ? `Request timeout after ${this.API_TIMEOUT}ms`
          : `Network error: ${error.message}`,
        originalError: error,
        details: {
          url,
          retryCount,
          method: options.method || 'GET'
        },
        timestamp: new Date(),
        retryable: this.isRetryableError(error) && retryCount < this.MAX_RETRY_ATTEMPTS
      };

      this.notifyError(xamanError);
      throw xamanError;
    }
  }

  /**
   * Calculates exponential backoff delay
   */
  private calculateRetryDelay(retryCount: number): number {
    return Math.min(
      this.BASE_RETRY_DELAY * Math.pow(2, retryCount) + Math.random() * 1000,
      30000 // Max 30 seconds
    );
  }

  /**
   * Determines if an error is retryable
   */
  private isRetryableError(error: any): boolean {
    // Network errors, timeouts, and connection errors are retryable
    return (
      error.name === 'AbortError' ||
      error.name === 'TypeError' ||
      error.name === 'NetworkError' ||
      error.code === 'ECONNRESET' ||
      error.code === 'ENOTFOUND' ||
      error.code === 'ECONNREFUSED' ||
      error.message?.includes('fetch')
    );
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async createSignInPayload(): Promise<XamanPayloadResponse | null> {
    const payload = {
      txjson: {
        TransactionType: 'SignIn'
      },
      options: {
        submit: false,
        multi_sign: false,
        expire: 300, // 5 minutes
        return_url: {
          app: 'astryum://connected',
          // Use a configurable public base URL or fall back to current origin
          web: `${process.env.NEXT_PUBLIC_PUBLIC_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000')}/wallet-connected`
        }
      },
      custom_meta: {
        identifier: this.payloadIdentifier('astryum-signin'),
        blob: {
          purpose: 'SIGN_IN',
          app_name: 'Astryum',
          app_description: 'DeFi Portfolio Management Platform'
        },
        instruction: 'Sign in to connect your XRPL wallet to Astryum'
      }
    };

    try {
      // Keys are handled server-side by our Next.js API route
      const response = await this.performApiRequest('/api/xaman/create-payload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        try {
          const data: XamanPayloadResponse = await response.json();

          // Validate response structure
          if (!data.uuid || !data.refs || !data.next) {
            const error: XamanError = {
              type: XamanErrorType.INVALID_RESPONSE,
              message: 'Received invalid response structure from Xaman API',
              details: { responseKeys: Object.keys(data) },
              timestamp: new Date(),
              retryable: false
            };
            this.notifyError(error);
            throw error;
          }

          return data;
        } catch (parseError) {
          const error: XamanError = {
            type: XamanErrorType.INVALID_RESPONSE,
            message: 'Failed to parse Xaman API response as JSON',
            originalError: parseError,
            timestamp: new Date(),
            retryable: false
          };
          this.notifyError(error);
          throw error;
        }
      } else {
        let errorDetails: any = {};
        let errorMessage = `Xaman API error: ${response.status} ${response.statusText}`;

        try {
          const errorText = await response.text();
          try {
            errorDetails = JSON.parse(errorText);
            errorMessage = errorDetails.error?.message || errorDetails.message || errorMessage;
          } catch {
            errorDetails = { rawError: errorText };
          }
        } catch {
          errorDetails = { statusText: response.statusText };
        }

        const error: XamanError = {
          type: XamanErrorType.API_ERROR,
          message: errorMessage,
          details: {
            status: response.status,
            statusText: response.statusText,
            ...errorDetails
          },
          timestamp: new Date(),
          retryable: response.status >= 500 || response.status === 429
        };

        this.notifyError(error);
        throw error;
      }
    } catch (error: any) {
      // Re-throw XamanErrors as-is
      if (error.type && Object.values(XamanErrorType).includes(error.type)) {
        throw error;
      }

      // Convert other errors to XamanError
      const xamanError: XamanError = {
        type: XamanErrorType.CONNECTION_FAILED,
        message: `Failed to create Xaman payload: ${error.message || 'Unknown error'}`,
        originalError: error,
        timestamp: new Date(),
        retryable: this.isRetryableError(error)
      };

      console.error('Xaman payload creation failed:', xamanError);
      this.notifyError(xamanError);
      return null;
    }
  }

  private async waitForPayloadCompletion(payload: XamanPayloadResponse): Promise<WalletAccount | null> {
    return new Promise((resolve, reject) => {
      const payloadId = payload.uuid;
      let websocket: WebSocket | null = null;
      let pollInterval: NodeJS.Timeout | null = null;

      // Store payload in pool for management
      this.payloadPool.set(payloadId, {
        payload,
        status: null,
        websocket: null,
        pollInterval: null,
        accountAddress: '',
        lastActivity: new Date(),
        isActive: true
      });

      const cleanup = () => {
        if (websocket) {
          websocket.close();
          websocket = null;
        }
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
        this.payloadPool.delete(payloadId);
      };

      // Polling fallback function (declare early to avoid hoisting issues)
      const startPolling = () => {
        pollInterval = setInterval(async () => {
          try {
            const status = await this.getPayloadStatus(payloadId);

            if (status) {
              const payloadEntry = this.payloadPool.get(payloadId);
              if (payloadEntry) {
                payloadEntry.status = status;
                payloadEntry.lastActivity = new Date();
              }

              // Same live signal as the WS path, for when the socket is
              // unavailable and we fall back to polling.
              if (status.meta.signed) emitXamanStatus('signed');
              else if (status.meta.app_opened) emitXamanStatus('opened');

              if (status.meta.signed || status.meta.cancelled || status.meta.expired) {
                clearTimeout(timeoutId);

                if (status.meta.signed && status.response) {
                  this.storeUserToken(status);
                  const account = await this.createAccountFromAddress(status.response.account, 0);

                  // Update payload pool
                  if (payloadEntry) {
                    payloadEntry.accountAddress = status.response.account;
                  }

                  cleanup();
                  resolve(account);
                } else {
                  // Same terminal distinction as the WS path (see above).
                  emitXamanStatus(status.meta.expired ? 'expired' : 'rejected');
                  cleanup();
                  resolve(null);
                }
              }
            }
          } catch (error) {
            console.warn('Payload status polling error:', error);
          }
        }, this.POLL_INTERVAL);

        const payloadEntry = this.payloadPool.get(payloadId);
        if (payloadEntry) {
          payloadEntry.pollInterval = pollInterval;
        }
      };

      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('Payload timeout - user did not complete action in time'));
      }, this.PAYLOAD_TIMEOUT);

      // Try WebSocket first for real-time updates
      try {
        websocket = new WebSocket(payload.refs.websocket_status);

        websocket.onmessage = async (event) => {
          try {
            const statusUpdate = JSON.parse(event.data);

            // Resolution messages carry a boolean `signed`; heartbeats / "opened"
            // events do not. The Xaman WS "signed" message does NOT include the
            // account — that only lives in the full payload status. So on a real
            // sign we must fetch getPayloadStatus() to read response.account.
            const isResolution =
              typeof statusUpdate.signed === 'boolean' ||
              statusUpdate.cancelled ||
              statusUpdate.expired;
            if (!isResolution) {
              // Not a resolution: among the heartbeats, Xaman pushes `opened`
              // when the request is on screen in the user's app. Surface only
              // that exact signal — anything looser would claim the user is
              // looking at the request when they may not be.
              if (statusUpdate.opened === true) emitXamanStatus('opened');
              return;
            }

            clearTimeout(timeoutId);

            // Rejected / cancelled / expired → no account. Tell the modal WHICH
            // terminal state this is: a "no" is a choice and a timeout is a
            // timeout — neither should vanish into a generic red error.
            if (statusUpdate.signed === false || statusUpdate.cancelled || statusUpdate.expired) {
              emitXamanStatus(statusUpdate.expired ? 'expired' : 'rejected');
              cleanup();
              resolve(null);
              return;
            }

            // signed === true → the user approved; the modal can confirm while
            // we fetch the full status (and, for submits, the network settles).
            emitXamanStatus('signed');

            // statusUpdate.signed === true → pull the full status for the account.
            const fullStatus = await this.getPayloadStatus(payloadId);
            const signedAccount = fullStatus?.response?.account;
            if (signedAccount) {
              this.storeUserToken(fullStatus);
              const account = await this.createAccountFromAddress(signedAccount, 0);

              // Update payload pool
              const payloadEntry = this.payloadPool.get(payloadId);
              if (payloadEntry) {
                payloadEntry.accountAddress = signedAccount;
                payloadEntry.status = fullStatus;
              }

              cleanup();
              resolve(account);
            } else {
              cleanup();
              reject(new Error('Failed to get account information from payload'));
            }
          } catch (error) {
            console.warn('WebSocket message parsing error:', error);
          }
        };

        websocket.onerror = () => {
          console.warn('WebSocket connection failed, falling back to polling');
          websocket = null;
          startPolling();
        };

        websocket.onopen = () => {
          console.log('WebSocket connected for payload', payloadId);
          const payloadEntry = this.payloadPool.get(payloadId);
          if (payloadEntry) {
            payloadEntry.websocket = websocket;
          }
        };
      } catch (error) {
        console.warn('WebSocket setup failed, using polling:', error);
        startPolling();
      }


    });
  }

  private async getPayloadStatus(payloadId: string): Promise<XamanPayloadStatus | null> {
    try {
      // Credentials live server-side only. The /api/xaman/* route reads
      // XAMAN_API_KEY / XAMAN_API_SECRET from the server env — the client never
      // sees or forwards the secret.
      const response = await this.performApiRequest(`/api/xaman/status/${payloadId}`, {
        method: 'GET'
      });

      if (response.ok) {
        try {
          const data: XamanPayloadStatus = await response.json();

          // Validate response structure
          if (!data.meta || !data.payload) {
            const error: XamanError = {
              type: XamanErrorType.INVALID_RESPONSE,
              message: 'Invalid payload status response structure',
              details: { payloadId, responseKeys: Object.keys(data) },
              timestamp: new Date(),
              retryable: false
            };
            this.notifyError(error);
            return null;
          }

          return data;
        } catch (parseError) {
          const error: XamanError = {
            type: XamanErrorType.INVALID_RESPONSE,
            message: 'Failed to parse payload status response as JSON',
            originalError: parseError,
            details: { payloadId },
            timestamp: new Date(),
            retryable: false
          };
          this.notifyError(error);
          return null;
        }
      } else {
        let errorMessage = `Failed to get payload status: ${response.status} ${response.statusText}`;
        let errorDetails: any = { payloadId, status: response.status };

        try {
          const errorText = await response.text();
          try {
            const errorData = JSON.parse(errorText);
            errorMessage = errorData.error?.message || errorData.message || errorMessage;
            errorDetails = { ...errorDetails, ...errorData };
          } catch {
            errorDetails.rawError = errorText;
          }
        } catch {
          // Response body reading failed
        }

        const error: XamanError = {
          type: XamanErrorType.API_ERROR,
          message: errorMessage,
          details: errorDetails,
          timestamp: new Date(),
          retryable: response.status >= 500 || response.status === 429
        };

        this.notifyError(error);
        return null;
      }
    } catch (error: any) {
      // Re-throw XamanErrors as-is
      if (error.type && Object.values(XamanErrorType).includes(error.type)) {
        throw error;
      }

      // Log and convert other errors
      console.error('Error getting payload status:', error);
      const xamanError: XamanError = {
        type: XamanErrorType.CONNECTION_FAILED,
        message: `Error getting payload status: ${error.message || 'Unknown error'}`,
        originalError: error,
        details: { payloadId },
        timestamp: new Date(),
        retryable: this.isRetryableError(error)
      };

      this.notifyError(xamanError);
      return null;
    }
  }

  async disconnect(): Promise<void> {
    try {
      this._isConnected = false;
      this.currentAccount = null;
      this.connectionPromise = null;

      // Clean up all payload connections
      this.payloadPool.forEach((payloadEntry) => {
        if (payloadEntry.websocket) {
          payloadEntry.websocket.close();
        }
        if (payloadEntry.pollInterval) {
          clearInterval(payloadEntry.pollInterval);
        }
      });
      this.payloadPool.clear();
      this.connectedAccounts.clear();
      this.balanceCache.clear();

      if (this.client.isConnected()) {
        await this.client.disconnect();
      }

      // Clear persistence
      this.clearPersistence();

      // Notify listeners
      this.accountChangeCallbacks.forEach(callback => callback(null));
      this.disconnectCallbacks.forEach(callback => callback());
    } catch (error) {
      console.error('Failed to disconnect from Xaman:', error);
    }
  }

  async getAccount(): Promise<WalletAccount | null> {
    return this.currentAccount;
  }

  async getBalance(address: string): Promise<WalletBalance> {
    try {
      if (!this.client.isConnected()) {
        await this.client.connect();
      }

      // Get account info from XRPL
      const accountInfo = await this.client.request({
        command: 'account_info',
        account: address,
        ledger_index: 'validated'
      });

      const xrpBalance = parseFloat(accountInfo.result.account_data.Balance) / 1000000; // Convert drops to XRP
      const xrpUsdValue = await this.getXRPPrice();
      const xrpValue = xrpBalance * xrpUsdValue;

      // Get token balances (trust lines)
      const tokens: TokenBalance[] = await this.getTrustLineBalances(address);

      const totalUsdValue = xrpValue + tokens.reduce((sum, token) => sum + token.usdValue, 0);

      return {
        native: {
          symbol: 'XRP',
          balance: xrpBalance.toString(),
          usdValue: xrpValue,
          currency: 'XRP'
        },
        tokens,
        totalUsdValue,
        lastUpdated: new Date()
      };
    } catch (error) {
      console.error('Failed to get XRPL balance:', error);
      throw new Error(`Failed to get balance: ${error.message}`);
    }
  }

  async signMessage(message: string): Promise<string> {
    try {
      if (!this.currentAccount) {
        await this.ensureCurrentAccount();
      }
      if (!this.currentAccount) {
        throw new Error('No account connected');
      }

      const payload = {
        txjson: {
          TransactionType: 'SignIn'
        },
        user_token: await this.resolveUserToken(this.currentAccount.address),
        options: {
          submit: false,
          multi_sign: false,
          expire: 300
        },
        custom_meta: {
          identifier: this.payloadIdentifier('astryum-sign-message'),
          blob: {
            purpose: 'SIGN_MESSAGE',
            message: message,
            app_name: 'Astryum'
          },
          instruction: `Please sign this message: "${message}"`
        }
      };

      const payloadResponse = await this.createPayload(payload);
      if (!payloadResponse) {
        throw new Error('Failed to create signing payload');
      }

      if (payloadResponse.uuid && !payloadResponse.uuid.startsWith('mock-')) {
        emitXamanPayload({
          uuid: payloadResponse.uuid,
          qrPng: payloadResponse.refs?.qr_png,
          deeplink: payloadResponse.next?.always,
          purpose: 'message',
          expiresAt: Date.now() + this.PAYLOAD_TIMEOUT,
          pushed: payloadResponse.pushed === true,
        });
      }

      const result = await this.waitForPayloadCompletion(payloadResponse);
      emitXamanPayload(null);
      if (!result) {
        throw new Error('User cancelled message signing or payload expired');
      }

      // Get the payload status to retrieve the signature
      const status = await this.getPayloadStatus(payloadResponse.uuid);
      if (status && status.response && status.response.hex) {
        return status.response.hex;
      }

      throw new Error('Failed to retrieve signature from payload');
    } catch (error) {
      emitXamanPayload(null);
      console.error('Failed to sign message:', error);
      throw new Error(`Message signing failed: ${error.message}`);
    }
  }

  async signTransaction(transaction: XRPLTransaction): Promise<string> {
    try {
      if (!this.currentAccount) {
        await this.ensureCurrentAccount();
      }
      if (!this.currentAccount) {
        throw new Error('No account connected');
      }

      // Respect the transaction's own Account when the builder pinned one —
      // stomping it with the singleton's first-connected account was the
      // active-account bug (switcher review 2026-07-17, Fase 0). Only inject
      // when the caller left it empty.
      const signerAddress = transaction.Account || this.currentAccount.address;
      const txWithAccount = {
        ...transaction,
        Account: signerAddress
      };

      const payload = {
        txjson: txWithAccount,
        user_token: await this.resolveUserToken(signerAddress),
        options: {
          submit: false,
          multi_sign: false,
          expire: 300
        },
        custom_meta: {
          identifier: this.payloadIdentifier('astryum-sign-tx'),
          blob: {
            purpose: 'SIGN_TRANSACTION',
            transaction_type: transaction.TransactionType,
            app_name: 'Astryum'
          },
          instruction: `Please sign this ${transaction.TransactionType} transaction`
        }
      };

      const payloadResponse = await this.createPayload(payload);
      if (!payloadResponse) {
        throw new Error('Failed to create transaction signing payload');
      }

      if (payloadResponse.uuid && !payloadResponse.uuid.startsWith('mock-')) {
        emitXamanPayload({
          uuid: payloadResponse.uuid,
          qrPng: payloadResponse.refs?.qr_png,
          deeplink: payloadResponse.next?.always,
          purpose: 'transaction',
          summary: describeXrplTx(transaction),
          expiresAt: Date.now() + this.PAYLOAD_TIMEOUT,
          pushed: payloadResponse.pushed === true,
        });
      }

      const result = await this.waitForPayloadCompletion(payloadResponse);
      emitXamanPayload(null);
      if (!result) {
        throw new Error('User cancelled transaction signing or payload expired');
      }

      // Get the payload status to retrieve the signed transaction
      const status = await this.getPayloadStatus(payloadResponse.uuid);
      if (status && status.response && status.response.hex) {
        return status.response.hex;
      }

      throw new Error('Failed to retrieve signed transaction from payload');
    } catch (error) {
      emitXamanPayload(null);
      console.error('Failed to sign transaction:', error);
      throw new Error(`Transaction signing failed: ${error.message}`);
    }
  }

  /**
   * signOwnershipProof — drives the Wallets-tab "Enable transactions" flow for
   * XRPL. The user signs (submit:false) an AccountSet whose Memo carries the
   * backend binding `message` (which embeds a single-use nonce). The backend
   * verifies the signature + memo and upgrades the wallet to tx-capable.
   *
   * Unlike signMessage/signTransaction, this surfaces the QR + deeplink on the
   * payload bus so the globally-mounted XamanQRModal renders it (scan from phone,
   * or "open in Xaman" on desktop). The tx is NEVER submitted — proof only.
   *
   * REGULATORY (CLAUDE.md §0): Astryum never signs/holds keys. The user signs in
   * their own Xaman app; we relay the unsigned proof and read back the signature.
   */
  public async signOwnershipProof(
    address: string,
    message: string,
  ): Promise<{ signedTxHex: string; account: string }> {
    const proofTx: XRPLTransaction = {
      TransactionType: 'AccountSet',
      Account: address,
      Memos: [{ Memo: { MemoData: XamanWalletService.utf8ToHex(message) } }],
    };

    const webReturn = `${process.env.NEXT_PUBLIC_PUBLIC_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000')}/wallet-connected`;
    const payload = {
      txjson: proofTx,
      user_token: await this.resolveUserToken(address),
      options: {
        submit: false,
        multi_sign: false,
        expire: 300,
        return_url: { app: 'astryum://bound', web: webReturn },
      },
      custom_meta: {
        identifier: this.payloadIdentifier('astryum-binding'),
        blob: { purpose: 'WALLET_BINDING', app_name: 'Astryum' },
        instruction: 'Sign to prove ownership and enable transactions. No funds are moved.',
      },
    };

    const payloadResponse = await this.createPayload(payload);
    if (!payloadResponse) {
      throw new Error('Failed to create Xaman ownership-proof payload');
    }

    // Surface the QR / deeplink (skip the mock fallback — it has no real QR).
    if (payloadResponse.uuid && !payloadResponse.uuid.startsWith('mock-')) {
      emitXamanPayload({
        uuid: payloadResponse.uuid,
        qrPng: payloadResponse.refs?.qr_png,
        deeplink: payloadResponse.next?.always,
        purpose: 'message',
        expiresAt: Date.now() + this.PAYLOAD_TIMEOUT,
        pushed: payloadResponse.pushed === true,
      });
    }

    try {
      const result = await this.waitForPayloadCompletion(payloadResponse);
      emitXamanPayload(null);
      if (!result) {
        throw new Error('Ownership proof was cancelled or expired in Xaman');
      }
      const status = await this.getPayloadStatus(payloadResponse.uuid);
      const signedTxHex = status?.response?.hex;
      const account = status?.response?.account;
      if (!signedTxHex || !account) {
        throw new Error('Xaman did not return a signed ownership proof');
      }
      return { signedTxHex, account };
    } catch (error) {
      emitXamanPayload(null);
      throw error;
    }
  }

  /** UTF-8 → uppercase hex, Buffer-free (safe in the browser bundle). */
  private static utf8ToHex(input: string): string {
    const bytes = new TextEncoder().encode(input);
    let hex = '';
    for (const b of Array.from(bytes)) hex += b.toString(16).padStart(2, '0');
    return hex.toUpperCase();
  }

  async submitTransaction(transaction: XRPLTransaction): Promise<string> {
    try {
      if (!this.currentAccount) {
        await this.ensureCurrentAccount();
      }
      if (!this.currentAccount) {
        throw new Error('No account connected');
      }

      // Respect the transaction's own Account when the builder pinned one —
      // stomping it with the singleton's first-connected account was the
      // active-account bug (switcher review 2026-07-17, Fase 0). Only inject
      // when the caller left it empty.
      const signerAddress = transaction.Account || this.currentAccount.address;
      const txWithAccount = {
        ...transaction,
        Account: signerAddress
      };

      const payload = {
        txjson: txWithAccount,
        // Push the sign request straight to the user's Xaman app when we hold
        // their sign-in token — the QR below covers the no-push case.
        user_token: await this.resolveUserToken(signerAddress),
        options: {
          submit: true, // Submit to network after signing
          multi_sign: false,
          expire: 300
        },
        custom_meta: {
          identifier: this.payloadIdentifier('astryum-submit-tx'),
          blob: {
            purpose: 'SUBMIT_TRANSACTION',
            transaction_type: transaction.TransactionType,
            app_name: 'Astryum'
          },
          instruction: `Please sign and submit this ${transaction.TransactionType} transaction`
        }
      };

      const payloadResponse = await this.createPayload(payload);
      if (!payloadResponse) {
        throw new Error('Failed to create transaction submission payload');
      }

      // Surface the QR / deeplink — without this the request exists on
      // Xaman's side but the user never sees anything to sign.
      if (payloadResponse.uuid && !payloadResponse.uuid.startsWith('mock-')) {
        emitXamanPayload({
          uuid: payloadResponse.uuid,
          qrPng: payloadResponse.refs?.qr_png,
          deeplink: payloadResponse.next?.always,
          purpose: 'transaction',
          summary: describeXrplTx(transaction),
          expiresAt: Date.now() + this.PAYLOAD_TIMEOUT,
          pushed: payloadResponse.pushed === true,
        });
      }

      const result = await this.waitForPayloadCompletion(payloadResponse);
      emitXamanPayload(null);
      if (!result) {
        throw new Error('User cancelled transaction submission or payload expired');
      }

      // Get the payload status to retrieve the transaction hash
      const status = await this.getPayloadStatus(payloadResponse.uuid);
      if (status && status.response && status.response.txid) {
        return status.response.txid;
      }

      throw new Error('Failed to retrieve transaction hash from payload');
    } catch (error) {
      emitXamanPayload(null);
      console.error('Failed to submit transaction:', error);
      throw new Error(`Transaction submission failed: ${error.message}`);
    }
  }

  isConnected(): boolean {
    return this._isConnected && this.currentAccount !== null;
  }

  onAccountChange(callback: (account: WalletAccount | null) => void): void {
    this.accountChangeCallbacks.push(callback);
  }

  onDisconnect(callback: () => void): void {
    this.disconnectCallbacks.push(callback);
  }

  // Xaman rejects payloads whose custom_meta.identifier exceeds 40 chars
  // (sign-in at 38 worked while submit-tx at 41 got a 400). Base36 keeps the
  // timestamp+nonce short; the slice caps whatever tag is passed in.
  private payloadIdentifier(tag: string): string {
    return `${tag}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.slice(0, 40);
  }

  // Building a signing payload only needs the account ADDRESS — the ownership
  // proof is the user signing in the Xaman app (QR/push), and Xaman rejects a
  // scan from any other account. After a page reload the singleton loses its
  // in-memory session while the persisted store still lists the account, so
  // rehydrate here instead of failing with "No account connected".
  private async ensureCurrentAccount(): Promise<void> {
    if (this.currentAccount) return;
    try {
      await this.restoreConnectionState();
      const restored = this.getConnectedAccounts();
      if (restored.length > 0) {
        this.currentAccount = restored[0];
        this._isConnected = true;
        return;
      }
      // Last resort: the persisted wallet store — the same source the UI uses
      // to call this wallet "connected" — still knows the address.
      const persisted = localStorage.getItem('astryum-wallet-store');
      if (!persisted) return;
      const stored = JSON.parse(persisted)?.state?.wallets?.find(
        (w: any) => w.walletType === 'xaman' && w.isConnected && w.address,
      );
      if (!stored) return;
      const account = await this.createAccountFromAddress(stored.address, 0);
      this.connectedAccounts.set(account.id, account);
      this.currentAccount = account;
      this._isConnected = true;
    } catch (error) {
      console.warn('Xaman account rehydration failed:', error);
    }
  }

  // Xaman only PUSHES a sign request to the user's phone when the payload is
  // created with the user_token it issued at sign-in. Without it the request
  // exists but never reaches the app — the user must scan the QR. Capture the
  // token whenever a payload resolves and attach it to later payloads: push
  // when possible, QR always as fallback.
  private storeUserToken(status: XamanPayloadStatus | null | undefined): void {
    try {
      const token = status?.application?.issued_user_token;
      const account = status?.response?.account;
      if (!token || !account) return;
      const raw = localStorage.getItem('xaman-user-tokens');
      const tokens = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      tokens[account] = token;
      localStorage.setItem('xaman-user-tokens', JSON.stringify(tokens));
    } catch { /* push is best-effort — the QR path stays available */ }
  }

  // Remove a stored token by VALUE (the caller only knows the token it attached,
  // not which account key it was stored under).
  private dropUserToken(token: string): void {
    try {
      const raw = localStorage.getItem('xaman-user-tokens');
      if (!raw) return;
      const tokens = JSON.parse(raw) as Record<string, string>;
      let changed = false;
      for (const account of Object.keys(tokens)) {
        if (tokens[account] === token) {
          delete tokens[account];
          changed = true;
        }
      }
      if (changed) localStorage.setItem('xaman-user-tokens', JSON.stringify(tokens));
    } catch { /* best-effort — worst case the dead token lingers */ }
  }

  private userTokenFor(address: string | undefined | null): string | undefined {
    try {
      if (!address) return undefined;
      const raw = localStorage.getItem('xaman-user-tokens');
      return raw ? (JSON.parse(raw) as Record<string, string>)[address] : undefined;
    } catch {
      return undefined;
    }
  }

  // The live capture in waitForPayloadCompletion misses the token when the tab
  // closes before the user signs, or when the next payload is created before
  // the previous one resolves. The token still exists on Xaman's side — recover
  // it from the last created payload's status before giving up on push.
  private async resolveUserToken(address: string | undefined | null): Promise<string | undefined> {
    const cached = this.userTokenFor(address);
    if (cached) {
      console.info(`[Xaman] user token found for ${address} — request will be pushed`);
      return cached;
    }
    try {
      const raw = localStorage.getItem('xaman-last-payload');
      const uuid = raw ? (JSON.parse(raw) as { uuid?: string }).uuid : undefined;
      if (uuid) {
        const status = await this.getPayloadStatus(uuid);
        this.storeUserToken(status);
        const recovered = this.userTokenFor(address);
        if (recovered) {
          console.info(`[Xaman] user token recovered from payload ${uuid} — request will be pushed`);
          return recovered;
        }
      }
    } catch { /* best-effort — QR path below */ }
    console.info(`[Xaman] no user token for ${address} yet — QR-only until one payload is signed`);
    return undefined;
  }

  // Private helper methods
  private async createPayload(payload: any): Promise<XamanPayloadResponse | null> {
    try {
      // Credentials live server-side only (see getPayloadStatus). The client
      // posts the payload; the route attaches the Xaman secret server-side.
      const response = await this.performApiRequest('/api/xaman/create-payload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        try {
          const data: XamanPayloadResponse = await response.json();

          // Validate response structure
          if (!data.uuid || !data.refs || !data.next) {
            const error: XamanError = {
              type: XamanErrorType.INVALID_RESPONSE,
              message: 'Invalid payload response structure from Xaman API',
              details: { responseKeys: Object.keys(data), payloadType: payload.txjson?.TransactionType },
              timestamp: new Date(),
              retryable: false
            };
            this.notifyError(error);
            return null;
          }

          // `pushed` is Xaman's own answer to "did this reach the user's app?"
          // — the ground truth when debugging why a sign request only shows as QR.
          console.info(
            `[Xaman] payload ${data.uuid} (${payload.txjson?.TransactionType ?? '?'}) — pushed: ${data.pushed === true}`,
          );

          // A token Xaman refused to push with is dead (app reinstalled, push
          // permission revoked, device changed). Forget it, or every later
          // payload keeps "pushing" into the void — the next signed payload
          // re-captures a live token via storeUserToken.
          if (payload.user_token && data.pushed === false) {
            this.dropUserToken(payload.user_token);
          }

          // Remember the last payload: if its signature is missed live (tab
          // closed, ws drop), resolveUserToken() recovers the push token from it.
          try {
            localStorage.setItem('xaman-last-payload', JSON.stringify({ uuid: data.uuid, ts: Date.now() }));
          } catch { /* best-effort */ }

          return data;
        } catch (parseError) {
          const error: XamanError = {
            type: XamanErrorType.INVALID_RESPONSE,
            message: 'Failed to parse payload response as JSON',
            originalError: parseError,
            details: { payloadType: payload.txjson?.TransactionType },
            timestamp: new Date(),
            retryable: false
          };
          this.notifyError(error);
          return null;
        }
      } else {
        let errorMessage = `Xaman API error: ${response.status} ${response.statusText}`;
        let errorDetails: any = { status: response.status, payloadType: payload.txjson?.TransactionType };

        try {
          const errorText = await response.text();
          try {
            const errorData = JSON.parse(errorText);
            errorMessage = errorData.error?.message || errorData.message || errorMessage;
            errorDetails = { ...errorDetails, ...errorData };
          } catch {
            errorDetails.rawError = errorText;
          }
        } catch {
          // Response body reading failed
        }

        const error: XamanError = {
          type: XamanErrorType.API_ERROR,
          message: errorMessage,
          details: errorDetails,
          timestamp: new Date(),
          retryable: response.status >= 500 || response.status === 429
        };

        this.notifyError(error);
        return null;
      }
    } catch (error: any) {
      // Re-throw XamanErrors as-is
      if (error.type && Object.values(XamanErrorType).includes(error.type)) {
        throw error;
      }

      console.error('Failed to create Xaman payload:', error);
      const xamanError: XamanError = {
        type: XamanErrorType.CONNECTION_FAILED,
        message: `Failed to create payload: ${error.message || 'Unknown error'}`,
        originalError: error,
        details: { payloadType: payload.txjson?.TransactionType },
        timestamp: new Date(),
        retryable: this.isRetryableError(error)
      };

      this.notifyError(xamanError);
      return null;
    }
  }

  private async createAccountFromAddress(address: string, accountIndex: number = 0): Promise<XamanWalletAccount> {
    // Balance is best-effort: a flaky/unreachable XRPL node (e.g. transient 401
    // / socket close on xrplcluster.com) must NOT abort an otherwise successful
    // sign-in. The address is what matters for binding/signing; balance refreshes
    // later via refreshBalances().
    let balance: WalletBalance;
    try {
      balance = await this.getBalance(address);
    } catch (error) {
      console.warn('Xaman sign-in: balance fetch failed, continuing with zero balance:', error);
      balance = {
        native: { symbol: 'XRP', balance: '0', usdValue: 0, currency: 'XRP' },
        tokens: [],
        totalUsdValue: 0,
        lastUpdated: new Date(),
      };
    }
    const accountId = `xaman-${address.toLowerCase()}`;

    return {
      id: accountId,
      address,
      walletType: 'xaman',
      chainType: 'xrp' as ChainType,
      nickname: `Xaman ${accountIndex + 1} (${address.slice(0, 6)}...${address.slice(-4)})`,
      isConnected: true,
      status: 'connected',
      balance,
      network: 'mainnet',
      capabilities: {
        signMessage: true,
        signTransaction: true,
        signAndSubmit: true,
        multiSign: false
      },
      metadata: {
        walletName: 'Xaman',
        walletVersion: '2.0+',
        connectedAt: new Date(),
        lastActivity: new Date(),
        accountIndex,
        connectionId: accountId
      }
    };
  }

  private async getXRPPrice(): Promise<number> {
    try {
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ripple&vs_currencies=usd');
      const data = await response.json();
      return data.ripple?.usd || 0.5; // Fallback price
    } catch (error) {
      console.warn('Failed to fetch XRP price:', error);
      return 0.5; // Fallback price
    }
  }

  private async getTrustLineBalances(address: string): Promise<TokenBalance[]> {
    try {
      if (!this.client.isConnected()) {
        await this.client.connect();
      }

      const accountLines = await this.client.request({
        command: 'account_lines',
        account: address,
        ledger_index: 'validated'
      });

      const tokens: TokenBalance[] = [];

      for (const line of accountLines.result.lines) {
        if (parseFloat(line.balance) > 0) {
          const tokenUsdValue = await this.getTokenPrice(line.currency);
          
          tokens.push({
            address: `${line.account}:${line.currency}`,
            symbol: line.currency,
            name: line.currency,
            balance: line.balance,
            decimals: 6, // Most XRPL tokens use 6 decimals
            usdValue: parseFloat(line.balance) * tokenUsdValue,
            logoUri: await this.getTokenLogo(line.currency),
            verified: await this.isVerifiedToken(line.currency)
          });
        }
      }

      return tokens;
    } catch (error) {
      console.error('Failed to get trust line balances:', error);
      return [];
    }
  }

  private async getTokenPrice(currency: string): Promise<number> {
    // In real implementation, would query DEX aggregator or price API
    // For now, return mock prices for known tokens
    const knownTokens: { [key: string]: number } = {
      'USD': 1.0,
      'EUR': 1.1,
      'BTC': 45000,
      'ETH': 2500
    };
    
    return knownTokens[currency] || 0;
  }

  private async getTokenLogo(currency: string): Promise<string | undefined> {
    // In real implementation, would query token registry
    const knownLogos: { [key: string]: string } = {
      'USD': 'https://cryptologos.cc/logos/usd-coin-usdc-logo.png',
      'EUR': 'https://upload.wikimedia.org/wikipedia/commons/b/b7/Flag_of_Europe.svg'
    };
    
    return knownLogos[currency];
  }

  /**
   * Creates sign-in payload with fallback mechanisms
   */
  private async createSignInPayloadWithFallback(): Promise<XamanPayloadResponse | null> {
    // First, try the normal sign-in payload creation
    try {
      return await this.createSignInPayload();
    } catch (error: any) {
      console.warn('Primary sign-in payload creation failed, trying fallback:', error.message);

      // If API keys are missing, provide helpful guidance
      if (error.type === XamanErrorType.API_KEY_MISSING) {
        if (this.FALLBACK_MODE_ENABLED) {
          return await this.createMockSignInPayload();
        }
        throw error;
      }

      // For other errors, try with simplified payload
      try {
        return await this.createSimplifiedSignInPayload();
      } catch (fallbackError) {
        console.error('Fallback sign-in payload creation also failed:', fallbackError);

        if (this.FALLBACK_MODE_ENABLED) {
          return await this.createMockSignInPayload();
        }

        throw error; // Throw original error
      }
    }
  }

  /**
   * Creates simplified sign-in payload with minimal options
   */
  private async createSimplifiedSignInPayload(): Promise<XamanPayloadResponse | null> {
    const payload = {
      txjson: {
        TransactionType: 'SignIn'
      },
      options: {
        submit: false,
        expire: 300
      }
    };

    // Keys are handled server-side by API route (backend)
    const response = await this.performApiRequest('/api/xaman/create-payload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      return await response.json();
    }

    throw new Error(`API error: ${response.status}`);
  }

  /**
   * Creates mock payload for development/fallback
   */
  private async createMockSignInPayload(): Promise<XamanPayloadResponse | null> {
    console.warn('Using mock sign-in payload for development. This should not be used in production.');

    // Return mock payload structure for development
    return {
      uuid: `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      next: {
        always: 'https://xumm.app/',
        no_push: 'https://xumm.app/'
      },
      refs: {
        qr_png: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        qr_matrix: 'mock-matrix',
        qr_uri_quality_opts: ['m', 'q', 'h'],
        websocket_status: 'wss://mock.websocket.url'
      },
      pushed: false
    };
  }

  /**
   * Connects to XRPL with fallback servers
   */
  private async connectToXRPLWithFallback(): Promise<void> {
    const network = XRPL_NETWORKS.mainnet;
    let lastError: any;

    // Try primary connection
    try {
      if (!this.client.isConnected()) {
        await Promise.race([
          this.client.connect(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Connection timeout')), network.timeout)
          )
        ]);
      }
      return;
    } catch (error) {
      lastError = error;
      console.warn('Primary XRPL connection failed:', error.message);
    }

    // Try fallback servers
    for (const fallbackUrl of network.fallbacks) {
      try {
        console.log(`Trying XRPL fallback server: ${fallbackUrl}`);

        // Create new client with fallback URL
        const fallbackClient = new Client(fallbackUrl, {
          connectionTimeout: network.timeout
        });

        await Promise.race([
          fallbackClient.connect(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Fallback connection timeout')), network.timeout)
          )
        ]);

        // If successful, replace the main client
        if (this.client.isConnected()) {
          await this.client.disconnect();
        }
        this.client = fallbackClient;
        this.setupErrorHandling(); // Re-setup error handling for new client

        console.log(`Successfully connected to XRPL fallback: ${fallbackUrl}`);
        return;
      } catch (fallbackError) {
        lastError = fallbackError;
        console.warn(`XRPL fallback ${fallbackUrl} failed:`, fallbackError.message);
      }
    }

    // All connections failed
    const error: XamanError = {
      type: XamanErrorType.XRPL_ERROR,
      message: 'Failed to connect to XRPL network. All servers are unreachable.',
      originalError: lastError,
      details: {
        attemptedServers: [network.primary, ...network.fallbacks],
        helpText: 'This may be a temporary network issue. Please try again later.'
      },
      timestamp: new Date(),
      retryable: true
    };

    this.notifyError(error);
    throw error;
  }

  private async isVerifiedToken(currency: string): Promise<boolean> {
    // In real implementation, would check against verified token list
    const verifiedTokens = ['USD', 'EUR', 'BTC', 'ETH'];
    return verifiedTokens.includes(currency);
  }

  private setupErrorHandling(): void {
    // Handle XRPL client errors with improved error reporting
    this.client.on('error', (error) => {
      const xamanError: XamanError = {
        type: XamanErrorType.XRPL_ERROR,
        message: `XRPL client error: ${error.message || 'Unknown XRPL error'}`,
        originalError: error,
        timestamp: new Date(),
        retryable: true
      };

      console.error('XRPL client error:', xamanError);
      this.notifyError(xamanError);

      // Try to reconnect with fallback
      setTimeout(async () => {
        if (!this.client.isConnected()) {
          try {
            await this.connectToXRPLWithFallback();
          } catch (reconnectError) {
            console.error('Failed to reconnect after XRPL error:', reconnectError);
          }
        }
      }, 5000);
    });

    this.client.on('disconnected', () => {
      console.warn('XRPL client disconnected');

      const xamanError: XamanError = {
        type: XamanErrorType.XRPL_ERROR,
        message: 'XRPL connection lost. Attempting to reconnect...',
        timestamp: new Date(),
        retryable: true
      };

      this.notifyError(xamanError);

      // Try to reconnect with backoff
      setTimeout(async () => {
        try {
          await this.connectToXRPLWithFallback();
        } catch (reconnectError) {
          console.error('Failed to reconnect after disconnection:', reconnectError);
        }
      }, 2000);
    });

    // Monitor connection health
    this.client.on('connected', () => {
      console.log('XRPL client connected successfully');
    });
  }

  // Auto-reconnection functionality
  private async attemptReconnection(): Promise<void> {
    try {
      // Check if previously connected by looking at localStorage
      const persistedData = localStorage.getItem('astryum-wallet-store');
      if (!persistedData) return;

      const parsed = JSON.parse(persistedData);
      const hasXamanWallet = parsed?.state?.wallets?.some((wallet: any) =>
        wallet.walletType === 'xaman' && wallet.isConnected
      );

      if (!hasXamanWallet) return;

      // Check if should auto-reconnect
      if (!this.shouldAutoReconnect()) return;

      // Restore connection state
      await this.restoreConnectionState();

      if (this.connectedAccounts.size > 0) {
        this._isConnected = true;
        const accounts = this.getConnectedAccounts();
        this.currentAccount = accounts[0];

        // Connect to XRPL
        if (!this.client.isConnected()) {
          await this.client.connect();
        }

        // Notify listeners
        accounts.forEach(account => {
          this.accountChangeCallbacks.forEach(callback => callback(account));
        });

        console.log(`Xaman auto-reconnected successfully with ${this.connectedAccounts.size} accounts`);
      }
    } catch (error) {
      console.warn('Auto-reconnection failed:', error);
      // Clear any stale connection state
      this.clearPersistence();
    }
  }

  // Enhanced connection method with persistence
  async connectWithPersistence(): Promise<WalletAccount> {
    const account = await this.connect();

    // Mark this connection as persistent
    localStorage.setItem('xaman-auto-connected', 'true');
    localStorage.setItem('xaman-last-connected', Date.now().toString());

    return account;
  }

  // Check if should auto-reconnect
  public shouldAutoReconnect(): boolean {
    const autoConnected = localStorage.getItem('xaman-auto-connected');
    const lastConnected = localStorage.getItem('xaman-last-connected');

    if (!autoConnected || !lastConnected) return false;

    // Auto-reconnect within 7 days of last connection
    const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
    const timeSinceLastConnection = Date.now() - parseInt(lastConnected);

    return timeSinceLastConnection < sevenDaysInMs;
  }

  // Clear persistence flags
  public clearPersistence(): void {
    localStorage.removeItem('xaman-auto-connected');
    localStorage.removeItem('xaman-last-connected');
    localStorage.removeItem('xaman-connected-accounts');
    localStorage.removeItem('xaman-payload-pool');
  }

  // Enhanced multi-account methods
  public getConnectedAccounts(): WalletAccount[] {
    return Array.from(this.connectedAccounts.values());
  }

  public getAccountById(accountId: string): WalletAccount | null {
    return this.connectedAccounts.get(accountId) || null;
  }

  public async connectAdditionalAccount(): Promise<WalletAccount | null> {
    try {
      // Create a new sign-in payload for additional account
      const payload = await this.createSignInPayload();
      if (!payload) {
        throw new Error('Failed to create additional account payload');
      }

      const account = await this.waitForPayloadCompletion(payload);
      if (!account) {
        return null;
      }

      // Check if this account is already connected
      const existingAccount = Array.from(this.connectedAccounts.values())
        .find(acc => acc.address.toLowerCase() === account.address.toLowerCase());

      if (existingAccount) {
        console.log('Account already connected:', account.address);
        return existingAccount;
      }

      // Check connection limit
      if (this.connectedAccounts.size >= this.maxConnections) {
        throw new Error(`Maximum connections reached (${this.maxConnections})`);
      }

      // Add to connected accounts
      const accountIndex = this.connectedAccounts.size;
      (account as XamanWalletAccount).metadata!.accountIndex = accountIndex;
      account.nickname = `Xaman ${accountIndex + 1} (${account.address.slice(0, 6)}...${account.address.slice(-4)})`;

      this.connectedAccounts.set(account.id, account as XamanWalletAccount);

      // Update persistence
      this.persistConnectionState(this.getConnectedAccounts());

      // Notify listeners
      this.accountChangeCallbacks.forEach(callback => callback(account));

      return account;
    } catch (error) {
      console.error('Failed to connect additional account:', error);
      return null;
    }
  }

  public async disconnectAccount(accountId: string): Promise<void> {
    const account = this.connectedAccounts.get(accountId);
    if (!account) return;

    // Clean up any active payloads for this account
    this.payloadPool.forEach((payloadEntry, payloadId) => {
      if (payloadEntry.accountAddress === account.address) {
        if (payloadEntry.websocket) {
          payloadEntry.websocket.close();
        }
        if (payloadEntry.pollInterval) {
          clearInterval(payloadEntry.pollInterval);
        }
        this.payloadPool.delete(payloadId);
      }
    });

    // Remove from connected accounts
    this.connectedAccounts.delete(accountId);

    // Clear from cache
    const cacheKeys = Array.from(this.balanceCache.keys()).filter(key => key.startsWith(account.address));
    cacheKeys.forEach(key => this.balanceCache.delete(key));

    // Update persistence
    this.persistConnectionState(this.getConnectedAccounts());

    // If this was the active account, switch to another one
    if (this.currentAccount?.id === accountId) {
      const remainingAccounts = this.getConnectedAccounts();
      this.currentAccount = remainingAccounts.length > 0 ? remainingAccounts[0] : null;

      if (!this.currentAccount) {
        this._isConnected = false;
      }
    }

    // Notify listeners
    this.accountChangeCallbacks.forEach(callback => callback(null));
  }

  private persistConnectionState(accounts: WalletAccount[]): void {
    try {
      const connectionData = {
        accounts: accounts.map(acc => ({
          id: acc.id,
          address: acc.address,
          nickname: acc.nickname,
          chainType: acc.chainType,
          network: acc.network,
          connectedAt: acc.metadata?.connectedAt,
          accountIndex: (acc as XamanWalletAccount).metadata?.accountIndex
        })),
        timestamp: Date.now()
      };

      localStorage.setItem('xaman-connected-accounts', JSON.stringify(connectionData));
    } catch (error) {
      console.warn('Failed to persist connection state:', error);
    }
  }

  private async restoreConnectionState(): Promise<void> {
    try {
      const storedData = localStorage.getItem('xaman-connected-accounts');
      if (!storedData) return;

      const connectionData = JSON.parse(storedData);
      if (!connectionData.accounts || Date.now() - connectionData.timestamp > 7 * 24 * 60 * 60 * 1000) {
        // Data too old, clear it
        localStorage.removeItem('xaman-connected-accounts');
        return;
      }

      // Restore accounts (note: we can't verify they're still valid without user interaction)
      for (const storedAccount of connectionData.accounts) {
        try {
          const account = await this.createAccountFromAddress(storedAccount.address, storedAccount.accountIndex || 0);
          account.nickname = storedAccount.nickname || account.nickname;
          this.connectedAccounts.set(account.id, account);
        } catch (error) {
          console.warn(`Failed to restore account ${storedAccount.address}:`, error);
        }
      }
    } catch (error) {
      console.warn('Failed to restore connection state:', error);
    }
  }

  public async refreshAllBalances(): Promise<void> {
    const accounts = this.getConnectedAccounts();
    const refreshPromises = accounts.map(async (account) => {
      try {
        const balance = await this.getBalance(account.address);
        account.balance = balance;
        account.metadata!.lastActivity = new Date();
        this.connectedAccounts.set(account.id, account);
      } catch (error) {
        console.warn(`Failed to refresh balance for account ${account.id}:`, error);
      }
    });

    await Promise.all(refreshPromises);
  }

  public getConnectionStats(): {
    totalConnections: number;
    activePayloads: number;
    lastActivity: Date | null;
    cacheSize: number;
  } {
    const activePayloads = Array.from(this.payloadPool.values()).filter(entry => entry.isActive).length;
    const lastActivities = Array.from(this.payloadPool.values()).map(entry => entry.lastActivity);
    const lastActivity = lastActivities.length > 0 ? new Date(Math.max(...lastActivities.map(d => d.getTime()))) : null;

    return {
      totalConnections: this.connectedAccounts.size,
      activePayloads,
      lastActivity,
      cacheSize: this.balanceCache.size
    };
  }

  // Account-specific signing methods
  public async signTransactionForAccount(accountId: string, transaction: XRPLTransaction): Promise<string> {
    const account = this.connectedAccounts.get(accountId);
    if (!account) {
      throw new Error(`No account found with id ${accountId}`);
    }

    const originalAccount = this.currentAccount;
    this.currentAccount = account;

    try {
      const result = await this.signTransaction(transaction);
      return result;
    } finally {
      this.currentAccount = originalAccount;
    }
  }

  public async submitTransactionForAccount(accountId: string, transaction: XRPLTransaction): Promise<string> {
    const account = this.connectedAccounts.get(accountId);
    if (!account) {
      throw new Error(`No account found with id ${accountId}`);
    }

    const originalAccount = this.currentAccount;
    this.currentAccount = account;

    try {
      const result = await this.submitTransaction(transaction);
      return result;
    } finally {
      this.currentAccount = originalAccount;
    }
  }

  public async signMessageForAccount(accountId: string, message: string): Promise<string> {
    const account = this.connectedAccounts.get(accountId);
    if (!account) {
      throw new Error(`No account found with id ${accountId}`);
    }

    const originalAccount = this.currentAccount;
    this.currentAccount = account;

    try {
      const result = await this.signMessage(message);
      return result;
    } finally {
      this.currentAccount = originalAccount;
    }
  }

  // Switch active account
  public async switchAccount(accountId: string): Promise<WalletAccount | null> {
    const account = this.connectedAccounts.get(accountId);
    if (!account) {
      throw new Error(`No account found with id ${accountId}`);
    }

    this.currentAccount = account;
    account.metadata!.lastActivity = new Date();
    this.connectedAccounts.set(accountId, account);

    // Notify listeners
    this.accountChangeCallbacks.forEach(callback => callback(account));

    return account;
  }

  // Utility methods for XRPL
  public static isValidXRPLAddress(address: string): boolean {
    // Basic XRPL address validation
    return /^r[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(address);
  }

  public static formatXRPAmount(drops: number | string): string {
    const amount = typeof drops === 'string' ? parseInt(drops) : drops;
    return (amount / 1000000).toString(); // Convert from drops to XRP
  }

  public static parseXRPAmount(xrp: string): string {
    return Math.floor(parseFloat(xrp) * 1000000).toString(); // Convert from XRP to drops
  }

  // Enhanced payload monitoring with retry logic
  public async monitorPayload(payloadId: string, onUpdate?: (status: XamanPayloadStatus) => void): Promise<XamanPayloadStatus | null> {
    const payloadEntry = this.payloadPool.get(payloadId);
    if (!payloadEntry) {
      console.warn(`Payload ${payloadId} not found in pool`);
      return null;
    }

    return new Promise((resolve, reject) => {
      let retryCount = 0;
      const maxRetries = 5;
      let websocket: WebSocket | null = null;
      let pollInterval: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (websocket) {
          websocket.close();
          websocket = null;
        }
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
      };

      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('Payload monitoring timeout'));
      }, this.PAYLOAD_TIMEOUT);

      // WebSocket monitoring with retry
      const connectWebSocket = () => {
        try {
          websocket = new WebSocket(payloadEntry.payload.refs.websocket_status);

          websocket.onopen = () => {
            console.log(`WebSocket connected for payload ${payloadId}`);
            retryCount = 0; // Reset retry count on successful connection
            payloadEntry.websocket = websocket;
          };

          websocket.onmessage = async (event) => {
            try {
              const statusUpdate = JSON.parse(event.data);
              payloadEntry.lastActivity = new Date();

              if (onUpdate) {
                onUpdate(statusUpdate);
              }

              if (statusUpdate.signed || statusUpdate.cancelled || statusUpdate.expired) {
                clearTimeout(timeoutId);
                const fullStatus = await this.getPayloadStatus(payloadId);
                cleanup();
                resolve(fullStatus);
              }
            } catch (error) {
              console.warn('WebSocket message parsing error:', error);
            }
          };

          websocket.onerror = (error) => {
            console.warn('WebSocket error:', error);
            websocket = null;

            if (retryCount < maxRetries) {
              retryCount++;
              console.log(`Retrying WebSocket connection (${retryCount}/${maxRetries})`);
              setTimeout(() => {
                if (!websocket) {
                  connectWebSocket();
                }
              }, 2000 * retryCount);
            } else {
              console.warn('WebSocket max retries reached, falling back to polling');
              startPolling();
            }
          };

          websocket.onclose = () => {
            if (websocket) {
              websocket = null;
              if (retryCount < maxRetries) {
                retryCount++;
                setTimeout(() => connectWebSocket(), 1000 * retryCount);
              }
            }
          };
        } catch (error) {
          console.warn('WebSocket setup failed, using polling:', error);
          startPolling();
        }
      };

      const startPolling = () => {
        if (pollInterval) return; // Already polling

        pollInterval = setInterval(async () => {
          try {
            const status = await this.getPayloadStatus(payloadId);
            if (status) {
              payloadEntry.status = status;
              payloadEntry.lastActivity = new Date();

              if (onUpdate) {
                onUpdate(status);
              }

              if (status.meta.signed || status.meta.cancelled || status.meta.expired) {
                clearTimeout(timeoutId);
                cleanup();
                resolve(status);
              }
            }
          } catch (error) {
            console.warn('Payload status polling error:', error);
          }
        }, this.POLL_INTERVAL);

        payloadEntry.pollInterval = pollInterval;
      };

      // Start with WebSocket
      connectWebSocket();
    });
  }

  // Cancel a payload
  public async cancelPayload(payloadId: string): Promise<boolean> {
    try {
      // Credentials live server-side only; the route cancels the payload upstream.
      const response = await fetch(`/api/xaman/status/${payloadId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        // Clean up payload from pool
        const payloadEntry = this.payloadPool.get(payloadId);
        if (payloadEntry) {
          if (payloadEntry.websocket) {
            payloadEntry.websocket.close();
          }
          if (payloadEntry.pollInterval) {
            clearInterval(payloadEntry.pollInterval);
          }
          this.payloadPool.delete(payloadId);
        }
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to cancel payload:', error);
      return false;
    }
  }

  // Deep linking functionality
  public static generateDeepLink(payloadId: string): string {
    return `https://xumm.app/sign/${payloadId}`;
  }

  public static generateMobileDeepLink(payloadId: string): string {
    return `xumm://xumm.app/sign/${payloadId}`;
  }

  public static generateUniversalLink(payloadId: string): string {
    return `https://xumm.app/sign/${payloadId}`;
  }

  // Check if user is on mobile device
  public static isMobileDevice(): boolean {
    if (typeof window === 'undefined') return false;

    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }

  // Open Xaman app with deep link
  public static openXamanApp(payloadId: string): boolean {
    try {
      if (typeof window === 'undefined') return false;

      const isMobile = this.isMobileDevice();

      if (isMobile) {
        // Try mobile deep link first
        const mobileLink = this.generateMobileDeepLink(payloadId);
        window.location.href = mobileLink;

        // Fallback to universal link after a short delay
        setTimeout(() => {
          const universalLink = this.generateUniversalLink(payloadId);
          window.open(universalLink, '_blank');
        }, 1000);
      } else {
        // Desktop - open in new tab
        const universalLink = this.generateUniversalLink(payloadId);
        window.open(universalLink, '_blank');
      }

      return true;
    } catch (error) {
      console.error('Failed to open Xaman app:', error);
      return false;
    }
  }

  // Get Xaman download URL
  public static getXamanDownloadUrl(): string {
    const isMobile = this.isMobileDevice();

    if (isMobile) {
      if (typeof window !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        return 'https://apps.apple.com/app/xaman/id1492302343';
      } else {
        return 'https://play.google.com/store/apps/details?id=com.xrpllabs.xumm';
      }
    }

    return 'https://xumm.app/';
  }

  // Generate QR code for connection
  public async generateConnectionQR(): Promise<{
    qrCodeUrl: string;
    deepLink: string;
    websocketUrl?: string;
    payloadId: string;
  }> {
    try {
      const payload = await this.createSignInPayload();
      if (!payload) {
        throw new Error('Failed to create connection payload');
      }

      return {
        qrCodeUrl: payload.refs.qr_png,
        deepLink: payload.next.always,
        websocketUrl: payload.refs.websocket_status,
        payloadId: payload.uuid
      };
    } catch (error) {
      console.error('Failed to generate QR code:', error);
      throw new Error(`QR generation failed: ${error.message}`);
    }
  }

  // Generate QR code for transaction signing
  public async generateTransactionQR(transaction: XRPLTransaction): Promise<{
    qrCodeUrl: string;
    deepLink: string;
    websocketUrl?: string;
    payloadId: string;
  }> {
    try {
      if (!this.currentAccount) {
        await this.ensureCurrentAccount();
      }
      if (!this.currentAccount) {
        throw new Error('No account connected');
      }

      const txWithAccount = {
        ...transaction,
        Account: this.currentAccount.address
      };

      const payload = {
        txjson: txWithAccount,
        user_token: await this.resolveUserToken(this.currentAccount.address),
        options: {
          submit: false,
          multi_sign: false,
          expire: 300
        },
        custom_meta: {
          identifier: this.payloadIdentifier('astryum-tx-qr'),
          blob: {
            purpose: 'SIGN_TRANSACTION',
            transaction_type: transaction.TransactionType,
            app_name: 'Astryum'
          },
          instruction: `Please sign this ${transaction.TransactionType} transaction`
        }
      };

      const payloadResponse = await this.createPayload(payload);
      if (!payloadResponse) {
        throw new Error('Failed to create transaction payload');
      }

      return {
        qrCodeUrl: payloadResponse.refs.qr_png,
        deepLink: payloadResponse.next.always,
        websocketUrl: payloadResponse.refs.websocket_status,
        payloadId: payloadResponse.uuid
      };
    } catch (error) {
      console.error('Failed to generate transaction QR:', error);
      throw new Error(`Transaction QR generation failed: ${error.message}`);
    }
  }

  /**
   * Gets user-friendly error message for display
   */
  public static getUserFriendlyErrorMessage(error: XamanError): string {
    switch (error.type) {
      case XamanErrorType.API_KEY_MISSING:
        return 'Xaman wallet is not properly configured. Please contact the app administrator.';

      case XamanErrorType.NETWORK_ERROR:
        return 'Network connection failed. Please check your internet connection and try again.';

      case XamanErrorType.TIMEOUT_ERROR:
        return 'Request timed out. Please check your connection and try again.';

      case XamanErrorType.USER_CANCELLED:
        return 'Connection was cancelled. Please try connecting again when you\'re ready.';

      case XamanErrorType.API_ERROR:
        if (error.details?.status === 401) {
          return 'Authentication failed. The app may need to be reconfigured.';
        }
        if (error.details?.status === 429) {
          return 'Too many requests. Please wait a moment and try again.';
        }
        return 'Xaman service is temporarily unavailable. Please try again later.';

      case XamanErrorType.INVALID_RESPONSE:
        return 'Received unexpected response from Xaman. Please try again.';

      case XamanErrorType.CONNECTION_FAILED:
        return 'Failed to connect to Xaman. Please check your internet connection.';

      case XamanErrorType.XRPL_ERROR:
        return 'XRPL network connection failed. Please try again.';

      default:
        return error.message || 'An unexpected error occurred. Please try again.';
    }
  }

  /**
   * Gets troubleshooting steps for an error
   */
  public static getTroubleshootingSteps(error: XamanError): string[] {
    const steps: string[] = [];

    switch (error.type) {
      case XamanErrorType.API_KEY_MISSING:
        steps.push('Contact the app administrator to configure Xaman API keys');
        steps.push('Ensure XAMAN_API_KEY and XAMAN_API_SECRET are set server-side (not as NEXT_PUBLIC_*)');
        break;

      case XamanErrorType.NETWORK_ERROR:
      case XamanErrorType.TIMEOUT_ERROR:
        steps.push('Check your internet connection');
        steps.push('Try refreshing the page');
        steps.push('Wait a moment and try again');
        if (error.retryable) {
          steps.push('The connection will be retried automatically');
        }
        break;

      case XamanErrorType.USER_CANCELLED:
        steps.push('Open the Xaman app on your device');
        steps.push('Look for the pending sign-in request');
        steps.push('Approve the connection within 5 minutes');
        break;

      case XamanErrorType.API_ERROR:
        if (error.details?.status === 429) {
          steps.push('Wait 30 seconds before trying again');
          steps.push('Avoid making too many requests quickly');
        } else {
          steps.push('Try again in a few minutes');
          steps.push('Check Xaman service status if the problem persists');
        }
        break;

      case XamanErrorType.XRPL_ERROR:
        steps.push('Check XRPL network status');
        steps.push('Try again in a few minutes');
        steps.push('The app will try alternative XRPL servers automatically');
        break;

      default:
        steps.push('Try refreshing the page');
        steps.push('Check your internet connection');
        steps.push('Try again in a few minutes');
        break;
    }

    return steps;
  }

  /**
   * Gets help URL for an error type
   */
  public static getHelpUrl(error: XamanError): string | null {
    switch (error.type) {
      case XamanErrorType.API_KEY_MISSING:
        return 'https://docs.xumm.dev/getting-started#create-api-credentials';

      case XamanErrorType.USER_CANCELLED:
        return 'https://docs.xumm.dev/getting-started#signing-payloads';

      default:
        return error.details?.helpUrl || error.details?.troubleshootingUrl || null;
    }
  }

  /**
   * Determines if error is actionable by the user
   */
  public static isUserActionable(error: XamanError): boolean {
    return [
      XamanErrorType.USER_CANCELLED,
      XamanErrorType.NETWORK_ERROR,
      XamanErrorType.TIMEOUT_ERROR
    ].includes(error.type);
  }

  /**
   * Gets connection status with detailed information
   */
  public getDetailedConnectionStatus(): {
    isConnected: boolean;
    currentAccount: WalletAccount | null;
    totalAccounts: number;
    xrplConnected: boolean;
    connectionQuality: 'excellent' | 'good' | 'poor' | 'disconnected';
  } {
    const xrplConnected = this.client.isConnected();

    let connectionQuality: 'excellent' | 'good' | 'poor' | 'disconnected' = 'disconnected';

    if (this._isConnected && xrplConnected) {
      connectionQuality = 'excellent';
    } else if (this._isConnected && !xrplConnected) {
      connectionQuality = 'good';
    } else if (this._isConnected) {
      connectionQuality = 'poor';
    }

    return {
      isConnected: this._isConnected,
      currentAccount: this.currentAccount,
      totalAccounts: this.connectedAccounts.size,
      xrplConnected,
      connectionQuality
    };
  }

  /**
   * Enhanced user feedback during connection process
   */
  public async connectWithUserFeedback(
    onProgress?: (step: string, details?: any) => void
  ): Promise<WalletAccount> {
    const progress = (step: string, details?: any) => {
      if (onProgress) {
        onProgress(step, details);
      }
    };

    try {
      progress('Validating configuration...');
      this.validateEnvironment();

      progress('Creating connection request...');
      const payload = await this.createSignInPayloadWithFallback();

      if (!payload) {
        throw new Error('Failed to create connection request');
      }

      progress('Waiting for user approval...', {
        qrCode: payload.refs.qr_png,
        deepLink: payload.next.always,
        payloadId: payload.uuid
      });

      const account = await this.waitForPayloadCompletion(payload);

      if (!account) {
        throw new Error('Connection was cancelled or timed out');
      }

      progress('Establishing XRPL connection...');
      await this.connectToXRPLWithFallback();

      progress('Finalizing connection...', { address: account.address });

      // Store account in connected accounts pool
      this.connectedAccounts.set(account.id, account);
      this.currentAccount = account;
      this._isConnected = true;
      this.connectionPromise = null;

      // Persist connection information
      this.persistConnectionState([account]);

      // Notify listeners
      this.accountChangeCallbacks.forEach(callback => callback(account));

      progress('Connection successful!', { account });
      return account;
    } catch (error: any) {
      progress('Connection failed', { error });
      throw error;
    }
  }
}
