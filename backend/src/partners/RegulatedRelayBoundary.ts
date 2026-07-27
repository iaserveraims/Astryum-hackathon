/**
 * RegulatedRelayBoundary
 *
 * This is the explicit boundary between Astryum (preparation)
 * and the regulated relay infrastructure (transmission).
 *
 * Astryum:
 *   prepares IntentPayload → creates IntentAuthorizationSession
 *   → receives authorizationProof from user → exports payload
 *
 * Regulated relay (Turnkey / partner / user wallet):
 *   receives signed payload → transmits → obtains receipt
 *
 * Astryum NEVER: tracks txHash operationally, selects mempools,
 * guarantees execution, or stores signed transactions.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../database/prismaClient';
import type { IntentPayload } from '../types/IntentPayload';
import { createHash } from 'crypto';

export interface AuthorizationProof {
  signedPayloadHash: string;
  signedAt: string;
  walletAddress: string;
  signatureScheme: 'eip712' | 'secp256k1' | 'ed25519';
}

export class RegulatedRelayBoundary {
  /**
   * Creates a new authorization session for the given IntentPayload.
   * Session expires in 5 minutes (matches IntentPayload.expiry.ttlSeconds).
   */
  async createAuthorizationSession(input: {
    userId: string;
    intentPayload: IntentPayload;
  }) {
    const payloadHash = this._hashPayload(input.intentPayload);
    const expiresAt = new Date(input.intentPayload.expiry.expiresAt);

    return prisma.intentAuthorizationSession.create({
      data: {
        userId: input.userId,
        intentPayloadId: input.intentPayload.intentId,
        status: 'pending_user_review',
        payloadHash,
        expiresAt,
      },
    });
  }

  /**
   * Records that the user authorized the intent.
   * Accepts an authorizationProof — NOT a txHash.
   * Astryum does not track what happens after the proof is exported.
   */
  async markUserAuthorized(
    sessionId: string,
    authorizationProof: AuthorizationProof,
  ) {
    const session = await prisma.intentAuthorizationSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.status !== 'pending_user_review') {
      throw new Error(`Session ${sessionId} is not in pending_user_review status (is: ${session.status})`);
    }
    if (session.expiresAt < new Date()) {
      throw new Error(`Session ${sessionId} has expired`);
    }

    return prisma.intentAuthorizationSession.update({
      where: { id: sessionId },
      data: {
        status: 'user_authorized',
        authorizationProof: authorizationProof as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async getSessionStatus(sessionId: string, userId: string) {
    const session = await prisma.intentAuthorizationSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.userId !== userId) throw new Error('Unauthorized');
    return session;
  }

  async cancelSession(sessionId: string, userId: string, reason?: string) {
    const session = await prisma.intentAuthorizationSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.userId !== userId) throw new Error('Unauthorized');
    if (session.status !== 'pending_user_review') {
      throw new Error(`Cannot cancel session in status: ${session.status}`);
    }

    await prisma.intentAuthorizationSession.update({
      where: { id: sessionId },
      data: { status: 'cancelled', cancelReason: reason ?? 'user_cancelled' },
    });
  }

  /**
   * Marks all sessions that have passed their expiresAt as expired.
   * Run on a 60s cron.
   */
  async expireStaleSessions(): Promise<number> {
    const result = await prisma.intentAuthorizationSession.updateMany({
      where: {
        status: 'pending_user_review',
        expiresAt: { lt: new Date() },
      },
      data: { status: 'expired' },
    });
    return result.count;
  }

  /**
   * Exports the intent payload for delivery to the partner relay.
   * Astryum does not track what happens after this export — correct by design.
   * The relay transmits; Astryum never knows the txHash.
   */
  async exportToPartnerRelay(
    sessionId: string,
    intentPayload: IntentPayload,
  ): Promise<{ payload: IntentPayload; exportedAt: string }> {
    const session = await prisma.intentAuthorizationSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.status !== 'user_authorized') {
      throw new Error(
        `Cannot export session ${sessionId}: status is ${session.status}, expected user_authorized`,
      );
    }

    const exportedAt = new Date().toISOString();
    // After export, Astryum stops. No txHash tracking. No execution guarantee.
    return { payload: intentPayload, exportedAt };
  }

  private _hashPayload(payload: IntentPayload): string {
    const canonical = JSON.stringify({
      intentId: payload.intentId,
      tx: payload.tx,
      expiry: payload.expiry,
    });
    return createHash('sha256').update(canonical).digest('hex');
  }
}

export const regulatedRelayBoundary = new RegulatedRelayBoundary();
