import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

const MACHINE_STATE_LENS = 'lns-1d519091822706e2-bc108andqxf8b4os';
const SSE_TIMEOUT_MS = 120_000;
const WINDOW_SIZE = 16;
const STEP_SIZE = 16;

// --- Focus CSVs (real WESAD RR intervals) ---

const RELAXED_CSV = readFileSync(join(process.cwd(), 'data', 'focus-relaxed.csv'), 'utf-8');
const STRESSED_CSV = readFileSync(join(process.cwd(), 'data', 'focus-stressed.csv'), 'utf-8');

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

// --- SSE reader ---

interface ClassificationResult {
  label: string;
  scores: Record<string, number>;
}

async function readSSEResults(
  baseUrl: string,
  apiKey: string,
  sessionId: string,
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

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

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
          } else if (event.type === 'sse.stream.end') {
            reader.cancel();
            break;
          }
        } catch {
          // skip
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return results;
}

// --- Build natural language response ---

function buildResponse(
  question: string,
  results: ClassificationResult[],
  hrvMetrics?: Record<string, unknown>,
): string {
  if (results.length === 0) {
    return 'I could not analyze your HRV data. Please try again with more data collected.';
  }

  // Aggregate classification votes
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

  // Build metrics context
  const hr = hrvMetrics?.heartRate;
  const rmssd = hrvMetrics?.rmssd;
  const stressProb = hrvMetrics?.stressProbability;

  const state = isStressed ? 'stressed' : 'relaxed';
  const confidence = isStressed ? stressedPct : relaxedPct;

  const lines: string[] = [];

  const q = question.toLowerCase();

  if (q.includes('stress') || q.includes('relax') || q.includes('how am i')) {
    lines.push(
      `Based on Newton's analysis of your RR intervals, you appear to be **${state}** (${confidence.toFixed(0)}% confidence).`,
    );
    if (hr) lines.push(`Your heart rate is ${hr} bpm.`);
    if (rmssd) lines.push(`RMSSD is ${rmssd} ms${Number(rmssd) > 40 ? ', which indicates good parasympathetic activity' : ', suggesting lower HRV'}.`);
    if (isStressed) {
      lines.push('Consider taking a few slow, deep breaths or a short break to activate your parasympathetic nervous system.');
    } else {
      lines.push('Your autonomic nervous system shows good balance. Keep it up!');
    }
  } else if (q.includes('work out') || q.includes('exercise') || q.includes('train')) {
    if (isStressed) {
      lines.push(
        `Newton's analysis suggests you're in a **stressed** state (${stressedPct.toFixed(0)}% stress score). Light activity like walking or yoga would be better than intense training today.`,
      );
    } else {
      lines.push(
        `Your HRV pattern looks **relaxed** (${relaxedPct.toFixed(0)}% relaxed score). You're likely recovered enough for a solid workout!`,
      );
    }
    if (rmssd) lines.push(`RMSSD: ${rmssd} ms.`);
  } else if (q.includes('explain') || q.includes('hrv') || q.includes('recovery')) {
    lines.push(`Newton classified your current state as **${state}** with ${confidence.toFixed(0)}% confidence across ${results.length} analysis window(s).`);
    if (hr) lines.push(`Heart rate: ${hr} bpm.`);
    if (rmssd) lines.push(`RMSSD: ${rmssd} ms — ${Number(rmssd) > 50 ? 'high variability indicates good recovery' : Number(rmssd) > 30 ? 'moderate variability' : 'low variability suggests fatigue or stress'}.`);
    if (stressProb != null) lines.push(`ML stress probability: ${(Number(stressProb) * 100).toFixed(0)}%.`);
    lines.push(`Newton stress/relaxed ratio: ${stressedPct.toFixed(0)}% / ${relaxedPct.toFixed(0)}%.`);
  } else {
    // Generic
    lines.push(`Newton analyzed your HRV data and classified your state as **${state}** (${confidence.toFixed(0)}% confidence).`);
    if (hr) lines.push(`Heart rate: ${hr} bpm.`);
    if (rmssd) lines.push(`RMSSD: ${rmssd} ms.`);
  }

  return lines.join(' ');
}

