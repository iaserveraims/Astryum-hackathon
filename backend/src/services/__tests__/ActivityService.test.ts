jest.mock('../../database/prismaClient', () => {
  const rows: any[] = [];
  return {
    prisma: {
      activityEvent: {
        findMany: jest.fn(async ({ where, orderBy, take, skip }: any) => {
          const filtered = rows.filter((r) => {
            if (where.wallet && r.wallet !== where.wallet) return false;
            if (where.type?.in && !where.type.in.includes(r.type)) return false;
            if (where.timestamp?.gte && r.timestamp < where.timestamp.gte) return false;
            if (where.timestamp?.lte && r.timestamp > where.timestamp.lte) return false;
            return true;
          });
          filtered.sort(
            (a, b) => (b.timestamp as Date).getTime() - (a.timestamp as Date).getTime(),
          );
          return filtered.slice(skip ?? 0, (skip ?? 0) + (take ?? 100));
        }),
        upsert: jest.fn(async ({ create }: any) => {
          rows.push(create);
          return create;
        }),
      },
    },
    __reset() {
      rows.length = 0;
    },
    __rows: rows,
  };
});

import { ActivityService } from '../ActivityService';
import type { ControlPlane } from '../../control-plane/ControlPlane';

const WALLET = '0x000000000000000000000000000000000000abcd';

const makeCp = (txs: unknown[], transfers: unknown[] = []): ControlPlane =>
  ({
    call: jest.fn(async (capability: string) => {
      if (capability === 'explorer.getActivity') {
        return {
          data: txs,
          source: {
            providerId: 'flarescan',
            providerType: 'explorer',
            trustLevel: 'indexer_verified',
            fetchedAt: new Date().toISOString(),
            traceId: 't',
          },
          cached: false,
        };
      }
      if (capability === 'explorer.getTokenTransfers') {
        return {
          data: transfers,
          source: {
            providerId: 'flarescan',
            providerType: 'explorer',
            trustLevel: 'indexer_verified',
            fetchedAt: new Date().toISOString(),
            traceId: 't',
          },
          cached: false,
        };
      }
      throw new Error(`unexpected_capability: ${capability}`);
    }),
  }) as unknown as ControlPlane;

