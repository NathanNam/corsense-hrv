#!/usr/bin/env node
// Favicon set + 1200×630 share image for Heartstrip.
//
//   npm i --no-save puppeteer-core@23.11.1
//   node scripts/brand.mjs
//
// Needs Google Chrome at CHROME_PATH (default: the macOS app path) and network
// access for Google Fonts. The poster's strip is drawn from the demo recording.
// Outputs (committed): public/icon.svg, favicon-32.png, favicon.ico,
// apple-touch-icon.png, icon-512.png, og.png

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// A red ECG tile: a heartbeat trace across the strip.
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="10" fill="#c23a2b"/>
  <path d="M5 36 H19 L25 17 L33 50 L39 28 L43 36 H59" fill="none" stroke="#fff9f7" stroke-width="5.2" stroke-linejoin="round" stroke-linecap="round"/>
</svg>`;

function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, buf }, i) => {
    const o = 6 + 16 * i;
    header.writeUInt8(size, o); header.writeUInt8(size, o + 1);
    header.writeUInt16LE(1, o + 4); header.writeUInt16LE(32, o + 6);
    header.writeUInt32LE(buf.length, o + 8); header.writeUInt32LE(offset, o + 12);
    offset += buf.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.buf)]);
}

// The strip on the poster: the demo's last relaxed minute and first stressed minutes.
const session = JSON.parse(fs.readFileSync(path.join(pub, 'demo/wesad-session.json'), 'utf8'));
const rr = [...session.segments[0].rr.slice(-70), ...session.segments[1].rr.slice(0, 90)];
const W = 500, LH = 90;
let t = 0; const ts = rr.map((r) => (t += r)); const T = t;
const lane = (vals, lo, hi, y0) => vals.map((v, i) => `${i ? 'L' : 'M'}${(ts[i] / T * W).toFixed(1)} ${(y0 + LH - ((v - lo) / (hi - lo)) * LH).toFixed(1)}`).join('');
const hr = rr.map((r) => 60000 / r);
// HRV over the previous 30 beats, never across the join between the two recordings.
const JOIN = 70;
const rmssdAt = (i) => { const from = i < JOIN ? 0 : JOIN; const w = rr.slice(Math.max(from, i - 30), i + 1); if (w.length < 12) return null; let s = 0; for (let k = 1; k < w.length; k++) s += (w[k] - w[k - 1]) ** 2; return Math.sqrt(s / (w.length - 1)); };
const hrvPath = (lo, hi, y0) => rr.map((_, i) => [i, rmssdAt(i)]).filter(([, v]) => v !== null).map(([i, v], k, a) => `${k === 0 || a[k - 1][0] !== i - 1 ? 'M' : 'L'}${(ts[i] / T * W).toFixed(1)} ${(y0 + LH - ((v - lo) / (hi - lo)) * LH).toFixed(1)}`).join('');
const split = ts[69] / T * W;

const POSTER = `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;600&family=Special+Elite&display=swap" rel="stylesheet">
<style>
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;overflow:hidden;color:#2a1613;font:400 18px/1.4 "IBM Plex Sans",sans-serif;position:relative;
 background-color:#fbf1ee;background-image:linear-gradient(#f0bcb2 1px,transparent 1px),linear-gradient(90deg,#f0bcb2 1px,transparent 1px),linear-gradient(#f7dcd5 1px,transparent 1px),linear-gradient(90deg,#f7dcd5 1px,transparent 1px);background-size:40px 40px,40px 40px,8px 8px,8px 8px}
