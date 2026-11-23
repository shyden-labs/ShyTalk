import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { withoutPinnedShas, withoutYamlComments } from './source-text.ts';
import { scanWithoutVerdict, swallowed, tokenGated } from './workflow-honesty.ts';

/**
 * A check is green only if it ran and passed (Shyden 2026-10-18: "don't pass
 * if it doesn't run"; issue shyden-labs/repo-template#27). No workflow swallows a failure, no step runs
 * only when the SonarCloud token is missing, and a scan is always followed by
 * the step that reads its verdict. Each form is planted below and watched red.
 */

const WORKFLOWS = '.github/workflows';
const files = readdirSync(WORKFLOWS)
  .filter((f) => /\.ya?ml$/.test(f))
  .sort();
const read = (f: string) => readFileSync(`${WORKFLOWS}/${f}`, 'utf8');

describe('every workflow', () => {
  it('is judged', () => {
    expect(files).toEqual([
      'check-release-cut.yml',
      'ci.yml',
      'deploy-dev.yml',
      'deploy-doors.yml',
      'deploy-release.yml',
      'dev-tail.yml',
      'door-count-trigger.yml',
      'door-count.yml',
      'sonarcloud.yml',
    ]);
  });

  // #242 (SonarCloud githubactions:S8543, S6505): `npx <tool>` fetches a release from the registry when the
  // installed one is missing; a workflow runs the lockfile's installed binary or fails.
  it.each(files)('%s runs no tool through npx', (file) => {
    expect(
      read(file)
        .split('\n')
        .filter((line) => /\bnpx\b/.test(line) && !/^\s*#/.test(line)),
    ).toEqual([]);
  });

  it.each(files)('%s swallows no failure and gates no step on the token', (file) => {
    expect([...swallowed(file, read(file)), ...tokenGated(file, read(file))]).toEqual([]);
  });
});

describe('sonarcloud.yml', () => {
  it('fails first when the token is missing, naming the key and where it is set', () => {
    expect(withoutPinnedShas(withoutYamlComments(read('sonarcloud.yml')))).toContain(
      [
        '      - name: The SonarCloud token is set',
        '        env:',
        '          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}',
        '        run: |',
        '          if [ -z "$SONAR_TOKEN" ]; then',
        '            echo "::error title=SONAR_TOKEN is missing::Set SONAR_TOKEN as an Actions secret, and as a Dependabot secret for Dependabot pull requests (docs/sonarcloud.md)."',
        '            exit 1',
        '          fi',
        '      - uses: actions/checkout@<sha>',
      ].join('\n'),
    );
  });

  it('scans, then reads the verdict of that scan', () => {
    const text = read('sonarcloud.yml');
    expect({ scans: text.includes('SonarSource/sonarqube-scan-action@'), problems: scanWithoutVerdict('sonarcloud.yml', text) }).toEqual({
      scans: true,
      problems: [],
    });
  });

  // Issue #240: sonar.tests without sonar.sources left the scanner indexing tests/ alone, so the
  // gate passed on no source code (measured 2026-11-17: 0 source files, 136 test files on develop).
  it('scans the source code, with tests as tests', () => {
    expect(read('sonarcloud.yml')).toContain(
      [
        '            -Dsonar.javascript.lcov.reportPaths=coverage/lcov.info',
        '            -Dsonar.sources=.',
        '            -Dsonar.tests=tests',
        '            -Dsonar.exclusions=tests/**',
      ].join('\n'),
    );
  });

  // Issue #240: a pull request's analysis counts only the files it changed, so the verdict is
  // handed the pull request's file list to judge whether no source lines means no scan.
  it("hands the verdict the pull request's changed files", () => {
    expect(read('sonarcloud.yml')).toContain(
      [
        '          SONAR_PULL_REQUEST: ${{ github.event.pull_request.number }}',
        '          BASE_REF: ${{ github.base_ref }}',
        '        run: |',
        '          if [ -n "$SONAR_PULL_REQUEST" ]; then',
        '            git diff --name-only "origin/$BASE_REF...HEAD" > "$RUNNER_TEMP/changed-files.txt"',
        '            export SONAR_CHANGED_FILES="$RUNNER_TEMP/changed-files.txt"',
        '          fi',
        '          node scripts/sonar-verdict.ts .scannerwork/report-task.txt',
      ].join('\n'),
    );
  });
});

describe('the checks', () => {
  it.each([
    ['|| true on a test command', '      - run: npm run test:coverage || true'],
    ['|| exit 0 on a scan', '        run: sonar-scanner || exit 0'],
    ['|| : on a step', '        run: npm test || :'],
    ['continue-on-error', '        continue-on-error: true'],
  ])('names %s', (_kind, line) => {
    expect(swallowed('w.yml', `steps:\n${line}\n`)).toEqual([`w.yml:2 swallows a failure: ${line.trim()}`]);
  });

  it('reads a comment naming || true as nothing', () => {
    expect(swallowed('w.yml', 'steps:\n  # never write || true here\n')).toEqual([]);
  });

  it('names a step that runs only on an empty token', () => {
    expect(tokenGated('w.yml', "steps:\n      - if: env.SONAR_TOKEN == ''\n        run: echo skipped\n")).toEqual([
      "w.yml:2 gates a step on the token: - if: env.SONAR_TOKEN == ''",
    ]);
  });

  it('names a scan with no verdict step after it', () => {
    expect(scanWithoutVerdict('w.yml', 'steps:\n      - uses: SonarSource/sonarqube-scan-action@abc\n')).toEqual([
      'w.yml scans, but no step after it runs scripts/sonar-verdict.ts',
    ]);
  });

  it('names a verdict step that comes before the scan', () => {
    expect(
      scanWithoutVerdict(
        'w.yml',
        'steps:\n      - run: node scripts/sonar-verdict.ts x\n      - uses: SonarSource/sonarqube-scan-action@abc\n',
      ),
    ).toEqual(['w.yml scans, but no step after it runs scripts/sonar-verdict.ts']);
  });

  it('passes a workflow that does not scan', () => {
    expect(scanWithoutVerdict('w.yml', 'steps:\n      - run: npm ci\n')).toEqual([]);
  });
});
