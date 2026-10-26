import test from 'node:test';
import assert from 'node:assert/strict';
import { BeatCleaner, quality } from '../lib/rr-clean.ts';

const feed = (rrs: number[]) => { const c = new BeatCleaner(); return rrs.map((r) => c.check(r).ok); };

test('drops impossible beats', () => {
  assert.deepEqual(feed([800, 250, 810, 2500, 790]), [true, false, true, false, true]);
});

test('drops a missed beat (double length) and an extra beat (half length)', () => {
  const ok = feed([800, 810, 790, 805, 1600, 800, 395, 810]);
  assert.deepEqual(ok, [true, true, true, true, false, true, false, true]);
});

test('follows a real change in heart rate after a few steady beats', () => {
  const ok = feed([800, 800, 800, 800, 600, 600, 600, 600, 600, 600]);
  assert.deepEqual(ok.slice(0, 4), [true, true, true, true]);
  assert.equal(ok.at(-1), true);
  assert.equal(ok.at(-2), true);
});

test('quality is the share of clean beats', () => {
  assert.equal(quality([true, true, false, true]), 0.75);
  assert.equal(quality([]), 1);
});
