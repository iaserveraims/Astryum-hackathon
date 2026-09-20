'use client';

/**
 * AgentHistory — el historial del agente, en UNA pieza para dos puertas.
 *
 * - AgentHistoryPanel: la lista en sí (nueva conversación, restaurar,
 *   borrar, la verdad del almacén al pie). La montan el chat abierto Y el
 *   botón del héroe — una lista, no dos que se parecen (lección de la casa:
 *   los duplicados divergen).
 * - AgentHistoryButton: el relojito autónomo del héroe de Earn — abre el
 *   panel sin chat de por medio; tocar una conversación abre el agente como
 *   operación (anclado, como siempre) ya restaurada a ese chat, vía el
 *   restoreId/restoreKey del operationStore.
 */

import { useEffect, useRef, useState } from 'react';
import { History, Plus, Trash2 } from 'lucide-react';
import { deleteChat, loadChats, type StoredChat } from '../../lib/agent/chatHistory';
import { useOperationStore } from '../../stores/operationStore';
import { useDockStore } from '../../stores/dockStore';
import { useT } from '../../i18n/LanguageProvider';

export function AgentHistoryPanel({
  onRestore,
  onNew,
}: {
  onRestore: (chat: StoredChat) => void;
  /** Sin onNew (el botón del héroe) la fila «Nueva conversación» no se pinta:
   *  fuera del chat, escribir en la barra YA es empezar. */
  onNew?: () => void;
}) {
  const { t, lang } = useT();
  const [chats, setChats] = useState<StoredChat[]>([]);
  useEffect(() => setChats(loadChats()), []);

  return (
    <div className="w-72 overflow-hidden rounded-xl border border-ink/10 bg-surface-1 shadow-xl">
      {onNew && (
        <button
          onClick={onNew}
          className="flex w-full items-center gap-1.5 border-b border-ink/5 px-3 py-2 text-left text-[12px] text-ink/75 transition-colors hover:bg-ink/[0.04] hover:text-ink"
        >
          <Plus className="h-3.5 w-3.5 text-volt" />
          {t('New conversation')}
        </button>
      )}
      <div className="max-h-64 overflow-y-auto scrollbar-thin">
        {chats.length === 0 ? (
          <p className="px-3 py-3 text-[11px] text-ink/40">{t('No saved conversations yet.')}</p>
        ) : (
          chats.map((c) => (
            <div key={c.id} className="group/chat flex items-center border-b border-ink/5 last:border-0">
              <button
                onClick={() => onRestore(c)}
                className="min-w-0 flex-1 px-3 py-2 text-left transition-colors hover:bg-ink/[0.04]"
              >
                <span className="block truncate text-[12px] text-ink/80">{c.title}</span>
                <span className="block text-[10px] text-ink/35">
                  {new Date(c.updatedAt).toLocaleDateString(lang === 'es' ? 'es' : 'en', {
                    day: 'numeric',
                    month: 'short',
                  })}{' '}
                  · {c.messages.length} {t('messages')}
                </span>
              </button>
              <button
                onClick={() => {
                  deleteChat(c.id);
                  setChats(loadChats());
                }}
                title={t('Delete')}
                className="px-2.5 py-2 text-ink/25 opacity-0 transition-all group-hover/chat:opacity-100 hover:text-tone-danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
      {/* La verdad del almacén, dicha donde se usa. */}
      <p className="border-t border-ink/5 px-3 py-1.5 text-[10px] leading-snug text-ink/35">
        {t('Only in this browser — conversations delete themselves after 30 days. Cards with live numbers are not restored; ask again for fresh figures.')}
      </p>
    </div>
  );
}

/** El relojito autónomo del héroe: historial SIN chat abierto. */
export function AgentHistoryButton() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const openAgentRestore = useOperationStore((st) => st.openAgentRestore);
  const setDocked = useDockStore((st) => st.setDocked);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        // type=button: vive DENTRO del form de la barra — sin esto, abrir el
        // historial enviaría la frase a medio escribir.
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={t('History')}
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors ${
          open ? 'bg-volt/10 text-volt' : 'text-ink/35 hover:bg-ink/5 hover:text-ink'
        }`}
      >
        <History className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2">
          <AgentHistoryPanel
            onRestore={(c) => {
              // La conversación se abre donde viven las conversaciones: el
              // agente como operación, anclado — restaurada a ese chat.
              if (openAgentRestore(c.id)) setDocked(true);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
