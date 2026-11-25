/** Stub (shyden-labs/ShyTalk#321 AC3): the tests run red before the code exists. */
import type { Locale } from '../i18n/t.ts';
import type { Lines, Words } from './view.ts';

export const pageWords: (locale: Locale) => Words = () => ({}) as Words;
export const milestoneLines: (locale: Locale) => Lines = () => null;
