import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { withoutCommentLines, withoutYamlComments, withoutYamlQuotes, yamlBlock } from './source-text.ts';
import { SMOKE_TARGETS } from '../smoke/targets.ts';

/**
 * The static checks (issue shyden-labs/repo-template#61): typecheck, lint and format-check run as
 * named steps of CI's required build-and-test job and before every push, with
 * no test suite in the hook. Every text is read with its comments stripped,
 * so a check left only in a comment does not count.
 */

const json = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));
const scripts = (json('package.json') as { scripts: Record<string, string> }).scripts;
const lock = json('package-lock.json') as { packages: Record<string, { version?: string }> };
const playwrightVersion = lock.packages['node_modules/playwright']?.version ?? '';
const ci = withoutYamlQuotes(withoutYamlComments(readFileSync('.github/workflows/ci.yml', 'utf8')));

/** Each step of a job as its name and run line ('' where it has none). */
const steps = (job: string) =>
  job
    .split(/\n(?= {6}- )/)
    .slice(1)
    .map((step) => ({
      name: /^ {6}(?:- | {2})name: (.*)/m.exec(step)?.[1] ?? '',
      run: /^ {6}(?:- | {2})run: (.*)/m.exec(step)?.[1] ?? '',
      if: /^ {6}(?:- | {2})if: (.*)/m.exec(step)?.[1] ?? '',
    }));

/** The docs-only fast path's guard: a step carrying it is skipped for a docs-only change. */
const CODE = 'steps.classify.outputs.scope != docs-only';

describe('package.json', () => {
  it.each([
    ['typecheck', 'tsc --noEmit -p . && tsc --noEmit -p tests/smoke && tsc --noEmit -p apps/web/scripts'],
    ['build:web', 'astro build --root apps/web'],
    ['test:smoke', 'playwright test -c tests/smoke'],
    ['lint', 'eslint --max-warnings 0 .'],
    ['format:check', 'prettier --check .'],
    ['format', 'prettier --write .'],
    ['prepare', 'git config core.hooksPath .githooks'],
  ])('runs %s as %s', (name, command) => {
    expect(scripts[name]).toBe(command);
  });
});

