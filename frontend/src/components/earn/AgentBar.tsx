'use client';

/**
 * AgentBar — el agente como CAPA, no como lugar (fundador 2026-08-29: elegida
 * la barra de mando sobre cuatro puertas). Una sola línea tranquila — la
 * chispa, un placeholder afinado a su superficie, la flecha — presente en el
 * hub y dentro de cada menú.
 *
 * v2 (mismo día): enviar ya no despliega el chat aquí — abre el AGENTE COMO
 * OPERACIÓN, anclado a la derecha («como si fuera una estrategia»), sembrado
 * con la frase. La conversación vive en el host global: sobrevive a la
 * navegación, se minimiza a píldora y NO cuenta para el tope de tres. Una
 * frase nueva con el agente ya vivo es un mensaje más en la misma
 * conversación (identidad singleton + seedKey).
 *
 * v3 (fundador, tercera pasada del día: «a la que se abre una estrategia se
 * va abajo del todo el textbox... quiero que esté fijo, una burbuja que no
 * moleste»): variant='bubble' para DENTRO de los menús — una burbuja chica
 * que el padre deja pegada al borde inferior (sticky), y que al pasar el
 * ratón o tocarla se despliega en la barra completa con sus ideas ENCIMA
 * (está en el fondo del viewport: hacia abajo no hay sitio). Plegada, no
 * tapa nada. El hub conserva la barra en flujo (variant='bar').
 */

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp, Sparkles } from 'lucide-react';
import { HelpDot } from '../ui/HelpDot';
import { useOperationStore } from '../../stores/operationStore';
import { useDockStore } from '../../stores/dockStore';
import { useT } from '../../i18n/LanguageProvider';

