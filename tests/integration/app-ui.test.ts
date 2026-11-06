import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { d1UiStore, handleUi, publishUi, type UiStore } from '../../workers/web/src/app/ui.ts';
import { localDev, type LocalDevEnv } from './d1.ts';

/**
 * The UI document on a real D1 (plan 4 Task 6, shyden-labs/ShyTalk#79): the
 * table migrations/0004_ui_documents.sql makes, the next version taken in the
 * INSERT, the audit row in the same batch, and the newest `everyone` version
 * served with its ETag.
 */

let env: LocalDevEnv;
let dispose: () => Promise<void>;
let store: UiStore;

beforeAll(async () => {
  ({ env, dispose } = await localDev());
  store = d1UiStore(env);
});

afterAll(async () => {
  await dispose();
});

const valid = (): unknown => JSON.parse(readFileSync('manifests/ui.json', 'utf8'));
const count = async (sql: string): Promise<number> => (await env.DB.prepare(sql).first<{ n: number }>())?.n ?? -1;
const get = (headers: Record<string, string> = {}): Request => new Request('https://site.example.test/api/app/ui', { headers });

describe('the UI document on D1', () => {
  it('gives each valid publish the next version, with one audit row each', async () => {
    const audits = await count("SELECT COUNT(*) AS n FROM audit WHERE action = 'ui.publish'");
    const first = await publishUi(store, valid(), 'everyone', 'ci:integration');
    const second = await publishUi(store, valid(), 'everyone', 'ci:integration');
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.version).toBe(first.version + 1);
    expect(await count("SELECT COUNT(*) AS n FROM audit WHERE action = 'ui.publish'")).toBe(audits + 2);
  });

  it('stores nothing and audits nothing for an invalid document', async () => {
    const rows = await count('SELECT COUNT(*) AS n FROM ui_documents');
    const audits = await count('SELECT COUNT(*) AS n FROM audit');
    expect((await publishUi(store, { schemaVersion: 2 }, 'everyone', 'ci:integration')).ok).toBe(false);
    expect(await count('SELECT COUNT(*) AS n FROM ui_documents')).toBe(rows);
    expect(await count('SELECT COUNT(*) AS n FROM audit')).toBe(audits);
  });

  it('leaves no audit row when the table refuses the version', async () => {
    const audits = await count('SELECT COUNT(*) AS n FROM audit');
    // An audience the table does not know: the INSERT fails, so the batch does.
    await expect(
      store.insert(
        { body: '{}', audience: 'nobody' as 'everyone', share: null, publishedAt: Date.now(), publishedBy: 'ci:integration' },
        { actor: 'ci:integration', action: 'ui.publish', subject: 'ui_document' },
      ),
    ).rejects.toThrow();
    expect(await count('SELECT COUNT(*) AS n FROM audit')).toBe(audits);
  });

  it('serves the newest everyone version with its ETag, then 304 for it, never a newer named one', async () => {
    const published = await publishUi(store, valid(), 'everyone', 'ci:integration');
    if (!published.ok) throw new Error(published.errors.join('; '));
    await publishUi(store, valid(), 'named', 'staff:integration');
    const response = await handleUi(get(), store);
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe(`"${published.version}"`);
    expect(await response.json()).toEqual(valid());
    const again = await handleUi(get({ 'if-none-match': `"${published.version}"` }), store);
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
  });
});
