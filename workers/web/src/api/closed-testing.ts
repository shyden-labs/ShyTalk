/**
 * The closed-testing form's API (plan 3 Task 5, shyden-labs/ShyTalk#55; design
 * 3). `POST /api/closed-testing` applies; `POST /api/closed-testing/confirm`
 * confirms with the mailed token. The mail links to a page whose button makes
 * that POST, never to the POST itself: mail scanners open links, so opening one
 * must not confirm (Shyden's choice 2026-11-08).
 *
 * The answer never says whether an address is known: a known address answers
 * the same 202, after the same floor of time a send takes. A write that changes
 * nothing writes no audit row, and no row ever names the address, as the audit
 * table keeps rows for ever and the address must be deletable.
 */
import { LOCALES, localePath, t, type Locale } from '../../../../apps/web/src/i18n/t.ts';
import { checkMessage, type MailMessage, type MailResult } from '../../../../packages/mail/index.ts';
import type { RateLimit } from '../app/sign-in.ts';
import { auditIfChanged, type AuditDatabase } from '../audit.ts';
import { json } from '../http.ts';
import { sendMail, type MailEnv } from '../mail.ts';

interface D1Answer {
  meta: { changes: number };
}

export interface ClosedTestingEnv extends MailEnv {
  DB: AuditDatabase<unknown> & { batch(statements: unknown[]): Promise<D1Answer[]> };
  /** The site's address, which the mailed link starts with (a var). */
  SITE_ORIGIN?: string | undefined;
  /** Applications per IP (wrangler.json `ratelimits`). */
  APPLY_LIMIT?: RateLimit | undefined;
}

/** What the tests stand in: the clock, the pause, the sender and the token. */
export interface ClosedTestingDeps {
  now?: () => number;
  pause?: (ms: number) => Promise<void>;
  send?: (message: MailMessage) => Promise<MailResult>;
  token?: () => string;
}

const APPLY = '/api/closed-testing';
const CONFIRM = `${APPLY}/confirm`;

/** Every application answers no sooner than this, so a known address takes as long as a send. */
export const ANSWER_FLOOR_MS = 3_000;
/** No second mail to an address within this long of the last. */
export const RESEND_WINDOW_MS = 10 * 60_000;
/** An unconfirmed sign-up, and so its link, lasts this long (design 3 item 4). */
export const UNCONFIRMED_LIFE_MS = 48 * 3_600_000;

const STATEMENTS = ['noAccess', 'moreDetails', 'safeList', 'removed', 'retention'] as const;

const PUBLIC = 'public';

const EXPIRE_SQL = 'DELETE FROM applicants WHERE confirmed_at IS NULL AND applied_at < ?';
/**
 * Takes the address and claims its send in one write, unless it is confirmed or
 * was claimed within the window: what it changes says whether to send, so
 * applications at the same moment send one mail, however long the sender takes.
 */
const APPLY_SQL = `INSERT INTO applicants (email, locale, applied_at, confirm_sent_at, confirm_hash) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (email) DO UPDATE SET locale = excluded.locale, applied_at = excluded.applied_at,
    confirm_sent_at = excluded.confirm_sent_at, confirm_hash = excluded.confirm_hash
  WHERE confirmed_at IS NULL AND (confirm_sent_at IS NULL OR confirm_sent_at < ?)`;
/** A failed send gives its claim back, unless a later application has since made its own. */
const RELEASE_SQL = 'UPDATE applicants SET confirm_sent_at = NULL WHERE email = ? AND confirm_hash = ?';
/** Clearing the hash makes the token work once, however many confirms arrive together. */
const CONFIRM_SQL = 'UPDATE applicants SET confirmed_at = ?, confirm_hash = NULL WHERE confirm_hash = ? AND confirmed_at IS NULL';

export const isClosedTesting = (pathname: string): boolean => pathname === APPLY || pathname.startsWith(`${APPLY}/`);

