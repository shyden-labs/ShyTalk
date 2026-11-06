import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { handleUi, publishUi, type UiStore, type UiRow, type NewUiRow } from '../../workers/web/src/app/ui.ts';
import type { AuditEntry } from '../../workers/web/src/audit.ts';

/**
 * Serving and publishing the app's UI document (plan 4 Task 6,
 * shyden-labs/ShyTalk#79): a publish validates the document and takes the next
 * version; `GET /api/app/ui` answers the newest `everyone` version with its
 * version as the ETag. The store here is in memory; tests/integration/app-ui
 * runs the D1 store.
 */

const valid = (): unknown => JSON.parse(readFileSync('manifests/ui.json', 'utf8'));

function memoryStore(): UiStore & { rows: UiRow[]; audits: AuditEntry[] } {
  const rows: UiRow[] = [];
  const audits: AuditEntry[] = [];
  return {
    rows,
    audits,
    insert(row: NewUiRow, entry: AuditEntry) {
      const version = rows.reduce((max, r) => Math.max(max, r.version), 0) + 1;
      rows.push({ ...row, version, undoes: null });
      audits.push(entry);
      return Promise.resolve(version);
    },
    newest(audience) {
      const found = rows.filter((r) => r.audience === audience).sort((a, b) => b.version - a.version)[0];
      return Promise.resolve(found ?? null);
    },
  };
}

const get = (headers: Record<string, string> = {}): Request => new Request('https://dev.shytalk.app/api/app/ui', { headers });

describe('publishUi', () => {
  it('refuses an invalid document, naming why, and stores nothing', async () => {
    const store = memoryStore();
    const result = await publishUi(store, { schemaVersion: 2 }, 'everyone', 'ci:deploy-dev');
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).not.toEqual([]);
    expect(store.rows).toEqual([]);
    expect(store.audits).toEqual([]);
  });

  it('gives a valid document the next version, one after another', async () => {
    const store = memoryStore();
    expect(await publishUi(store, valid(), 'everyone', 'ci:deploy-dev')).toEqual({ ok: true, version: 1 });
    expect(await publishUi(store, valid(), 'everyone', 'ci:deploy-dev')).toEqual({ ok: true, version: 2 });
  });

  it('stores the validated document as its body, with who published it and for whom', async () => {
    const store = memoryStore();
    await publishUi(store, valid(), 'everyone', 'ci:deploy-dev');
    const [row] = store.rows;
    expect(JSON.parse(row?.body ?? 'null')).toEqual(valid());
    expect(row?.audience).toBe('everyone');
    expect(row?.share).toBeNull();
    expect(row?.publishedBy).toBe('ci:deploy-dev');
    expect(row?.publishedAt).toBeGreaterThan(0);
  });

  it('writes one audit row with each publish', async () => {
    const store = memoryStore();
    await publishUi(store, valid(), 'everyone', 'ci:deploy-dev');
    expect(store.audits).toEqual([
      { actor: 'ci:deploy-dev', action: 'ui.publish', subject: 'ui_document', detail: { audience: 'everyone', share: null } },
    ]);
  });
});

describe('GET /api/app/ui', () => {
  it('answers the newest everyone version, with its version as the ETag', async () => {
    const store = memoryStore();
    await publishUi(store, valid(), 'everyone', 'ci:deploy-dev');
    const response = await handleUi(get(), store);
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('"1"');
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual(valid());
  });

  it('answers 304 with an empty body when If-None-Match names the current version', async () => {
    const store = memoryStore();
    await publishUi(store, valid(), 'everyone', 'ci:deploy-dev');
    const response = await handleUi(get({ 'if-none-match': '"1"' }), store);
    expect(response.status).toBe(304);
    expect(response.headers.get('etag')).toBe('"1"');
    expect(await response.text()).toBe('');
  });

  it('answers 200 when If-None-Match names an older version', async () => {
    const store = memoryStore();
    await publishUi(store, valid(), 'everyone', 'ci:deploy-dev');
    await publishUi(store, valid(), 'everyone', 'ci:deploy-dev');
    const response = await handleUi(get({ 'if-none-match': '"1"' }), store);
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('"2"');
  });

  // Review Focus 2: an app fetching N while N+1 publishes gets N whole.
  it('gives two reads around a publish each one whole body matching its own ETag', async () => {
    const store = memoryStore();
    await publishUi(store, valid(), 'everyone', 'ci:deploy-dev');
    const before = await handleUi(get(), store);
    const second = { ...(valid() as Record<string, unknown>), switches: { ...(valid() as { switches: object }).switches } };
    await publishUi(store, second, 'everyone', 'ci:deploy-dev');
    const after = await handleUi(get(), store);
    expect(before.headers.get('etag')).toBe('"1"');
    expect(await before.text()).toBe(store.rows[0]?.body);
    expect(after.headers.get('etag')).toBe('"2"');
    expect(await after.text()).toBe(store.rows[1]?.body);
  });

  it('gives a signed-out caller the everyone version, never a newer one for named people', async () => {
    const store = memoryStore();
    await publishUi(store, valid(), 'everyone', 'ci:deploy-dev');
    await publishUi(store, valid(), 'named', 'staff:1');
    const response = await handleUi(get(), store);
    expect(response.headers.get('etag')).toBe('"1"');
  });

  it('answers 404 naming the missing document before any publish', async () => {
    const response = await handleUi(get(), memoryStore());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'no_ui_document' });
  });

  it('answers 405 to anything but GET', async () => {
    const response = await handleUi(new Request('https://dev.shytalk.app/api/app/ui', { method: 'POST' }), memoryStore());
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });
});
