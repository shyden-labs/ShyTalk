/* eslint-disable sonarjs/no-os-command-from-path --
 * Spawns the hardcoded `bash` binary with literal argv to run the REAL
 * scripts/sync-start-commit.sh. A canned `gh` CLI shim is prepended to PATH
 * (the one double: it answers from fixture JSON and logs every call). No
 * user-controlled command reaches the shell. */
/**
 * SHY-0691: every develop merge's story edits reach the board.
 *
 * The sync workflow queues its runs (`queue: max`), and each push syncs from
 * the last commit a sync COMPLETED on develop, so a run lost for any reason is
 * covered by the next one. scripts/sync-start-commit.sh makes that choice and
 * prints exactly one line:
 *
 *   range <sha>     sync --changed <sha> <head>
 *   covered         a newer sync already covered this head: sync nothing
 *   full <reason>   sync --all
 *
 * Any gh call failing, or an answer it cannot read, exits 1 naming the call
 * (fails closed: never a silent fall back to the push's own BEFORE).
 *
 * Spec: .project/stories/SHY-0691-every-merge-reaches-the-board-queued-never-dropped.md
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'sync-start-commit.sh');

const HEAD = 'a'.repeat(40);
const SYNCED = 'b'.repeat(40);
const OTHER = 'c'.repeat(40);
const REPO = 'shyden-labs/ShyTalk';

// Answers per URL kind from fixture files; logs one line of argv per call.
const GH_STUB = `#!/bin/bash
printf '%s\\n' "$*" >> "$GH_STUB_LOG"
case "$2" in
  */actions/workflows/*)
    if [ -n "\${GH_STUB_RUNS_FAIL:-}" ]; then echo "HTTP 502: Bad Gateway" >&2; exit 1; fi
    cat "$GH_STUB_RUNS" ;;
  */compare/*)
    if [ -n "\${GH_STUB_COMPARE_FAIL:-}" ]; then echo "HTTP 404: Not Found" >&2; exit 1; fi
    cat "$GH_STUB_COMPARE" ;;
  *)
    echo "unexpected gh call: $*" >&2; exit 99 ;;
esac
`;

const run = (overrides = {}) => ({
  id: 1001,
  event: 'push',
  head_branch: 'develop',
  head_sha: SYNCED,
  status: 'completed',
  conclusion: 'success',
  ...overrides,
});

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-start-commit-'));
  fs.writeFileSync(path.join(dir, 'gh'), GH_STUB, { mode: 0o755 });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Runs the script against the stub. `runs` is the workflow_runs list,
 * `compare` the compare status (or a raw body via `compareBody`).
 */
function start({
  head = HEAD,
  runs = [run()],
  runsBody,
  compare = 'ahead',
  compareBody,
  runsFail = false,
  compareFail = false,
  repo = REPO,
  noHead = false,
  noRepo = false,
} = {}) {
  const runsFile = path.join(dir, 'runs.json');
  const compareFile = path.join(dir, 'compare.json');
  const log = path.join(dir, 'gh.log');
  fs.writeFileSync(
    runsFile,
    runsBody ?? JSON.stringify({ total_count: runs.length, workflow_runs: runs }),
  );
  fs.writeFileSync(compareFile, compareBody ?? JSON.stringify({ status: compare, ahead_by: 1 }));
  fs.writeFileSync(log, '');
  const env = {
    PATH: `${dir}:${process.env.PATH}`,
    HOME: process.env.HOME,
    GH_TOKEN: 'stub-token',
    GH_STUB_LOG: log,
    GH_STUB_RUNS: runsFile,
    GH_STUB_COMPARE: compareFile,
  };
  if (!noRepo) env.GITHUB_REPOSITORY = repo;
  if (runsFail) env.GH_STUB_RUNS_FAIL = '1';
  if (compareFail) env.GH_STUB_COMPARE_FAIL = '1';
  const args = noHead ? [SCRIPT] : [SCRIPT, head];
  const res = spawnSync('bash', args, { env, encoding: 'utf8' });
  return {
    status: res.status,
    stdout: res.stdout,
    stderr: res.stderr,
    calls: fs.readFileSync(log, 'utf8').split('\n').filter(Boolean),
  };
}

