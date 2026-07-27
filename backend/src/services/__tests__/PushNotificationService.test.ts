jest.mock('../../database/prismaClient', () => {
  const devices: any[] = [];
  const logs: any[] = [];
  return {
    prisma: {
      device: {
        findMany: jest.fn(async ({ where }: any) =>
          devices.filter((d) => d.userId === where.userId)
        ),
        findUnique: jest.fn(async ({ where }: any) =>
          devices.find((d) => d.id === where.id) ?? null
        ),
      },
      notificationLog: {
        create: jest.fn(async ({ data }: any) => {
          logs.push(data);
          return data;
        }),
      },
    },
    __seedDevice(d: any) {
      devices.push(d);
    },
    __getLogs() {
      return logs;
    },
    __reset() {
      devices.length = 0;
      logs.length = 0;
    },
  };
});

const realFetch = global.fetch;

describe('PushNotificationService', () => {
  beforeEach(() => {
    const mod = require('../../database/prismaClient');
    (mod as any).__reset();
  });

  afterAll(() => {
    global.fetch = realFetch;
  });

  test('sendToUser skips when user has no devices and logs skipped', async () => {
    const { PushNotificationService } = require('../PushNotificationService');
    const svc = PushNotificationService.getInstance();
    const result = await svc.sendToUser('user-empty', {
      type: 'INTENT_READY',
      title: 't',
      body: 'b',
    });
    expect(result.skipped).toBe(1);
    expect(result.sent).toBe(0);
    const mod = require('../../database/prismaClient');
    expect((mod as any).__getLogs()[0].status).toBe('skipped');
  });

  test('sendToUser hits Expo gateway and counts ok tickets', async () => {
    const mod = require('../../database/prismaClient');
    (mod as any).__seedDevice({
      id: 'd1',
      userId: 'u1',
      pushToken: 'ExponentPushToken[abc]',
    });
    (mod as any).__seedDevice({
      id: 'd2',
      userId: 'u1',
      pushToken: 'ExponentPushToken[def]',
    });

    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          { status: 'ok', id: 'r1' },
          { status: 'ok', id: 'r2' },
        ],
      }),
    })) as any;

    const { PushNotificationService } = require('../PushNotificationService');
    const result = await PushNotificationService.getInstance().sendToUser('u1', {
      type: 'HF_CRITICAL',
      title: 'HF dropped',
      body: 'check now',
    });

    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body[0].channelId).toBe('critical');
  });

  test('sendToDevice returns false when device not found', async () => {
    const { PushNotificationService } = require('../PushNotificationService');
    const ok = await PushNotificationService.getInstance().sendToDevice('ghost', {
      type: 'INTENT_READY',
      title: 't',
      body: 'b',
    });
    expect(ok).toBe(false);
  });

  test('sendToDevice returns true when Expo accepts', async () => {
    const mod = require('../../database/prismaClient');
    (mod as any).__seedDevice({
      id: 'dev-1',
      userId: 'u1',
      pushToken: 'ExponentPushToken[xyz]',
    });
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })) as any;
    const { PushNotificationService } = require('../PushNotificationService');
    const ok = await PushNotificationService.getInstance().sendToDevice('dev-1', {
      type: 'TX_CONFIRMED',
      title: 't',
      body: 'b',
    });
    expect(ok).toBe(true);
  });
});
