#!/usr/bin/env node
// @ts-nocheck — DEPRECATED legacy. Drop or refactor post-V1.
/**
 * Configuration Check CLI Tool
 * Run this script to validate your environment configuration
 *
 * Usage:
 *   npm run check-config
 *   node dist/scripts/checkConfig.js
 *   ts-node src/scripts/checkConfig.ts
 */

import dotenv from 'dotenv';
import path from 'path';
import {
  validateConfig,
  validateProtocolConfig,
  getPlaceholderVariables,
  printValidationResults
} from '../utils/configValidator';
import { getUnconfiguredAddresses } from '../connectors/chains/config/contractAddresses';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function printHeader(text: string) {
  console.log(`\n${colors.bright}${colors.cyan}${'='.repeat(80)}${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}${text.padEnd(80)}${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}${'='.repeat(80)}${colors.reset}\n`);
}

function printSection(text: string) {
  console.log(`\n${colors.bright}${colors.blue}${text}${colors.reset}`);
  console.log(`${colors.blue}${'-'.repeat(text.length)}${colors.reset}\n`);
}

/**
 * Main validation function
 */
async function main() {
  printHeader('MoneyFlow DeFi - Configuration Validation Tool');

  // 1. General configuration validation
  printSection('1. General Configuration Validation');
  const generalResult = validateConfig();
  printValidationResults(generalResult);

  // 2. Protocol-specific validation
  printSection('2. Protocol-Specific Configuration');
  const protocols = [
    'strobe-finance',
    'tapp-exchange',
    'flare-finance',
    'sparkdex',
    'squid-router'
  ];

  const protocolResults: Record<string, any> = {};

  for (const protocol of protocols) {
    const result = validateProtocolConfig(protocol);
    protocolResults[protocol] = result;

    const status = result.valid
      ? `${colors.green}✅ Valid${colors.reset}`
      : `${colors.red}❌ Invalid${colors.reset}`;

    console.log(`${protocol.padEnd(20)} ${status}`);

    if (result.errors.length > 0) {
      result.errors.forEach(error => {
        console.log(`  ${colors.red}❌ ${error}${colors.reset}`);
      });
    }

    if (result.warnings.length > 0) {
      result.warnings.forEach(warning => {
        console.log(`  ${colors.yellow}⚠️  ${warning}${colors.reset}`);
      });
    }
  }

  // 3. Contract addresses validation
  printSection('3. Contract Addresses Validation');
  const unconfigured = getUnconfiguredAddresses();

  if (unconfigured.length === 0) {
    console.log(`${colors.green}✅ All contract addresses are configured${colors.reset}\n`);
  } else {
    console.log(`${colors.yellow}⚠️  Found ${unconfigured.length} unconfigured contract addresses:${colors.reset}\n`);
    unconfigured.forEach(({ chainId, protocolId, field, currentValue }) => {
      console.log(`  • ${chainId} / ${protocolId} / ${field}`);
      console.log(`    ${colors.yellow}Current: ${currentValue}${colors.reset}\n`);
    });
  }

  // 4. Placeholder detection
  printSection('4. Placeholder Detection');
  const placeholders = getPlaceholderVariables();
  const placeholderCount = Object.keys(placeholders).length;

  if (placeholderCount === 0) {
    console.log(`${colors.green}✅ No placeholder values detected${colors.reset}\n`);
  } else {
    console.log(`${colors.yellow}⚠️  Found ${placeholderCount} placeholder values:${colors.reset}\n`);
    for (const [key, value] of Object.entries(placeholders)) {
      console.log(`  ${key}:`);
      console.log(`    ${colors.yellow}${value}${colors.reset}\n`);
    }
  }

  // 5. Critical RPC endpoints check
  printSection('5. Critical RPC Endpoints');
  const criticalRPCs = [
    { key: 'XRPL_RPC_URL', name: 'XRPL Mainnet' },
    { key: 'APTOS_RPC_URL', name: 'Aptos Mainnet' },
    { key: 'FLARE_RPC_URL', name: 'Flare Network' },
    { key: 'ETHEREUM_RPC_URL', name: 'Ethereum Mainnet' }
  ];

  for (const rpc of criticalRPCs) {
    const value = process.env[rpc.key];
    const status = value && value.trim() !== ''
      ? `${colors.green}✅ Configured${colors.reset}`
      : `${colors.red}❌ Missing${colors.reset}`;

    console.log(`${rpc.name.padEnd(25)} ${status}`);

    if (value) {
      console.log(`  ${colors.cyan}${value}${colors.reset}`);
    }
  }

  // 6. Security checks
  printSection('6. Security Configuration');
  const securityChecks = [
    {
      key: 'JWT_SECRET',
      check: (val: string) => val && val.length >= 32 && !val.includes('CRITICAL_SECURITY_WARNING'),
      message: 'JWT secret is strong and unique'
    },
    {
      key: 'SESSION_SECRET',
      check: (val: string) => val && val.length >= 32 && !val.includes('GENERATE_SECURE'),
      message: 'Session secret is strong and unique'
    },
    {
      key: 'REQUIRE_WALLET_SIGNATURE',
      check: (val: string) => val === 'true',
      message: 'Wallet signature requirement is enabled'
    }
  ];

  for (const check of securityChecks) {
    const value = process.env[check.key] || '';
    const passed = check.check(value);
    const status = passed
      ? `${colors.green}✅ Pass${colors.reset}`
      : `${colors.red}❌ Fail${colors.reset}`;

    console.log(`${check.message.padEnd(50)} ${status}`);
  }

  // 7. Summary
  printSection('7. Summary');

  const totalErrors = generalResult.errors.length +
    Object.values(protocolResults).reduce((sum: number, r: any) => sum + r.errors.length, 0);

  const totalWarnings = generalResult.warnings.length +
    Object.values(protocolResults).reduce((sum: number, r: any) => sum + r.warnings.length, 0);

  console.log(`Total Errors:   ${totalErrors > 0 ? colors.red : colors.green}${totalErrors}${colors.reset}`);
  console.log(`Total Warnings: ${totalWarnings > 0 ? colors.yellow : colors.green}${totalWarnings}${colors.reset}`);
  console.log(`Placeholders:   ${placeholderCount > 0 ? colors.yellow : colors.green}${placeholderCount}${colors.reset}`);
  console.log(`Unconfigured:   ${unconfigured.length > 0 ? colors.yellow : colors.green}${unconfigured.length}${colors.reset}`);

  console.log('\n');

  if (totalErrors === 0 && totalWarnings === 0 && placeholderCount === 0 && unconfigured.length === 0) {
    console.log(`${colors.bright}${colors.green}🎉 Configuration is fully ready for production!${colors.reset}\n`);
    process.exit(0);
  } else if (totalErrors === 0) {
    console.log(`${colors.yellow}⚠️  Configuration is valid but has warnings. Review before production.${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`${colors.red}❌ Configuration has errors. Please fix before running the application.${colors.reset}\n`);
    process.exit(1);
  }
}

// Run the validation
main().catch(error => {
  console.error(`${colors.red}Error running configuration check:${colors.reset}`, error);
  process.exit(1);
});
