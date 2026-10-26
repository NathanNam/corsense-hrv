import test from 'node:test';
import assert from 'node:assert/strict';
import { read } from '../lib/baseline.ts';

const series = (from: number, to: number, f: (t: number) => number) => { const out = []; for (let t = from; t <= to; t += 5000) out.push({ time: t, value: f(t) }); return out; };

test('learns a baseline for two minutes first', () => {
  const r = read(series(0, 60_000, () => 80), series(0, 60_000, () => 65));
  assert.equal(r.mood, 'learning');
  assert.ok(r.remaining > 50_000);
});

test('much lower HRV than your own baseline reads as more stressed', () => {
  const rm = [...series(0, 120_000, () => 110), ...series(125_000, 300_000, () => 35)];
  const hr = [...series(0, 120_000, () => 64), ...series(125_000, 300_000, () => 78)];
  const r = read(rm, hr);
  assert.equal(r.mood, 'stressed');
  assert.ok(r.ratio! < 0.4);
});

test('the same 35 ms is steady for someone whose baseline is 35 ms', () => {
  const r = read(series(0, 300_000, () => 35), series(0, 300_000, () => 72));
  assert.equal(r.mood, 'steady');
});

test('higher HRV and a lower heart rate read as calmer', () => {
  const rm = [...series(0, 120_000, () => 40), ...series(125_000, 300_000, () => 60)];
  const hr = [...series(0, 120_000, () => 75), ...series(125_000, 300_000, () => 70)];
  assert.equal(read(rm, hr).mood, 'calmer');
});

test('retaking the baseline starts a new two-minute baseline from that moment', () => {
  // Tense start (35 ms), then calmer (70 ms) after a retake at 3 minutes.
  const rm = [...series(0, 180_000, () => 35), ...series(185_000, 500_000, () => 70)];
  const hr = [...series(0, 180_000, () => 80), ...series(185_000, 500_000, () => 66)];
  assert.equal(read(rm, hr).mood, 'calmer');
  const retaken = read(rm, hr, 180_000);
  assert.equal(retaken.mood, 'steady');
  assert.equal(Math.round(retaken.baseline!.rmssd), 70);
  assert.equal(read(rm.filter((p) => p.time <= 240_000), hr.filter((p) => p.time <= 240_000), 180_000).mood, 'learning');
});
