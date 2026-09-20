import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extract } from '../../components/legacy/__tests__/extractFromSource';
import { countProposals, type ProposalCounts } from '../../lib/authority/proposalCounts';

/**
 * prosa-y-lectores — «un candidato ajeno borraba los badges de TODAS mis
 * autoridades».
 *
 * `useAuthorities` fed ONE bulk read: `councilProposalsApi.list(candidates,
 * true)`, where the candidates are the connected wallet PLUS the self-asserted
 * `GovernedAccount` pointers (`POST /governed-accounts` takes any r-address
 * with no proof). The permission floor added this round refuses that whole
 * listing with 403 NOT_A_COUNCIL_MEMBER when NONE of the rows it found belongs
 * to the session (backend/src/routes/councilProposals.ts, `GET /`), and the
 * hook's `.catch` was a comment. So one pointer the server does not tie to this
 * user took down the read for every authority at once and said nothing: every
 * "your signature is due" badge silently disappeared while the proposals it was
 * counting ran toward their seven-day deadline.
 *
 * The second half of the same family is quieter and always reachable: on a
 * MIXED listing the server returns only the readable rows and never names the
 * accounts it withheld, while `countProposals` seeds EVERY account it is handed
 * with 0. A withheld account was therefore counted as "nothing in flight" —
 * "I could not read" written down as data.
 *
 * The fix reads one account at a time and merges. These tests execute the merge
 * rule and the counting rule against those two shapes; both fail on the old
 * bulk shape, which is reproduced here as the control.
 */

const HOOK = join(__dirname, '..', 'useAuthorities.ts');
const hookSrc = readFileSync(HOOK, 'utf8');

const mergeProposalCounts = extract<
  (prev: ProposalCounts | null, next: ProposalCounts) => ProposalCounts
>(
  hookSrc,
  'export function mergeProposalCounts(prev: ProposalCounts | null, next: ProposalCounts): ProposalCounts {',
  'function mergeProposalCounts(prev, next) {',
  'mergeProposalCounts',
);

const MINE = 'rMineOwnCouncilAddressAAAAAAAAAAAAA';
const FOREIGN = 'rForeignPointerBBBBBBBBBBBBBBBBBBBB';
const MY_SEAT = 'rMySeatCCCCCCCCCCCCCCCCCCCCCCCCCCCC';

/** A row shaped as `countProposals` consumes it. */
function row(account: string, status: string, seats: string[], signed: string[] = []) {
  return {
    account,
    status,
    signerList: seats.map((a) => ({ account: a, weight: 1 })),
    signatures: signed.map((a) => ({ signerAccount: a })),
  } as Parameters<typeof countProposals>[0][number];
}

