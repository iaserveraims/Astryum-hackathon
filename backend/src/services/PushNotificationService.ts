import { prisma } from '../database/prismaClient';

/**
 * Expo Push Notifications wrapper.
 *
 * Uses the Expo Push API gateway (https://exp.host/--/api/v2/push/send) which
 * routes through APNs (iOS) and FCM (Android) on our behalf. Requires only
 * the device's Expo push token — no native credentials needed in V1.
 *
 * For higher throughput in production, batches up to 100 messages per call.
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH_LIMIT = 100;

export type NotificationType =
  | 'HF_CRITICAL'
  | 'HF_BELOW'
  | 'INTENT_READY'
  | 'TX_CONFIRMED'
  | 'TX_FAILED'
  | 'POINTS_EARNED'
  | 'BADGE_UNLOCKED'
  | 'RULE_FIRED'
  | 'LP_OUT_OF_RANGE'
  | 'REWARDS_THRESHOLD'
  | 'GOAL_REQUEST'
  | 'BACKUP_TRIGGERED'
  /** XRPL savings-escrow rule fired — nudge to the Savings surface (B.1). */
  | 'SAVINGS_READY';

export interface PushPayload {
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Deep-link path used by mobile linking config (e.g. /intent/clxyz, /alerts) */
  url?: string;
}

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default';
  priority?: 'default' | 'high';
  channelId?: string;
}

interface ExpoTicketResponse {
  data?: Array<{ status: 'ok' | 'error'; id?: string; message?: string }>;
  errors?: Array<{ code: string; message: string }>;
}

export class PushNotificationService {
  private static instance: PushNotificationService | null = null;
  static getInstance(): PushNotificationService {
    if (!this.instance) this.instance = new PushNotificationService();
    return this.instance;
  }

  /**
   * Send a push to all devices registered for a user. Best-effort: failures
   * are logged but don't throw (so cron jobs don't break).
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<{
    sent: number;
    failed: number;
    skipped: number;
  }> {
    const devices = await prisma.device
      .findMany({ where: { userId } })
      .catch(() => [] as any[]);

    if (devices.length === 0) {
      // Still log so we know the event happened
      await this.logRecord(userId, null, payload, 'skipped').catch(() => undefined);
      return { sent: 0, failed: 0, skipped: 1 };
    }

    const messages: ExpoMessage[] = devices.map((d): ExpoMessage => ({
      to: d.pushToken,
      title: payload.title,
      body: payload.body,
      data: { type: payload.type, url: payload.url, ...payload.data },
      sound: 'default' as const,
      priority: 'high' as const,
      channelId: payload.type.startsWith('HF_') ? 'critical' : 'default',
    }));

    let sent = 0;
    let failed = 0;
    for (let i = 0; i < messages.length; i += EXPO_BATCH_LIMIT) {
      const batch = messages.slice(i, i + EXPO_BATCH_LIMIT);
      try {
        const r = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(batch),
        });
        if (!r.ok) {
          failed += batch.length;
          continue;
        }
        const json = (await r.json()) as ExpoTicketResponse;
        const tickets = json.data ?? [];
        sent += tickets.filter((t) => t.status === 'ok').length;
        failed += tickets.filter((t) => t.status === 'error').length;
      } catch {
        failed += batch.length;
      }
    }

    // Log per-device
    for (const d of devices) {
      await this.logRecord(userId, d.id, payload, 'sent').catch(() => undefined);
    }

    return { sent, failed, skipped: 0 };
  }

  /**
   * Send to a specific device id (e.g. for testing).
   */
  async sendToDevice(deviceId: string, payload: PushPayload): Promise<boolean> {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) return false;
    const r = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        {
          to: device.pushToken,
          title: payload.title,
          body: payload.body,
          data: { type: payload.type, url: payload.url, ...payload.data },
          sound: 'default',
          priority: 'high',
        },
      ]),
    }).catch(() => null);
    const ok = !!r && r.ok;
    await this.logRecord(device.userId, deviceId, payload, ok ? 'sent' : 'failed').catch(
      () => undefined
    );
    return ok;
  }

  private async logRecord(
    userId: string,
    deviceId: string | null,
    payload: PushPayload,
    status: 'pending' | 'sent' | 'failed' | 'skipped'
  ): Promise<void> {
    try {
      await prisma.notificationLog.create({
        data: {
          userId,
          deviceId: deviceId ?? undefined,
          type: payload.type,
          title: payload.title,
          body: payload.body,
          payload: payload.data ? (payload.data as object) : undefined,
          status,
        },
      });
    } catch {
      /* swallow */
    }
  }
}
