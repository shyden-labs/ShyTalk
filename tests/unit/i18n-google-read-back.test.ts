import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, realDeps, run, type Deps } from '../../scripts/i18n/google-read-back.ts';
import { billedCharacters, type LedgerFiles } from '../../scripts/i18n/read-back.ts';

/**
 * The read-back CLI (plan 3 Task 2, shyden-labs/ShyTalk#52):
 *
 *   node scripts/i18n/google-read-back.ts <locale> [keys…]
 *
 * Reads the locale's catalogue against English, asks Google for English,
 * writes the writer/reader table and moves the shared ledger. Google, the
 * files and the clock are stood in, except where the real ones are checked
 * on a temporary folder.
 */

const NOW = new Date('2026-11-02T01:00:00Z'); // Google's day 2026-11-01
const DAY = '2026-11-01';
const HOME = '/home';
const REPO = '/repo';
const I18N = `${REPO}/apps/web/src/i18n`;
const LEDGER = `${HOME}/.config/shyden/google-translate-ledger.json`;
const LOCK = `${HOME}/.config/shyden/google-translate.lock`;
const TABLE = `${REPO}/.superpowers/sdd/plan-03/read-back-th.md`;

function memoryFiles(initial: Record<string, string>): LedgerFiles & { all: Map<string, string> } {
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

interface Sent {
  url: string;
  headers: Headers;
  body: { q: string[]; source: string; target: string; format: string };
}

/** Deps over memory, with Google answering each text by `answer`, or with `status` and `body`. */
function deps(
  options: {
    files?: Record<string, string>;
    env?: Record<string, string>;
    answer?: (text: string) => string;
    status?: number;
    body?: unknown;
  } = {},
): Deps & { files: ReturnType<typeof memoryFiles>; sent: Sent[]; out: string[] } {
  const files = memoryFiles({
    [`${I18N}/en.json`]: JSON.stringify({ home: { title: 'Talk to learn', hi: 'Hi {name}' } }),
    [`${I18N}/th.json`]: JSON.stringify({ home: { title: 'คุยเพื่อเรียน', hi: 'สวัสดี {name}' } }),
    [`${HOME}/.config/shyden/google-translate.env`]: 'GOOGLE_TRANSLATE_API_KEY=the-key\n',
    ...options.files,
  });
  const sent: Sent[] = [];
  const out: string[] = [];
  return {
    files,
    sent,
    out,
    env: options.env ?? {},
    cwd: REPO,
    home: HOME,
    pid: 7,
    now: () => NOW,
    clock: { now: () => 0, wait: () => Promise.resolve(), alive: () => true, say: (line) => out.push(line) },
    say: (line) => out.push(line),
    fetch: (url, init) => {
      const body = JSON.parse(init.body as string) as Sent['body'];
      sent.push({ url, headers: new Headers(init.headers), body });
      if (options.status !== undefined) return Promise.resolve(new Response(JSON.stringify(options.body), { status: options.status }));
      const answer = options.answer ?? ((text: string) => `EN(${text})`);
      return Promise.resolve(Response.json({ data: { translations: body.q.map((text) => ({ translatedText: answer(text) })) } }));
    },
  };
}

const ledger = (d: ReturnType<typeof deps>): Record<string, number> =>
  JSON.parse(d.files.all.get(LEDGER) ?? '{}') as Record<string, number>;

describe('google-read-back', () => {
  it('reads every line of the locale, sends HTML to English with the key, and writes the table', async () => {
    const d = deps({ answer: (text) => (text.includes('{name}') ? 'Hello <span translate="no">{name}</span>' : 'Chat to learn') });
    expect(await run(['th'], d)).toBe(0);
    expect(d.sent).toHaveLength(1);
    const [sent] = d.sent as [Sent];
    expect(sent.url).toBe('https://translation.googleapis.com/language/translate/v2');
    expect(sent.headers.get('x-goog-api-key')).toBe('the-key');
    expect(sent.body).toEqual({
      q: ['คุยเพื่อเรียน', 'สวัสดี <span translate="no">{name}</span>'],
      source: 'th',
      target: 'en',
      format: 'html',
    });
    expect(d.files.all.get(TABLE)).toBe(
      "# Read-back: th\n\n| Key | English source | My line | Google's English |\n| --- | --- | --- | --- |\n" +
        '| home.title | Talk to learn | คุยเพื่อเรียน | Chat to learn |\n| home.hi | Hi {name} | สวัสดี {name} | Hello {name} |\n',
    );
  });

  it('moves the ledger by the characters sent, and says so', async () => {
    const d = deps({ files: { [LEDGER]: JSON.stringify({ [DAY]: 100 }) } });
    expect(await run(['th'], d)).toBe(0);
    const chars = billedCharacters('คุยเพื่อเรียน') + billedCharacters('สวัสดี <span translate="no">{name}</span>');
    expect(ledger(d)).toEqual({ [DAY]: 100 + chars });
    expect(d.out).toContain(
      `read 2 lines of th, ${String(chars)} characters; Google's ${DAY} now shows ${String(100 + chars)} of 16000 spent`,
    );
  });

  it('reads only the keys named', async () => {
    const d = deps();
    expect(await run(['th', 'home.hi'], d)).toBe(0);
    expect((d.sent[0] as Sent).body.q).toEqual(['สวัสดี <span translate="no">{name}</span>']);
  });

  it('reads zh as zh-CN', async () => {
    const d = deps({ files: { [`${I18N}/zh.json`]: JSON.stringify({ home: { title: '聊天学习', hi: '你好 {name}' } }) } });
    expect(await run(['zh'], d)).toBe(0);
    expect((d.sent[0] as Sent).body.source).toBe('zh-CN');
  });

  it('reads the catalogues from I18N_DIR when set', async () => {
    const d = deps({
      env: { I18N_DIR: '/elsewhere' },
      files: { '/elsewhere/en.json': JSON.stringify({ a: 'A' }), '/elsewhere/th.json': JSON.stringify({ a: 'ก' }) },
    });
    expect(await run(['th'], d)).toBe(0);
    expect((d.sent[0] as Sent).body.q).toEqual(['ก']);
  });

  it('refuses before sending when the lines would cross the day, naming the characters needed', async () => {
    const d = deps({ files: { [LEDGER]: JSON.stringify({ [DAY]: 15_990 }) } });
    expect(await run(['th'], d)).toBe(1);
    expect(d.sent).toEqual([]);
    expect(d.out.at(-1)).toMatch(/^these lines need \d+ characters and Google's 2026-11-01 has 10 left: nothing was sent$/);
    expect(d.files.all.has(TABLE)).toBe(false);
  });

  it('marks the day spent and exits 1 on a quota refusal, writing no table', async () => {
    const d = deps({ status: 403, body: { error: { message: 'Daily Limit Exceeded', errors: [{ reason: 'dailyLimitExceeded' }] } } });
    expect(await run(['th'], d)).toBe(1);
    expect(ledger(d)).toEqual({ [DAY]: 16_000 });
    expect(d.out.at(-1)).toBe("Google's daily quota is spent (403): Daily Limit Exceeded");
    expect(d.files.all.has(TABLE)).toBe(false);
  });

  it('reads a refusal that is not JSON as its text', async () => {
    const d = deps();
    d.fetch = () => Promise.resolve(new Response('Service Unavailable', { status: 503 }));
    expect(await run(['th'], d)).toBe(1);
    expect(d.out.at(-1)).toBe('Google refused (503): "Service Unavailable"');
    expect(d.files.all.has(TABLE)).toBe(false);
  });

  it('writes no table when an answer has the wrong shape, still counting what was billed', async () => {
    const d = deps();
    d.fetch = () => Promise.resolve(Response.json({ data: { translations: [] } }));
    await expect(run(['th'], d)).rejects.toThrow('expected 2 translations from Google, got 0');
    expect(d.files.all.has(TABLE)).toBe(false);
    expect(ledger(d)[DAY]).toBeGreaterThan(0);
  });

  it('gives the lock back, even when the run fails', async () => {
    const d = deps();
    d.fetch = () => Promise.reject(new Error('offline'));
    await expect(run(['th'], d)).rejects.toThrow('offline');
    expect(d.files.all.has(LOCK)).toBe(false);
  });

  it.each([[[]], [['en']], [['fr']]])('refuses %j, naming its usage', async (args) => {
    await expect(run(args, deps())).rejects.toThrow('usage: node scripts/i18n/google-read-back.ts <id|th|vi|zh> [keys…]');
  });

  it('refuses a key the locale does not have', async () => {
    await expect(run(['th', 'home.gone'], deps())).rejects.toThrow('th has no line home.gone');
  });

  it('refuses a key English does not have', async () => {
    const d = deps({ files: { [`${I18N}/th.json`]: JSON.stringify({ extra: 'x' }) } });
    await expect(run(['th'], d)).rejects.toThrow('en has no line extra');
  });

  it('refuses a missing catalogue, naming it', async () => {
    await expect(run(['vi'], deps())).rejects.toThrow(`no catalogue at ${I18N}/vi.json`);
  });

  it('refuses a catalogue line that is not text', async () => {
    const d = deps({ files: { [`${I18N}/th.json`]: JSON.stringify({ n: 3 }) } });
    await expect(run(['th'], d)).rejects.toThrow(`${I18N}/th.json: n is not text`);
  });

  it('refuses a catalogue that is not a JSON object', async () => {
    const d = deps({ files: { [`${I18N}/th.json`]: '[1]' } });
    await expect(run(['th'], d)).rejects.toThrow(`${I18N}/th.json is not a JSON object of lines`);
  });

  it('refuses when there is no key', async () => {
    const d = deps({ files: { [`${HOME}/.config/shyden/google-translate.env`]: '' } });
    await expect(run(['th'], d)).rejects.toThrow('no GOOGLE_TRANSLATE_API_KEY');
  });
});

describe('main', () => {
  it('runs with the real deps, refusing a bad locale before touching anything', async () => {
    await expect(main(['fr'])).rejects.toThrow('usage: node scripts/i18n/google-read-back.ts');
  });
});

describe('the real deps', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('do file work on disk, write lines to stdout and send through the runtime fetch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'read-back-'));
    try {
      const real = realDeps();
      const path = join(dir, 'a.txt');
      expect(real.files.read(path)).toBeUndefined();
      expect(real.files.create(path, 'one')).toBe(true);
      expect(real.files.create(path, 'two')).toBe(false);
      real.files.write(join(dir, 'b.txt'), 'b');
      real.files.rename(join(dir, 'b.txt'), path);
      expect(readFileSync(path, 'utf8')).toBe('b');
      real.files.remove(path);
      expect(existsSync(path)).toBe(false);
      real.files.write(join(dir, 'deep', 'c.txt'), 'c');
      expect(real.files.read(join(dir, 'deep', 'c.txt'))).toBe('c');
      writeFileSync(join(dir, 'd.txt'), 'd');
      expect(real.files.read(join(dir, 'd.txt'))).toBe('d');

      expect(real.clock.alive(process.pid)).toBe(true);
      expect(real.clock.alive(2 ** 22 + 12_345)).toBe(false);
      expect(typeof real.clock.now()).toBe('number');
      await real.clock.wait(0);
      expect(real.now()).toBeInstanceOf(Date);

      const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      real.say('hello');
      real.clock.say('again');
      expect(stdout.mock.calls).toEqual([['google-read-back: hello\n'], ['google-read-back: again\n']]);

      const fetched: string[] = [];
      vi.stubGlobal('fetch', (url: string) => {
        fetched.push(url);
        return Promise.resolve(new Response('ok'));
      });
      await real.fetch('https://example.test/', {});
      expect(fetched).toEqual(['https://example.test/']);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('report a process it may not signal as running', () => {
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('not permitted'), { code: 'EPERM' });
    });
    expect(realDeps().clock.alive(1)).toBe(true);
  });
});
