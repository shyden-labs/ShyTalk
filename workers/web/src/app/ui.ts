/**
 * Serving and publishing the app's UI document (plan 4 Task 6,
 * shyden-labs/ShyTalk#79). A publish validates the document (Task 5) and
 * stores it as the next version, with its audit row in the same write.
 * `GET /api/app/ui` answers the newest version for `everyone`, its version
 * number as the ETag, so an app holding that version gets 304 and an app
 * reading during a publish gets one whole version, never a mix.
 */
import { validateUiDocument } from '../../../../packages/ui-document/index.ts';
import { audit, type AuditEntry, type AuditEnv } from '../audit.ts';
import { json } from '../http.ts';

/** Who a version is for: named people, a share of people (Task 7), or everyone. */
export type Audience = 'named' | 'share' | 'everyone';

/** A version as a publish hands it to the store, before it has a number. */
export interface NewUiRow {
  /** The validated document, as JSON text. */
  body: string;
  audience: Audience;
  /** The percentage reached when `audience` is `share`, else null. */
  share: number | null;
  /** Milliseconds since the epoch. */
  publishedAt: number;
  /** `ci:<workflow>` or `staff:<id>`. */
  publishedBy: string;
}

/** A stored version (table `ui_documents`). */
export interface UiRow extends NewUiRow {
  version: number;
  /** The version an undo took away (Task 7), else null. */
  undoes: number | null;
}

export interface UiStore {
  /** Stores `row` as the next version with `entry`'s audit row, in one write; answers the version. */
  insert(row: NewUiRow, entry: AuditEntry): Promise<number>;
  /** The newest version for `audience`, or null when there is none. */
  newest(audience: Audience): Promise<UiRow | null>;
}

export type PublishResult = { ok: true; version: number } | { ok: false; errors: string[] };

/** Validates `input` and stores it as the next version for `audience`; stores nothing when it is invalid. */
export async function publishUi(
  store: UiStore,
  input: unknown,
  audience: Audience,
  by: string,
  share: number | null = null,
): Promise<PublishResult> {
  const checked = validateUiDocument(input);
  if (!checked.ok) return checked;
  const version = await store.insert(
    { body: JSON.stringify(checked.doc), audience, share, publishedAt: Date.now(), publishedBy: by },
    { actor: by, action: 'ui.publish', subject: 'ui_document', detail: { audience, share } },
  );
  return { ok: true, version };
}

/** The part of a D1 statement the store uses. */
export interface UiStatement {
  bind(...values: unknown[]): UiStatement;
  all(): Promise<{ results: unknown[] }>;
}

/** The part of a D1 database the store uses. */
export interface UiDatabase {
  prepare(sql: string): UiStatement;
  batch(statements: UiStatement[]): Promise<{ results: unknown[] }[]>;
}

// The next version is taken inside the INSERT itself, so two publishes can
// never share a number.
const INSERT_SQL =
  'INSERT INTO ui_documents (version, body, audience, share, undoes, published_at, published_by) ' +
  'SELECT COALESCE(MAX(version), 0) + 1, ?, ?, ?, NULL, ?, ? FROM ui_documents RETURNING version';
const NEWEST_SQL =
  'SELECT version, body, audience, share, undoes, published_at AS publishedAt, published_by AS publishedBy ' +
  'FROM ui_documents WHERE audience = ? ORDER BY version DESC LIMIT 1';

/** The store on the environment's D1 (table `ui_documents`, migrations/0004_ui_documents.sql). */
export function d1UiStore(env: AuditEnv<UiStatement> & { DB: UiDatabase }): UiStore {
  return {
    async insert(row, entry) {
      const insert = env.DB.prepare(INSERT_SQL).bind(row.body, row.audience, row.share, row.publishedAt, row.publishedBy);
      await env.DB.batch([audit(env, entry)]); // MUTATION: audit outside the insert's batch
      const [inserted] = await env.DB.batch([insert]);
      const version = (inserted?.results[0] as { version?: unknown } | undefined)?.version;
      if (typeof version !== 'number') throw new Error('the ui_documents insert answered no version');
      return version;
    },
    async newest(audience) {
      const { results } = await env.DB.prepare(NEWEST_SQL).bind(audience).all();
      return (results[0] as UiRow | undefined) ?? null;
    },
  };
}

/** `GET /api/app/ui`: the newest `everyone` version, or 304 when the caller already holds it. */
export async function handleUi(request: Request, store: UiStore): Promise<Response> {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET' } });
  const row = await store.newest('everyone');
  if (row === null) return json(404, { error: 'no_ui_document' });
  const etag = `"${row.version}"`;
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag } });
  return new Response(row.body, { status: 200, headers: { 'content-type': 'application/json', etag } });
}
