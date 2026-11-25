/**
 * The roadmap page's words in each language (shyden-labs/ShyTalk#321 AC3): the page's own lines (`roadmap.*`), and
 * each milestone's public line, found by its English as the board gives it (`milestones.*`, each read back by Google
 * before it was committed). The Worker draws the page with them and the browser redraws a newer board with them.
 */
import en from '../i18n/en.json' with { type: 'json' };
import id from '../i18n/id.json' with { type: 'json' };
import th from '../i18n/th.json' with { type: 'json' };
import vi from '../i18n/vi.json' with { type: 'json' };
import zh from '../i18n/zh.json' with { type: 'json' };
import { t, type Locale } from '../i18n/t.ts';
import type { Lines, Words } from './view.ts';

const WORD_KEYS = [
  'done',
  'started',
  'notStarted',
  'labelDone',
  'labelStarted',
  'labelNotStarted',
  'brings',
  'close',
  'bar',
  'barLabel',
  'mapLabel',
  'unnamed',
  'updated',
] as const satisfies readonly (keyof Words)[];

/** The page's own lines in `locale`. */
export function pageWords(locale: Locale): Words {
  return Object.fromEntries(WORD_KEYS.map((key) => [key, t(locale, `roadmap.${key}`)])) as unknown as Words;
}

const MILESTONES: Record<Exclude<Locale, 'en'>, Record<string, string>> = {
  id: id.milestones,
  th: th.milestones,
  vi: vi.milestones,
  zh: zh.milestones,
};

/** Each milestone line in `locale`, keyed by its English; null for English, whose lines are the board's own. */
export function milestoneLines(locale: Locale): Lines {
  if (locale === 'en') return null;
  const own = MILESTONES[locale];
  return Object.fromEntries(Object.entries(en.milestones).map(([key, english]) => [english, own[key] ?? english]));
}
