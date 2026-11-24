import { describe, it, expect } from 'vitest';
import { FULL_NAME_WIDTH, nextLocale, wantedLive } from '../support/language-menu.ts';

/** The smoke's expectations for the language menu as drawn (shyden-labs/ShyTalk#332). */
describe('wantedLive', () => {
  it('wants the short name below the full-name width, shut with no entries measured', () => {
    expect(wantedLive('id', FULL_NAME_WIDTH - 1, false)).toEqual({
      open: false,
      listShown: false,
      names: ['ID'],
      flagShown: true,
      summaryTall: true,
      entriesTall: null,
      noSideScroll: true,
      width: FULL_NAME_WIDTH - 1,
    });
  });

  it('wants the full name from the full-name width up, open with every entry tall', () => {
    expect(wantedLive('id', FULL_NAME_WIDTH, true)).toMatchObject({
      open: true,
      listShown: true,
      names: ['Bahasa Indonesia'],
      entriesTall: true,
    });
  });
});

describe('nextLocale', () => {
  it('picks the next language in the menu’s order, wrapping from the last to the first', () => {
    expect(nextLocale('en')).toBe('id');
    expect(nextLocale('zh')).toBe('en');
  });
});
