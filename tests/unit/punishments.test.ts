import { describe, it, expect } from 'vitest';
import { AUDIT_IF_CHANGED_SQL } from '../../workers/web/src/audit.ts';
import type { PunishmentEvent } from '../../workers/web/src/moderation/shydesk-callback.ts';
import {
  ACTIVE_BLOCK_SQL,
  APPLY_SQL,
  END_SESSIONS_SQL,
  FIND_SQL,
  LIFT_SQL,
  PUNISHMENT_EFFECTS,
  applyPunishment,
  effectOf,
  isBlocked,
  liftPunishment,
  type PunishmentEnv,
} from '../../workers/web/src/moderation/punishments.ts';

/**
 * ShyDesk punishments, recorded and enforced (shyden-labs/ShyTalk#310; Shyden 2026-11-23: a warning is only stored,
 * a suspension or ban ends every session and refuses sign-in until it ends or is lifted; the keys are ShyTalk's own
 * list). Unit: D1 is stood in for, recording each statement and what is bound. The SQL itself, the session ending and
 * the replay are proved on a real D1 in tests/integration/punishments.test.ts.
 */

interface Bound {
  sql: string;
  values: unknown[];
}

type Statement = Bound & { first(): Promise<unknown> };

const NOW = 1_795_400_000_000;

function stand(answers: { changes: number; results?: unknown[] }[] = [], first: unknown = null) {
  const batches: Bound[][] = [];
  const firsts: Bound[] = [];
  const env: PunishmentEnv<Statement> = {
    ENVIRONMENT_NAME: 'dev',
    DB: {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            return {
              sql,
              values,
              first: () => {
                firsts.push({ sql, values });
                return Promise.resolve(first);
              },
            };
          },
        };
      },
      batch(statements: Statement[]) {
        batches.push(statements.map(({ sql, values }) => ({ sql, values })));
        return Promise.resolve(
          statements.map((_, at) => ({ meta: { changes: answers[at]?.changes ?? 0 }, results: answers[at]?.results ?? [] })),
        );
      },
    },
  };
  return { env, batches, firsts };
}

const event = (key: string, durationSeconds: number | null, type: PunishmentEvent['type'] = 'punishment.apply'): PunishmentEvent => ({
  type,
  punishmentId: 'pun_1',
  subjectUserId: 'user_1',
  punishment: { key, label: 'A label', durationSeconds },
  reportTicketId: 'tkt_1',
  appealUrl: type === 'punishment.apply' ? 'https://site.example.test/appeal#appeal=x' : null,
  issuedAt: '2026-11-23T15:00:00Z',
});

describe('the punishment keys', () => {
  it('are exactly the five Shyden chose: a warning is stored only, every other one blocks', () => {
    expect(PUNISHMENT_EFFECTS).toEqual({
      warning: 'record',
      'suspend-1d': 'block',
      'suspend-7d': 'block',
      'suspend-30d': 'block',
      ban: 'block',
    });
  });

  it.each(['Warning', 'suspend', 'kick', '', 'toString', '__proto__'])('know nothing of %j', (key) => {
    expect(effectOf(key)).toBeNull();
  });
});

