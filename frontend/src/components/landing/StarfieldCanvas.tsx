'use client';

/**
 * Astryum — living star/asteroid field.
 *
 * A lightweight 2D-canvas depth layer behind the landing: parallaxed stars that
 * drift slowly, twinkle, lean toward the cursor by depth, link to the pointer
 * like a faint gravity well, and occasionally throw a shooting star.
 *
 * Cheap by design: particle count scales with viewport area and is capped,
 * one rAF loop, DPR-aware, pauses when the tab is hidden, and collapses to a
 * single static frame under prefers-reduced-motion.
 */

import { useEffect, useRef } from 'react';

type Star = { x: number; y: number; z: number; r: number; a: number; tw: number; vx: number; vy: number };
type Shooter = { x: number; y: number; vx: number; vy: number; life: number; len: number };

// `accent` re-tints the cursor gravity-well links with the landing theme
// (gold in Personal, indigo in Legacy); the stars themselves stay warm-white.
export default function StarfieldCanvas({ accent = '201,162,39' }: { accent?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const accentRef = useRef(accent);
  accentRef.current = accent;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const reduce =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let w = 0;
    let h = 0;
    let dpr = 1;
    let stars: Star[] = [];
    const pointer = { x: -9999, y: -9999, has: false };
    let shooters: Shooter[] = [];
    let raf = 0;
    let running = true;
    let nextShooter = 2500 + Math.random() * 3000;

    const seed = () => {
      const count = Math.min(170, Math.round((w * h) / 9000));
      stars = Array.from({ length: count }, () => {
        const z = 0.25 + Math.random() * 0.75; // depth: closer = brighter, faster
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          z,
          r: z * (Math.random() * 1.1 + 0.4),
          a: Math.random() * 0.6 + 0.2,
          tw: Math.random() * Math.PI * 2,
          vx: (Math.random() - 0.5) * 0.06 * z,
          vy: (0.04 + Math.random() * 0.08) * z,
        };
      });
    };

    const resize = () => {
      // Cap DPR at 1.5: a background star field gains nothing perceptible from a full
      // 2× render but pays ~78% more fill cost per frame on retina screens.
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };

    const drawStar = (s: Star, alpha: number) => {
      const px = pointer.has ? (pointer.x - w / 2) * s.z * 0.02 : 0;
      const py = pointer.has ? (pointer.y - h / 2) * s.z * 0.02 : 0;
      ctx.beginPath();
      ctx.arc(s.x + px, s.y + py, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(238,224,176,${alpha})`;
      ctx.fill();
      return { x: s.x + px, y: s.y + py };
    };

    const renderStatic = () => {
      ctx.clearRect(0, 0, w, h);
      stars.forEach((s) => drawStar(s, s.a * 0.7));
    };

    let last = performance.now();
    let veilSkip = 0;
    const frame = (now: number) => {
      if (!running) return;
      // Under the journey's reading veil the whole field sits behind a 6px
      // blur + 35% dim — render at ~20fps there (2 of 3 frames skipped):
      // invisible to the eye, and the veil's backdrop-filter re-samples a
      // fresh canvas frame 3× less often. The flag is stamped on <html> by
      // SolarJourney while a stop is held.
      if (document.documentElement.dataset.journeyVeil === '1') {
        veilSkip = (veilSkip + 1) % 3;
        if (veilSkip !== 0) {
          raf = requestAnimationFrame(frame);
          return;
        }
      }
      const dt = Math.min(40, now - last);
      last = now;
      ctx.clearRect(0, 0, w, h);

      // stars
      for (const s of stars) {
        s.x += s.vx * dt * 0.06;
        s.y += s.vy * dt * 0.06;
        if (s.y - 4 > h) {
          s.y = -4;
          s.x = Math.random() * w;
        }
        if (s.x < -4) s.x = w + 4;
        else if (s.x > w + 4) s.x = -4;
        s.tw += 0.02 + s.z * 0.02;
        const alpha = s.a * (0.6 + 0.4 * Math.sin(s.tw));
        const pos = drawStar(s, alpha);

        // gravity-well link to the cursor for the brighter, nearer stars
        if (pointer.has && s.z > 0.6) {
          const dx = pos.x - pointer.x;
          const dy = pos.y - pointer.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 140 * 140) {
            const o = (1 - Math.sqrt(d2) / 140) * 0.32;
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            ctx.lineTo(pointer.x, pointer.y);
            ctx.strokeStyle = `rgba(${accentRef.current},${o})`;
            ctx.lineWidth = 0.6;
            ctx.stroke();
          }
        }
      }

      // shooting stars — cadence raised 2026-07-25 (founder: "caen cada 5
      // segundos más o menos, pon alguno más"): roughly one every 2.5–5.5s,
      // up to 4 alive at once. Time-driven, so they never freeze mid-sky
      // while the visitor reads (unlike the scroll-bound transit comets,
      // removed the same day).
      nextShooter -= dt;
      if (nextShooter <= 0 && shooters.length < 4) {
        const fromLeft = Math.random() > 0.5;
        const speed = 0.5 + Math.random() * 0.4;
        shooters.push({
          x: fromLeft ? -40 : w + 40,
          y: Math.random() * h * 0.6,
          vx: (fromLeft ? 1 : -1) * speed,
          vy: speed * 0.42,
          life: 1,
          len: 90 + Math.random() * 80,
        });
        nextShooter = 2500 + Math.random() * 3000;
      }
      shooters = shooters.filter((m) => m.life > 0);
      for (const m of shooters) {
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        m.life -= dt / 900;
        const tx = m.x - m.vx * m.len * 0.5;
        const ty = m.y - m.vy * m.len * 0.5;
        const grad = ctx.createLinearGradient(m.x, m.y, tx, ty);
        grad.addColorStop(0, `rgba(255,240,200,${0.9 * m.life})`);
        grad.addColorStop(1, 'rgba(255,240,200,0)');
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(tx, ty);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }

      raf = requestAnimationFrame(frame);
    };

    const onMove = (e: PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.has = true;
    };
    const onLeave = () => {
      pointer.has = false;
    };
    const onVisibility = () => {
      running = !document.hidden;
      if (running && !reduce) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      } else {
        cancelAnimationFrame(raf);
      }
    };

    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    if (reduce) {
      renderStatic();
    } else {
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerleave', onLeave);
      raf = requestAnimationFrame(frame);
    }

    return () => {
      cancelAnimationFrame(raf);
      running = false;
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-0 pointer-events-none"
      aria-hidden
      style={{ width: '100%', height: '100%' }}
    />
  );
}
