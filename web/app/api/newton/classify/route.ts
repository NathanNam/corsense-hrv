// POST /api/newton/classify { rr: [ms, ...] } -> Newton's relaxed/stressed vote
import { classify, WINDOW } from '../../../../lib/omega-knn';
import { handle } from '../http';

export const maxDuration = 60;

export function POST(request: Request) {
  return handle(request, 20_000, async (key, body) => {
    const rr = Array.isArray(body.rr) ? body.rr.map(Number).filter((x) => x >= 300 && x <= 2000) : [];
    if (rr.length < WINDOW) throw new Error(`Need ${WINDOW} clean beats.`);
    return classify(key, rr.slice(-WINDOW));
  });
}
