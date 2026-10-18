/**
 * no-retired-org-name.test.js — SHY-0545.
 *
 * The GitHub organisation was renamed on 2026-10-01. GitHub redirects a
 * renamed repository's URLs, but not an organisation login in GraphQL, nor
 * org pages, nor `github.io` hosts: the story sync failed on every develop
 * push for five days, and the roadmap's board link answered 404. This guard
 * refuses the retired login in every live file, in any case, so a snippet
 * copied from an old branch cannot bring it back.
 *
 * The history folders (.project/stories, handoff, audit and the rest of
 * .project) keep the old name as written and are not read. The retired
 * name is built at runtime, so this file holds no literal of it and its own
 * folder is read like any other.
 *
 * The file set is walked from the filesystem, never listed by hand, and the
 * verdict carries the number of files read beside the findings, so a walk
 * that silently reads nothing cannot pass.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '../../..');
const RETIRED_LOGIN = ['shyden', 'ltd'].join('-');
// Logins are case-insensitive on GitHub, so every spelling is matched.
const RETIRED = new RegExp(RETIRED_LOGIN, 'gi');
// Every top-level folder that holds live code, config or published pages.
// `.project` is history and `assets` / `gradle` hold no text that links out.
const ROOTS = [
  '.claude',
  '.github',
  '.husky',
  'app',
  'express-api',
  'functions',
  'iosApp',
  'journey-tests',
  'local',
  'public',
  'scripts',
  'shared',
  'tests',
];
// Top-level files read by name: the READMEs and the contributor guide. Other
// top-level files are config without links, and untracked notes (a local
// CLAUDE.md or HANDOVER.md) must not move the count between machines.
const ROOT_FILES = /^(README(\.[a-z]{2}(-[A-Za-z]+)?)?|CONTRIBUTING)\.md$/;
const KINDS = /\.(ya?ml|sh|ps1|js|mjs|cjs|ts|tsx|json|md|html|kt|kts|swift|xml|plist|properties)$/;
// Git hooks are shell scripts named without an extension (`pre-push`), so
// every file under these roots is read whatever its name.
const EVERY_FILE_ROOTS = new Set(['.husky']);
// Never tracked: dependencies, build output and tool caches. Pruned before
// descending, so the walk neither slows on them nor counts them.
const PRUNE = new Set([
  'node_modules',
  'build',
  '.gradle',
  '.kotlin',
  'Pods',
  'DerivedData',
  'coverage',
  'test-results',
  'playwright-report',
  'allure-results',
  'allure-report',
  '.superpowers',
]);
// husky writes its untracked runtime into `.husky/_` on install; only that
// path is pruned, not every folder named `_`.
const PRUNE_PATHS = new Set([path.join('.husky', '_')]);
// Measured 2026-10-12 on a clean worktree of develop: files under ROOTS
// with a KINDS extension, plus the ROOT_FILES. Equality, so a file added or
// lost is seen and this figure re-measured.
// 1976 -> 1980 merging develop 9b3259c34fd (SHY-0544): +5 under ROOTS
// (no-minio-image, s3-stand-in-pin, seed-steps test and script, the S3
// integration spec), -1 (seed-minio.test.js).
// 1980 -> 1982: scripts/scan-secrets.js and its test (SHY-0565).
// 1982 -> 1984: scripts/story-progress.js and its test (SHY-0535).
// 1984 -> 1985: root-firebase-peer.test.js (SHY-0568).
// 1985 -> 1987: scripts/dependabot-update-type.js and its test (SHY-0569).
// 1987 -> 1986: dependabot-auto-merge-decision.test.js retired (SHY-0569;
// its matrix now runs in-process in dependabot-update-type.test.js).
// 1986 -> 1988: scripts/check-orphaned-stories.js and its test (SHY-0583).
// 1988 -> 1997: scripts/tester-notes.js, list-build-changes.js,
// app-store-connect.js, set-testflight-whats-new.js, their four tests and
// deploy-dev-tester-notes.test.js (SHY-0361).
// 1997 -> 2002: scripts/deploy-plan.js, deploy-failure-issue.js, their two
// tests and deploy-dev-on-merge.test.js (SHY-0534).
// 2002 -> 2003: tests/utils/suspension.test.js (SHY-0597).
// 2003 -> 2004: tests/web/helpers/admin-autosave.ts (SHY-0597).
// 2004 -> 2013: express-api/src/utils/auto-bans.js, end-suspension.js,
// warnings.js; tests/utils/{auto-bans,end-suspension,warnings,appeals}
// .unit.test.js; tests/routes/suspension-ending-restores-everything.test.js;
// tests/scripts/suspension-ends-in-one-place.test.js (SHY-0605).
// 2013 -> 2016: scripts/sonar-verdict.js, tests/scripts/sonar-verdict.unit.test.js
// and tests/scripts/sonarcloud-gate-blocks.test.js (SHY-0625).
// 2016 -> 2021: express-api/src/utils/message-history.js,
// conversation-write-gate.js, src/routes/conversation-message-edits.js,
// tests/unit/message-history.test.js and
// tests/routes/conversation-message-edits.test.js (SHY-0614).
// 2021 -> 2029: src/utils/delete-tree.js, scripts/delete-orphaned-message-history.js,
// tests/helpers/conversation-tree.js, tests/utils/delete-tree.unit.test.js,
// tests/utils/conversation-tree-paths.test.js,
// tests/cron/accountDeletion-failure.unit.test.js and the script's two test
// files (SHY-0631). 2029 -> 2031: .github/workflows/delete-orphaned-message-history.yml
// and tests/scripts/delete-orphaned-message-history-workflow.unit.test.js (SHY-0631).
// 2031 -> 2032: tests/scripts/reset-data.unit.test.js (SHY-0641).
// 2032 -> 2034: shared/.../data/remote/PrivateMessageEditApi.kt and its
// commonTest (SHY-0614). 2034 -> 2035:
// tests/firestore-rules/message-history-rules.test.js (SHY-0614).
const FILES_READ_FLOOR = 2035;

function findRetiredName(text) {
  return text.match(RETIRED) ?? [];
}

function walk(repoRoot, rel, out) {
  const everyFile = EVERY_FILE_ROOTS.has(rel.split(path.sep)[0]);
  for (const entry of fs.readdirSync(path.join(repoRoot, rel), { withFileTypes: true })) {
    const child = path.join(rel, entry.name);
    if (entry.isDirectory()) {
      if (!PRUNE.has(entry.name) && !PRUNE_PATHS.has(child)) walk(repoRoot, child, out);
    } else if (entry.isFile() && (everyFile || KINDS.test(entry.name))) {
      out.push(child);
    }
  }
  return out;
}

function scan(repoRoot, roots) {
  const top = fs
    .readdirSync(repoRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && ROOT_FILES.test(entry.name))
    .map((entry) => entry.name);
  const files = [...top, ...roots.flatMap((root) => walk(repoRoot, root, []))];
  const findings = files.flatMap((rel) =>
    findRetiredName(fs.readFileSync(path.join(repoRoot, rel), 'utf8')).map(
      (name) => `${rel}: ${name}`,
    ),
  );
  return { files, findings };
}

describe('SHY-0545 — no live file names the retired GitHub organisation', () => {
  const { files, findings } = scan(REPO, ROOTS);

  test('no live file names the retired organisation login, in any case', () => {
    expect({ filesRead: files.length, findings }).toEqual({
      filesRead: FILES_READ_FLOOR,
      findings: [],
    });
  });

  test.each(ROOTS)('the walk reads at least one file under %s', (root) => {
    expect(files.filter((rel) => rel.startsWith(root + path.sep)).length).toBeGreaterThan(0);
  });

  test.each([
    'README.md',
    'README.zh.md',
    'scripts/sync-stories-to-issues.sh',
    '.github/actions/publish-gh-pages/action.yml',
    'public/roadmap.html',
    'public/js/roadmap-app.js',
    'express-api/tests/scripts/no-retired-org-name.test.js',
  ])('the walk reads %s, a file that named the organisation', (rel) => {
    expect(files).toContain(path.join(...rel.split('/')));
  });
});

describe('SHY-0545 — findRetiredName recognises every spelling', () => {
  const upper = RETIRED_LOGIN.toUpperCase();
  const title = 'S' + RETIRED_LOGIN.slice(1, 7) + 'L' + RETIRED_LOGIN.slice(8);
  test.each([
    ['a repository URL', `https://github.com/${title}/ShyTalk`, title],
    ['an org project URL', `https://github.com/orgs/${title}/projects/1`, title],
    ['a Pages host', `https://${RETIRED_LOGIN}.github.io/ShyTalk/`, RETIRED_LOGIN],
    ['a shell default', `PROJECT_OWNER="\${PROJECT_OWNER:-${title}}"`, title],
    ['a GraphQL login', `organization(login: "${title}")`, title],
    ['an upper-case login', `owner: ${upper}`, upper],
  ])('finds %s', (_form, line, expected) => {
    expect(findRetiredName(line)).toEqual([expected]);
  });

  test.each([
    ['the new login', 'https://github.com/shyden-labs/ShyTalk'],
    ['the company in prose', 'Shyden Ltd was dissolved'],
    ['the brand alone', 'https://shyden.co.uk'],
  ])('passes %s', (_form, line) => {
    expect(findRetiredName(line)).toEqual([]);
  });

  test('the title-case fixture spells the login as the old code did', () => {
    expect(title).toBe('Shyden-' + 'Ltd');
  });
});

describe('SHY-0545 — a planted name in a scanned file turns the verdict red', () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'shy0545-'));
    fs.mkdirSync(path.join(root, 'scripts', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(root, 'scripts', 'clean.sh'), 'OWNER=shyden-labs\n');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test.each([
    ['scripts/nested/sync.sh', `PROJECT_OWNER=${RETIRED_LOGIN}\n`],
    ['scripts/page.html', `<a href="https://github.com/orgs/${RETIRED_LOGIN}/projects/1">\n`],
    ['README.md', `[repo](https://github.com/${RETIRED_LOGIN}/ShyTalk)\n`],
  ])('a planted %s is reported by path', (rel, body) => {
    fs.writeFileSync(path.join(root, rel), body);
    const { files, findings } = scan(root, ['scripts']);
    expect({ filesRead: files.length, findings: findings.map((f) => f.split(':')[0]) }).toEqual({
      filesRead: 2,
      findings: [path.join(...rel.split('/'))],
    });
  });

  test.each(['node_modules', 'build', '.gradle'])('a file under %s is not read', (dir) => {
    fs.mkdirSync(path.join(root, 'scripts', dir), { recursive: true });
    fs.writeFileSync(path.join(root, 'scripts', dir, 'x.js'), `${RETIRED_LOGIN}\n`);
    expect(scan(root, ['scripts'])).toEqual({
      files: [path.join('scripts', 'clean.sh')],
      findings: [],
    });
  });

  test('an extensionless git hook under .husky is read', () => {
    fs.mkdirSync(path.join(root, '.husky'));
    fs.writeFileSync(path.join(root, '.husky', 'pre-push'), `gh api orgs/${RETIRED_LOGIN}\n`);
    expect(scan(root, ['.husky']).findings).toEqual([
      `${path.join('.husky', 'pre-push')}: ${RETIRED_LOGIN}`,
    ]);
  });

  test("husky's untracked runtime under .husky/_ is not read", () => {
    fs.mkdirSync(path.join(root, '.husky', '_'), { recursive: true });
    fs.writeFileSync(path.join(root, '.husky', 'pre-push'), 'npm test\n');
    fs.writeFileSync(path.join(root, '.husky', '_', 'h'), `${RETIRED_LOGIN}\n`);
    expect(scan(root, ['.husky'])).toEqual({
      files: [path.join('.husky', 'pre-push')],
      findings: [],
    });
  });

  test('a folder named _ outside .husky is read', () => {
    fs.mkdirSync(path.join(root, 'scripts', '_'));
    fs.writeFileSync(path.join(root, 'scripts', '_', 'x.sh'), `${RETIRED_LOGIN}\n`);
    expect(scan(root, ['scripts']).findings).toEqual([
      `${path.join('scripts', '_', 'x.sh')}: ${RETIRED_LOGIN}`,
    ]);
  });

  test('an extensionless file elsewhere is not read', () => {
    fs.writeFileSync(path.join(root, 'scripts', 'LICENSE'), `${RETIRED_LOGIN}\n`);
    expect(scan(root, ['scripts']).files).toEqual([path.join('scripts', 'clean.sh')]);
  });

  test('a top-level file that is not a README is not read', () => {
    fs.writeFileSync(path.join(root, 'HANDOVER.md'), `${RETIRED_LOGIN}\n`);
    expect(scan(root, ['scripts'])).toEqual({
      files: [path.join('scripts', 'clean.sh')],
      findings: [],
    });
  });
});
