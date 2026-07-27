import crypto from 'crypto';
import { prisma } from '../database/prismaClient';
import Anthropic from '@anthropic-ai/sdk';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

// Master key for AES-256-GCM of user API keys. FAIL-SAFE GATE (build spec C3):
// in production we REFUSE to fall back to the dev default — encrypting/decrypting
// real user keys under a shared constant would let anyone with the codebase read
// them. In prod the secret MUST be set; otherwise we throw loudly rather than use
// the default. Dev/test keep the default so local flows work.
// ⚠ OPS: if user keys were ALREADY stored under the dev default, re-encrypt them
// with the new secret BEFORE setting it (read old → write new), or they become
// undecryptable. See docs/context/Astryum_BuildSpec_3_Componentes §C3.
const DEV_MASTER_SECRET = 'defibro-dev-secret-32bytes!!!!!';

function getMasterKey(): Buffer {
  const secret = process.env.AGENT_KEY_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'AGENT_KEY_SECRET (or JWT_SECRET) must be set in production — refusing to ' +
          'encrypt/decrypt user API keys with the dev default. If keys were already ' +
          'stored under the dev default, re-encrypt them before setting the secret ' +
          '(build spec C3).',
      );
    }
    return crypto.createHash('sha256').update(DEV_MASTER_SECRET).digest();
  }
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, getMasterKey(), iv) as crypto.CipherGCM;
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // format: iv(12) + tag(16) + ciphertext — all base64
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(encoded: string): string {
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const enc = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv(ALGO, getMasterKey(), iv) as crypto.DecipherGCM;
  decipher.setAuthTag(tag);
  return decipher.update(enc).toString('utf8') + decipher.final('utf8');
}

export interface KeyResolution {
  key: string;
  source: 'user' | 'defibro';
  model: string;
}

export class AgentKeyService {
  private static instance: AgentKeyService;
  static getInstance(): AgentKeyService {
    if (!this.instance) this.instance = new AgentKeyService();
    return this.instance;
  }

  async saveUserAPIKey(userId: string, apiKey: string, model?: string): Promise<void> {
    const keyEnc = encrypt(apiKey);
    await prisma.userAnthropicKey.upsert({
      where: { userId },
      create: { userId, keyEnc, model: model ?? 'claude-sonnet-4-6', addedAt: new Date() },
      update: { keyEnc, model: model ?? 'claude-sonnet-4-6', lastUsedAt: new Date() },
    });
  }

  async getDecryptedKey(userId: string): Promise<string | null> {
    const rec = await prisma.userAnthropicKey.findUnique({ where: { userId } });
    if (!rec) return null;
    try {
      return decrypt(rec.keyEnc);
    } catch {
      return null;
    }
  }

  async deleteUserKey(userId: string): Promise<void> {
    await prisma.userAnthropicKey.deleteMany({ where: { userId } });
  }

  async getUserKeyRecord(userId: string): Promise<{ model: string; addedAt: Date; lastUsedAt: Date | null } | null> {
    const rec = await prisma.userAnthropicKey.findUnique({ where: { userId } });
    if (!rec) return null;
    return { model: rec.model, addedAt: rec.addedAt, lastUsedAt: rec.lastUsedAt };
  }

  async validateKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const client = new Anthropic({ apiKey });
      await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      });
      return { valid: true };
    } catch (err: any) {
      const msg: string = err?.message ?? String(err);
      if (msg.includes('401') || msg.includes('invalid') || msg.includes('authentication')) {
        return { valid: false, error: 'Invalid API key' };
      }
      // Network / rate limit errors — assume key format is OK
      return { valid: true };
    }
  }

  async resolveKey(userId: string): Promise<KeyResolution> {
    const rec = await prisma.userAnthropicKey.findUnique({ where: { userId } });
    if (rec) {
      try {
        const key = decrypt(rec.keyEnc);
        await prisma.userAnthropicKey.update({ where: { userId }, data: { lastUsedAt: new Date() } });
        return { key, source: 'user', model: rec.model };
      } catch {
        // fall through to Astryum key
      }
    }
    const defibro = process.env.ANTHROPIC_API_KEY;
    if (!defibro) throw new Error('No Anthropic API key available. Please add your key in Settings → Agent.');
    return { key: defibro, source: 'defibro', model: 'claude-haiku-4-5-20251001' };
  }

  /** Encrypt an arbitrary string (reused for MCP API keys) */
  encryptValue(value: string): string {
    return encrypt(value);
  }

  /** Decrypt an arbitrary string encrypted by encryptValue */
  decryptValue(encoded: string): string {
    return decrypt(encoded);
  }
}

export const agentKeyService = AgentKeyService.getInstance();
