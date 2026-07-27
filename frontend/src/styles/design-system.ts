// frontend/src/styles/design-system.ts - ENHANCED DESIGN SYSTEM
/**
 * Centralized design system constants for consistent styling
 * Addresses the design inconsistencies identified in the MoneyFlows component
 */

// ==========================================
// 🎨 COLOR PALETTE
// ==========================================

export const colors = {
  // Primary brand colors
  primary: {
    50: '#eff6ff',
    100: '#dbeafe', 
    200: '#bfdbfe',
    300: '#93c5fd',
    400: '#60a5fa',
    500: '#3b82f6', // Main primary
    600: '#2563eb',
    700: '#1d4ed8',
    800: '#1e40af',
    900: '#1e3a8a',
  },
  
  // DeFi accent colors
  defi: {
    primary: '#00E0A1',
    secondary: '#0EA5E9', 
    accent: '#A78BFA',
    warning: '#F59E0B',
    danger: '#EF4444',
    success: '#10B981',
  },
  
  // Semantic colors with proper contrast ratios
  status: {
    idle: '#6B7280',      // zinc-500
    valid: '#10B981',     // emerald-500
    running: '#F59E0B',   // amber-500  
    success: '#059669',   // emerald-600
    error: '#DC2626',     // red-600
    warning: '#D97706',   // amber-600
    compensated: '#7C3AED', // violet-600
  },
  
  // Dark theme optimized colors
  dark: {
    background: {
      primary: '#09090b',   // zinc-950
      secondary: '#18181b', // zinc-900
      tertiary: '#27272a',  // zinc-800
    },
    border: {
      primary: '#27272a',   // zinc-800
      secondary: '#3f3f46', // zinc-700
      accent: '#52525b',    // zinc-600
    },
    text: {
      primary: '#fafafa',   // zinc-50
      secondary: '#d4d4d8', // zinc-300
      tertiary: '#a1a1aa',  // zinc-400
      muted: '#71717a',     // zinc-500
    }
  }
} as const;

// ==========================================
// 📏 SPACING SCALE
// ==========================================

export const spacing = {
  px: '1px',
  0: '0px',
  0.5: '0.125rem', // 2px
  1: '0.25rem',    // 4px
  1.5: '0.375rem', // 6px
  2: '0.5rem',     // 8px
  2.5: '0.625rem', // 10px
  3: '0.75rem',    // 12px
  3.5: '0.875rem', // 14px
  4: '1rem',       // 16px
  5: '1.25rem',    // 20px
  6: '1.5rem',     // 24px
  7: '1.75rem',    // 28px
  8: '2rem',       // 32px
  9: '2.25rem',    // 36px
  10: '2.5rem',    // 40px
  11: '2.75rem',   // 44px
  12: '3rem',      // 48px
  14: '3.5rem',    // 56px
  16: '4rem',      // 64px
  20: '5rem',      // 80px
  24: '6rem',      // 96px
  32: '8rem',      // 128px
  40: '10rem',     // 160px
  48: '12rem',     // 192px
  56: '14rem',     // 224px
  64: '16rem',     // 256px
  72: '18rem',     // 288px
  80: '20rem',     // 320px
  96: '24rem',     // 384px
} as const;

// ==========================================
// 🔤 TYPOGRAPHY SCALE
// ==========================================

export const typography = {
  fontSize: {
    xs: ['0.75rem', { lineHeight: '1rem' }],       // 12px
    sm: ['0.875rem', { lineHeight: '1.25rem' }],   // 14px
    base: ['1rem', { lineHeight: '1.5rem' }],      // 16px
    lg: ['1.125rem', { lineHeight: '1.75rem' }],   // 18px
    xl: ['1.25rem', { lineHeight: '1.75rem' }],    // 20px
    '2xl': ['1.5rem', { lineHeight: '2rem' }],     // 24px
    '3xl': ['1.875rem', { lineHeight: '2.25rem' }], // 30px
    '4xl': ['2.25rem', { lineHeight: '2.5rem' }],  // 36px
    '5xl': ['3rem', { lineHeight: '1' }],          // 48px
  },
  
  fontWeight: {
    thin: '100',
    extralight: '200',
    light: '300',
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
    extrabold: '800',
    black: '900',
  },
  
  fontFamily: {
    sans: [
      '-apple-system', 
      'BlinkMacSystemFont', 
      '"Segoe UI"', 
      'Roboto', 
      '"Helvetica Neue"', 
      'Arial', 
      'sans-serif'
    ],
    mono: [
      '"SF Mono"',
      'Monaco',
      '"Cascadia Code"',
      '"Roboto Mono"',
      'Consolas',
      '"Courier New"',
      'monospace'
    ],
  },
} as const;

// ==========================================
// 🏠 LAYOUT CONSTANTS
// ==========================================