// --- Route handler ---

export async function POST(request: NextRequest) {
  const apiKey = process.env.ATAI_API_KEY;
  const endpoint = process.env.ATAI_API_ENDPOINT;

  if (!apiKey || !endpoint) {
    return NextResponse.json({ error: 'Newton is not configured' }, { status: 503 });
  }

  const baseUrl = endpoint.replace(/\/+$/, '');

  let body: { question: string; rrIntervals: number[]; hrvMetrics?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { question, rrIntervals, hrvMetrics } = body;

  if (!question || !rrIntervals?.length) {
    return NextResponse.json({ error: 'question and rrIntervals are required' }, { status: 400 });
  }

  // Build user data CSV (column "a1" to match focus files)
  const csvLines = ['timestamp,a1'];
  let t = 0;
  for (const rr of rrIntervals) {
    t += rr / 1000;
    csvLines.push(`${t.toFixed(3)},${rr.toFixed(1)}`);
  }
  const userCSV = csvLines.join('\n');

  const fileIds: string[] = [];
  let sessionId: string | null = null;

  try {
    // 1. Upload all CSVs in parallel (unique names to avoid collisions)
    const uid = Date.now().toString(36);
    const [relaxedId, stressedId, dataId] = await Promise.all([
      uploadCSV(baseUrl, apiKey, `relaxed_${uid}.csv`, RELAXED_CSV),
      uploadCSV(baseUrl, apiKey, `stressed_${uid}.csv`, STRESSED_CSV),
      uploadCSV(baseUrl, apiKey, `hrv_${uid}.csv`, userCSV),
    ]);
    fileIds.push(relaxedId, stressedId, dataId);
    console.log(`[newton] uploaded files: ${fileIds.join(', ')} (${rrIntervals.length} RR intervals)`);

    // 2. Create session
    const sessionRes = await apiPost(baseUrl, apiKey, 'lens/sessions/create', {
      lens_id: MACHINE_STATE_LENS,
    });
    sessionId = sessionRes.session_id;

    // 3. Configure lens (cookbook-style events via REST)
    await apiPost(baseUrl, apiKey, 'lens/sessions/events/process', {
      session_id: sessionId,
      event: {
        type: 'session.modify',
        event_data: {
          input_n_shot: { relaxed: relaxedId, stressed: stressedId },
          csv_configs: {
            timestamp_column: 'timestamp',
            data_columns: ['a1'],
            window_size: WINDOW_SIZE,
            step_size: STEP_SIZE,
          },
        },
      },
    });

    await apiPost(baseUrl, apiKey, 'lens/sessions/events/process', {
      session_id: sessionId,
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

    await apiPost(baseUrl, apiKey, 'lens/sessions/events/process', {
      session_id: sessionId,
      event: {
        type: 'output_stream.set',
        event_data: {
          stream_type: 'server_side_events_writer',
          stream_config: {},
        },
      },
    });

    // 4. Read classification results via SSE
    console.log(`[newton] reading SSE for session ${sessionId}`);
    const results = await readSSEResults(baseUrl, apiKey, sessionId!);
    console.log(`[newton] got ${results.length} results:`, JSON.stringify(results));

    // 5. Build natural language response
    const response = buildResponse(question, results, hrvMetrics);

    return NextResponse.json({ response });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Newton request failed' },
      { status: 500 },
    );
  } finally {
    // Cleanup
    if (sessionId) {
      apiPost(baseUrl, apiKey, 'lens/sessions/destroy', { session_id: sessionId }).catch(() => {});
    }
    for (const fid of fileIds) {
      deleteFile(baseUrl, apiKey, fid);
    }
  }
}
