import { readFileSync } from 'fs';
import { join } from 'path';

const MACHINE_STATE_LENS = 'lns-1d519091822706e2-bc108andqxf8b4os';
const SSE_TIMEOUT_MS = 120_000;
const WINDOW_SIZE = 16;
const STEP_SIZE = 8;
const QUERY_INTERVAL_MS = 15_000;
const MAX_RR_BUFFER = 300;
const MIN_RR_FOR_QUERY = 32;

// --- Focus CSVs ---

const RELAXED_CSV = readFileSync(join(process.cwd(), 'data', 'focus-relaxed.csv'), 'utf-8');
const STRESSED_CSV = readFileSync(join(process.cwd(), 'data', 'focus-stressed.csv'), 'utf-8');

let cachedFocusFiles: { relaxedId: string; stressedId: string; baseUrl: string; apiKey: string } | null = null;

// --- Types ---

export interface StreamResult {
  label: string;
  confidence: number;
  scores: Record<string, number>;
  windows: number;
  timestamp: number;
}

// --- Rolling HRV features ---

const ROLLING_WINDOW = 16;

interface RollingFeatures {
  rmssd: number;
  sdnn: number;
  meanHr: number;
  pnn50: number;
  sd1: number;
}

function computeRollingFeatures(rrIntervalsMs: number[]): RollingFeatures[] {
  const results: RollingFeatures[] = [];
  for (let i = 0; i < rrIntervalsMs.length; i++) {
    const start = Math.max(0, i - ROLLING_WINDOW + 1);
    const window = rrIntervalsMs.slice(start, i + 1);
    if (window.length < 2) {
      results.push({ rmssd: 0, sdnn: 0, meanHr: 0, pnn50: 0, sd1: 0 });
      continue;
    }
    const diffs: number[] = [];
    for (let j = 1; j < window.length; j++) diffs.push(window[j] - window[j - 1]);

    const meanRr = window.reduce((a, b) => a + b, 0) / window.length;
    const rmssd = Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / diffs.length);
    const variance = window.reduce((s, v) => s + (v - meanRr) ** 2, 0) / (window.length - 1);
    const sdnn = Math.sqrt(variance);
    const meanHr = window.reduce((s, v) => s + 60000 / v, 0) / window.length;
    const pnn50 = (diffs.filter(d => Math.abs(d) > 50).length / diffs.length) * 100;
    const diffMean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const diffVar = diffs.length > 1
      ? diffs.reduce((s, d) => s + (d - diffMean) ** 2, 0) / (diffs.length - 1)
      : 0;
    const sd1 = Math.sqrt(diffVar) / Math.SQRT2;

    results.push({ rmssd, sdnn, meanHr, pnn50, sd1 });
  }
  return results;
}

// --- API helpers ---

function authHeaders(apiKey: string) {
  return { Authorization: `Bearer ${apiKey}` };
}

async function apiPost(baseUrl: string, apiKey: string, path: string, body: object) {
  const res = await fetch(`${baseUrl}/${path}`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path}: ${res.status} ${text}`);
  }
  return res.json();
}

async function uploadCSV(baseUrl: string, apiKey: string, name: string, content: string) {
  const form = new FormData();
  form.append('file', new Blob([content], { type: 'text/csv' }), name);
  const res = await fetch(`${baseUrl}/files`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: form,
  });
  if (!res.ok) throw new Error(`Upload ${name} failed: ${res.status}`);
  const data = await res.json();
  return data.file_id as string;
}

async function deleteFile(baseUrl: string, apiKey: string, fileId: string) {
  fetch(`${baseUrl}/files/delete/${fileId}`, {
    method: 'DELETE',
    headers: authHeaders(apiKey),
  }).catch(() => {});
}

async function getFocusFileIds(baseUrl: string, apiKey: string) {
  if (cachedFocusFiles && cachedFocusFiles.baseUrl === baseUrl && cachedFocusFiles.apiKey === apiKey) {
    return { relaxedId: cachedFocusFiles.relaxedId, stressedId: cachedFocusFiles.stressedId };
  }
  const [relaxedId, stressedId] = await Promise.all([
    uploadCSV(baseUrl, apiKey, 'focus_relaxed.csv', RELAXED_CSV),
    uploadCSV(baseUrl, apiKey, 'focus_stressed.csv', STRESSED_CSV),
  ]);
  cachedFocusFiles = { relaxedId, stressedId, baseUrl, apiKey };
  console.log(`[newton-stream] uploaded focus files: relaxed=${relaxedId}, stressed=${stressedId}`);
  return { relaxedId, stressedId };
}

// --- SSE reader ---

interface ClassificationResult {
  label: string;
  scores: Record<string, number>;
}

async function readSSEResults(
  baseUrl: string,
  apiKey: string,
  sessionId: string,
  expectedWindows?: number,
): Promise<ClassificationResult[]> {
  const url = `${baseUrl}/lens/sessions/consumer/${sessionId}`;
  const res = await fetch(url, {
    headers: { ...authHeaders(apiKey), Accept: 'text/event-stream' },
    signal: AbortSignal.timeout(SSE_TIMEOUT_MS),
  });
  if (!res.ok || !res.body) throw new Error(`SSE failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const results: ClassificationResult[] = [];
  let buffer = '';
  let done = false;

  try {
    while (!done) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });

      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        const dataLine = part.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        try {
          const event = JSON.parse(dataLine.slice(5).trim());
          if (event.type === 'inference.result') {
            const resp = event.event_data?.response;
            if (Array.isArray(resp) && resp.length >= 2) {
              results.push({ label: resp[0], scores: resp[1] });
            }
            // Early termination: got all expected windows
            if (expectedWindows && results.length >= expectedWindows) {
              console.log(`[newton-stream] early SSE close after ${results.length} results`);
              done = true;
              break;
            }
          } else if (event.type === 'sse.stream.end') {
            done = true;
            break;
          }
        } catch {
          // skip
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return results;
}

