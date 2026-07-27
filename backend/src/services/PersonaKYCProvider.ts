import crypto from 'crypto';

export type KycLevel = 'tier1' | 'tier2';
export type KycTier = 'none' | 'basic' | 'advanced';

export interface PersonaKycResult {
  readonly verified: boolean;
  readonly level: KycLevel;
  readonly inquiryId: string;
}

export interface KycSession {
  readonly inquiryId: string;
  readonly redirectUrl: string;
}

const PERSONA_API_BASE = 'https://withpersona.com/api/v1';
// Persona requires a version header on every request
const PERSONA_API_VERSION = '2023-01-05';

/**
 * Persona KYC provider — identity verification delegated entirely to Persona.
 *
 * Astryum receives ONLY the approval signal: { verified, level, inquiryId }.
 * No document content, no PII. Wallet linking is proved cryptographically
 * via the WalletBinding signature flow (walletBindings.ts) and stored locally.
 *
 * Multi-wallet support: one Persona inquiry per person.
 * Any wallet bound via /api/wallets/bindings/confirm inherits kycVerified
 * from the User record — no re-verification needed.
 *
 * PolicyGuard P38 — kycVerified must be true for regulated partner actions.
 */
export class PersonaKYCProvider {
  private readonly apiKey: string;
  private readonly webhookSecret: string;
  private readonly templateId: string;
  private readonly appRedirectBase: string;

