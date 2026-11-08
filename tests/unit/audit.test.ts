import { describe, it, expect, vi, afterEach } from 'vitest';
import { audit, auditIfChanged, AUDIT_IF_CHANGED_SQL, AUDIT_SQL, type AuditEnv } from '../../workers/web/src/audit.ts';

/**
 * The audit statement (plan 3 Task 8, shyden-labs/ShyTalk#59). Unit: the DB
 * is stood in for, recording the SQL and what is bound. The append-only
 * triggers and the batch's all-or-nothing are proved on a real D1 in
 * tests/integration/audit.test.ts.
 */

interface Prepared {
  sql: string;
  bound: unknown[];
}

function env(environment: AuditEnv['ENVIRONMENT_NAME']): { env: AuditEnv; prepared: Prepared[] } {
  const prepared: Prepared[] = [];
  return {
    prepared,
    env: {
      ENVIRONMENT_NAME: environment,
      DB: {
        prepare(sql: string) {
          const entry: Prepared = { sql, bound: [] };
          prepared.push(entry);
          return {
            bind(...values: unknown[]) {
              entry.bound = values;
              return { sql, values };
            },
          };
        },
      },
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('auditIfChanged', () => {
  it('writes its row only when the statement before it changed something', () => {
    const { env: e, prepared } = env('dev');
    auditIfChanged(e, { actor: 'public', action: 'applicant.confirmed', detail: { language: 'th' } });
    expect(prepared[0]?.sql).toBe(AUDIT_IF_CHANGED_SQL);
    expect(AUDIT_IF_CHANGED_SQL).toContain('WHERE changes() > 0');
    expect(prepared[0]?.bound.slice(1)).toEqual(['public', 'applicant.confirmed', null, '{"language":"th"}', 'dev']);
  });

  it('refuses a credential key as audit() does', () => {
    const { env: e } = env('dev');
    expect(() => auditIfChanged(e, { actor: 'a', action: 'b', detail: { token: 'x' } })).toThrow('token');
  });
});

describe('audit', () => {
  it('inserts one row with the time, actor, action, subject, JSON detail and environment', () => {
    vi.useFakeTimers({ now: 1_762_300_000_000 });
    const { env: e, prepared } = env('dev');
    audit(e, { actor: 'public', action: 'applicant.created', subject: 'applicant:7', detail: { language: 'id' } });
    expect(prepared).toEqual([
      {
        sql: AUDIT_SQL,
        bound: [1_762_300_000_000, 'public', 'applicant.created', 'applicant:7', '{"language":"id"}', 'dev'],
      },
    ]);
    expect(AUDIT_SQL).toBe('INSERT INTO audit (at, actor, action, subject, detail, environment) VALUES (?, ?, ?, ?, ?, ?)');
  });

  it.each(['prod', 'test', 'dev'] as const)('binds the environment from ENVIRONMENT_NAME: %s', (environment) => {
    const { env: e, prepared } = env(environment);
    audit(e, { actor: 'staff:1', action: 'role.granted' });
    expect(prepared[0]?.bound.at(-1)).toBe(environment);
  });

  it('binds null for a missing subject and detail', () => {
    const { env: e, prepared } = env('dev');
    audit(e, { actor: 'staff:1', action: 'role.granted' });
    expect(prepared[0]?.bound.slice(3, 5)).toEqual([null, null]);
  });

  it('returns the bound statement, for the caller to batch with its own write', () => {
    const { env: e } = env('dev');
    expect(audit(e, { actor: 'a', action: 'b' })).toEqual({ sql: AUDIT_SQL, values: expect.any(Array) as unknown });
  });

  // Decision 229: the four names whole, in any case, or as the end of a key
  // after `_`, `-` or a capital.
  it.each([
    'code',
    'token',
    'secret',
    'password',
    'Password',
    'TOKEN',
    'refresh_token',
    'access-token',
    'otpCode',
    'apiSecret',
    'newPassword',
    'languageCode',
    'OTP_CODE',
  ])('refuses a detail with a key named %s, naming it', (key) => {
    const { env: e, prepared } = env('dev');
    expect(() => audit(e, { actor: 'a', action: 'b', detail: { [key]: 'x' } })).toThrow(`audit detail must not hold a key named ${key}`);
    expect(prepared).toEqual([]);
  });

  it('refuses such a key at any depth, in objects and in lists', () => {
    const { env: e } = env('dev');
    expect(() => audit(e, { actor: 'a', action: 'b', detail: { user: { otp: { code: '1' } } } })).toThrow('a key named code');
    expect(() => audit(e, { actor: 'a', action: 'b', detail: { sessions: [{ id: 1 }, { token: 't' }] } })).toThrow('a key named token');
  });

  it('passes keys that only contain those words elsewhere, such as tokenCount', () => {
    const { env: e, prepared } = env('dev');
    audit(e, {
      actor: 'a',
      action: 'b',
      detail: { language: 'th', tokenCount: 2, passwordless: true, secretary: 'x', zipcode: '1', seats: [{ id: 1 }, 'host'] },
    });
    expect(prepared).toHaveLength(1);
  });
});
