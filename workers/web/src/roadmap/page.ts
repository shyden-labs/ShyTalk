/** Stub (shyden-labs/ShyTalk#321 AC3): the tests run red before the code exists. */
import type { Lines, Words } from '../../../../apps/web/src/roadmap/view.ts';

export const MARKS = {
  map: '<!--roadmap:map-->',
  bar: '<!--roadmap:bar-->',
  updated: '<!--roadmap:updated-->',
  snapshot: '<!--roadmap:snapshot-->',
};

export const roadmapLocale: (pathname: string) => string | null = () => 'stub';

export const fillPage: (html: string, snapshot: unknown, locale: string, words: Words, lines: Lines) => string = (html) => html;
