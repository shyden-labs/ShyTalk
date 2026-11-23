import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** The local state folder the migrations were applied in (`--persist-to`). */
    d1Persist: string;
  }
}

/**
 * Applies every migration in `migrations/` to a fresh local DEV database, the
 * way deploy-dev applies them remotely, and hands its folder to the tests.
 * A failed apply stops the suite naming Wrangler's own output.
 */
export default function setup(project: TestProject): () => void {
  const persist = mkdtempSync(join(tmpdir(), 'shytalk-integration-'));
  execFileSync(
    'npx',
    [
      'wrangler',
      'd1',
      'migrations',
      'apply',
      'DB',
      '--config',
      'workers/web/wrangler.json',
      '--env',
      'dev',
      '--local',
      '--persist-to',
      persist,
    ],
    { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' } },
  );
  project.provide('d1Persist', persist);
  return () => {
    rmSync(persist, { recursive: true, force: true });
  };
}
