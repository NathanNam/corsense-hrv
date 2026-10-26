#!/usr/bin/env node
// Embeds Newton's 30 labelled example windows once and saves them, so the app
// doesn't have to embed them on the first reading after every server start.
//
//   node scripts/build-newton-library.mjs      (reads ATAI_API_KEY from .env.local)
//
// Rerun whenever public/demo/wesad-session.json, the window settings below, or
// the Omega model changes. Writes lib/newton-library.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(['.env.local', '../.env'].flatMap((f) => { try { return fs.readFileSync(path.join(root, f), 'utf8').split('\n'); } catch { return []; } })
  .filter((l) => /^ATAI_API_(KEY|ENDPOINT)=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]).reverse());
const KEY = process.env.ATAI_API_KEY || env.ATAI_API_KEY;
const ENDPOINT = 'https://platform.u1.archetypeai.app';
if (!KEY) { console.error('Set ATAI_API_KEY (or put it in web/.env.local).'); process.exit(1); }

const MODEL = 'OmegaEncoder::omega_embeddings_1_4', WINDOW = 64, STEP = 16, PERSON = 128;
const session = JSON.parse(fs.readFileSync(path.join(root, 'public/demo/wesad-session.json'), 'utf8'));
const pool = session.segments.flatMap((s) => s.rr);
const mean = pool.reduce((a, b) => a + b, 0) / pool.length;
const sd = Math.sqrt(pool.reduce((a, b) => a + (b - mean) ** 2, 0) / pool.length);

const items = [];
for (const s of session.segments) for (let p = 0; p * PERSON < s.rr.length; p++) {
  const rr = s.rr.slice(p * PERSON, (p + 1) * PERSON);
  for (let i = 0; i + WINDOW <= rr.length; i += STEP) items.push({ label: s.label, w: rr.slice(i, i + WINDOW) });
}

async function embed(w) {
  const res = await fetch(`${ENDPOINT}/api/lens/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '', model: MODEL, normalize_input: false, events: [{ type: 'data.numeric_array', event_data: { contents: [w.map((x) => (x - mean) / sd)] } }] }),
  });
  if (!res.ok) throw new Error(`Omega ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const v = (await res.json()).response.response;
  const n = Math.hypot(...v) || 1;
  return v.map((x) => Math.round((x / n) * 1e6) / 1e6);
}

let next = 0;
await Promise.all(Array.from({ length: 8 }, async () => { while (next < items.length) { const it = items[next++]; it.vec = await embed(it.w); } }));
fs.writeFileSync(path.join(root, 'lib/newton-library.json'), JSON.stringify({
  model: MODEL, window: WINDOW, step: STEP, person: PERSON, mean, sd,
  builtAt: new Date().toISOString().slice(0, 10),
  items: items.map(({ label, vec }) => ({ label, vec })),
}));
console.log(`wrote lib/newton-library.json: ${items.length} windows`);
