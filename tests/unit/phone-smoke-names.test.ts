import { describe, it, expect, vi } from 'vitest';

/**
 * The iPhone Air runs an Appium copy of the smoke suite (Shyden's ruling
 * 2026-11-05, shyden-labs/ShyTalk#112 AC3): its test names must equal the
 * Playwright suite's exactly, in the same order. The Playwright spec is
 * imported with its runner stood in, so each `test(title, …)` it declares is
 * recorded without running; nothing reaches a browser.
 */
const declared = vi.hoisted(() => [] as string[]);
vi.mock('@playwright/test', () => {
  const test = (title: string) => {
    declared.push(title);
  };
  // tests/smoke/fixture.ts adds its fixtures to Playwright's test; the stand-in records titles either way.
  return { test: Object.assign(test, { extend: () => test }), expect: () => undefined };
});
vi.mock('@axe-core/playwright', () => ({ default: vi.fn() }));

import { IPHONE_CASES } from '../phones/iphone-cases.ts';

/**
 * The spec is typed against the DOM in its own project (tests/smoke/tsconfig.json),
 * so it is loaded by a path the root type check does not follow.
 */
const SPEC: string = '../smoke/site.spec.ts';
await import(/* @vite-ignore */ SPEC);

describe('the iPhone copy of the smoke suite', () => {
  it('declares exactly the Playwright suite’s test names, in the same order', () => {
    expect(declared.length).toBeGreaterThan(0);
    expect(IPHONE_CASES.map(({ title }) => title)).toEqual(declared);
  });
});