// --- Build CSV from RR intervals ---

function buildCSV(rrIntervals: number[]): string {
  const features = computeRollingFeatures(rrIntervals);
  const csvLines = ['timestamp,a1,rmssd,sdnn,mean_hr,pnn50,sd1'];
  let t = 0;
  for (let i = 0; i < rrIntervals.length; i++) {
    const rr = rrIntervals[i];
    const f = features[i];
    t += rr / 1000;
    csvLines.push(
      `${t.toFixed(3)},${rr.toFixed(1)},${f.rmssd.toFixed(1)},${f.sdnn.toFixed(1)},${f.meanHr.toFixed(1)},${f.pnn50.toFixed(1)},${f.sd1.toFixed(1)}`,
    );
  }
  return csvLines.join('\n');
}

// --- Aggregate classification results ---

function aggregateResults(results: ClassificationResult[]): StreamResult | null {
  if (results.length === 0) return null;

  const totalScores: Record<string, number> = {};
  for (const r of results) {
    for (const [cls, score] of Object.entries(r.scores)) {
      totalScores[cls] = (totalScores[cls] || 0) + score;
    }
  }
  const total = Object.values(totalScores).reduce((a, b) => a + b, 0);
  const stressedPct = total > 0 ? ((totalScores['stressed'] || 0) / total) * 100 : 0;
  const relaxedPct = total > 0 ? ((totalScores['relaxed'] || 0) / total) * 100 : 0;
  const isStressed = stressedPct > relaxedPct;

  return {
    label: isStressed ? 'stressed' : 'relaxed',
    confidence: isStressed ? stressedPct : relaxedPct,
    scores: { stressed: stressedPct, relaxed: relaxedPct },
    windows: results.length,
    timestamp: Date.now(),
  };
}

// --- Stream Manager Singleton (reuses lens session) ---

type Listener = (result: StreamResult) => void;

class NewtonStreamManager {
  private rrBuffer: number[] = [];
  private listeners = new Set<Listener>();
  private queryTimer: ReturnType<typeof setInterval> | null = null;
  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private querying = false;
  latestResult: StreamResult | null = null;

  // Persistent session state
  private sessionId: string | null = null;
  private sessionReady = false;
  private lastDataId: string | null = null;
  private baseUrl = '';
  private apiKey = '';

  addRR(rrIntervals: number[]) {
    this.rrBuffer.push(...rrIntervals);
    if (this.rrBuffer.length > MAX_RR_BUFFER) {
      this.rrBuffer = this.rrBuffer.slice(-MAX_RR_BUFFER);
    }
  }

  addListener(listener: Listener) {
    this.listeners.add(listener);
    if (this.latestResult) listener(this.latestResult);
  }

  removeListener(listener: Listener) {
    this.listeners.delete(listener);
  }

  start() {
    if (this.running) return;

    const apiKey = process.env.ATAI_API_KEY;
    const endpoint = process.env.ATAI_API_ENDPOINT;
    if (!apiKey || !endpoint) return;

    this.baseUrl = endpoint.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.running = true;
    console.log('[newton-stream] starting periodic queries');

    this.initialTimer = setTimeout(() => {
      this.runQuery();
    }, 3000);

    this.queryTimer = setInterval(() => {
      this.runQuery();
    }, QUERY_INTERVAL_MS);
  }

