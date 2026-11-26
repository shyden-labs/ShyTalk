import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { withoutYamlComments } from './source-text.ts';

/**
 * CI caches every download, and still takes a newer version (global rule 2026-11-26; shyden-labs/ShyTalk#375). A cache
 * key is a name, not a lock: any job in the same cache scope can write any key, so only a job holding no secret and
 * no write permission may restore from the cache; every other job downloads fresh. Every job in every workflow is
 * sorted into one kind or the other here, so a new job cannot slip past unsorted. Read from comment-stripped text.
 */

const WORKFLOWS = '.github/workflows';

/** Jobs holding no secret and no write permission: they may restore downloads from the cache. */
const MAY_CACHE = ['ci.yml:build-and-test', 'ci.yml:coverage', 'ci.yml:web-smoke', 'ci.yml:integration'];

/** Jobs holding a secret, an environment or a write permission: they download fresh. */
const DOWNLOADS_FRESH = [
  'check-release-cut.yml:judge-release-cut',
  'ci.yml:sonarcloud',
  'deploy-dev.yml:deploy-dev',
  'deploy-doors.yml:deploy-doors',
  'deploy-release.yml:deploy-release',
  'dev-tail.yml:dev-tail',
  'door-count-trigger.yml:dispatch',
  'door-count.yml:door-count',
  'sonarcloud.yml:sonarcloud',
];

/** Each job of each workflow, as `<file>:<job>`, with its comment-stripped text. */
function jobs(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of readdirSync(WORKFLOWS).filter((name) => name.endsWith('.yml'))) {
    const lines = withoutYamlComments(readFileSync(`${WORKFLOWS}/${file}`, 'utf8')).split('\n');
    const start = lines.findIndex((line) => line === 'jobs:');
    let name: string | undefined;
    let body: string[] = [];
    for (const line of lines.slice(start + 1)) {
      const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
      if (header?.[1] !== undefined) {
        if (name !== undefined) found.set(`${file}:${name}`, body.join('\n'));
        name = header[1];
        body = [];
      } else if (/^\S/.test(line)) {
        break;
      } else {
        body.push(line);
      }
    }
    if (name !== undefined) found.set(`${file}:${name}`, body.join('\n'));
  }
  return found;
}

const ALL = jobs();
const text = (job: string): string => ALL.get(job) ?? '';
const SECRET = /\$\{\{\s*secrets\.|secrets:\s*inherit|^\s*environment:/m;

/** The job's own `permissions:` values, or null when it declares none (and so takes the repository's default). */
function permissions(job: string): string[] | null {
  const lines = text(job).split('\n');
  const at = lines.findIndex((line) => /^ {4}permissions:/.test(line));
  if (at === -1) return null;
  const inline = /^ {4}permissions:\s*(\S.*)$/.exec(lines[at] ?? '')?.[1];
  if (inline !== undefined) return [inline.trim()];
  const values: string[] = [];
  for (const line of lines.slice(at + 1)) {
    const entry = /^ {6}[a-z-]+:\s*(\S+)/.exec(line);
    if (entry?.[1] === undefined) break;
    values.push(entry[1]);
  }
  return values;
}

describe('CI download caching (shyden-labs/ShyTalk#375)', () => {
  it('sorts every job of every workflow into exactly one kind', () => {
    expect([...ALL.keys()].sort()).toEqual([...MAY_CACHE, ...DOWNLOADS_FRESH].sort());
  });

  it.each(MAY_CACHE)('%s holds no secret and declares only read permissions, so it may cache', (job) => {
    expect(SECRET.test(text(job)), 'holds a secret or an environment').toBe(false);
    const declared = permissions(job);
    expect(declared, 'declares no permissions, so it takes the repository default').not.toBeNull();
    expect((declared ?? []).filter((value) => value !== 'read' && value !== 'none')).toEqual([]);
  });

  it.each(DOWNLOADS_FRESH)('%s restores nothing from the cache', (job) => {
    expect(text(job)).not.toMatch(/actions\/cache(?:\/restore)?@|cache:\s*'?npm'?/);
  });

  it('web-smoke restores Edge and its OS packages by prefix, and saves them under the installed version', () => {
    const smoke = text('ci.yml:web-smoke');
    expect(smoke).toMatch(/uses: actions\/cache\/restore@[0-9a-f]{40}/);
    expect(smoke).toMatch(/restore-keys: msedge-debs-/);
    expect(smoke).toMatch(/uses: actions\/cache\/save@[0-9a-f]{40}/);
    expect(smoke).toMatch(/key: msedge-debs-\$\{\{ steps\.edge\.outputs\.version \}\}/);
    expect(smoke).toMatch(/Dir::Cache::Archives/);
  });

  it('web-smoke installs Edge inside a timeout shorter than its step, naming the last download when it stalls', () => {
    const smoke = text('ci.yml:web-smoke');
    expect(smoke).toMatch(/timeout --kill-after=\d+ \d+ [^\n]*playwright install --with-deps msedge/);
    expect(smoke).toMatch(/stalled[^\n]*last download/);
  });
});
