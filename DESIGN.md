---
name: Astryum
description: Non-custodial control plane for Flare DeFi capital — warm gold on deep space, protection-first
colors:
  space-void: "#050505"
  space-deep: "#0a0a0a"
  space-raised: "#18160f"
  paper: "#ffffff"
  gold: "#C9A227"
  gold-soft: "#E8C25A"
  gold-deep: "#8A6D14"
  cream-light: "#F1E9D2"
  signal-green: "#4ade80"
  signal-amber: "#fbbf24"
  signal-red: "#f87171"
typography:
  display:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "clamp(2rem, 4vw, 3rem)"
    fontWeight: 300
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "clamp(1.875rem, 3vw, 2.25rem)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.625
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.1em"
  mono:
    fontFamily: "JetBrains Mono, Monaco, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  sm: "4px"
  md: "8px"
  lg: "16px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  "2xl": "64px"
  "3xl": "96px"
  "4xl": "128px"
components:
  pill-eyebrow:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.paper}"
    rounded: "{rounded.full}"
    padding: "6px 16px"
    typography: "{typography.label}"
  card-feature:
    backgroundColor: "{colors.space-deep}"
    textColor: "{colors.paper}"
    rounded: "{rounded.lg}"
    padding: "32px"
  card-feature-hover:
    backgroundColor: "{colors.space-raised}"
    textColor: "{colors.paper}"
    rounded: "{rounded.lg}"
    padding: "32px"
  icon-container:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.gold}"
    rounded: "{rounded.md}"
    size: "40px"
  kbd:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
    typography: "{typography.mono}"
  button-primary:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.space-void}"
    rounded: "{rounded.md}"
    padding: "10px 18px"
    typography: "{typography.title}"
  button-ghost:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
    padding: "10px 18px"
    typography: "{typography.title}"
---

# Design System: Astryum

## 1. Overview

**Creative North Star: "The Cockpit at Night"**

Astryum reads like mission control at night. Deep, faintly-warm space-black carries the load; a single warm gold (`#C9A227`) is the one chromatic voice, appearing only at moments of emphasis. The screen is dense with numbers but never noisy: white text shifts through opacity steps for hierarchy without color clutter, and surfaces lift through tonal layering (`#050505` → `#0a0a0a` → `#18160f`) instead of shadow chrome. Motion is choreographed but minimal: an opening reveal, orbits and drift in the hero, a subtle scale on hover. Nothing demands attention; everything earns it.

The system rejects the saturated DeFi visual canon: no neon casino glow, no Robinhood-style gamification, no platform-degen red-green flashing, no Web3-corporate isometric illustrations. Gold is the brand signature — used as ink in body-copy emphasis, on the asteroid mark, and as the accent on active state — never as decoration on every surface. When it appears, it carries meaning: the brand promise (*"Tu capital. Tu control. Tu firma."*), a state transition, the live signal of operative status. The one deliberate exception is the single light "signature break" — a warm cream fold that inverts the space field to punctuate the non-custodial promise.

Density is intentional, not anxious. Every number, every label, every pill has a single typographic weight that earns it. The body breathes in white-space the way an instrument panel does between gauges: enough to read each reading without confusion.

**Key Characteristics:**
- Deep space-black canvas (`#050505` → `#0a0a0a` → `#18160f`) with tonal layering for elevation (no decorative shadows)
- A single warm gold (`#C9A227`) as the chromatic voice, kept under ~10% of screen surface
- White text in graded opacity steps for hierarchy (100, 90, 55, 45, 30, 10 percent)
- Faint gold radial glows provide ambient atmosphere, never foreground
- Motion is functional: opening reveals, hero orbits/drift, hover on cards; one disruptive light "signature break"
- Typography is one family (Inter) with weight contrast doing the heavy lifting (300, 500, 600, 700)
- Borders are 1px hairlines in `paper/8–10` (rgba 255,255,255,0.08–0.1), never colored except focus/active

## 2. Colors: Gold-on-Deep-Space Palette

The palette is warm-dark at heart — deep space-black and paper — with a single warm gold as the chromatic voice. Status colors are introduced sparingly for system feedback.

### Primary — the gold voice

