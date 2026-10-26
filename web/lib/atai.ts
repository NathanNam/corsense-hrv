/**
 * Archetype AI (Newton) over the stateless `/api/lens/query` endpoint: one POST
 * per question or per window, no lens sessions, no file uploads, no SSE. That's
 * what lets the app run on serverless hosting.
 *
 *   Fusion model  Newton::c2_6_8b_fp8_260424d7a55d5e   chart images + text -> answer
 *   Omega encoder OmegaEncoder::omega_embeddings_1_4  RR window -> 768-d embedding
 *
 * Keys: a visitor's own key arrives per request in the `x-atai-key` header (it
 * lives only in their browser tab's memory and is never stored or logged here);
 * otherwise the server's ATAI_API_KEY is used, if one is set.
 */
export const FUSION_MODEL = 'Newton::c2_6_8b_fp8_260424d7a55d5e';
export const OMEGA_MODEL = 'OmegaEncoder::omega_embeddings_1_4';
const DEFAULT_ENDPOINT = 'https://platform.u1.archetypeai.app';

/**
 * The platform host, without a trailing /api (requests add /api/...). The old
 * v0.5 host (api.u1.archetypeai.app/v0.5) serves the session-based Lens API,
 * not /api/lens/query, so an old value falls back to the current host.
 */
export function endpoint(): string {
  const raw = (process.env.ATAI_API_ENDPOINT || DEFAULT_ENDPOINT).trim().replace(/\/+$/, '').replace(/\/api$/, '');
  if (/\/v0\.\d+$/.test(raw) || /\/\/api\.u1\./.test(raw)) {
    console.warn(`ATAI_API_ENDPOINT=${raw} is the old v0.5 API; using ${DEFAULT_ENDPOINT}`);
    return DEFAULT_ENDPOINT;
  }
  return raw;
}

export function keyFor(request: Request): string | null {
  const own = request.headers.get('x-atai-key')?.trim();
  if (own) return own;
  return process.env.ATAI_API_KEY || null;
}

export class AtaiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function query(key: string, body: Record<string, unknown>, timeoutMs = 60_000): Promise<unknown> {
  const res = await fetch(`${endpoint()}/api/lens/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 401 || res.status === 403) throw new AtaiError('Archetype AI rejected that key.', 401);
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    throw new AtaiError(`Archetype AI ${res.status}: ${text}`, 502);
  }
  const data = (await res.json()) as { response?: { response?: unknown } };
  return data.response?.response;
}

/** One channel, one window -> its 768-d embedding. */
export async function embed(key: string, series: number[]): Promise<number[]> {
  const out = await query(key, {
    query: '',
    model: OMEGA_MODEL,
    normalize_input: false,
    events: [{ type: 'data.numeric_array', event_data: { contents: [series] } }],
  }, 30_000);
  if (!Array.isArray(out) || typeof out[0] !== 'number') throw new AtaiError('Unexpected embedding shape from Omega.', 502);
  return out as number[];
}

/** Answer a question about the session from chart images plus a text summary. */
export async function ask(key: string, question: string, summary: string, imagesPng: string[]): Promise<string> {
  const out = await query(key, {
    query: `${question}\n\nCurrent readings:\n${summary}`,
    instruction_prompt:
      'You are Newton, reading a heart rate variability (HRV) dashboard for the person wearing the sensor. ' +
      'The images are their charts: heart rate, beat-to-beat (RR) intervals, HRV (RMSSD) and stress probability over the same timeline; ' +
      'dashed grey marks are sensor glitches that were removed. Answer in at most 120 words, plainly and kindly, ' +
      'pointing to what in the charts supports your answer. This is not medical advice; say so if they ask about health conditions. ' +
      'Plain text only, no markdown headings.',
    file_ids: [],
    model: FUSION_MODEL,
    max_new_tokens: 300,
    // Several images are independent charts (multi-image mode); without the flag
    // a list of images would be read as frames of one video.
    ...(imagesPng.length > 1 ? { multi_image: true } : {}),
    events: imagesPng.map((contents) => ({ type: 'data.base64_img', event_data: { contents, mime_type: 'image/png' } })),
  }, 120_000);
  // The fusion model returns its text as a one-item list.
  const text = Array.isArray(out) ? out.filter((x) => typeof x === 'string').join('\n') : out;
  if (typeof text !== 'string' || !text.trim()) throw new AtaiError('Newton returned no answer.', 502);
  return text.replace(/^```\w*\n?|```$/g, '').trim();
}
