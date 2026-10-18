'use strict';

/**
 * sonarcloud-gate-blocks.test.js — SHY-0625.
 *
 * The SonarCloud job used to pass without judging anything: a step warned and
 * succeeded when SONAR_TOKEN was empty (every Dependabot PR), the scanner never
 * waited for the quality gate, and the Kotlin fallback ended `|| true`. This
 * guard reads the REAL workflow, parsed (so YAML comments are gone by
 * construction) with each `run:` body's shell comments stripped, and refuses
 * every route back to a green job that did not scan and pass:
 *
 *   - a step or the job made conditional on the token, or allowed to fail;
 *   - a test or scan command whose failure is swallowed;
 *   - a missing fail-fast token check before the tests, or a missing verdict
 *     step after the scan.
 *
 * Each detector is first shown, on a small planted workflow, to see every
 * form it hunts; then it judges the real file. The population counts are
 * literal floors at the measured figures (the repo's idiom until SHY-0556
 * moves floors to a record).
 */

const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const yaml = require('js-yaml');

const WORKFLOW = join(__dirname, '..', '..', '..', '.github', 'workflows', 'sonarcloud.yml');

/**
 * Measured 2026-10-18 on the SHY-0625 workflow: 16 steps; 4 test, scan or
 * verdict commands (Express Jest, the Kotlin fallback, the scan, the verdict).
 */
const STEP_FLOOR = 16;
const TEST_OR_SCAN_FLOOR = 4;

