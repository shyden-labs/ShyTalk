import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { audit } from '../../workers/web/src/audit.ts';
import { localDev, type LocalDevEnv } from './d1.ts';

/**
 * The audit trail on a real D1 (plan 3 Task 8, shyden-labs/ShyTalk#59): the
 * table migrations/0002_audit.sql makes refuses UPDATE and DELETE, and a
 * batch whose own write fails leaves no audit row.
 */

let env: LocalDevEnv;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ env, dispose } = await localDev());
});

afterAll(async () => {
  await dispose();
});

const count = async (action: string): Promise<number> =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM audit WHERE action = ?').bind(action).first<{ n: number }>())?.n ?? -1;

describe('the audit table', () => {
  it('takes a row written through audit(), marked with the environment', async () => {
    await env.DB.batch([audit(env, { actor: 'staff:1', action: 'test.written', subject: 'x', detail: { language: 'th' } })]);
    const row = await env.DB.prepare('SELECT actor, subject, detail, environment FROM audit WHERE action = ?')
      .bind('test.written')
      .first<Record<string, string>>();
    expect(row).toEqual({ actor: 'staff:1', subject: 'x', detail: '{"language":"th"}', environment: 'dev' });
  });

  it('refuses an UPDATE, leaving the row as it was', async () => {
    await env.DB.batch([audit(env, { actor: 'staff:1', action: 'test.update' })]);
    await expect(env.DB.prepare("UPDATE audit SET actor = 'someone else' WHERE action = 'test.update'").run()).rejects.toThrow(
      'audit is append-only',
    );
    const row = await env.DB.prepare("SELECT actor FROM audit WHERE action = 'test.update'").first<{ actor: string }>();
    expect(row).toEqual({ actor: 'staff:1' });
  });

  it('refuses a DELETE, leaving the row in place', async () => {
    await env.DB.batch([audit(env, { actor: 'staff:1', action: 'test.delete' })]);
    await expect(env.DB.prepare("DELETE FROM audit WHERE action = 'test.delete'").run()).rejects.toThrow('audit is append-only');
    expect(await count('test.delete')).toBe(1);
  });
});

describe('a batch with its audit row', () => {
  it('lands both when the write succeeds', async () => {
    const write = env.DB.prepare("INSERT INTO audit (at, actor, action, environment) VALUES (1, 'staff:1', 'test.both.write', 'dev')");
    await env.DB.batch([write, audit(env, { actor: 'staff:1', action: 'test.both.audit' })]);
    expect([await count('test.both.write'), await count('test.both.audit')]).toEqual([1, 1]);
  });

  it('leaves no audit row when its first write fails', async () => {
    // The caller's write breaks a NOT NULL constraint, so the batch fails as a whole.
    const failing = env.DB.prepare("INSERT INTO audit (at, actor, action, environment) VALUES (1, NULL, 'test.failed.write', 'dev')");
    await expect(env.DB.batch([failing, audit(env, { actor: 'staff:1', action: 'test.failed.audit' })])).rejects.toThrow('NOT NULL');
    expect(await count('test.failed.audit')).toBe(0);
  });
});
