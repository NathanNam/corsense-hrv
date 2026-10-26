// POST /api/newton/ask { question, summary, images: [base64 png] } -> { answer }
import { ask } from '../../../../lib/atai';
import { handle } from '../http';

export const maxDuration = 120;

export function POST(request: Request) {
  return handle(request, 6_000_000, async (key, body) => {
    const question = String(body.question ?? '').trim().slice(0, 500);
    const summary = String(body.summary ?? '').slice(0, 2000);
    const images = Array.isArray(body.images) ? body.images.filter((x): x is string => typeof x === 'string').slice(0, 4) : [];
    if (!question) throw new Error('Ask a question.');
    return { answer: await ask(key, question, summary, images) };
  });
}
