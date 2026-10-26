// GET /api/newton/status -> whether this server has its own Newton key.
// Without one, visitors can still use Newton with their own key.
export function GET() {
  return Response.json({ serverKey: !!process.env.ATAI_API_KEY }, { headers: { 'Cache-Control': 'no-store' } });
}
