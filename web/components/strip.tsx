'use client';

import { useState, type FormEvent } from 'react';
import type { Reading } from '../lib/baseline';
import type { ChatMessage, NewtonReading } from '../hooks/use-newton';

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="4" fill="#c23a2b" />
      <path d="M3 18 H10 L13 9 L17 25 L20 14 L22 18 H29" fill="none" stroke="#fff9f7" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

const fmt = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** First screen: what this is, and the two ways in. */
export function Start({ onConnect, onDemo, error, connecting }: { onConnect: () => void; onDemo: () => void; error: string | null; connecting: boolean }) {
  return (
    <section className="card start">
      <div className="k">Heart rate variability</div>
      <h1>See how calm your heart is, beat by beat.</h1>
      <svg className="strip-art" viewBox="0 0 700 70" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 40 H120 L132 40 L140 12 L150 62 L158 34 L166 40 H300 L312 40 L320 10 L330 64 L338 32 L346 40 H480 L492 40 L500 14 L510 62 L518 34 L526 40 H700" fill="none" stroke="#2a1613" strokeWidth="2.2" strokeLinejoin="round" />
      </svg>
      <p>The time between heartbeats keeps changing. When you&apos;re relaxed it varies more; under stress it gets more regular. Heartstrip reads that variation (HRV) from a Bluetooth heart-rate sensor, removes sensor glitches, and estimates stress every five seconds with a model that runs in your browser.</p>
      <div className="actions">
        <button className="btn ink" onClick={onConnect} disabled={connecting}>{connecting ? 'Connecting…' : 'Connect a heart-rate sensor'}</button>
        <button className="btn" onClick={onDemo}>Play a recorded session</button>
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      <p className="fine">Works with sensors that report beat-to-beat intervals: Elite CorSense, Polar H10 / H9 / Verity Sense, Garmin HRM-Pro, Wahoo TICKR and others. Needs Chrome or Edge on a laptop or Android; iPhone browsers don&apos;t support Web Bluetooth, so try the recorded session there.</p>
    </section>
  );
}

const MOOD: Record<string, { word: string; cls: string }> = {
  learning: { word: 'Learning', cls: 'waiting' },
  calmer: { word: 'Calmer', cls: 'relaxed' },
  steady: { word: 'Steady', cls: 'steady' },
  stressed: { word: 'More stressed', cls: 'stressed lean' },
};

/**
 * One verdict: you against your own first two minutes. The in-browser model and
 * Newton sit underneath as second opinions.
 */
export function Verdict({ reading, paused, modelP, threshold, newton, newtonOn, newtonBeats, newtonWindow }: { reading: Reading; paused: boolean; modelP: number | null; threshold: number; newton: NewtonReading | null; newtonOn: boolean; newtonBeats: number; newtonWindow: number }) {
  const m = paused ? { word: 'Hold still', cls: 'waiting' } : MOOD[reading.mood];
  let sub: string;
  if (paused) sub = 'Too many sensor glitches in the last 30 seconds. Keep your finger still on the sensor.';
  else if (reading.mood === 'learning') sub = `Sit comfortably and breathe normally: learning your baseline, ${fmt(reading.remaining)} to go.`;
  else {
    const pct = Math.round((reading.ratio! - 1) * 100);
    const d = Math.round(reading.hrDelta!);
    sub = `HRV ${Math.round(reading.rmssd!)} ms vs your ${Math.round(reading.baseline!.rmssd)} ms baseline (${pct >= 0 ? '+' : ''}${pct}%) · heart rate ${d >= 0 ? '+' : ''}${d} bpm`;
  }
  const x = reading.ratio === null ? null : Math.min(1, Math.max(0, 1 - reading.ratio / 2));
  return (
    <section className="card verdict" aria-live="polite">
      <div className="k">Right now, against your baseline</div>
      <div className={`stamp ${m.cls}`}>{m.word}</div>
      <div className="sub">{sub}</div>
      <div className="chips">
        <span title="LightGBM model trained on WESAD; above its threshold it reads stressed">
          Stress model: <b>{modelP === null ? '—' : `${modelP >= threshold ? 'stressed' : 'relaxed'} (${Math.round(modelP * 100)}%)`}</b>
        </span>
        {newtonOn && (
          <span title="Newton compares the last 64 beats with labelled example windows and takes a vote of the 5 most similar">
            Newton: <b>{newton ? `${newton.label} (${Math.round(newton.stressedShare * newton.k)} of ${newton.k} similar examples stressed)` : newtonBeats < newtonWindow ? `collecting beats, ${newtonBeats} of ${newtonWindow}` : 'reading…'}</b>
          </span>
        )}
      </div>
      <div className="band" aria-hidden="true">
        <div className="th" style={{ left: '50%' }} />
        {x !== null && <div className="mark" style={{ left: `${x * 100}%` }} />}
      </div>
      <div className="band-l"><span>calmer</span><span>your baseline</span><span>more stressed</span></div>
    </section>
  );
}

