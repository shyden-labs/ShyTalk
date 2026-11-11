/**
 * Email codes (plan 6, shyden-labs/ShyTalk#133,
 * docs/superpowers/specs/2026-11-11-email-code-sign-up-recovery-design.md):
 * `POST /api/app/email/start {email, purpose, locale?}` mails a code for a
 * sign-up or a recovery. Known and unknown addresses get the same reply, no
 * sooner than `START_ANSWER_FLOOR_MS`, as the closed-testing form does. No
 * address or code is stored plain.
 */
import { LOCALES, localePath, t, type Locale } from '../../../../apps/web/src/i18n/t.ts';
import type { MailMessage, MailResult } from '../../../../packages/mail/index.ts';
import type { AuthEnv } from '../auth/better-auth.ts';
import { audit, auditIfChanged, type AuditDatabase } from '../audit.ts';
import { json } from '../http.ts';
import { pause } from '../api/closed-testing.ts';
import { sendMail, type MailEnv } from '../mail.ts';
import {
  CODE_TTL_MS,
  LIMIT_15_MIN,
  LIMIT_24_H,
  MAX_WRONG_TRIES,
  RECOVERY_LAPSE_MS,
  RECOVERY_WAIT_MS,
  SIGN_UP_TTL_MS,
  addressHash,
  codeHash,
  newCode,
  newToken,
  normaliseAddress,
  tokenHash,
} from './email-code.ts';
import type { RateLimit } from './sign-in.ts';

/** D1 answers every statement of a batch with its rows (empty for a write) and what it changed. */
interface D1Answer {
  meta: { changes: number };
  results: unknown[];
}

export interface EmailEnv extends MailEnv, AuthEnv {
  DB: AuditDatabase<unknown> & { batch(statements: unknown[]): Promise<D1Answer[]> };
  SIGN_IN_LIMIT: RateLimit;
}

/** The clock, the pause, the sender, the code and the token: `emailDeps` in production, stood in by the tests. */
export interface EmailDeps {
  now: () => number;
  pause: (ms: number) => Promise<void>;
  send: (message: MailMessage) => Promise<MailResult>;
  code: () => string;
  token: () => string;
}

/** What the routes use in production. */
export function emailDeps(env: EmailEnv): EmailDeps {
  return { now: Date.now, pause, send: sendMail.bind(null, env), code: newCode, token: newToken };
}

export type Purpose = 'sign-up' | 'recovery';

/** Every start answers no sooner than this, so whether a mail was due cannot be timed. */
export const START_ANSWER_FLOOR_MS = 3_000;

const FIFTEEN_MINUTES = 15 * 60_000;
const DAY = 24 * 3_600_000;

/** Every address's send rows past 24 hours and every code past its life go on each start, so an address never used again keeps nothing. */
const PRUNE_SENDS_SQL = 'DELETE FROM email_send WHERE at < ?';
const PRUNE_CODES_SQL = 'DELETE FROM email_code WHERE expires_at < ?';
const PRUNE_TOKENS_SQL = 'DELETE FROM one_time_token WHERE expires_at < ?';
/** Claims a send unless the address is at either limit: what it changes says whether to go on, so starts at one moment cannot pass the limit together. */
const CLAIM_SEND_SQL = `INSERT INTO email_send (address_hash, at) SELECT ?, ?
  WHERE (SELECT COUNT(*) FROM email_send WHERE address_hash = ? AND at >= ?) < ?
  AND (SELECT COUNT(*) FROM email_send WHERE address_hash = ? AND at >= ?) < ?`;
const USER_SQL = 'SELECT id FROM "user" WHERE email = ?';
const DROP_CODE_SQL = 'DELETE FROM email_code WHERE address_hash = ? AND purpose = ?';
const STORE_CODE_SQL = 'INSERT INTO email_code (address_hash, purpose, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)';

const methodNotAllowed = (): Response => new Response(null, { status: 405, headers: { allow: 'POST' } });
const badRequest = (): Response => json(400, { error: 'bad_request' });

