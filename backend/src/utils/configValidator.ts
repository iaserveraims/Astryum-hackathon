/**
 * Configuration Validator
 * Validates that all required environment variables are set and properly configured
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  missing: string[];
  placeholders: string[];
}

export interface ConfigRequirement {
  key: string;
  required: boolean;
  description: string;
  pattern?: RegExp;
  validate?: (value: string) => boolean;
}

// Required environment variables
const REQUIRED_CONFIG: ConfigRequirement[] = [
  // Core Configuration
  { key: 'NODE_ENV', required: true, description: 'Environment mode' },
  { key: 'PORT', required: true, description: 'Server port' },
  { key: 'MONGODB_URI', required: true, description: 'MongoDB connection string' },
  { key: 'JWT_SECRET', required: true, description: 'JWT signing secret' },
  { key: 'SESSION_SECRET', required: true, description: 'Session secret' },

  // Blockchain RPCs (Required for each network in use)
  { key: 'XRPL_RPC_URL', required: true, description: 'XRPL mainnet RPC URL' },
  { key: 'APTOS_RPC_URL', required: true, description: 'Aptos mainnet RPC URL' },
  { key: 'FLARE_RPC_URL', required: true, description: 'Flare Network RPC URL' },
  { key: 'ETHEREUM_RPC_URL', required: true, description: 'Ethereum RPC URL' },

  // Critical API Keys
  { key: 'ALCHEMY_API_KEY', required: false, description: 'Alchemy API key for EVM RPCs' },
  { key: 'WALLETCONNECT_PROJECT_ID', required: true, description: 'WalletConnect project ID' },

  // Protocol Addresses (User-provided)
  { key: 'STROBE_CONTRACT_ADDRESS', required: false, description: 'Strobe Finance contract address' },
  { key: 'TAPP_CONTRACT_ADDRESS', required: false, description: 'Tapp Exchange contract address' },
  { key: 'FLARE_FINANCE_LENDING_POOL', required: false, description: 'Flare Finance lending pool address' },
  { key: 'SPARKDEX_ROUTER', required: false, description: 'SparkDex router address' },
  { key: 'SQUID_INTEGRATOR_ID', required: false, description: 'Squid Router integrator ID' },

  // Backend Wallet Addresses
  { key: 'BACKEND_WALLET_ADDRESS_XRPL', required: false, description: 'Backend XRPL wallet address' },
  { key: 'BACKEND_WALLET_ADDRESS_APTOS', required: false, description: 'Backend Aptos wallet address' },
  { key: 'BACKEND_WALLET_ADDRESS_EVM', required: false, description: 'Backend EVM wallet address' }
];

// Placeholder patterns to detect
const PLACEHOLDER_PATTERNS = [
  /\[USER_TO_PROVIDE.*?\]/gi,
  /\[YOUR_.*?\]/gi,
  /your_.*?_here/gi,
  /GENERATE_SECURE_.*?_HERE/gi,
  /CRITICAL_SECURITY_WARNING/gi
];

/**
 * Validate all environment configuration
 */
export function validateConfig(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const missing: string[] = [];
  const placeholders: string[] = [];

  // Check required variables
  for (const config of REQUIRED_CONFIG) {
    const value = process.env[config.key];

    if (!value || value.trim() === '') {
      if (config.required) {
        errors.push(`Missing required environment variable: ${config.key} (${config.description})`);
        missing.push(config.key);
      } else {
        warnings.push(`Optional environment variable not set: ${config.key} (${config.description})`);
      }
      continue;
    }

    // Check for placeholders
    if (isPlaceholder(value)) {
      placeholders.push(config.key);
      if (config.required) {
        errors.push(`Required variable ${config.key} contains placeholder value: ${value}`);
      } else {
        warnings.push(`Optional variable ${config.key} contains placeholder value: ${value}`);
      }
      continue;
    }

    // Custom validation
    if (config.pattern && !config.pattern.test(value)) {
      errors.push(`Invalid format for ${config.key}: does not match required pattern`);
    }

    if (config.validate && !config.validate(value)) {
      errors.push(`Invalid value for ${config.key}: failed custom validation`);
    }
  }

  // Validate JWT secret strength
  const jwtSecret = process.env.JWT_SECRET;
  if (jwtSecret && jwtSecret.length < 32) {
    warnings.push('JWT_SECRET is shorter than 32 characters (recommended minimum)');
  }

  // Validate port
  const port = process.env.PORT;
  if (port && (isNaN(Number(port)) || Number(port) < 1 || Number(port) > 65535)) {
    errors.push('PORT must be a valid port number (1-65535)');
  }

  // Check for security warnings
  if (jwtSecret && jwtSecret.includes('CRITICAL_SECURITY_WARNING')) {
    errors.push('JWT_SECRET must be changed from default value');
  }

  const sessionSecret = process.env.SESSION_SECRET;
  if (sessionSecret && sessionSecret.includes('GENERATE_SECURE')) {
    errors.push('SESSION_SECRET must be changed from default value');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    missing,
    placeholders
  };
}

/**
 * Check if a value is a placeholder
 */
export function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some(pattern => pattern.test(value));
}

/**
 * Get all environment variables with placeholders
 */
export function getPlaceholderVariables(): Record<string, string> {
  const placeholderVars: Record<string, string> = {};

  for (const key in process.env) {
    const value = process.env[key];
    if (value && isPlaceholder(value)) {
      placeholderVars[key] = value;
    }
  }

  return placeholderVars;
}

