import { describe, it, expect } from 'vitest';
import {
  DAILY_CHARACTERS,
  LOCK_CEILING_MS,
  batches,
  billedCharacters,
  charactersLeft,
  fromGoogleHtml,
  googleKey,
  googleRefusal,
  googleSource,
  googleTexts,
  parseLedger,
  quotaDay,
  readBackTable,
  readLedger,
  spend,
  spendWithin,
  takeLock,
  toGoogleHtml,
  writeLedger,
  type Answer,
  type Holder,
  type LedgerFiles,
  type LockClock,
} from '../../scripts/i18n/read-back.ts';

/**
 * The translation read-back client's decisions (plan 3 Task 2,
 * shyden-labs/ShyTalk#52), ported from shyden-labs/shyden.co.uk's
 * src/lib/i18n/read-back.ts and google-ledger.ts. The ledger and lock files
 * are shared with every project on the Mac, so their format is the same.
 * The file system, clock and Google are stood in.
 */

/** An in-memory file system. */
function memoryFiles(initial: Record<string, string> = {}): LedgerFiles & { all: Map<string, string> } {
  const all = new Map(Object.entries(initial));
  return {
    all,
    read: (path) => all.get(path),
    create: (path, text) => {
      if (all.has(path)) return false;
      all.set(path, text);
      return true;
    },
    write: (path, text) => {
      all.set(path, text);
    },
    rename: (from, to) => {
      all.set(to, all.get(from) as string);
      all.delete(from);
    },
    remove: (path) => {
      all.delete(path);
    },
  };
}

const LEDGER = '/home/ledger.json';
const LOCK = '/home/lock';
const DAY = '2026-11-01';

describe('quotaDay: the Google day ends at midnight in Los Angeles', () => {
  it.each([
    ['2026-01-15T07:59:00Z', '2026-01-14'],
    ['2026-01-15T08:00:00Z', '2026-01-15'],
    ['2026-07-15T06:59:00Z', '2026-07-14'],
    ['2026-07-15T07:00:00Z', '2026-07-15'],
  ])('%s is %s', (at, day) => {
    expect(quotaDay(new Date(at))).toBe(day);
  });
});

describe('the ledger', () => {
  it('allows 16,000 characters a day', () => {
    expect(DAILY_CHARACTERS).toBe(16_000);
    expect(charactersLeft({}, DAY)).toBe(16_000);
  });

  it('has nothing left when the day is spent, never less than nothing', () => {
    expect(charactersLeft({ [DAY]: 16_000 }, DAY)).toBe(0);
    expect(charactersLeft({ [DAY]: 17_000 }, DAY)).toBe(0);
  });

  it('adds what a request spent to its day only', () => {
    expect(spend({ '2026-10-31': 5, [DAY]: 10 }, DAY, 7)).toEqual({ '2026-10-31': 5, [DAY]: 17 });
    expect(spend({}, DAY, 7)).toEqual({ [DAY]: 7 });
  });

  it("parses a table of days, including another project's raised-limit entries", () => {
    expect(parseLedger({ [DAY]: 3, [`${DAY} limit`]: 20_000 })).toEqual({ [DAY]: 3, [`${DAY} limit`]: 20_000 });
  });

  it.each([[null], [[]], ['text']])('refuses %j as a ledger', (json) => {
    expect(() => parseLedger(json)).toThrow('the character ledger is not a table of days');
  });

  it.each([[-1], [1.5], ['3']])('refuses a day counting %j', (count) => {
    expect(() => parseLedger({ [DAY]: count })).toThrow(`the character ledger has a day that is not a count: ${DAY}`);
  });

  it('reads no file as an empty ledger, and refuses a file that is not JSON', () => {
    expect(readLedger(memoryFiles(), LEDGER)).toEqual({});
    expect(() => readLedger(memoryFiles({ [LEDGER]: '{' }), LEDGER)).toThrow(`the character ledger ${LEDGER} is not JSON`);
  });

  it('writes beside itself and renames over the old file, leaving no temporary file', () => {
    const files = memoryFiles({ [LEDGER]: '{}' });
    writeLedger(files, LEDGER, { [DAY]: 4 }, 42);
    expect([...files.all.keys()]).toEqual([LEDGER]);
    expect(files.all.get(LEDGER)).toBe(`{\n  "${DAY}": 4\n}\n`);
  });
});

