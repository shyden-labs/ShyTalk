/**
 * ShyTalk's one way to send mail (shyden-labs/ShyTalk#88,
 * docs/superpowers/specs/2026-11-08-email-sender-design.md): one signed
 * SubmitEmail POST to Oracle Email Delivery in this environment's region
 * (`MAIL_REGION`), as its one approved sender (`MAIL_FROM`), with its own
 * Oracle user's key. A failure is answered, never thrown, and named by its
 * reason; no retry. Every call writes one audit row holding neither the
 * address, nor the subject, nor the body: the audit table keeps rows for ever,
 * and the address is personal data the privacy policy promises to delete.
 */
import { checkMessage, resultFor, type MailMessage, type MailResult } from '../../../packages/mail/index.ts';
import { importKey, signRequest } from '../../../packages/mail/sign.ts';
import { audit, type AuditDatabase, type AuditEnv } from './audit.ts';

export interface MailEnv extends AuditEnv {
  DB: AuditDatabase<unknown> & { batch(statements: unknown[]): Promise<unknown> };
  /** Oracle's region for this environment (a var): live `ap-singapore-1`, dev and test `uk-london-1`. */
  MAIL_REGION?: string | undefined;
  /** The approved sender this environment's Oracle user may send as (a var). */
  MAIL_FROM?: string | undefined;
  /** The Oracle tenancy, user, key fingerprint, PKCS#8 private key and compartment (Wrangler secrets). */
  OCI_TENANCY?: string | undefined;
  OCI_USER?: string | undefined;
  OCI_FINGERPRINT?: string | undefined;
  OCI_PRIVATE_KEY?: string | undefined;
  OCI_COMPARTMENT?: string | undefined;
}

const UNAVAILABLE: MailResult = { ok: false, reason: 'unavailable' };

/** The region's SubmitEmail address. */
export function mailEndpoint(region: string): URL {
  return new URL(`https://cell0.submit.email.${region}.oci.oraclecloud.com/20220926/actions/submitEmail`);
}

async function submit(env: MailEnv, message: MailMessage, now: Date): Promise<MailResult> {
  const { MAIL_REGION, MAIL_FROM, OCI_TENANCY, OCI_USER, OCI_FINGERPRINT, OCI_PRIVATE_KEY, OCI_COMPARTMENT } = env;
  if (!MAIL_REGION || !MAIL_FROM || !OCI_TENANCY || !OCI_USER || !OCI_FINGERPRINT || !OCI_PRIVATE_KEY || !OCI_COMPARTMENT)
    return UNAVAILABLE;
  const privateKey = await importKey(OCI_PRIVATE_KEY);
  if (privateKey === null) return UNAVAILABLE;

  const url = mailEndpoint(MAIL_REGION);
  const body = JSON.stringify({
    sender: { senderAddress: { email: MAIL_FROM, name: 'ShyTalk' }, compartmentId: OCI_COMPARTMENT },
    recipients: { to: [{ email: message.to }] },
    subject: message.subject,
    bodyText: message.text,
    ...(message.html === undefined ? {} : { bodyHtml: message.html }),
  });
  const headers = await signRequest(url, body, { tenancy: OCI_TENANCY, user: OCI_USER, fingerprint: OCI_FINGERPRINT, privateKey }, now);
  try {
    const response = await fetch(new Request(url, { method: 'POST', headers, body }));
    return resultFor(response.status, await response.json(), message.to);
  } catch {
    return UNAVAILABLE;
  }
}

/** Sends `message` from this environment's sender and audits the outcome. */
export async function sendMail(env: MailEnv, message: MailMessage, now: () => Date = () => new Date()): Promise<MailResult> {
  const checked = checkMessage(message);
  const result: MailResult = checked === null ? { ok: false, reason: 'invalid' } : await submit(env, checked, now());

  const detail = result.ok
    ? { messageId: result.messageId }
    : {
        reason: result.reason,
        ...(result.status === undefined ? {} : { status: result.status }),
        ...(result.error === undefined ? {} : { error: result.error }),
      };
  await env.DB.batch([audit(env, { actor: 'system', action: result.ok ? 'mail.sent' : 'mail.failed', detail })]);
  return result;
}
