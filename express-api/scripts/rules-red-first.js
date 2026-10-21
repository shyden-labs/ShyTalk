'use strict';

/**
 * rules-red-first.js — SHY-0657. The CI step "Rules red-first: new DENY
 * tests fail on the base rules", run from test-backend.yml after the main
 * jest run, with the emulators already up.
 *
 * On a PR that changes firestore.rules, every DENY rules test the PR adds, or
 * rewrites under the same name (Shyden, 2026-10-21), is run against the base
 * branch's rules (loaded through
 * SHYTALK_RULES_UNDER_TEST, as test input only) and must fail there for the
 * reason assertFails gives when a request succeeds. A test that passes there
 * tests nothing the change made; one that fails for any other reason proves
 * nothing either. The recorded fixture cases (red-first-fixtures.json) are
 * re-proved against their old rules whenever anything in scope changes.
 *
 * Tests are found by name: jest lists them on both sides (a run whose name
 * pattern matches nothing runs no hook and no test, measured), the base side
 * from a detached worktree of the base SHA. A DENY name that vanished from
 * the base and one that appeared in the head with the same code is a rename.
 * Code is compared with comments removed and whitespace collapsed, so a
 * reworded comment is neither a rewrite nor a new test.
 * Every rules test is named by what it asserts, which a guard holds
 * (tests/scripts/rules-tests-named-by-assertion.test.js).
 *
 * Every failure to read, list or run fails the step, naming what failed.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  extractTests,
  familyRegex,
  rulesTestFiles,
} = require('../tests/firestore-rules/_helpers/rules-test-names.js');
const { RULES_OVERRIDE_ENV } = require('../tests/firestore-rules/_helpers/rules-source.js');

const REASON = 'Expected request to fail, but it succeeded.';
const NEVER = '^(?!)$';
const FIXTURES = 'tests/firestore-rules/red-first-fixtures.json';
const SCOPE_PREFIXES = [
  'express-api/tests/firestore-rules/_helpers/',
  'express-api/tests/firestore-rules/fixtures/',
];
const SCOPE_FILES = [
  'firestore.rules',
  `express-api/${FIXTURES}`,
  'express-api/scripts/rules-red-first.js',
];
const DENY = 'DENY: ';

const key = (t) => `${t.file}: ${t.fullName}`;
const firstLine = (text) => String(text).split('\n')[0];
// A suite that could not load reports no test and says why in `message`. jest
// also fills `message` whenever any test fails (measured, PR Checks run
// 39558776688), so a message alone is not a load failure.
const didNotLoad = (result) => result.assertionResults.length === 0 && Boolean(result.message);

// Each test a name-only listing reported, as { file, fullName } relative to `cwd`.
function listed(json, cwd, files) {
  const byFile = new Map(json.testResults.map((r) => [path.relative(cwd, r.name), r]));
  return files.flatMap((file) => {
    const result = byFile.get(file);
    if (!result) throw new Error(`${file} is not in jest's results`);
    if (didNotLoad(result)) throw new Error(`${file} did not load: ${firstLine(result.message)}`);
    return result.assertionResults.map((a) => {
      if (a.status !== 'pending') throw new Error(`${file}: "${a.fullName}" ran while listing`);
      return { file, fullName: a.fullName };
    });
  });
}

// Gives each listed test its title and code from source; `extracted` maps file → extractTests().
function attachBodies(list, extracted) {
  return list.map(({ file, fullName }) => {
    const tests = extracted[file] ?? [];
    const match =
      tests.find((s) => !s.family && s.fullName === fullName) ??
      tests.find((s) => s.family && familyRegex(s.fullName).test(fullName));
    if (!match)
      throw new Error(`${file}: jest lists "${fullName}", which no test in the source names`);
    return { file, fullName, title: match.title, code: match.code };
  });
}

// The DENY tests a PR adds, and those it rewrites under the same name (Shyden,
// 2026-10-21: "they should" meet the base rules too). Code is compared with
// comments removed and whitespace collapsed, so a reworded comment is neither.
// A vanished base DENY test with the same code as an appeared one is a rename.
function addedDenyTests(base, head) {
  const baseByKey = new Map(base.map((t) => [key(t), t]));
  const headKeys = new Set(head.map(key));
  const isDeny = (t) => t.title.startsWith(DENY);
  const vanished = base.filter((t) => isDeny(t) && !headKeys.has(key(t)));
  const added = [];
  const rewritten = [];
  const renamed = [];
  for (const t of head.filter(isDeny)) {
    const before = baseByKey.get(key(t));
    if (before) {
      if (before.code !== t.code) rewritten.push(t);
      continue;
    }
    const i = vanished.findIndex((v) => v.code === t.code);
    if (i === -1) {
      added.push(t);
    } else {
      renamed.push({ from: key(vanished[i]), to: key(t) });
      vanished.splice(i, 1);
    }
  }
  return { added, rewritten, renamed };
}

function namePattern(fullNames) {
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `^(?:${fullNames.map(escape).join('|')})$`;
}

function verdict(json, planned, cwd) {
  const byFile = new Map(json.testResults.map((r) => [path.relative(cwd, r.name), r]));
  const rows = planned.map((p) => {
    const test = key(p);
    const result = byFile.get(p.file);
    if (result && didNotLoad(result)) {
      return {
        test,
        result: 'missing',
        detail: `suite did not load: ${firstLine(result.message)}`,
      };
    }
    const a = result && result.assertionResults.find((r) => r.fullName === p.fullName);
    if (!a) return { test, result: 'missing', detail: "not in jest's results" };
    if (a.status === 'passed') {
      return {
        test,
        result: 'passed',
        detail: 'passes on these rules: it tests nothing the change made',
      };
    }
    if (a.status !== 'failed') return { test, result: 'skipped', detail: 'did not run' };
    if (a.failureMessages.length === 0)
      return { test, result: 'wrong-reason', detail: 'failed with no message' };
    // jest-retry-setup retries a failing test (SHY-0547): every attempt must fail for the reason.
    const wrong = a.failureMessages.find((m) => !m.includes(REASON));
    if (wrong !== undefined) return { test, result: 'wrong-reason', detail: firstLine(wrong) };
    return { test, result: 'red', detail: '' };
  });
  return { ok: rows.every((r) => r.result === 'red'), rows };
}

// The changed files this step covers; `rulesFiles` are relative to express-api.
function inScope(changed, rulesFiles) {
  const files = new Set([...SCOPE_FILES, ...rulesFiles.map((f) => `express-api/${f}`)]);
  return changed.filter((c) => files.has(c) || SCOPE_PREFIXES.some((p) => c.startsWith(p)));
}

function table(rows) {
  if (rows.length === 0) return '';
  return [
    '| Test | Result | Detail |',
    '| --- | --- | --- |',
    ...rows.map((r) => `| ${r.test} | ${r.result} | ${r.detail} |`),
  ].join('\n');
}

const count = (n, what) => `${n} ${what} DENY test${n === 1 ? '' : 's'}`;

function summary({ baseSha, rulesChanged, added, rewritten, renamed, rows, fixtureRuns }) {
  const parts = [`## Rules red-first (base ${baseSha})`, ''];
  if (rulesChanged) {
    parts.push(
      `firestore.rules changed: ${count(added.length, 'added')}, ${count(rewritten.length, 'rewritten')}; each run against the base rules.`,
    );
    parts.push('', table(rows));
  } else {
    parts.push(
      'firestore.rules is unchanged against the base: no added or rewritten DENY test needs to be shown red.',
    );
  }
  if (renamed.length > 0) {
    parts.push(
      '',
      'Renamed or moved (same code, not run):',
      ...renamed.map((r) => `- ${r.from} → ${r.to}`),
    );
  }
  for (const run of fixtureRuns) {
    parts.push('', `### Fixture ${run.story} (${run.rules})`, '', table(run.rows));
  }
  return `${parts.join('\n')}\n`;
}

function runFixtures({ readFile, exists, runJest }, headApi) {
  const file = path.join(headApi, FIXTURES);
  const fixtures = JSON.parse(readFile(file));
  if (!Array.isArray(fixtures) || fixtures.length === 0)
    throw new Error(`${FIXTURES} lists no fixture`);
  return fixtures.map((f) => {
    const rules = path.join(headApi, f.rules);
    if (!exists(rules)) throw new Error(`${f.rules} (fixture ${f.story}) does not exist`);
    const files = [...new Set(f.tests.map((t) => t.file))];
    const json = runJest({
      cwd: headApi,
      files,
      pattern: namePattern(f.tests.map((t) => t.fullName)),
      env: { [RULES_OVERRIDE_ENV]: rules },
    });
    const v = verdict(json, f.tests, headApi);
    return { story: f.story, rules: f.rules, ...v };
  });
}

function sides({ population, readFile, runJest }, root) {
  const api = path.join(root, 'express-api');
  const files = population(root);
  const extracted = Object.fromEntries(
    files.map((f) => [f, extractTests(readFile(path.join(api, f)), f)]),
  );
  const list = listed(runJest({ cwd: api, files, pattern: NEVER, env: {} }), api, files);
  return attachBodies(list, extracted);
}

function main(deps) {
  const { env, repoRoot, git, population, exists, write, appendSummary } = deps;
  const baseSha = env.BASE_SHA;
  if (!baseSha || !env.RUNNER_TEMP) {
    write('BASE_SHA and RUNNER_TEMP must both be set');
    return 1;
  }
  const report = {
    baseSha,
    rulesChanged: false,
    added: [],
    rewritten: [],
    renamed: [],
    rows: [],
    fixtureRuns: [],
  };
  try {
    const headApi = path.join(repoRoot, 'express-api');
    const changed = git.changedFiles(baseSha);
    const scope = inScope(changed, population(repoRoot));
    if (scope.length === 0) {
      const line = `No rules, rules test or red-first file changed against base ${baseSha}: nothing to prove.`;
      write(line);
      appendSummary(`## Rules red-first (base ${baseSha})\n\n${line}\n`);
      return 0;
    }
    write(`In scope against base ${baseSha}: ${scope.join(', ')}`);
    const baseDir = path.join(env.RUNNER_TEMP, 'rules-red-first-base');
    try {
      git.addBaseWorktree(baseSha, baseDir);
    } catch (err) {
      throw new Error(`cannot check out base ${baseSha}: ${err.message}`, { cause: err });
    }
    const baseRules = path.join(baseDir, 'firestore.rules');
    if (!exists(baseRules)) throw new Error(`firestore.rules is absent at base ${baseSha}`);
    report.rulesChanged = changed.includes('firestore.rules');
    if (report.rulesChanged) {
      const head = sides(deps, repoRoot);
      const base = sides(deps, baseDir);
      Object.assign(report, addedDenyTests(base, head));
      const planned = [...report.added, ...report.rewritten];
      if (planned.length === 0) {
        write('::notice::firestore.rules changed and 0 added or rewritten DENY tests were found');
      } else {
        const files = [...new Set(planned.map((t) => t.file))];
        const json = deps.runJest({
          cwd: headApi,
          files,
          pattern: namePattern(planned.map((t) => t.fullName)),
          env: { [RULES_OVERRIDE_ENV]: baseRules },
        });
        report.rows = verdict(json, planned, headApi).rows;
      }
    }
    report.fixtureRuns = runFixtures(deps, headApi);
    const all = [...report.rows, ...report.fixtureRuns.flatMap((f) => f.rows)];
    for (const r of all)
      write(
        `${r.result === 'red' ? 'red' : `FAIL (${r.result})`}: ${r.test}${r.detail ? ` — ${r.detail}` : ''}`,
      );
    for (const r of report.renamed) write(`renamed, not counted: ${r.from} → ${r.to}`);
    const ok = all.every((r) => r.result === 'red');
    write(
      ok
        ? 'Rules red-first: every case is red for the assertFails reason.'
        : 'Rules red-first: FAILED, see the cases above.',
    );
    appendSummary(summary(report));
    return ok ? 0 : 1;
  } catch (err) {
    write(`Rules red-first failed closed: ${err.message}`);
    appendSummary(`${summary(report)}\n**Failed closed:** ${err.message}\n`);
    return 1;
  }
}

module.exports = {
  REASON,
  NEVER,
  listed,
  attachBodies,
  addedDenyTests,
  namePattern,
  verdict,
  inScope,
  summary,
  main,
};

if (require.main === module) {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const run = (cmd, args, opts = {}) => {
    const r = spawnSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      ...opts,
    });
    if (r.error) throw r.error;
    return r;
  };
  const git = (args) => {
    const r = run('git', args, { cwd: repoRoot });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} exited ${r.status}`);
    return r.stdout;
  };
  let jestRuns = 0;
  process.exitCode = main({
    env: process.env,
    repoRoot,
    git: {
      // Two-dot: the PR's base SHA is the base tip, and develop requires an up-to-date branch.
      changedFiles: (sha) => git(['diff', '--name-only', sha, 'HEAD']).split('\n').filter(Boolean),
      addBaseWorktree: (sha, dir) => {
        git(['worktree', 'add', '--detach', dir, sha]);
        fs.symlinkSync(
          path.join(repoRoot, 'express-api', 'node_modules'),
          path.join(dir, 'express-api', 'node_modules'),
        );
      },
    },
    population: (root) => {
      const api = path.join(root, 'express-api');
      return rulesTestFiles(path.join(api, 'tests')).map((s) => path.relative(api, s.file));
    },
    exists: (p) => fs.existsSync(p),
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    runJest: ({ cwd, files, pattern, env }) => {
      jestRuns += 1;
      const outputFile = path.join(process.env.RUNNER_TEMP, `rules-red-first-${jestRuns}.json`);
      const args = [
        '--experimental-vm-modules',
        'node_modules/.bin/jest',
        '--runTestsByPath',
        ...files,
      ];
      args.push(
        '-t',
        pattern,
        '--json',
        `--outputFile=${outputFile}`,
        '--coverage=false',
        '--forceExit',
      );
      // jest exits 1 when a test fails, which is the point here: its exit code is never the verdict.
      run('node', args, {
        cwd,
        env: { ...process.env, ...env },
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      if (!fs.existsSync(outputFile)) throw new Error(`jest wrote no ${outputFile}`);
      try {
        return JSON.parse(fs.readFileSync(outputFile, 'utf8'));
      } catch (err) {
        throw new Error(`jest's ${outputFile} does not parse: ${err.message}`, { cause: err });
      }
    },
    write: (line) => process.stdout.write(`${line}\n`),
    appendSummary: (md) => {
      if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
    },
  });
}