export function Heart({ hr, rmssd, elapsed }: { hr: number | null; rmssd: number | null; elapsed: number }) {
  return (
    <section className="card heart">
      <div>
        <div className="k">
          <svg className="beat" style={{ ['--beat' as string]: hr ? `${60 / hr}s` : '1s' }} viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 21s-7.5-4.6-9.5-9.2C1 8.2 3.4 5 6.6 5c2 0 3.4 1.1 4.4 2.5C12 6.1 13.4 5 15.4 5 18.6 5 21 8.2 19.5 11.8 17.5 16.4 12 21 12 21z" /></svg>
          Heart rate
        </div>
        <div className="big">{hr ?? '—'}<small>bpm</small></div>
      </div>
      <div className="pair">
        <div><div className="k">HRV · RMSSD</div><div className="mid">{rmssd ?? '—'}<small>ms</small></div></div>
        <div><div className="k">Session</div><div className="mid">{fmt(elapsed)}</div></div>
      </div>
    </section>
  );
}

export function Quality({ quality, glitches, recent, minQuality }: { quality: number | null; glitches: number; recent: boolean[]; minQuality: number }) {
  return (
    <section className="card quality">
      <div className="k">Signal quality</div>
      <div className="qpct">{quality === null ? '—' : `${Math.round(quality * 100)}% clean beats`}</div>
      <div className="meter" aria-hidden="true">{recent.slice(-40).map((ok, i) => <i key={i} className={ok ? '' : 'g'} />)}</div>
      <p>{glitches ? `${glitches} glitch${glitches === 1 ? '' : 'es'} removed (a missed or extra beat, usually from moving). ` : 'No glitches so far. '}Readings pause when fewer than {Math.round(minQuality * 100)}% of recent beats are clean.</p>
    </section>
  );
}

const QUESTIONS = ['Am I stressed?', 'Explain my HRV', 'What changed in the last few minutes?'];

/** Ask Newton: a drawer, so the chat never takes over the dashboard. */
export function NewtonDrawer(props: {
  available: boolean; serverKey: boolean; ownKey: string | null; setOwnKey: (k: string | null) => void;
  messages: ChatMessage[]; loading: boolean; onAsk: (q: string) => void; readingError: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [keyDraft, setKeyDraft] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); const q = draft.trim(); if (q && !props.loading) { props.onAsk(q); setDraft(''); } };
  const useKey = (e: FormEvent) => { e.preventDefault(); if (keyDraft.trim()) { props.setOwnKey(keyDraft.trim()); setKeyDraft(''); } };
  return (
    <>
      <button className="ask-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>✦ Ask Newton</button>
      {open && (
        <div className="drawer" role="dialog" aria-label="Ask Newton">
          <header>
            <div className="k">Newton · Archetype AI</div>
            <button className="btn small" onClick={() => setOpen(false)}>Close</button>
          </header>
          {!props.available ? (
            <form className="body" onSubmit={useKey} style={{ display: 'block', border: 0 }}>
              <p className="msg">Newton is Archetype AI&apos;s physical-world model. It adds a second stress reading and answers questions about your charts.</p>
              <input type="password" autoComplete="off" spellCheck={false} placeholder="Your Archetype AI API key" aria-label="Archetype AI API key" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} />
              <div style={{ marginTop: 10 }}><button className="btn ink" type="submit">Use key</button></div>
              <p className="fine">The key stays in this tab&apos;s memory and goes only to Archetype AI, through this site. It isn&apos;t saved anywhere; reloading forgets it. Get one at <a href="https://console.u1.archetypeai.app/" target="_blank" rel="noopener">console.u1.archetypeai.app</a>.</p>
            </form>
          ) : (
            <>
              <div className="body">
                {!props.messages.length && <div className="qs">{QUESTIONS.map((q) => <button key={q} onClick={() => props.onAsk(q)} disabled={props.loading}>{q}</button>)}</div>}
                {props.messages.map((m, i) => <p key={i} className={`msg ${m.role}`}>{m.role === 'user' ? <span>{m.text}</span> : m.text}</p>)}
                {props.loading && <p className="msg newton dots">Newton is looking at your charts</p>}
                {props.readingError && <p className="fine">Newton reading: {props.readingError}</p>}
                {props.ownKey && <p className="fine">Using your key for this tab. <button className="btn small" onClick={() => props.setOwnKey(null)}>Forget key</button></p>}
              </div>
              <form onSubmit={submit}>
                <input placeholder="Ask about your HRV…" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Question for Newton" />
                <button className="btn ink" type="submit" disabled={props.loading}>Ask</button>
              </form>
            </>
          )}
        </div>
      )}
    </>
  );
}