describe('ActivityService', () => {
  beforeEach(() => {
    const mod = require('../../database/prismaClient');
    mod.__reset();
  });

  it('classifies tx selectors into canonical ActivityType', async () => {
    const cp = makeCp(
      [
        {
          hash: '0xaaa',
          blockNumber: '100',
          timeStamp: '1700000000',
          input: '0xa0712d68' + '0'.repeat(64), // mint → supply
          to: '0xkUSDC',
        },
        {
          hash: '0xbbb',
          blockNumber: '101',
          timeStamp: '1700000060',
          input: '0xc5ebeaec' + '0'.repeat(64), // borrow
          to: '0xkUSDC',
        },
        {
          hash: '0xccc',
          blockNumber: '102',
          timeStamp: '1700000120',
          input: '0x095ea7b3' + '0'.repeat(64), // approve
          to: '0xtoken',
        },
        {
          hash: '0xddd',
          blockNumber: '103',
          timeStamp: '1700000180',
          input: '0xdeadbeef' + '0'.repeat(64), // unknown → other
          to: '0x???',
        },
      ],
      [],
    );
    const svc = new ActivityService(cp);
    await svc.refreshFromExplorer(WALLET);
    const events = await svc.getTimeline(WALLET);
    const types = events.map((e) => e.type).sort();
    expect(types).toEqual(['approve', 'borrow', 'other', 'supply']);
  });

  it('classifies erc20 token transfers based on direction', async () => {
    const cp = makeCp(
      [],
      [
        {
          hash: '0xeee',
          blockNumber: '200',
          timeStamp: '1700000240',
          contractAddress: '0xtok',
          tokenSymbol: 'USDC.e',
          tokenDecimal: '6',
          from: WALLET,
          to: '0xother',
          value: '1000000',
        },
      ],
    );
    const svc = new ActivityService(cp);
    await svc.refreshFromExplorer(WALLET);
    const events = await svc.getTimeline(WALLET);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('transfer');
    expect(events[0].assetOut?.asset.symbol).toBe('USDC.e');
    expect(events[0].assetOut?.amount).toBe('1000000');
    expect(events[0].assetIn).toBeUndefined();
  });

  it('returns [] from cache when explorer has no data and no refresh requested', async () => {
    const cp = makeCp([], []);
    const svc = new ActivityService(cp);
    const events = await svc.getTimeline(WALLET);
    expect(events).toEqual([]);
  });

  it('filters by ActivityType when types[] passed', async () => {
    const cp = makeCp(
      [
        { hash: '0x1', blockNumber: '1', timeStamp: '1700000000', input: '0xa0712d68', to: '0xa' },
        { hash: '0x2', blockNumber: '2', timeStamp: '1700000060', input: '0xc5ebeaec', to: '0xa' },
      ],
      [],
    );
    const svc = new ActivityService(cp);
    await svc.refreshFromExplorer(WALLET);
    const onlyBorrow = await svc.getTimeline(WALLET, { types: ['borrow'] });
    expect(onlyBorrow).toHaveLength(1);
    expect(onlyBorrow[0].type).toBe('borrow');
  });

  it('skips refresh failures gracefully', async () => {
    const cp = {
      call: jest.fn().mockRejectedValue(new Error('flarescan_http_429')),
    } as unknown as ControlPlane;
    const svc = new ActivityService(cp);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const events = await svc.getTimeline(WALLET, { forceRefresh: true });
    warn.mockRestore();
    expect(events).toEqual([]);
  });

  // Familia "éxito no ganado" (2026-08-03): el explorador de Flare se cayó, el
  // timeline devolvió [] y la pantalla dijo "No activity yet" — un hecho sobre
  // el capital del usuario que no podíamos saber. Un [] por ceguera tiene que
  // llegar a la UI marcado como tal.
  it('flags explorer.ok=false when the read failed — an empty list by blindness is not an empty history', async () => {
    const cp = {
      call: jest.fn().mockRejectedValue(new Error('flarescan_unreachable: down')),
    } as unknown as ControlPlane;
    const svc = new ActivityService(cp);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await svc.getTimelineWithStatus(WALLET, { forceRefresh: true });
    warn.mockRestore();
    expect(r.events).toEqual([]);
    expect(r.explorer.ok).toBe(false);
    expect(r.explorer.reason).toContain('flarescan_unreachable');
  });

  it('flags explorer.ok=true when the explorer answers an honestly empty wallet', async () => {
    const svc = new ActivityService(makeCp([], []));
    const r = await svc.getTimelineWithStatus(WALLET, { forceRefresh: true });
    expect(r.events).toEqual([]);
    expect(r.explorer.ok).toBe(true);
  });

  // Media lectura es lectura incompleta: si tokentx cae y txlist no, faltan
  // transferencias ERC-20 en el timeline y el usuario no puede enterarse.
  it('flags explorer.ok=false when only ONE of the two reads failed', async () => {
    const cp = {
      call: jest.fn(async (capability: string) => {
        if (capability === 'explorer.getActivity') {
          return {
            data: [],
            source: { providerId: 'flarescan', providerType: 'explorer', trustLevel: 'indexer_verified', fetchedAt: new Date().toISOString(), traceId: 't' },
            cached: false,
          };
        }
        throw new Error('flarescan_http_503');
      }),
    } as unknown as ControlPlane;
    const svc = new ActivityService(cp);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await svc.getTimelineWithStatus(WALLET, { forceRefresh: true });
    warn.mockRestore();
    expect(r.explorer.ok).toBe(false);
    expect(r.explorer.reason).toContain('503');
  });

  // Bug family "lectura ciega al código de resultado" (instance 6): a mined but
  // REVERTED borrow()/supply() has a receipt and did nothing — Flarescan flags it
  // isError='1' / txreceipt_status='0'. Rendering it as a completed action lets the
  // timeline claim work that never happened. Sibling rails already guarded; this
  // Flarescan rail did not.
  it('drops reverted Flarescan txs — a mined revert (isError / txreceipt_status) is not a completed action', async () => {
    const cp = makeCp(
      [
        // succeeded → survives
        { hash: '0xok', blockNumber: '1', timeStamp: '1700000000', input: '0xa0712d68', to: '0xk' },
        // reverted via isError='1' → dropped (would otherwise classify as 'borrow')
        { hash: '0xrev1', blockNumber: '2', timeStamp: '1700000060', input: '0xc5ebeaec', to: '0xk', isError: '1' },
        // reverted via txreceipt_status='0' → dropped (would otherwise classify as 'supply')
        { hash: '0xrev2', blockNumber: '3', timeStamp: '1700000120', input: '0xa0712d68', to: '0xk', txreceipt_status: '0' },
      ],
      [],
    );
    const svc = new ActivityService(cp);
    await svc.refreshFromExplorer(WALLET);
    const events = await svc.getTimeline(WALLET);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('supply');
  });
});
