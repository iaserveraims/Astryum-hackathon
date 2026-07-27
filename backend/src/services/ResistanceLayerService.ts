/**
 * ResistanceLayerService — D8 "Resistance Layer".
 *
 * The friction step BEFORE the user signs a movement: discloses bridge/cross-chain
 * risk and audits the movement, returning disclosures + whether an explicit
 * acknowledgement is required. It never blocks unilaterally and never executes —
 * it surfaces risk so the user decides. Pure logic (no I/O), fully testable.
 */

export type RiskLevel = 'low' | 'medium' | 'high';

export interface MovementInput {
  fromChainId: number;
  toChainId: number;
  asset: string;
  amountUSD?: number;
  /** Bridge/protocol used for a cross-chain hop, if any. */
  bridge?: string;
  /** Destination is the user's own wallet? (vs an external address) */
  destinationIsSelf?: boolean;
}

export interface ResistanceAssessment {
  isCrossChain: boolean;
  level: RiskLevel;
  disclosures: string[];
  warnings: string[];
  /** When true, the UI must collect an explicit user acknowledgement before signing. */
  requiresAck: boolean;
}

const LARGE_USD = 25_000;

export class ResistanceLayerService {
  assess(input: MovementInput): ResistanceAssessment {
    const isCrossChain = input.fromChainId !== input.toChainId;
    const disclosures: string[] = [];
    const warnings: string[] = [];
    let level: RiskLevel = 'low';

    if (isCrossChain) {
      level = 'medium';
      disclosures.push(
        `Cross-chain movement ${input.fromChainId}→${input.toChainId}` +
          (input.bridge ? ` via ${input.bridge}` : '') +
          '. Bridges carry finality, custody and slippage risk independent of Astryum.',
      );
      if (!input.bridge) {
        warnings.push('No bridge specified for a cross-chain movement.');
        level = 'high';
      }
    }

    if ((input.amountUSD ?? 0) >= LARGE_USD) {
      disclosures.push(`Large movement (~$${Math.round(input.amountUSD!).toLocaleString()}). Re-check the destination.`);
      level = level === 'high' ? 'high' : 'medium';
    }

    if (input.destinationIsSelf === false) {
      warnings.push('Destination is NOT one of your wallets — funds leave your control.');
      level = 'high';
    }

    // Acknowledgement required for anything above low risk.
    const requiresAck = level !== 'low';

    return { isCrossChain, level, disclosures, warnings, requiresAck };
  }
}

export const resistanceLayerService = new ResistanceLayerService();
