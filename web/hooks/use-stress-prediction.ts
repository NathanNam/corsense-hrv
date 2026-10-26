'use client';

import { useMemo } from 'react';
import { extractFeatures } from '../lib/hrv-features';
import { predictStress, MODEL_CONFIG, type StressPrediction } from '../lib/stress-predictor';
import { quality } from '../lib/rr-clean';
import type { Beat } from './use-heart-rate';

export interface StressPoint {
  time: number;
  probability: number;
}

export interface StressState {
  prediction: StressPrediction | null;
  /** Clean beats in the current 30-second window. */
  windowCount: number;
  ready: boolean;
  /** True when too many recent beats were glitches to trust a verdict. */
  paused: boolean;
  history: StressPoint[];
}

const STEP_MS = 5000;
/** Below this share of clean beats in the window, no verdict is given. */
export const MIN_QUALITY = 0.8;

/**
 * Stress probability every 5 seconds of session time, from the clean beats in
 * the 30 seconds before. Session time (not wall time) means a recorded session
 * gets the same history as a live one.
 */
export function useStressPrediction(beats: Beat[]): StressState {
  return useMemo(() => {
    const empty: StressState = { prediction: null, windowCount: 0, ready: false, paused: false, history: [] };
    if (!beats.length) return empty;
    const windowMs = MODEL_CONFIG.windowSizeSec * 1000;
    const history: StressPoint[] = [];
    let last: { prediction: StressPrediction | null; count: number; paused: boolean } = { prediction: null, count: 0, paused: false };
    const start = beats[0].time, end = beats[beats.length - 1].time;
    let lo = 0;
    for (let t = start + windowMs; t <= end; t += STEP_MS) {
      while (lo < beats.length && beats[lo].time < t - windowMs) lo++;
      let hi = lo;
      while (hi < beats.length && beats[hi].time <= t) hi++;
      const win = beats.slice(lo, hi);
      const clean = win.filter((b) => !b.glitch).map((b) => b.rr);
      const paused = quality(win.map((b) => !b.glitch), win.length) < MIN_QUALITY;
      const features = paused ? null : extractFeatures(clean, MODEL_CONFIG.windowSizeSec, MODEL_CONFIG.minRrInWindow);
      const prediction = features ? predictStress(features) : null;
      if (prediction) history.push({ time: t, probability: Math.round(prediction.probability * 1000) / 1000 });
      last = { prediction, count: clean.length, paused };
    }
    return { prediction: last.prediction, windowCount: last.count, ready: !!last.prediction, paused: last.paused, history };
  }, [beats]);
}