/** The JSON object a request carries, or null. Any other type is one a form on another site could send without a preflight. */
export async function objectBody(request: Request): Promise<Record<string, unknown> | null> {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return null;
  try {
    const body: unknown = await request.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface Start {
  email: string;
  purpose: Purpose;
  locale: Locale;
}

function startFrom(body: Record<string, unknown> | null): Start | null {
  if (body === null) return null;
  const email = normaliseAddress(body['email']);
  const { purpose, locale = 'en' } = body;
  if (email === null || (purpose !== 'sign-up' && purpose !== 'recovery') || !LOCALES.includes(locale as Locale)) return null;
  return { email, purpose, locale: locale as Locale };
}

function codeMail({ email, purpose, locale }: Start, code: string): MailMessage {
  const line = (key: string): string => t(locale, `email.${key}`);
  return {
    to: email,
    subject: line('codeSubject'),
    text: [line(purpose === 'sign-up' ? 'signUpIntro' : 'recoveryIntro'), '', code, '', line('codeLife'), line('ignore')].join('\n'),
  };
}

function existsMail({ email, locale }: Start, origin: string): MailMessage {
  const line = (key: string): string => t(locale, `email.${key}`);
  return {
    to: email,
    subject: line('existsSubject'),
    text: [line('existsBody'), '', line('existsRecover'), `${origin}${localePath(locale, '/recover/')}`].join('\n'),
  };
}

export async function handleEmailStart(request: Request, env: EmailEnv, deps: EmailDeps): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed();
  const { success } = await env.SIGN_IN_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') ?? 'unknown' });
  if (!success) return json(429, { error: 'slow_down' });
  const start = startFrom(await objectBody(request));
  if (start === null) return badRequest();

  const { now } = deps;
  const started = now();
  const answerAfterFloor = async (status: number, body: unknown): Promise<Response> => {
    const left = START_ANSWER_FLOOR_MS - (now() - started);
    // Only an answer sooner than the floor waits; a slow send is already past it.
    if (left > 0) await deps.pause(left);
    return json(status, body);
  };

  const { DB } = env;
  const hash = await addressHash(env.BETTER_AUTH_SECRET, start.email);
  const answers = await DB.batch([
    DB.prepare(PRUNE_SENDS_SQL).bind(started - DAY),
    DB.prepare(PRUNE_CODES_SQL).bind(started),
    DB.prepare(PRUNE_TOKENS_SQL).bind(started),
    DB.prepare(CLAIM_SEND_SQL).bind(hash, started, hash, started - FIFTEEN_MINUTES, LIMIT_15_MIN, hash, started - DAY, LIMIT_24_H),
    DB.prepare(USER_SQL).bind(start.email),
  ]);
  if ((answers[3] as D1Answer).meta.changes === 0) return answerAfterFloor(429, { error: 'slow_down' });
  const hasAccount = (answers[4] as D1Answer).results.length > 0;

  let message: MailMessage | null = null;
  if (start.purpose === 'sign-up' && hasAccount) message = existsMail(start, env.SITE_ORIGIN);
  else if (start.purpose === 'sign-up' || hasAccount) {
    const code = deps.code();
    await DB.batch([
      DB.prepare(DROP_CODE_SQL).bind(hash, start.purpose),
      DB.prepare(STORE_CODE_SQL).bind(
        hash,
        start.purpose,
        await codeHash(env.BETTER_AUTH_SECRET, hash, code),
        started + CODE_TTL_MS,
        started,
      ),
    ]);
    message = codeMail(start, code);
  }
  if (message === null) return answerAfterFloor(202, { sent: true });

  const sent = await deps.send(message);
  return sent.ok ? answerAfterFloor(202, { sent: true }) : answerAfterFloor(502, { error: 'mail_failed' });
}

const PUBLIC = 'public';

const FIND_CODE_SQL = 'SELECT id, code_hash, expires_at, wrong_tries FROM email_code WHERE address_hash = ? AND purpose = ?';
const DROP_CODE_BY_ID_SQL = 'DELETE FROM email_code WHERE id = ?';
/** Every attempt, right or wrong, reserves a try before the guess is compared: verifies at one moment cannot pass the limit together. */
const RESERVE_TRY_SQL = 'UPDATE email_code SET wrong_tries = wrong_tries + 1 WHERE id = ? AND wrong_tries < ? AND expires_at >= ?';
const SPEND_WRONG_SQL = 'DELETE FROM email_code WHERE id = ? AND wrong_tries >= ?';
/** Spends the code only if it is still the one read: two verifies with one code succeed once. */
const SPEND_CODE_SQL = 'DELETE FROM email_code WHERE id = ? AND code_hash = ?';
const STORE_TOKEN_SQL = 'INSERT INTO one_time_token (token_hash, purpose, user_id, email, expires_at) VALUES (?, ?, ?, ?, ?)';
const SPEND_RECOVERY_TOKENS_SQL = "UPDATE one_time_token SET used_at = ? WHERE user_id = ? AND purpose = 'recovery' AND used_at IS NULL";
const PENDING_SQL = "SELECT id, started_at, completes_at FROM account_recovery WHERE user_id = ? AND state = 'pending'";
const LAPSE_SQL = "UPDATE account_recovery SET state = 'cancelled', ended_at = ? WHERE id = ? AND state = 'pending'";
const START_RECOVERY_SQL =
  "INSERT INTO account_recovery (user_id, started_at, completes_at, cancel_token_hash, state) VALUES (?, ?, ?, ?, 'pending')";

interface Verify {
  email: string;
  purpose: Purpose;
  code: string;
  locale: Locale;
}

function verifyFrom(body: Record<string, unknown> | null): Verify | null {
  const start = startFrom(body);
  const code = body?.['code'];
  if (start === null || typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  return { ...start, code };
}

interface LiveCode {
  id: number;
  code_hash: string;
  expires_at: number;
  wrong_tries: number;
}

interface Pending {
  id: number;
  started_at: number;
  completes_at: number;
}

/** A batch answer's first row, as the SELECT that made it shapes it. */
const firstRow = (answer: D1Answer | undefined): unknown => (answer as D1Answer).results[0];

const refused = (): Response => json(401, { error: 'code_refused' });

/** A UTC time a person can read in any language: `2026-11-12 03:00 UTC`. */
const readableUtc = (at: number): string => `${new Date(at).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

function recoveryMail({ email, locale }: Verify, origin: string, completesAt: number, cancelToken: string): MailMessage {
  const line = (key: string): string => t(locale, `email.${key}`);
  return {
    to: email,
    subject: line('recoveryStartedSubject'),
    text: [
      line('recoveryStartedBody').replace('{completesAt}', readableUtc(completesAt)),
      '',
      line('recoveryCancel'),
      `${origin}${localePath(locale, '/recover/cancel/')}#${cancelToken}`,
    ].join('\n'),
  };
}

