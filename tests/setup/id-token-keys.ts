import { exportJWK, generateKeyPair, type JWK } from 'jose';
import type { TestProject } from 'vitest/node';

/** The RSA keys the ID-token tests sign with, as JWKs (private parts included). */
export interface IdTokenKeys {
  /** The provider's signing key; its public half is the provider's key set. */
  signing: JWK;
  /** A key outside the provider's set, for tokens that must be refused. */
  foreign: JWK;
}

declare module 'vitest' {
  export interface ProvidedContext {
    idTokenKeys: IdTokenKeys;
  }
}

/**
 * Makes the ID-token tests' RSA keys once for the whole unit run, outside any
 * test's or hook's 1 s limit (shyden-labs/ShyTalk#147): a 2048-bit key took
 * 141-1,032 ms on this Mac, and jose refuses smaller keys for RS256.
 */
export default async function setup(project: TestProject): Promise<void> {
  const [signing, foreign] = await Promise.all([
    generateKeyPair('RS256', { extractable: true }),
    generateKeyPair('RS256', { extractable: true }),
  ]);
  project.provide('idTokenKeys', {
    signing: await exportJWK(signing.privateKey),
    foreign: await exportJWK(foreign.privateKey),
  });
}
