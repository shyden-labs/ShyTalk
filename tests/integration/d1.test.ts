import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { localDev, type LocalDevEnv } from './d1.ts';

/**
 * The D1 test helper (shyden-labs/ShyTalk#159): Miniflare's proxy frees a
 * statement's address once garbage collection finalises it, and a statement
 * passed to `batch` is unreachable when the call returns, while its request
 * may still be queued behind others.
 */
setFlagsFromString('--expose-gc');
const collectGarbage = runInNewContext('gc') as () => void;

let dev: LocalDevEnv;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ env: dev, dispose } = await localDev());
});

afterAll(async () => {
  await dispose();
});

describe('the D1 test helper', () => {
  it('keeps 20 batches at once whole while garbage collection runs, twenty times over', async () => {
    for (let round = 0; round < 20; round += 1) {
      const batches = Array.from({ length: 20 }, () =>
        dev.DB.batch<{ n: number }>([dev.DB.prepare('SELECT 1 AS n'), dev.DB.prepare('SELECT 2 AS n')]),
      );
      collectGarbage();
      await new Promise((resolve) => setImmediate(resolve));
      collectGarbage();
      const answers = await Promise.all(batches);
      expect(answers.map(([first, second]) => [first?.results[0]?.n, second?.results[0]?.n])).toEqual(
        Array.from({ length: 20 }, () => [1, 2]),
      );
    }
  });
});