describe('applyPunishment', () => {
  it('refuses an unknown key and writes nothing', async () => {
    const { env, batches } = stand();
    expect(await applyPunishment(env, event('kick', 60), NOW)).toEqual({ status: 422, body: { error: 'unknown_punishment' } });
    expect(batches).toEqual([]);
  });

  it('stores a suspension ending its duration from now, audits it if new, and ends the member sessions if new', async () => {
    const { env, batches } = stand([{ changes: 1 }, { changes: 1 }, { changes: 2 }]);
    expect(await applyPunishment(env, event('suspend-7d', 604_800), NOW)).toEqual({ status: 200, body: { applied: true } });
    expect(batches).toHaveLength(1);
    const [insert, auditRow, endSessions] = batches[0] ?? [];
    expect(insert).toEqual({
      sql: APPLY_SQL,
      values: [
        'pun_1',
        'user_1',
        'suspend-7d',
        'A label',
        1,
        NOW,
        NOW + 604_800_000,
        'tkt_1',
        'https://site.example.test/appeal#appeal=x',
        '2026-11-23T15:00:00Z',
      ],
    });
    expect(APPLY_SQL).toMatch(/^INSERT OR IGNORE INTO punishment /);
    expect(auditRow?.sql).toBe(AUDIT_IF_CHANGED_SQL);
    expect(auditRow?.values.slice(1)).toEqual([
      'shydesk',
      'punishment.applied',
      'user_1',
      '{"punishmentId":"pun_1","key":"suspend-7d","reportTicketId":"tkt_1"}',
      'dev',
    ]);
    expect(endSessions).toEqual({ sql: END_SESSIONS_SQL, values: ['user_1', 'pun_1', NOW] });
  });

  it('stores a ban with no end', async () => {
    const { env, batches } = stand();
    await applyPunishment(env, event('ban', null), NOW);
    expect(batches[0]?.[0]?.values.slice(4, 7)).toEqual([1, NOW, null]);
  });

  it('stores a warning as not blocking, with no end whatever its duration, and still sends the session statement', async () => {
    const { env, batches } = stand();
    await applyPunishment(env, event('warning', 86_400), NOW);
    expect(batches[0]?.[0]?.values.slice(4, 7)).toEqual([0, NOW, null]);
    expect(batches[0]?.[2]?.sql).toBe(END_SESSIONS_SQL);
  });

  it('ends sessions only for a blocking, unlifted row this very delivery wrote', () => {
    expect(END_SESSIONS_SQL).toBe(
      'DELETE FROM "session" WHERE "userId" = ? AND EXISTS (SELECT 1 FROM punishment WHERE id = ? AND blocks = 1 AND lifted_at IS NULL AND starts_at = ?)',
    );
  });

  it('answers a replay as the first delivery was answered', async () => {
    const { env } = stand([{ changes: 0 }, { changes: 0 }, { changes: 0 }]);
    expect(await applyPunishment(env, event('ban', null), NOW)).toEqual({ status: 200, body: { applied: true } });
  });
});

describe('liftPunishment', () => {
  it('marks the punishment lifted once, audits it if changed, and answers applied', async () => {
    const { env, batches } = stand([{ changes: 1 }, { changes: 1 }, { changes: 0, results: [{ id: 'pun_1' }] }]);
    expect(await liftPunishment(env, event('ban', null, 'punishment.lift'), NOW)).toEqual({ status: 200, body: { applied: true } });
    const [lift, auditRow, find] = batches[0] ?? [];
    expect(lift).toEqual({ sql: LIFT_SQL, values: [NOW, 'pun_1'] });
    expect(LIFT_SQL).toBe('UPDATE punishment SET lifted_at = ? WHERE id = ? AND lifted_at IS NULL');
    expect(auditRow?.sql).toBe(AUDIT_IF_CHANGED_SQL);
    expect(auditRow?.values.slice(1, 4)).toEqual(['shydesk', 'punishment.lifted', 'user_1']);
    expect(find).toEqual({ sql: FIND_SQL, values: ['pun_1'] });
  });

  it('answers a second lift of the same punishment as the first', async () => {
    const { env } = stand([{ changes: 0 }, { changes: 0 }, { changes: 0, results: [{ id: 'pun_1' }] }]);
    expect(await liftPunishment(env, event('ban', null, 'punishment.lift'), NOW)).toEqual({ status: 200, body: { applied: true } });
  });

  it('refuses a lift of a punishment it never stored', async () => {
    const { env } = stand([{ changes: 0 }, { changes: 0 }, { changes: 0, results: [] }]);
    expect(await liftPunishment(env, event('ban', null, 'punishment.lift'), NOW)).toEqual({
      status: 404,
      body: { error: 'unknown_punishment' },
    });
  });
});

describe('isBlocked', () => {
  it('asks for a blocking, unlifted punishment with no end or one still ahead', async () => {
    const { env, firsts } = stand([], { found: 1 });
    expect(await isBlocked(env, 'user_1', NOW)).toBe(true);
    expect(firsts).toEqual([{ sql: ACTIVE_BLOCK_SQL, values: ['user_1', NOW] }]);
    expect(ACTIVE_BLOCK_SQL).toBe(
      'SELECT 1 AS found FROM punishment WHERE user_id = ? AND blocks = 1 AND lifted_at IS NULL AND (ends_at IS NULL OR ends_at > ?) LIMIT 1',
    );
  });

  it('is false when no such punishment is found', async () => {
    const { env } = stand([], null);
    expect(await isBlocked(env, 'user_1', NOW)).toBe(false);
  });
});
