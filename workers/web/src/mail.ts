/**
 * ShyTalk's one way to send mail (shyden-labs/ShyTalk#88,
 * docs/superpowers/specs/2026-11-08-email-sender-design.md). PROD sends with
 * its own `send_email` binding as no-reply@shytalk.app. TEST and DEV run in the
 * Non-Prod account, where no ShyTalk sending domain can live, so they post to
 * their door's mail route (`workers/door/src/mail.ts`). A failure is answered,
 * never thrown, and named by its reason; no retry. Every call writes one audit
 * row holding neither the address, nor the subject, nor the body: the audit
 * table keeps rows for ever, and the address is personal data the privacy
 * policy promises to delete.
 */
import {
  checkMessage,
  failureFor,
  DOOR_MAIL_PATH,
  MAIL_SECRET_HEADER,
  type EmailSender,
  type MailMessage,
  type MailReason,
  type MailResult,
} from '../../../packages/mail/index.ts';
import { audit, type AuditDatabase, type AuditEnv } from './audit.ts';

export const LIVE_MAIL_FROM = 'no-reply@shytalk.app';

export interface MailEnv extends AuditEnv {
  DB: AuditDatabase<unknown> & { batch(statements: unknown[]): Promise<unknown> };
  /** PROD only: the binding locked to LIVE_MAIL_FROM (wrangler.json). */
  EMAIL?: EmailSender | undefined;
  /** TEST and DEV: the door that sends for them is at this origin. */
  SITE_ORIGIN?: string | undefined;
  /** TEST and DEV: the secret their door's mail route requires. */
  MAIL_SECRET?: string | undefined;
}

const UNAVAILABLE: MailResult = { ok: false, reason: 'unavailable' };

const REASONS: ReadonlySet<MailReason> = new Set<MailReason>([
  'rate-limit',
  'daily-limit',
  'suppressed',
  'sender-not-verified',
  'delivery-failed',
  'suspended',
  'unavailable',
  'invalid',
  'unknown',
]);

/** The door's answer as a result, or `null` when it is not one. */
function doorResult(body: unknown): MailResult | null {
  if (typeof body !== 'object' || body === null) return null;
  const { ok, messageId, reason, error } = body as Record<string, unknown>;
  if (ok === true && typeof messageId === 'string' && messageId !== '') return { ok: true, messageId };
  if (ok !== false || typeof reason !== 'string' || !REASONS.has(reason as MailReason)) return null;
  return typeof error === 'string' ? { ok: false, reason: reason as MailReason, error } : { ok: false, reason: reason as MailReason };
}

async function viaBinding(env: MailEnv, message: MailMessage): Promise<MailResult> {
  if (!env.EMAIL) return UNAVAILABLE;
  try {
    const { messageId } = await env.EMAIL.send({ ...message, from: LIVE_MAIL_FROM });
    return { ok: true, messageId };
  } catch (error) {
    return failureFor(error);
  }
}

async function viaDoor(env: MailEnv, message: MailMessage): Promise<MailResult> {
  if (!env.SITE_ORIGIN || !env.MAIL_SECRET) return UNAVAILABLE;
  try {
    const response = await fetch(
      new Request(new URL(DOOR_MAIL_PATH, env.SITE_ORIGIN), {
        method: 'POST',
        headers: { 'content-type': 'application/json', [MAIL_SECRET_HEADER]: env.MAIL_SECRET },
        body: JSON.stringify(message),
      }),
    );
    return doorResult(await response.json()) ?? UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}

/** Sends `message` from this environment's sender and audits the outcome. */
export async function sendMail(env: MailEnv, message: MailMessage): Promise<MailResult> {
  const checked = checkMessage(message);
  let result: MailResult;
  if (checked === null) result = { ok: false, reason: 'invalid' };
  else result = env.ENVIRONMENT_NAME === 'prod' ? await viaBinding(env, checked) : await viaDoor(env, checked);

  const detail = result.ok
    ? { messageId: result.messageId }
    : { reason: result.reason, ...(result.error === undefined ? {} : { error: result.error }) };
  await env.DB.batch([audit(env, { actor: 'system', action: result.ok ? 'mail.sent' : 'mail.failed', detail })]);
  return result;
}
