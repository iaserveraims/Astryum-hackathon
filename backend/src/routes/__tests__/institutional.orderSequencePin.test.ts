/**
 * UNA ORDEN FIRMABLE POR ASIENTO — las órdenes que firma una cuenta de
 * consejo en Xaman salen con la Sequence fijada.
 */
import express from 'express';
import request from 'supertest';

const COUNCIL = 'rQ3fNyLjbvcDaPNS4EAJY8aT9zw3oLjAaY';
const FACTORY = '0xfac0000000000000000000000000000000000001';
const CAGE_ADDR = '0xca9e000000000000000000000000000000000002';
const BRIDGE = '0xb41d000000000000000000000000000000000003';
const VALIDATED = 90_000_000;
let mockExistingCage: { cage: string; bridge: string } | null = null;

const mockXrplJsonRpc = jest.fn();
jest.mock('../../services/flare/DirectMintExecutorService', () => ({
  xrplJsonRpc: (...a: unknown[]) => mockXrplJsonRpc(...a),
}));

jest.mock('../../services/flare/LegacyCageResolver', () => ({
  ...jest.requireActual('../../services/flare/LegacyCageResolver'),
  isCageV2Council: jest.fn(async () => false),
  cageForCouncil: jest.fn(async () => ({
    chain: 'flare',
    rpcUrl: 'http://rpc.invalid',
    sourceId: 'XRP',
    explorerTx: '',
    bridge: BRIDGE,
    vault: CAGE_ADDR,
    orderAnchor: 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH',
  })),
  astryumCageFactoryAddress: jest.fn(() => FACTORY),
}));

jest.mock('../../services/ManagerCredentialGate', () => ({
  managerGateConfig: jest.fn(() => ({ enabled: false })),
  checkManagerCredential: jest.fn(),
  managerGateRefusal: jest.fn(),
}));

const orderTx = () => ({
  TransactionType: 'Payment',
  Account: COUNCIL,
  Destination: 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH',
  Amount: '1',
  Memos: [{ Memo: { MemoData: 'AB'.repeat(32) } }],
});
const order = { action: 'recall', orderHash: `0x${'11'.repeat(32)}`, orderData: '0xdead', nonce: 7, summary: 's' };
const disclosure = { disclosedToUser: true, astryumSigns: false, note: '', facts: {} };

const mockBuildCouncilOrder = jest.fn(async () => ({ xrplTx: orderTx(), order, disclosure }));
jest.mock('../../connectors/protocols/xrpl/XrplCouncilOrderService', () => ({
  ...jest.requireActual('../../connectors/protocols/xrpl/XrplCouncilOrderService'),
  buildCouncilOrderHandoff: (...a: unknown[]) => mockBuildCouncilOrder(...(a as [])),
  legacyNetworkConfig: () => ({
    chain: 'flare',
    rpcUrl: 'http://rpc.invalid',
    sourceId: 'XRP',
    explorerTx: '',
    orderAnchor: 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH',
  }),
}));

const mockBuildCageOrder = jest.fn(async () => ({ xrplTx: orderTx(), order, disclosure }));
jest.mock('../../connectors/protocols/xrpl/AstryumCageOrderService', () => ({
  ...jest.requireActual('../../connectors/protocols/xrpl/AstryumCageOrderService'),
  buildCageOrderHandoff: (...a: unknown[]) => mockBuildCageOrder(...(a as [])),
}));

class MockCageCreationError extends Error {
  code = 'X';
}
jest.mock('../../services/flare/AstryumCageCreationService', () => ({
  // /cage-order necesita la jaula encontrada; /cage-create, que NO exista todavía.
  resolveAstryumCage: jest.fn(async () => mockExistingCage),
  predictCageAddresses: jest.fn(async () => ({ cage: CAGE_ADDR, bridge: BRIDGE })),
  buildCageCreationBatch: jest.fn(() => []),
  readFactoryTerms: jest.fn(async () => ({
    creationFee: 0n,
    treasury: '0x0000000000000000000000000000000000000009',
    registry: '0x0000000000000000000000000000000000000008',
    freePotesPerCage: 3,
    maxPayeeBpsAllowed: 2000,
  })),
  validateCageParams: jest.fn(),
  CageCreationError: MockCageCreationError,
}));

const mockBuildDirectMint = jest.fn(async () => ({
  personalAccount: '0x00000000000000000000000000000000000000pa',
  memoHex: 'FE'.repeat(32),
  userOpData: '0x',
  xrplPayment: { TransactionType: 'Payment', Account: COUNCIL, Destination: 'rCoreVault1111111111111111111', Amount: '2000000', Memos: [] },
}));
jest.mock('../../connectors/protocols/flare/FlareDirectMintService', () => ({
  readDirectMintParams: jest.fn(async () => ({})),
  computeNetMint: jest.fn(() => ({ supplyUBA: 1_000_000n })),
  buildDirectMintHandoff: (...a: unknown[]) => mockBuildDirectMint(...(a as [])),
  mintFeeDisclosure: jest.fn(() => ({})),
}));
jest.mock('../../connectors/protocols/flare/FlareSmartAccountService', () => ({
  resolvePersonalAccount: jest.fn(async () => '0x1111111111111111111111111111111111111111'),
}));
jest.mock('../../services/dryRun/DryRunExecutor', () => ({ dryRunRigActive: jest.fn(async () => true) }));