describe('SHY-0691: the start commit of a push sync', () => {
  test('a completed push run behind head gives its range', () => {
    const r = start({ runs: [run()], compare: 'ahead' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`range ${SYNCED}\n`);
    expect(r.stderr).toContain('run 1001');
  });

  test('a schedule run counts as completed', () => {
    const r = start({ runs: [run({ event: 'schedule', id: 2002 })] });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`range ${SYNCED}\n`);
  });

  test('a dispatch run never counts', () => {
    const r = start({
      runs: [
        run({ event: 'workflow_dispatch', head_sha: OTHER, id: 3003 }),
        run({ event: 'push', head_sha: SYNCED, id: 3002 }),
      ],
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`range ${SYNCED}\n`);
  });

  test('a run that has not succeeded never counts, so the current run never counts itself', () => {
    const r = start({
      runs: [
        run({ head_sha: HEAD, status: 'in_progress', conclusion: null, id: 4004 }),
        run({ head_sha: OTHER, conclusion: 'failure', id: 4003 }),
        run({ head_sha: SYNCED, id: 4002 }),
      ],
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`range ${SYNCED}\n`);
  });

  test('a run on another branch never counts', () => {
    const r = start({
      runs: [run({ head_branch: 'main', head_sha: OTHER, id: 5005 }), run({ id: 5004 })],
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`range ${SYNCED}\n`);
  });

  test('the newest completed sync wins: the first match in the newest-first page', () => {
    const r = start({
      runs: [run({ head_sha: SYNCED, id: 6006 }), run({ head_sha: OTHER, id: 6005 })],
    });
    expect(r.stdout).toBe(`range ${SYNCED}\n`);
  });

  test('no completed sync gives a full pass, saying why', () => {
    const r = start({ runs: [run({ event: 'workflow_dispatch' })] });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('full no completed sync found\n');
    // No start commit, so nothing to compare.
    expect(r.calls).toHaveLength(1);
  });

  test('identical gives covered', () => {
    const r = start({ compare: 'identical' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('covered\n');
  });

  test('behind gives covered', () => {
    const r = start({ compare: 'behind' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('covered\n');
  });

  test('diverged gives a full pass, saying why', () => {
    const r = start({ compare: 'diverged' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`full ${SYNCED} is not an ancestor of ${HEAD}\n`);
  });

  test('the runs call failing fails the run, naming the call', () => {
    const r = start({ runsFail: true });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/::error::.*runs/);
  });

  test('the compare call failing fails the run, naming the call', () => {
    const r = start({ compareFail: true });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/::error::.*compare/);
  });

  test('an unknown compare status fails closed', () => {
    const r = start({ compare: 'sideways' });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/::error::.*sideways/);
  });

  test('an unreadable runs answer fails closed', () => {
    const r = start({ runsBody: '<html>rate limited</html>' });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/::error::.*runs/);
  });

  test('a malformed head_sha in the runs answer fails closed', () => {
    const r = start({ runs: [run({ head_sha: 'not-a-sha' })] });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/::error::.*not-a-sha/);
  });

  test('a head argument that is not a full SHA fails closed before any call', () => {
    const r = start({ head: 'HEAD' });
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.calls).toEqual([]);
  });

  test('a missing head argument fails closed before any call', () => {
    const r = start({ noHead: true });
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.calls).toEqual([]);
  });

  test('a missing GITHUB_REPOSITORY fails closed before any call', () => {
    const r = start({ noRepo: true });
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.calls).toEqual([]);
  });

  test('the runs query asks develop, success, newest page of this workflow', () => {
    const r = start();
    expect(r.calls[0]).toBe(
      `api repos/${REPO}/actions/workflows/sync-stories-to-issues.yml/runs?branch=develop&status=success&per_page=50`,
    );
  });

  test('compare asks start...head in that order', () => {
    const r = start();
    expect(r.calls[1]).toBe(`api repos/${REPO}/compare/${SYNCED}...${HEAD}`);
    expect(r.calls).toHaveLength(2);
  });
});
