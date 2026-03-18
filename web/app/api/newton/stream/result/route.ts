import { NextResponse } from 'next/server';
import { newtonStream } from '../../../../../lib/newton-stream';

export async function GET() {
  return NextResponse.json({ result: newtonStream.latestResult });
}