// The Prisma client loads backend/.env when first required (e.g. by the exit-token
// MAC via SiweAuth). Load it now, before ENV is captured, so beforeEach can keep this
// suite database-free (the composed-order record reads the table directly).
import '../../database/prismaClient';
import institutionalRouter from '../institutional';
import { xrplProvider } from '../../integrations/providers/chain/XRPLProvider';

const app = express();
app.use(express.json());
app.use('/api/institutional', institutionalRouter);

const singleSig = { validated: true, ledger_index: VALIDATED, account_data: { Sequence: 4242 } };
const multisig = {
  validated: true,
  ledger_index: VALIDATED,
  account_data: { Sequence: 4242 },
  signer_lists: [{ SignerQuorum: 1, SignerEntries: [{ SignerEntry: { Account: 'rMember', SignerWeight: 1 } }] }],
};

const ROUTES: Array<[string, Record<string, unknown>, 'xrplTx' | 'xrplPayment', jest.Mock]> = [
  ['/pote-council-order/prepare', { council: COUNCIL, action: 'recall', venueId: 0, amount: '1000' }, 'xrplTx', mockBuildCouncilOrder],
  ['/cage-order/prepare', { council: COUNCIL, action: 'end-cession', params: {} }, 'xrplTx', mockBuildCageOrder],
  ['/cage-create/prepare', { account: COUNCIL, amountXrp: '2', allowedTargets: [] }, 'xrplPayment', mockBuildDirectMint],
];

const ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ENV };
  delete process.env.DATABASE_URL;
  process.env.INSTITUTIONAL_POTES_ENABLED = 'true';
  process.env.FXRP_TOKEN = '0xad552a648c74d49e10027ab8a618a3ad4901c5be';
  delete process.env.DEFI_EXEC_ENABLED;
  delete process.env.DEFI_EXEC_ALLOWED_REGIONS;
  process.env.DEFI_EXEC_BLOCKED_REGIONS = 'US,CN';
  mockXrplJsonRpc.mockReset();
  mockXrplJsonRpc.mockResolvedValue(singleSig);
  mockBuildCouncilOrder.mockClear();
  mockBuildCageOrder.mockClear();
  mockBuildDirectMint.mockClear();
  jest.spyOn(xrplProvider, 'getDidObject').mockResolvedValue({ dataHex: 'ab'.repeat(32) } as never);
});
afterAll(() => {
  process.env = ENV;
});

describe.each(ROUTES)('%s — la orden sale con su asiento fijado', (path, body, field, composer) => {
  beforeEach(() => {
    mockExistingCage = path === '/cage-order/prepare' ? { cage: CAGE_ADDR, bridge: BRIDGE } : null;
  });

  it('dos prepares seguidos devuelven la MISMA Sequence y llevan LastLedgerSequence (solo uno puede validar)', async () => {
    const a = await request(app).post(`/api/institutional${path}`).send(body);
    const b = await request(app).post(`/api/institutional${path}`).send(body);
    expect({ path, a: a.status, b: b.status }).toEqual({ path, a: 200, b: 200 });
    expect(a.body[field].Sequence).toBe(4242);
    expect(b.body[field].Sequence).toBe(a.body[field].Sequence);
    expect(a.body[field].LastLedgerSequence).toBe(VALIDATED + 150);
    expect(b.body[field].LastLedgerSequence).toBe(VALIDATED + 150);
    // La lectura es la del ledger VALIDADO en un nodo FRESCO, con la SignerList.
    expect(mockXrplJsonRpc).toHaveBeenCalledWith(
      'account_info',
      { account: COUNCIL, ledger_index: 'validated', signer_lists: true },
      undefined,
      { requireFresh: true },
    );
  });

  it('una cuenta con SignerList lleva la Sequence pero NO LastLedgerSequence (ceremonia multisig de días)', async () => {
    mockXrplJsonRpc.mockResolvedValue(multisig);
    const res = await request(app).post(`/api/institutional${path}`).send(body);
    expect(res.status).toBe(200);
    expect(res.body[field].Sequence).toBe(4242);
    expect(res.body[field]).not.toHaveProperty('LastLedgerSequence');
  });

  it('sin account_info legible → 503 ORDER_SEQUENCE_UNREADABLE y NADA compuesto', async () => {
    mockXrplJsonRpc.mockRejectedValue(new Error('xrpl_endpoint_stale'));
    const res = await request(app).post(`/api/institutional${path}`).send(body);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('ORDER_SEQUENCE_UNREADABLE');
    // En el nacimiento esto significa además: el asiento de nonce del 0xFE no se tomó.
    expect(composer).not.toHaveBeenCalled();
  });
});
