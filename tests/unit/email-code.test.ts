import { describe, expect, it } from 'vitest';
import { addressHash, codeHash, newCode, newToken, normaliseAddress, tokenHash } from '../../workers/web/src/app/email-code.ts';

/**
 * The email code's rules (plan 6 Task 1, shyden-labs/ShyTalk#133): one
 * spelling per address, keyed hashes, uniform 6-digit codes, and one-time
 * tokens of which only the hash is kept.
 */

const SECRET = 'a-unit-secret-long-enough-for-hmac';

describe('normaliseAddress', () => {
  it('trims and lower-cases an address, so start and verify agree', () => {
    expect(normaliseAddress(' A@Example.TEST ')).toBe('a@example.test');
  });

  it('refuses what is not a mail address', () => {
    expect(normaliseAddress(`${'a'.repeat(243)}@example.test`)).toBeNull(); // 256 characters
    expect(normaliseAddress('no-at-sign.example.test')).toBeNull();
    expect(normaliseAddress(42)).toBeNull();
    expect(normaliseAddress(null)).toBeNull();
    expect(normaliseAddress('')).toBeNull();
  });

  it('keeps an address of exactly 254 characters', () => {
    const address = `${'a'.repeat(241)}@example.test`;
    expect(address).toHaveLength(254);
    expect(normaliseAddress(address)).toBe(address);
  });
});

describe('addressHash and codeHash', () => {
  it('hashes one address the same under one secret and differently under another', async () => {
    const first = await addressHash(SECRET, 'a@example.test');
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await addressHash(SECRET, 'a@example.test')).toBe(first);
    expect(await addressHash(`${SECRET}-2`, 'a@example.test')).not.toBe(first);
    expect(await addressHash(SECRET, 'b@example.test')).not.toBe(first);
  });

  it('binds a code to its address', async () => {
    const a = await addressHash(SECRET, 'a@example.test');
    const b = await addressHash(SECRET, 'b@example.test');
    expect(await codeHash(SECRET, a, '123456')).toBe(await codeHash(SECRET, a, '123456'));
    expect(await codeHash(SECRET, a, '123456')).not.toBe(await codeHash(SECRET, b, '123456'));
    expect(await codeHash(SECRET, a, '123456')).not.toBe(await codeHash(SECRET, a, '123457'));
  });
});

describe('newCode', () => {
  it('rejects a draw at or above the uniform bound and uses the next', () => {
    const draws = [4_294_967_295, 4_294_000_000, 7];
    const random = (bytes: Uint8Array): Uint8Array => {
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(0, draws.shift() ?? 0);
      return bytes;
    };
    expect(newCode(random)).toBe('000007');
    expect(draws).toHaveLength(0);
  });

  it('keeps the highest draw below the bound', () => {
    const random = (bytes: Uint8Array): Uint8Array => {
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(0, 4_293_999_999);
      return bytes;
    };
    expect(newCode(random)).toBe('999999');
  });

  it('always answers six digits', () => {
    for (let i = 0; i < 2_000; i += 1) expect(newCode()).toMatch(/^\d{6}$/);
  });
});

describe('tokens', () => {
  it('makes 32 random bytes as base64url', () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(token);
  });

  it('keeps only the SHA-256 of a token', async () => {
    expect(await tokenHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
