/**
 * Newton's stress reading: embed a window of clean RR intervals with the Omega
 * encoder and vote among the nearest labelled windows (n-shot KNN), the pattern
 * in Archetype AI's atai-newton-omega-model skill.
 *
 * The library comes from the WESAD baseline and stress recordings bundled in
 * public/demo. Its embeddings are computed on first use and kept for the life
 * of the server instance. One per-channel scaler, fitted on the library pool,
 * is applied to every window (normalize_input stays false), so windows keep
 * their real RR levels relative to each other.
 */
import { embed } from './atai';
import session from '../public/demo/wesad-session.json';

export const WINDOW = 64;      // beats per window, about 45-60 seconds
const STEP = 16;
const K = 5;

type Labelled = { label: string; vec: number[] };

export function windows(rr: number[], size = WINDOW, step = STEP): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + size <= rr.length; i += step) out.push(rr.slice(i, i + size));
  return out;
}

const pool = (session.segments as { label: string; rr: number[] }[]).flatMap((s) => s.rr);
const MEAN = pool.reduce((a, b) => a + b, 0) / pool.length;
const STD = Math.sqrt(pool.reduce((a, b) => a + (b - MEAN) ** 2, 0) / pool.length);
export const scale = (w: number[]) => w.map((x) => (x - MEAN) / STD);

const l2 = (v: number[]) => { const n = Math.hypot(...v) || 1; return v.map((x) => x / n); };
const dist = (a: number[], b: number[]) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s); };

let library: Promise<Labelled[]> | null = null;

async function buildLibrary(key: string): Promise<Labelled[]> {
  const items = (session.segments as { label: string; rr: number[] }[]).flatMap((s) => windows(s.rr).map((w) => ({ label: s.label, w })));
  // Eight at a time, as the skill's reference scripts do.
  const out: Labelled[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = { label: items[i].label, vec: l2(await embed(key, scale(items[i].w))) };
    }
  }));
  return out;
}

export interface NewtonVerdict {
  label: 'relaxed' | 'stressed';
  /** Share of the K nearest library windows that were stressed. */
  stressedShare: number;
  k: number;
  librarySize: number;
}

export function vote(query: number[], lib: Labelled[], k = K): NewtonVerdict {
  const nearest = lib.map((l) => ({ ...l, d: dist(query, l.vec) })).sort((a, b) => a.d - b.d).slice(0, k);
  const stressedShare = nearest.filter((n) => n.label === 'stressed').length / nearest.length;
  return { label: stressedShare > 0.5 ? 'stressed' : 'relaxed', stressedShare, k: nearest.length, librarySize: lib.length };
}

export async function classify(key: string, rr: number[]): Promise<NewtonVerdict> {
  if (rr.length < WINDOW) throw new Error(`Need ${WINDOW} clean beats, have ${rr.length}.`);
  library ??= buildLibrary(key).catch((e) => { library = null; throw e; });
  const [lib, vec] = await Promise.all([library, embed(key, scale(rr.slice(-WINDOW)))]);
  return vote(l2(vec), lib);
}