describe('prosa-y-lectores — one refused account may not erase the others', () => {
  it('keeps every account already read when a later one is refused', () => {
    // MINE was read: one proposal, my seat still unsigned.
    const mine = countProposals(
      [row(MINE, 'collecting', [MY_SEAT, 'rOther'])],
      [MINE],
      new Set([MY_SEAT]),
    );
    let counts = mergeProposalCounts(null, mine);
    expect(counts.pendingForMe[MINE]).toBe(1);
    expect(counts.live[MINE]).toBe(1);

    // FOREIGN answered 403: nothing is merged for it. The badge that IS known
    // survives, which is the whole point — the old bulk read lost both.
    counts = mergeProposalCounts(counts, { pendingForMe: {}, live: {} });
    expect(counts.pendingForMe[MINE]).toBe(1);
    expect(counts.live[MINE]).toBe(1);
  });

  it('leaves a refused account UNKNOWN, never zero', () => {
    const counts = mergeProposalCounts(null, countProposals([], [MINE], new Set([MY_SEAT])));
    // Read and genuinely empty → a real 0.
    expect(counts.live[MINE]).toBe(0);
    // Never read → absent. `undefined` is what the surfaces treat as "unknown";
    // 0 would be an answer we never obtained.
    expect(counts.live[FOREIGN]).toBeUndefined();
    expect(counts.pendingForMe[FOREIGN]).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(counts.live, FOREIGN)).toBe(false);
  });

  it('a later read of the same account replaces its own counts and nothing else', () => {
    const first = mergeProposalCounts(
      null,
      countProposals([row(MINE, 'collecting', [MY_SEAT])], [MINE], new Set([MY_SEAT])),
    );
    const second = mergeProposalCounts(
      first,
      countProposals([], [FOREIGN], new Set([MY_SEAT])),
    );
    const third = mergeProposalCounts(
      second,
      // MINE signed since: nothing pending, still live.
      countProposals([row(MINE, 'ready', [MY_SEAT])], [MINE], new Set([MY_SEAT])),
    );
    expect(third.pendingForMe[MINE]).toBe(0);
    expect(third.live[MINE]).toBe(1);
    expect(third.live[FOREIGN]).toBe(0);
  });

  it('THE CONTROL — the bulk shape wrote a zero for an account the server withheld', () => {
    // What the server really returns on a mixed listing: only the readable
    // rows, with no word about the ones it filtered out.
    const readableRowsOnly = [row(MINE, 'collecting', [MY_SEAT])];
    const bulk = countProposals(readableRowsOnly, [MINE, FOREIGN], new Set([MY_SEAT]));
    // The old code seeded BOTH accounts, so the withheld one read as "nothing
    // in flight" on the switcher and in the Structures band.
    expect(bulk.live[FOREIGN]).toBe(0);
    expect(bulk.pendingForMe[FOREIGN]).toBe(0);

    // Per-account, the same server behaviour leaves it unknown instead.
    const perAccount = mergeProposalCounts(
      null,
      countProposals(readableRowsOnly, [MINE], new Set([MY_SEAT])),
    );
    expect(perAccount.live[FOREIGN]).toBeUndefined();
    expect(perAccount.live[MINE]).toBe(1);
  });
});

/**
 * productizer it. 27 (6) — LA AUSENCIA POR ILEGIBLE SE VEÍA IGUAL QUE EL CERO.
 *
 * El bloque de arriba cerró la mitad de dentro: una cuenta que no se pudo leer queda
 * `undefined` en vez de contarse como 0. La mitad de fuera seguía abierta: la banda
 * solo pintaba con `typeof … === 'number' && > 0`, así que un Legacy con dos firmas
 * pendientes que nadie consiguió leer se veía EXACTAMENTE igual que uno sin nada
 * pendiente. «No pude leer» no es permiso, ni castigo, ni un hecho — y aquí era un
 * cero.
 *
 * El cableado es lo único que ninguna función pura sujeta, así que se lee del fuente
 * que se envía: quién pone la marca, quién la retira y dónde se pinta.
 */
describe('it. 27 (6) — lo ilegible se ve como desconocido, jamás como cero', () => {
  const HOOK = join(__dirname, '..', 'useAuthorities.ts');
  const BAND = join(__dirname, '..', '..', 'components', 'legacy', 'StructuresBand.tsx');
  const hookSrc = readFileSync(HOOK, 'utf8');
  const bandSrc = readFileSync(BAND, 'utf8');

  it('el hook marca la cuenta cuya lectura FALLÓ — y solo después de intentarlo', () => {
    expect(hookSrc).toContain(
      "if (alive) setProposalsUnread((prev) => (prev[address] ? prev : { ...prev, [address]: true }));",
    );
    expect(hookSrc).toContain('proposalsUnread: proposalsUnread[c.address] === true,');
  });

  it('y una lectura que SÍ ocurrió es la única que la retira', () => {
    expect(hookSrc).toContain('setProposalsUnread((prev) => {');
    expect(hookSrc).toContain('delete next[address];');
  });

  it('la banda lo pinta — en las dos insignias, y solo cuando no hay número', () => {
    expect(bandSrc).toContain("{structure.proposalsUnread && typeof structure.liveProposals !== 'number' && (");
    expect(bandSrc).toContain("{structure.proposalsUnread && typeof structure.pendingSignatures !== 'number' && (");
    // Nunca un número inventado: la insignia dice que no se pudo leer.
    expect(bandSrc).toContain("{t('could not read')}");
  });

  it('EL CONTROL — una cuenta ilegible sigue sin recuento, que es lo que la marca acompaña', () => {
    const counts = mergeProposalCounts(null, countProposals([], [MINE], new Set([MY_SEAT])));
    expect(counts.live[FOREIGN]).toBeUndefined();
    expect(counts.pendingForMe[FOREIGN]).toBeUndefined();
  });
});
