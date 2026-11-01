import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { withoutYamlComments } from './source-text.ts';

/**
 * No workflow writes to the repository except the deploy and release ones
 * (issue shyden-labs/repo-template#30; Shyden 2026-10-20: never force-push, and no CI bot pushes).
 * Read from comment-stripped text, so a comment naming `git push` neither
 * trips the guard nor satisfies it.
 */

const WORKFLOWS = '.github/workflows';

/** What writes to the repository: a push, a commit, an amend, or a token that can write. */
const WRITES = [
  /\bgit\s+(?:-\S+\s+(?:\S+\s+)?)*push\b/,
  /\bgit\s+(?:-\S+\s+(?:\S+\s+)?)*commit\b/,
  /--amend\b/,
  /\bcontents:\s*write\b/,
  /\bwrite-all\b/,
];

/** Workflows allowed to write: they deploy or release, and their environments hold the credentials. */
const MAY_WRITE = /^(?:deploy|release)[-.]/;

/** Each `<file>:<line> <text>` that writes, read from the workflow's comment-stripped text. */
function writes(file: string, text: string): string[] {
  return withoutYamlComments(text)
    .split('\n')
    .flatMap((line, i) => (WRITES.some((w) => w.test(line)) ? [`${file}:${i + 1} ${line.trim()}`] : []));
}

const workflows = readdirSync(WORKFLOWS)
  .filter((f) => /\.ya?ml$/.test(f))
  .sort();
const judged = workflows.filter((f) => !MAY_WRITE.test(f));

describe('no workflow writes to the repository', () => {
  it('judges every workflow but the deploy and release ones', () => {
    expect({ judged, allowed: workflows.filter((f) => MAY_WRITE.test(f)) }).toEqual({
      judged: ['check-release-cut.yml', 'ci.yml', 'sonarcloud.yml'],
      allowed: ['deploy-dev.yml', 'deploy-doors.yml'],
    });
  });

  it.each(judged)('%s pushes, commits and amends nothing, and asks for no write token', (file) => {
    expect(writes(file, readFileSync(`${WORKFLOWS}/${file}`, 'utf8'))).toEqual([]);
  });
});

describe('the guard', () => {
  it.each([
    ['a push', '      - run: git push origin HEAD'],
    ['a push with options before it', '      - run: git -C repo push'],
    ['a commit', '        run: git commit -m "floors"'],
    ['an amend', '        run: git commit --amend --no-edit'],
    ['a write token', '      contents: write'],
    ['a write-all token', '    permissions: write-all'],
  ])('names %s', (_kind, line) => {
    expect(writes('w.yml', `jobs:\n${line}\n`)).toEqual([`w.yml:2 ${line.trim()}`]);
  });

  it('reads a comment naming git push as nothing', () => {
    expect(writes('w.yml', 'jobs:\n  # git push is never run here\n')).toEqual([]);
  });

  it('reads a read token and a status read as nothing', () => {
    expect(writes('w.yml', 'permissions:\n  contents: read\n  steps: git status\n')).toEqual([]);
  });

  it.each([['deploy-dev.yml'], ['deploy.yaml'], ['release.yml'], ['release-notes.yml']])('lets %s write', (file) => {
    expect(MAY_WRITE.test(file)).toBe(true);
  });

  it.each([['redeploy.yml'], ['ci.yml'], ['record.yml']])('does not let %s write', (file) => {
    expect(MAY_WRITE.test(file)).toBe(false);
  });
});
