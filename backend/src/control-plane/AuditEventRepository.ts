import { prisma } from '../database/prismaClient';
import type { CanonicalAuditEvent } from '../canonical/types/AuditEvent';

/**
 * Persists CanonicalAuditEvent rows to Prisma. Failures must NEVER block a
 * router call — they are logged and swallowed so the request still returns.
 */
export class AuditEventRepository {
  async record(ev: CanonicalAuditEvent, payload?: unknown): Promise<void> {
    try {
      await prisma.auditEvent.create({
        data: {
          traceId: ev.traceId,
          providerId: ev.providerId,
          capability: ev.capability,
          decision: ev.decision,
          latencyMs: ev.latencyMs,
          cached: ev.cached,
          fellBack: ev.fellBack,
          payload: payload === undefined ? undefined : (payload as object),
          timestamp: new Date(ev.timestamp),
        },
      });
    } catch (err) {
      // graceful: audit write failure must not break user calls
      console.warn('[audit] persist failed:', (err as Error).message);
    }
  }
}

export const auditEventRepository = new AuditEventRepository();
