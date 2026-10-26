'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export interface ChatMessage {
  role: 'user' | 'newton';
  text: string;
}

export interface NewtonReading {
  label: 'relaxed' | 'stressed';
  stressedShare: number;
  k: number;
  librarySize: number;
  at: number;
}

const WINDOW = 64;
const EVERY_MS = 10_000;

/**
 * Newton, with either the server's key or the visitor's own. The visitor's key
 * is kept only in this tab's memory (React state): never in storage, never in
 * a URL. A reload forgets it.
 */
/**
 * `mode`: 'live' reads every 10 s while beats arrive; 'once' reads the last
 * window of a finished recording one time; 'off' doesn't read.
 */
export function useNewton(rr: number[], mode: 'live' | 'once' | 'off', sessionId: number) {
  const [serverKey, setServerKey] = useState(false);
  const [ownKey, setOwnKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reading, setReading] = useState<NewtonReading | null>(null);
  const [readingError, setReadingError] = useState<string | null>(null);
  const rrRef = useRef(rr);
  rrRef.current = rr;

  useEffect(() => {
    fetch('/api/newton/status').then((r) => r.json()).then((d) => setServerKey(!!d.serverKey)).catch(() => setServerKey(false));
  }, []);

  const available = serverKey || !!ownKey;
  const headers = useCallback((): HeadersInit => ({ 'Content-Type': 'application/json', ...(ownKey ? { 'x-atai-key': ownKey } : {}) }), [ownKey]);

  const post = useCallback(async (path: string, body: unknown) => {
    const res = await fetch(path, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Newton ${res.status}`), { status: res.status });
    return data;
  }, [headers]);

  const ask = useCallback(async (question: string, summary: string, images: string[]) => {
    setMessages((m) => [...m, { role: 'user', text: question }]);
    setLoading(true);
    try {
      const { answer } = await post('/api/newton/ask', { question, summary, images });
      setMessages((m) => [...m, { role: 'newton', text: answer }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'newton', text: `Sorry, that didn't work: ${(e as Error).message}` }]);
    } finally {
      setLoading(false);
    }
  }, [post]);

  // Newton's own reading, every 10 seconds while beats are coming in; a new
  // session (or the demo jumping ahead) starts over straight away.
  useEffect(() => {
    setReading(null);
    if (!available || mode === 'off') return;
    let stopped = false;
    const run = async () => {
      const rr = rrRef.current;
      if (rr.length < WINDOW) return;
      try {
        const v = await post('/api/newton/classify', { rr: rr.slice(-WINDOW) });
        if (!stopped) { setReading({ ...v, at: Date.now() }); setReadingError(null); }
      } catch (e) {
        if (!stopped) setReadingError((e as Error).message);
        if ((e as { status?: number }).status === 401) setOwnKey(null);
      }
    };
    const first = setTimeout(run, 300);
    const id = mode === 'live' ? setInterval(run, EVERY_MS) : undefined;
    return () => { stopped = true; clearTimeout(first); if (id) clearInterval(id); };
  }, [available, mode, post, sessionId]);

  /** Beats collected toward Newton's first window, for a progress hint. */
  const beatsToFirst = Math.min(rr.length, WINDOW);
  return { serverKey, ownKey, setOwnKey, available, loading, messages, ask, reading, readingError, beatsToFirst, windowSize: WINDOW };
}
