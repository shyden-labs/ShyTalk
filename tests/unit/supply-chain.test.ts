import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { withoutYamlComments, withoutYamlQuotes } from './source-text.ts';
import { leaks, parseGroups } from './dependabot-groups.ts';

/**
 * The CI supply chain is pinned, and something keeps it current.
 *
 * Two failure modes, and they pull in opposite directions:
 *
 * 1. A MUTABLE TAG is not a version. `actions/checkout@v4` resolves to
 *    whatever the tag points at today, and a tag can be repointed by anyone
 *    who can push to that repo. A compromised or coerced maintainer moves the
 *    tag and every workflow in this repo runs their code, with our secrets,
 *    on the next push. Pinning to a full commit SHA is the only form of this
 *    reference that cannot be changed underneath us.
 *
 * 2. A PIN THAT NOBODY BUMPS rots. shyden.co.uk sat three majors behind on
 *    both of its actions with no mechanism to notice. So the SHA is only half
 *    the control — Dependabot is the other half, and the version comment
 *    beside each SHA is what makes a bump reviewable by a human instead of an
 *    opaque hex swap.
 *
 * SOURCE TEXT, not YAML parsing: no YAML parser is available here and none is
 * worth adding ("no new npm dependencies"), matching pipeline-wiring.test.ts.
 *
 * Each check is a function over text, run on this repo's files and on planted
 * text that breaks it, so every check is seen to fail as well as pass.
 */

const WORKFLOWS = '.github/workflows';
const DEPENDABOT = '.github/dependabot.yml';

interface Use {
  where: string;
  text: string;
}

/**
 * Every `uses:` naming a THIRD-PARTY action in one workflow's text.
 *
 * Local references (`./.github/actions/x`, `./.github/workflows/y.yml`) are
 * excluded deliberately: they are this repo's own code, already reviewed at
 * the commit that introduced them, and have no upstream SHA to pin.
 */
const usesIn = (file: string, source: string): Use[] =>
  source
    .split('\n')
    .map((text, i) => ({ where: `${file}:${i + 1}`, text: text.trim() }))
    .filter(({ text }) => /^(-\s*)?uses:\s*[^.\s]/.test(text));

const externalUses = (): Use[] =>
  readdirSync(WORKFLOWS)
    .filter((f) => /\.ya?ml$/.test(f))
    .flatMap((file) => usesIn(file, readFileSync(join(WORKFLOWS, file), 'utf8')));

const unpinned = (uses: Use[]) =>
  uses.filter(({ text }) => !/@[0-9a-f]{40}(?=\s|$)/.test(text)).map(({ where, text }) => `${where} ${text}`);

