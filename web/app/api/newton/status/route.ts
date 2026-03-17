import { NextResponse } from 'next/server';

export async function GET() {
  const available = !!(process.env.ATAI_API_KEY && process.env.ATAI_API_ENDPOINT);
  return NextResponse.json({ available });
}
