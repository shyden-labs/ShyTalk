/**
 * The iPhone copy's checks (shyden-labs/ShyTalk#180 AC7): node's strict asserts
 * and a wait for a text, each counted as it runs, passed or failed, as
 * Playwright counts each `expect` step its twin runs on the OnePlus and on CI.
 * The phone run prints both phones' counts per test and fails where they differ.
 */
import assert from 'node:assert/strict';
import type { SafariPage } from './iphone-cases.ts';

export interface Check {
  /** The checks run so far. */
  readonly count: number;
  equal(actual: unknown, expected: unknown, message?: string): void;
  ok(value: unknown, message?: string): void;
  deepEqual(actual: unknown, expected: unknown, message?: string): void;
  match(text: string, pattern: RegExp, message?: string): void;
  /** A waiting check (Playwright's `expect.poll`, or a waiting `toBeVisible`): counted once, however often it looks. */
  poll<T>(wait: () => Promise<T>): Promise<T>;
  /** Playwright's `toHaveText`: the page shows `text` in `selector` within the page's ceiling. */
  waitForText(page: SafariPage, selector: string, text: string): Promise<void>;
}

/**
 * Node 26's asserts read a string message as a format, and refuse an explicit undefined one: a given message is passed
 * as the format's one argument, and none is passed when none is given.
 */
const said = (message: string | undefined): [] | ['%s', string] => (message === undefined ? [] : ['%s', message]);

export function countingCheck(): Check {
  let count = 0;
  return {
    get count() {
      return count;
    },
    equal(actual, expected, message) {
      count += 1;
      (assert.equal as (...args: unknown[]) => void)(actual, expected, ...said(message));
    },
    ok(value, message) {
      count += 1;
      (assert.ok as (...args: unknown[]) => void)(value, ...said(message));
    },
    deepEqual(actual, expected, message) {
      count += 1;
      (assert.deepEqual as (...args: unknown[]) => void)(actual, expected, ...said(message));
    },
    match(text, pattern, message) {
      count += 1;
      (assert.match as (...args: unknown[]) => void)(text, pattern, ...said(message));
    },
    poll(wait) {
      count += 1;
      return wait();
    },
    waitForText(page, selector, text) {
      count += 1;
      return page.waitForText(selector, text);
    },
  };
}
