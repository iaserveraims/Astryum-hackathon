/**
 * exitCopy — what a prepared pot exit may PROMISE, decided by what the backend
 * actually composed.
 */

export type ExitUnit = 'XRP' | 'FXRP';

export interface ExitCopy {
  unit: ExitUnit;
  /** true only when the composed batch converts to native XRP. */
  unminted: boolean;
  /** Where the money lands: the signing XRPL account, or the user's own Flare account. */
  destination: 'xrpl-account' | 'flare-account';
  /** Label of the amount row. */
  amountLabel: string;
  /** Label of the destination row. */
  destinationLabel: string;
  /** What happens to the money, said before signing. */
  arrival: string;
  /** What to expect after signing. */
  sent: string;
}

const XRP_ARRIVAL = 'Your share of the pot leaves, converts back to XRP, and lands in the same XRPL account you are signing with.';
const XRP_SENT = 'The network is proving your signature before Flare acts on it — that usually takes a couple of minutes, and nobody at Astryum takes part in it. Your XRP will land in your account on its own.';

const FXRP_ARRIVAL = 'Your share of the pot leaves as FXRP and lands in your own Flare account (your Personal Account). It stays there as FXRP — ready to use, or to convert to XRP later, whenever you decide.';
const FXRP_SENT = 'The network is proving your signature before Flare acts on it — that usually takes a couple of minutes, and nobody at Astryum takes part in it. Your FXRP will land in your Flare account on its own.';

function unmintCopy(): ExitCopy {
  return {
    unit: 'XRP',
    unminted: true,
    destination: 'xrpl-account',
    amountLabel: 'Arrives as',
    destinationLabel: 'To your XRPL account',
    arrival: XRP_ARRIVAL,
    sent: XRP_SENT,
  };
}

function fxrpCopy(): ExitCopy {
  return {
    unit: 'FXRP',
    unminted: false,
    destination: 'flare-account',
    amountLabel: 'Arrives as',
    destinationLabel: 'To your Flare account',
    arrival: FXRP_ARRIVAL,
    sent: FXRP_SENT,
  };
}

/**
 * The copy for a prepared exit. `unminted` is the backend's own flag (present on
 * 'sync', 'sync-fxrp' and 'claim' responses); it is only consulted where the
 * mode alone does not decide the unit.
 */
export function exitCopyFor(mode: string | undefined, unminted?: boolean): ExitCopy {
  switch (mode) {
    case 'sync':
      return unmintCopy();
    case 'sync-fxrp':
      return fxrpCopy();
    case 'request':
      return {
        unit: 'FXRP',
        unminted: false,
        destination: 'flare-account',
        amountLabel: 'Fixed at',
        destinationLabel: 'Ticket for your Flare account',
        arrival: 'This pot has an exit window: your shares are burned now and the amount is fixed in FXRP. You claim it when the window ends — nobody can stop that or change where it goes.',
        sent: 'The network is proving your signature before Flare acts on it — that usually takes a couple of minutes. Your exit then shows up as a ticket with its clock under My exits.',
      };
    case 'claim':
      return unminted === true ? unmintCopy() : fxrpCopy();
    default:
      // A mode this client does not know: promise XRP only if the backend said it unminted.
      return unminted === true ? unmintCopy() : fxrpCopy();
  }
}

/**
 * Refusals where keeping the capital as FXRP is the honest way out: the amount
 * is below what FAssets redeems to XRP, but nothing stops it leaving the pot.
 */
export function exitOffersFxrpAlternative(refusalError: string | null | undefined): boolean {
  return refusalError === 'BELOW_FASSETS_MINIMUM';
}
