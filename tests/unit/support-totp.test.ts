import { describe, expect, it } from 'vitest';
import { base32, totpAt } from '../support/totp.ts';

/**
 * The journeys' authenticator app (shyden-labs/ShyTalk#134): it reads the key
 * the page shows (RFC 4648 base32) and computes the code a member's app would.
 */

describe('base32', () => {
  it("decodes RFC 6238's test key, ignoring spaces and case", () => {
    expect(new TextDecoder().decode(base32('GEZD GNBV gy3t QOJQ GEZDGNBVGY3TQOJQ'))).toBe('12345678901234567890');
  });

  it('refuses a character base32 does not have', () => {
    expect(() => base32('GEZD1')).toThrow('not base32: 1');
  });
});

describe('totpAt', () => {
  it('gives the code of the step `offset` steps from now (RFC 6238: 287082 at 59 s)', async () => {
    const secret = new TextEncoder().encode('12345678901234567890');
    expect(await totpAt(secret, 0, 59_000)).toBe('287082');
    expect(await totpAt(secret, -1, 89_000)).toBe('287082');
  });
});
