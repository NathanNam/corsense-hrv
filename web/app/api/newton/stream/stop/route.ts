import { NextResponse } from 'next/server';
import { newtonStream } from '../../../../../lib/newton-stream';

export async function POST() {
  newtonStream.stop();
  return NextResponse.json({ ok: true });
}
