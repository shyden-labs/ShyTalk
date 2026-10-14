'use strict';

/**
 * set-testflight-whats-new.test.js — SHY-0361.
 *
 * The iOS half of "tester notes name the ticket": the note goes into the
 * build's TestFlight "What to Test" text. The build only appears in App Store
 * Connect some minutes after upload, so the script waits for it, checking every
 * 30 s, and fails at 15 min naming the build (Shyden, 2026-10-14). Loaded
 * in-process with a stand-in client and Jest's fake clock: no network, no real
 * waiting.
 */

const {
  WAIT_CEILING_MS,
  WAIT_INTERVAL_MS,
  appIdFor,
  findBuild,
  setWhatsNew,
} = require('../../../scripts/set-testflight-whats-new.js');

/** A stand-in App Store Connect client answering from a script of replies. */
function fakeAsc(replies) {
  const calls = [];
  const asc = async (method, path, body) => {
    calls.push({ method, path, body });
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { asc, calls };
}

/**
 * Settle `promise`, advancing Jest's fake clock through every pause it
 * schedules, and return its outcome. The wait runs through pollUntil, the
 * repository's one sanctioned poll (SHY-0245), on the real timer API; the fake
 * clock makes 15 minutes of looking take no time.
 */
async function settle(promise) {
  const outcome = promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await jest.runAllTimersAsync();
  return outcome;
}

beforeEach(() => jest.useFakeTimers({ now: 0 }));
afterEach(() => jest.useRealTimers());

const target = { appId: 'APP1', buildNumber: '812', marketingVersion: '0.97.1' };

test('the wait is 30 s checks with a 15-minute ceiling', () => {
  expect([WAIT_INTERVAL_MS, WAIT_CEILING_MS]).toEqual([30_000, 900_000]);
});

describe('appIdFor', () => {
  test('finds the app by bundle id', async () => {
    const { asc, calls } = fakeAsc([{ data: [{ id: 'APP1' }] }]);
    await expect(appIdFor(asc, 'com.shyden.shytalk')).resolves.toBe('APP1');
    expect(calls[0].path).toBe('/v1/apps?filter[bundleId]=com.shyden.shytalk');
  });

  test('no such app throws, naming the bundle id', async () => {
    const { asc } = fakeAsc([{ data: [] }]);
    await expect(appIdFor(asc, 'com.x')).rejects.toThrow(/com\.x/);
  });
});

describe('findBuild', () => {
  test('asks for exactly this build number in this marketing version', async () => {
    const { asc, calls } = fakeAsc([{ data: [{ id: 'B1' }] }]);
    await settle(findBuild(asc, target));
    expect(calls[0]).toEqual({
      method: 'GET',
      path: '/v1/builds?filter[app]=APP1&filter[version]=812&filter[preReleaseVersion.version]=0.97.1&limit=2',
      body: undefined,
    });
  });

  test('a build already there is returned without waiting', async () => {
    const { asc } = fakeAsc([{ data: [{ id: 'B1' }] }]);
    expect(await settle(findBuild(asc, target))).toEqual({ value: 'B1' });
    expect(Date.now()).toBe(0);
  });

  test('a build that appears on the third look is returned after two 30 s waits', async () => {
    const { asc } = fakeAsc([{ data: [] }, { data: [] }, { data: [{ id: 'B3' }] }]);
    expect(await settle(findBuild(asc, target))).toEqual({ value: 'B3' });
    expect(Date.now()).toBe(60_000);
  });

  test('a build that never appears fails at 15 min, naming it', async () => {
    const { asc, calls } = fakeAsc(Array.from({ length: 40 }, () => ({ data: [] })));
    const { error } = await settle(findBuild(asc, target));
    expect(error.message).toMatch(
      /build 812 \(0\.97\.1\) did not appear in App Store Connect within 15 min/,
    );
    expect(Date.now()).toBe(900_000);
    expect(calls).toHaveLength(31);
  });

  test('two builds with the same number and version is a fault, not a guess', async () => {
    const { asc } = fakeAsc([{ data: [{ id: 'B1' }, { id: 'B2' }] }]);
    const { error } = await settle(findBuild(asc, target));
    expect(error.message).toMatch(/2 builds.*812/);
  });

  test('an API refusal is not waited out', async () => {
    const { asc, calls } = fakeAsc([new Error('ASC API GET /v1/builds → 401: unauthorised')]);
    const { error } = await settle(findBuild(asc, target));
    expect(error.message).toMatch(/401/);
    expect([Date.now(), calls.length]).toEqual([0, 1]);
  });
});

describe('setWhatsNew', () => {
  test('updates the en-US text when the build already has it', async () => {
    const { asc, calls } = fakeAsc([
      {
        data: [
          { id: 'L-ja', attributes: { locale: 'ja' } },
          { id: 'L-en', attributes: { locale: 'en-US' } },
        ],
      },
      null,
    ]);
    await expect(setWhatsNew(asc, { buildId: 'B1', text: 'What to test: SHY-0361' })).resolves.toBe(
      'updated',
    );
    expect(calls[0].path).toBe('/v1/builds/B1/betaBuildLocalizations');
    expect(calls[1]).toEqual({
      method: 'PATCH',
      path: '/v1/betaBuildLocalizations/L-en',
      body: {
        data: {
          type: 'betaBuildLocalizations',
          id: 'L-en',
          attributes: { whatsNew: 'What to test: SHY-0361' },
        },
      },
    });
  });

  test('creates the en-US text when the build has none', async () => {
    const { asc, calls } = fakeAsc([{ data: [] }, { data: { id: 'L-new' } }]);
    await expect(setWhatsNew(asc, { buildId: 'B1', text: 'note' })).resolves.toBe('created');
    expect(calls[1]).toEqual({
      method: 'POST',
      path: '/v1/betaBuildLocalizations',
      body: {
        data: {
          type: 'betaBuildLocalizations',
          attributes: { locale: 'en-US', whatsNew: 'note' },
          relationships: { build: { data: { type: 'builds', id: 'B1' } } },
        },
      },
    });
  });

  test('refuses an empty note rather than blanking the field', async () => {
    const { asc, calls } = fakeAsc([]);
    await expect(setWhatsNew(asc, { buildId: 'B1', text: ' ' })).rejects.toThrow(/empty/);
    expect(calls).toEqual([]);
  });

  test('Apple refusing the text fails, with its reason', async () => {
    const { asc } = fakeAsc([{ data: [] }, new Error('ASC API POST → 409: too long')]);
    await expect(setWhatsNew(asc, { buildId: 'B1', text: 'x' })).rejects.toThrow(/409: too long/);
  });
});
