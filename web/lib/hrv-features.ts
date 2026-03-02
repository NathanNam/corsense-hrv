/**
 * HRV feature extraction matching the Python training pipeline exactly.
 * Computes 18 features from a window of RR intervals.
 */

// --- Lomb-Scargle Periodogram ---

function lombScargle(
  times: number[],
  values: number[],
  angularFreqs: number[]
): number[] {
  const n = times.length;
  const result = new Array(angularFreqs.length);

  for (let fi = 0; fi < angularFreqs.length; fi++) {
    const w = angularFreqs[fi];

    // Compute tau
    let sin2sum = 0, cos2sum = 0;
    for (let i = 0; i < n; i++) {
      sin2sum += Math.sin(2 * w * times[i]);
      cos2sum += Math.cos(2 * w * times[i]);
    }
    const tau = Math.atan2(sin2sum, cos2sum) / (2 * w);

    // Compute periodogram value
    let cosSum = 0, sinSum = 0, cos2 = 0, sin2 = 0;
    for (let i = 0; i < n; i++) {
      const phase = w * (times[i] - tau);
      const c = Math.cos(phase);
      const s = Math.sin(phase);
      cosSum += values[i] * c;
      sinSum += values[i] * s;
      cos2 += c * c;
      sin2 += s * s;
    }

    result[fi] = 0.5 * ((cosSum * cosSum) / cos2 + (sinSum * sinSum) / sin2);
  }

  return result;
}

function trapezoid(y: number[], x: number[]): number {
  let sum = 0;
  for (let i = 1; i < x.length; i++) {
    sum += 0.5 * (y[i] + y[i - 1]) * (x[i] - x[i - 1]);
  }
  return sum;
}

// --- Feature Computation ---

export interface HRVFeatures {
  mean_rr: number;
  sdnn: number;
  rmssd: number;
  pnn50: number;
  mean_hr: number;
  std_hr: number;
  range_rr: number;
  median_rr: number;
  cv_rr: number;
  sd1: number;
  sd2: number;
  sd1_sd2_ratio: number;
  lf_power: number;
  hf_power: number;
  lf_hf_ratio: number;
  total_power: number;
  rr_count: number;
  rr_coverage: number;
}

export const FEATURE_NAMES: (keyof HRVFeatures)[] = [
  'mean_rr', 'sdnn', 'rmssd', 'pnn50',
  'mean_hr', 'std_hr', 'range_rr', 'median_rr', 'cv_rr',
  'sd1', 'sd2', 'sd1_sd2_ratio',
  'lf_power', 'hf_power', 'lf_hf_ratio', 'total_power',
  'rr_count', 'rr_coverage',
];

