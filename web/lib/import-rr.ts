/**
 * Reads a recording of beat-to-beat (RR) intervals from a file, so a session
 * recorded elsewhere (Elite HRV's raw export, a Polar or Kubios export, a CSV)
 * can be replayed through the same cleaning, baseline and models.
 *
 * Accepts: one number per line, or comma/semicolon/tab-separated numbers, or a
 * CSV with a header naming an RR / IBI / interval column. Values in seconds
 * (all under 3) are converted to milliseconds.
 */
export interface Recording {
  rr: number[];
  /** How many values were outside 250–2500 ms and dropped before cleaning. */
  dropped: number;
}

export function parseRR(text: string): Recording {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) throw new Error('The file is empty.');
  const split = (l: string) => l.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ''));

  let values: number[];
  const header = split(lines[0]);
  const named = header.findIndex((h) => /^(rr|ibi|rr[_ ]?(interval|ms)s?|interval|nn)/i.test(h));
  if (named >= 0 && header.some((h) => Number.isNaN(Number(h)))) {
    values = lines.slice(1).map((l) => Number(split(l)[named]));
  } else if (header.length > 1 && lines.length > 1 && lines.every((l) => split(l).length === header.length)) {
    // A table without a recognisable header: take the last numeric column.
    const rows = lines.map(split).filter((r) => r.every((c) => c !== '' && !Number.isNaN(Number(c))));
    values = rows.map((r) => Number(r[r.length - 1]));
  } else {
    values = lines.flatMap(split).map(Number);
  }
  values = values.filter((v) => Number.isFinite(v) && v > 0);
  if (values.length < 30) throw new Error('Found fewer than 30 beat intervals. Is this an RR / IBI export?');
  const median = [...values].sort((a, b) => a - b)[values.length >> 1];
  const ms = median < 3 ? values.map((v) => v * 1000) : values;
  const rr = ms.filter((v) => v >= 250 && v <= 2500).map((v) => Math.round(v * 10) / 10);
  return { rr, dropped: ms.length - rr.length };
}
