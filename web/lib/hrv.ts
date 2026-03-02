/**
 * Calculate RMSSD (Root Mean Square of Successive Differences)
 * from a list of RR intervals in milliseconds.
 */
export function calculateRMSSD(rrIntervals: number[]): number | null {
  if (rrIntervals.length < 2) return null;

  let sumSquaredDiffs = 0;
  for (let i = 0; i < rrIntervals.length - 1; i++) {
    const diff = rrIntervals[i + 1] - rrIntervals[i];
    sumSquaredDiffs += diff * diff;
  }

  return Math.sqrt(sumSquaredDiffs / (rrIntervals.length - 1));
}
