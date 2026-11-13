import { describe, it, expect, vi } from 'vitest';
import { AssertionError } from 'node:assert';
import { countingCheck } from '../phones/check.ts';
import type { SafariPage } from '../phones/iphone-cases.ts';

/**
 * The iPhone copy's checks (shyden-labs/ShyTalk#180 AC7): node's strict
 * asserts and a wait for a text, each counted as it runs, so the iPhone prints
 * the same per-test count Playwright's `expect` steps give the OnePlus and CI.
 */

describe('countingCheck', () => {
  it('starts at none and counts each check that passes', async () => {
    const check = countingCheck();
    expect(check.count).toBe(0);
    check.equal(1, 1);
    check.ok(true, 'never shown');
    check.deepEqual([{ a: 1 }], [{ a: 1 }]);
    const waitForText = vi.fn(() => Promise.resolve());
    await check.waitForText({ waitForText } as unknown as SafariPage, '#answer', 'sent');
    expect(waitForText).toHaveBeenCalledWith('#answer', 'sent');
    expect(check.count).toBe(4);
  });

  it('counts a failing check too, and throws node’s assertion error with its message', async () => {
    const check = countingCheck();
    expect(() => {
      check.equal(1, 2);
    }).toThrow(AssertionError);
    expect(() => {
      check.ok(false, 'no visible navigation');
    }).toThrow('no visible navigation');
    expect(() => {
      check.deepEqual([], [{ id: 'color-contrast' }]);
    }).toThrow(AssertionError);
    const waitForText = () => Promise.reject(new Error('#answer never showed "sent"'));
    await expect(check.waitForText({ waitForText } as unknown as SafariPage, '#answer', 'sent')).rejects.toThrow('never showed');
    expect(check.count).toBe(4);
  });

  it('compares strictly, as Playwright’s toBe and toEqual do', () => {
    const check = countingCheck();
    expect(() => {
      check.equal('1', 1);
    }).toThrow(AssertionError);
    expect(() => {
      check.deepEqual({ a: '1' }, { a: 1 });
    }).toThrow(AssertionError);
  });

  it('counts a pattern match and a waiting check once each, passing on what the wait found', async () => {
    const check = countingCheck();
    check.match('AB12-CD34', /^\w{4}-\w{4}$/);
    expect(() => {
      check.match('AB12', /^\w{4}-\w{4}$/, 'not a code');
    }).toThrow('not a code');
    let looks = 0;
    await expect(check.poll(() => Promise.resolve((looks += 3)))).resolves.toBe(3);
    await expect(check.poll(() => Promise.reject(new Error('waited 60 s for the notice')))).rejects.toThrow('the notice');
    expect(check.count).toBe(4);
  });

  it('keeps one count per check object', () => {
    const first = countingCheck();
    const second = countingCheck();
    first.ok(true);
    expect(second.count).toBe(0);
  });
});
