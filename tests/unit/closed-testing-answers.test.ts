import { describe, it, expect } from 'vitest';
import { applyMessage, confirmTarget } from '../../apps/web/src/closed-testing/answers.ts';

/**
 * What the closed-testing pages do with each API answer (plan 3 Task 5,
 * shyden-labs/ShyTalk#55). Only a 202 may say a mail is on its way.
 */
describe('applyMessage', () => {
  it.each([
    [202, 'sent'],
    [400, 'invalid'],
    [429, 'tooMany'],
    [503, 'sendFailed'],
    [500, 'sendFailed'],
    [404, 'sendFailed'],
  ] as const)('a %i says %s', (status, key) => {
    expect(applyMessage(status)).toBe(key);
  });
});

describe('confirmTarget', () => {
  it.each([
    [200, 'confirmed'],
    [410, 'link-expired'],
    [503, null],
    [500, null],
  ] as const)('a %i goes to %s', (status, target) => {
    expect(confirmTarget(status)).toBe(target);
  });
});
