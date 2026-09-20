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
 *
 * ─── Travel (founder 2026-08-22: "algún toque interesante") ─────────────────
 * The canvas is fixed, so for a whole page of scrollytelling the sky used to
 * hang perfectly still while the content flew past it — the visitor moved, the
 * universe did not. Three additions turn the field into something you travel
 * THROUGH, all driven by one number (the scroll delta) and all free:
 *
 *  · DEPTH DRIFT — every star shifts against the scroll in proportion to its
 *    own z, so the near ones sweep and the far ones barely move. Real parallax,
 *    no extra layer.
 *  · WARP STREAKS — scroll fast and the stars stretch into short trails along
 *    the direction of travel, then relax the instant you stop. Same primitive
 *    as a drawn dot (one stroked line, round caps), so the cost is unchanged.
 *  · DIFFRACTION FLARES — once in a while a near star throws a four-point
 *    spike and fades. Only stars with z > 0.78 are eligible and each waits
 *    9–25s, so at any moment it is a handful of extra strokes.
 *
 * Every one of them is skipped under prefers-reduced-motion, which still
 * renders the single static frame it always did.
 */

import { useEffect, useRef } from 'react';

type Star = {
  x: number;
  y: number;
  z: number;
  r: number;
  a: number;
  tw: number;
  vx: number;
  vy: number;
  /** ms until this star's next diffraction flare (near stars only) */
  fw: number;
  /** flare life, 1 → 0 */
  fa: number;
};
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
    // Travel: `dScroll` is this frame's scroll delta, `warp` its smoothed
    // magnitude — the streaks read off the smoothed one so a single jumpy
    // wheel tick can't flash the whole sky into hyperspace.
    let lastScroll = 0;
    let dScroll = 0;
    let warp = 0;

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
          // staggered on purpose — a synchronised sky twinkles like a fault
          fw: 2000 + Math.random() * 20000,
          fa: 0,
        };
      });
    };

    const resize = () => {
      const nw = window.innerWidth;
      const nh = window.innerHeight;
      // Mobile browsers fire `resize` on every URL-bar collapse/expand while
      // scrolling. Reallocating the canvas (which clears it) and re-seeding
      // made the whole sky visibly teleport mid-scroll — ignore height-only
      // jitter below the chrome's travel, and on real changes SCALE the stars
      // into the new box instead of re-randomizing them.
      if (w !== 0 && nw === w && Math.abs(nh - h) < 140) return;
      const sx = w ? nw / w : 1;
      const sy = h ? nh / h : 1;
      // Cap DPR at 1.5: a background star field gains nothing perceptible from a full
      // 2× render but pays ~78% more fill cost per frame on retina screens.
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      w = nw;
      h = nh;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (stars.length) {
        for (const s of stars) {
          s.x *= sx;
          s.y *= sy;
        }
      } else {
        seed();
      }
      // Setting canvas.width wipes the bitmap; without a rAF loop (reduced
      // motion) the sky stayed blank after the first resize — repaint it.
      if (reduce) renderStatic();
    };

    // `stretch` is the motion-blur length in px (0 = a plain dot). A stroked
    // line with round caps IS the dot when its length is zero, so warping
    // costs the same one path per star that standing still does.
    const drawStar = (s: Star, alpha: number, stretch = 0) => {
      const px = pointer.has ? (pointer.x - w / 2) * s.z * 0.02 : 0;
      const py = pointer.has ? (pointer.y - h / 2) * s.z * 0.02 : 0;
      const x = s.x + px;
      const y = s.y + py;
      if (stretch > 0.8) {
        const half = stretch / 2;
        ctx.beginPath();
        ctx.moveTo(x, y - half);
        ctx.lineTo(x, y + half);
        ctx.strokeStyle = `rgba(238,224,176,${alpha})`;
        ctx.lineWidth = s.r * 2;
        ctx.lineCap = 'round';
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(238,224,176,${alpha})`;
        ctx.fill();
      }
      return { x, y };
    };

    // Four-point diffraction spike — the flash a bright star throws through a
    // lens. `life` runs 1 → 0; the spike grows as it fades.
    const drawFlare = (x: number, y: number, life: number, r: number) => {
      const ease = Math.sin(Math.PI * (1 - life)); // in and back out
      const len = r * (5 + 16 * (1 - life));
      const o = ease * 0.5;
      if (o < 0.02) return;
      const g = ctx.createRadialGradient(x, y, 0, x, y, len);
      g.addColorStop(0, `rgba(255,244,214,${o})`);
      g.addColorStop(1, 'rgba(255,244,214,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 1;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - len, y);
      ctx.lineTo(x + len, y);
      ctx.moveTo(x, y - len);
      ctx.lineTo(x, y + len);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, r * 1.6, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,244,214,${o * 0.6})`;
      ctx.fill();
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

      // travel — one scroll read per frame (scrollY is a cheap, layout-free
      // property), clamped so a jump-to-anchor doesn't fling the whole sky
      const sy = window.scrollY || document.documentElement.scrollTop || 0;
      dScroll = Math.max(-260, Math.min(260, sy - lastScroll));
      lastScroll = sy;
      warp += (Math.abs(dScroll) - warp) * 0.22;

      // stars
      for (const s of stars) {
        s.x += s.vx * dt * 0.06;
        s.y += s.vy * dt * 0.06;
        // depth drift: near stars sweep against the scroll, far ones barely move
        s.y -= dScroll * s.z * 0.07;
        if (s.y - 4 > h) {
          s.y = -4;
          s.x = Math.random() * w;
        } else if (s.y + 4 < 0) {
          // scrolling up refills the sky from the bottom edge
          s.y = h + 4;
          s.x = Math.random() * w;
        }
        if (s.x < -4) s.x = w + 4;
        else if (s.x > w + 4) s.x = -4;
        s.tw += 0.02 + s.z * 0.02;
        const alpha = s.a * (0.6 + 0.4 * Math.sin(s.tw));
        // The trail is a FAST-scroll effect, not a scroll effect: a comfortable
        // read runs ~10-30px per frame and must stay dots, so the threshold sits
        // at 12 and the cap at 22px. Anything looser and every ordinary flick
        // put the whole sky into hyperspace.
        const stretch = warp > 12 ? Math.min(22, (warp - 12) * 0.35 * s.z) : 0;
        const pos = drawStar(s, alpha, stretch);

        // diffraction flare — near stars only, on long independent fuses
        if (s.z > 0.78) {
          if (s.fa > 0) {
            s.fa -= dt / 1500;
            if (s.fa > 0) drawFlare(pos.x, pos.y, s.fa, s.r);
          } else {
            s.fw -= dt;
            if (s.fw <= 0) {
              s.fa = 1;
              s.fw = 9000 + Math.random() * 16000;
            }
          }
        }

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
      // Touch never fires pointerleave, so a single tap used to freeze the
      // parallax offset and the gravity-well lines at the tap point forever.
      if (e.pointerType === 'touch') return;
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
        // a tab can come back at a completely different scroll offset —
        // re-anchor so the first frame doesn't warp
        lastScroll = window.scrollY || document.documentElement.scrollTop || 0;
        raf = requestAnimationFrame(frame);
      } else {
        cancelAnimationFrame(raf);
      }
    };

    resize();
    lastScroll = window.scrollY || document.documentElement.scrollTop || 0;
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    if (reduce) {
      renderStatic();
    } else {
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerleave', onLeave);
      window.addEventListener('pointercancel', onLeave);
      raf = requestAnimationFrame(frame);
    }

    return () => {
      cancelAnimationFrame(raf);
      running = false;
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('pointercancel', onLeave);
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
