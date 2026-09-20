/**
 * productizer it. 15 (4.5) — WHAT THE COPILOT IS ALLOWED TO SEE.
 *
 * `buildInternalContext` read the alerts table with no `userId`, so the five most
 * recent alerts OF THE WHOLE INSTALLATION — other people's liquidation warnings,
 * their wallet labels, their protocol names — were pasted into whoever happened
 * to open the chat, and travelled to Anthropic with the prompt. The conversation
 * history had the same shape: the id came from the request body and was never
 * checked against its owner.
 *
 * These assert the WHERE the builder sends: the fakes answer it honestly, so a
 * missing scope leaks here exactly as it leaked in production.
 */
const alertFindMany = jest.fn();
const messageFindMany = jest.fn();
const positionFindMany = jest.fn();

jest.mock('../../database/prismaClient', () => ({
  prisma: {
    agentMessage: { findMany: (...a: unknown[]) => messageFindMany(...a) },
    agentDocument: { findMany: jest.fn(async () => []) },
    userMCPConnection: { findMany: jest.fn(async () => []) },
    agentRule: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    walletBinding: { findMany: jest.fn(async () => [{ address: '0xowner', chainType: 'evm', mode: 'read' }]) },
    position: { findMany: (...a: unknown[]) => positionFindMany(...a) },
    alert: { findMany: (...a: unknown[]) => alertFindMany(...a) },
  },
}));

jest.mock('../AgentKeyService', () => ({
  agentKeyService: { resolveKey: jest.fn(async () => ({ source: 'astryum', model: 'claude-haiku-4-5' })) },
}));

import { agentContextBuilder } from '../AgentContextBuilder';

const ALERTS = [
  { userId: 'u1', message: 'Your HF is 1.2', priority: 'HIGH', timestamp: new Date(), acknowledged: false },
  { userId: 'someone-else', message: 'SECRET: rich person liquidation', priority: 'CRITICAL', timestamp: new Date(), acknowledged: false },
];
const MESSAGES = [
  { conversationId: 'c1', userId: 'u1', role: 'user', content: 'mine' },
  { conversationId: 'c-foreign', userId: 'someone-else', role: 'user', content: 'SECRET: another user chat' },
];

beforeEach(() => {
  jest.clearAllMocks();
  alertFindMany.mockImplementation(async ({ where }: any) =>
    ALERTS.filter((a) => a.acknowledged === where.acknowledged && (!where.userId || a.userId === where.userId)),
  );
  messageFindMany.mockImplementation(async ({ where }: any) =>
    MESSAGES.filter(
      (m) =>
        m.conversationId === where.conversationId &&
        (!where.conversation?.userId || m.userId === where.conversation.userId),
    ).map(({ role, content }) => ({ role, content })),
  );
  positionFindMany.mockResolvedValue([]);
});

describe('AgentContextBuilder — nothing of another account reaches the prompt', () => {
  it('summarises only THIS user\'s alerts', async () => {
    const ctx = await agentContextBuilder.build('u1', 'c1');
    expect(alertFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1', acknowledged: false } }));
    expect(ctx.internalContext).toContain('Your HF is 1.2');
    expect(ctx.internalContext).not.toContain('SECRET');
  });

  it('reads the history only when the conversation belongs to the caller', async () => {
    expect((await agentContextBuilder.build('u1', 'c1')).history).toEqual([{ role: 'user', content: 'mine' }]);
    // The id can be anything the client sends — a stranger's returns nothing.
    expect((await agentContextBuilder.build('u1', 'c-foreign')).history).toEqual([]);
    expect(messageFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { conversationId: 'c-foreign', conversation: { userId: 'u1' } } }),
    );
  });

  it('reads positions through the caller\'s own wallet rows', async () => {
    await agentContextBuilder.build('u1', 'c1');
    expect(positionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { wallet: { userId: 'u1', address: { in: ['0xowner'] } } } }),
    );
  });
});