export const layout = {
  // Component dimensions
  toolbar: {
    height: '4rem',     // 64px
    heightMobile: '3.5rem', // 56px
  },
  
  rightPanel: {
    width: '24rem',         // 384px
    widthCollapsed: '0rem', // 0px
    maxWidth: '28rem',      // 448px
    minWidth: '20rem',      // 320px
  },
  
  timeline: {
    height: '12rem',        // 192px
    heightExpanded: '20rem', // 320px
  },
  
  // Breakpoints matching Tailwind CSS
  breakpoints: {
    sm: '640px',
    md: '768px', 
    lg: '1024px',
    xl: '1280px',
    '2xl': '1536px',
  },
  
  // Container sizes
  container: {
    sm: '640px',
    md: '768px',
    lg: '1024px',
    xl: '1280px',
    '2xl': '1536px',
  },
} as const;

// ==========================================
// ✨ ANIMATION & TRANSITIONS
// ==========================================

export const animation = {
  duration: {
    fast: '150ms',
    normal: '300ms',
    slow: '500ms',
    slower: '750ms',
  },
  
  easing: {
    default: 'cubic-bezier(0.4, 0, 0.2, 1)',
    in: 'cubic-bezier(0.4, 0, 1, 1)',
    out: 'cubic-bezier(0, 0, 0.2, 1)',
    inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  
  // Common transition classes
  transition: {
    all: 'transition-all duration-300 ease-in-out',
    colors: 'transition-colors duration-300 ease-in-out',
    opacity: 'transition-opacity duration-300 ease-in-out',
    transform: 'transition-transform duration-300 ease-in-out',
    fast: 'transition-all duration-150 ease-in-out',
  },
} as const;

// ==========================================
// 🎯 COMPONENT VARIANTS
// ==========================================

export const components = {
  button: {
    base: 'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none',
    
    variants: {
      default: 'bg-zinc-900 text-zinc-50 hover:bg-zinc-800 focus:ring-zinc-950',
      primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500',
      secondary: 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700 focus:ring-zinc-700',
      outline: 'border border-zinc-700 bg-transparent text-zinc-200 hover:bg-zinc-800 focus:ring-zinc-700',
      ghost: 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 focus:ring-zinc-700',
      destructive: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
    },
    
    sizes: {
      sm: 'h-8 px-3 text-xs',
      default: 'h-10 px-4 py-2',
      lg: 'h-12 px-6 text-base',
      icon: 'h-10 w-10',
    },
  },
  
  input: {
    base: 'flex h-10 w-full rounded-md border bg-transparent px-3 py-2 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
    variants: {
      default: 'border-zinc-700 text-zinc-100 focus:ring-blue-500 focus:border-blue-500',
      error: 'border-red-500 text-zinc-100 focus:ring-red-500 focus:border-red-500',
    },
  },
  
  card: {
    base: 'rounded-lg border bg-card text-card-foreground shadow-sm',
    variants: {
      default: 'border-zinc-800 bg-zinc-900/50',
      elevated: 'border-zinc-700 bg-zinc-900/80 shadow-lg',
    },
  },
} as const;

// ==========================================
// 🔧 UTILITY FUNCTIONS
// ==========================================

/**
 * Generates consistent shadow classes based on elevation level
 */
export const getShadow = (level: 'sm' | 'base' | 'md' | 'lg' | 'xl' | '2xl') => {
  const shadows = {
    sm: 'shadow-sm',
    base: 'shadow',
    md: 'shadow-md',
    lg: 'shadow-lg',
    xl: 'shadow-xl',
    '2xl': 'shadow-2xl',
  };
  return shadows[level];
};

/**
 * Generates consistent border radius classes
 */
export const getBorderRadius = (size: 'none' | 'sm' | 'base' | 'md' | 'lg' | 'xl' | 'full') => {
  const radii = {
    none: 'rounded-none',
    sm: 'rounded-sm',
    base: 'rounded',
    md: 'rounded-md', 
    lg: 'rounded-lg',
    xl: 'rounded-xl',
    full: 'rounded-full',
  };
  return radii[size];
};

/**
 * Generates status-based color classes
 */
export const getStatusColors = (status: keyof typeof colors.status) => {
  const statusColorMap = {
    idle: 'text-zinc-500 bg-zinc-500/10 border-zinc-500/30',
    valid: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    running: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
    success: 'text-emerald-300 bg-emerald-600/10 border-emerald-600/30',
    error: 'text-red-300 bg-red-600/10 border-red-600/30',
    warning: 'text-amber-300 bg-amber-600/10 border-amber-600/30',
    compensated: 'text-violet-300 bg-violet-600/10 border-violet-600/30',
  };
  return statusColorMap[status];
};

export default {
  colors,
  spacing,
  typography,
  layout,
  animation,
  components,
  getShadow,
  getBorderRadius,
  getStatusColors,
};