export function AgentBar({
  placeholder,
  suggestions = [],
  variant = 'bar',
  chipsAlways = false,
  trailing,
}: {
  /** La frase de invitación, afinada a la superficie que la monta. */
  placeholder: string;
  /** Ideas de prompt YA traducidas (fundador 2026-08-29: «reactivo al paso
   *  del ratón y muestre opciones básicas») — se despliegan junto a la barra
   *  al pasar el ratón o enfocar; tocar una la envía tal cual. */
  suggestions?: string[];
  /** 'bar': la línea en flujo (el hub). 'bubble': la burbuja fija — INERTE
   *  desde el 2026-08-29 (cuarta pasada del fundador: el agente sale de las
   *  pantallas de estrategias; el hub concentra su presencia). Se conserva
   *  sin montar, norma de la casa. */
  variant?: 'bar' | 'bubble';
  /** El héroe del hub: las ideas de prompt SIEMPRE a la vista, sin esperar
   *  al ratón — presencia, no descubrimiento. */
  chipsAlways?: boolean;
  /** Cromo extra DENTRO de la barra, junto a la flecha (fundador 2026-08-30:
   *  el relojito del historial vive aquí, no flotando sobre la tarjeta). */
  trailing?: React.ReactNode;
}) {
  const { t } = useT();
  const [text, setText] = useState('');
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  /** Abierta A PROPÓSITO (clic, toque o Tab), no de pasada. Solo entonces el
   *  campo recibe el foco: enfocar al MERO paso del ratón robaría el teclado
   *  a lo que el usuario estuviera haciendo — y, peor, dejaría la barra
   *  desplegada para siempre, porque ese foco la mantendría viva. */
  const [opened, setOpened] = useState(false);
  const openAgentOp = useOperationStore((st) => st.openAgentOp);
  const setDocked = useDockStore((st) => st.setDocked);

  const fire = (phrase: string) => {
    if (openAgentOp(phrase)) {
      // Anclado a la derecha desde el primer momento (pedido literal); en
      // pantallas sin lado, la superficie ya lo convierte en hoja completa.
      setDocked(true);
      setText('');
      // Enviada: la burbuja se repliega — la conversación ya vive en su
      // ventana, y dejar la barra abierta encima solo tapa.
      setOpened(false);
    }
  };
  const submit = () => {
    const trimmed = text.trim();
    if (trimmed) fire(trimmed);
  };

  // Las ideas viven mientras el ratón esté sobre el CONJUNTO (barra + chips)
  // o el input tenga el foco — así se puede bajar a tocar una sin que se
  // pliegue por el camino. En burbuja, ese mismo estado ES el despliegue
  // entero: burbuja ↔ barra (con texto escrito no se pliega jamás).
  const engaged = hovered || opened || focused || text.trim().length > 0;
  const expanded = variant === 'bar' || engaged;
  const ideasOpen = suggestions.length > 0 && (chipsAlways || hovered || focused);

  const chips = ideasOpen && (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="overflow-hidden"
    >
      <div className={`flex flex-wrap gap-1.5 px-1 ${variant === 'bubble' ? 'pb-2' : 'pt-2'}`}>
        <span className="self-center text-[10.5px] text-ink/30">{t('Try:')}</span>
        {suggestions.map((q, i) => (
          <motion.button
            key={q}
            type="button"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06 + i * 0.05, duration: 0.2 }}
            onClick={() => fire(q)}
            className="rounded-full border border-ink/10 bg-surface-1 px-2.5 py-1 text-[11px] text-ink/55 shadow-lg transition-all duration-200 hover:-translate-y-px hover:border-volt/30 hover:bg-volt/[0.06] hover:text-ink"
          >
            {q}
          </motion.button>
        ))}
      </div>
    </motion.div>
  );

  const bar = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className={`group/agent flex items-center gap-2.5 rounded-2xl border border-ink/10 bg-surface-1 px-3.5 py-2.5 transition-all duration-300 focus-within:border-volt/45 focus-within:shadow-[0_10px_32px_-14px_hsl(var(--volt)/0.4)] hover:border-volt/30 hover:shadow-[0_10px_32px_-14px_hsl(var(--volt)/0.3)] ${
        variant === 'bubble' ? 'w-[min(34rem,calc(100vw-6rem))] shadow-2xl' : ''
      }`}
    >
      {/* La chispa despierta con el ratón — gira y se enciende. */}
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-volt/15 text-volt transition-all duration-300 group-hover/agent:bg-volt/25 group-hover/agent:rotate-12 group-hover/agent:scale-110">
        <Sparkles className="h-4 w-4" />
      </span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          // Salir del campo vacío devuelve la burbuja a su sitio.
          if (!text.trim()) setOpened(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setText('');
            setOpened(false);
            e.currentTarget.blur();
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        // Solo con apertura DELIBERADA (ver `opened`): jamás al pasar el ratón.
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={variant === 'bubble' && opened}
        className="min-w-0 flex-1 bg-transparent text-[13px] text-ink caret-ink placeholder:text-ink/35 focus:outline-none"
      />
      {/* La regla se muda al interrogante (fundador 2026-09-07: «reduce el
          texto… un simbolito de interrogación en cada botón, incluido el
          agente»): la barra queda limpia y la explicación entera — qué hace
          el agente y qué NO hace jamás — sale al pasar el ratón. */}
      <HelpDot
        text={t('Describe what you want in your own words and the agent compiles it into a strategy for you to review. You always sign — it never signs or moves funds on its own.')}
        className="hidden shrink-0 md:inline-block"
      />
      {trailing}
      <button
        type="submit"
        disabled={!text.trim()}
        aria-label={t('Send to the agent')}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-volt text-volt-ink transition-opacity disabled:opacity-25"
      >
        <ArrowUp className="h-4 w-4" />
      </button>
    </form>
  );

  if (variant === 'bubble') {
    return (
      <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
        <AnimatePresence initial={false} mode="popLayout">
          {expanded ? (
            <motion.div
              key="bar"
              initial={{ opacity: 0, scale: 0.92, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 6 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              style={{ transformOrigin: 'bottom left' }}
            >
              {/* En el fondo del viewport las ideas van ENCIMA de la barra. */}
              <AnimatePresence initial={false}>{chips}</AnimatePresence>
              {bar}
            </motion.div>
          ) : (
            <motion.button
              key="bubble"
              type="button"
              aria-label={placeholder}
              title={placeholder}
              // Clic/toque y Tab son intención declarada: ahí SÍ se enfoca el
              // campo. El hover solo despliega, sin tocar el teclado.
              onClick={() => setOpened(true)}
              onFocus={() => setOpened(true)}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.18 }}
              className="grid h-11 w-11 place-items-center rounded-full border border-volt/30 bg-surface-1 text-volt shadow-[0_10px_30px_-10px_hsl(var(--volt)/0.45)] transition-all duration-300 hover:scale-110 hover:border-volt/50 hover:bg-volt/10"
            >
              <Sparkles className="h-5 w-5" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {bar}
      {/* Las ideas de prompt — bajo la barra, escalonadas. */}
      <AnimatePresence initial={false}>{chips}</AnimatePresence>
    </div>
  );
}

export default AgentBar;
