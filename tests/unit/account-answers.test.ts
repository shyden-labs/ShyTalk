import { describe, expect, it } from 'vitest';
import { cancelMessage, verifyMessage } from '../../apps/web/src/account/answers.ts';

/**
 * What the sign-up and recovery pages say for each API answer (plan 6 Task 6,
 * shyden-labs/ShyTalk#133). Only a 200 may say a code was accepted or a
 * recovery cancelled; anything unexpected reads as a failure.
 */

describe('verifyMessage', () => {
  it.each([
    [200, 'confirmed'],
    [400, 'invalid'],
    [401, 'codeRefused'],
    [429, 'tooMany'],
    [500, 'failed'],
    [503, 'failed'],
    [0, 'failed'],
  ] as const)('answers %i with %s', (status, message) => {
    expect(verifyMessage(status)).toBe(message);
  });
});

describe('cancelMessage', () => {
  it.each([
    [200, 'cancelled'],
    [400, 'failed'],
    [500, 'failed'],
    [0, 'failed'],
  ] as const)('answers %i with %s', (status, message) => {
    expect(cancelMessage(status)).toBe(message);
  });
});