describe('the lock', () => {
  const me: Holder = { pid: 1, worktree: '/repo', started: '2026-11-01T00:00:00Z' };
  const other: Holder = { pid: 2, worktree: '/other', started: '2026-11-01T00:00:00Z' };

  function clock(alive: (pid: number) => boolean, step = 1_000): LockClock & { said: string[]; waited: number } {
    let now = 0;
    const c = {
      said: [] as string[],
      waited: 0,
      now: () => now,
      wait: (ms: number) => {
        now += ms > 0 ? step : 0;
        c.waited += 1;
        return Promise.resolve();
      },
      alive,
      say: (line: string) => {
        c.said.push(line);
      },
    };
    return c;
  }

  it('takes a free lock and gives back only its own', async () => {
    const files = memoryFiles();
    const release = await takeLock(
      files,
      LOCK,
      me,
      clock(() => true),
    );
    expect(JSON.parse(files.all.get(LOCK) as string)).toEqual(me);
    release();
    expect(files.all.has(LOCK)).toBe(false);
  });

  it('leaves a lock another run took over after it', async () => {
    const files = memoryFiles();
    const release = await takeLock(
      files,
      LOCK,
      me,
      clock(() => true),
    );
    files.all.set(LOCK, `${JSON.stringify(other)}\n`);
    release();
    expect(files.all.has(LOCK)).toBe(true);
  });

  it('takes over a lock whose holder no longer runs, saying so', async () => {
    const files = memoryFiles({ [LOCK]: JSON.stringify(other) });
    const c = clock(() => false);
    await takeLock(files, LOCK, me, c);
    expect(c.said).toEqual(['taking over the lock left by pid 2 in /other, started 2026-11-01T00:00:00Z, which is no longer running']);
  });

  it('waits for a live holder, saying whom it waits for once', async () => {
    const files = memoryFiles({ [LOCK]: JSON.stringify(other) });
    const c = clock(() => true);
    const original = c.wait.bind(c);
    c.wait = async (ms) => {
      await original(ms);
      if (c.waited === 2) files.all.delete(LOCK);
    };
    await takeLock(files, LOCK, me, c);
    expect(c.said).toEqual(['waiting for the read-back held by pid 2 in /other, started 2026-11-01T00:00:00Z (up to 10 minutes)']);
    expect(JSON.parse(files.all.get(LOCK) as string)).toEqual(me);
  });

  it('gives up at the ceiling, naming the holder', async () => {
    expect(LOCK_CEILING_MS).toBe(600_000);
    const files = memoryFiles({ [LOCK]: JSON.stringify(other) });
    await expect(
      takeLock(
        files,
        LOCK,
        me,
        clock(() => true, 60_000),
      ),
    ).rejects.toThrow(`another read-back still holds ${LOCK} after 10 minutes: pid 2 in /other, started 2026-11-01T00:00:00Z`);
  });

  it.each([['not json'], ['{"pid":"x"}'], ['null']])('refuses a lock naming no holder: %s', async (text) => {
    const files = memoryFiles({ [LOCK]: text });
    await expect(
      takeLock(
        files,
        LOCK,
        me,
        clock(() => true),
      ),
    ).rejects.toThrow(`the read-back lock ${LOCK} does not name its holder`);
  });

  it('tries again when the lock is released between create and read', async () => {
    const files = memoryFiles();
    let first = true;
    const racing: LedgerFiles = {
      ...files,
      create: (path, text) => {
        if (first) {
          first = false;
          return false;
        }
        return files.create(path, text);
      },
    };
    await takeLock(
      racing,
      LOCK,
      me,
      clock(() => true),
    );
    expect(JSON.parse(files.all.get(LOCK) as string)).toEqual(me);
  });
});

