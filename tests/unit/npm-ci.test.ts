import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { main, warnings } from '../../scripts/npm-ci.ts';
import { withoutYamlComments } from './source-text.ts';

// npm is stood in: a unit test starts no process.
vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
const spawn = vi.mocked(spawnSync);

/**
 * Every dependency install in CI fails on any warning npm prints (issue shyden-labs/repo-template#140;
 * global rule: warnings are build failures). `scripts/npm-ci.ts` runs `npm ci`,
 * passes its output through, and fails naming each warning line, or naming
 * npm's exit when the install itself failed.
 */

const result = (over: Partial<SpawnSyncReturns<string>>): SpawnSyncReturns<string> => ({
  pid: 1,
  output: [],
  stdout: '',
  stderr: '',
  status: 0,
  signal: null,
  ...over,
});

describe('warnings', () => {
  it.each([
    ['npm warn', 'npm warn config production Use `--omit=dev` instead.'],
    ['npm WARN', 'npm WARN EBADENGINE Unsupported engine'],
    ['a deprecation', 'npm warn deprecated inflight@1.0.6: This module is not supported'],
    ['a node warning', '(node:4242) [DEP0040] DeprecationWarning: The `punycode` module is deprecated.'],
  ])('finds %s', (_, line) => {
    expect(warnings(`added 1 package\n${line}\n`)).toEqual([line]);
  });

  it('finds nothing in a clean install', () => {
    expect(warnings('\nadded 212 packages, and audited 213 packages in 3s\n\nfound 0 vulnerabilities\n')).toEqual([]);
  });

  it('does not take a package named after a warning for one', () => {
    expect(warnings('added npm-warn-checker@1.0.0\n')).toEqual([]);
  });
});

describe('main', () => {
  const out = vi.spyOn(process.stdout, 'write');
  const err = vi.spyOn(process.stderr, 'write');

  beforeEach(() => {
    spawn.mockReset();
    out.mockReset().mockReturnValue(true);
    err.mockReset().mockReturnValue(true);
  });

  afterAll(() => {
    out.mockRestore();
    err.mockRestore();
  });

  it('runs npm ci with its output captured, and passes a clean install', () => {
    spawn.mockReturnValue(result({ stdout: 'added 212 packages\n' }));
    expect(main()).toBe(0);
    expect(spawn).toHaveBeenCalledWith('npm', ['ci'], { encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] });
    expect(out).toHaveBeenCalledWith('added 212 packages\n');
  });

  it('fails a warning on stderr, naming each line', () => {
    spawn.mockReturnValue(result({ stderr: 'npm warn deprecated a@1: gone\nnpm WARN b\n' }));
    expect(() => main()).toThrow('npm ci printed 2 warning(s):\nnpm warn deprecated a@1: gone\nnpm WARN b');
    expect(err).toHaveBeenCalledWith('npm warn deprecated a@1: gone\nnpm WARN b\n');
  });

  it('fails a warning on stdout', () => {
    spawn.mockReturnValue(result({ stdout: 'npm warn x\n' }));
    expect(() => main()).toThrow('npm ci printed 1 warning(s):\nnpm warn x');
  });

  it('fails closed on a failing install, naming the exit', () => {
    spawn.mockReturnValue(result({ status: 1, stderr: 'npm error code EUSAGE\n' }));
    expect(() => main()).toThrow('npm ci exited 1');
  });

  it('fails closed when npm is killed', () => {
    spawn.mockReturnValue(result({ status: null, signal: 'SIGKILL' }));
    expect(() => main()).toThrow('npm ci exited on SIGKILL');
  });

  it('fails closed when npm cannot start', () => {
    spawn.mockReturnValue(result({ status: null, error: new Error('spawn npm ENOENT') }));
    expect(() => main()).toThrow('npm ci did not run: spawn npm ENOENT');
  });
});

const WORKFLOWS = '.github/workflows';
const INSTALL = 'node scripts/npm-ci.ts';

/** Each `<file>:<line> <text>` that installs with npm other than through the script. */
function plainInstalls(file: string, text: string): string[] {
  return withoutYamlComments(text)
    .split('\n')
    .flatMap((line, i) => (/\bnpm\s+(?:ci|install|i)\b/.test(line) ? [`${file}:${i + 1} ${line.trim()}`] : []));
}

describe('every workflow installs through the script', () => {
  const workflows = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));

  it('finds no plain npm install in any workflow', () => {
    expect(workflows.flatMap((f) => plainInstalls(f, readFileSync(`${WORKFLOWS}/${f}`, 'utf8')))).toEqual([]);
  });

  it.each([
    ['npm ci', '      - run: npm ci\n'],
    ['npm install', '      - run: npm install\n'],
    ['npm i', '      - run: npm i --no-audit\n'],
    ['a multi-line run', '      - run: |\n          npm ci\n'],
  ])('refuses %s', (_, text) => {
    expect(plainInstalls('ci.yml', text)).toHaveLength(1);
  });

  it('allows the script and a comment naming npm ci', () => {
    expect(plainInstalls('ci.yml', `      # was npm ci\n      - run: ${INSTALL}\n`)).toEqual([]);
  });
});
