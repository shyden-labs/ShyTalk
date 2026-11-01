/**
 * The translation read-back client's decisions (plan 3 Task 2,
 * shyden-labs/ShyTalk#52; global rule: every translation is read back by
 * Google Cloud Translation before it is shown or committed). Ported from
 * shyden-labs/shyden.co.uk's src/lib/i18n/read-back.ts and google-ledger.ts
 * (shyden-labs/shyden.co.uk#841): the character ledger and its lock live under
 * ~/.config/shyden/ and are shared by every project on the Mac, so their
 * format and protocol are the same here.
 *
 * Pure decisions plus the ledger and lock, with the file system, clock and
 * Google as parameters; scripts/i18n/google-read-back.ts is the wiring.
 */

/**
 * Characters a Google day may spend. Google's free tier is 500,000 a month,
 * and it refuses the request AFTER the one that crosses its own limit
 * (measured by shyden.co.uk, 2026-10-15), so the client keeps its own count
 * and never sends a request that would cross.
 */
export const DAILY_CHARACTERS = 16_000;

/** Characters spent per Google day (`YYYY-MM-DD`); other projects may add `<day> limit` rows. */
export type Ledger = Record<string, number>;

/** Google's quota day: it resets at midnight Pacific time. */
export const quotaDay = (at: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

/** What is left of a day's characters: never less than nothing. */
export const charactersLeft = (ledger: Readonly<Ledger>, day: string, limit = DAILY_CHARACTERS): number =>
  Math.max(0, limit - (ledger[day] ?? 0));

/** The ledger after a request spent `chars` on `day`. */
export const spend = (ledger: Readonly<Ledger>, day: string, chars: number): Ledger => ({ ...ledger, [day]: (ledger[day] ?? 0) + chars });

/** The saved ledger, checked rather than trusted. */
export function parseLedger(json: unknown): Ledger {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('the character ledger is not a table of days');
  for (const [day, chars] of Object.entries(json)) {
    if (!Number.isInteger(chars) || (chars as number) < 0) throw new Error(`the character ledger has a day that is not a count: ${day}`);
  }
  return { ...(json as Ledger) };
}

/** The few file operations the ledger and its lock need. */
export interface LedgerFiles {
  /** The file's text, or `undefined` when there is no such file. */
  read(path: string): string | undefined;
  /** Creates the file only if it is not there; `false` when it was. */
  create(path: string, text: string): boolean;
  write(path: string, text: string): void;
  /** Replaces `to` with `from` in one step. */
  rename(from: string, to: string): void;
  remove(path: string): void;
}

/** The run holding the lock, as its lock file names it. */
export interface Holder {
  pid: number;
  worktree: string;
  started: string;
}

/** Time, and whether a process still runs. */
export interface LockClock {
  now(): number;
  wait(ms: number): Promise<void>;
  alive(pid: number): boolean;
  say(line: string): void;
}

/** A run of the whole day takes seconds, so ten minutes is a run that has hung. */
export const LOCK_CEILING_MS = 10 * 60_000;
const LOCK_POLL_MS = 1_000;

const holderText = (holder: Holder): string => `pid ${holder.pid} in ${holder.worktree}, started ${holder.started}`;

function holderOf(text: string): Holder | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!json || typeof json !== 'object') return undefined;
  const { pid, worktree, started } = json as Record<string, unknown>;
  return Number.isInteger(pid) && typeof worktree === 'string' && typeof started === 'string'
    ? { pid: pid as number, worktree, started }
    : undefined;
}

/**
 * Takes the machine-wide read-back lock, waiting while a live run holds it,
 * and returns the function that gives it back. A lock left by a run that no
 * longer runs is taken over, and the takeover is said aloud.
 */