function std(arr: number[], ddof: number = 1): number {
  if (arr.length <= ddof) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (arr.length - ddof);
  return Math.sqrt(variance);
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function computeTimeDomain(rrMs: number[]): Partial<HRVFeatures> {
  const diffs: number[] = [];
  for (let i = 1; i < rrMs.length; i++) {
    diffs.push(rrMs[i] - rrMs[i - 1]);
  }

  const meanRr = rrMs.reduce((a, b) => a + b, 0) / rrMs.length;
  const sdnn = std(rrMs, 1);
  const rmssd = diffs.length > 0
    ? Math.sqrt(diffs.reduce((sum, d) => sum + d * d, 0) / diffs.length)
    : 0;
  const pnn50 = diffs.length > 0
    ? (diffs.filter(d => Math.abs(d) > 50).length / diffs.length) * 100
    : 0;

  const hr = rrMs.map(rr => 60000 / rr);
  const meanHr = hr.reduce((a, b) => a + b, 0) / hr.length;
  const stdHr = std(hr, 1);

  return {
    mean_rr: meanRr,
    sdnn,
    rmssd,
    pnn50,
    mean_hr: meanHr,
    std_hr: stdHr,
    range_rr: Math.max(...rrMs) - Math.min(...rrMs),
    median_rr: median(rrMs),
    cv_rr: meanRr > 0 ? sdnn / meanRr : 0,
  };
}

function computePoincare(rrMs: number[]): Partial<HRVFeatures> {
  if (rrMs.length < 2) {
    return { sd1: 0, sd2: 0, sd1_sd2_ratio: 0 };
  }

  const diffs: number[] = [];
  const sums: number[] = [];
  for (let i = 0; i < rrMs.length - 1; i++) {
    diffs.push(rrMs[i + 1] - rrMs[i]);
    sums.push(rrMs[i] + rrMs[i + 1]);
  }

  const sd1 = std(diffs, 1) / Math.SQRT2;
  const sd2 = std(sums, 1) / Math.SQRT2;

  return {
    sd1,
    sd2,
    sd1_sd2_ratio: sd2 > 0 ? sd1 / sd2 : 0,
  };
}

function computeFrequency(timestampsSec: number[], rrMs: number[]): Partial<HRVFeatures> {
  if (rrMs.length < 4) {
    return { lf_power: 0, hf_power: 0, lf_hf_ratio: 0, total_power: 0 };
  }

  const meanRr = rrMs.reduce((a, b) => a + b, 0) / rrMs.length;
  const rrDetrended = rrMs.map(rr => rr - meanRr);

  // Frequency range 0.04 to 0.4 Hz in 0.001 steps
  const freqs: number[] = [];
  for (let f = 0.04; f < 0.4; f += 0.001) {
    freqs.push(f);
  }
  const angularFreqs = freqs.map(f => 2 * Math.PI * f);

  const pgram = lombScargle(timestampsSec, rrDetrended, angularFreqs);

  // LF: 0.04-0.15 Hz, HF: 0.15-0.4 Hz
  const lfIdx: number[] = [];
  const hfIdx: number[] = [];
  for (let i = 0; i < freqs.length; i++) {
    if (freqs[i] >= 0.04 && freqs[i] < 0.15) lfIdx.push(i);
    if (freqs[i] >= 0.15 && freqs[i] <= 0.4) hfIdx.push(i);
  }

  const lfPgram = lfIdx.map(i => pgram[i]);
  const lfFreqs = lfIdx.map(i => freqs[i]);
  const hfPgram = hfIdx.map(i => pgram[i]);
  const hfFreqs = hfIdx.map(i => freqs[i]);

  const lf = trapezoid(lfPgram, lfFreqs);
  const hf = trapezoid(hfPgram, hfFreqs);
  const total = trapezoid(pgram, freqs);

  return {
    lf_power: lf,
    hf_power: hf,
    lf_hf_ratio: hf > 0 ? lf / hf : 0,
    total_power: total,
  };
}

/**
 * Extract all 18 HRV features from a window of RR intervals.
 *
 * @param rrIntervalsMs - RR intervals in milliseconds
 * @param windowDurationSec - Window duration in seconds (for rr_coverage)
 * @returns Feature vector as array in FEATURE_NAMES order, or null if insufficient data
 */
export function extractFeatures(
  rrIntervalsMs: number[],
  windowDurationSec: number,
  minRrInWindow: number = 10
): number[] | null {
  if (rrIntervalsMs.length < minRrInWindow) {
    return null;
  }

  const rrSec = rrIntervalsMs.map(rr => rr / 1000);

  // Build cumulative timestamps (seconds from start)
  const timestamps: number[] = [0];
  for (let i = 1; i < rrSec.length; i++) {
    timestamps.push(timestamps[i - 1] + rrSec[i - 1]);
  }

  const timeDomain = computeTimeDomain(rrIntervalsMs);
  const poincare = computePoincare(rrIntervalsMs);
  const frequency = computeFrequency(timestamps, rrIntervalsMs);

  const features: HRVFeatures = {
    ...timeDomain,
    ...poincare,
    ...frequency,
    rr_count: rrIntervalsMs.length,
    rr_coverage: rrSec.reduce((a, b) => a + b, 0) / windowDurationSec,
  } as HRVFeatures;

  // Return as array in FEATURE_NAMES order
  return FEATURE_NAMES.map(name => features[name]);
}
