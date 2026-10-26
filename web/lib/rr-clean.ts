/**
 * Beat cleaning. Fingertip and chest sensors drop or double beats when the
 * finger moves or contact is poor; one bad beat can double RMSSD. Each new RR
 * interval is checked against physiology and against the beats just before it.
 */

export const RR_MIN_MS = 300;   // 200 bpm
export const RR_MAX_MS = 2000;  // 30 bpm
// A beat is a glitch when it's further from the recent median than this
// person's own beat-to-beat variation allows. Relaxed hearts can change 20-30%
// from one beat to the next, so a fixed 20% limit would throw away real beats.
// Like Kubios (Lipponen & Tarvainen 2019), the limit is 5.2 quartile
// deviations of recent successive differences, and never below 20%.
export const MIN_JUMP = 0.2;
const QD_FACTOR = 5.2;
const REFERENCE_BEATS = 9;
const DIFF_HISTORY = 90;
// A real change in heart rate (standing up, a sprint) looks like a run of
// "glitches" at a new level; after this many in a row, accept the new level.
const RESYNC_AFTER = 4;

export type BeatVerdict = { ok: true } | { ok: false; reason: 'impossible' | 'jump' };

export class BeatCleaner {
  private recent: number[] = [];
  private diffs: number[] = [];
  private rejectedRun: number[] = [];

  /** Allowed relative distance from the recent median. */
  private limit(med: number): number {
    if (this.diffs.length < 20) return Math.max(MIN_JUMP, 0.3);
    const d = [...this.diffs].sort((a, b) => a - b);
    const qd = (d[Math.floor(d.length * 0.75)] - d[Math.floor(d.length * 0.25)]) / 2;
    return Math.max(MIN_JUMP, (QD_FACTOR * qd) / med);
  }

  check(rr: number): BeatVerdict {
    if (!(rr >= RR_MIN_MS && rr <= RR_MAX_MS)) return { ok: false, reason: 'impossible' };
    if (this.recent.length >= 3) {
      const med = median(this.recent);
      if (Math.abs(rr - med) / med > this.limit(med)) {
        this.rejectedRun.push(rr);
        const runMed = median(this.rejectedRun);
        const steady = this.rejectedRun.length >= RESYNC_AFTER && this.rejectedRun.every((x) => Math.abs(x - runMed) / runMed <= MIN_JUMP);
        if (!steady) return { ok: false, reason: 'jump' };
        this.recent = [...this.rejectedRun];
        this.rejectedRun = [];
        return { ok: true };
      }
    }
    this.rejectedRun = [];
    const prev = this.recent[this.recent.length - 1];
    if (prev !== undefined) { this.diffs.push(rr - prev); if (this.diffs.length > DIFF_HISTORY) this.diffs.shift(); }
    this.recent.push(rr);
    if (this.recent.length > REFERENCE_BEATS) this.recent.shift();
    return { ok: true };
  }

  reset() {
    this.recent = [];
    this.diffs = [];
    this.rejectedRun = [];
  }
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Share of clean beats, 0..1, over the last `n` beats. */
export function quality(flags: boolean[], n = 120): number {
  const w = flags.slice(-n);
  return w.length ? w.filter(Boolean).length / w.length : 1;
}