export async function takeLock(files: LedgerFiles, path: string, me: Holder, clock: LockClock): Promise<() => void> {
  const mine = `${JSON.stringify(me)}\n`;
  const release = (): void => {
    // Only this run's own lock: one taken over after it is not ours to drop.
    if (files.read(path) === mine) files.remove(path);
  };
  const began = clock.now();
  let announced = false;
  for (;;) {
    if (files.create(path, mine)) return release;
    const text = files.read(path);
    // Released between the two calls: take it on the next pass.
    if (text === undefined) continue;
    const holder = holderOf(text);
    if (!holder) throw new Error(`the read-back lock ${path} does not name its holder; remove it by hand once no read-back runs`);
    if (!clock.alive(holder.pid)) {
      clock.say(`taking over the lock left by ${holderText(holder)}, which is no longer running`);
      files.remove(path);
      continue;
    }
    if (clock.now() - began >= LOCK_CEILING_MS) {
      throw new Error(`another read-back still holds ${path} after ${LOCK_CEILING_MS / 60_000} minutes: ${holderText(holder)}`);
    }
    if (!announced) {
      clock.say(`waiting for the read-back held by ${holderText(holder)} (up to ${LOCK_CEILING_MS / 60_000} minutes)`);
      announced = true;
    }
    await clock.wait(LOCK_POLL_MS);
  }
}

/** The ledger as it is on disk now; no file is an empty ledger. */
export function readLedger(files: LedgerFiles, path: string): Ledger {
  const text = files.read(path);
  if (text === undefined) return {};
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`the character ledger ${path} is not JSON`);
  }
  return parseLedger(json);
}

/** Writes the ledger beside itself and renames it over the old one, so a cut-short write leaves the old ledger whole. */
export function writeLedger(files: LedgerFiles, path: string, ledger: Readonly<Ledger>, pid: number): void {
  const temporary = `${path}.${String(pid)}.tmp`;
  files.write(temporary, `${JSON.stringify(ledger, null, 2)}\n`);
  files.rename(temporary, path);
}

/** What one request to Google came back with. */
export type Answer = { ok: true; body: unknown } | { ok: false; quota: boolean; message: string };

/** Where the ledger is, which day it counts, and against which limit. */
export interface LedgerSite {
  files: LedgerFiles;
  path: string;
  day: string;
  limit: number;
  pid: number;
}

/**
 * Sends the requests in order while the ledger, read again before each one,
 * has room for it. A request is counted as soon as Google answers, because a
 * reply that fails its checks was still billed, and added to the ledger as it
 * is then. The first refusal stops the run; nothing is retried.
 */
export async function spendWithin<B>(
  requests: readonly B[],
  charsOf: (request: B) => number,
  site: LedgerSite,
  ask: (request: B) => Promise<Answer>,
  accept: (request: B, body: unknown) => void,
): Promise<{ spent: number; stop: string }> {
  const { files, path, day, limit, pid } = site;
  let spent = 0;
  for (const request of requests) {
    const chars = charsOf(request);
    const before = readLedger(files, path);
    if (chars > charactersLeft(before, day, limit)) {
      return {
        spent,
        stop: `the ledger shows ${String(before[day] ?? 0)} of ${String(limit)} characters spent on Google's ${day}, and the next request needs ${String(chars)}: another run spent the rest`,
      };
    }
    const answer = await ask(request);
    const now = readLedger(files, path);
    if (!answer.ok) {
      // A spent quota closes the day in the ledger too, whatever it counted.
      if (answer.quota) writeLedger(files, path, spend(now, day, charactersLeft(now, day, limit)), pid);
      return { spent, stop: answer.message };
    }
    writeLedger(files, path, spend(now, day, chars), pid);
    spent += chars;
    accept(request, answer.body);
  }
  return { spent, stop: '' };
}

const KEY_NAME = 'GOOGLE_TRANSLATE_API_KEY';

/** The API key: the environment's, else the one shared key file's. The error names where it looked, never a key. */
export function googleKey(env: Readonly<Record<string, string | undefined>>, fileText: string | undefined, filePath: string): string {
  const fromEnv = env[KEY_NAME]?.trim();
  if (fromEnv) return fromEnv;
  const line = (fileText ?? '').split('\n').find((entry) => entry.trimStart().startsWith(`${KEY_NAME}=`));
  const fromFile = line?.slice(line.indexOf('=') + 1).trim();
  if (fromFile) return fromFile;
  throw new Error(`no ${KEY_NAME} in the environment or in ${filePath}`);
}

/** Characters Google bills for a text: code points, so a character outside the BMP counts once. */
export function billedCharacters(text: string): number {
  return Array.from(text).length;
}

