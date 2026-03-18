import { NextResponse } from 'next/server';
import { newtonStream } from '../../../../../lib/newton-stream';

export async function POST() {
  const apiKey = process.env.ATAI_API_KEY;
  const endpoint = process.env.ATAI_API_ENDPOINT;

  if (!apiKey || !endpoint) {
    return NextResponse.json({ error: 'Newton is not configured' }, { status: 503 });
  }

  newtonStream.start();
  return NextResponse.json({ ok: true });
}
