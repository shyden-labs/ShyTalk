import { describe, expect, it } from 'vitest';
import { cbor, der } from '../support/webauthn.ts';

// The test authenticator's CBOR heads (RFC 8949 §3): a value below 24 in the first byte, below 256 in one byte after
// 24, and below 65,536 in two bytes after 25.
describe('the test authenticator’s CBOR', () => {
  it.each<[number, number[]]>([
    [23, [0x17]],
    [24, [0x18, 24]],
    [255, [0x18, 0xff]],
    [256, [0x19, 0x01, 0x00]],
    [65_535, [0x19, 0xff, 0xff]],
    [-300, [0x39, 0x01, 0x2b]],
  ])('writes %i as %j', (value, bytes) => {
    expect([...cbor(value)]).toEqual(bytes);
  });

  it('heads a byte string of 300 bytes with its two-byte length', () => {
    expect([...cbor(new Uint8Array(300)).subarray(0, 3)]).toEqual([0x59, 0x01, 0x2c]);
  });
});

// An ECDSA signature's two 32-byte halves as DER integers (X.690 §8.3): leading zero bytes dropped, one zero added back
// where the top bit is set, so the number stays positive. Fixed bytes, since a random signature meets each case by chance.
describe('the test authenticator’s DER signature', () => {
  const half = (...start: number[]) => Uint8Array.from({ length: 32 }, (_, i) => start[i] ?? 1);

  it('carries halves with neither a leading zero nor the top bit as they are', () => {
    expect([...der(Uint8Array.from([...half(0x11), ...half(0x22)]))]).toEqual([0x30, 68, 0x02, 32, ...half(0x11), 0x02, 32, ...half(0x22)]);
  });

  it('drops leading zero bytes, and pads a half whose top bit is set', () => {
    expect([...der(Uint8Array.from([...half(0, 0, 0x7f), ...half(0x80)]))]).toEqual([
      0x30,
      67,
      0x02,
      30,
      ...half(0, 0, 0x7f).slice(2),
      0x02,
      33,
      0,
      ...half(0x80),
    ]);
  });

  it('keeps one zero byte of a half that is all zeros', () => {
    expect([...der(Uint8Array.from([...new Uint8Array(32), ...half(0x01)]))]).toEqual([0x30, 37, 0x02, 1, 0, 0x02, 32, ...half(0x01)]);
  });
});
