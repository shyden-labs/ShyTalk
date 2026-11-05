/**
 * The app's UI document: menus, colours, sizes, switches and words, sent by
 * the server (plan 4 Task 5, shyden-labs/ShyTalk#78; live-app design D6).
 * `validateUiDocument` is the only way a document is accepted for publishing.
 */
import * as v from 'valibot';

export const LOCALES = ['en', 'id', 'th', 'vi', 'zh'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * The routes a menu may link to. Anything else is refused, whatever its name,
 * so a server-controlled screen cannot reach a menu under a name nobody
 * listed. A new menu route is added here, in reviewed code, never by editing
 * the document. Grows with the app's screens (plan 6).
 */
export const MENU_ROUTES: readonly string[] = ['rooms'];

/**
 * Screens the server alone opens (ban and suspension, App-Lock, cohort
 * segregation, unsafe device, account deletion): never a menu route, held
 * apart by a test, and named in the refusal when a document tries one.
 */
export const SEALED_ROUTES: readonly string[] = ['ban', 'suspension', 'app-lock', 'cohort', 'unsafe-device', 'delete-account'];

/**
 * Not a dating app (CLAUDE.md guardrail): no key or line, in any language, may
 * name romantic pairing. Each language has its own list and each line is
 * checked against its own language's list; keys, ids and tokens
 * against English. An entry may be several words (Vietnamese writes each
 * syllable apart), matched only when its words stand together.
 */
export type RefusedWords = Record<Locale, readonly string[]>;

/** Thai and Chinese put no spaces between words, so their entries match anywhere in a line. */
const SUBSTRING_LOCALES: ReadonlySet<Locale> = new Set(['th', 'zh']);

const NOT_WORD = /[^\p{L}\p{M}\p{N}]+/gu;

/** NFKC folds full-width and other look-alike forms; format characters (zero-width spaces and joiners) are dropped. */
const fold = (text: string, locale: Locale): string =>
  text
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .toLocaleLowerCase(locale);
const words = (text: string, locale: Locale): string[] => fold(text, locale).split(NOT_WORD).filter(Boolean);
const letters = (text: string, locale: Locale): string => fold(text, locale).replace(NOT_WORD, '');
/** A key's words: `rooms.useRefusedMode` and `zz_refused` split into their words before matching. */
const keyWords = (key: string): string[] =>
  words(key.replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, '$1 $2').replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2'), 'en');
const holdsRun = (haystack: readonly string[], needle: readonly string[]): boolean =>
  haystack.some((_, start) => needle.every((word, i) => haystack[start + i] === word));

type Entry = { word: string; words: string[]; letters: string };
type Lists = Record<Locale, Entry[]>;

function prepare(refused: RefusedWords): Lists {
  const lists = {} as Lists;
  for (const locale of LOCALES)
    lists[locale] = refused[locale].map((word) => {
      const entry = { word, words: words(word, locale), letters: letters(word, locale) };
      if (entry.letters === '') throw new Error(`refused words for ${locale} hold an empty entry`);
      return entry;
    });
  return lists;
}

const lineHits = (line: string, locale: Locale, lists: Lists): string[] => {
  if (SUBSTRING_LOCALES.has(locale)) {
    const text = letters(line, locale);
    return lists[locale].filter((e) => text.includes(e.letters)).map((e) => e.word);
  }
  const text = words(line, locale);
  return lists[locale].filter((e) => holdsRun(text, e.words)).map((e) => e.word);
};
const keyHits = (key: string, lists: Lists): string[] => {
  const text = keyWords(key);
  return lists.en.filter((e) => holdsRun(text, e.words)).map((e) => e.word);
};

const Text = v.pipe(v.string(), v.minLength(1));
const Lines = v.record(Text, Text);
const NavItem = v.strictObject({
  id: Text,
  route: Text,
  /** A copy key, so every menu label is translated. */
  label: Text,
});
const Schema = v.strictObject({
  schemaVersion: v.literal(1),
  navigation: v.array(NavItem),
  tokens: v.record(Text, v.union([v.string(), v.number()])),
  switches: v.record(Text, v.boolean()),
  copy: v.strictObject({ en: Lines, id: Lines, th: Lines, vi: Lines, zh: Lines }),
  // `screens` is reserved for Part 2 (live-app D6): a strict object refuses it until then.
});
export type UiDocument = v.InferOutput<typeof Schema>;

export function validateUiDocument(input: unknown, refused: RefusedWords): { ok: true; doc: UiDocument } | { ok: false; errors: string[] } {
  const lists = prepare(refused);
  const parsed = v.safeParse(Schema, input);
  if (!parsed.success) return { ok: false, errors: parsed.issues.map((issue) => `${v.getDotPath(issue) ?? '(root)'}: ${issue.message}`) };
  const doc = parsed.output;
  const errors: string[] = [];
  const english = Object.keys(doc.copy.en);

  for (const locale of LOCALES) {
    for (const key of english) if (!Object.hasOwn(doc.copy[locale], key)) errors.push(`copy.${locale} is missing ${key}`);
    for (const key of Object.keys(doc.copy[locale]))
      if (!english.includes(key)) errors.push(`copy.${locale} has ${key}, which English lacks`);
  }

  const ids = new Set<string>();
  for (const item of doc.navigation) {
    if (ids.has(item.id)) errors.push(`navigation ${item.id} is listed twice`);
    ids.add(item.id);
    if (SEALED_ROUTES.includes(item.route)) errors.push(`navigation ${item.id} names sealed route ${item.route}`);
    else if (!MENU_ROUTES.includes(item.route)) errors.push(`navigation ${item.id} names route ${item.route}, which is not a menu route`);
    if (!english.includes(item.label)) errors.push(`navigation ${item.id} label ${item.label} is not a copy key`);
    for (const word of keyHits(item.id, lists)) errors.push(`navigation id ${item.id} uses refused word ${word}`);
  }
  for (const [key, value] of Object.entries(doc.tokens)) {
    for (const word of keyHits(key, lists)) errors.push(`tokens key ${key} uses refused word ${word}`);
    if (typeof value === 'string') for (const word of keyHits(value, lists)) errors.push(`tokens value ${key} uses refused word ${word}`);
  }
  for (const key of Object.keys(doc.switches))
    for (const word of keyHits(key, lists)) errors.push(`switches key ${key} uses refused word ${word}`);
  for (const key of english) for (const word of keyHits(key, lists)) errors.push(`copy key ${key} uses refused word ${word}`);
  for (const locale of LOCALES)
    for (const [key, line] of Object.entries(doc.copy[locale]))
      for (const word of lineHits(line, locale, lists)) errors.push(`copy.${locale}.${key} uses refused word ${word}`);

  return errors.length ? { ok: false, errors } : { ok: true, doc };
}
