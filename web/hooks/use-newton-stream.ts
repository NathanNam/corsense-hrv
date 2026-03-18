'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export interface NewtonStreamResult {
  label: string;
  confidence: number;
  scores: Record<string, number>;
  windows: number;
  timestamp: number;
}

interface UseNewtonStreamOptions {
  available: boolean;
  connected: boolean;
}

export function useNewtonStream({ available, connected }: UseNewtonStreamOptions) {
  const [latestResult, setLatestResult] = useState<NewtonStreamResult | null>(null);
  const [streamConnected, setStreamConnected] = useState(false);
  const pendingRRRef = useRef<number[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Queue RR intervals for batched sending
  const sendRR = useCallback((rrIntervals: number[]) => {
    pendingRRRef.current.push(...rrIntervals);
  }, []);

  // Flush pending RR intervals to the server
  const flushRR = useCallback(async () => {
    if (pendingRRRef.current.length === 0) return;
    const batch = pendingRRRef.current;
    pendingRRRef.current = [];

    try {
      await fetch('/api/newton/stream/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rrIntervals: batch }),
      });
    } catch {
      // Silently fail — data loss is acceptable for streaming
    }
  }, []);

  useEffect(() => {
    if (!available || !connected) {
      if (flushTimerRef.current) {
        clearInterval(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setStreamConnected(false);
      setLatestResult(null);
      return;
    }

    // Start the stream on the server
    fetch('/api/newton/stream/start', { method: 'POST' }).catch(() => {});

    // Open SSE connection for results
    const es = new EventSource('/api/newton/stream');
    eventSourceRef.current = es;

    es.onopen = () => setStreamConnected(true);
    es.onmessage = (event) => {
      try {
        const result: NewtonStreamResult = JSON.parse(event.data);
        setLatestResult(result);
      } catch {
        // ignore parse errors
      }
    };
    es.onerror = () => {
      // EventSource auto-reconnects; just mark disconnected briefly
      setStreamConnected(false);
    };

    // Flush RR intervals every 5 seconds
    flushTimerRef.current = setInterval(flushRR, 5000);

    return () => {
      if (flushTimerRef.current) {
        clearInterval(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setStreamConnected(false);
      fetch('/api/newton/stream/stop', { method: 'POST' }).catch(() => {});
    };
  }, [available, connected, flushRR]);

  return { latestResult, streamConnected, sendRR };
}