describe('Google requests and answers', () => {
  it('marks each slot not to translate and escapes HTML', () => {
    expect(toGoogleHtml('Hi {name} & <you>')).toBe('Hi <span translate="no">{name}</span> &amp; &lt;you&gt;');
  });

  it('takes the marks off and decodes each entity once', () => {
    expect(fromGoogleHtml('Hi <span translate="no">{name}</span> &amp;lt; &#39;x&#39; &#x41; &quot;q&quot; &bogus;')).toBe(
      'Hi {name} &lt; \'x\' A "q" &bogus;',
    );
  });

  it('round-trips a slot', () => {
    expect(fromGoogleHtml(toGoogleHtml('{count} people'))).toBe('{count} people');
  });

  it('reads Simplified Chinese as zh-CN', () => {
    expect(googleSource('zh')).toBe('zh-CN');
    expect(googleSource('th')).toBe('th');
  });

  it('takes the key from the environment, else the shared key file, never naming it in an error', () => {
    expect(googleKey({ GOOGLE_TRANSLATE_API_KEY: ' k1 ' }, undefined, '/f')).toBe('k1');
    expect(googleKey({}, 'OTHER=x\nGOOGLE_TRANSLATE_API_KEY= k2\n', '/f')).toBe('k2');
    expect(() => googleKey({}, 'GOOGLE_TRANSLATE_API_KEY=\n', '/f')).toThrow('no GOOGLE_TRANSLATE_API_KEY in the environment or in /f');
    expect(() => googleKey({}, undefined, '/f')).toThrow('no GOOGLE_TRANSLATE_API_KEY in the environment or in /f');
  });

  it('reads one translation per text sent', () => {
    expect(googleTexts({ data: { translations: [{ translatedText: 'a' }, { translatedText: 'b' }] } }, 2)).toEqual(['a', 'b']);
  });

  it('refuses an answer of the wrong shape or length', () => {
    expect(() => googleTexts({ data: {} }, 1)).toThrow('expected data.translations to be a list of 1 { translatedText }');
    expect(() => googleTexts({ data: { translations: [{ translatedText: 3 }] } }, 1)).toThrow('expected data.translations');
    expect(() => googleTexts({ data: { translations: [{ translatedText: 'a' }] } }, 2)).toThrow(
      'expected 2 translations from Google, got 1',
    );
  });

  it.each([
    [403, { error: { message: 'Daily Limit Exceeded', errors: [{ reason: 'dailyLimitExceeded' }] } }, true],
    [429, {}, true],
    [403, { error: { message: 'm', status: 'RESOURCE_EXHAUSTED' } }, true],
    [403, { error: { message: 'm', details: [{ reason: 'userRateLimitExceeded' }] } }, true],
    [400, { error: { message: 'bad key', status: 'INVALID_ARGUMENT' } }, false],
    [403, { error: { message: 'm', errors: [{}] } }, false],
    [500, 'oops', false],
  ])('judges a %i refusal as quota %s', (status, body, quota) => {
    expect(googleRefusal(status, body).quota).toBe(quota);
  });

  it('names the refusal', () => {
    expect(googleRefusal(400, { error: { message: 'bad key', status: 'INVALID_ARGUMENT' } }).message).toBe(
      'Google refused (400 INVALID_ARGUMENT): bad key',
    );
    expect(googleRefusal(403, { error: { message: 'Daily Limit Exceeded', errors: [{ reason: 'dailyLimitExceeded' }] } }).message).toBe(
      "Google's daily quota is spent (403): Daily Limit Exceeded",
    );
    expect(googleRefusal(500, 'oops').message).toBe('Google refused (500): "oops"');
    expect(googleRefusal(502, undefined).message).toBe('Google refused (502): null');
  });
});

describe('billedCharacters', () => {
  it('counts code points, so an emoji or a rare Chinese character counts once', () => {
    expect(billedCharacters('abc')).toBe(3);
    expect(billedCharacters('😀𠀀')).toBe(2);
    expect(billedCharacters('')).toBe(0);
  });
});

