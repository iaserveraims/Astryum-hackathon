'use client';

/**
 * ChatMarkdown — el Markdown del agente, renderizado de verdad. Un renderizador propio y determinista, sin
 * dependencias: líneas → bloques (tabla, lista, encabezado, regla, párrafo),
 * y dentro de cada uno, negritas y código inline. Nada de HTML del modelo:
 * todo se construye como nodos React — jamás dangerouslySetInnerHTML.
 *
 * Se renderiza EN VIVO sobre el texto parcial del stream: la propia llegada
 * de tokens hace de máquina de escribir, y un `**` a medio cerrar se ve
 * literal medio segundo — el precio honesto de formatear al vuelo.
 */

import { Fragment, memo } from 'react';

/** Negritas y código inline, sobre una línea ya limpia. */
function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // **bold** · `code` — un solo barrido, en orden de aparición.
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(<Fragment key={`${keyBase}-t${i++}`}>{text.slice(last, m.index)}</Fragment>);
    if (m[2] !== undefined) {
      out.push(
        <strong key={`${keyBase}-b${i++}`} className="font-semibold text-ink">
          {m[2]}
        </strong>,
      );
    } else if (m[3] !== undefined) {
      out.push(
        <code key={`${keyBase}-c${i++}`} className="rounded bg-ink/10 px-1 py-px font-mono text-[0.92em]">
          {m[3]}
        </code>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(<Fragment key={`${keyBase}-t${i++}`}>{text.slice(last)}</Fragment>);
  return out;
}

function isTableLine(l: string): boolean {
  const t = l.trim();
  return t.startsWith('|') && t.endsWith('|') && t.length > 2;
}
function isSeparatorRow(l: string): boolean {
  return /^\|?\s*:?-{2,}.*\|/.test(l.trim()) && /^[\s|:\-]+$/.test(l.trim());
}
function splitRow(l: string): string[] {
  return l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

function ChatMarkdownInner({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // regla horizontal
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push(<hr key={k++} className="my-2 border-ink/10" />);
      i++;
      continue;
    }

    // encabezados — el nivel 1 se degrada: dentro de una burbuja no hay sitio
    // para titulares de página.
    const h = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (h) {
      blocks.push(
        <p key={k++} className="mt-2 mb-1 text-[13px] font-semibold text-ink first:mt-0">
          {inline(h[2].replace(/\*\*/g, ''), `h${k}`)}
        </p>,
      );
      i++;
      continue;
    }

    // tabla: filas consecutivas que empiezan y acaban en |
    if (isTableLine(trimmed)) {
      const rows: string[][] = [];
      let sawSeparator = false;
      while (i < lines.length && isTableLine(lines[i].trim())) {
        if (isSeparatorRow(lines[i])) sawSeparator = true;
        else rows.push(splitRow(lines[i]));
        i++;
      }
      if (rows.length > 0) {
        const [head, ...body] = sawSeparator && rows.length > 1 ? rows : [null as string[] | null, ...rows];
        blocks.push(
          <div key={k++} className="my-2 overflow-x-auto rounded-lg border border-ink/10">
            <table className="w-full border-collapse text-[12px]">
              {head && (
                <thead>
                  <tr className="border-b border-ink/10 bg-ink/[0.04]">
                    {head.map((c, ci) => (
                      <th key={ci} className="px-2.5 py-1.5 text-left font-semibold text-ink whitespace-nowrap">
                        {inline(c.replace(/\*\*/g, ''), `th${k}-${ci}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {body.filter((r): r is string[] => !!r).map((r, ri) => (
                  <tr key={ri} className="border-b border-ink/5 last:border-0">
                    {r.map((c, ci) => (
                      <td key={ci} className="px-2.5 py-1.5 tabular-nums text-ink/80 whitespace-nowrap">
                        {inline(c, `td${k}-${ri}-${ci}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
      }
      continue;
    }

    // lista con guiones
    if (/^[-•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-•]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={k++} className="my-1 space-y-0.5 pl-1">
          {items.map((it, ii) => (
            <li key={ii} className="flex gap-1.5">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink/35" aria-hidden />
              <span>{inline(it, `li${k}-${ii}`)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // párrafo (las líneas vacías separan; una sola línea = un párrafo)
    if (trimmed.length === 0) {
      i++;
      continue;
    }
    blocks.push(
      <p key={k++} className="my-0.5">
        {inline(line, `p${k}`)}
      </p>,
    );
    i++;
  }

  return <div className="space-y-0.5">{blocks}</div>;
}

/** Memoizado: un mensaje terminado no se re-parsea con cada estado del chat. */
export const ChatMarkdown = memo(ChatMarkdownInner);

export default ChatMarkdown;