.left{position:absolute;left:64px;top:64px;width:540px}
.k{font:600 15px "IBM Plex Mono";letter-spacing:.14em;color:#8b6a63;text-transform:uppercase;display:flex;align-items:center;gap:12px}
.k svg{width:40px;height:40px}
h1{font:600 84px/1 "IBM Plex Mono";letter-spacing:-.02em;margin:22px 0 20px}
.tl{font:600 29px/1.25 "IBM Plex Sans"}
.sub{margin-top:14px;color:#6e534d;font-size:18px;line-height:1.5}
.url{position:absolute;left:64px;bottom:58px;font:600 21px "IBM Plex Mono";background:#2a1613;color:#fff9f7;padding:9px 16px;border-radius:4px}
.card{position:absolute;right:56px;top:56px;width:540px;background:#fff9f7;border:1px solid #e9c7bf;border-radius:4px;padding:22px 20px 18px;box-shadow:0 18px 40px #7a2b1f22}
.ck{font:600 12px "IBM Plex Mono";letter-spacing:.12em;color:#8b6a63;text-transform:uppercase}
.stamp{display:inline-block;font:400 52px/1.05 "Special Elite";color:#c23a2b;border:4px solid #c23a2b;border-radius:6px;padding:4px 14px 0;transform:rotate(-3deg);margin:12px 0 8px}
.cs{color:#8b6a63;font-size:15px;margin-bottom:12px}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}.chips span{font-size:13px;background:#f6e1dc;padding:4px 9px;border-radius:4px}.chips b{font-family:"IBM Plex Mono"}
.strip{background-color:#fff9f7;background-image:linear-gradient(#f3cbc3 1px,transparent 1px),linear-gradient(90deg,#f3cbc3 1px,transparent 1px);background-size:25px 25px;border:1px solid #e9c7bf}
.lab{font:600 10px "IBM Plex Mono";fill:#2a1613;letter-spacing:.06em}
</style></head><body>
<div class="left">
  <div class="k">${ICON} Heart rate variability</div>
  <h1>HEARTSTRIP</h1>
  <p class="tl">See how calm your heart is,<br>beat by beat.</p>
  <p class="sub">Live from a Bluetooth heart-rate sensor · glitches<br>removed · judged against your own baseline<br>· Newton by Archetype AI</p>
</div>
<div class="url">heartstrip.vercel.app</div>
<div class="card">
  <div class="ck">Right now, against your baseline</div>
  <div class="stamp">More stressed</div>
  <div class="cs">HRV 37 ms vs your 96 ms baseline (−62%) · heart rate +13 bpm</div>
  <div class="chips"><span>Newton: <b>stressed</b> (5 of 5)</span><span>Signal: <b>98%</b> clean beats</span></div>
  <svg class="strip" viewBox="0 0 ${W} 300" width="498" height="300">
    <path d="M${split} 0V300" stroke="#8b6a63" stroke-dasharray="4 4"/>
    <text class="lab" x="6" y="14">HEART RATE</text><path d="${lane(hr, 45, 105, 8)}" fill="none" stroke="#c23a2b" stroke-width="1.8"/>
    <text class="lab" x="6" y="112">RR INTERVALS</text><path d="${lane(rr, 550, 1300, 104)}" fill="none" stroke="#2a1613" stroke-width="1.4"/>
    <text class="lab" x="6" y="210">HRV</text><path d="${hrvPath(0, 160, 200)}" fill="none" stroke="#2f7d5b" stroke-width="2.2"/>
    <text class="lab" x="${split + 6}" y="296" style="fill:#8b6a63">stress task begins</text>
  </svg>
</div>
</body></html>`;

const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
try {
  fs.writeFileSync(path.join(pub, 'icon.svg'), ICON);
  const page = await browser.newPage();
  const png = async (size, opaque) => {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(`<style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${ICON}`);
    return page.screenshot({ omitBackground: !opaque });
  };
  const [p16, p32, p48] = [await png(16), await png(32), await png(48)];
  fs.writeFileSync(path.join(pub, 'favicon-32.png'), p32);
  fs.writeFileSync(path.join(pub, 'apple-touch-icon.png'), await png(180, true));
  fs.writeFileSync(path.join(pub, 'icon-512.png'), await png(512, true));
  fs.writeFileSync(path.join(pub, 'favicon.ico'), ico([{ size: 16, buf: p16 }, { size: 32, buf: p32 }, { size: 48, buf: p48 }]));
  console.log('wrote public/icon.svg, favicon-32.png, apple-touch-icon.png, icon-512.png, favicon.ico');
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.setContent(POSTER, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(pub, 'og.png') });
  console.log('wrote public/og.png');
} finally {
  await browser.close();
}
