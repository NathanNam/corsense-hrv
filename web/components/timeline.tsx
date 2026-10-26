'use client';

import { forwardRef } from 'react';
import type { Beat, RMSSDPoint } from '../hooks/use-heart-rate';
import type { StressPoint } from '../hooks/use-stress-prediction';

// Colours are inline (not CSS variables) so the SVG renders the same when it's
// turned into a PNG for Newton.
const C = { hr: '#c23a2b', rr: '#2a1613', rmssd: '#2f7d5b', stress: '#c9821f', glitch: '#b9a19a', grid: '#e9c7bf', mute: '#8b6a63', ink: '#2a1613' };
const W = 1120, LEFT = 150, RIGHT = 12, TOP = 8, LANE = 92, GAP = 10;
const SPAN_MS = 10 * 60_000;
const FONT = 'IBM Plex Mono, ui-monospace, monospace';

const fmt = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

interface Props {
  beats: Beat[];
  rmssd: RMSSDPoint[];
  stress: StressPoint[];
  threshold: number;
}

/** Heart rate, RR intervals, HRV and stress on one time axis: the last 10 minutes. */
export const Timeline = forwardRef<SVGSVGElement, Props>(function Timeline({ beats, rmssd, stress, threshold }, ref) {
  const end = beats.length ? beats[beats.length - 1].time : 0;
  const start = Math.max(0, end - SPAN_MS);
  const span = Math.max(60_000, end - start);
  const x = (t: number) => LEFT + ((t - start) / span) * (W - LEFT - RIGHT);
  const H = TOP + 4 * (LANE + GAP) + 18;
  const lane = (i: number) => TOP + i * (LANE + GAP);
  const y = (i: number, v: number, lo: number, hi: number) => lane(i) + LANE - 6 - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (LANE - 12);
  const line = (pts: [number, number][], i: number, lo: number, hi: number) => pts.filter(([t]) => t >= start).map(([t, v], k) => `${k ? 'L' : 'M'}${x(t).toFixed(1)} ${y(i, v, lo, hi).toFixed(1)}`).join('');

  const clean = beats.filter((b) => !b.glitch && b.time >= start);
  const range = (vals: number[], pad: number, floor: number, ceil: number): [number, number] => {
    if (!vals.length) return [floor, ceil];
    const lo = Math.min(...vals), hi = Math.max(...vals);
    return [Math.max(floor, Math.floor(lo - pad)), Math.min(ceil, Math.ceil(hi + pad))];
  };
  const [hrLo, hrHi] = range(clean.map((b) => b.hr), 5, 30, 220);
  const [rrLo, rrHi] = range(clean.map((b) => b.rr), 40, 300, 2000);
  const [hvLo, hvHi] = [0, Math.max(60, Math.ceil(Math.max(0, ...rmssd.map((p) => p.rmssd)) / 20) * 20)];
  const lanes: [string, string, number, number][] = [['HEART RATE', 'bpm', hrLo, hrHi], ['RR INTERVALS', 'ms', rrLo, rrHi], ['HRV · RMSSD', 'ms', hvLo, hvHi], ['STRESS', '%', 0, 100]];
  const stressPts = stress.filter((p) => p.time >= start).map((p) => [p.time, p.probability * 100] as [number, number]);
  const minuteTicks: number[] = [];
  for (let m = Math.ceil(start / 60_000); m * 60_000 <= start + span; m++) minuteTicks.push(m * 60_000);

  return (
    <svg ref={ref} className="tl" viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Heart rate, RR intervals, HRV and stress over the last 10 minutes">
      {lanes.map(([name, unit, lo, hi], i) => (
        <g key={name}>
          <rect x={LEFT} y={lane(i)} width={W - LEFT - RIGHT} height={LANE} fill="none" stroke={C.grid} />
          <text x={0} y={lane(i) + 14} fontFamily={FONT} fontSize={11} fontWeight={600} fill={C.ink} letterSpacing=".06em">{name}</text>
          <text x={0} y={lane(i) + 30} fontFamily={FONT} fontSize={11} fill={C.mute}>{unit}</text>
          <text x={LEFT - 6} y={lane(i) + 11} fontFamily={FONT} fontSize={10} fill={C.mute} textAnchor="end">{hi}</text>
          <text x={LEFT - 6} y={lane(i) + LANE - 3} fontFamily={FONT} fontSize={10} fill={C.mute} textAnchor="end">{lo}</text>
        </g>
      ))}
      {minuteTicks.map((t) => (
        <g key={t}>
          <path d={`M${x(t)} ${TOP}V${lane(4) - GAP}`} stroke={C.grid} strokeDasharray="2 4" />
          <text x={x(t)} y={lane(4) + 6} fontFamily={FONT} fontSize={11} fill={C.mute} textAnchor="middle">{fmt(t)}</text>
        </g>
      ))}
      <path d={line(clean.map((b) => [b.time, b.hr]), 0, hrLo, hrHi)} fill="none" stroke={C.hr} strokeWidth={1.8} strokeLinejoin="round" />
      <path d={line(clean.map((b) => [b.time, b.rr]), 1, rrLo, rrHi)} fill="none" stroke={C.rr} strokeWidth={1.4} strokeLinejoin="round" />
      {beats.filter((b) => b.glitch && b.time >= start).map((b) => (
        <path key={b.time} d={`M${x(b.time)} ${lane(1) + 6}V${lane(1) + LANE - 6}`} stroke={C.glitch} strokeWidth={2} strokeDasharray="3 3" />
      ))}
      <path d={line(rmssd.map((p) => [p.time, p.rmssd]), 2, hvLo, hvHi)} fill="none" stroke={C.rmssd} strokeWidth={2} />
      {stressPts.length > 1 && (
        <>
          <path d={`${line(stressPts, 3, 0, 100)}L${x(stressPts[stressPts.length - 1][0])} ${lane(3) + LANE}L${x(stressPts[0][0])} ${lane(3) + LANE}Z`} fill={C.stress} opacity={0.18} />
          <path d={line(stressPts, 3, 0, 100)} fill="none" stroke={C.stress} strokeWidth={2} />
        </>
      )}
      <path d={`M${LEFT} ${y(3, threshold * 100, 0, 100)}H${W - RIGHT}`} stroke={C.stress} strokeDasharray="5 4" opacity={0.7} />
    </svg>
  );
});

/** The timeline as a base64 PNG on ECG-paper pink, for Newton to look at. */
export async function timelinePng(svg: SVGSVGElement): Promise<string> {
  const vb = svg.viewBox.baseVal;
  const scale = 1.5;
  const xml = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = vb.width * scale; canvas.height = vb.height * scale;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#fff9f7';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png').split(',')[1];
}
