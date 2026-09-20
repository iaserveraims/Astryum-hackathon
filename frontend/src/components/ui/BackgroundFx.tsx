'use client';

// La ATMÓSFERA del panel — y es lo primero que cambia con el tema.
//
//   · astryum       — el mismo espacio profundo por el que vuela la landing,
//                     visto desde dentro de la cabina: base radial cálida, un
//                     campo de estrellas que respira, dos auras doradas lentas
//                     y un grano casi invisible. Deliberadamente más callado
//                     que la landing (una pantalla densa tiene que seguir
//                     leyéndose): las estrellas son puntos CSS estáticos, las
//                     auras se mueven solo por traslación, nada corre.
//   · institutional — el RAYADO DE SEGURIDAD (ui/skin/marks.tsx): trama de
//                     ondas finas, dos rosetas de guilloché como marca de agua
//                     y una viñeta. Ni estrellas, ni auras, ni grano — el
//                     papel no tiene cielo, y un aura difusa es exactamente lo
//                     que haría que la lámina volviera a parecer una nave.
//
// Las dos caras ocupan el mismo hueco y cuestan lo mismo: una capa fija detrás
// de todo, sin eventos de ratón.

import { useEngraved } from '../../stores/themeStore';
import { GuillocheField } from './skin/marks';

export default function BackgroundFx() {
  const engraved = useEngraved();

  if (engraved) {
    return (
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none" aria-hidden>
        {/* El tono del papel: un lavado plano del color del tema sobre
            --shell-bg. Plano a propósito — un degradado radial aquí volvería
            a dibujar un sol, que es justo el mundo del que este tema sale. */}
        <div className="absolute inset-0" style={{ background: 'hsl(var(--volt) / 0.028)' }} />
        <GuillocheField />
        {/* La sombra del canto superior: asienta el chrome contra el papel,
            como el doblez de una hoja encuadernada. */}
        <div
          className="absolute inset-x-0 top-0 h-40"
          style={{ background: 'linear-gradient(to bottom, hsl(var(--ink) / 0.05), transparent)' }}
        />
      </div>
    );
  }

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
