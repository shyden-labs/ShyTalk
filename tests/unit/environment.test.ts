import { describe, it, expect, vi } from 'vitest';
import { DOOR_SECRET_HEADER, createMarkerGuard, requireDoorSecret, type D1Like, type R2Like } from '../../packages/environment/index.ts';

/**
 * The origin side of the door (design 4.17, ShyTalk#28): an origin accepts
 * only requests carrying its own door secret, and refuses to serve when its
 * stores are not the environment it believes it is.
 */

const SECRET = 'the-door-secret';
const withSecret = (value?: string): Request =>
  new Request('https://origin.example.test/', value === undefined ? {} : { headers: { [DOOR_SECRET_HEADER]: value } });

describe('requireDoorSecret', () => {
  it('lets the right secret through', async () => {
    expect(await requireDoorSecret(withSecret(SECRET), SECRET)).toBeNull();
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['a prefix', SECRET.slice(0, -1)],
    ['longer', `${SECRET}x`],
    ['different', 'another-secret-entirely'],
    ['differing in case', SECRET.toUpperCase()],
  ])('answers 403 when the header is %s', async (_case, value) => {
    const response = await requireDoorSecret(withSecret(value), SECRET);
    expect(response?.status).toBe(403);
    expect(await response?.text()).toBe('Forbidden');
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])('answers 403 when the configured secret is %s, even to an empty header', async (_case, configured) => {
    expect((await requireDoorSecret(withSecret(''), configured))?.status).toBe(403);
    expect((await requireDoorSecret(withSecret(), configured))?.status).toBe(403);
  });

  it('compares SHA-256 digests, so both sides are hashed whatever their length', async () => {
    const digest = vi.spyOn(crypto.subtle, 'digest');
    try {
      await requireDoorSecret(withSecret('x'), SECRET);
      expect(digest).toHaveBeenCalledTimes(2);
      for (const call of digest.mock.calls) expect(call[0]).toBe('SHA-256');
    } finally {
      digest.mockRestore();
    }
  });
});

/** A D1 stand-in whose marker table holds `rows`, or throws `error`. */
function d1(rows: { name: string }[] | Error): D1Like & { reads: () => number } {
  let reads = 0;
  return {
    prepare: (sql: string) => ({
      first: <T>() => {
        reads += 1;
        expect(sql).toBe('SELECT name FROM environment_marker LIMIT 1');
        return rows instanceof Error ? Promise.reject(rows) : Promise.resolve((rows[0] ?? null) as T | null);
      },
    }),
    reads: () => reads,
  };
}

/** An R2 stand-in whose `.environment` object holds `body` (null: no object), or throws `error`. */
function r2(body: string | null | Error): R2Like & { reads: () => number } {
  let reads = 0;
  return {
    get: (key: string) => {
      reads += 1;
      expect(key).toBe('.environment');
      if (body instanceof Error) return Promise.reject(body);
      return Promise.resolve(body === null ? null : { text: () => Promise.resolve(body) });
    },
    reads: () => reads,
  };
}

describe('assertEnvironmentMarkers', () => {
  it('passes when every database and bucket names the expected environment, reading each once', async () => {
    const db = d1([{ name: 'dev' }]);
    const bucket = r2('dev\n');
    const log = vi.fn();
    const guard = createMarkerGuard('dev', { databases: { DB: db }, buckets: { MEDIA: bucket } }, log);

    expect(await guard.assertEnvironmentMarkers()).toBeNull();
    expect(await guard.assertEnvironmentMarkers()).toBeNull();

    expect(db.reads()).toBe(1);
    expect(bucket.reads()).toBe(1);
    expect(log).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing table', () => ({ DB: d1(new Error('D1_ERROR: no such table: environment_marker')) }), {}, 'd1 DB: unreadable'],
    ['an empty table', () => ({ DB: d1([]) }), {}, 'd1 DB: no marker'],
    ['a wrong name in the table', () => ({ DB: d1([{ name: 'prod' }]) }), {}, 'd1 DB: marks prod'],
    ['a missing object', () => ({}), { MEDIA: r2(null) }, 'r2 MEDIA: no marker'],
    ['a wrong name in the object', () => ({}), { MEDIA: r2('test') }, 'r2 MEDIA: marks test'],
    ['an empty object', () => ({}), { MEDIA: r2('  \n') }, 'r2 MEDIA: no marker'],
    ['a read error', () => ({}), { MEDIA: r2(new Error('network')) }, 'r2 MEDIA: unreadable'],
  ])('fails closed with 503 and logs on %s', async (_case, databases, buckets, reason) => {
    const log = vi.fn();
    const guard = createMarkerGuard('dev', { databases: databases(), buckets }, log);

    const response = await guard.assertEnvironmentMarkers();

    expect(response?.status).toBe(503);
    expect(await response?.text()).toBe('Service Unavailable');
    expect(log).toHaveBeenCalledWith(`environment marker check failed (expected dev): ${reason}`);
  });

  it('fails closed when it is given no store at all', async () => {
    const log = vi.fn();
    const response = await createMarkerGuard('dev', { databases: {}, buckets: {} }, log).assertEnvironmentMarkers();
    expect(response?.status).toBe(503);
    expect(log).toHaveBeenCalledWith('environment marker check failed (expected dev): no store to check');
  });

  it('fails when one store of several is wrong, naming it', async () => {
    const log = vi.fn();
    const guard = createMarkerGuard(
      'dev',
      { databases: { DB: d1([{ name: 'dev' }]), AUDIT: d1([{ name: 'test' }]) }, buckets: { MEDIA: r2('dev') } },
      log,
    );
    expect((await guard.assertEnvironmentMarkers())?.status).toBe(503);
    expect(log).toHaveBeenCalledWith('environment marker check failed (expected dev): d1 AUDIT: marks test');
  });

  it('checks again after a failure, and keeps the pass once the marker is right', async () => {
    let marker = 'test';
    const bucket: R2Like = { get: () => Promise.resolve({ text: () => Promise.resolve(marker) }) };
    const get = vi.spyOn(bucket, 'get');
    const guard = createMarkerGuard('dev', { databases: {}, buckets: { MEDIA: bucket } }, vi.fn());

    expect((await guard.assertEnvironmentMarkers())?.status).toBe(503);
    expect((await guard.assertEnvironmentMarkers())?.status).toBe(503);
    marker = 'dev';
    expect(await guard.assertEnvironmentMarkers()).toBeNull();
    marker = 'test';
    expect(await guard.assertEnvironmentMarkers()).toBeNull();

    expect(get).toHaveBeenCalledTimes(3);
  });

  it('logs to console.error when no logger is given', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await createMarkerGuard('dev', { databases: {}, buckets: {} }).assertEnvironmentMarkers();
      expect(error).toHaveBeenCalledWith('environment marker check failed (expected dev): no store to check');
    } finally {
      error.mockRestore();
    }
  });
});