  constructor() {
    this.apiKey = process.env.PERSONA_API_KEY ?? '';
    this.webhookSecret = process.env.PERSONA_WEBHOOK_SECRET ?? '';
    this.templateId = process.env.PERSONA_TEMPLATE_ID ?? '';
    this.appRedirectBase =
      process.env.PERSONA_REDIRECT_BASE_URL ?? 'https://defibro.app/app/kyc';

    const enabled = process.env.PERSONA_KYC_ENABLED !== 'false';
    if (enabled) {
      if (!this.apiKey) console.warn('[PersonaKYC] PERSONA_API_KEY not set — KYC initiation will fail');
      if (!this.webhookSecret) console.warn('[PersonaKYC] PERSONA_WEBHOOK_SECRET not set — webhooks will be rejected');
      if (!this.templateId) console.warn('[PersonaKYC] PERSONA_TEMPLATE_ID not set — KYC initiation will fail');
    }
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey && this.templateId);
  }

  /**
   * Create a Persona KYC inquiry for a user.
   * The user completes verification on Persona's hosted UI.
   * Astryum is notified via webhook — never handles documents.
   */
  async initiate(userId: string): Promise<KycSession> {
    if (!this.apiKey || !this.templateId) {
      throw Object.assign(new Error('Persona KYC is not configured'), {
        code: 'KYC_NOT_CONFIGURED',
      });
    }

    const response = await fetch(`${PERSONA_API_BASE}/inquiries`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        data: {
          attributes: {
            'inquiry-template-id': this.templateId,
            'reference-id': userId,
          },
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => 'unknown');
      throw Object.assign(
        new Error(`Persona inquiry creation failed: ${response.status} ${detail}`),
        { code: 'KYC_INITIATION_FAILED', status: response.status },
      );
    }

    const body = (await response.json()) as {
      data: { id: string; attributes: { 'meta': { 'session-token': string } } };
      meta?: { 'session-token': string };
    };

    const inquiryId: string = body.data.id;
    // Session token comes from top-level meta or nested in attributes
    const sessionToken: string =
      body.meta?.['session-token'] ??
      body.data.attributes?.['meta']?.['session-token'] ??
      '';

    const redirectUrl = sessionToken
      ? `https://withpersona.com/verify?inquiry-id=${inquiryId}&session-token=${encodeURIComponent(sessionToken)}`
      : `https://withpersona.com/verify?inquiry-id=${inquiryId}`;

    return { inquiryId, redirectUrl };
  }

  /**
   * Add a wallet address tag to a Persona inquiry.
   * Called after a WalletBinding is confirmed so the audit trail in Persona
   * reflects all wallets this identity has proved ownership of.
   *
   * Tag format: "wallet:{chainType}:{address}"
   * e.g. "wallet:evm:0x1234...", "wallet:xrpl:rXXXX..."
   *
   * Fails silently — wallet linking in Astryum DB is the source of truth.
   * Persona tags are supplemental audit data.
   *
   * Persona API: POST /inquiries/{id}/add-tag with { meta: { 'tag-name': string } }
   */
  async tagWalletLinked(
    inquiryId: string,
    address: string,
    chainType: string,
  ): Promise<void> {
    if (!this.apiKey) return;

    const tagName = `wallet:${chainType}:${address.toLowerCase()}`;

    try {
      const response = await fetch(`${PERSONA_API_BASE}/inquiries/${inquiryId}/add-tag`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ meta: { 'tag-name': tagName } }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        console.warn(`[PersonaKYC] tagWalletLinked failed (non-fatal): ${response.status} ${detail}`);
      }
    } catch (err: any) {
      console.warn('[PersonaKYC] tagWalletLinked network error (non-fatal):', err?.message);
    }
  }

  /**
   * Remove a wallet tag from a Persona inquiry when a binding is deleted.
   * Fails silently — local DB is source of truth.
   *
   * Persona API: POST /inquiries/{id}/remove-tag with { meta: { 'tag-name': string } }
   */
  async untagWalletLinked(
    inquiryId: string,
    address: string,
    chainType: string,
  ): Promise<void> {
    if (!this.apiKey) return;

    const tagName = `wallet:${chainType}:${address.toLowerCase()}`;

    try {
      const response = await fetch(`${PERSONA_API_BASE}/inquiries/${inquiryId}/remove-tag`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ meta: { 'tag-name': tagName } }),
      });

      if (!response.ok) {
        console.warn(`[PersonaKYC] untagWalletLinked failed (non-fatal): ${response.status}`);
      }
    } catch (err: any) {
      console.warn('[PersonaKYC] untagWalletLinked error (non-fatal):', err?.message);
    }
  }

  /**
   * Verify the Persona webhook signature.
   * Persona sends: Persona-Signature: t={timestamp},v1={hmac-sha256}
   * Returns false if secret is not configured.
   */
  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean {
    if (!this.webhookSecret) return false;

    // Parse "t=...,v1=..." format
    const parts = Object.fromEntries(
      signatureHeader.split(',').map(p => p.split('=') as [string, string]),
    );
    const timestamp = parts['t'];
    const v1 = parts['v1'];
    if (!timestamp || !v1) return false;

    const payload = `${timestamp}.${rawBody}`;
    const expected = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(payload)
      .digest('hex');

    try {
      return crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  /**
   * Parse Persona webhook into Astryum's canonical KYC result.
   *
   * Accepted events: inquiry.approved → verified=true
   *                  inquiry.declined  → verified=false
   *
   * Payload shape:
   * { data: { id: "inq_...", attributes: { status, "reference-id" } }, events: "inquiry.approved" }
   */
  parseWebhookPayload(body: unknown): {
    userId: string;
    inquiryId: string;
    result: PersonaKycResult;
  } | null {
    if (typeof body !== 'object' || body === null) return null;

    const b = body as Record<string, unknown>;
    const event = (b['events'] ?? b['event']) as string | undefined;
    if (event !== 'inquiry.approved' && event !== 'inquiry.declined') return null;

    const data = b['data'] as Record<string, unknown> | undefined;
    if (!data) return null;

    const attrs = data['attributes'] as Record<string, unknown> | undefined;
    const inquiryId = (data['id'] ?? '') as string;
    const userId = (attrs?.['reference-id'] ?? '') as string;

    if (!inquiryId || !userId) return null;

    const verified = event === 'inquiry.approved';

    // Persona doesn't expose a tier/level by default — map from the inquiry template
    // or hardcode tier1 for standard verification, tier2 for enhanced.
    // PERSONA_TIER2_TEMPLATE_ID env var marks if this is an advanced-level inquiry.
    const tier2TemplateId = process.env.PERSONA_TIER2_TEMPLATE_ID ?? '';
    const usedTemplateId = (attrs?.['inquiry-template-id'] ?? '') as string;
    const level: KycLevel =
      tier2TemplateId && usedTemplateId === tier2TemplateId ? 'tier2' : 'tier1';

    return { userId, inquiryId, result: { verified, level, inquiryId } };
  }

  /**
   * Map Persona level to Astryum kycTier.
   */
  static levelToTier(verified: boolean, level: KycLevel): KycTier {
    if (!verified) return 'none';
    return level === 'tier2' ? 'advanced' : 'basic';
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      'Persona-Version': PERSONA_API_VERSION,
    };
  }
}

export const personaKYCProvider = new PersonaKYCProvider();
