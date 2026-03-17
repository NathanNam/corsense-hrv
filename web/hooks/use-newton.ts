'use client';

import { useState, useEffect, useCallback } from 'react';

export interface ChatMessage {
  role: 'user' | 'newton';
  text: string;
}

export function useNewton() {
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    fetch('/api/newton/status')
      .then((res) => res.json())
      .then((data) => setAvailable(data.available))
      .catch(() => setAvailable(false));
  }, []);

  const askNewton = useCallback(
    async (question: string, rrIntervals: number[], hrvMetrics?: Record<string, unknown>) => {
      setMessages((prev) => [...prev, { role: 'user', text: question }]);
      setLoading(true);
      setError(null);

      try {
        const res = await fetch('/api/newton/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question, rrIntervals, hrvMetrics }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Request failed');
        }

        setMessages((prev) => [...prev, { role: 'newton', text: data.response }]);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Something went wrong';
        setError(message);
        setMessages((prev) => [...prev, { role: 'newton', text: `Error: ${message}` }]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { available, loading, error, messages, askNewton };
}
