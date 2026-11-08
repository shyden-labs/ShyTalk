/**
 * ShyTalk's mail, shared by the site Worker and the doors
 * (shyden-labs/ShyTalk#88, docs/superpowers/specs/2026-11-08-email-sender-design.md).
 * `checkMessage` decides what may be sent; `failureFor` names a send failure
 * from Cloudflare's error code alone, never from its message, which may echo
 * the address or the body. See README.md.
 */

export type MailReason =
  | 'rate-limit'
  | 'daily-limit'
  | 'suppressed'
  | 'sender-not-verified'
  | 'delivery-failed'
  | 'suspended'
  | 'unavailable'
  | 'invalid'
  | 'unknown';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export type MailFailure = { ok: false; reason: MailReason; error?: string };
export type MailResult = { ok: true; messageId: string } | MailFailure;

/** The part of a Workers `send_email` binding ShyTalk uses. */
export interface EmailSender {
  send(message: MailMessage & { from: string }): Promise<{ messageId: string }>;
}

/** The door's mail route, and the header carrying that environment's mail secret. */
export const DOOR_MAIL_PATH = '/__door/mail';
export const MAIL_SECRET_HEADER = 'x-shytalk-mail-secret';

/** The largest message, as JSON, either side accepts: a code or a confirmation is far smaller. */
export const MAIL_MAX_BYTES = 65536;

const REASONS: Record<string, MailReason> = {
  E_RATE_LIMIT_EXCEEDED: 'rate-limit',
  E_DAILY_LIMIT_EXCEEDED: 'daily-limit',
  E_RECIPIENT_SUPPRESSED: 'suppressed',
  E_SENDER_NOT_VERIFIED: 'sender-not-verified',
  E_DELIVERY_FAILED: 'delivery-failed',
  E_ACCOUNT_SUSPENDED: 'suspended',
  E_INTERNAL_SERVER_ERROR: 'unavailable',
};

const ERROR_CODE = /^E_[A-Z_]+$/;

/** The failure for whatever a send threw: its `E_*` code's reason, else `unknown`. */
export function failureFor(error: unknown): MailFailure {
  const code: unknown = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (typeof code !== 'string' || !ERROR_CODE.test(code)) return { ok: false, reason: 'unknown' };
  return { ok: false, reason: REASONS[code] ?? 'unknown', error: code };
}

/** One bare address: no list, no display name, no spaces. */
const ADDRESS = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
const MAX_ADDRESS = 254;
const MAX_SUBJECT = 200;

const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** The message to send, holding only its four fields, or `null` when it must not be sent. */
export function checkMessage(value: unknown): MailMessage | null {
  if (typeof value !== 'object' || value === null) return null;
  const { to, subject, text, html } = value as Record<string, unknown>;
  if (!isText(to) || to.length > MAX_ADDRESS || !ADDRESS.test(to)) return null;
  if (!isText(subject) || subject.length > MAX_SUBJECT || /[\r\n]/.test(subject)) return null;
  if (!isText(text)) return null;
  if (html !== undefined && typeof html !== 'string') return null;
  const message: MailMessage = html === undefined ? { to, subject, text } : { to, subject, text, html };
  if (new TextEncoder().encode(JSON.stringify(message)).length > MAIL_MAX_BYTES) return null;
  return message;
}
