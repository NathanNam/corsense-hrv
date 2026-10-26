'use client';

import { useCallback, useMemo, useRef } from 'react';
import { useHeartRate } from '../hooks/use-heart-rate';
import { useStressPrediction, MIN_QUALITY } from '../hooks/use-stress-prediction';
import { useNewton } from '../hooks/use-newton';
import { MODEL_CONFIG } from '../lib/stress-predictor';
import { read } from '../lib/baseline';
import { Timeline, timelinePng } from '../components/timeline';
import { Logo, Start, Verdict, Heart, Quality, NewtonDrawer } from '../components/strip';

export default function Home() {
  const hr = useHeartRate();
  const stress = useStressPrediction(hr.beats);
  // For Newton: every beat in order, with each glitch replaced by the median of
  // the five clean beats before it (as HRV tools correct artefacts), so the
  // window stays one contiguous series instead of having holes.
  const newtonRR = useMemo(() => {
    const out: number[] = [];
    const recent: number[] = [];
    for (const b of hr.beats) {
      if (!b.glitch) { recent.push(b.rr); if (recent.length > 5) recent.shift(); out.push(b.rr); }
      else if (recent.length) out.push([...recent].sort((x, y) => x - y)[recent.length >> 1]);
    }
    return out;
  }, [hr.beats]);
  const live = hr.status === 'connected';
  const newton = useNewton(newtonRR, live, hr.sessionId);
  const svgRef = useRef<SVGSVGElement>(null);
  const reading = useMemo(() => read(
    hr.rmssdHistory.map((p) => ({ time: p.time, value: p.rmssd })),
    hr.beats.filter((b) => !b.glitch).map((b) => ({ time: b.time, value: b.hr })),
  ), [hr.rmssdHistory, hr.beats]);
  const started = hr.beats.length > 0 || live;
  const elapsed = hr.beats.length ? hr.beats[hr.beats.length - 1].time : 0;

  const onAsk = useCallback(async (question: string) => {
    const p = stress.prediction?.probability;
    const summary = [
      reading.baseline ? `verdict against personal baseline: ${reading.mood}; baseline HRV ${Math.round(reading.baseline.rmssd)} ms and heart rate ${Math.round(reading.baseline.hr)} bpm (first 2 minutes); now HRV ${Math.round(reading.rmssd ?? 0)} ms, heart rate ${Math.round(reading.hr ?? 0)} bpm` : 'still learning the personal baseline (first 2 minutes)',
      `sensor: ${hr.source === 'demo' ? 'recorded WESAD chest-ECG session' : `${hr.deviceName ?? 'heart-rate sensor'}${hr.sensorLocation ? ` (${hr.sensorLocation})` : ''}`}`,
      `heart rate ${hr.currentHR ?? 'n/a'} bpm`,
      `HRV (RMSSD, last 30 s) ${hr.currentRMSSD ?? 'n/a'} ms`,
      `in-browser stress probability ${p === undefined ? 'n/a' : `${Math.round(p * 100)}%`} (threshold ${Math.round(MODEL_CONFIG.threshold * 100)}%)`,
      newton.reading ? `Newton reading: ${newton.reading.label} (${Math.round(newton.reading.stressedShare * newton.reading.k)} of ${newton.reading.k} nearest examples stressed)` : null,
      `signal quality ${hr.signalQuality === null ? 'n/a' : `${Math.round(hr.signalQuality * 100)}%`} clean beats, ${hr.glitchesRemoved} glitches removed`,
      `session length ${Math.round(elapsed / 60000)} min`,
    ].filter(Boolean).join('; ');
    const images = svgRef.current ? [await timelinePng(svgRef.current)] : [];
    newton.ask(question, summary, images);
  }, [hr.currentHR, hr.currentRMSSD, hr.signalQuality, hr.glitchesRemoved, hr.source, hr.deviceName, hr.sensorLocation, elapsed, stress.prediction, newton, reading]);

  return (
    <main className="wrap">
      <header className="top">
        <div className="brand"><Logo /><span>HEARTSTRIP</span></div>
        {started && (
          <div className="dev">
            <span className={`pill ${hr.source === 'demo' ? 'demo' : ''}`}><i />{hr.deviceName}</span>
            {hr.sensorLocation && <span>{hr.sensorLocation}</span>}
            {hr.batteryLevel !== null && <span>{hr.batteryLevel}% battery</span>}
            {hr.status === 'disconnected' && <span>{hr.source === 'demo' ? 'Recording finished' : 'Disconnected'}</span>}
            <button className="btn small" onClick={hr.disconnect}>{hr.source === 'demo' ? 'Stop demo' : 'Disconnect'}</button>
          </div>
        )}
      </header>

      {!started ? (
        <Start onConnect={hr.connect} onDemo={() => hr.startDemo()} error={hr.error} connecting={hr.status === 'connecting'} />
      ) : (
        <>
          {hr.source === 'demo' && (
            <p className="banner">Demo: the clearest relaxed and stressed examples from the WESAD study (chest ECG; three people each, picked separately, so likely different people), played in real time: about 6 minutes relaxed, then 5 minutes from a stress task. A real session is usually subtler. Now playing: <b>{hr.demoLabel}</b>.{' '}
              {hr.demoLabel === 'relaxed' && <button className="btn small" onClick={() => hr.startDemo(7.5 * 60_000)}>Jump to the stress part</button>}</p>
          )}
          <div className="grid">
            <Verdict reading={reading} paused={stress.paused} modelP={stress.prediction?.probability ?? null} threshold={MODEL_CONFIG.threshold} newton={newton.reading} newtonOn={newton.available} />
            <Heart hr={hr.currentHR} rmssd={hr.currentRMSSD} elapsed={elapsed} />
            <Quality quality={hr.signalQuality} glitches={hr.glitchesRemoved} recent={hr.beats.map((b) => !b.glitch)} minQuality={MIN_QUALITY} />
            <section className="card timeline wide">
              <h2>Last 10 minutes</h2>
              <div className="legend">
                <span><i style={{ background: '#c23a2b' }} />Heart rate</span>
                <span><i style={{ background: '#2a1613' }} />RR intervals</span>
                <span><i className="dash" />Glitch removed</span>
                <span><i style={{ background: '#2f7d5b' }} />HRV (dashed: your baseline)</span>
                <span><i style={{ background: '#c9821f' }} />Stress model (dashed: its threshold)</span>
              </div>
              {hr.beats.length ? (
                <Timeline ref={svgRef} beats={hr.beats} rmssd={hr.rmssdHistory} stress={stress.history} threshold={MODEL_CONFIG.threshold} baseline={reading.baseline?.rmssd ?? null} />
              ) : (
                <p className="empty-tl">Waiting for the first beats…</p>
              )}
            </section>
          </div>
        </>
      )}

      <footer className="foot">
        <p>Not medical advice. The verdict compares you with your own first two minutes, the way HRV apps such as Elite HRV use a personal baseline. The stress model underneath is a LightGBM model trained on chest-ECG recordings of 15 people (WESAD); on people it hadn&apos;t seen it was right about 6 times in 10 (AUC 0.71), and it hasn&apos;t been checked on fingertip sensors.</p>
        <p>Newton (optional) embeds the last 64 beats with Archetype AI&apos;s Newton Omega encoder and takes a vote of the 5 most similar labelled WESAD windows. Judging each of the six example people only against the other five, it got 29 of 30 windows right, but those are WESAD&apos;s clearest examples, so expect less on an ordinary session. In the demo it has seen these exact recordings.</p>
        <p><a href="https://www.nathannam.com">Nathan Nam</a> · <a href="https://github.com/NathanNam/heartstrip">code</a></p>
      </footer>

      {started && (
        <NewtonDrawer available={newton.available} serverKey={newton.serverKey} ownKey={newton.ownKey} setOwnKey={newton.setOwnKey} messages={newton.messages} loading={newton.loading} onAsk={onAsk} readingError={newton.readingError} />
      )}
    </main>
  );
}