/**
 * Validate specific protocol configuration
 */
export function validateProtocolConfig(protocolId: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const missing: string[] = [];
  const placeholders: string[] = [];

  // Protocol-specific validation
  switch (protocolId.toLowerCase()) {
    case 'strobe-finance':
      if (!process.env.STROBE_CONTRACT_ADDRESS) {
        errors.push('STROBE_CONTRACT_ADDRESS is required for Strobe Finance');
        missing.push('STROBE_CONTRACT_ADDRESS');
      } else if (isPlaceholder(process.env.STROBE_CONTRACT_ADDRESS)) {
        placeholders.push('STROBE_CONTRACT_ADDRESS');
        errors.push('STROBE_CONTRACT_ADDRESS contains placeholder value');
      }
      if (!process.env.XRPL_RPC_URL) {
        errors.push('XRPL_RPC_URL is required for Strobe Finance (XRPL protocol)');
        missing.push('XRPL_RPC_URL');
      }
      break;

    case 'tapp-exchange':
      if (!process.env.TAPP_CONTRACT_ADDRESS) {
        errors.push('TAPP_CONTRACT_ADDRESS is required for Tapp Exchange');
        missing.push('TAPP_CONTRACT_ADDRESS');
      } else if (isPlaceholder(process.env.TAPP_CONTRACT_ADDRESS)) {
        placeholders.push('TAPP_CONTRACT_ADDRESS');
        errors.push('TAPP_CONTRACT_ADDRESS contains placeholder value');
      }
      if (!process.env.APTOS_RPC_URL) {
        errors.push('APTOS_RPC_URL is required for Tapp Exchange (Aptos protocol)');
        missing.push('APTOS_RPC_URL');
      }
      break;

    case 'flare-finance':
      if (!process.env.FLARE_FINANCE_LENDING_POOL) {
        errors.push('FLARE_FINANCE_LENDING_POOL is required');
        missing.push('FLARE_FINANCE_LENDING_POOL');
      } else if (isPlaceholder(process.env.FLARE_FINANCE_LENDING_POOL)) {
        placeholders.push('FLARE_FINANCE_LENDING_POOL');
        errors.push('FLARE_FINANCE_LENDING_POOL contains placeholder value');
      }
      if (!process.env.FLARE_RPC_URL) {
        errors.push('FLARE_RPC_URL is required for Flare Finance');
        missing.push('FLARE_RPC_URL');
      }
      break;

    case 'sparkdex':
      if (!process.env.SPARKDEX_ROUTER) {
        errors.push('SPARKDEX_ROUTER is required');
        missing.push('SPARKDEX_ROUTER');
      } else if (isPlaceholder(process.env.SPARKDEX_ROUTER)) {
        placeholders.push('SPARKDEX_ROUTER');
        errors.push('SPARKDEX_ROUTER contains placeholder value');
      }
      if (!process.env.FLARE_RPC_URL) {
        errors.push('FLARE_RPC_URL is required for SparkDex');
        missing.push('FLARE_RPC_URL');
      }
      break;

    case 'squid-router':
      if (!process.env.SQUID_INTEGRATOR_ID) {
        warnings.push('SQUID_INTEGRATOR_ID is recommended for Squid Router');
      } else if (isPlaceholder(process.env.SQUID_INTEGRATOR_ID)) {
        placeholders.push('SQUID_INTEGRATOR_ID');
        warnings.push('SQUID_INTEGRATOR_ID contains placeholder value');
      }
      break;

    default:
      warnings.push(`Unknown protocol: ${protocolId}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    missing,
    placeholders
  };
}

/**
 * Print validation results to console
 */
export function printValidationResults(result: ValidationResult): void {
  console.log('\n========================================');
  console.log('Configuration Validation Results');
  console.log('========================================\n');

  if (result.valid) {
    console.log('✅ All required configuration is valid\n');
  } else {
    console.log('❌ Configuration validation failed\n');
  }

  if (result.errors.length > 0) {
    console.log('ERRORS:');
    result.errors.forEach(error => console.log(`  ❌ ${error}`));
    console.log('');
  }

  if (result.warnings.length > 0) {
    console.log('WARNINGS:');
    result.warnings.forEach(warning => console.log(`  ⚠️  ${warning}`));
    console.log('');
  }

  if (result.missing.length > 0) {
    console.log('MISSING VARIABLES:');
    result.missing.forEach(key => console.log(`  - ${key}`));
    console.log('');
  }

  if (result.placeholders.length > 0) {
    console.log('PLACEHOLDER VALUES DETECTED:');
    result.placeholders.forEach(key => console.log(`  - ${key}`));
    console.log('');
  }

  console.log('========================================\n');
}

/**
 * Validate and exit if configuration is invalid (for production)
 */
export function validateConfigOrExit(): void {
  const result = validateConfig();

  if (!result.valid) {
    printValidationResults(result);
    console.error('❌ Configuration validation failed. Please fix errors before starting the application.');
    process.exit(1);
  }

  if (result.warnings.length > 0) {
    printValidationResults(result);
  }
}

export default {
  validateConfig,
  validateProtocolConfig,
  isPlaceholder,
  getPlaceholderVariables,
  printValidationResults,
  validateConfigOrExit
};
