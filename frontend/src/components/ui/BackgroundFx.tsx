'use client';

// The app's atmosphere — the same deep space the landing flies through, seen
// from inside the cabin: warm radial base, a faint breathing star field, two
// slow gold auras and a near-invisible grain. Deliberately quieter than the
// landing (dense screens must stay readable): stars are static CSS dots, the
// auras drift by translation only, nothing moves fast.
export default function BackgroundFx() {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none" aria-hidden>
      <style>{`
        @keyframes fxBreath { 0%,100% { opacity: .45; } 50% { opacity: .8; } }
        @media (prefers-reduced-motion: reduce) { .fx-anim { animation: none !important; } }
      `}</style>

      {/* deep-space base — a translucent accent lift over the shell's own
          bg (var(--shell-bg)), so the atmosphere follows the product theme:
          warm over Astryum, cold over Legacy */}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(130% 95% at 50% -10%, hsl(var(--volt) / 0.07) 0%, hsl(var(--volt) / 0.025) 42%, transparent 100%)' }}
      />

      {/* faint star field (globals.css .starfield: masked dot grid, slow
          opacity breath) — the single strongest carrier of the landing's aura */}
      <div className="starfield absolute inset-0" />

      {/* soft gold aura, slow breath */}
      <div
        className="fx-anim absolute -top-56 left-1/2 -translate-x-1/2 w-[860px] h-[640px] rounded-full blur-[160px]"
        style={{ background: 'radial-gradient(circle, hsl(var(--volt) / 0.12), transparent 70%)', animation: 'fxBreath 16s ease-in-out infinite' }}
      />

      {/* second aura low-right — the depth cue the landing gets from its
          bottom aura; drifts by translation only (aurora-drift is composited) */}
      <div
        className="aurora-drift absolute bottom-[-22%] right-[-12%] w-[560px] h-[560px] rounded-full blur-[140px]"
        style={{ background: 'radial-gradient(circle, hsl(var(--volt-soft) / 0.07), transparent 70%)' }}
      />

      {/* subtle top vignette to seat the chrome */}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(120% 80% at 50% -10%, hsl(var(--volt) / 0.05), transparent 42%)' }}
      />

      {/* fine static grain for premium texture (plain overlay, composited once) */}
      <div
        className="absolute inset-0"
        style={{
          opacity: 0.03,
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          backgroundSize: '160px 160px',
        }}
      />
    </div>
  );
}
