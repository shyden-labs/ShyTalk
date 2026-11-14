import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { audit } from '../../workers/web/src/audit.ts';
import { localDev, type LocalDevEnv } from './d1.ts';

/**
 * The audit trail on a real D1 (plan 3 Task 8, shyden-labs/ShyTalk#59): the
 * table migrations/0002_audit.sql makes refuses UPDATE and DELETE, and a
 * batch whose own write fails leaves no audit row. A row is kept one year
 * (shyden-labs/ShyTalk#197, migrations/0008_audit_kept_one_year.sql): each new
 * row deletes those older, and only those older may be deleted.
 */

let env: LocalDevEnv;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ env, dispose } = await localDev());
});

afterAll(async () => {
  await dispose();
});

const DAY_MS = 86_400_000;

/** A row written straight into the table, `daysAgo` days old. */
const rowAged = (action: string, daysAgo: number) =>
  env.DB.prepare("INSERT INTO audit (at, actor, action, environment) VALUES (?, 'staff:1', ?, 'dev')")
    .bind(Date.now() - daysAgo * DAY_MS, action)
    .run();

const count = async (action: string): Promise<number> =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM audit WHERE action = ?').bind(action).first<{ n: number }>())?.n ?? -1;

describe('the audit table', () => {
  // One row, written once, carries every check (shyden-labs/ShyTalk#180).
  it('takes a row written through audit(), marked with the environment, and refuses an UPDATE and a DELETE of it', async () => {
    await env.DB.batch([audit(env, { actor: 'staff:1', action: 'test.written', subject: 'x', detail: { language: 'th' } })]);
    const read = () =>
      env.DB.prepare('SELECT actor, subject, detail, environment FROM audit WHERE action = ?')
        .bind('test.written')
        .first<Record<string, string>>();
    const written = { actor: 'staff:1', subject: 'x', detail: '{"language":"th"}', environment: 'dev' };
    expect.soft(await read()).toEqual(written);

    await expect
      .soft(env.DB.prepare("UPDATE audit SET actor = 'someone else' WHERE action = 'test.written'").run())
      .rejects.toThrow('audit is append-only');
    expect.soft(await read()).toEqual(written);

    await expect.soft(env.DB.prepare("DELETE FROM audit WHERE action = 'test.written'").run()).rejects.toThrow('audit is append-only');
    expect.soft(await count('test.written')).toBe(1);
  });
});

describe('a row kept one year', () => {
  // One write, every check (shyden-labs/ShyTalk#180): the old row goes, the young one stays and still refuses a DELETE.
  it('is deleted by the next audit write once older than a year, and refused a DELETE until then', async () => {
    // The young row first: each insert prunes before it lands, so the old row survives only its own insert.
    await rowAged('test.aged.young', 364);
    await rowAged('test.aged.old', 366);
    expect.soft([await count('test.aged.old'), await count('test.aged.young')]).toEqual([1, 1]);

    await env.DB.batch([audit(env, { actor: 'staff:1', action: 'test.aged.next' })]);
    expect.soft([await count('test.aged.old'), await count('test.aged.young'), await count('test.aged.next')]).toEqual([0, 1, 1]);

    await expect.soft(env.DB.prepare("DELETE FROM audit WHERE action = 'test.aged.young'").run()).rejects.toThrow('audit is append-only');
    await expect
      .soft(env.DB.prepare("UPDATE audit SET actor = 'someone else' WHERE action = 'test.aged.young'").run())
      .rejects.toThrow('audit is append-only');
    expect.soft(await count('test.aged.young')).toBe(1);
  });
});

describe('a batch with its audit row', () => {
  it('lands both when the write succeeds', async () => {
    // Written now: a row older than a year would be pruned by the audit row after it.
    const write = env.DB.prepare("INSERT INTO audit (at, actor, action, environment) VALUES (?, 'staff:1', 'test.both.write', 'dev')").bind(
      Date.now(),
    );
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
