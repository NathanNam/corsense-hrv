import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRR } from '../lib/import-rr.ts';

const beats = Array.from({ length: 40 }, (_, i) => 800 + (i % 5) * 20);

test('one interval per line in ms (Elite HRV raw export)', () => {
  assert.deepEqual(parseRR(beats.join('\n')).rr, beats);
});

test('seconds are converted to ms', () => {
  assert.equal(parseRR(beats.map((b) => b / 1000).join('\n')).rr[0], 800);
});

test('a CSV with an RR column', () => {
  const csv = 'time,rr_ms,quality\n' + beats.map((b, i) => `${i},${b},1`).join('\n');
  assert.deepEqual(parseRR(csv).rr, beats);
});

test('impossible values are dropped and counted', () => {
  const r = parseRR([...beats, 5000, 100].join('\n'));
  assert.equal(r.rr.length, 40);
  assert.equal(r.dropped, 2);
});

test('too few numbers is an error', () => {
  assert.throws(() => parseRR('800\n810\n'), /fewer than 30/);
});