/** Google's code for a locale: the site ships Simplified Chinese. */
export const googleSource = (locale: string): string => (locale === 'zh' ? 'zh-CN' : locale);

/** A message slot (`{name}`), which is not copy in any language. */
const SLOT = /\{[^{}]*\}/g;

/** A line as Google is sent it: HTML-escaped, each slot marked not to translate, so it comes back where it was. */
export const toGoogleHtml = (line: string): string =>
  line
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(SLOT, (slot) => `<span translate="no">${slot}</span>`);

const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Google's HTML answer as text: the slot marks taken off and every entity decoded once. */
export const fromGoogleHtml = (reading: string): string =>
  reading.replace(/<\/?span\b[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith('#')) {
      return String.fromCodePoint(/^#x/i.test(name) ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10));
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
  });

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};

/** The readings in an answer, checked: one string per text sent. */
export function googleTexts(response: unknown, expected: number): string[] {
  const translations = record(record(response)['data'])['translations'];
  const texts = Array.isArray(translations) ? translations.map((entry) => record(entry)['translatedText']) : undefined;
  if (!texts?.every((text): text is string => typeof text === 'string')) {
    throw new Error(
      `expected data.translations to be a list of ${String(expected)} { translatedText }, got ${JSON.stringify(translations ?? null).slice(0, 200)}`,
    );
  }
  if (texts.length !== expected) throw new Error(`expected ${String(expected)} translations from Google, got ${String(texts.length)}`);
  return texts;
}

/** The v2 reasons Google gives a spent quota (`dailyLimitExceeded` and kin). */
const QUOTA_REASON = /limitexceeded/i;

/** Why Google said no, and whether it was the daily quota. */
export function googleRefusal(status: number, body: unknown): { quota: boolean; message: string } {
  const error = record(record(body)['error']);
  if (typeof error['message'] !== 'string') {
    return { quota: status === 429, message: `Google refused (${String(status)}): ${JSON.stringify(body ?? null).slice(0, 200)}` };
  }
  const reasons = [
    ...(Array.isArray(error['errors']) ? (error['errors'] as unknown[]) : []),
    ...(Array.isArray(error['details']) ? (error['details'] as unknown[]) : []),
  ].map((entry) => {
    const reason = record(entry)['reason'];
    return typeof reason === 'string' ? reason : '';
  });
  const quota = status === 429 || error['status'] === 'RESOURCE_EXHAUSTED' || reasons.some((reason) => QUOTA_REASON.test(reason));
  const label = typeof error['status'] === 'string' ? ` ${error['status']}` : '';
  return {
    quota,
    message: `${quota ? "Google's daily quota is spent" : 'Google refused'} (${String(status)}${label}): ${error['message']}`,
  };
}

/** One line to read: its catalogue key, the text sent, and the characters it costs. */
export interface PlanItem {
  key: string;
  text: string;
  chars: number;
}

/**
 * The plan as requests of at most `maxTexts` texts and `maxChars` characters,
 * in order. A text longer than the limit goes on its own. Nothing past
 * `allowance` characters in all is sent: the plan stops at the first text that
 * would cross it.
 */
export function batches(plan: readonly PlanItem[], maxTexts: number, maxChars: number, allowance = Number.POSITIVE_INFINITY): PlanItem[][] {
  const out: PlanItem[][] = [];
  let current: PlanItem[] = [];
  let chars = 0;
  let sent = 0;
  for (const item of plan) {
    if (sent + item.chars > allowance) break;
    sent += item.chars;
    if (current.length > 0 && (current.length >= maxTexts || chars + item.chars > maxChars)) {
      out.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += item.chars;
  }
  if (current.length > 0) out.push(current);
  return out;
}

/** One read-back row: the key, the English source, my line, and Google's English. */
export interface ReadRow {
  key: string;
  english: string;
  mine: string;
  google: string;
}

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** The per-line writer/reader table Shyden reads. */
export function readBackTable(locale: string, rows: readonly ReadRow[]): string {
  const lines = rows.map((row) => `| ${cell(row.key)} | ${cell(row.english)} | ${cell(row.mine)} | ${cell(row.google)} |`);
  return `# Read-back: ${locale}\n\n| Key | English source | My line | Google's English |\n| --- | --- | --- | --- |\n${lines.join('\n')}\n`;
}
