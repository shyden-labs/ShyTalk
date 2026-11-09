import { describe, expect, inject, it, vi } from 'vitest';
import { jwtVerify } from 'jose';
import { issuer } from '../support/id-tokens.ts';

// No RSA key is made inside a test or hook: a 2048-bit key took up to 1,032 ms
// under load, past the 1 s limit (shyden-labs/ShyTalk#147). The run's global
// setup makes them once and hands them over.
vi.mock('jose', async (original) => ({
  ...(await original<typeof import('jose')>()),
  generateKeyPair: () => {
    throw new Error('a test made an RSA key; use the keys the global setup made');
  },
}));

describe('the ID-token keys made once for the run', () => {
  it('sign a token the provider key set accepts, without making a key', async () => {
    const provider = await issuer(inject('idTokenKeys'));
    const { payload } = await jwtVerify(await provider.idToken(), provider.keys);
    expect(payload['email']).toBe('ana@example.test');
  });

  it('sign a foreign token with a key outside the provider set', async () => {
    const provider = await issuer(inject('idTokenKeys'));
    await expect(jwtVerify(await provider.idToken({ foreign: true }), provider.keys)).rejects.toThrow('signature verification failed');
  });
});
