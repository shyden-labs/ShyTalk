/**
 * ShyDesk's punishment callback (shyden-labs/ShyTalk#310 AC1; contract: shyden-labs/shydesk openapi/shydesk.v1.yaml,
 * sent 2026-11-22). ShyDesk POSTs JSON signed `ShyDesk-Signature: v1=<lowercase hex HMAC-SHA256 of timestamp + "." +
 * raw body>`, with `ShyDesk-Timestamp` in unix seconds. Only a signed delivery within 300 s, of a known type, for
 * ShyTalk, carrying every field it needs, is believed; each refusal names its error code. An empty secret refuses all.
 */

/** How far ShyDesk's timestamp may be from the Worker's clock, either way. */
export const SKEW_SECONDS = 300;

export interface PunishmentEvent {
  type: 'punishment.apply' | 'punishment.lift';
  punishmentId: string;
  subjectUserId: string;
  punishment: { key: string; label: string; durationSeconds: number | null };
  reportTicketId: string;
  /** Where the member appeals; on `punishment.apply` only. */
  appealUrl: string | null;
  issuedAt: string;
}

type Refusal =
  | { status: 400; error: 'bad_timestamp' | 'bad_payload' }
  | { status: 401; error: 'bad_signature' | 'stale_timestamp' }
  | { status: 422; error: 'unknown_type' | 'wrong_product' };

export type CallbackCheck = { ok: true; event: PunishmentEvent } | ({ ok: false } & Refusal);

const refuse = (refusal: Refusal): CallbackCheck => ({ ok: false, ...refusal });

/** Whether `header` is `v1=` and the hex HMAC of `timestamp.body` under `secret`, compared by WebCrypto in constant time. */
async function isSigned(secret: string, timestamp: string, body: string, header: string | null): Promise<boolean> {
  const hex = header?.startsWith('v1=') === true ? header.slice(3) : '';
  if (secret === '' || !/^[0-9a-f]{64}$/u.test(hex)) return false;
  const bytes = new Uint8Array(32);
  for (let at = 0; at < 32; at += 1) bytes[at] = Number.parseInt(hex.slice(at * 2, at * 2 + 2), 16);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, bytes, encoder.encode(`${timestamp}.${body}`));
}

/** A JSON object, or null for anything else. */
const objectOf = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** A non-empty string, or null. */
const word = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);

/** Seconds as a whole number of 0 or more, null for no end, or undefined when it is neither. */
function durationOf(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * ShyDesk's issue time, a whole number of Unix milliseconds (its PunishmentCallback schema, shyden-labs/ShyTalk#349),
 * as the ISO time stored; null when it is anything else or past what a date can hold.
 */
function issuedAtOf(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** On an apply, the appeal page ShyDesk names, which it leaves out when the product has none; an empty one is refused. */
function appealUrlOf(type: PunishmentEvent['type'], value: unknown): string | null | undefined {
  if (type !== 'punishment.apply' || value === undefined) return null;
  return word(value) ?? undefined;
}

function eventOf(type: PunishmentEvent['type'], body: Record<string, unknown>): PunishmentEvent | null {
  const punishment = objectOf(body['punishment']);
  const punishmentId = word(body['punishment_id']);
  const subjectUserId = word(body['subject_user_id']);
  const key = word(punishment?.['key']);
  const label = word(punishment?.['label']);
  const durationSeconds = durationOf(punishment?.['duration_seconds']);
  const reportTicketId = word(body['report_ticket_id']);
  const issuedAt = issuedAtOf(body['issued_at']);
  const appealUrl = appealUrlOf(type, body['appeal_url']);
  if (punishmentId === null || subjectUserId === null || key === null || label === null || durationSeconds === undefined) return null;
  if (reportTicketId === null || issuedAt === null || appealUrl === undefined) return null;
  return { type, punishmentId, subjectUserId, punishment: { key, label, durationSeconds }, reportTicketId, appealUrl, issuedAt };
}

/** The body as a JSON object, or null when it is not JSON or not an object. */
function payloadOf(body: string): Record<string, unknown> | null {
  try {
    return objectOf(JSON.parse(body));
  } catch {
    return null;
  }
}

/** Whether a delivery is believed at `now` (unix seconds), and the event it carries. */
export async function checkCallback(
  secret: string,
  timestamp: string | null,
  signature: string | null,
  body: string,
  now: number,
): Promise<CallbackCheck> {
  if (timestamp === null || !/^[0-9]+$/u.test(timestamp)) return refuse({ status: 400, error: 'bad_timestamp' });
  if (!(await isSigned(secret, timestamp, body, signature))) return refuse({ status: 401, error: 'bad_signature' });
  if (Math.abs(now - Number(timestamp)) > SKEW_SECONDS) return refuse({ status: 401, error: 'stale_timestamp' });
  const payload = payloadOf(body);
  if (payload === null) return refuse({ status: 400, error: 'bad_payload' });
  const type = payload['type'];
  if (type !== 'punishment.apply' && type !== 'punishment.lift') return refuse({ status: 422, error: 'unknown_type' });
  if (payload['product'] !== 'shytalk') return refuse({ status: 422, error: 'wrong_product' });
  const event = eventOf(type, payload);
  return event === null ? refuse({ status: 400, error: 'bad_payload' }) : { ok: true, event };
}
