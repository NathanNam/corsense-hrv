import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, readFileSync, unlinkSync, mkdtempSync, rmdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

const ACTIVITY_MONITOR_LENS = 'lns-fd669361822b07e2-bc608aa3fdf8b4f9';
const SSE_TIMEOUT_MS = 120_000;

// --- API helpers ---

function authHeaders(apiKey: string) {
  return { Authorization: `Bearer ${apiKey}` };
}

async function apiPost(baseUrl: string, apiKey: string, path: string, body: object) {
  const res = await fetch(`${baseUrl}/${path}`, {
    method: 'POST',
    headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path}: ${res.status} ${text}`);
  }
  return res.json();
}

async function uploadFile(
  baseUrl: string,
  apiKey: string,
  name: string,
  content: Buffer | Blob,
  contentType: string,
) {
  const form = new FormData();
  const blob = content instanceof Blob ? content : new Blob([new Uint8Array(content)], { type: contentType });
  form.append('file', blob, name);
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

// --- PNG → MP4 conversion ---

function pngToVideo(pngBase64: string): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'newton-'));
  const pngPath = join(dir, 'chart.png');
  const mp4Path = join(dir, 'chart.mp4');

  try {
    writeFileSync(pngPath, Buffer.from(pngBase64, 'base64'));

    execSync(
      `ffmpeg -y -loop 1 -i "${pngPath}" -c:v libx264 -t 10 -pix_fmt yuv420p ` +
        `-vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -r 2 "${mp4Path}"`,
      { stdio: 'pipe', timeout: 15_000 },
    );

    return readFileSync(mp4Path);
  } finally {
    try { unlinkSync(pngPath); } catch {}
    try { unlinkSync(mp4Path); } catch {}
    try { rmdirSync(dir); } catch {}
  }
}

// --- SSE reader ---

async function readSSEResults(
  baseUrl: string,
  apiKey: string,
  sessionId: string,
): Promise<string[]> {
  const url = `${baseUrl}/lens/sessions/consumer/${sessionId}`;
  const res = await fetch(url, {
    headers: { ...authHeaders(apiKey), Accept: 'text/event-stream' },
    signal: AbortSignal.timeout(SSE_TIMEOUT_MS),
  });
  if (!res.ok || !res.body) throw new Error(`SSE failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const results: string[] = [];
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
            console.log(`[newton] inference.result:`, typeof resp, Array.isArray(resp) ? `[${resp.length}]` : String(resp).slice(0, 100));
            if (Array.isArray(resp)) {
              results.push(resp[0]);
            } else if (typeof resp === 'string') {
              results.push(resp);
            }
            // Activity Monitor typically returns 1 result per video
            done = true;
            break;
          } else if (event.type === 'sse.stream.end') {
            console.log('[newton] stream end');
            done = true;
            break;
          } else if (event.type === 'error_message') {
            console.error('[newton] SSE error:', event.event_data?.message);
          } else {
            console.log(`[newton] SSE event: ${event.type}`);
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

// --- Route handler ---

export async function POST(request: NextRequest) {
  const apiKey = process.env.ATAI_API_KEY;
  const endpoint = process.env.ATAI_API_ENDPOINT;

  if (!apiKey || !endpoint) {
    return NextResponse.json({ error: 'Newton is not configured' }, { status: 503 });
  }

  const baseUrl = endpoint.replace(/\/+$/, '');

  let body: { question: string; chartImage?: string; rrIntervals?: number[]; hrvMetrics?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { question, chartImage } = body;

  if (!question) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 });
  }

  // If no chart image, return an error — we need visuals for Activity Monitor
  if (!chartImage) {
    return NextResponse.json(
      { error: 'Chart screenshot is required for Newton AI analysis' },
      { status: 400 },
    );
  }

  let videoFileId: string | null = null;
  let sessionId: string | null = null;

  try {
    // 1. Convert PNG to video
    console.log('[newton] converting chart screenshot to video...');
    const videoBuffer = pngToVideo(chartImage);
    console.log(`[newton] video generated: ${videoBuffer.length} bytes`);

    // 2. Upload video
    videoFileId = await uploadFile(baseUrl, apiKey, `hrv_${Date.now().toString(36)}.mp4`, videoBuffer, 'video/mp4');
    console.log(`[newton] uploaded video: ${videoFileId}`);

    // 3. Create Activity Monitor session
    const sessionRes = await apiPost(baseUrl, apiKey, 'lens/sessions/create', {
      lens_id: ACTIVITY_MONITOR_LENS,
    });
    sessionId = sessionRes.session_id;
    console.log(`[newton] session: ${sessionId}`);

    // 4. Configure lens with focus + instruction
    await apiPost(baseUrl, apiKey, 'lens/sessions/events/process', {
      session_id: sessionId,
      event: {
        type: 'session.modify',
        event_data: {
          focus:
            'This is a real-time heart rate variability (HRV) monitoring dashboard from a Bluetooth chest strap sensor. ' +
            'It shows 4 charts: (1) Stress Probability Over Time — an ML model\'s stress prediction with a red threshold line, ' +
            '(2) Heart Rate Over Time in BPM, (3) RR Intervals — beat-to-beat timing in milliseconds, ' +
            'and (4) HRV (RMSSD) Over Time — root mean square of successive differences, a key measure of parasympathetic activity. ' +
            'Higher RMSSD = more relaxed. Lower RMSSD = more stressed. Sudden drops in RR intervals correlate with stress or sympathetic activation.',
          instruction: question,
        },
      },
    });

    // 5. Set output stream FIRST (so SSE is ready before video triggers processing)
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

    // 6. Set input stream (video) — this triggers processing
    await apiPost(baseUrl, apiKey, 'lens/sessions/events/process', {
      session_id: sessionId,
      event: {
        type: 'input_stream.set',
        event_data: {
          stream_type: 'video_file_reader',
          stream_config: { file_id: videoFileId },
        },
      },
    });

    // 7. Read SSE results
    console.log('[newton] reading SSE results...');
    const t0 = Date.now();
    const results = await readSSEResults(baseUrl, apiKey, sessionId!);
    console.log(`[newton] got ${results.length} results in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    if (results.length === 0) {
      return NextResponse.json({
        response: 'I was unable to analyze your HRV dashboard at this time. Please try again.',
      });
    }

    // The Activity Monitor returns full natural language — use it directly
    return NextResponse.json({ response: results[0] });
  } catch (err) {
    console.error('[newton] query error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Newton request failed' },
      { status: 500 },
    );
  } finally {
    if (sessionId) {
      apiPost(baseUrl, apiKey, 'lens/sessions/destroy', { session_id: sessionId }).catch(() => {});
    }
    if (videoFileId) {
      deleteFile(baseUrl, apiKey, videoFileId);
    }
  }
}
