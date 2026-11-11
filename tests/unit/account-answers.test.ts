import { describe, expect, it } from 'vitest';
import { cancelMessage, removeMessage, setupKey, signInMessage, verifyMessage } from '../../apps/web/src/account/answers.ts';

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

describe('signInMessage', () => {
  it.each([
    [200, null],
    [429, 'tooMany'],
    [400, 'signInRefused'],
    [401, 'signInRefused'],
    [500, 'failed'],
    [503, 'failed'],
    [0, 'failed'],
  ] as const)('answers %i with %s', (status, message) => {
    expect(signInMessage(status)).toBe(message);
  });
});

describe('removeMessage', () => {
  it.each([
    [200, null],
    [409, 'lastMethod'],
    [404, 'failed'],
    [500, 'failed'],
    [0, 'failed'],
  ] as const)('answers %i with %s', (status, message) => {
    expect(removeMessage(status)).toBe(message);
  });
});

describe('setupKey', () => {
  it("shows the link's secret in groups of four", () => {
    expect(
      setupKey('otpauth://totp/ShyTalk:a%40example.test?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=ShyTalk&digits=6&period=30'),
    ).toBe('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP');
  });

  it('keeps a short last group', () => {
    expect(setupKey('otpauth://totp/ShyTalk:a?secret=ABCDEF')).toBe('ABCD EF');
  });

  it('answers nothing for a link without a secret', () => {
    expect(setupKey('otpauth://totp/ShyTalk:a?issuer=ShyTalk')).toBe('');
  });
});