  /** Create and configure a new lens session */
  private async createSession(): Promise<string> {
    // Destroy stale session if exists
    if (this.sessionId) {
      apiPost(this.baseUrl, this.apiKey, 'lens/sessions/destroy', { session_id: this.sessionId }).catch(() => {});
      this.sessionId = null;
      this.sessionReady = false;
    }

    const { relaxedId, stressedId } = await getFocusFileIds(this.baseUrl, this.apiKey);

    const sessionRes = await apiPost(this.baseUrl, this.apiKey, 'lens/sessions/create', {
      lens_id: MACHINE_STATE_LENS,
    });
    this.sessionId = sessionRes.session_id;
    console.log(`[newton-stream] created session ${this.sessionId}`);

    await apiPost(this.baseUrl, this.apiKey, 'lens/sessions/events/process', {
      session_id: this.sessionId,
      event: {
        type: 'session.modify',
        event_data: {
          input_n_shot: { relaxed: relaxedId, stressed: stressedId },
          csv_configs: {
            timestamp_column: 'timestamp',
            data_columns: ['a1', 'rmssd', 'sdnn', 'mean_hr', 'pnn50', 'sd1'],
            window_size: WINDOW_SIZE,
            step_size: STEP_SIZE,
          },
        },
      },
    });

    await apiPost(this.baseUrl, this.apiKey, 'lens/sessions/events/process', {
      session_id: this.sessionId,
      event: {
        type: 'output_stream.set',
        event_data: {
          stream_type: 'server_side_events_writer',
          stream_config: {},
        },
      },
    });

    this.sessionReady = true;
    return this.sessionId!;
  }

  private async runQuery() {
    if (this.querying) return;
    if (this.rrBuffer.length < MIN_RR_FOR_QUERY) {
      console.log(`[newton-stream] waiting for data (${this.rrBuffer.length}/${MIN_RR_FOR_QUERY} beats)`);
      return;
    }

    this.querying = true;
    const snapshot = [...this.rrBuffer];
    const t0 = Date.now();
    console.log(`[newton-stream] querying with ${snapshot.length} RR intervals`);

    let dataId: string | null = null;

    try {
      // Upload CSV
      const userCSV = buildCSV(snapshot);
      dataId = await uploadCSV(this.baseUrl, this.apiKey, `hrv_stream_${Date.now().toString(36)}.csv`, userCSV);

      // Ensure session exists (first call creates, subsequent reuse)
      if (!this.sessionId || !this.sessionReady) {
        await this.createSession();
      }

      // Set input stream (only per-query call when session is reused)
      await apiPost(this.baseUrl, this.apiKey, 'lens/sessions/events/process', {
        session_id: this.sessionId,
        event: {
          type: 'input_stream.set',
          event_data: {
            stream_type: 'csv_file_reader',
            stream_config: {
              file_id: dataId,
              window_size: WINDOW_SIZE,
              step_size: STEP_SIZE,
              loop_recording: false,
              output_format: '',
            },
          },
        },
      });

      // Read results
      // Expected windows: (dataPoints - windowSize) / stepSize + 1
      const expectedWindows = Math.max(1, Math.floor((snapshot.length - WINDOW_SIZE) / STEP_SIZE) + 1);
      const results = await readSSEResults(this.baseUrl, this.apiKey, this.sessionId!, expectedWindows);
      const result = aggregateResults(results);

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      if (result) {
        this.latestResult = result;
        console.log(`[newton-stream] result: ${result.label} ${result.confidence.toFixed(0)}% (${result.windows} windows) in ${elapsed}s`);
        for (const listener of this.listeners) {
          try { listener(result); } catch { /* ignore */ }
        }
      } else {
        console.log(`[newton-stream] no results in ${elapsed}s`);
      }
    } catch (err) {
      console.error(`[newton-stream] query failed:`, err instanceof Error ? err.message : err);
      // Invalidate session so it gets recreated next time
      this.sessionReady = false;
      cachedFocusFiles = null;
    } finally {
      // Clean up old data file
      if (this.lastDataId) {
        deleteFile(this.baseUrl, this.apiKey, this.lastDataId);
      }
      this.lastDataId = dataId;
      this.querying = false;
    }
  }

  stop() {
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }
    if (this.queryTimer) {
      clearInterval(this.queryTimer);
      this.queryTimer = null;
    }
    if (this.sessionId) {
      apiPost(this.baseUrl, this.apiKey, 'lens/sessions/destroy', { session_id: this.sessionId }).catch(() => {});
      this.sessionId = null;
      this.sessionReady = false;
    }
    if (this.lastDataId) {
      deleteFile(this.baseUrl, this.apiKey, this.lastDataId);
      this.lastDataId = null;
    }
    this.running = false;
    this.rrBuffer = [];
    this.latestResult = null;
    this.listeners.clear();
    console.log('[newton-stream] stopped');
  }
}

// Module-level singleton
export const newtonStream = new NewtonStreamManager();
