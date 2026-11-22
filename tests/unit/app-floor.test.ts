import { describe, it, expect } from 'vitest';
import {
  checkFloor,
  compareVersions,
  d1FloorStore,
  parseVersion,
  type FloorStatement,
  type FloorStore,
} from '../../workers/web/src/app/floor.ts';
import { appHeaders } from '../support/app-headers.ts';

/**
 * The version floor (plan 6.1 Task 3, shyden-labs/ShyTalk#77 AC 1-2; live-app
 * design 4.5): before every app route, an Android or iPhone app older than its
 * platform's floor is answered 426, and only "update to continue" shows.
 */

const store = (floors: Partial<Record<'android' | 'ios', string>>): FloorStore & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    floor: (platform) => {
      calls.push(platform);
      return Promise.resolve(floors[platform] ?? null);
    },
  };
};

const request = (path: string, headers: Record<string, string> = {}): Request =>
  new Request(`https://site.example.test${path}`, { headers });

async function refusal(response: Response | null): Promise<{ status: number; body: unknown } | null> {
  return response === null ? null : { status: response.status, body: await response.json() };
}

describe('checkFloor', () => {
  it('refuses a call naming no platform', async () => {
    expect(await refusal(await checkFloor(request('/api/app/ui'), store({})))).toEqual({
      status: 426,
      body: { error: 'update_required', floor: '0.0.0' },
    });
  });

  it('refuses a platform it does not know', async () => {
    const response = await checkFloor(request('/api/app/ui', appHeaders('windows', '1.0.0')), store({}));
    expect(response?.status).toBe(426);
  });

  it.each(['1.9', 'v1.9.0', '1.09.0', '', '1.9.0.1'])('refuses the Android version %j, which is not MAJOR.MINOR.PATCH', async (version) => {
    const response = await checkFloor(request('/api/app/ui', appHeaders('android', version)), store({}));
    expect(response?.status).toBe(426);
  });

  it('refuses an Android app naming no version', async () => {
    const response = await checkFloor(request('/api/app/ui', { 'x-shytalk-platform': 'android' }), store({}));
    expect(response?.status).toBe(426);
  });

  it('refuses an app under its floor, naming the floor', async () => {
    const response = await checkFloor(request('/api/app/ui', appHeaders('android', '1.9.0')), store({ android: '1.10.0' }));
    expect(response?.status).toBe(426);
    expect(await response?.text()).toBe('{"error":"update_required","floor":"1.10.0"}');
  });

  it('lets an app at its floor through', async () => {
    expect(await checkFloor(request('/api/app/ui', appHeaders('android', '1.10.0')), store({ android: '1.10.0' }))).toBeNull();
  });

  it('lets an app over its floor through', async () => {
    expect(await checkFloor(request('/api/app/ui', appHeaders('android', '1.10.1')), store({ android: '1.10.0' }))).toBeNull();
  });

  it('lets an iPhone app through when iPhone has no floor', async () => {
    expect(await checkFloor(request('/api/app/ui', appHeaders('ios', '1.0.0')), store({ android: '9.0.0' }))).toBeNull();
  });

  it('holds the iPhone app to the iPhone floor alone', async () => {
    const floors = store({ android: '1.0.0', ios: '2.0.0' });
    const response = await checkFloor(request('/api/app/ui', appHeaders('ios', '1.5.0')), floors);
    expect(await refusal(response)).toEqual({ status: 426, body: { error: 'update_required', floor: '2.0.0' } });
    expect(floors.calls).toEqual(['ios']);
  });

  it('lets the website through with no version, reading no floor', async () => {
    const floors = store({ android: '9.0.0', ios: '9.0.0' });
    expect(await checkFloor(request('/api/app/ui', { 'x-shytalk-platform': 'web' }), floors)).toBeNull();
    expect(floors.calls).toEqual([]);
  });

  it.each(['/api/app/health', '/api/app/live/announce'])('lets %s through with no headers', async (path) => {
    expect(await checkFloor(request(path), store({ android: '9.0.0' }))).toBeNull();
  });

  it('reads no floor for a call it refuses on its headers alone', async () => {
    const floors = store({ android: '1.0.0' });
    await checkFloor(request('/api/app/ui', appHeaders('android', 'v1')), floors);
    expect(floors.calls).toEqual([]);
  });
});

describe('versions', () => {
  it('reads MAJOR.MINOR.PATCH', () => {
    expect(parseVersion('1.10.0')).toEqual([1, 10, 0]);
  });

  it('reads 0.0.0', () => {
    expect(parseVersion('0.0.0')).toEqual([0, 0, 0]);
  });

  it.each(['1.09.0', '01.0.0', '1.0', '1.0.0-beta', ' 1.0.0', '1.0.0 '])('refuses %j', (text) => {
    expect(parseVersion(text)).toBeNull();
  });

  it('orders by number, not by text: 1.9.0 is under 1.10.0', () => {
    expect(compareVersions([1, 9, 0], [1, 10, 0])).toBe(-1);
  });

  it('orders by major first', () => {
    expect(compareVersions([2, 0, 0], [1, 99, 99])).toBe(1);
  });

  it('orders by patch last', () => {
    expect(compareVersions([1, 2, 3], [1, 2, 4])).toBe(-1);
  });

  it('finds two equal versions equal', () => {
    expect(compareVersions([1, 2, 3], [1, 2, 3])).toBe(0);
  });
});

describe('d1FloorStore', () => {
  const db = (row: { min_version: string } | null) => {
    const asked: { sql: string; args: unknown[] }[] = [];
    return {
      asked,
      prepare: (sql: string): FloorStatement => {
        const statement: FloorStatement = {
          bind: (...args: unknown[]) => {
            asked.push({ sql, args });
            return statement;
          },
          all: () => Promise.resolve({ results: row === null ? [] : [row] }),
        };
        return statement;
      },
    };
  };

  it("reads the platform's row", async () => {
    const stand = db({ min_version: '1.10.0' });
    expect(await d1FloorStore(stand).floor('android')).toBe('1.10.0');
    expect(stand.asked).toEqual([{ sql: 'SELECT min_version FROM app_floor WHERE platform = ?', args: ['android'] }]);
  });

  it('gives no floor when the platform has no row', async () => {
    expect(await d1FloorStore(db(null)).floor('ios')).toBeNull();
  });
});

// The staff page sets only MAJOR.MINOR.PATCH (Task 4); a row that is not one is never trusted to lock every app out.
it('lets an app through when its floor row is not a version', async () => {
  expect(await checkFloor(request('/api/app/ui', appHeaders('android', '1.0.0')), store({ android: 'soon' }))).toBeNull();
});
