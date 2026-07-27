// src/lib/utils.ts

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Utility for merging Tailwind classes
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Risk level calculation for health factors
export function getRiskLevel(healthFactor: number): 'low' | 'medium' | 'high' | 'critical' {
  if (healthFactor === Infinity || healthFactor >= 2.0) {
    return 'low';
  } else if (healthFactor >= 1.5) {
    return 'medium';
  } else if (healthFactor >= 1.2) {
    return 'high';
  } else {
    return 'critical';
  }
}

// Format currency values
export function formatCurrency(value: number, currency: string = 'USD'): string {
  if (currency === 'USD') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  }
  
  
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(value) + ` ${currency}`;
}

// Format crypto values
export function formatCrypto(amount: number, symbol: string): string {
  return `${amount.toFixed(4)} ${symbol.toUpperCase()}`;
}
// Format percentage values
export function formatPercentage(value: number, decimals: number = 1): string {
  return `${value.toFixed(decimals)}%`;
}

// Format health factor display
export function formatHealthFactor(healthFactor: number): string {
  if (healthFactor === Infinity) {
    return '∞';
  }
  return healthFactor.toFixed(2);
}

// Get risk color based on health factor
export function getRiskColor(healthFactor: number): string {
  const riskLevel = getRiskLevel(healthFactor);
  
  switch (riskLevel) {
    case 'low':
      return 'text-green-500';
    case 'medium':
      return 'text-yellow-500';
    case 'high':
      return 'text-orange-500';
    case 'critical':
      return 'text-red-500';
    default:
      return 'text-gray-500';
  }
}

// Get status badge variant
export function getStatusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status.toLowerCase()) {
    case 'active':
      return 'default';
    case 'warning':
      return 'secondary';
    case 'critical':
      return 'destructive';
    case 'paused':
      return 'outline';
    default:
      return 'outline';
  }
}

// Format time ago
export function formatTimeAgo(timeString: string): string {
  // Simple time ago formatting - you might want to use a library like date-fns
  return timeString; // For now, return as-is
}

// Calculate LTV (Loan-to-Value) ratio
export function calculateLTV(debtValue: number, collateralValue: number): number {
  if (collateralValue === 0) return 0;
  return (debtValue / collateralValue) * 100;
}

// Validate health factor
export function isHealthFactorSafe(healthFactor: number, threshold: number = 1.5): boolean {
  return healthFactor === Infinity || healthFactor >= threshold;
}

// Format large numbers with abbreviations
export function formatLargeNumber(value: number): string {
  if (value >= 1e9) {
    return (value / 1e9).toFixed(1) + 'B';
  } else if (value >= 1e6) {
    return (value / 1e6).toFixed(1) + 'M';
  } else if (value >= 1e3) {
    return (value / 1e3).toFixed(1) + 'K';
  }
  return value.toString();
}

// Protocol name mapping
export const PROTOCOL_DISPLAY_NAMES: Record<string, string> = {
  'aave': 'Aave',
  'compound': 'Compound',
  'moai': 'Moai Finance',
  'moai-finance': 'Moai Finance',
  'makerdao': 'MakerDAO',
  'venus': 'Venus Protocol'
};

// Get protocol display name
export function getProtocolDisplayName(protocol: string): string {
  return PROTOCOL_DISPLAY_NAMES[protocol.toLowerCase()] || protocol;
}

// Debounce function for search/input
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout;
  
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
}

// Deep clone object
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// Check if value is numeric
export function isNumeric(value: any): boolean {
  return !isNaN(parseFloat(value)) && isFinite(value);
}