- **Gold** (`#C9A227`, the app's `volt` token): the brand accent. Active nav, key figures, the asteroid mark, CTA fills, focus/active state. Solid only — never a decorative gradient.
- **Gold Soft** (`#E8C25A`): the lighter end of gold — hero orbits, progress rails, secondary accents and glows.
- **Gold Deep** (`#8A6D14`): gold on light surfaces (the signature-break eyebrow), where full gold would glare.

### Atmosphere

- Faint gold radial glows (`rgba(201,162,39,0.06–0.12)`, blurred 100–140px) as ambient space light. Never a foreground fill.
- Star field: sparse white specks on space-black; **inverted** (dark specks on cream) inside the light signature-break.

### Status (stated in words too, never colour alone)

- **Signal Green** (`#4ade80`): live / healthy. **Amber** (`#fbbf24`): watch / attention. **Red** (`#f87171`): act / protect. A colour-blind user must distinguish state without seeing the hue.

### Neutral

- **Space Void** (`#050505`): page background, the foundation beneath everything.
- **Space Deep** (`#0a0a0a`): default card surface, the first step up.
- **Space Raised** (`#18160f`): hover / raised surface — a warm-tinted lift, not a shadow.
- **Cream Light** (`#F1E9D2`): the one light surface — the inverted "signature break" fold, with dark ink text.
- **Paper** (`#ffffff`) at graded alpha (90 / 55 / 45 / 30 / 10 / 5 percent) for text hierarchy, hairline borders, and subtle surfaces.

### Named Rules

**The Gold Rarity Rule.** Gold appears on ≤10% of any screen and carries meaning every time — the brand promise, an active state, a live signal. Decorative gold on cards, buttons, or dividers is prohibited.

**The One-Light-Beat Rule.** The page is dark space throughout, with exactly one light fold (the signature break) as a deliberate contrast beat. Additional light sections dilute it; keep it singular.

**The Warm-Space Rule.** Neutrals are deep, faintly-warm space-black — not pure `#000000`, not cool. Warmth comes from the near-black tint plus the gold accent, never from a cream/sand *body* background (the single light beat is the only exception).

## 3. Typography

**Display Font:** Inter (with system-ui, sans-serif fallback)
**Body Font:** Inter (same family in different weights)
**Label / Mono Font:** JetBrains Mono (with Monaco, Consolas fallback)

**Character:** One sans-serif family carries the entire system. Weight contrast (300, 400, 500, 600, 700) does the work that a multi-family pairing would. The closing pitch uses font-weight 300 deliberately to feel editorial and final; the headlines use 700 to feel grounded and operational. Monospace appears only on numeric data and keyboard shortcuts, never on body copy.

### Hierarchy

- **Display** (300, `clamp(2rem, 4vw, 3rem)`, line-height 1.1): closing pitch and editorial-weight statements. The light weight is intentional; it whispers conclusions instead of shouting them.
- **Headline** (700, `clamp(1.875rem, 3vw, 2.25rem)`, line-height 1.1): section titles. The hero h1 and "Una capa de inteligencia..." headline both live here. Tracking pulls in at -0.025em to feel tight without cramping.
- **Title** (600, 1.125rem, line-height 1.4): feature card titles. Compact, scannable, anchored.
- **Body** (400, 1rem, line-height 1.625): descriptive copy in features and hero subtitle. Line length capped at 65 to 75 characters via `max-w-2xl` on hero paragraphs.
- **Label** (500, 0.75rem, line-height 1, letter-spacing 0.1em, uppercase): used inside the eyebrow pill, footer separators, and section markers. All-caps reserved exclusively for these short labels (≤4 words).
- **Mono** (500, 0.75rem, JetBrains Mono): keyboard shortcuts (`kbd`) and any numeric data display (HF, LTV, USD values in the app surface).

### Named Rules

**The Single Family Rule.** One typeface (Inter) carries the entire system. Adding a second sans (Manrope, DM Sans, Geist) is prohibited; weight contrast within Inter does the differentiation work.

**The Light-Display Rule.** When type goes large (display tier), weight goes down (300, not 700). This is the editorial move that separates a cockpit from a billboard. The bold hero h1 is the exception, kept short and tracked tight.

**The All-Caps Containment Rule.** Uppercase + 0.1em letter-spacing is reserved for ≤4-word labels. Sentences in ALL CAPS are forbidden. The eyebrow pill, "system operational" status, footer separators: yes. Body copy: never.

## 4. Elevation

The system uses **tonal layering**, not shadows. Surfaces lift by changing their black value (Void → Ink Deep → Ink Raised), not by acquiring a drop shadow. The only shadows present are colored ambient glows: the logo ring shadow and the gradient-blur background atmosphere. Both are atmospheric, not structural.

### Tonal Layers (depth without shadow)

- **L0 Void** (`#000000`): page background. The literal floor.
- **L1 Ink Deep** (`#09090b`): feature cards default surface, footer surface.
- **L2 Ink Raised** (`#18181b`): feature cards on hover. The lift is a subtle 9 to 24 hex shift, not a shadow.

### Ambient Atmosphere (decorative only, behind everything)

- **Background blob** (Glow Blue at 20%, blur 120px): top-left ambient layer, slow pulse.
- **Background blob** (Glow Purple at 20%, blur 120px, 1s pulse delay): top-right ambient layer.
- **Background blob** (Glow Pink at 10%, blur 140px, 2s pulse delay): bottom-third ambient layer.
- **Grid background** (`linear-gradient` at 60px x 60px, white/0.5 lines at 0.03 opacity): the floor pattern of the cockpit. Always present, never noticeable until you look for it.

### Signature Shadows (reserved)

- **Logo ring glow** (`shadow-[0_0_30px_rgba(201,162,39,0.5)]`): warm gold aura around the brand mark only. Never replicated on other elements.
- **Logo drop shadow** (`drop-shadow-[0_0_22px_rgba(201,162,39,0.7)]`): gold glow behind the hero/centre logo image. Singular use.

### Named Rules

**The No-Box-Shadow Rule.** Elements never receive `box-shadow` for elevation. If a card needs to lift, it changes its background. Drop shadows for "depth" or "polish" are forbidden.

**The Glow Singularity Rule.** The gold glow shadow exists once in the system: on the brand mark. Replicating it on buttons, cards, or pills dilutes the signature.

## 5. Components

### Pill Eyebrow (status badge)

The signature pill used as section eyebrow and live-status indicator. Carries operational text, often paired with a pulsing dot.

- **Shape:** fully rounded (`rounded-full`)
- **Surface:** `bg-white/5` with `border border-white/10` and `backdrop-blur-sm`
- **Padding:** 6px vertical, 16px horizontal (`px-4 py-1.5`)
- **Typography:** label tier (uppercase, 0.75rem, 0.1em letter-spacing, white/70)
- **Optional status dot:** 6px circle (`w-1.5 h-1.5`) in Signal Green with pulse animation
- **States:** static; the dot pulses, the pill does not

### Feature Card

The dense information block. Lives inside a hairline-divided grid where the dividers are achieved with `gap-px` over a `bg-white/5` parent (a 1px gap reveals the parent surface, which reads as a hairline).

- **Shape:** the outer grid is `rounded-2xl` (16px); individual cards have no radius of their own
- **Surface default:** `bg-zinc-950`
- **Surface hover:** `bg-zinc-900` (tonal lift, no shadow)
- **Internal padding:** 32px (`p-8`)
- **Title:** Title tier (1.125rem, weight 600)
- **Description:** Body tier at `text-white/50`, line-height 1.625
- **Icon position:** top-left, 40x40 icon container above title

### Icon Container

The accent square that holds the lucide icon at the top of each feature card.

- **Size:** 40x40px (`w-10 h-10`)
- **Shape:** `rounded-lg` (8px)
- **Background:** gold tint (`bg-volt/10`, i.e. `rgba(201,162,39,0.1)`) — solid, no gradient
- **Border:** 1px `border-white/10`
- **Icon stroke:** gold (`text-volt`), `strokeWidth={1.5}` always (never the default 2)
- **Hover:** `scale-110` on group hover (the parent card hover triggers the icon scale)

### Card Container (general)

For any container outside the feature grid (modal panels, sidebar panels, login modal frames).

- **Shape:** `rounded-2xl` (16px)
- **Surface:** `bg-white/5` for translucent floating panels, `bg-zinc-950` for solid surfaces
- **Border:** 1px `border-white/10`
- **Backdrop:** `backdrop-blur-sm` only when the surface is translucent (`bg-white/5`)
- **Internal padding:** 24px default, 32px for feature-density cards

### Kbd (keyboard shortcut)

Hint chips inside the keyboard combo at the bottom of the hero.

- **Shape:** `rounded` (4px)
- **Background:** `bg-white/5`
- **Border:** 1px `border-white/10`
- **Padding:** 4px vertical, 8px horizontal
- **Typography:** Mono tier, `text-white/30` to `text-white/40`

### Button (primary action)

Solid action button used in modals, action surfaces, and CTAs across the app.

- **Shape:** `rounded-xl` (12px) for the brand primary action
- **Surface:** solid gold (`background: #C9A227`) with black label text — never a gradient
- **Hover:** subtle lift (`-translate-y-0.5`) with a soft gold shadow
- **Padding:** 10px vertical, 16px horizontal
- **Typography:** Title tier, 0.875rem (`text-sm`), weight 600, black on gold
- **Shadow:** gold glow scoped to CTAs only (`0 14px 32px -12px rgba(201,162,39,0.5)`) — the one exception to the no-box-shadow rule

### Button (ghost / secondary)

The framed action used as a secondary or cancel option.

- **Shape:** `rounded-xl` (12px)
- **Surface:** `bg-white/5`
- **Border:** 1px `border-white/10`
- **Hover:** `bg-white/10`
- **Typography:** Title tier at `text-white/70`

### Footer Strip

The minimal footer at the bottom of the landing.

- **Border-top:** 1px `border-white/5` (subtler than card borders)
- **Padding:** 32px vertical, 24px horizontal
- **Typography:** 0.75rem (`text-xs`), `text-white/30`
- **Layout:** flex row on desktop, stacked on mobile

## 6. Do's and Don'ts

### Do:

- **Do** keep the canvas deep, faintly-warm space-black (`#050505`). The mission-control metaphor depends on the dark.
- **Do** lift surfaces by tonal step (Space Void → Space Deep → Space Raised). Hover is a hex change, not a shadow.
- **Do** use gold (`#C9A227`) sparingly and solid, on under 10% of any screen, always with meaning (brand promise, active state, decisive transition) — never as a gradient.
- **Do** keep white text in exactly five opacity steps (100, 90, 60, 40, 10 percent). Pick one of the five.
- **Do** use Inter in weight contrast (300 for editorial display, 700 for grounded headlines, 600 for titles, 400 for body, 500 for labels).
- **Do** use JetBrains Mono for numeric data and keyboard shortcuts only.
- **Do** use lucide icons at `strokeWidth={1.5}` consistently. The default 2 is too heavy for this register.
- **Do** use `text-wrap: balance` on h1–h3 headings (display, headline tiers) for even line lengths.
- **Do** animate reveals with `opacity: 0` to `opacity: 1` + 20px translateY, durations 0.5 to 0.7s, occasional `filter: blur(8px)` to `blur(0px)` on hero elements.
- **Do** stagger feature card reveals with 0.08s delay between cards.
- **Do** respect `prefers-reduced-motion: reduce`. Crossfade or instant transition replaces every translateY.
- **Do** use hairline dividers via `gap-px` over a `bg-white/5` parent. The 1px gap reveals the divider; the cards themselves have no border.

### Don't:

- **Don't** use neon casino glow, saturated decorative gradients, or constant attention-pulling animation. PRODUCT.md names this anti-reference explicitly: nothing here looks like a slot machine.
- **Don't** add Robinhood-style gamification, FOMO push notifications, "+$24 today" dopamine-hit copy, or confetti on transaction confirmations. Astryum rewards understanding, not consulting.
- **Don't** apply decorative gradients to feature cards, buttons, or section dividers. Gold is a solid accent; gradients as decoration break the system.
- **Don't** introduce a cream/sand *body* background. Neutrals run deep warm-tinted space-black through paper; the single light "signature break" fold is the only exception, and it is deliberate.
- **Don't** use `box-shadow` for elevation on cards, panels, or inputs. Lift through tonal layering instead. The two glow exceptions (logo ring, primary CTA shadow) are the entire shadow vocabulary.
- **Don't** use `border-left` or `border-right` greater than 1px as a colored accent stripe on cards, list items, callouts, or alerts. Side-stripe borders are forbidden across the system.
- **Don't** pair Inter with a second sans-serif. Manrope, DM Sans, Geist, Satoshi: none of them. Weight contrast within Inter does the work.
- **Don't** use ALL CAPS body sentences. Uppercase is reserved for ≤4-word labels with 0.1em tracking.
- **Don't** use a "tiny uppercase tracked eyebrow above every section" as default scaffolding. The pill-eyebrow exists for status indication, not as decoration above every h2.
- **Don't** use numbered section markers (`01 · About / 02 · Features / 03 · Pricing`) as scaffolding. Numbers earn their place when the section is genuinely a sequence.
- **Don't** use sketchy SVG illustrations, doodle aesthetics, `feTurbulence` paper textures, or isometric "Web3 connected" graphics. The logo and lucide icons are the visual vocabulary.
- **Don't** use `repeating-linear-gradient` stripe backgrounds. Decorative stripes are forbidden.
- **Don't** use rounded corners ≥24px on cards or sections. The card top radius is 16px (`rounded-2xl`); going higher reads as cartoonish, not premium.
- **Don't** crash the page on undefined values. Every `toFixed` must be guarded; every gradient text container must have fallback content. The system is dense by design; brittleness shows immediately.