describe('batches', () => {
  const item = (key: string, chars: number) => ({ key, text: key, chars });

  it('splits at the text and character limits, a long text going alone', () => {
    const plan = [item('a', 3), item('b', 3), item('c', 3), item('d', 10), item('e', 1)];
    expect(batches(plan, 2, 7).map((b) => b.map((i) => i.key))).toEqual([['a', 'b'], ['c'], ['d'], ['e']]);
  });

  it('stops at the first text that would cross the allowance', () => {
    expect(batches([item('a', 3), item('b', 3), item('c', 1)], 10, 100, 5).map((b) => b.map((i) => i.key))).toEqual([['a']]);
  });

  it('makes nothing from nothing', () => {
    expect(batches([], 10, 100)).toEqual([]);
  });
});

describe('spendWithin', () => {
  const site = (files: LedgerFiles) => ({ files, path: LEDGER, day: DAY, limit: 100, pid: 9 });
  const ok = (body: unknown): Promise<Answer> => Promise.resolve({ ok: true, body });

  it('counts each answered request in the ledger as it is then, and hands each answer on', async () => {
    const files = memoryFiles({ [LEDGER]: JSON.stringify({ [DAY]: 10 }) });
    const accepted: unknown[] = [];
    const result = await spendWithin(
      [30, 20],
      (n) => n,
      site(files),
      (n) => {
        // Another run spends 5 while this request is out.
        files.all.set(LEDGER, JSON.stringify({ [DAY]: (readLedger(files, LEDGER)[DAY] ?? 0) + 5 }));
        return ok(n);
      },
      (n, body) => {
        accepted.push([n, body]);
      },
    );
    expect(result).toEqual({ spent: 50, stop: '' });
    expect(accepted).toEqual([
      [30, 30],
      [20, 20],
    ]);
    expect(readLedger(files, LEDGER)).toEqual({ [DAY]: 70 });
  });

  it('never sends a request that would cross the limit, whoever spent the rest', async () => {
    const files = memoryFiles({ [LEDGER]: JSON.stringify({ [DAY]: 90 }) });
    let asked = 0;
    const result = await spendWithin(
      [20],
      (n) => n,
      site(files),
      (n) => {
        asked += 1;
        return ok(n);
      },
      () => undefined,
    );
    expect(asked).toBe(0);
    expect(result.stop).toBe(
      `the ledger shows 90 of 100 characters spent on Google's ${DAY}, and the next request needs 20: another run spent the rest`,
    );
  });

  it('refuses a request bigger than a fresh day, counting a missing day as 0', async () => {
    const result = await spendWithin(
      [101],
      (n) => n,
      site(memoryFiles()),
      (n) => ok(n),
      () => undefined,
    );
    expect(result.stop).toBe(
      `the ledger shows 0 of 100 characters spent on Google's ${DAY}, and the next request needs 101: another run spent the rest`,
    );
  });

  it('closes the day when Google says the quota is spent, and stops', async () => {
    const files = memoryFiles({ [LEDGER]: JSON.stringify({ [DAY]: 10 }) });
    const result = await spendWithin(
      [5, 5],
      (n) => n,
      site(files),
      () => Promise.resolve({ ok: false, quota: true, message: 'spent' }),
      () => undefined,
    );
    expect(result).toEqual({ spent: 0, stop: 'spent' });
    expect(readLedger(files, LEDGER)).toEqual({ [DAY]: 100 });
  });

  it('writes nothing for another refusal, and stops', async () => {
    const files = memoryFiles({ [LEDGER]: JSON.stringify({ [DAY]: 10 }) });
    const result = await spendWithin(
      [5],
      (n) => n,
      site(files),
      () => Promise.resolve({ ok: false, quota: false, message: 'bad key' }),
      () => undefined,
    );
    expect(result).toEqual({ spent: 0, stop: 'bad key' });
    expect(readLedger(files, LEDGER)).toEqual({ [DAY]: 10 });
  });
});

describe('readBackTable', () => {
  it("is a Markdown table of key, English, my line and Google's English, pipes escaped", () => {
    expect(readBackTable('th', [{ key: 'home.title', english: 'Talk | learn', mine: 'คุย', google: 'Chat' }])).toBe(
      "# Read-back: th\n\n| Key | English source | My line | Google's English |\n| --- | --- | --- | --- |\n| home.title | Talk \\| learn | คุย | Chat |\n",
    );
  });
});
