jest.mock('../../database/prismaClient', () => ({
  prisma: {
    alert: { create: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
  },
}));

import { RiskInboxService } from '../RiskInboxService';
import { prisma } from '../../database/prismaClient';

const alert = (prisma as unknown as {
  alert: { create: jest.Mock; findMany: jest.Mock; updateMany: jest.Mock };
}).alert;

const svc = new RiskInboxService();
beforeEach(() => jest.clearAllMocks());

describe('RiskInboxService (D8, backed by Alert)', () => {
  test('add carries the unsigned Review & Sign intent in data', async () => {
    alert.create.mockResolvedValue({ id: 'a1' });
    const out = await svc.add({
      userId: 'u1',
      type: 'approval_risk',
      priority: 'HIGH',
      title: 'Risky allowance',
      message: 'Revoke unlimited USDC approval',
      reviewAndSign: { to: '0xToken', calldata: '0x095ea7b3...', kind: 'erc20_approve' },
    });
    expect(out.id).toBe('a1');
    const data = alert.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ userId: 'u1', type: 'approval_risk', acknowledged: false });
    expect(data.data.reviewAndSign).toMatchObject({ to: '0xToken', kind: 'erc20_approve' });
  });

  test('list filters to open risk-type items for the user', async () => {
    alert.findMany.mockResolvedValue([{ id: 'a1' }]);
    await svc.list('u1');
    const where = alert.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ userId: 'u1', acknowledged: false });
    expect(where.type.in).toEqual(expect.arrayContaining(['approval_risk', 'bridge_risk', 'security']));
  });

  test('acknowledge is ownership-scoped and reports whether a row changed', async () => {
    alert.updateMany.mockResolvedValue({ count: 1 });
    expect(await svc.acknowledge('a1', 'u1')).toBe(true);
    expect(alert.updateMany).toHaveBeenCalledWith({ where: { id: 'a1', userId: 'u1' }, data: { acknowledged: true } });

    alert.updateMany.mockResolvedValue({ count: 0 });
    expect(await svc.acknowledge('a1', 'intruder')).toBe(false);
  });
});
