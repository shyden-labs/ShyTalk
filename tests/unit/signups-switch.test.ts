import { describe, expect, it } from 'vitest';
import { signUpsOpen } from '../../workers/web/src/app/signups.ts';
import { handleEmailStart, type EmailDeps, type EmailEnv } from '../../workers/web/src/app/email-routes.ts';
import { setupIdentityByHash, type SetupEnv } from '../../workers/web/src/app/setup-identity.ts';
import { startMessage } from '../../apps/web/src/account/answers.ts';
import { LOCALES, t } from '../../apps/web/src/i18n/t.ts';

/**
 * The sign-up switch (shyden-labs/ShyTalk#314; Shyden 2026-11-27, "Setting in GitHub"): each environment's
 * SIGNUPS_OPEN, set at deploy, turns organic sign-ups off and on. With it off, starting a sign-up and finishing
 * one are both refused with `sign_ups_closed`, and recovery and sign-in keep working. D1, the sender and the
 * clock are stood in.
 */

const NOW = 1_800_000_000_000;

interface Recorded {
  sql: string;
  values: unknown[];
}

/** A D1 stand-in: the account lookup finds `userId` when given; every other statement changes one row. */
function database(userId?: string) {
  const statements: Recorded[] = [];
  const DB = {
    prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({ sql, values }) }),
    batch: (batch: unknown[]) => {
      statements.push(...(batch as Recorded[]));
      return Promise.resolve(
        (batch as Recorded[]).map(({ sql }) => {
          if (sql.startsWith('SELECT id FROM "user"'))
            return { meta: { changes: 0 }, results: userId === undefined ? [] : [{ id: userId }] };
          if (sql.startsWith('SELECT purpose'))
            return {
              meta: { changes: 0 },
              results: [{ purpose: 'sign-up', user_id: null, email: 'new@example.test', expires_at: NOW + 60_000, used_at: null }],
            };
          if (sql.startsWith('SELECT id, completes_at')) return { meta: { changes: 0 }, results: [{ id: 7, completes_at: NOW - 1 }] };
          if (sql.startsWith('SELECT user_id FROM one_time_token')) return { meta: { changes: 0 }, results: [{ user_id: 'u-new' }] };
          return { meta: { changes: 1 }, results: [] };
        }),
      );
    },
  };
  return { DB, statements };
}

function start(purpose: 'sign-up' | 'recovery', SIGNUPS_OPEN: string | undefined, userId?: string) {
  const { DB, statements } = database(userId);
  const mails: unknown[] = [];
  const env = {
    ENVIRONMENT_NAME: 'dev',
    SITE_ORIGIN: 'https://site.example.test',
    BETTER_AUTH_SECRET: 'a-unit-secret-long-enough-for-better-auth',
    DB,
    SIGN_IN_LIMIT: { limit: () => Promise.resolve({ success: true }) },
    SIGNUPS_OPEN,
  } as unknown as EmailEnv;
  const deps: EmailDeps = {
    now: () => NOW,
    pause: () => Promise.resolve(),
    send: (message) => {
      mails.push(message);
      return Promise.resolve({ ok: true, messageId: 'm-1' });
    },
    code: () => '402913',
    token: () => 'unused-token',
  };
  const request = new Request('https://site.example.test/api/app/email/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'new@example.test', purpose, locale: 'en' }),
  });
  return { answer: handleEmailStart(request, env, deps), mails, statements };
}

describe('signUpsOpen', () => {
  it.each([
    ['true', true],
    ['false', false],
    ['TRUE', false],
    ['', false],
    [' true', false],
    [undefined, false],
  ] as const)('reads %j as %s', (value, open) => {
    expect(signUpsOpen({ SIGNUPS_OPEN: value })).toBe(open);
  });
});

describe('starting a sign-up', () => {
  it('answers 403 sign_ups_closed while sign-ups are closed, sending no mail and touching no table', async () => {
    const { answer, mails, statements } = start('sign-up', 'false');
    const response = await answer;
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'sign_ups_closed' });
    expect(mails).toEqual([]);
    expect(statements).toEqual([]);
  });

  it('sends a code while sign-ups are open', async () => {
    const { answer, mails } = start('sign-up', 'true');
    expect((await answer).status).toBe(202);
    expect(mails).toHaveLength(1);
  });

  it('recovery still sends a code while sign-ups are closed', async () => {
    const { answer, mails } = start('recovery', 'false', 'u-member');
    expect((await answer).status).toBe(202);
    expect(mails).toHaveLength(1);
  });
});

describe('finishing a sign-up', () => {
  const setupEnv = (SIGNUPS_OPEN: string | undefined) =>
    ({ ENVIRONMENT_NAME: 'dev', DB: database().DB, SIGNUPS_OPEN }) as unknown as SetupEnv;
  const deps = { now: () => NOW, newId: () => 'u-new' };

  it('refuses to finish a sign-up while sign-ups are closed', async () => {
    const answer = await setupIdentityByHash(setupEnv('false'), 'a-hash', deps);
    if (!(answer instanceof Response)) throw new Error(`expected a refusal, got ${JSON.stringify(answer)}`);
    expect(answer.status).toBe(403);
    expect(await answer.json()).toEqual({ error: 'sign_ups_closed' });
  });

  it('finishes a sign-up while sign-ups are open', async () => {
    expect(await setupIdentityByHash(setupEnv('true'), 'a-hash', deps)).toEqual({
      kind: 'sign-up',
      userId: 'u-new',
      email: 'new@example.test',
      tokenHash: 'a-hash',
    });
  });
});

describe('startMessage', () => {
  it.each([
    [202, 'sent'],
    [400, 'invalid'],
    [403, 'signUpsClosed'],
    [429, 'tooMany'],
    [500, 'sendFailed'],
  ] as const)('answers %i with %s', (status, message) => {
    expect(startMessage(status)).toBe(message);
  });
});

describe('the sign-up page line', () => {
  it('says new sign-ups are closed, in English, with no "we"', () => {
    expect(t('en', 'account.signUpsClosed')).toBe(
      'New sign-ups are closed right now. If you already have an account, you can still sign in.',
    );
  });

  it.each(LOCALES.filter((locale) => locale !== 'en'))('has its own %s line', (locale) => {
    const line = t(locale, 'account.signUpsClosed');
    expect(line).not.toBe('');
    expect(line).not.toBe(t('en', 'account.signUpsClosed'));
  });
});
