/**
 * `POST /hooks/github`, the roadmap's webhook address (shyden-labs/ShyTalk#321 AC1). GitHub can carry neither DEV's
 * password nor a DEV pass, so the site's router sends this address here after the door and before the password,
 * and the delivery's signature is its only guard. A believed event about ShyTalk's own repository or board tells
 * the roadmap's Durable Object that the board changed; the object does the read.
 */
import { json } from '../http.ts';
import { verifySignature, webhookVerdict, type Ours } from './webhook.ts';

export const HOOK_PATH = '/hooks/github';

/** ShyTalk's repository and its "ShyTalk Stories" board: only their events start a read. */
export const SHYTALK: Ours = { repo: 'shyden-labs/ShyTalk', boardId: 'PVT_kwDOEOcG584BpkXr' };

/** The roadmap Durable Object's namespace (same shape as the Announcer's). */
export interface RoadmapNamespace {
  idFromName(name: string): unknown;
  get(id: never): { fetch(request: Request): Promise<Response> };
}

export interface HookEnv {
  /** The organisation webhook's secret (a Wrangler secret); without it no delivery is believed. */
  ROADMAP_WEBHOOK_SECRET?: string;
  /** The roadmap's Durable Object; without it a believed change answers 503. */
  ROADMAP?: RoadmapNamespace;
}

function parsed(body: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false };
  }
}

export async function handleGithubHook(request: Request, env: HookEnv): Promise<Response> {
  if (request.method !== 'POST') {
    const answer = json(405, { error: 'method_not_allowed' });
    answer.headers.set('allow', 'POST');
    return answer;
  }
  const body = await request.text();
  const believed = await verifySignature(env.ROADMAP_WEBHOOK_SECRET ?? '', body, request.headers.get('x-hub-signature-256'));
  if (!believed) return json(401, { error: 'bad_signature' });
  const payload = parsed(body);
  if (!payload.ok) return json(400, { error: 'bad_payload' });
  // A delivery naming no event is no event the roadmap knows.
  const verdict = webhookVerdict(request.headers.get('x-github-event') ?? '', payload.value, SHYTALK);
  if (verdict === 'ping') return json(200, { state: 'pong' });
  if (verdict === 'ignore') return json(202, { state: 'ignored' });
  if (!env.ROADMAP) return json(503, { error: 'roadmap_unavailable' });
  const stub = env.ROADMAP.get(env.ROADMAP.idFromName('roadmap') as never);
  await stub.fetch(new Request('https://roadmap/changed', { method: 'POST' }));
  return json(202, { state: 'reading' });
}