/** Drops shell comments: a `#` at a word start, outside quotes. */
function stripShellComments(script) {
  return script
    .split('\n')
    .map((line) => {
      let quote = null;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (quote) {
          if (ch === quote) quote = null;
        } else if (ch === "'" || ch === '"') {
          quote = ch;
        } else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join('\n');
}

/** The commands of a `run:` body, comments gone and `\` continuations joined. */
function commands(run) {
  return stripShellComments(run ?? '')
    .replace(/\\\n/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

const TEST_OR_SCAN =
  /\bgradlew\b|\bjest\b|\bnpm\s+(run\s+)?test\b|\bnode\s+scripts\/sonar-verdict\.js\b/;
const SWALLOWED = /\|\|\s*(true|:|exit\s+0)\b|\|\|\s*:$|\bset\s+\+e\b/;
const MENTIONS_TOKEN = /SONAR_TOKEN/;

function parse(text) {
  const job = yaml.load(text).jobs.sonarcloud;
  return { job, steps: job.steps };
}

const stepName = (step, i) => step.name ?? step.uses ?? `step ${i + 1}`;

/** Steps or the job that run, or are skipped, depending on the token. */
function tokenConditional({ job, steps }) {
  const found = [];
  if (MENTIONS_TOKEN.test(String(job.if ?? ''))) found.push('job');
  steps.forEach((step, i) => {
    if (MENTIONS_TOKEN.test(String(step.if ?? ''))) found.push(stepName(step, i));
  });
  return found;
}

/** The job or any step allowed to fail while the job stays green. */
function allowedToFail({ job, steps }) {
  const found = [];
  if (job['continue-on-error'] !== undefined && job['continue-on-error'] !== false)
    found.push('job');
  steps.forEach((step, i) => {
    const run = commands(step.run).join('\n');
    if (
      TEST_OR_SCAN.test(run) &&
      step['continue-on-error'] !== undefined &&
      step['continue-on-error'] !== false
    ) {
      found.push(stepName(step, i));
    }
  });
  return found;
}

/** Every test or scan command, and those whose failure is swallowed. */
function testOrScanCommands({ steps }) {
  const seen = [];
  const swallowed = [];
  steps.forEach((step, i) => {
    const lines = commands(step.run);
    const scriptSetsPlusE = lines.some((line) => /\bset\s+\+e\b/.test(line));
    for (const line of lines.filter((l) => TEST_OR_SCAN.test(l))) {
      seen.push(line);
      if (SWALLOWED.test(line) || scriptSetsPlusE) swallowed.push(`${stepName(step, i)}: ${line}`);
    }
  });
  return { seen, swallowed };
}

const indexOfStep = (steps, name) => steps.findIndex((step) => step.name === name);
const firstTestOrScan = (steps) =>
  steps.findIndex((step) => commands(step.run).some((l) => TEST_OR_SCAN.test(l)));
const scanIndex = (steps) =>
  steps.findIndex((step) => commands(step.run).some((l) => /\bgradlew\b.*\bsonar\b/.test(l)));

/** The token check: first, unconditional, and exits non-zero on an empty token. */
function requireTokenProblems({ steps }) {
  const at = indexOfStep(steps, 'Require SONAR_TOKEN');
  if (at === -1) return ['no "Require SONAR_TOKEN" step'];
  const step = steps[at];
  const problems = [];
  if (step.if !== undefined) problems.push('it has an if:');
  if (step.env?.SONAR_TOKEN !== '${{ secrets.SONAR_TOKEN }}')
    problems.push('its env does not take SONAR_TOKEN from secrets');
  const body = commands(step.run).join('\n');
  if (!/if \[ -z "\$SONAR_TOKEN" \]; then\n(?:(?!fi\n)[^\n]*\n)*?exit 1\nfi/.test(body))
    problems.push('its run does not exit 1 on an empty token');
  const first = firstTestOrScan(steps);
  if (first !== -1 && at > first) problems.push('it runs after a test or scan step');
  return problems;
}

/** The verdict step: after the scan, unconditional, fed what the reader needs. */
function verdictProblems({ steps }) {
  const at = indexOfStep(steps, 'Read the SonarCloud verdict');
  if (at === -1) return ['no "Read the SonarCloud verdict" step'];
  const step = steps[at];
  const problems = [];
  const scan = scanIndex(steps);
  if (scan === -1) problems.push('no scan step');
  else if (at < scan) problems.push('it runs before the scan');
  if (scan !== -1 && steps[scan].if !== undefined) problems.push('the scan has an if:');
  if (step.if !== undefined) problems.push('it has an if:');
  if (commands(step.run).join('\n') !== 'node scripts/sonar-verdict.js')
    problems.push('its run is not `node scripts/sonar-verdict.js`');
  const want = {
    SONAR_TOKEN: '${{ secrets.SONAR_TOKEN }}',
    REPORT_TASK_PATH: 'build/sonar/report-task.txt',
    EXPECTED_SHA: '${{ inputs.ref }}',
    PR_NUMBER: '${{ github.event.pull_request.number }}',
  };
  for (const [key, value] of Object.entries(want)) {
    if (step.env?.[key] !== value) problems.push(`env ${key} is not ${value}`);
  }
  if (!/^[1-9]\d*$/.test(String(step.env?.CEILING_SECONDS ?? '')))
    problems.push('env CEILING_SECONDS is not a positive whole number');
  return problems;
}

/** A small workflow holding a good token step, scan and verdict, plus `extra`. */
function planted({
  jobExtra = '',
  before = '',
  scanRun = './gradlew sonar -Dsonar.token=$SONAR_TOKEN',
  scanExtra = '',
} = {}) {
  return `
jobs:
  sonarcloud:
    runs-on: ubuntu-latest${jobExtra}
    steps:
      - uses: actions/checkout@0000000000000000000000000000000000000000 # v1
      - name: Require SONAR_TOKEN
        env:
          SONAR_TOKEN: \${{ secrets.SONAR_TOKEN }}
        run: |
          if [ -z "$SONAR_TOKEN" ]; then
            echo "::error::SONAR_TOKEN is empty"
            exit 1
          fi
${before}
      - name: Run SonarCloud analysis${scanExtra}
        env:
          SONAR_TOKEN: \${{ secrets.SONAR_TOKEN }}
        run: ${scanRun}
      - name: Read the SonarCloud verdict
        env:
          SONAR_TOKEN: \${{ secrets.SONAR_TOKEN }}
          REPORT_TASK_PATH: build/sonar/report-task.txt
          CEILING_SECONDS: '300'
          EXPECTED_SHA: \${{ inputs.ref }}
          PR_NUMBER: \${{ github.event.pull_request.number }}
        run: node scripts/sonar-verdict.js
`;
}

describe('the detectors see every planted form', () => {
  test('the planted baseline itself is clean', () => {
    const w = parse(planted());
    expect(tokenConditional(w)).toEqual([]);
    expect(allowedToFail(w)).toEqual([]);
    expect(testOrScanCommands(w)).toEqual({
      seen: ['./gradlew sonar -Dsonar.token=$SONAR_TOKEN', 'node scripts/sonar-verdict.js'],
      swallowed: [],
    });
    expect(requireTokenProblems(w)).toEqual([]);
    expect(verdictProblems(w)).toEqual([]);
  });

  test.each([
    ["if: env.SONAR_TOKEN != ''"],
    ["if: env.SONAR_TOKEN == ''"],
    ["if: ${{ secrets.SONAR_TOKEN != '' }}"],
    ['if: env.SONAR_TOKEN'],
  ])('a scan step with `%s` is token-conditional', (cond) => {
    const w = parse(planted({ scanExtra: `\n        ${cond}` }));
    expect(tokenConditional(w)).toEqual(['Run SonarCloud analysis']);
  });

  test('a skip step that runs only without the token is token-conditional', () => {
    const skip = `      - name: Skip SonarCloud (no token)\n        if: env.SONAR_TOKEN == ''\n        run: echo "::warning::skipped"`;
    expect(tokenConditional(parse(planted({ before: skip })))).toEqual([
      'Skip SonarCloud (no token)',
    ]);
  });

  test('a job conditional on the token is token-conditional', () => {
    const w = parse(planted({ jobExtra: "\n    if: ${{ secrets.SONAR_TOKEN != '' }}" }));
    expect(tokenConditional(w)).toEqual(['job']);
  });

  test.each([['true'], ["${{ github.actor == 'dependabot[bot]' }}"]])(
    'a scan step with continue-on-error: %s is allowed to fail',
    (value) => {
      const w = parse(planted({ scanExtra: `\n        continue-on-error: ${value}` }));
      expect(allowedToFail(w)).toEqual(['Run SonarCloud analysis']);
    },
  );

  test('a job with continue-on-error is allowed to fail', () => {
    expect(allowedToFail(parse(planted({ jobExtra: '\n    continue-on-error: true' })))).toEqual([
      'job',
    ]);
  });

  test.each([
    ['./gradlew sonar || true'],
    ['./gradlew sonar ||true'],
    ['./gradlew sonar || :'],
    ['./gradlew sonar || exit 0'],
    ['./gradlew sonar || true # keep going'],
  ])('`%s` swallows the scan failure', (run) => {
    expect(testOrScanCommands(parse(planted({ scanRun: `"${run}"` }))).swallowed).toEqual([
      `Run SonarCloud analysis: ${run.replace(/ # keep going$/, '')}`,
    ]);
  });

  test('a scan split over a `\\` continuation ending `|| true` is swallowed', () => {
    const run = '|\n          ./gradlew sonar \\\n            -x :app:sonar || true';
    expect(testOrScanCommands(parse(planted({ scanRun: run }))).swallowed).toHaveLength(1);
  });

  test('`set +e` before a scan swallows its failure', () => {
    const run = '|\n          set +e\n          ./gradlew sonar';
    expect(testOrScanCommands(parse(planted({ scanRun: run }))).swallowed).toEqual([
      'Run SonarCloud analysis: ./gradlew sonar',
    ]);
  });

  test.each([
    ['node node_modules/.bin/jest --coverage || true'],
    ['npm test || true'],
    ['npm run test || true'],
  ])('a test command `%s` is judged and swallowed', (run) => {
    const step = `      - name: Tests\n        run: ${run}`;
    expect(testOrScanCommands(parse(planted({ before: step }))).swallowed).toEqual([
      `Tests: ${run}`,
    ]);
  });

  test('`|| true` inside a shell comment is not a swallow', () => {
    const run = '|\n          # ./gradlew sonar || true\n          ./gradlew sonar';
    expect(testOrScanCommands(parse(planted({ scanRun: run })))).toEqual({
      seen: ['./gradlew sonar', 'node scripts/sonar-verdict.js'],
      swallowed: [],
    });
  });

  test('a `#` inside quotes is not a comment', () => {
    expect(stripShellComments('echo "a # b" || true')).toBe('echo "a # b" || true');
  });

  test.each([
    [
      'the token step missing',
      (t) => t.replace('name: Require SONAR_TOKEN', 'name: Something else'),
      'no "Require SONAR_TOKEN" step',
    ],
    [
      'the token step exits 0',
      (t) => t.replace('            exit 1', '            exit 0'),
      'its run does not exit 1 on an empty token',
    ],
    [
      'the token step warns only',
      (t) => t.replace('            exit 1\n', ''),
      'its run does not exit 1 on an empty token',
    ],
    [
      'the token step conditional',
      (t) =>
        t.replace(
          '      - name: Require SONAR_TOKEN\n',
          "      - name: Require SONAR_TOKEN\n        if: github.actor != 'dependabot[bot]'\n",
        ),
      'it has an if:',
    ],
  ])('%s is refused', (_, mutate, problem) => {
    expect(requireTokenProblems(parse(mutate(planted())))).toContain(problem);
  });

  test('a token step after a test step is refused', () => {
    const text = planted().replace(
      '      - name: Require SONAR_TOKEN',
      '      - name: Tests\n        run: npm test\n      - name: Require SONAR_TOKEN',
    );
    expect(requireTokenProblems(parse(text))).toContain('it runs after a test or scan step');
  });

  test.each([
    [
      'the verdict step missing',
      (t) => t.replace('name: Read the SonarCloud verdict', 'name: Read nothing'),
      'no "Read the SonarCloud verdict" step',
    ],
    [
      'the verdict step conditional',
      (t) =>
        t.replace(
          '      - name: Read the SonarCloud verdict\n',
          '      - name: Read the SonarCloud verdict\n        if: success()\n',
        ),
      'it has an if:',
    ],
    [
      'the verdict step running something else',
      (t) =>
        t.replace(
          'run: node scripts/sonar-verdict.js',
          'run: node scripts/sonar-verdict.js || true',
        ),
      'its run is not `node scripts/sonar-verdict.js`',
    ],
    [
      'the ceiling missing',
      (t) => t.replace("          CEILING_SECONDS: '300'\n", ''),
      'env CEILING_SECONDS is not a positive whole number',
    ],
    [
      'the expected commit not the input ref',
      (t) => t.replace('EXPECTED_SHA: ${{ inputs.ref }}', 'EXPECTED_SHA: ${{ github.sha }}'),
      'env EXPECTED_SHA is not ${{ inputs.ref }}',
    ],
    [
      'the scan conditional',
      (t) =>
        t.replace(
          'name: Run SonarCloud analysis',
          "name: Run SonarCloud analysis\n        if: github.event_name == 'push'",
        ),
      'the scan has an if:',
    ],
  ])('%s is refused', (_, mutate, problem) => {
    expect(verdictProblems(parse(mutate(planted())))).toContain(problem);
  });

  test('a verdict step before the scan is refused', () => {
    const w = parse(planted());
    const [verdictStep] = w.steps.splice(indexOfStep(w.steps, 'Read the SonarCloud verdict'), 1);
    w.steps.splice(indexOfStep(w.steps, 'Run SonarCloud analysis'), 0, verdictStep);
    expect(verdictProblems(w)).toContain('it runs before the scan');
  });
});

describe('the real sonarcloud.yml', () => {
  const real = () => parse(readFileSync(WORKFLOW, 'utf8'));

  test('no step and not the job runs or skips on whether the token is set', () => {
    const w = real();
    expect(tokenConditional(w)).toEqual([]);
    expect(w.steps).toHaveLength(STEP_FLOOR);
  });

  test('neither the job nor a test, scan or verdict step may fail while the job passes', () => {
    const w = real();
    expect(allowedToFail(w)).toEqual([]);
    expect(w.steps).toHaveLength(STEP_FLOOR);
  });

  test('no test or scan command swallows its failure', () => {
    const { seen, swallowed } = testOrScanCommands(real());
    expect(swallowed).toEqual([]);
    expect(seen).toHaveLength(TEST_OR_SCAN_FLOOR);
  });

  test('"Require SONAR_TOKEN" fails fast, before any test or scan', () => {
    expect(requireTokenProblems(real())).toEqual([]);
  });

  test('"Read the SonarCloud verdict" follows the scan and is fed what it reads', () => {
    expect(verdictProblems(real())).toEqual([]);
  });
});