describe('ci.yml', () => {
  // The docs-only fast path (scripts/change-scope.ts): the install, audit and format check always run, since
  // Prettier checks non-Markdown files under docs/; typecheck, lint and the unit suite are skipped for docs.
  it('runs the classifier, install, audit, typecheck, lint and format check as steps of build-and-test, before the unit suite', () => {
    expect(steps(yamlBlock(ci, 'build-and-test', '  '))).toEqual([
      { name: 'The default branch is develop', run: '|', if: '' },
      { name: '', run: '', if: '' },
      { name: '', run: '|', if: '' },
      { name: '', run: '', if: '' },
      { name: '', run: 'node scripts/change-scope.ts', if: '' },
      { name: '', run: 'node scripts/npm-ci.ts', if: '' },
      { name: 'Audit', run: 'node scripts/audit.ts', if: '' },
      { name: 'Typecheck', run: 'npm run typecheck', if: CODE },
      { name: 'Lint', run: 'npm run lint', if: CODE },
      { name: 'Format', run: 'npm run format:check', if: '' },
      { name: '', run: 'npm run test:unit', if: CODE },
    ]);
  });

  // A job skipped through needs: reports "skipped", which a required check takes as a pass, so coverage classifies
  // for itself and still reports.
  it('runs the classifier and install in coverage, and skips only the coverage run for docs', () => {
    expect(steps(yamlBlock(ci, 'coverage', '  '))).toEqual([
      { name: '', run: '', if: '' },
      { name: '', run: '|', if: '' },
      { name: '', run: '', if: '' },
      { name: '', run: 'node scripts/change-scope.ts', if: '' },
      { name: '', run: 'node scripts/npm-ci.ts', if: '' },
      { name: '', run: 'npm run test:coverage', if: CODE },
    ]);
  });

  // shyden-labs/ShyTalk#109: every target the site supports runs the same suite, and their totals are compared.
  it('builds the site for dev and runs the smoke against that build, so a preview’s addresses are checked (shyden-labs/ShyTalk#198)', () => {
    expect(yamlBlock(ci, 'web-smoke', '  ').split('\n').slice(0, 9)).toEqual([
      '  web-smoke:',
      '    runs-on: ubuntu-26.04',
      '    timeout-minutes: 20',
      '    container:',
      `      image: mcr.microsoft.com/playwright:v${playwrightVersion}-resolute`,
      // Root, so Edge can be installed (shyden-labs/ShyTalk#239); Firefox refuses root with another user's HOME,
      // so root gets its own inside the container only (the runner's docker would read it too at job level).
      '      env:',
      '        HOME: /root',
      '    env:',
      '      SITE_ENVIRONMENT: dev',
    ]);
  });

  // shyden-labs/ShyTalk#281: the browsers and their system libraries come in Microsoft's image for the exact Playwright
  // in the lockfile, so no run waits on the runner's apt mirror.
  it('runs web-smoke in the Playwright image of the lockfile’s Playwright version', () => {
    expect(playwrightVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(yamlBlock(ci, 'web-smoke', '  ')).toContain(`image: mcr.microsoft.com/playwright:v${playwrightVersion}-resolute\n`);
  });

  // shyden-labs/ShyTalk#239: the desktop browsers and the one-suite checks come from the shared package
  // @shyden-labs/playwright-devices; Edge is not in Microsoft's image, so it is installed per run.
  it('runs the smoke on Chromium, Firefox, WebKit and Edge', () => {
    expect(SMOKE_TARGETS).toEqual(['chromium', 'firefox', 'webkit', 'msedge']);
  });

  it('builds the site, runs the smoke and checks it is one suite in web-smoke, skipping them for docs', () => {
    expect(steps(yamlBlock(ci, 'web-smoke', '  '))).toEqual([
      { name: '', run: '', if: '' },
      // As root, git refuses the runner user's checkout until it is marked safe (shyden-labs/ShyTalk#239).
      { name: '', run: 'git config --global --add safe.directory $GITHUB_WORKSPACE', if: '' },
      { name: '', run: '|', if: '' },
      { name: '', run: '', if: '' },
      { name: '', run: 'node scripts/change-scope.ts', if: '' },
      { name: '', run: 'node scripts/npm-ci.ts', if: '' },
      { name: 'Install Microsoft Edge', run: 'node_modules/.bin/playwright install --with-deps msedge', if: CODE },
      { name: 'Build the site', run: 'npm run build:web', if: CODE },
      { name: 'Smoke', run: '|', if: CODE },
      {
        name: 'List the tests each browser should run',
        run: 'SMOKE_DOOR_SECRET=list SMOKE_SITE_PASSWORD=list node_modules/.bin/playwright test -c tests/smoke --list --reporter=json > test-results/smoke-list.json',
        if: `\${{ !cancelled() && ${CODE} }}`,
      },
      {
        name: 'One-suite checks over the desktop browsers',
        run: `node_modules/.bin/one-suite --group desktop=${SMOKE_TARGETS.join(',')} --list test-results/smoke-list.json --report test-results/smoke-report.json --assertions test-results/smoke-assertions.json`,
        if: `\${{ !cancelled() && ${CODE} }}`,
      },
    ]);
  });

  // shyden-labs/ShyTalk#59: the first integration suite, on Cloudflare's local
  // engines (vitest.integration.config.ts); a required check (decision 230).
  it('runs the integration suite in its own job, skipping it for docs', () => {
    expect(steps(yamlBlock(ci, 'integration', '  '))).toEqual([
      { name: '', run: '', if: '' },
      { name: '', run: '|', if: '' },
      { name: '', run: '', if: '' },
      { name: '', run: 'node scripts/change-scope.ts', if: '' },
      { name: '', run: 'node scripts/npm-ci.ts', if: '' },
      { name: 'Integration', run: 'npm run test:integration', if: CODE },
    ]);
  });

  it('fetches the parent commit in all four jobs, so the classifier can diff it', () => {
    expect(ci.match(/^ {10}fetch-depth: 2$/gm)).toHaveLength(4);
  });
});

describe('.githooks/pre-push', () => {
  // Issue shyden-labs/repo-template#65: the checks run on each pushed commit, in scripts/pre-push.ts (tested in pre-push.test.ts), never on the working tree.
  it('hands the push, stdin included, to the script that checks each pushed commit, and runs no test suite', () => {
    const commands = withoutCommentLines(readFileSync('.githooks/pre-push', 'utf8'))
      .split('\n')
      .filter((line) => line.trim() !== '');
    expect(commands).toEqual(['set -euo pipefail', 'exec node scripts/pre-push.ts "$@"']);
  });

  it('is executable, so git runs it', () => {
    expect(statSync('.githooks/pre-push').mode & 0o111).toBe(0o111);
  });
});

describe('tsconfig.json', () => {
  it('checks every .ts and .js file under the strict settings, emitting nothing', () => {
    const { compilerOptions: o, include } = json('tsconfig.json') as { compilerOptions: Record<string, unknown>; include: string[] };
    expect({
      include,
      strict: o.strict,
      noUncheckedIndexedAccess: o.noUncheckedIndexedAccess,
      exactOptionalPropertyTypes: o.exactOptionalPropertyTypes,
      checkJs: o.checkJs,
      noEmit: o.noEmit,
      erasableSyntaxOnly: o.erasableSyntaxOnly,
      module: o.module,
    }).toEqual({
      include: ['**/*.ts', '**/*.js'],
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      checkJs: true,
      noEmit: true,
      erasableSyntaxOnly: true,
      module: 'nodenext',
    });
  });
});

describe('.prettierrc.json', () => {
  it('formats at the measured width, 140, with single quotes', () => {
    expect(json('.prettierrc.json')).toEqual({ printWidth: 140, singleQuote: true });
  });
});
