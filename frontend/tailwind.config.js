/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./src/app/**/*.{ts,tsx,css}",
    "./public/index.html",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        // ✅ Astryum brand — warm GOLD on deep space (matches the landing).
        // `volt` is the historical accent key kept so every existing `*-volt*`
        // class recolors to gold in one place; `gold` is the new semantic alias.
        // `volt` now reads a CSS var (--volt, gold by default) so the Legacy
        // product mode can re-tint the ENTIRE dashboard by flipping one var
        // under [data-authority='governed'] — see globals.css.
        // `ink` is the READING color (white on dark shells, near-black on the
        // light theme's paper): use text-ink/60, border-ink/10, bg-ink/[0.03]
        // instead of hardcoded *-white/* so [data-theme='light'] flips one var.
        ink: "hsl(var(--ink) / <alpha-value>)",
        volt: {
          DEFAULT: "hsl(var(--volt) / <alpha-value>)",
          soft: "hsl(var(--volt-soft) / <alpha-value>)",
          ink: "hsl(var(--volt-ink) / <alpha-value>)",
        },
        gold: {
          DEFAULT: "#C9A227",
          soft: "#E8C25A",
          ink: "#0a0a0a",
        },

        // Elevation ladder: deep-space canvas with lifted, faintly tinted
        // panels so the UI reads as "lit surfaces in orbit", not a cave.
        // HSL-component CSS vars (like --volt) so the WHOLE ladder re-tints
        // under [data-authority='governed'] — the boxes must flip with the
        // product, not stay warm on an indigo shell (founder 2026-07-19) —
        // and so a light theme can flip the same four vars.
        surface: {
          0: "hsl(var(--surface-0) / <alpha-value>)",   // canvas / void
          1: "hsl(var(--surface-1) / <alpha-value>)",   // panel / card
          2: "hsl(var(--surface-2) / <alpha-value>)",   // raised / hover / active row
          3: "hsl(var(--surface-3) / <alpha-value>)",   // popover / menu / nested
        },

        // Tonal status text (success/warning/danger) — HSL-component vars so
        // the light theme can swap in darker, AA-legible shades; the dark
        // pastels (emerald-300/amber-200/red-300 equivalents) go near-invisible
        // on paper. Use text-tone-success/warning/danger on Pill/StatTile
        // instead of hardcoded text-emerald-300 etc. See globals.css.
        tone: {
          success: "hsl(var(--tone-success) / <alpha-value>)",
          warning: "hsl(var(--tone-warning) / <alpha-value>)",
          danger: "hsl(var(--tone-danger) / <alpha-value>)",
        },

        // legacy DeFi brand colors (kept for any stragglers)
        "defi-primary": "#00E0A1",
        "defi-secondary": "#0EA5E9",
        "defi-accent": "#A78BFA",

        // DeFi specific palette
        defi: {
          green: "#10B981",
          red: "#EF4444",
          blue: "#3B82F6",
          yellow: "#F59E0B",
          purple: "#8B5CF6",
        },

        // Status colors
        status: {
          success: "#22C55E",
          warning: "#F59E0B",
          error: "#EF4444",
          info: "#3B82F6",
        },

        // Risk scale
        risk: {
          none: "#94A3B8",     // slate-400
          low: "#22C55E",      // green-500
          medium: "#EAB308",   // yellow-500
          high: "#EF4444",     // red-500
          critical: "#DC2626", // red-600
        },
      },

      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },

      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "JetBrains Mono", "Monaco", "Consolas", "monospace"],
      },

      spacing: {
        18: "4.5rem",
        88: "22rem",
      },

      maxWidth: {
        "8xl": "88rem",
        "9xl": "96rem",
      },

      backdropBlur: {
        xs: "2px",
      },

      screens: {
        'xs': '475px',
        'sm': '640px',
        'md': '768px',
        'lg': '1024px',
        'xl': '1280px',
        '2xl': '1536px',
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
  ],
};
