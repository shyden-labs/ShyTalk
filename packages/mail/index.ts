/**
 * ShyTalk's mail rules (shyden-labs/ShyTalk#88,
 * docs/superpowers/specs/2026-11-08-email-sender-design.md). `checkMessage`
 * decides what may be sent; `resultFor` and `failureFor` turn an Oracle Email
 * Delivery answer into a result from its HTTP status and `code` alone, never
 * from its `message`, which may echo the address. See README.md.
 */

export type MailReason =
  'invalid' | 'not-authenticated' | 'sender-not-approved' | 'too-large' | 'rate-limit' | 'suppressed' | 'unavailable' | 'unknown';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export type MailFailure = { ok: false; reason: MailReason; status?: number; error?: string };
export type MailResult = { ok: true; messageId: string } | MailFailure;

/** The largest message, as JSON, ShyTalk sends: a code or a confirmation is far smaller. */
export const MAIL_MAX_BYTES = 65536;

/** Oracle's API Errors page: the statuses SubmitEmail can answer, by what they mean. */
const REASONS: Record<number, MailReason> = {
  400: 'invalid',
  401: 'not-authenticated',
  404: 'sender-not-approved',
  413: 'too-large',
  429: 'rate-limit',
  500: 'unavailable',
  503: 'unavailable',
};

const ERROR_CODE = /^[A-Za-z]+$/;

const field = (body: unknown, name: string): unknown =>
  typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[name] : undefined;

/** The failure for a refused send: its status's reason, keeping Oracle's `code` when it is a plain word. */
export function failureFor(status: number, body: unknown): MailFailure {
  const failure: MailFailure = { ok: false, reason: REASONS[status] ?? 'unknown', status };
  const code = field(body, 'code');
  return typeof code === 'string' && ERROR_CODE.test(code) ? { ...failure, error: code } : failure;
}

/** The result of a SubmitEmail answer for the one recipient `to`. */
export function resultFor(status: number, body: unknown, to: string): MailResult {
  if (status !== 200) return failureFor(status, body);
  const messageId = field(body, 'messageId');
  if (typeof messageId !== 'string' || messageId === '') return { ok: false, reason: 'unavailable', status };
  const suppressed = field(body, 'suppressedRecipients');
  const named = Array.isArray(suppressed) && suppressed.some((entry) => String(field(entry, 'email')).toLowerCase() === to.toLowerCase());
  return named ? { ok: false, reason: 'suppressed', status } : { ok: true, messageId };
}

/** One bare ASCII address: no list, no display name, no spaces (Oracle: `email` is ASCII only). */
const ADDRESS = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
const ASCII = /^[\x21-\x7e]+$/;
const MAX_ADDRESS = 254;
const MAX_SUBJECT = 200;

const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** The message to send, holding only its four fields, or `null` when it must not be sent. */
export function checkMessage(value: unknown): MailMessage | null {
  if (typeof value !== 'object' || value === null) return null;
  const { to, subject, text, html } = value as Record<string, unknown>;
  if (!isText(to) || to.length > MAX_ADDRESS || !ASCII.test(to) || !ADDRESS.test(to)) return null;
  if (!isText(subject) || subject.length > MAX_SUBJECT || /[\r\n]/.test(subject)) return null;
  if (!isText(text)) return null;
  if (html !== undefined && typeof html !== 'string') return null;
  const message: MailMessage = html === undefined ? { to, subject, text } : { to, subject, text, html };
  if (new TextEncoder().encode(JSON.stringify(message)).length > MAIL_MAX_BYTES) return null;
  return message;
}