/** Spends `live` if `code` is it, after reserving a try; a wrong code that used the last try spends it too. */
async function spend(env: EmailEnv, live: LiveCode, hash: string, code: string, now: number): Promise<boolean> {
  const { DB } = env;
  if (live.expires_at < now) {
    await DB.batch([DB.prepare(DROP_CODE_BY_ID_SQL).bind(live.id)]);
    return false;
  }
  const [reserved] = await DB.batch([DB.prepare(RESERVE_TRY_SQL).bind(live.id, MAX_WRONG_TRIES, now)]);
  if (reserved?.meta.changes !== 1) return false;
  if ((await codeHash(env.BETTER_AUTH_SECRET, hash, code)) !== live.code_hash) {
    await DB.batch([DB.prepare(SPEND_WRONG_SQL).bind(live.id, MAX_WRONG_TRIES)]);
    return false;
  }
  const [spent] = await DB.batch([DB.prepare(SPEND_CODE_SQL).bind(live.id, live.code_hash)]);
  return spent?.meta.changes === 1;
}

async function startRecovery(env: EmailEnv, verified: Verify, userId: string, now: number, deps: EmailDeps): Promise<Response> {
  const { DB } = env;
  const { token } = deps;
  const [found] = await DB.batch([DB.prepare(PENDING_SQL).bind(userId)]);
  const pending = firstRow(found) as Pending | undefined;
  const lapsed = pending !== undefined && now > pending.completes_at + RECOVERY_LAPSE_MS;

  if (pending !== undefined && !lapsed) {
    const recoveryToken = token();
    await DB.batch([
      DB.prepare(SPEND_RECOVERY_TOKENS_SQL).bind(now, userId),
      DB.prepare(STORE_TOKEN_SQL).bind(await tokenHash(recoveryToken), 'recovery', userId, null, pending.completes_at + RECOVERY_LAPSE_MS),
    ]);
    return json(200, { recoveryToken, completesAt: new Date(pending.completes_at).toISOString() });
  }

  const cancelToken = token();
  const recoveryToken = token();
  const completesAt = now + RECOVERY_WAIT_MS;
  const subject = `user:${userId}`;
  await DB.batch([
    ...(lapsed
      ? [DB.prepare(LAPSE_SQL).bind(now, pending.id), auditIfChanged(env, { actor: PUBLIC, action: 'recovery.lapse', subject })]
      : []),
    DB.prepare(START_RECOVERY_SQL).bind(userId, now, completesAt, await tokenHash(cancelToken)),
    audit(env, { actor: PUBLIC, action: 'recovery.start', subject, detail: { completesAt } }),
    DB.prepare(SPEND_RECOVERY_TOKENS_SQL).bind(now, userId),
    DB.prepare(STORE_TOKEN_SQL).bind(await tokenHash(recoveryToken), 'recovery', userId, null, completesAt + RECOVERY_LAPSE_MS),
  ]);
  // The recovery stands whether or not the notice went: its failure is audited by the sender.
  await deps.send(recoveryMail(verified, env.SITE_ORIGIN, completesAt, cancelToken));
  return json(200, { recoveryToken, completesAt: new Date(completesAt).toISOString() });
}

export async function handleEmailVerify(request: Request, env: EmailEnv, deps: EmailDeps): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed();
  const { success } = await env.SIGN_IN_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') ?? 'unknown' });
  if (!success) return json(429, { error: 'slow_down' });
  const verified = verifyFrom(await objectBody(request));
  if (verified === null) return badRequest();

  const now = deps.now();
  const { DB } = env;
  const hash = await addressHash(env.BETTER_AUTH_SECRET, verified.email);
  const answers = await DB.batch([
    DB.prepare(PRUNE_TOKENS_SQL).bind(now),
    DB.prepare(FIND_CODE_SQL).bind(hash, verified.purpose),
    DB.prepare(USER_SQL).bind(verified.email),
  ]);
  const live = firstRow(answers[1]) as LiveCode | undefined;
  if (live === undefined || !(await spend(env, live, hash, verified.code, now))) return refused();

  if (verified.purpose === 'sign-up') {
    const signUpToken = deps.token();
    await DB.batch([DB.prepare(STORE_TOKEN_SQL).bind(await tokenHash(signUpToken), 'sign-up', null, verified.email, now + SIGN_UP_TTL_MS)]);
    return json(200, { signUpToken });
  }
  const user = firstRow(answers[2]) as { id: string } | undefined;
  return user === undefined ? refused() : startRecovery(env, verified, user.id, now, deps);
}
