/**
 * The verdict compares you with yourself. HRV differs hugely between people
 * (a relaxed 25-year-old might sit at 100 ms, a relaxed 60-year-old at 25), so
 * a fixed cut-off misreads most people. The first two minutes of clean beats set
 * a personal baseline; after that, HRV and heart rate are read against it.
 */
import { median } from './rr-clean.ts';

export const BASELINE_MS = 120_000;
export const RECENT_MS = 30_000;

export interface Point { time: number; value: number }

export interface Baseline { rmssd: number; hr: number }

export type Mood = 'learning' | 'calmer' | 'steady' | 'stressed';

export interface Reading {
  mood: Mood;
  baseline: Baseline | null;
  rmssd: number | null;   // last 30 s
  hr: number | null;      // last 30 s
  ratio: number | null;   // rmssd / baseline rmssd
  hrDelta: number | null; // hr - baseline hr
  /** ms of baseline still to collect, while learning */
  remaining: number;
}

/** Baseline from the first two minutes (needs at least 90 s of HRV readings). */
export function baselineOf(rmssd: Point[], hr: Point[], start: number): Baseline | null {
  const end = start + BASELINE_MS;
  const r = rmssd.filter((p) => p.time >= start + RECENT_MS && p.time <= end).map((p) => p.value);
  const h = hr.filter((p) => p.time >= start && p.time <= end).map((p) => p.value);
  if (!r.length || !h.length || (rmssd.at(-1)?.time ?? 0) < end) return null;
  return { rmssd: median(r), hr: median(h) };
}

export function read(rmssd: Point[], hr: Point[]): Reading {
  if (!hr.length) return { mood: 'learning', baseline: null, rmssd: null, hr: null, ratio: null, hrDelta: null, remaining: BASELINE_MS };
  const start = hr[0].time, now = hr[hr.length - 1].time;
  const recentR = rmssd.filter((p) => p.time > now - RECENT_MS).map((p) => p.value);
  const recentH = hr.filter((p) => p.time > now - RECENT_MS).map((p) => p.value);
  const cur = { rmssd: recentR.length ? median(recentR) : null, hr: recentH.length ? median(recentH) : null };
  const baseline = baselineOf(rmssd, hr, start);
  if (!baseline || cur.rmssd === null || cur.hr === null) {
    return { mood: 'learning', baseline, rmssd: cur.rmssd, hr: cur.hr, ratio: null, hrDelta: null, remaining: Math.max(0, start + BASELINE_MS - now) };
  }
  const ratio = cur.rmssd / baseline.rmssd;
  const hrDelta = cur.hr - baseline.hr;
  // Stress lowers HRV and usually raises heart rate; calm does the opposite.
  let mood: Mood = 'steady';
  if (ratio <= 0.7 || (ratio <= 0.85 && hrDelta >= 8)) mood = 'stressed';
  else if (ratio >= 1.25 && hrDelta <= 3) mood = 'calmer';
  return { mood, baseline, rmssd: cur.rmssd, hr: cur.hr, ratio, hrDelta, remaining: 0 };
}
