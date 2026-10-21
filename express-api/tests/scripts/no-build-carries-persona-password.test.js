'use strict';

/**
 * no-build-carries-persona-password.test.js — SHY-0662.
 *
 * The seeded dev accounts (P-12 is the dev admin) share one password, the
 * `DEV_QA_PERSONAS_PASSWORD` secret. The dev flavour bakes it into the app
 * whenever a build can see it (app/build.gradle.kts), and this repository is
 * public: a PR's `dev-release-apk` artifact could be downloaded by any
 * signed-in GitHub user and the password read out of it. Shyden ruled on
 * 2026-10-20 that no distributed build carries it; SHY-0662 widens that to
 * every build anyone else can download, and retires SHY-0416's opposite
 * claim (that every dev distribution job bakes it in).
 *
 * This guard reads every workflow and composite action git tracks or would
 * track, through the YAML parse (so comments never count), and holds four
 * rules:
 *   1. the secret is named only at the sites in ALLOWED (seeding and API
 *      sign-in, never a build) or as the `password` input of the APK check,
 *      and every secret is handed on whole only to a workflow read here;
 *   2. no allowed step builds an app, nor any local action it uses;
 *   3. every gradle task that packages an app is followed in its job by the
 *      APK check on that variant's output folder, with that variant's
 *      BuildConfig and the same `if:`;
 *   4. every APK or AAB uploaded is checked before the upload and kept at
 *      most 7 days, failing when empty; every one downloaded is checked
 *      after the download.
 * The cross-check counts the name on every non-comment line of the raw text
 * and needs the parse to have seen exactly as many.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { gitVisibleFiles } = require('../helpers/git-visible-files');

const REPO = path.resolve(__dirname, '../../..');
const ROOTS = ['.github/workflows', '.github/actions'];
const KINDS = /\.ya?ml$/;
const CHECK_ACTION = './.github/actions/apk-holds-no-persona-password';
// Every spelling that hands the secret to a step: its name in any case
// (GitHub reads contexts case-insensitively), and the forms that hand over
// every secret at once or one picked at run time.
const NAMING =
  /dev_qa_personas_password|tojson\s*\(\s*secrets\s*\)|\$\{\{\s*secrets\s*\}\}|secrets\s*\[/gi;
const NAME = /dev_qa_personas_password/gi;
const BUILDS = /gradlew|\bgradle\b|xcodebuild|fastlane|build-debug-dev/;
const GRADLE_PACKAGING = /^(?:assemble|bundle|install|package|build)\w*$/;
const VARIANT_TASK = /^(assemble|bundle)(Dev|Prod|Local)(Debug|Release)$/;
const APP_FILE = /\.(apk|aab)\b/;
const MAX_RETENTION_DAYS = 7;

// The only places the secret may be named: the seeding workflow (its
// declaration for callers, its preflight, the seed action) and the journey
// runner, which signs in over the API. None of them builds an app (rule 2).
const ALLOWED = [
  ['.github/workflows/seed-dev-personas.yml', 'on.workflow_call.secrets.DEV_QA_PERSONAS_PASSWORD'],
  [
    '.github/workflows/seed-dev-personas.yml',
    'jobs.seed.steps[Verify required secrets are present]',
  ],
  ['.github/workflows/seed-dev-personas.yml', 'jobs.seed.steps[Run seed action]'],
  ['.github/workflows/manual-qa-matrix.yml', 'jobs.matrix-dispatch.steps[Run manual-qa matrix]'],
];

// Measured 2026-10-21: git-visible YAML files under ROOTS (29 workflows and
// 14 actions, the APK check among them). Equality, so a file added or lost
// is seen and this figure re-measured.
const FILES_READ_FLOOR = 43;
// Measured 2026-10-21: keys and strings naming the secret across those
// files, every one of them judged by rule 1. 12 = seed-dev-personas 4 (the
// declaration key, the preflight's env and its run text, the seed action's
// input) + the journey runner 1 + the APK check's password input 7
// (pr-checks 2, deploy-dev 2, deploy-prod 2, codeql 1).
const SITES_FLOOR = 12;

const lines = (text) => String(text ?? '').split('\n');
const withoutComments = (text) =>
  lines(text)
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
const count = (text, re) => (String(text).match(re) ?? []).length;
const within = (at, root) => at === root || at.startsWith(`${root}.`);

// A step is labelled by its name, else what it uses; a label two steps share
// takes the step's index, so an allowed label can never cover a twin.
function stepLabels(steps) {
  const labels = steps.map((s) => s?.name ?? s?.uses ?? '');
  return labels.map((l, i) => (l && labels.indexOf(l) === labels.lastIndexOf(l) ? l : `${l}#${i}`));
}

// The jobs of a workflow, or a composite action's steps as one job.
function jobsOf(rel, doc) {
  if (rel.startsWith('.github/actions/')) {
    return [{ key: 'action', at: 'runs', job: { steps: doc?.runs?.steps ?? [] } }];
  }
  return Object.entries(doc?.jobs ?? {}).map(([key, job]) => ({ key, at: `jobs.${key}`, job }));
}

function stepsOf(rel, doc) {
  return jobsOf(rel, doc).flatMap(({ key, at, job }) => {
    const steps = Array.isArray(job?.steps) ? job.steps : [];
    const labels = stepLabels(steps);
    return steps.map((step, i) => ({ job: key, i, step, at: `${at}.steps[${labels[i]}]` }));
  });
}

// Every key and string in the document, with the path that reaches it and
// the step it sits in (if any). Shell comment lines inside a `run` are not
// code and are dropped, as the raw cross-check drops YAML comment lines.
function* scalars(node, at, step) {
  if (Array.isArray(node)) {
    const parent = at.at(-1);
    const labels = parent === 'steps' ? stepLabels(node) : node.map((_, i) => `#${i}`);
    for (let i = 0; i < node.length; i++) {
      const here = [...at.slice(0, -1), `${parent}[${labels[i]}]`];
      yield* scalars(
        node[i],
        here,
        parent === 'steps' ? { step: node[i], at: here.join('.') } : step,
      );
    }
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      yield { at: [...at, k].join('.'), text: k, step, key: true };
      yield* scalars(v, [...at, k], step);
    }
  } else if (typeof node === 'string') {
    yield { at: at.join('.'), text: withoutComments(node), step };
  }
}

const isCheck = (step) => step?.uses === CHECK_ACTION;
const checkDirs = (step) =>
  lines(step?.with?.dir)
    .map((l) => l.trim())
    .filter(Boolean);

function allowedSite(rel, site) {
  if (ALLOWED.some(([file, root]) => file === rel && within(site.at, root))) return true;
  return isCheck(site.step?.step) && site.at === `${site.step.at}.with.password`;
}

// Rule 2: an allowed step, and every local action it reaches, never builds.
function buildsAnApp(step, docs, seen = new Set()) {
  if (BUILDS.test(withoutComments(step?.run))) return `runs ${String(step.run).match(BUILDS)[0]}`;
  const uses = String(step?.uses ?? '');
  if (!uses.startsWith('./')) return null;
  const rel = ['action.yml', 'action.yaml']
    .map((f) => path.posix.join(uses.slice(2), f))
    .find((f) => docs.has(f));
  if (!rel) return `uses ${uses}, which this guard did not read`;
  if (seen.has(rel)) return null;
  seen.add(rel);
  for (const { step: inner } of stepsOf(rel, docs.get(rel))) {
    const why = buildsAnApp(inner, docs, seen);
    if (why) return `${uses} ${why}`;
  }
  return null;
}

// The gradle tasks a `run` names that package an app, with where each
// variant's output and BuildConfig land. Only the arguments of a `gradlew`
// command are read (continued lines joined), up to the command's end, so a
// word such as `build` in an echo or `app/build.gradle.kts` is no task.
function packagingTasks(run) {
  const text = withoutComments(run).replace(/\\\n/g, ' ');
  const commands = text.match(/(?:^|[\s;&|(])(?:\S*\/)?gradlew\b[^\n;&|)]*/g) ?? [];
  return commands
    .flatMap((c) => c.replace(/^.*?gradlew\b/, '').split(/[\s'"]+/))
    .map((t) => t.replace(/^:?(?:[\w-]+:)*/, ''))
    .filter((t) => GRADLE_PACKAGING.test(t))
    .map((task) => {
      const m = VARIANT_TASK.exec(task);
      if (!m) return { task, unknown: true };
      const [, kind, flavour, type] = m;
      const f = flavour.toLowerCase();
      const t = type.toLowerCase();
      return {
        task,
        dir:
          kind === 'assemble'
            ? `app/build/outputs/apk/${f}/${t}`
            : `app/build/outputs/bundle/${f}${type}`,
        config: `app/build/generated/source/buildConfig/${f}/${t}/com/shyden/shytalk/BuildConfig.java`,
      };
    });
}

function judgeJob(rel, steps, findings) {
  const checksAt = steps.filter(({ step }) => isCheck(step));
  for (const { i, step, at } of steps) {
    for (const t of packagingTasks(step?.run)) {
      if (t.unknown) {
        findings.push(
          `${rel}: ${at} runs gradle task ${t.task}, which packages an app this guard cannot place`,
        );
        continue;
      }
      const ok = checksAt.some(
        (c) =>
          c.i > i &&
          checkDirs(c.step).includes(t.dir) &&
          c.step.with?.['build-config'] === t.config &&
          String(c.step.if ?? '') === String(step.if ?? ''),
      );
      if (!ok) {
        findings.push(
          `${rel}: ${at} runs ${t.task} with no later APK check of ${t.dir} with its BuildConfig and the same if:`,
        );
      }
    }
    const uses = String(step?.uses ?? '');
    if (uses.startsWith('actions/upload-artifact@')) {
      const appPaths = lines(step.with?.path)
        .map((l) => l.trim())
        .filter((l) => APP_FILE.test(l));
      for (const p of appPaths) {
        if (
          !checksAt.some((c) => c.i < i && checkDirs(c.step).some((d) => p.startsWith(`${d}/`)))
        ) {
          findings.push(`${rel}: ${at} uploads ${p} with no earlier APK check of its folder`);
        }
      }
      if (appPaths.length > 0) {
        const days = step.with?.['retention-days'];
        if (!(Number.isInteger(days) && days >= 1 && days <= MAX_RETENTION_DAYS)) {
          findings.push(
            `${rel}: ${at} keeps an app for ${days ?? 'the default 90'} days, not 1 to ${MAX_RETENTION_DAYS}`,
          );
        }
        if (step.with?.['if-no-files-found'] !== 'error') {
          findings.push(`${rel}: ${at} uploads an app without if-no-files-found: error`);
        }
      }
    }
    if (
      uses.startsWith('actions/download-artifact@') &&
      /apk|aab/i.test(String(step.with?.name ?? ''))
    ) {
      const dir = String(step.with?.path ?? '').replace(/\/$/, '');
      if (!checksAt.some((c) => c.i > i && checkDirs(c.step).includes(dir))) {
        findings.push(
          `${rel}: ${at} downloads ${step.with?.name} to ${dir || '(no path)'} with no later APK check of it`,
        );
      }
    }
  }
}

/**
 * @param {Map<string, string>} files repo-relative path -> YAML text
 * @returns {{ findings: string[], sites: number, perFile: Map<string, { raw: number, parsed: number }> }}
 */
function judge(files) {
  const docs = new Map([...files].map(([rel, text]) => [rel, yaml.load(text)]));
  const findings = [];
  const perFile = new Map();
  let sites = 0;
  for (const [rel, doc] of docs) {
    let parsed = 0;
    for (const site of scalars(doc, [], undefined)) {
      parsed += count(site.text, NAME);
      if (count(site.text, NAMING) === 0) continue;
      sites += 1;
      if (!allowedSite(rel, site))
        findings.push(`${rel}: ${site.at} names the secret${site.key ? ' (as a key)' : ''}`);
    }
    perFile.set(rel, { raw: count(withoutComments(files.get(rel)), NAME), parsed });

    for (const { key, at, job } of jobsOf(rel, doc)) {
      if (
        job?.secrets === 'inherit' &&
        !String(job.uses ?? '').startsWith('./.github/workflows/')
      ) {
        findings.push(
          `${rel}: ${at} hands every secret to ${job.uses ?? '(no uses)'}, which this guard does not read`,
        );
      }
      judgeJob(
        rel,
        stepsOf(rel, doc).filter((s) => s.job === key),
        findings,
      );
    }
  }
  for (const [file, root] of ALLOWED) {
    if (!docs.has(file)) continue;
    const step = stepsOf(file, docs.get(file)).find((s) => s.at === root);
    if (root.includes('.steps[') && !step)
      findings.push(`${file}: allowed step ${root} no longer exists`);
    const why = step && buildsAnApp(step.step, docs);
    if (why) findings.push(`${file}: allowed step ${root} ${why}`);
  }
  return { findings, sites, perFile };
}

function readTree(repoRoot) {
  const visible = gitVisibleFiles(repoRoot, ROOTS);
  const rels = ROOTS.flatMap((root) =>
    fs
      .readdirSync(path.join(repoRoot, root), { recursive: true })
      .map((rel) => path.posix.join(root, rel.split(path.sep).join('/')))
      .filter((rel) => KINDS.test(rel) && visible.has(rel.split('/').join(path.sep)))
      .filter((rel) => fs.statSync(path.join(repoRoot, rel)).isFile()),
  );
  return new Map(rels.map((rel) => [rel, fs.readFileSync(path.join(repoRoot, rel), 'utf8')]));
}

describe('SHY-0662 — no build anyone else can download carries the persona password', () => {
  const files = readTree(REPO);
  const { findings, sites, perFile } = judge(files);
  const rels = [...files.keys()];

  test('every workflow and action holds all four rules, over every file and every site', () => {
    expect({ filesRead: rels.length, sites, findings }).toEqual({
      filesRead: FILES_READ_FLOOR,
      sites: SITES_FLOOR,
      findings: [],
    });
  });

  test.each(rels)('%s holds the rules, and its parse saw every naming of the secret', (rel) => {
    // The raw count is taken here from the file's own text, line by line,
    // with no parse: a parse that drops a naming cannot match it.
    const raw = files
      .get(rel)
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#'))
      .reduce((n, l) => n + (l.match(NAME) ?? []).length, 0);
    expect({
      findings: findings.filter((f) => f.startsWith(`${rel}: `)),
      parsed: perFile.get(rel).parsed,
    }).toEqual({
      findings: [],
      parsed: raw,
    });
  });

  test.each(ROOTS)('the walk reads at least one file under %s', (root) => {
    expect(rels.filter((rel) => rel.startsWith(`${root}/`)).length).toBeGreaterThan(0);
  });

  test.each([
    '.github/workflows/pr-checks.yml',
    '.github/workflows/deploy-dev.yml',
    '.github/workflows/deploy-prod.yml',
    '.github/workflows/codeql.yml',
    '.github/workflows/seed-dev-personas.yml',
    '.github/workflows/manual-qa-matrix.yml',
    '.github/actions/seed-test-personas/action.yml',
    '.github/actions/apk-holds-no-persona-password/action.yml',
  ])('the walk reads %s, a file that builds an app or holds the secret', (rel) => {
    expect(rels).toContain(rel);
  });

  test('the allowed sites are exactly these four', () => {
    expect(ALLOWED).toEqual([
      [
        '.github/workflows/seed-dev-personas.yml',
        'on.workflow_call.secrets.DEV_QA_PERSONAS_PASSWORD',
      ],
      [
        '.github/workflows/seed-dev-personas.yml',
        'jobs.seed.steps[Verify required secrets are present]',
      ],
      ['.github/workflows/seed-dev-personas.yml', 'jobs.seed.steps[Run seed action]'],
      [
        '.github/workflows/manual-qa-matrix.yml',
        'jobs.matrix-dispatch.steps[Run manual-qa matrix]',
      ],
    ]);
  });
});

// Plants: small workflows written out by hand, judged in memory.
const DEV_RELEASE = 'app/build/outputs/apk/dev/release';
const DEV_RELEASE_CONFIG =
  'app/build/generated/source/buildConfig/dev/release/com/shyden/shytalk/BuildConfig.java';
const CHECK_STEP = `
      - name: Check
        uses: ./.github/actions/apk-holds-no-persona-password
        with:
          dir: ${DEV_RELEASE}
          build-config: ${DEV_RELEASE_CONFIG}
          password: \${{ secrets.DEV_QA_PERSONAS_PASSWORD }}`;
const workflow = (steps, top = '', job = '') => `name: plant
on: push
${top}jobs:
  build:
    runs-on: ubuntu-latest
${job}    steps:${steps}
`;
const BUILD_STEP = `
      - name: Build
        run: ./gradlew assembleDevRelease`;
const judgeOne = (text, rel = '.github/workflows/plant.yml') =>
  judge(new Map([[rel, text]])).findings;

describe('SHY-0662 — a clean build-then-check workflow passes', () => {
  test('a build followed by the check on its folder, BuildConfig and if:', () => {
    expect(judgeOne(workflow(BUILD_STEP + CHECK_STEP))).toEqual([]);
  });

  test('an upload after the check, kept 7 days and failing when empty', () => {
    const upload = `
      - uses: actions/upload-artifact@0000000000000000000000000000000000000000 # v7
        with:
          name: dev-release-apk
          path: ${DEV_RELEASE}/*.apk
          if-no-files-found: error
          retention-days: 7`;
    expect(judgeOne(workflow(BUILD_STEP + CHECK_STEP + upload))).toEqual([]);
  });
});

describe('SHY-0662 — rule 1: the secret reaches no step outside the allowed sites', () => {
  test.each([
    [
      'a step env key',
      `\n      - name: Build\n        env:\n          DEV_QA_PERSONAS_PASSWORD: x\n        run: ./gradlew assembleDevRelease${CHECK_STEP}`,
      '',
      '',
    ],
    [
      'a job env key gradle reads as a property',
      BUILD_STEP + CHECK_STEP,
      '',
      '    env:\n      ORG_GRADLE_PROJECT_DEV_QA_PERSONAS_PASSWORD: x\n',
    ],
    [
      'a job env value under another key',
      BUILD_STEP + CHECK_STEP,
      '',
      '    env:\n      GRADLE_PW: ${{ secrets.DEV_QA_PERSONAS_PASSWORD }}\n',
    ],
    [
      'a workflow env value under a short key',
      BUILD_STEP + CHECK_STEP,
      'env:\n  PW: ${{ secrets.DEV_QA_PERSONAS_PASSWORD }}\n',
      '',
    ],
    [
      'the name in lower case',
      `\n      - name: Build\n        env:\n          PW: \${{ secrets.dev_qa_personas_password }}\n        run: ./gradlew assembleDevRelease${CHECK_STEP}`,
      '',
      '',
    ],
    [
      'element access',
      `\n      - name: Build\n        env:\n          PW: \${{ secrets['DEV_QA_PERSONAS_PASSWORD'] }}\n        run: ./gradlew assembleDevRelease${CHECK_STEP}`,
      '',
      '',
    ],
    [
      'a secret picked at run time',
      `\n      - name: Build\n        env:\n          PW: \${{ secrets[matrix.key] }}\n        run: ./gradlew assembleDevRelease${CHECK_STEP}`,
      '',
      '',
    ],
    [
      'every secret as JSON',
      `\n      - name: Build\n        env:\n          ALL: \${{ toJSON(secrets) }}\n        run: ./gradlew assembleDevRelease${CHECK_STEP}`,
      '',
      '',
    ],
    [
      'inline in the gradle command',
      `\n      - name: Build\n        run: ./gradlew assembleDevRelease -PDEV_QA_PERSONAS_PASSWORD=\${{ secrets.DEV_QA_PERSONAS_PASSWORD }}${CHECK_STEP}`,
      '',
      '',
    ],
    [
      'a with: input to a local action',
      `\n      - uses: ./.github/actions/build-it\n        with:\n          pw: \${{ secrets.DEV_QA_PERSONAS_PASSWORD }}${BUILD_STEP}${CHECK_STEP}`,
      '',
      '',
    ],
    [
      'a check input other than password',
      BUILD_STEP +
        CHECK_STEP.replace(
          'dir: ',
          'dir: ${{ secrets.DEV_QA_PERSONAS_PASSWORD }}\n          other: ',
        ),
      '',
      '',
    ],
  ])('refuses %s', (_form, steps, top, job) => {
    const found = judgeOne(workflow(steps, top, job));
    expect(found.filter((f) => f.includes('names the secret'))).toHaveLength(1);
  });

  test('refuses a job handing every secret to a workflow it does not read', () => {
    const text = `name: plant\non: push\njobs:\n  call:\n    uses: other-org/repo/.github/workflows/x.yml@0000000000000000000000000000000000000000\n    secrets: inherit\n`;
    expect(judgeOne(text)).toEqual([
      '.github/workflows/plant.yml: jobs.call hands every secret to other-org/repo/.github/workflows/x.yml@0000000000000000000000000000000000000000, which this guard does not read',
    ]);
  });

  test('passes a job handing every secret to a local workflow, which is judged in its own file', () => {
    const text = `name: plant\non: push\njobs:\n  call:\n    uses: ./.github/workflows/seed-dev-personas.yml\n    secrets: inherit\n`;
    expect(judgeOne(text)).toEqual([]);
  });

  test('a YAML comment naming the secret is no site, and the cross-check agrees', () => {
    const text = workflow(
      `${BUILD_STEP}\n        # DEV_QA_PERSONAS_PASSWORD is not passed here${CHECK_STEP}`,
    );
    const { sites, perFile } = judge(new Map([['.github/workflows/plant.yml', text]]));
    expect({ sites, ...perFile.get('.github/workflows/plant.yml') }).toEqual({
      sites: 1,
      raw: 1,
      parsed: 1,
    });
  });

  test('a trailing YAML comment naming the secret makes the cross-check disagree', () => {
    const text = workflow(`${BUILD_STEP} # DEV_QA_PERSONAS_PASSWORD${CHECK_STEP}`);
    const { perFile } = judge(new Map([['.github/workflows/plant.yml', text]]));
    expect(perFile.get('.github/workflows/plant.yml')).toEqual({ raw: 2, parsed: 1 });
  });
});

describe('SHY-0662 — rule 2: no allowed step builds an app', () => {
  // The journey runner's one allowed step, alone in its file.
  const runner = (run) => `name: matrix
on: workflow_dispatch
jobs:
  matrix-dispatch:
    runs-on: ubuntu-latest
    steps:
      - name: Run manual-qa matrix
        env:
          PERSONAS_PASSWORD: \${{ secrets.DEV_QA_PERSONAS_PASSWORD }}
        run: ${run}
`;
  const rel = '.github/workflows/manual-qa-matrix.yml';
  const label = 'jobs.matrix-dispatch.steps[Run manual-qa matrix]';

  test('passes the allowed step while it only signs in over the API', () => {
    expect(judgeOne(runner('node scripts/run-matrix.js'), rel)).toEqual([]);
  });

  test.each([
    ['gradle', './gradlew assembleDevRelease', 'runs gradlew'],
    ['xcodebuild', 'xcodebuild archive -scheme iosApp', 'runs xcodebuild'],
    ['the local iOS build script', 'bash scripts/ios/build-debug-dev.sh', 'runs build-debug-dev'],
    ['fastlane', 'bundle exec fastlane beta', 'runs fastlane'],
  ])('refuses an allowed step that starts running %s', (_tool, run, why) => {
    expect(judgeOne(runner(run), rel)).toContainEqual(`${rel}: allowed step ${label} ${why}`);
  });

  test('refuses an allowed step whose local action builds an app', () => {
    const files = new Map([
      [rel, runner('true').replace('run: true', 'uses: ./.github/actions/sneaky')],
      [
        '.github/actions/sneaky/action.yml',
        'name: sneaky\nruns:\n  using: composite\n  steps:\n    - shell: bash\n      run: ./gradlew assembleDevRelease\n',
      ],
    ]);
    expect(judge(files).findings).toContainEqual(
      `${rel}: allowed step ${label} ./.github/actions/sneaky runs gradlew`,
    );
  });

  test('refuses an allowed step whose local action was not read', () => {
    expect(
      judgeOne(runner('true').replace('run: true', 'uses: ./.github/actions/unread'), rel),
    ).toContainEqual(
      `${rel}: allowed step ${label} uses ./.github/actions/unread, which this guard did not read`,
    );
  });

  test('refuses an allowed label that two steps share, so the twin is not covered', () => {
    const twin = runner('true').replace(
      '        run: true\n',
      '        run: true\n      - name: Run manual-qa matrix\n        env:\n          PW: ${{ secrets.DEV_QA_PERSONAS_PASSWORD }}\n        run: node x.js\n',
    );
    const found = judgeOne(twin, rel);
    expect(found.filter((f) => f.includes('names the secret'))).toHaveLength(2);
    expect(found).toContainEqual(`${rel}: allowed step ${label} no longer exists`);
  });
});

describe('SHY-0662 — rule 3: every packaged app is checked after its build', () => {
  test.each([
    ['no check at all', BUILD_STEP],
    ['the check before the build', CHECK_STEP + BUILD_STEP],
    [
      'the check on another folder',
      BUILD_STEP +
        CHECK_STEP.replace(`dir: ${DEV_RELEASE}`, 'dir: app/build/outputs/apk/dev/debug'),
    ],
    [
      'the check with another BuildConfig',
      BUILD_STEP + CHECK_STEP.replace('dev/release/com', 'dev/debug/com'),
    ],
    [
      'the check with no BuildConfig',
      BUILD_STEP + CHECK_STEP.replace(`build-config: ${DEV_RELEASE_CONFIG}`, 'other: x'),
    ],
    [
      'the check under another if:',
      BUILD_STEP +
        CHECK_STEP.replace(
          'uses: ./.github',
          "if: github.event_name == 'push'\n        uses: ./.github",
        ),
    ],
    [
      'a bundle task with only the APK folder checked',
      BUILD_STEP.replace('assembleDevRelease', 'assembleDevRelease bundleDevRelease') + CHECK_STEP,
    ],
    [
      'a task named through its project path',
      BUILD_STEP.replace('assembleDevRelease', ':app:assembleProdRelease') + CHECK_STEP,
    ],
    [
      'a task named through a relative project path',
      BUILD_STEP.replace('assembleDevRelease', 'app:assembleProdRelease') + CHECK_STEP,
    ],
  ])('refuses %s', (_form, steps) => {
    expect(
      judgeOne(workflow(steps)).filter((f) => f.includes('with no later APK check')),
    ).toHaveLength(1);
  });

  test.each([
    ['assemble'],
    ['build'],
    ['installDevDebug'],
    ['assembleDebug'],
    ['packageDevRelease'],
    ['bundle'],
  ])('refuses gradle task %s, which packages an app the guard cannot place', (task) => {
    expect(judgeOne(workflow(BUILD_STEP.replace('assembleDevRelease', task) + CHECK_STEP))).toEqual(
      [
        `.github/workflows/plant.yml: jobs.build.steps[Build] runs gradle task ${task}, which packages an app this guard cannot place`,
      ],
    );
  });

  test('passes a check that lists two folders of one variant', () => {
    const steps =
      BUILD_STEP.replace('assembleDevRelease', 'assembleDevRelease bundleDevRelease') +
      CHECK_STEP.replace(
        `dir: ${DEV_RELEASE}`,
        `dir: |\n            ${DEV_RELEASE}\n            app/build/outputs/bundle/devRelease`,
      );
    expect(judgeOne(workflow(steps))).toEqual([]);
  });

  test('passes a run that only reads app/build.gradle.kts and echoes the word build', () => {
    const run = `\n      - name: Version\n        run: |\n          awk '/versionName/' app/build.gradle.kts\n          echo "build 5 builds"`;
    expect(judgeOne(workflow(run))).toEqual([]);
  });

  test('refuses a task on a continued line of the gradle command', () => {
    const run = `\n      - name: Build\n        run: |\n          ./gradlew --parallel \\\n            assembleDevRelease`;
    expect(
      judgeOne(workflow(run)).filter((f) =>
        f.includes('runs assembleDevRelease with no later APK check'),
      ),
    ).toHaveLength(1);
  });

  test('refuses a task after another command on the same line', () => {
    const run = `\n      - name: Build\n        run: cd app && ../gradlew assembleDevRelease`;
    expect(
      judgeOne(workflow(run)).filter((f) =>
        f.includes('runs assembleDevRelease with no later APK check'),
      ),
    ).toHaveLength(1);
  });

  test('passes a gradle task named only in a shell comment', () => {
    expect(
      judgeOne(
        workflow(
          '\n      - name: Build\n        run: |\n          # assembleDevRelease ran above\n          ./gradlew --version',
        ),
      ),
    ).toEqual([]);
  });

  test('judges the steps of a composite action too', () => {
    const action =
      'name: a\nruns:\n  using: composite\n  steps:\n    - shell: bash\n      run: ./gradlew assembleDevRelease\n';
    expect(judgeOne(action, '.github/actions/a/action.yml')).toHaveLength(1);
  });
});

describe('SHY-0662 — rule 4: every uploaded or downloaded app is checked', () => {
  const upload = (extra) => `
      - uses: actions/upload-artifact@0000000000000000000000000000000000000000 # v7
        with:
          name: dev-release-apk
          path: ${DEV_RELEASE}/*.apk${extra}`;

  test('refuses an upload before the check', () => {
    const found = judgeOne(
      workflow(
        BUILD_STEP +
          upload('\n          if-no-files-found: error\n          retention-days: 7') +
          CHECK_STEP,
      ),
    );
    expect(found).toContainEqual(
      `.github/workflows/plant.yml: jobs.build.steps[actions/upload-artifact@0000000000000000000000000000000000000000] uploads ${DEV_RELEASE}/*.apk with no earlier APK check of its folder`,
    );
  });

  test.each([
    [
      'no retention, so the default 90 days',
      '\n          if-no-files-found: error',
      'the default 90',
    ],
    ['14 days', '\n          if-no-files-found: error\n          retention-days: 14', '14'],
    ['0 days', '\n          if-no-files-found: error\n          retention-days: 0', '0'],
  ])('refuses an upload kept for %s', (_form, extra, days) => {
    expect(judgeOne(workflow(BUILD_STEP + CHECK_STEP + upload(extra)))).toEqual([
      `.github/workflows/plant.yml: jobs.build.steps[actions/upload-artifact@0000000000000000000000000000000000000000] keeps an app for ${days} days, not 1 to 7`,
    ]);
  });

  test('refuses an upload that passes when it finds nothing', () => {
    expect(
      judgeOne(workflow(BUILD_STEP + CHECK_STEP + upload('\n          retention-days: 7'))),
    ).toEqual([
      '.github/workflows/plant.yml: jobs.build.steps[actions/upload-artifact@0000000000000000000000000000000000000000] uploads an app without if-no-files-found: error',
    ]);
  });

  const download = `
      - uses: actions/download-artifact@0000000000000000000000000000000000000000 # v8
        with:
          name: dev-release-apk
          path: dev-release-apk`;
  const checkDownloaded = `
      - uses: ./.github/actions/apk-holds-no-persona-password
        with:
          dir: dev-release-apk
          password: \${{ secrets.DEV_QA_PERSONAS_PASSWORD }}`;

  test('passes a download checked after it lands', () => {
    expect(judgeOne(workflow(download + checkDownloaded))).toEqual([]);
  });

  test('refuses a download with no check after it', () => {
    expect(judgeOne(workflow(checkDownloaded + download))).toEqual([
      '.github/workflows/plant.yml: jobs.build.steps[actions/download-artifact@0000000000000000000000000000000000000000] downloads dev-release-apk to dev-release-apk with no later APK check of it',
    ]);
  });
});
