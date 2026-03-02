'use client';

import { useState, useEffect, useRef } from 'react';
import { extractFeatures } from '../lib/hrv-features';
import { predictStress, MODEL_CONFIG, type StressPrediction } from '../lib/stress-predictor';
import type { RRPoint } from './use-heart-rate';

export interface StressState {
  prediction: StressPrediction | null;
  /** Number of RR intervals in the current window */
  windowCount: number;
  /** Whether we have enough data to make a prediction */
  ready: boolean;
  /** History of stress probability over time */
  history: { time: number; timestamp: string; probability: number }[];
}

const MAX_HISTORY = 300;
const UPDATE_INTERVAL_MS = 5000; // predict every 5 seconds

export function useStressPrediction(rrHistory: RRPoint[]) {
  const [state, setState] = useState<StressState>({
    prediction: null,
    windowCount: 0,
    ready: false,
    history: [],
  });
  const lastPredictTimeRef = useRef<number>(0);

  useEffect(() => {
    if (rrHistory.length === 0) {
      setState({ prediction: null, windowCount: 0, ready: false, history: [] });
      return;
    }

    const now = Date.now();
    if (now - lastPredictTimeRef.current < UPDATE_INTERVAL_MS) {
      return;
    }

    // Get RR intervals from the last 30 seconds
    const latestTime = rrHistory[rrHistory.length - 1].time;
    const windowStartTime = latestTime - MODEL_CONFIG.windowSizeSec * 1000;
    const windowRRs = rrHistory
      .filter(p => p.time >= windowStartTime)
      .map(p => p.rr);

    const ready = windowRRs.length >= MODEL_CONFIG.minRrInWindow;

    if (!ready) {
      setState(prev => ({ ...prev, windowCount: windowRRs.length, ready: false }));
      return;
    }

    // Extract features and predict
    const features = extractFeatures(
      windowRRs,
      MODEL_CONFIG.windowSizeSec,
      MODEL_CONFIG.minRrInWindow
    );

    if (!features) {
      setState(prev => ({ ...prev, windowCount: windowRRs.length, ready: false }));
      return;
    }

    const prediction = predictStress(features);
    lastPredictTimeRef.current = now;

    const lastRR = rrHistory[rrHistory.length - 1];

    setState(prev => {
      const newHistory = [
        ...prev.history,
        {
          time: lastRR.time,
          timestamp: lastRR.timestamp,
          probability: Math.round(prediction.probability * 1000) / 1000,
        },
      ];

      return {
        prediction,
        windowCount: windowRRs.length,
        ready: true,
        history: newHistory.length > MAX_HISTORY
          ? newHistory.slice(-MAX_HISTORY)
          : newHistory,
      };
    });
  }, [rrHistory]);

  return state;
}
