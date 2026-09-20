'use client';

/**
 * StepShot — una captura (o un vídeo corto) de UN paso de una guía, con su
 * pie. La pieza que el Legacy usa en su tutorial de Multisign, extraída para
 * que la guía de Coinbase de la mesa del gestor enseñe lo mismo igual.
 *
 *  · Si el fichero no existe todavía, se pinta un marco-placeholder con el
 *    pie y el nombre esperado — la guía funciona antes de tener las capturas
 *    y no rompe nada (misma regla que /legacy/xaman).
 *  · `.mp4` / `.webm` → <video> mudo, en bucle, que arranca al entrar en
 *    pantalla; lo demás → <img>. Nada se descarga hasta que se ve.
 *
 * Las capturas se sirven TAL CUAL desde /public: sin direcciones, nombres ni
 * saldos que no se quieran publicar.
 */

import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';

export function StepShot({ src, caption, poster }: { src: string; caption: string; poster?: string }) {
  // Cadena de reserva: vídeo → (si falla y hay póster) imagen → marco vacío.
  // Así una guía puede tener solo capturas hoy y ganar vídeos mañana sin
  // tocar código: el mismo nombre con otra extensión.
  const [mode, setMode] = useState<'video' | 'image' | 'missing'>(() => (/\.(mp4|webm)$/i.test(src) ? 'video' : 'image'));
  const missing = mode === 'missing';
  const isVideo = mode === 'video';
  const imageSrc = /\.(mp4|webm)$/i.test(src) ? poster ?? '' : src;
  const setMissing = (_v: boolean) => setMode('missing');
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // El vídeo solo se reproduce mientras está a la vista: en una guía de
  // ocho pasos, ocho bucles a la vez eran un ventilador encendido.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) void v.play().catch(() => undefined);
      else v.pause();
    }, { threshold: 0.4 });
    io.observe(v);
    return () => io.disconnect();
  }, [isVideo, missing]);

  return (
    <figure className="mt-1.5 w-fit max-w-full overflow-hidden rounded-xl border border-ink/10 bg-ink/[0.04]">
      {missing ? (
        <div className="flex h-28 w-64 max-w-full flex-col items-center justify-center gap-1 px-3 text-center text-ink/30">
          <Camera size={16} aria-hidden />
          <span className="text-[10px] leading-snug">{caption}</span>
          <span className="font-mono text-[9px] text-ink/20">{src}</span>
        </div>
      ) : (
        <>
          {isVideo ? (
            <video
              ref={videoRef}
              src={src}
              poster={poster}
              muted
              loop
              playsInline
              preload="metadata"
              onError={() => setMode(poster ? 'image' : 'missing')}
              className="max-h-80 w-auto max-w-full"
              aria-label={caption}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- captura estática de tutorial
            <img src={imageSrc} alt={caption} loading="lazy" onError={() => setMissing(true)} className="max-h-80 w-auto max-w-full" />
          )}
          {/* w-0 + min-w-full: el pie toma el ancho de la captura y nunca ensancha el marco. */}
          <figcaption className="w-0 min-w-full border-t border-ink/5 px-3 py-1.5 text-[10px] leading-relaxed text-ink/40">
            {caption}
          </figcaption>
        </>
      )}
    </figure>
  );
}

export default StepShot;
