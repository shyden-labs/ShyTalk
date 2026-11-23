// Better Auth's declarations name three DOM globals that Node's own types do
// not make global (plan 4 Task 3, shyden-labs/ShyTalk#76). `skipLibCheck`
// stays false, so they are made global here from Node's own definitions.
import type { webcrypto } from 'node:crypto';
import type { HeadersInit as UndiciHeadersInit } from 'undici-types';

declare global {
  type HeadersInit = UndiciHeadersInit;
  type BufferSource = NodeJS.BufferSource;
  type JsonWebKey = webcrypto.JsonWebKey;
}
