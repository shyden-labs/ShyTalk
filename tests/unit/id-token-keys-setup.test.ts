import { describe, it, expect, vi } from 'vitest';
import type { TestProject } from 'vitest/node';

// A real 2048-bit key takes up to a second (shyden-labs/ShyTalk#147), so jose is stood in: each key pair made is
// numbered, and its exported JWK names that number.
vi.mock('jose', () => {
  let made = 0;
  return {
    generateKeyPair: vi.fn(() => {
      made += 1;
      return Promise.resolve({ privateKey: { pair: made }, publicKey: { pair: -made } });
    }),
    exportJWK: vi.fn((key: { pair: number }) => Promise.resolve({ kid: `pair-${String(key.pair)}` })),
  };
});
const jose = await import('jose');
const { default: setup } = await import('../setup/id-token-keys.ts');

describe('the global setup making the ID-token keys', () => {
  it('makes two extractable RS256 key pairs and provides their two private JWKs as signing and foreign', async () => {
    const provide = vi.fn();
    await setup({ provide } as unknown as TestProject);
    expect(vi.mocked(jose.generateKeyPair).mock.calls).toEqual([
      ['RS256', { extractable: true }],
      ['RS256', { extractable: true }],
    ]);
    expect(provide.mock.calls).toEqual([['idTokenKeys', { signing: { kid: 'pair-1' }, foreign: { kid: 'pair-2' } }]]);
  });
});
