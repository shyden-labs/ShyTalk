/**
 * The roadmap's two public addresses (shyden-labs/ShyTalk#321 AC3 and AC4), as Yawelo Idle serves its own:
 * `GET /api/roadmap.json` answers the Durable Object's snapshot at once, never cached, and `/api/roadmap/live` hands a
 * WebSocket upgrade to it, which then pushes each new read. What the object answers is public by construction
 * (snapshot.ts); nothing here adds to it.
 */
import { json } from '../http.ts';
import type { RoadmapNamespace } from './hook-route.ts';

export const ROADMAP_JSON = '/api/roadmap.json';
export const ROADMAP_LIVE = '/api/roadmap/live';

export const isRoadmapApi = (pathname: string): boolean => pathname === ROADMAP_JSON || pathname === ROADMAP_LIVE;

export async function handleRoadmapApi(request: Request, env: { ROADMAP?: RoadmapNamespace }): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === ROADMAP_JSON && request.method !== 'GET') {
    const answer = json(405, { error: 'method_not_allowed' });
    answer.headers.set('allow', 'GET');
    return answer;
  }
  if (pathname === ROADMAP_LIVE && request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return json(400, { error: 'websocket_required' });
  }
  if (!env.ROADMAP) return json(503, { error: 'roadmap_unavailable' });
  const stub = env.ROADMAP.get(env.ROADMAP.idFromName('roadmap') as never);
  if (pathname === ROADMAP_LIVE) return stub.fetch(new Request('https://roadmap/connect', { headers: request.headers }));
  const answer = await stub.fetch(new Request('https://roadmap/snapshot'));
  const served = new Response(answer.body, answer);
  served.headers.set('cache-control', 'no-store');
  return served;
}
