/**
 * ShyDesk punishments, recorded and enforced (shyden-labs/ShyTalk#310). Shyden 2026-11-23: each punishment is stored;
 * a warning is only stored, while a suspension or ban ends every session of the member at once and refuses sign-in
 * until it ends or is lifted. ShyDesk sends a free-form key with no "blocks" flag, so the keys are ShyTalk's own list;
 * Shyden enters the same keys in ShyDesk's settings, and any other key is refused with nothing written.
 */
import { auditIfChanged } from '../audit.ts';
import type { PunishmentEvent } from './shydesk-callback.ts';

/** What a punishment does: `record` stores it only; `block` ends the member's sessions and refuses sign-in. */
export type Effect = 'record' | 'block';

export const PUNISHMENT_EFFECTS: Readonly<Record<string, Effect>> = Object.freeze({
  warning: 'record',
  'suspend-1d': 'block',
  'suspend-7d': 'block',
  'suspend-30d': 'block',
  ban: 'block',
});

/** The effect of `key`, or null for a key ShyTalk does not use (an own property only, never `toString`). */
export const effectOf = (key: string): Effect | null => (Object.hasOwn(PUNISHMENT_EFFECTS, key) ? (PUNISHMENT_EFFECTS[key] ?? null) : null);

/** The part of D1 the store uses; `Statement` is D1's prepared statement. */
export interface PunishmentEnv<Statement> {
  ENVIRONMENT_NAME: 'prod' | 'test' | 'dev';
  DB: {
    prepare(sql: string): { bind(...values: unknown[]): Statement };
    batch(statements: Statement[]): Promise<{ meta: { changes: number }; results: unknown[] }[]>;
  };
}

/** The callback's answer, as ShyDesk's contract states it: 200 `{applied: true}` or an error code. */
export interface CallbackAnswer {
  status: 200 | 404 | 422;
  body: { applied: true } | { error: 'unknown_punishment' };
}

export const APPLY_SQL =
  'INSERT OR IGNORE INTO punishment (id, user_id, key, label, blocks, starts_at, ends_at, report_ticket_id, appeal_url, issued_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
/** Ends the member's sessions only when this delivery wrote a blocking row: a replay finds `starts_at` from the first. */
export const END_SESSIONS_SQL =
  'DELETE FROM "session" WHERE "userId" = ? AND EXISTS (SELECT 1 FROM punishment WHERE id = ? AND blocks = 1 AND lifted_at IS NULL AND starts_at = ?)';
export const LIFT_SQL = 'UPDATE punishment SET lifted_at = ? WHERE id = ? AND lifted_at IS NULL';
export const FIND_SQL = 'SELECT id FROM punishment WHERE id = ?';
export const ACTIVE_BLOCK_SQL =
  'SELECT 1 AS found FROM punishment WHERE user_id = ? AND blocks = 1 AND lifted_at IS NULL AND (ends_at IS NULL OR ends_at > ?) LIMIT 1';

const APPLIED: CallbackAnswer = { status: 200, body: { applied: true } };

/** Stores `event` once (a replay changes nothing and is answered the same), ending the member's sessions if it blocks. */
export async function applyPunishment<Statement>(
  env: PunishmentEnv<Statement>,
  event: PunishmentEvent,
  now: number,
): Promise<CallbackAnswer> {
  const effect = effectOf(event.punishment.key);
  if (effect === null) return { status: 422, body: { error: 'unknown_punishment' } };
  const blocks = effect === 'block';
  const { durationSeconds } = event.punishment;
  const endsAt = blocks && durationSeconds !== null ? now + durationSeconds * 1000 : null;
  const { DB } = env;
  await DB.batch([
    DB.prepare(APPLY_SQL).bind(
      event.punishmentId,
      event.subjectUserId,
      event.punishment.key,
      event.punishment.label,
      blocks ? 1 : 0,
      now,
      endsAt,
      event.reportTicketId,
      event.appealUrl,
      event.issuedAt,
    ),
    auditIfChanged(env, {
      actor: 'shydesk',
      action: 'punishment.applied',
      subject: event.subjectUserId,
      detail: { punishmentId: event.punishmentId, key: event.punishment.key, reportTicketId: event.reportTicketId },
    }),
    DB.prepare(END_SESSIONS_SQL).bind(event.subjectUserId, event.punishmentId, now),
  ]);
  return APPLIED;
}

/** Marks the punishment lifted once; a second lift is answered the same, and one never stored is refused. */
export async function liftPunishment<Statement>(
  env: PunishmentEnv<Statement>,
  event: PunishmentEvent,
  now: number,
): Promise<CallbackAnswer> {
  const { DB } = env;
  const answers = await DB.batch([
    DB.prepare(LIFT_SQL).bind(now, event.punishmentId),
    auditIfChanged(env, {
      actor: 'shydesk',
      action: 'punishment.lifted',
      subject: event.subjectUserId,
      detail: { punishmentId: event.punishmentId, key: event.punishment.key, reportTicketId: event.reportTicketId },
    }),
    DB.prepare(FIND_SQL).bind(event.punishmentId),
  ]);
  return (answers[2]?.results.length ?? 0) > 0 ? APPLIED : { status: 404, body: { error: 'unknown_punishment' } };
}

/** Whether the member has a blocking punishment at `now` that is not lifted and has no end or one still ahead. */
export async function isBlocked<Statement extends { first(): Promise<unknown> }>(
  env: PunishmentEnv<Statement>,
  userId: string,
  now: number,
): Promise<boolean> {
  return (await env.DB.prepare(ACTIVE_BLOCK_SQL).bind(userId, now).first()) !== null;
}
