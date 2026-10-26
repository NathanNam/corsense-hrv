import { AtaiError, keyFor } from '../../../lib/atai';

/** JSON in, JSON out, never cached; the visitor's key is never logged or echoed. */
export async function handle(request: Request, maxBytes: number, run: (key: string, body: Record<string, unknown>) => Promise<unknown>) {
  const headers = { 'Cache-Control': 'no-store' };
  const key = keyFor(request);
  if (!key) return Response.json({ error: 'Add your Archetype AI key to use Newton.' }, { status: 401, headers });
  const text = await request.text();
  if (text.length > maxBytes) return Response.json({ error: 'Request too large.' }, { status: 413, headers });
  let body: Record<string, unknown>;
  try { body = JSON.parse(text); } catch { return Response.json({ error: 'Send JSON.' }, { status: 400, headers }); }
  try {
    return Response.json(await run(key, body), { headers });
  } catch (e) {
    const status = e instanceof AtaiError ? e.status : 400;
    console.error('newton:', e instanceof Error ? e.message : e);
    return Response.json({ error: e instanceof Error ? e.message : 'Newton failed.' }, { status, headers });
  }
}
