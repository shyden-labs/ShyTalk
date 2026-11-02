import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { t } from '../../apps/web/src/i18n/t.ts';

/**
 * The site's words (plan 3 Task 3, shyden-labs/ShyTalk#53). ShyTalk is not a
 * dating app (CLAUDE.md guardrail), and to the public the app is still being
 * built, never rebuilt (decision 212). The English and Google's English
 * read-back of every other language are checked, so a translation that drifts
 * is caught in the words a reviewer can read.
 */

/**
 * The public voice (Shyden 2026-11-02, every project): to the public, ShyTalk
 * is neither a team nor one person working alone, so its words never say "we",
 * "our", "I" or "the team", nor "solo" or "small team". Neutral wording first.
 */
const FIRST_PERSON = /\b(we|we're|we've|we'll|us|our|ours|I|I'm|I've|me|my|the team|solo|just me|one-person|small team)\b/i;

const REFUSED = /\b(partners?|match(es|ing)?|dat(e|es|ing)|couples?|soulmates?|meet someone|rebuild|rebuilt|relaunch(ed)?)\b/i;

const englishLines = (): string[] => {
  const lines: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') lines.push(node);
    else if (node && typeof node === 'object') Object.values(node).forEach(walk);
  };
  walk(JSON.parse(readFileSync('apps/web/src/i18n/en.json', 'utf8')));
  return lines;
};

/** Google's English column of a committed read-back table (`| key | English | mine | Google's |`). */
const googleColumn = (locale: string): string[] =>
  readFileSync(`apps/web/src/i18n/read-back/${locale}.md`, 'utf8')
    .split('\n')
    .filter((row) => row.startsWith('| ') && !row.startsWith('| Key ') && !row.startsWith('| ---'))
    .map((row) => row.split(' | ').at(-1)?.replace(/ \|$/, '') ?? '');

describe('the copy guard', () => {
  it('finds none of the refused words in the English', () => {
    for (const line of englishLines()) expect(line, line).not.toMatch(REFUSED);
  });

  it('finds no first person in the English', () => {
    for (const line of englishLines()) expect(line, line).not.toMatch(FIRST_PERSON);
  });

  it.each(['id', 'th', 'vi', 'zh'])('finds no first person in the %s read-back', (locale) => {
    for (const line of googleColumn(locale)) expect(line, line).not.toMatch(FIRST_PERSON);
  });

  it.each(["We're building it", 'Contact us', 'our moderators', 'I made this', 'a small team'])('calls "%s" first person', (line) => {
    expect(line).toMatch(FIRST_PERSON);
  });

  it.each(['Questions? Email support@shytalk.app', 'moderators enforce them', 'The app is being built'])(
    'lets "%s" through as neutral',
    (line) => {
      expect(line).not.toMatch(FIRST_PERSON);
    },
  );

  it.each(['id', 'th', 'vi', 'zh'])('finds none of the refused words in the %s read-back, which covers every line', (locale) => {
    const read = googleColumn(locale);
    expect(read.length).toBe(englishLines().length);
    for (const line of read) expect(line, line).not.toMatch(REFUSED);
  });

  it.each(['a dating app', 'find a partner', 'the app is rebuilt', 'We relaunched'])('refuses "%s"', (line) => {
    expect(line).toMatch(REFUSED);
  });

  it.each(['update your app', 'candidates welcome', 'mismatched socks'])('lets "%s" through', (line) => {
    expect(line).not.toMatch(REFUSED);
  });
});

/**
 * The approved English of the home page (decision 212, Shyden 2026-10-30), in
 * the public voice (Shyden 2026-11-02): no first person, and the Roadmap
 * sentence waits for the roadmap page (shyden-labs/ShyTalk#38).
 */
describe('the home page English', () => {
  it.each([
    ['home.heading', 'Learn languages and cultures by talking'],
    ['home.intro', 'ShyTalk is a friendly place to practise a language out loud and discover the cultures behind it.'],
    ['home.paceTitle', 'Practise at your own pace.'],
    ['home.paceBody', 'Join a voice room, listen in, and take a seat to speak when you feel ready. Shy is welcome here.'],
    ['home.peopleTitle', 'Learn from the people who live it.'],
    ['home.peopleBody', 'Hear how a language is really spoken, and learn the customs, festivals and everyday life that come with it.'],
    ['home.safeTitle', 'A kind, safe space.'],
    [
      'home.safeBody',
      'Clear community rules keep ShyTalk supportive, and moderators enforce them. Under-18s and adults use separate spaces.',
    ],
    ['home.wayTitle', 'ShyTalk is on its way.'],
    ['home.wayBody', 'The ShyTalk app is being built now. Apply for closed testing to try it early.'],
    ['home.apply', 'Apply for closed testing'],
    ['home.roadmap', 'See the roadmap'],
  ])('%s is the approved line', (key, line) => {
    expect(t('en', key)).toBe(line);
  });
});
