/**
 * Reads one locale's lines back into English with Google Cloud Translation
 * (plan 3 Task 2, shyden-labs/ShyTalk#52; global rule: every translation is
 * read back before it is shown or committed):
 *
 *   node scripts/i18n/google-read-back.ts <id|th|vi|zh> [keys…]
 *
 * Reads `apps/web/src/i18n/<locale>.json` against `en.json` (or `$I18N_DIR`),
 * sends the lines to Google under the machine-wide lock and the shared
 * character ledger (~/.config/shyden/, the same files every project uses),
 * and writes `.superpowers/sdd/plan-03/read-back-<locale>.md`: key, English
 * source, my line, Google's English. Nothing that would cross the day's
 * 16,000 characters is sent; any refusal writes no table and exits 1.
 */
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { runIfEntry } from '../cli.ts';
import {
  DAILY_CHARACTERS,
  batches,
  billedCharacters,
  charactersLeft,
  fromGoogleHtml,
  googleKey,
  googleRefusal,
  googleSource,
  googleTexts,
  quotaDay,
  readBackTable,
  readLedger,
  spendWithin,
  takeLock,
  toGoogleHtml,
  type Answer,
  type LedgerFiles,
  type LockClock,
  type PlanItem,
  type ReadRow,
} from './read-back.ts';

const ENDPOINT = 'https://translation.googleapis.com/language/translate/v2';
const LOCALES = ['id', 'th', 'vi', 'zh'];
const USAGE = 'usage: node scripts/i18n/google-read-back.ts <id|th|vi|zh> [keys…]';
// Google v2 takes up to 128 texts a request and advises at most 5,000 characters.
const MAX_TEXTS = 100;
const MAX_CHARS = 5_000;

/** Everything the run touches, so the unit tests stand it all in. */
export interface Deps {
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
  home: string;
  pid: number;
  files: LedgerFiles;
  clock: LockClock;
  now(): Date;
  say(line: string): void;
  fetch(url: string, init: RequestInit): Promise<Response>;
}

/** A catalogue's lines by dotted key, checked to be text. */
function catalogue(files: LedgerFiles, path: string): Map<string, string> {
  const text = files.read(path);
  if (text === undefined) throw new Error(`no catalogue at ${path}`);
  const json: unknown = JSON.parse(text);
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error(`${path} is not a JSON object of lines`);
  const lines = new Map<string, string>();
  const walk = (node: Record<string, unknown>, prefix: string): void => {
    for (const [name, value] of Object.entries(node)) {
      const key = prefix ? `${prefix}.${name}` : name;
      if (typeof value === 'string') lines.set(key, value);
      else if (value && typeof value === 'object' && !Array.isArray(value)) walk(value as Record<string, unknown>, key);
      else throw new Error(`${path}: ${key} is not text`);
    }
  };
  walk(json as Record<string, unknown>, '');
  return lines;
}

async function ask(deps: Deps, key: string, locale: string, batch: readonly PlanItem[]): Promise<Answer> {
  const response = await deps.fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ q: batch.map((item) => item.text), source: googleSource(locale), target: 'en', format: 'html' }),
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return response.ok ? { ok: true, body } : { ok: false, ...googleRefusal(response.status, body) };
}

export async function run(args: string[], deps: Deps): Promise<number> {
  const [locale, ...keys] = args;
  if (locale === undefined || !LOCALES.includes(locale)) throw new Error(USAGE);

  const dir = deps.env['I18N_DIR'] ?? `${deps.cwd}/apps/web/src/i18n`;
  const english = catalogue(deps.files, `${dir}/en.json`);
  const mine = catalogue(deps.files, `${dir}/${locale}.json`);
  const wanted = keys.length > 0 ? keys : [...mine.keys()];
  const rows: ReadRow[] = [];
  const plan: PlanItem[] = wanted.map((key) => {
    const line = mine.get(key);
    if (line === undefined) throw new Error(`${locale} has no line ${key}`);
    const source = english.get(key);
    if (source === undefined) throw new Error(`en has no line ${key}`);
    rows.push({ key, english: source, mine: line, google: '' });
    const text = toGoogleHtml(line);
    return { key, text, chars: billedCharacters(text) };
  });

  const keyFile = `${deps.home}/.config/shyden/google-translate.env`;
  const apiKey = googleKey(deps.env, deps.files.read(keyFile), keyFile);
  const ledgerPath = `${deps.home}/.config/shyden/google-translate-ledger.json`;
  const lockPath = `${deps.home}/.config/shyden/google-translate.lock`;
  const release = await takeLock(
    deps.files,
    lockPath,
    { pid: deps.pid, worktree: deps.cwd, started: deps.now().toISOString() },
    deps.clock,
  );
  try {
    const day = quotaDay(deps.now());
    const needed = plan.reduce((sum, item) => sum + item.chars, 0);
    const left = charactersLeft(readLedger(deps.files, ledgerPath), day);
    if (needed > left) {
      deps.say(`these lines need ${String(needed)} characters and Google's ${day} has ${String(left)} left: nothing was sent`);
      return 1;
    }

    const readings = new Map<string, string>();
    const { spent, stop } = await spendWithin(
      batches(plan, MAX_TEXTS, MAX_CHARS),
      (batch) => batch.reduce((sum, item) => sum + item.chars, 0),
      { files: deps.files, path: ledgerPath, day, limit: DAILY_CHARACTERS, pid: deps.pid },
      (batch) => ask(deps, apiKey, locale, batch),
      (batch, body) => {
        googleTexts(body, batch.length).forEach((reading, at) => readings.set((batch[at] as PlanItem).key, fromGoogleHtml(reading)));
      },
    );
    if (stop) {
      deps.say(stop);
      return 1;
    }

    const table = readBackTable(
      locale,
      rows.map((row) => ({ ...row, google: readings.get(row.key) as string })),
    );
    deps.files.write(`${deps.cwd}/.superpowers/sdd/plan-03/read-back-${locale}.md`, table);
    const total = readLedger(deps.files, ledgerPath)[day] as number;
    deps.say(
      `read ${String(rows.length)} lines of ${locale}, ${String(spent)} characters; Google's ${day} now shows ${String(total)} of ${String(DAILY_CHARACTERS)} spent`,
    );
    return 0;
  } finally {
    release();
  }
}

const say = (line: string): void => {
  process.stdout.write(`google-read-back: ${line}\n`);
};

/** The run's real file system, clock, Google and output. */
export function realDeps(): Deps {
  return {
    env: process.env,
    cwd: process.cwd(),
    home: homedir(),
    pid: process.pid,
    files: {
      read: (path) => {
        try {
          return readFileSync(path, 'utf8');
        } catch {
          return undefined;
        }
      },
      create: (path, text) => {
        let fd: number;
        try {
          fd = openSync(path, 'wx');
        } catch {
          return false;
        }
        writeSync(fd, text);
        closeSync(fd);
        return true;
      },
      write: (path, text) => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text);
      },
      rename: (from, to) => {
        renameSync(from, to);
      },
      remove: (path) => {
        rmSync(path, { force: true });
      },
    },
    clock: {
      now: () => Date.now(),
      wait: (ms) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms);
        }),
      alive: (pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch (error) {
          // EPERM: the process runs, as someone this one cannot signal.
          return (error as { code?: string }).code === 'EPERM';
        }
      },
      say,
    },
    now: () => new Date(),
    say,
    fetch: (url, init) => fetch(url, init),
  };
}

/** The CLI: a run with the real deps. */
export const main = (args: string[]): Promise<number> => run(args, realDeps());

await runIfEntry(import.meta.url, main);
