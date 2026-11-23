/**
 * The roadmap's GitHub webhook (shyden-labs/ShyTalk#321; after Yawelo Idle's worker/webhook.ts): an organisation
 * webhook POSTs `issues` and `projects_v2_item` events, signed with the environment's secret. Only a delivery whose
 * `X-Hub-Signature-256` matches is believed, and only an event about ShyTalk's own repository or board starts a
 * board read, because an organisation webhook delivers every repository's events.
 */

const PREFIX = 'sha256=';
const HEX = /^[0-9a-f]{64}$/u;

/**
 * Whether `header` (GitHub's `X-Hub-Signature-256`) signs `body` with `secret`. An empty secret refuses every
 * delivery, so a Worker deployed without its secret believes nothing.
 */
export async function verifySignature(secret: string, body: string, header: string | null): Promise<boolean> {
  if (secret === '' || header === null || !header.startsWith(PREFIX)) return false;
  const given = header.slice(PREFIX.length);
  if (!HEX.test(given)) return false;
  const signature = Uint8Array.from({ length: given.length / 2 }, (_, index) => Number.parseInt(given.slice(index * 2, index * 2 + 2), 16));
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  // WebCrypto's verify compares in constant time, so the answer's timing tells nothing of the signature.
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(body));
}

/** What the roadmap does with a verified delivery: answer a ping, read the board, or ignore it. */
export type Verdict = 'ping' | 'read' | 'ignore';

/** The repository and board whose events are ShyTalk's. */
export interface Ours {
  repo: string;
  boardId: string;
}

const field = (value: unknown, name: string): unknown =>
  typeof value === 'object' && value !== null && Object.hasOwn(value, name) ? (value as Record<string, unknown>)[name] : undefined;

/** A ping is answered; an issue event in ShyTalk's repository or a card event on its board starts a read; the rest are ignored. */
export function webhookVerdict(event: string, payload: unknown, ours: Ours): Verdict {
  if (event === 'ping') return 'ping';
  if (event === 'issues') return field(field(payload, 'repository'), 'full_name') === ours.repo ? 'read' : 'ignore';
  if (event === 'projects_v2_item')
    return field(field(payload, 'projects_v2_item'), 'project_node_id') === ours.boardId ? 'read' : 'ignore';
  return 'ignore';
}