const unlabelled = (uses: Use[]) =>
  uses.filter(({ text }) => !/@[0-9a-f]{40}\s+#\s*v\d/.test(text)).map(({ where, text }) => `${where} ${text}`);

/**
 * The config with its YAML comments removed. ASSERT ON THIS, never on the
 * raw text.
 *
 * These checks read source text, and this file DOCUMENTS the very patterns it
 * is checked for. Matched against the raw text, that prose SATISFIES a guard
 * on its own: shyden.co.uk's note spelled out `patterns: ["actions/cache*"]`
 * and passed its sub-path guard with no group configured (issue shyden-labs/repo-template#23).
 */
const configBody = () => withoutYamlComments(readFileSync(DEPENDABOT, 'utf8'));

/**
 * Every `owner/repo` used at MORE THAN ONE sub-path, with the distinct refs
 * seen for it: the ones Dependabot would otherwise bump one sub-path at a
 * time, leaving the siblings behind.
 */
const subPathRepos = (uses: Use[]): [string, Set<string>][] => {
  const refs = new Map<string, Set<string>>();
  for (const { text } of uses) {
    const ref = /uses:\s*([^@\s]+)@/.exec(text)?.[1];
    if (ref === undefined) continue;
    // The repository is the first two segments of an action's path.
    const key = ref.split('/').slice(0, 2).join('/');
    refs.set(key, (refs.get(key) ?? new Set()).add(ref));
  }
  return [...refs.entries()].filter(([, seen]) => seen.size > 1);
};

const ungroupedSubPaths = (uses: Use[], config: string) =>
  subPathRepos(uses)
    .filter(([key]) => !withoutYamlQuotes(config).includes(`${key}*`))
    .map(([key, refs]) => `${key} used at ${refs.size} sub-paths, ungrouped`);

/** How many times `pattern` occurs in `text`. */
const count = (text: string, pattern: RegExp) => text.split(pattern).length - 1;

const SHA = 'a'.repeat(40);

/**
 * Each action pinned at more than one SHA across the workflows: a bump that
 * reached one file and missed another. Named with every SHA and where it is.
 */
const splitPins = (uses: Use[]) => {
  const pins = new Map<string, Map<string, string[]>>();
  for (const { where, text } of uses) {
    const pin = /uses:\s*([^@\s]+)@([0-9a-f]{40})(?![0-9a-f])/.exec(text);
    if (pin === null) continue;
    const [, action, sha] = pin as unknown as [string, string, string];
    const shas = pins.get(action) ?? new Map<string, string[]>();
    shas.set(sha, [...(shas.get(sha) ?? []), where]);
    pins.set(action, shas);
  }
  return [...pins.entries()]
    .filter(([, shas]) => shas.size > 1)
    .map(([action, shas]) => `${action} at ${[...shas].map(([sha, at]) => `${sha.slice(0, 7)} (${at.join(', ')})`).join(' and ')}`);
};

describe('the CI supply chain is pinned', () => {
  it('pins each action at one SHA in every workflow, judged over every pinned use', () => {
    const uses = externalUses();
    expect({ pinned: uses.length, split: splitPins(uses) }).toEqual({ pinned: 13, split: [] });
  });

  it('names an action whose bump reached one workflow and missed another', () => {
    const other = 'b'.repeat(40);
    expect(
      splitPins([
        { where: 'ci.yml:3', text: `uses: actions/setup-node@${SHA} # v7.0.0` },
        { where: 'logs.yml:9', text: `uses: actions/setup-node@${other} # v7.1.0` },
        { where: 'ci.yml:4', text: `uses: actions/setup-node@${SHA} # v7.0.0` },
        { where: 'ci.yml:5', text: 'uses: actions/checkout@v4' },
      ]),
    ).toEqual(['actions/setup-node at aaaaaaa (ci.yml:3, ci.yml:4) and bbbbbbb (logs.yml:9)']);
  });

  it('there is something to check', () => {
    expect(externalUses().length).toBeGreaterThan(0);
  });

  it('reads the uses: lines of a workflow, leaving out local actions', () => {
    expect(usesIn('ci.yml', `steps:\n  - uses: actions/checkout@${SHA}\n  - uses: ./.github/actions/x\n`)).toEqual([
      { where: 'ci.yml:2', text: `- uses: actions/checkout@${SHA}` },
    ]);
  });

  it('every third-party action is pinned to a full commit SHA', () => {
    expect(unpinned(externalUses()), 'a mutable tag can be repointed under us').toEqual([]);
  });

  it('names an action pinned to a tag', () => {
    expect(unpinned([{ where: 'ci.yml:3', text: 'uses: actions/checkout@v4' }])).toEqual(['ci.yml:3 uses: actions/checkout@v4']);
  });

  it('every pinned action names the version its SHA resolves to', () => {
    expect(unlabelled(externalUses()), 'a bare SHA bump is unreviewable by a human').toEqual([]);
  });

  it('names a SHA with no version comment', () => {
    expect(unlabelled([{ where: 'ci.yml:3', text: `uses: actions/checkout@${SHA}` }])).toEqual([`ci.yml:3 uses: actions/checkout@${SHA}`]);
  });
});

describe('Dependabot keeps the pins from rotting', () => {
  /**
   * ShyTalk shipped this bug, so it is guarded here before it can happen.
   *
   * Dependabot treats `actions/cache`, `actions/cache/restore` and
   * `actions/cache/save` as three SEPARATE dependencies. Ungrouped, they
   * arrive as three PRs, each moving one sub-path's SHA while its siblings
   * lag: a one-SHA-per-repo violation by construction (ShyTalk's SHY-0226).
   * This repo uses no sub-path action today, so the planted case below is
   * what shows the check working.
   */
  it('an action repo used at more than one sub-path is grouped into one PR', () => {
    expect(ungroupedSubPaths(externalUses(), configBody())).toEqual([]);
  });

  const cacheUses: Use[] = [
    { where: 'ci.yml:1', text: `uses: actions/cache/restore@${SHA} # v4.0.0` },
    { where: 'ci.yml:2', text: `uses: actions/cache/save@${SHA} # v4.0.0` },
    { where: 'ci.yml:3', text: 'uses: docker://alpine:3' },
    { where: 'ci.yml:4', text: `uses: actions/checkout@${SHA} # v7.0.1` },
  ];

  it('names an action repo used at two sub-paths with no group', () => {
    expect(ungroupedSubPaths(cacheUses, 'groups:\n  patch-updates:\n')).toEqual(['actions/cache used at 2 sub-paths, ungrouped']);
  });

  it('accepts that repo once a group names it', () => {
    expect(ungroupedSubPaths(cacheUses, "groups:\n  cache:\n    patterns:\n      - 'actions/cache*'\n")).toEqual([]);
  });

  /**
   * Declaring the group is not enough: it has to be the ONLY group that can
   * hold the package. Dependabot scores every group that matches, and a group
   * with no patterns outscores any wildcard, so a catch-all must exclude each
   * pattern group's patterns (Shyden 2026-10-20; issue shyden-labs/repo-template#39). Order decides
   * nothing. The model and its planted cases are in dependabot-groups.test.ts.
   */
  it("each pattern group's packages can land in that group alone, judged over every group read", () => {
    const ecosystems = parseGroups(withoutYamlQuotes(configBody()));
    expect({
      judged: ecosystems.map(({ ecosystem, groups }) => [ecosystem, groups.map(({ name }) => name)]),
      leaks: ecosystems.flatMap(leaks),
    }).toEqual({
      judged: [
        ['npm', ['vitest', 'patch-updates']],
        ['github-actions', ['actions-subpaths', 'patch-updates']],
        ['docker', []],
      ],
      leaks: [],
    });
  });

  it('a Dependabot config exists', () => {
    expect(existsSync(DEPENDABOT)).toBe(true);
  });

  it('watches npm AND the GitHub Actions themselves', () => {
    const config = configBody();

    expect(config, 'npm dependencies unwatched').toMatch(/package-ecosystem:\s*["']?npm["']?/);
    expect(config, 'the actions that run CI are unwatched').toMatch(/package-ecosystem:\s*["']?github-actions["']?/);
  });

  it('opens every PR against develop, never straight at main', () => {
    const config = configBody();
    const ecosystems = count(config, /package-ecosystem:/);

    expect(ecosystems, 'no ecosystems declared').toBeGreaterThan(0);
    expect(
      count(config, /target-branch:\s*["']?develop["']?/),
      'an ecosystem defaults to the default branch, bypassing the develop gate',
    ).toBe(ecosystems);
    expect(config).not.toMatch(/target-branch:\s*["']?main["']?/);
  });
});

/**
 * One Node and one runner, pinned exactly (issue shyden-labs/repo-template#63; global rule 2026-10-08
 * sets Node 26.3+, and every project runs the same versions as the rest).
 *
 * `ubuntu-latest` and a bare major Node are floating pins: the image or the Node under CI changes on
 * GitHub's schedule, not ours. Node is now `.github/node/Dockerfile` alone. Each
 * reader is an allow-list of the one value written, so every other spelling
 * (a list, an expression, a block of labels, another case) fails, naming it.
 */
const RUNNER = 'ubuntu-26.04';

interface Runner {
  where: string;
  value: string;
}

/**
 * Every `runs-on:` in one workflow's comment-stripped text, named by the job
 * key above it, with its value as written less its quotes. A block form
 * (`runs-on:` then `labels:` below) reads as an empty value.
 */
const runnersIn = (file: string, source: string): Runner[] => {
  const found: Runner[] = [];
  let job = '';
  for (const line of withoutYamlComments(source).split('\n')) {
    const key = /^ {2}([\w-]+):\s*$/.exec(line);
    if (key) job = key[1] as string;
    const on = /^\s+runs-on:(.*)$/.exec(line);
    if (on) found.push({ where: `${file} ${job}`, value: withoutYamlQuotes(on[1] as string).trim() });
  }
  return found;
};

const floating = (runners: Runner[]) =>
  runners.filter(({ value }) => value !== RUNNER).map(({ where, value }) => `${where} runs-on: ${value}`);

const workflowFiles = () => readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));
const workflow = (file: string) => readFileSync(join(WORKFLOWS, file), 'utf8');

/**
 * The read step every Node setup follows (shyden-labs/repo-template#143): it takes the exact version
 * from the one file Dependabot bumps, `.github/node/Dockerfile`, and fails the
 * job when that file holds no exact `FROM node:x.y.z` line, so setup-node
 * never gets an empty version and falls back to the runner's own Node.
 */
const READ_STEP = [
  '- id: node',
  '  run: |',
  "    version=$(sed -nE 's/^FROM node:([0-9]+\\.[0-9]+\\.[0-9]+)$/\\1/p' .github/node/Dockerfile)",
  '    test -n "$version"',
  '    echo "version=$version" >> "$GITHUB_OUTPUT"',
];
const TAKES_THE_READ = /^\s+node-version:\s*\$\{\{\s*steps\.node\.outputs\.version\s*\}\}\s*$/;

/**
 * Every `actions/setup-node` step in one workflow, named with what is wrong:
 * it must take `node-version` from the read step, read no version file, and
 * come right after the read step, written exactly, or that workflow runs a
 * Node of its own choosing. A step runs from its `- ` line to the next line
 * indented no deeper, so a later step's key is never credited to it.
 */
const setupNodeSteps = (file: string, source: string): { where: string; wrong: string[] }[] => {
  const raw = withoutYamlComments(source).split('\n');
  const lines = withoutYamlQuotes(withoutYamlComments(source)).split('\n');
  const indent = (line: string) => line.length - line.trimStart().length;
  return lines.flatMap((line, i) => {
    if (!/^\s*(-\s+)?uses:\s*actions\/setup-node@/i.test(line)) return [];
    let start = i;
    while (start > 0 && !(lines[start] as string).trimStart().startsWith('- ')) start--;
    const dash = indent(lines[start] as string);
    let end = start + 1;
    while (end < lines.length && (lines[end] as string).trim() !== '' && indent(lines[end] as string) > dash) end++;
    const step = lines.slice(start, end);
    let before = start - 1;
    while (before > 0 && !((raw[before] as string).trimStart().startsWith('- ') && indent(raw[before] as string) === dash)) before--;
    const previous = raw
      .slice(before, start)
      .filter((l) => l.trim() !== '')
      .map((l) => l.slice(dash));
    const wrong = [
      ...(step.some((l) => TAKES_THE_READ.test(l)) ? [] : ["does not take the read step's version"]),
      ...(step.some((l) => /^\s+node-version-file:/.test(l)) ? ['reads a version file'] : []),
      ...(JSON.stringify(previous) === JSON.stringify(READ_STEP) ? [] : ['does not follow the read step']),
    ];
    return [{ where: `${file} step at ${line.trim().slice(0, 40)}`, wrong }];
  });
};

/** The exact Node the Dockerfile pins, or what is wrong with it: one line, `FROM node:26.<minor>.<patch>`, at or above 26.3.0. */
const nodePin = (text: string): { version: string } | { wrong: string } => {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length !== 1) return { wrong: `holds ${lines.length} lines, not one` };
  const line = lines[0] as string;
  const pin = /^FROM node:26\.(\d+)\.(\d+)$/.exec(line);
  if (pin === null) return { wrong: `${line} is not FROM node:26.<minor>.<patch>` };
  if (Number(pin[1]) < 3) return { wrong: `${line} is below 26.3.0` };
  return { version: `26.${pin[1] as string}.${pin[2] as string}` };
};

describe('the template runs one Node and one runner, pinned exactly', () => {
  it(`every job runs on ${RUNNER}, judged over every runs-on read`, () => {
    const runners = workflowFiles().flatMap((f) => runnersIn(f, workflow(f)));
    expect({ read: runners.length, floating: floating(runners) }).toEqual({ read: 6, floating: [] });
  });

  const job = (runsOn: string) => ['jobs:', '  build:', `    runs-on:${runsOn}`, '    steps:', '      - run: true', ''].join('\n');

  it.each([
    [' ubuntu-latest', 'ubuntu-latest'],
    [" 'ubuntu-latest'", 'ubuntu-latest'],
    [' "ubuntu-24.04"', 'ubuntu-24.04'],
    [' [ubuntu-26.04]', '[ubuntu-26.04]'],
    [' ${{ matrix.os }}', '${{ matrix.os }}'],
    [' Ubuntu-26.04', 'Ubuntu-26.04'],
    [' ubuntu-latest # was 26.04', 'ubuntu-latest'],
    ['\n      labels: ubuntu-26.04', ''],
  ])('names the runner written as runs-on:%j', (runsOn, value) => {
    expect(floating(runnersIn('ci.yml', job(runsOn)))).toEqual([`ci.yml build runs-on: ${value}`]);
  });

  it.each([[' ubuntu-26.04'], [" 'ubuntu-26.04'"], [' ubuntu-26.04 # pinned']])('accepts runs-on:%j', (runsOn) => {
    const runners = runnersIn('ci.yml', job(runsOn));
    expect({ read: runners.length, floating: floating(runners) }).toEqual({ read: 1, floating: [] });
  });

  it('reads no runs-on from a comment', () => {
    expect(runnersIn('ci.yml', 'jobs:\n  build:\n    # runs-on: ubuntu-latest\n    runs-on: ubuntu-26.04\n')).toEqual([
      { where: 'ci.yml build', value: RUNNER },
    ]);
  });

  it("every setup-node step takes the read step's version and follows it, judged over every step read", () => {
    const steps = workflowFiles().flatMap((f) => setupNodeSteps(f, workflow(f)));
    expect({ read: steps.length, wrong: steps.filter(({ wrong }) => wrong.length > 0) }).toEqual({ read: 6, wrong: [] });
  });

  const steps = (...lines: string[]) => ['    steps:', ...lines, ''].join('\n');
  const READ = READ_STEP.map((line) => `      ${line}`);
  const SETUP = [`      - uses: actions/setup-node@${SHA}`, '        with:', '          node-version: ${{ steps.node.outputs.version }}'];
  const wrongIn = (text: string) => setupNodeSteps('ci.yml', text).map(({ wrong }) => wrong);

  it.each([
    [
      'names its own Node',
      steps(...READ, `      - uses: actions/setup-node@${SHA}`, '        with:', '          node-version: 26'),
      [["does not take the read step's version"]],
    ],
    [
      'reads a version file instead',
      steps(...READ, `      - uses: actions/setup-node@${SHA}`, '        with:', "          node-version-file: '.nvmrc'"),
      [["does not take the read step's version", 'reads a version file']],
    ],
    [
      'takes the read and reads a file too',
      steps(...READ, ...SETUP, '          node-version-file: .node-version'),
      [['reads a version file']],
    ],
    ['has no read step before it', steps('      - uses: actions/checkout@x', ...SETUP), [['does not follow the read step']]],
    [
      'follows a read step changed by one character',
      steps(...READ.map((l) => l.replace('test -n', 'test -z')), ...SETUP),
      [['does not follow the read step']],
    ],
    ['has a step between the read and itself', steps(...READ, '      - run: true', ...SETUP), [['does not follow the read step']]],
    [
      'has no with: at all',
      steps(...READ, `      - uses: actions/setup-node@${SHA}`, '      - run: npm ci'),
      [["does not take the read step's version"]],
    ],
    [
      'leaves the version to the next step',
      steps(
        ...READ,
        `      - uses: actions/setup-node@${SHA}`,
        `      - uses: actions/cache@${SHA}`,
        '        with:',
        '          node-version: ${{ steps.node.outputs.version }}',
      ),
      [["does not take the read step's version"]],
    ],
    [
      'is spelled in capitals',
      steps(...READ, `      - uses: ACTIONS/SETUP-NODE@${SHA}`, '        with:', '          node-version: 24'),
      [["does not take the read step's version"]],
    ],
    [
      'takes the version only in a comment',
      steps(
        ...READ,
        `      - uses: actions/setup-node@${SHA}`,
        '        with:',
        '          # node-version: ${{ steps.node.outputs.version }}',
        '          node-version: 26',
      ),
      [["does not take the read step's version"]],
    ],
  ])('names a setup-node step that %s', (_, text, wrong) => {
    expect(wrongIn(text)).toEqual(wrong);
  });

  it('accepts a named setup-node step right after the read step, with a comment between', () => {
    expect(
      wrongIn(
        steps(
          '      # The exact Node (#143).',
          ...READ,
          '      - name: Node',
          `        uses: actions/setup-node@${SHA}`,
          '        with:',
          '          node-version: ${{ steps.node.outputs.version }}',
          "          cache: 'npm'",
        ),
      ),
    ).toEqual([[]]);
  });

  // No version is written here: a second copy would turn every Dependabot pull request red until edited by hand (reference-supply-chain.md, 2026-10-30).
  it('reads an exact Node 26 from the one file Dependabot bumps, whatever patch Dependabot moved it to', () => {
    const pin = nodePin(readFileSync('.github/node/Dockerfile', 'utf8'));
    // A refused file prints `wrong: <its reason>` here, with no branch left unrun on a valid file.
    expect(
      Object.entries(pin)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n'),
    ).toMatch(/^version: 26\.\d+\.\d+$/);
  });

  it.each([
    ['a bare major', 'FROM node:26\n', 'FROM node:26 is not FROM node:26.<minor>.<patch>'],
    ['a major and minor', 'FROM node:26.12\n', 'FROM node:26.12 is not FROM node:26.<minor>.<patch>'],
    ['lts', 'FROM node:lts\n', 'FROM node:lts is not FROM node:26.<minor>.<patch>'],
    ['latest', 'FROM node:latest\n', 'FROM node:latest is not FROM node:26.<minor>.<patch>'],
    ['a digest', 'FROM node@sha256:abc\n', 'FROM node@sha256:abc is not FROM node:26.<minor>.<patch>'],
    ['another image', 'FROM nodejs:26.12.1\n', 'FROM nodejs:26.12.1 is not FROM node:26.<minor>.<patch>'],
    ['a suffixed tag', 'FROM node:26.12.1-alpine\n', 'FROM node:26.12.1-alpine is not FROM node:26.<minor>.<patch>'],
    ['another major', 'FROM node:27.0.0\n', 'FROM node:27.0.0 is not FROM node:26.<minor>.<patch>'],
    ['a version below 26.3.0', 'FROM node:26.2.9\n', 'FROM node:26.2.9 is below 26.3.0'],
    ['two lines', 'FROM node:26.12.1\nFROM node:26.13.0\n', 'holds 2 lines, not one'],
    ['nothing', '', 'holds 0 lines, not one'],
  ])('refuses a Dockerfile holding %s', (_, text, wrong) => {
    expect(nodePin(text)).toEqual({ wrong });
  });

  it('accepts a pin with no final newline', () => {
    expect(nodePin('FROM node:26.3.0')).toEqual({ version: '26.3.0' });
  });

  it('has Dependabot bump the Dockerfile within major 26, on develop', () => {
    expect(configBody()).toContain(
      [
        "  - package-ecosystem: 'docker'",
        "    directory: '/.github/node'",
        "    target-branch: 'develop'",
        '    schedule:',
        "      interval: 'weekly'",
        '    ignore:',
        "      - dependency-name: 'node'",
        '        update-types:',
        "          - 'version-update:semver-major'",
      ].join('\n'),
    );
  });

  interface Manifest {
    engines?: unknown;
    devDependencies?: Record<string, string>;
    allowScripts?: Record<string, boolean>;
  }
  const manifest = (): Manifest => JSON.parse(readFileSync('package.json', 'utf8')) as Manifest;
  const lockRoot = (): Manifest | undefined =>
    (JSON.parse(readFileSync('package-lock.json', 'utf8')) as { packages?: Record<string, Manifest> }).packages?.[''];

  // The lockfile keeps its own copy, and npm ci never checks the two agree.
  it('engines.node allows exactly 24.16+ within 24, or 26.3 and later, in package.json and its lockfile', () => {
    expect([manifest().engines, lockRoot()?.engines]).toEqual([{ node: '^24.16.0 || >=26.3.0' }, { node: '^24.16.0 || >=26.3.0' }]);
  });

  it('@types/node is pinned exactly within major 26', () => {
    expect(manifest().devDependencies?.['@types/node']).toMatch(/^26\.\d+\.\d+$/);
  });

  // npm 11 skips every dependency install script that allowScripts does not name, and warns about it. The only
  // install script fsevents has is the `node-gyp rebuild` npm adds for a package published with a binding.gyp,
  // but its tarball ships no binding.gyp, only a prebuilt universal fsevents.node that loads without it (shyden-labs/repo-template#70).
  // esbuild's and workerd's (wrangler's) postinstalls only check the platform binary npm already installed;
  // `wrangler deploy --dry-run` bundles without them (plan 2 Task E2, measured pass 4; shyden-labs/ShyTalk#31).
  it('allowScripts denies fsevents, esbuild and workerd and approves nothing', () => {
    expect(manifest().allowScripts).toEqual({ fsevents: false, esbuild: false, workerd: false });
  });

  // An allow-scripts line in .npmrc approves packages past allowScripts, so the file is pinned whole.
  it('.npmrc holds engine-strict alone, so nothing approves an install script past allowScripts', () => {
    expect(readFileSync('.npmrc', 'utf8')).toBe('engine-strict=true\n');
  });

  // The lockfile says which packages carry install scripts: one missing from allowScripts is the warning on
  // the next `npm ci`, and an entry naming no such package is stale.
  it('allowScripts decides every lockfile package with an install script, and only those', () => {
    const packages = (JSON.parse(readFileSync('package-lock.json', 'utf8')) as { packages: Record<string, { hasInstallScript?: boolean }> })
      .packages;
    const withScripts = Object.entries(packages)
      .filter(([, entry]) => entry.hasInstallScript === true)
      .map(([path]) => path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length));
    expect([withScripts.sort(), Object.keys({ ...manifest().allowScripts }).sort()]).toEqual([
      ['esbuild', 'fsevents', 'workerd'],
      ['esbuild', 'fsevents', 'workerd'],
    ]);
  });
});

/**
 * GitHub: "Dependabot raises pull requests for security updates against the
 * default branch only", and `target-branch` steers version updates alone. So
 * with `main` as the default branch every SECURITY fix opens against `main`,
 * outside the develop gate (shyden-labs/ShyTalk-legacy#2183 sat there for a month). The default
 * branch must be `develop`, and only CI can see the repository setting, so CI
 * checks it as its FIRST step: a wrong default fails within seconds, before
 * anything is installed (issue shyden-labs/repo-template#46).
 */
describe('security fixes open against develop', () => {
  const STEP = /^\s*- name:\s*The default branch is develop\s*$/;
  const ciLines = () => withoutYamlComments(readFileSync(join(WORKFLOWS, 'ci.yml'), 'utf8')).split('\n');

  /** Each such step's own lines: everything after its `- name:` indented deeper than it. */
  const defaultBranchSteps = () => {
    const lines = ciLines();
    return lines.flatMap((line, at) => {
      if (!STEP.test(line)) return [];
      const indent = line.search(/\S/);
      // The blank sentinel ends a step that is the file's last.
      const rest = [...lines.slice(at + 1), ''];
      return [
        rest
          .slice(
            0,
            rest.findIndex((next) => next.search(/\S/) <= indent),
          )
          .join('\n'),
      ];
    });
  };

  it('CI has exactly one step checking the default branch', () => {
    expect(defaultBranchSteps()).toHaveLength(1);
  });

  it('the step reads the repository setting and fails unless it is develop', () => {
    const steps = defaultBranchSteps();
    expect(steps, 'no default-branch step in ci.yml').toHaveLength(1);
    const block = steps.join('\n');
    expect(block).toMatch(/DEFAULT_BRANCH:\s*\$\{\{\s*github\.event\.repository\.default_branch\s*\}\}/);
    expect(block).toMatch(/if \[ "\$DEFAULT_BRANCH" != "develop" \]; then[\s\S]*\bexit 1\b[\s\S]*\bfi\b/);
    // A skipped or tolerated step reports success: the check must run and must fail the job.
    expect(block).not.toMatch(/continue-on-error/);
    expect(block).not.toMatch(/^\s*if:/m);
  });

  it('the check runs before anything else in the job', () => {
    expect(ciLines().find((line) => /^\s*- (name|uses|run):/.test(line))).toMatch(STEP);
  });
});
