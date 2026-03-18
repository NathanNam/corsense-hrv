import { NextRequest, NextResponse } from 'next/server';
import { newtonStream } from '../../../../../lib/newton-stream';

export async function POST(request: NextRequest) {
  let body: { rrIntervals: number[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!body.rrIntervals?.length) {
    return NextResponse.json({ error: 'rrIntervals required' }, { status: 400 });
  }

  newtonStream.addRR(body.rrIntervals);
  return NextResponse.json({ ok: true, buffered: body.rrIntervals.length });
}
