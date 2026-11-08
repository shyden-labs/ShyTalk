/**
 * The audit trail (plan 3 Task 8, shyden-labs/ShyTalk#59). `audit()` returns a
 * bound INSERT for the caller to batch with its own write,
 * `env.DB.batch([write, audit(env, …)])`, so both land or neither. The table
 * refuses UPDATE and DELETE (migrations/0002_audit.sql), so a row once written
 * stays.
 */
import type { WebEnv } from './web.ts';

export const AUDIT_SQL = 'INSERT INTO audit (at, actor, action, subject, detail, environment) VALUES (?, ?, ?, ?, ?, ?)';

/**
 * The same row, written only if the statement before it in the batch changed
 * something, for a write that may rightly change nothing (a token already used).
 */
export const AUDIT_IF_CHANGED_SQL =
  'INSERT INTO audit (at, actor, action, subject, detail, environment) SELECT ?, ?, ?, ?, ?, ? WHERE changes() > 0';

/** The part of a D1 database `audit()` uses; `Statement` is D1's prepared statement. */
export interface AuditDatabase<Statement> {
  prepare(sql: string): { bind(...values: unknown[]): Statement };
}

export interface AuditEnv<Statement = unknown> {
  ENVIRONMENT_NAME: WebEnv['ENVIRONMENT_NAME'];
  DB: AuditDatabase<Statement>;
}

export interface AuditEntry {
  /** Who acted: `public`, `staff:<id>`, `user:<id>`. */
  actor: string;
  /** What happened, as `thing.verb`. */
  action: string;
  /** Whom or what it touched. */
  subject?: string;
  /** Anything else worth keeping, stored as JSON; never a credential. */
  detail?: Record<string, unknown>;
}

/**
 * A key that would put a credential in the trail (decision 229): `code`,
 * `token`, `secret` or `password`, whole in any letter case, or ending a key
 * after `_`, `-` (`refresh_token`, `OTP_CODE`) or a capital (`otpCode`,
 * `newPassword`, so also `languageCode`: log a language as `language`). A word
 * merely inside a key (`tokenCount`, `passwordless`, `zipcode`) passes.
 */
const CREDENTIAL_WORDS = 'code|token|secret|password';
const AFTER_SEPARATOR = new RegExp(`(?:^|[_-])(?:${CREDENTIAL_WORDS})$`, 'i');
const AFTER_CAPITAL = /[a-z0-9](?:Code|Token|Secret|Password)$/;

const isCredentialKey = (key: string): boolean => AFTER_SEPARATOR.test(key) || AFTER_CAPITAL.test(key);

function forbiddenKey(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = forbiddenKey(item);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  for (const [key, inner] of Object.entries(value)) {
    if (isCredentialKey(key)) return key;
    const found = forbiddenKey(inner);
    if (found !== null) return found;
  }
  return null;
}

function auditRow<Statement>(sql: string, env: AuditEnv<Statement>, entry: AuditEntry): Statement {
  const key = forbiddenKey(entry.detail);
  if (key !== null) throw new Error(`audit detail must not hold a key named ${key}`);
  return env.DB.prepare(sql).bind(
    Date.now(),
    entry.actor,
    entry.action,
    entry.subject ?? null,
    entry.detail === undefined ? null : JSON.stringify(entry.detail),
    env.ENVIRONMENT_NAME,
  );
}

/** The audit row for `entry` in this environment, bound and ready to batch. */
export function audit<Statement>(env: AuditEnv<Statement>, entry: AuditEntry): Statement {
  return auditRow(AUDIT_SQL, env, entry);
}

/** The audit row for `entry`, landing only if the batch's previous statement changed something. */
export function auditIfChanged<Statement>(env: AuditEnv<Statement>, entry: AuditEntry): Statement {
  return auditRow(AUDIT_IF_CHANGED_SQL, env, entry);
}
