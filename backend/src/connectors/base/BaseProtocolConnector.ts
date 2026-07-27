// backend/src/connectors/base/BaseProtocolConnector.ts
import winston from 'winston';

// Configuration interfaces
export interface ProtocolConfig {
  id: string;
  name: string;
  network: string;
  contractAddress?: string;
  apiEndpoint?: string;
  version: string;
  capabilities: string[];
  riskParameters: {
    maxLeverage: number;
    liquidationThreshold: number;
    collateralFactor: number;
  };
  gasEstimates: Record<string, number>;
}

export interface PositionData {
  protocol: string;
  network: string;
  asset: string;
  amount: number;
  type: 'lending' | 'borrowing' | 'liquidity' | 'staking' | 'farming';
  apy: number;
  healthFactor?: number;
  liquidationPrice?: number;
  value: number;
  metadata: any;
}

export interface ProtocolAction {
  protocol: string;
  action: string;
  parameters: any;
  gasEstimate?: number;
  expectedOutcome?: any;
  requiresApproval?: boolean;
}

// Legacy alias — older connectors (FlareFinance/SparkDex/SquidRouter) imported
// `ProtocolOperation` which never existed. Aliasing to ProtocolAction unblocks
// their compilation without touching the connector files.
export type ProtocolOperation = ProtocolAction;

// Base Protocol Connector Abstract Class
export abstract class BaseProtocolConnector {
  protected config: ProtocolConfig;
  protected logger: winston.Logger;

  constructor(config: ProtocolConfig) {
    this.config = config;
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.label({ label: config.name }),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: `logs/${config.id}-connector.log` })
      ]
    });
  }

  // Abstract methods that must be implemented by each connector
  abstract getUserPositions(userAddress: string): Promise<PositionData[]>;
  abstract executeAction(action: ProtocolAction, userAddress: string, wallet?: any): Promise<any>;
  abstract getProtocolMetrics(): Promise<any>;
  abstract calculateHealthFactor(userAddress: string): Promise<number | null>;
  abstract getLiquidationPrice(userAddress: string, asset: string): Promise<number | null>;
  abstract initialize(): Promise<void>;
  abstract isHealthy(): Promise<boolean>;
  abstract shutdown(): Promise<void>;

  // Common utility methods
  public getConfig(): ProtocolConfig {
    return this.config;
  }

  public getId(): string {
    return this.config.id;
  }

  public getName(): string {
    return this.config.name;
  }

  public getNetwork(): string {
    return this.config.network;
  }

  public getCapabilities(): string[] {
    return this.config.capabilities;
  }

  public supportsAction(action: string): boolean {
    switch (action) {
      case 'supply':
      case 'withdraw':
        return this.config.capabilities.includes('lending');
      case 'borrow':
      case 'repay':
        return this.config.capabilities.includes('borrowing');
      case 'swap':
        return this.config.capabilities.includes('swap');
      case 'bridge':
        return this.config.capabilities.includes('bridge');
      case 'stake':
      case 'unstake':
        return this.config.capabilities.includes('staking');
      case 'addLiquidity':
      case 'removeLiquidity':
        return this.config.capabilities.includes('liquidity');
      default:
        return false;
    }
  }

  // Common error handling
  protected handleError(error: any, context: string): Error {
    const message = `${context}: ${error.message || error}`;
    this.logger.error(message, { error, context });
    return new Error(message);
  }

  // Gas estimation utilities
  protected getGasEstimate(action: string): number {
    return this.config.gasEstimates[action] || 0;
  }

  // Risk validation
  protected validateRiskParameters(
    healthFactor?: number,
    liquidationThreshold?: number
  ): { valid: boolean; reason?: string } {
    if (healthFactor !== undefined) {
      if (healthFactor < 1.0) {
        return { valid: false, reason: 'Position is in liquidation risk' };
      }
      if (healthFactor < 1.2) {
        return { valid: false, reason: 'Health factor too low for additional operations' };
      }
    }

    if (liquidationThreshold !== undefined) {
      if (liquidationThreshold > this.config.riskParameters.liquidationThreshold) {
        return { valid: false, reason: 'Operation exceeds liquidation threshold' };
      }
    }

    return { valid: true };
  }
}