'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, X, Send, Loader2, ChevronRight } from 'lucide-react';
import { getApiBase } from '../../lib/env';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

const API_BASE = getApiBase();

function authHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function AIChatSidebar() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{
        role: 'assistant',
        content: 'Hello! I can help you understand your DeFi portfolio, positions, and trigger rules. Ask me anything about your capital data.',
        timestamp: new Date().toISOString(),
      }]);
    }
  }, [open, messages.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { role: 'user', content: text, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ message: text }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: typeof data.response === 'string' ? data.response : JSON.stringify(data.response),
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Unable to reach the AI assistant. Please check your connection.',
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <>
      {/* Floating trigger button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-2xl bg-volt text-volt-ink font-semibold shadow-[0_8px_28px_hsl(var(--volt)/0.25)] hover:scale-105 transition-all duration-200 text-sm"
          aria-label="Open AI assistant"
        >
          <Bot className="w-4 h-4" />
          <span className="hidden sm:inline">AI Copilot</span>
          <ChevronRight className="w-3 h-3" />
        </button>
      )}

      {/* Sidebar panel */}
      {open && (
        <div className="fixed bottom-0 right-0 z-50 flex flex-col w-full sm:w-96 h-[600px] sm:h-[70vh] sm:bottom-6 sm:right-6 sm:rounded-2xl bg-zinc-950 border border-ink/10 shadow-2xl shadow-black/60 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-ink/10 bg-black/40">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-volt flex items-center justify-center">
                <Bot className="w-4 h-4 text-volt-ink" />
              </div>
              <span className="text-sm font-semibold text-ink">AI Copilot</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-ink/5 text-ink/40">Context-aware</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-ink/40 hover:text-ink transition-colors"
              aria-label="Close AI assistant"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Disclaimer */}
          <div className="px-4 py-2 bg-amber-950/30 border-b border-amber-500/10">
            <p className="text-xs text-amber-400/70">
              Portfolio data assistant only — no investment advice.
            </p>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-volt text-volt-ink rounded-br-sm'
                      : 'bg-ink/5 text-ink/90 rounded-bl-sm'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-ink/5 px-3 py-2 rounded-2xl rounded-bl-sm">
                  <Loader2 className="w-4 h-4 text-ink/40 animate-spin" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-4 py-3 border-t border-ink/10 bg-black/20">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKey}
                placeholder="Ask about your portfolio..."
                rows={1}
                className="flex-1 resize-none bg-ink/5 border border-ink/10 rounded-xl px-3 py-2 text-sm text-ink placeholder-ink/30 focus:outline-none focus:border-volt/50 transition-colors min-h-[40px] max-h-[120px]"
                style={{ fieldSizing: 'content' } as React.CSSProperties}
              />
              <button
                onClick={send}
                disabled={!input.trim() || loading}
                className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl bg-volt text-volt-ink disabled:opacity-30 hover:brightness-95 transition-all"
                aria-label="Send"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            <p className="mt-1.5 text-xs text-ink/20 text-center">Enter to send · Shift+Enter for newline</p>
          </div>
        </div>
      )}
    </>
  );
}
