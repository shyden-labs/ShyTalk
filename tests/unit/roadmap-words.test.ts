import { describe, it, expect } from 'vitest';
import { milestoneLines, pageWords } from '../../apps/web/src/roadmap/words.ts';
import { LOCALES, t } from '../../apps/web/src/i18n/t.ts';
import en from '../../apps/web/src/i18n/en.json' with { type: 'json' };
import id from '../../apps/web/src/i18n/id.json' with { type: 'json' };

/**
 * The roadmap page's words (shyden-labs/ShyTalk#321 AC3): its own lines from the `roadmap.*` keys, and each
 * milestone's public line in the visitor's language, found by its English as the board gives it.
 */

describe('pageWords', () => {
  it.each(LOCALES)('gives the %s page every roadmap line from its catalogue', (locale) => {
    const words = pageWords(locale);
    expect(Object.keys(words).sort()).toEqual([
      'bar',
      'barLabel',
      'brings',
      'close',
      'done',
      'labelDone',
      'labelNotStarted',
      'labelStarted',
      'mapLabel',
      'notStarted',
      'started',
      'unnamed',
      'updated',
    ]);
    for (const [key, line] of Object.entries(words)) expect(line).toBe(t(locale, `roadmap.${key}`));
  });
});

describe('milestoneLines', () => {
  it('finds each milestone line by its English, with no table for English, whose words are the board’s', () => {
    expect(milestoneLines('en')).toBeNull();
    const lines = milestoneLines('id');
    expect(lines?.[en.milestones.m10Name]).toBe(id.milestones.m10Name);
    expect(lines?.['Live voice rooms']).toBe(id.milestones.m10Brings1);
  });

  it.each(LOCALES.filter((locale) => locale !== 'en'))('holds every milestone line in %s', (locale) => {
    expect(Object.keys(milestoneLines(locale) ?? {}).sort()).toEqual(Object.values(en.milestones).sort());
  });

  it('carries every line brings.ts gives the board', async () => {
    const { BRINGS } = await import('../../workers/web/src/roadmap/brings.ts');
    const lines = milestoneLines('th') ?? {};
    expect(
      Object.values(BRINGS.en)
        .flat()
        .filter((line) => !(line in lines)),
    ).toEqual([]);
  });
});