/** 32 random bytes as base64url. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** SHA-256 as hex: only this is ever stored. */
export async function hashToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function bodyOf(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface Application {
  email: string;
  locale: Locale;
}

/** The application with its address normalised, or null when it must be refused. */
function applicationFrom(body: Record<string, unknown> | null): Application | null {
  if (body === null || body['adult'] !== true) return null;
  const { email, locale } = body;
  if (typeof email !== 'string' || !LOCALES.includes(locale as Locale)) return null;
  const normalised = email.trim().toLowerCase();
  if (checkMessage({ to: normalised, subject: '-', text: '-' }) === null) return null;
  return { email: normalised, locale: locale as Locale };
}

function confirmMail({ email, locale }: Application, origin: string, token: string): MailMessage {
  const line = (key: string): string => t(locale, `closedTesting.${key}`);
  const link = `${origin}${localePath(locale, '/closed-testing/confirm')}?t=${token}`;
  return {
    to: email,
    subject: line('mailSubject'),
    text: [line('mailIntro'), link, '', ...STATEMENTS.map(line), '', line('mailIgnore')].join('\n'),
  };
}

const changed = (answers: D1Answer[], index: number): boolean => (answers[index] as D1Answer).meta.changes > 0;

async function apply(request: Request, env: ClosedTestingEnv, deps: ClosedTestingDeps): Promise<Response> {
  const { APPLY_LIMIT, SITE_ORIGIN } = env;
  if (APPLY_LIMIT === undefined || !SITE_ORIGIN) return json(503, { state: 'send_failed' });
  const { success } = await APPLY_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') ?? 'unknown' });
  if (!success) return json(429, { state: 'slow_down' });

  // Any other type is one a form on another site could send without a preflight, which this Worker never grants.
  const isJson = request.headers.get('content-type')?.split(';')[0] === 'application/json';
  const application = isJson ? applicationFrom(await bodyOf(request)) : null;
  if (application === null) return json(400, { state: 'invalid' });

  const now = deps.now ?? Date.now;
  const started = now();
  const answerAfterFloor = async (status: number, state: string): Promise<Response> => {
    const left = ANSWER_FLOOR_MS - (now() - started);
    if (left > 0) await (deps.pause ?? pause)(left);
    return json(status, { state });
  };

  const { email, locale } = application;
  const token = (deps.token ?? newToken)();
  const hash = await hashToken(token);
  const { DB } = env;
  const answers = await DB.batch([
    DB.prepare(EXPIRE_SQL).bind(started - UNCONFIRMED_LIFE_MS),
    auditIfChanged(env, { actor: PUBLIC, action: 'applicant.expired' }),
    DB.prepare(APPLY_SQL).bind(email, locale, started, started, hash, started - RESEND_WINDOW_MS),
    auditIfChanged(env, { actor: PUBLIC, action: 'applicant.applied', detail: { language: locale } }),
  ]);
  if (!changed(answers, 2)) return answerAfterFloor(202, 'sent');

  const send = deps.send ?? ((message: MailMessage) => sendMail(env, message));
  const sent = await send(confirmMail(application, SITE_ORIGIN, token));
  if (sent.ok) return answerAfterFloor(202, 'sent');
  await DB.batch([DB.prepare(RELEASE_SQL).bind(email, hash), auditIfChanged(env, { actor: PUBLIC, action: 'applicant.send_failed' })]);
  return answerAfterFloor(503, 'send_failed');
}

async function confirm(request: Request, env: ClosedTestingEnv, deps: ClosedTestingDeps): Promise<Response> {
  const token = (await bodyOf(request))?.['t'];
  if (typeof token !== 'string' || token === '') return json(410, { state: 'expired' });

  const now = (deps.now ?? Date.now)();
  const { DB } = env;
  // The expiry runs first, so a token past its life finds no row.
  const answers = await DB.batch([
    DB.prepare(EXPIRE_SQL).bind(now - UNCONFIRMED_LIFE_MS),
    auditIfChanged(env, { actor: PUBLIC, action: 'applicant.expired' }),
    DB.prepare(CONFIRM_SQL).bind(now, await hashToken(token)),
    auditIfChanged(env, { actor: PUBLIC, action: 'applicant.confirmed' }),
  ]);
  return changed(answers, 2) ? json(200, { state: 'confirmed' }) : json(410, { state: 'expired' });
}

export async function handleClosedTesting(request: Request, env: ClosedTestingEnv, deps: ClosedTestingDeps = {}): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname !== APPLY && pathname !== CONFIRM) return json(404, { error: 'not_found' });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  return pathname === APPLY ? apply(request, env, deps) : confirm(request, env, deps);
}
