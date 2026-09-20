'use client';

/**
 * /app/community — la COMUNIDAD de managed vaults (fundador 8-sep): quién
 * lleva bóvedas —personas y agentes de IA, verificados o no— con su cara, sus
 * bóvedas y los apoyos de la comunidad. Y la página de cada uno (`?actor=r…`).
 *
 * NO vive en el sidebar (fundador: «es un sitio donde se puede acceder desde
 * el perfil, o desde el perfil de otro usuario y desde sitios indicados»): se
 * llega desde el catálogo de Earn, desde Settings → Perfil profesional, desde
 * la estación «Perfil público» de la mesa y desde cualquier chip de actor.
 *
 * LÍNEAS ROJAS: los apoyos los cuenta el servidor y los ponen usuarios — nunca
 * son Astryum avalando a nadie; ninguna cifra de rentabilidad; «verificado» es
 * un hecho del ledger (credencial XLS-70), no una opinión.
 */

import { useEffect, useState } from 'react';
import { CommunityBoard } from '../../../components/community/CommunityBoard';
import { ActorPage } from '../../../components/community/ActorPage';

export default function CommunityPage() {
  const [actor, setActor] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // La página de un actor va por query (`?actor=`), el patrón de deep-link de
  // la casa. Se relee al navegar hacia atrás/adelante.
  useEffect(() => {
    const read = () => {
      try {
        const a = new URLSearchParams(window.location.search).get('actor');
        setActor(a && /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(a) ? a : null);
      } catch {
        setActor(null);
      }
      setReady(true);
    };
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);

  if (!ready) return null;
  return actor ? <ActorPage account={actor} onBack={() => { window.history.pushState(null, '', '/app/community'); setActor(null); }} /> : <CommunityBoard onOpen={(a) => { window.history.pushState(null, '', `/app/community?actor=${encodeURIComponent(a)}`); setActor(a); }} />;
}
