/* eslint-disable sonarjs/no-os-command-from-path --
 * Spawns the hardcoded `bash` binary with literal argv to run the REAL
 * "Sync stories to GitHub Issues" step body extracted from the workflow.
 * Canned `git`, `scripts/sync-start-commit.sh` and
 * `scripts/sync-stories-to-issues.sh` stand in, each logging its argv. No
 * user-controlled command reaches the shell. */
/**
 * SHY-0691: sync runs queue, and each push syncs from the last completed sync.
 *
 * Structure (parsed YAML, so comments cannot satisfy a pin):
 *   - concurrency `queue: max`, never cancel-in-progress;
 *   - permissions add `actions: read` (the runs lookup) to `contents: read`
 *     (pinned in sync-stories-alert.test.js);
 *   - actionlint's refusal of `queue` is ignored for that one message in that
 *     one file (rhysd/actionlint#654 is unreleased).
 * Behaviour (the step body run under bash): a push asks
 * scripts/sync-start-commit.sh for its start with the job's GITHUB_TOKEN and
 * maps `range` / `covered` / `full` to --changed / an early success / --all.
 *
 * Spec: .project/stories/SHY-0691-every-merge-reaches-the-board-queued-never-dropped.md
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const WORKFLOW_PATH = '.github/workflows/sync-stories-to-issues.yml';
const WORKFLOW = path.join(REPO_ROOT, WORKFLOW_PATH);
const ACTIONLINT = path.join(REPO_ROOT, '.github', 'actionlint.yaml');
const STEP_NAME = 'Sync stories to GitHub Issues';
const QUEUE_MESSAGE = 'unexpected key "queue" for "concurrency" section';

const HEAD = 'a'.repeat(40);
const START = 'b'.repeat(40);

const workflow = () => yaml.load(fs.readFileSync(WORKFLOW, 'utf8'));
const syncStep = () => workflow().jobs.sync.steps.find((s) => s.name === STEP_NAME);

describe('SHY-0691: the sync workflow queues its runs', () => {
  test('concurrency queues every run and never cancels one in progress', () => {
    const { concurrency } = workflow();
    expect(concurrency.group).toBe('sync-stories');
    expect(concurrency.queue).toBe('max');
    // GitHub rejects queue: max with cancel-in-progress: true.
    expect(concurrency['cancel-in-progress']).not.toBe(true);
  });

  // The exact permission set is pinned once, in sync-stories-alert.test.js.

  test("the start lookup runs with the job's GITHUB_TOKEN, never the project PAT", () => {
    const step = syncStep();
    expect(step.env.SYNC_LOOKUP_TOKEN).toBe('${{ github.token }}');
    expect(step.run).toContain(
      'GH_TOKEN="$SYNC_LOOKUP_TOKEN" bash scripts/sync-start-commit.sh "$head_sha"',
    );
  });
});

describe('SHY-0691: the actionlint ignore is narrow', () => {
  test('one path, the sync workflow, ignoring only the queue message', () => {
    const config = yaml.load(fs.readFileSync(ACTIONLINT, 'utf8'));
    expect(Object.keys(config.paths)).toEqual([WORKFLOW_PATH]);
    const { ignore } = config.paths[WORKFLOW_PATH];
    expect(ignore).toHaveLength(1);
    // The pattern is a regex: it must match the queue message and no other
    // message actionlint emits for a concurrency section.
    const re = new RegExp(ignore[0]);
    expect(re.test(QUEUE_MESSAGE)).toBe(true);
    expect(re.test('unexpected key "group" for "concurrency" section')).toBe(false);
    expect(re.test('unexpected key "queue" for "jobs" section')).toBe(false);
    expect(re.test('"cancel-in-progress" must be a boolean')).toBe(false);
  });

  test('the ignore names the upstream PR it waits for', () => {
    expect(fs.readFileSync(ACTIONLINT, 'utf8')).toContain('rhysd/actionlint#654');
  });
});

/**
 * The step's `run:` body, de-indented as GitHub runs it.
 */
function runBody() {
  return syncStep().run;
}

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-stories-queue-'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.mkdirSync(path.join(dir, 'bin'));
  // git: rev-parse HEAD answers HEAD; fetch is logged.
  fs.writeFileSync(
    path.join(dir, 'bin', 'git'),
    `#!/bin/bash\nprintf 'git %s\\n' "$*" >> "$CALL_LOG"\nif [ "$1" = rev-parse ]; then echo ${HEAD}; fi\n`,
    { mode: 0o755 },
  );
  // The start script answers $START_ANSWER (or fails with $START_RC) and logs
  // its argv and the token it was given.
  fs.writeFileSync(
    path.join(dir, 'scripts', 'sync-start-commit.sh'),
    '#!/bin/bash\nprintf \'start %s token=%s\\n\' "$*" "$GH_TOKEN" >> "$CALL_LOG"\n' +
      'if [ -n "${START_RC:-}" ]; then exit "$START_RC"; fi\necho "$START_ANSWER"\n',
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(dir, 'scripts', 'sync-stories-to-issues.sh'),
    '#!/bin/bash\nprintf \'sync %s\\n\' "$*" >> "$CALL_LOG"\n',
    { mode: 0o755 },
  );
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function runStep({ event = 'push', answer, startRc, dryRun = '', rebuild = '' } = {}) {
  const log = path.join(dir, 'calls.log');
  fs.writeFileSync(log, '');
  const env = {
    PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`,
    HOME: process.env.HOME,
    CALL_LOG: log,
    GH_PAT_PROJECT: 'project-pat',
    GH_TOKEN: 'project-pat',
    SYNC_LOOKUP_TOKEN: 'job-token',
    EVENT: event,
    BEFORE: 'c'.repeat(40),
    DRY_RUN: dryRun,
    REBUILD: rebuild,
    SYNC_LIMIT_MINUTES: '15',
  };
  if (answer !== undefined) env.START_ANSWER = answer;
  if (startRc !== undefined) env.START_RC = String(startRc);
  // GitHub runs `run:` under `bash -e {0}`.
  const res = spawnSync('bash', ['-e', '-c', runBody()], { cwd: dir, env, encoding: 'utf8' });
  return {
    status: res.status,
    stdout: res.stdout,
    stderr: res.stderr,
    calls: fs.readFileSync(log, 'utf8').split('\n').filter(Boolean),
  };
}

describe('SHY-0691: a push sync starts from the last completed sync', () => {
  test('range: fetches the start and syncs --changed start head', () => {
    const r = runStep({ answer: `range ${START}` });
    expect(r.status).toBe(0);
    expect(r.calls).toEqual([
      'git rev-parse HEAD',
      `start ${HEAD} token=job-token`,
      `git fetch --no-tags --depth=1 origin ${START}`,
      `sync --changed ${START} ${HEAD}`,
    ]);
    expect(r.stdout).toContain(`${START}..${HEAD}`);
  });

  test("the push's own before is never used", () => {
    const r = runStep({ answer: `range ${START}` });
    expect(r.calls.join('\n')).not.toContain('c'.repeat(40));
  });

  test('covered: syncs nothing, says so, and succeeds', () => {
    const r = runStep({ answer: 'covered' });
    expect(r.status).toBe(0);
    expect(r.calls).toEqual(['git rev-parse HEAD', `start ${HEAD} token=job-token`]);
    expect(r.stdout).toMatch(/nothing to sync/);
  });

  test('full: syncs --all and prints the reason', () => {
    const r = runStep({ answer: 'full no completed sync found' });
    expect(r.status).toBe(0);
    expect(r.calls.at(-1)).toBe('sync --all');
    expect(r.stdout).toContain('no completed sync found');
  });

  test('the lookup failing fails the step and syncs nothing', () => {
    const r = runStep({ startRc: 1 });
    expect(r.status).not.toBe(0);
    expect(r.calls.some((c) => c.startsWith('sync '))).toBe(false);
  });

  test('an answer the step does not know fails the step and syncs nothing', () => {
    const r = runStep({ answer: 'sideways' });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/::error::.*sideways/);
    expect(r.calls.some((c) => c.startsWith('sync '))).toBe(false);
  });

  test('a schedule runs the full pass without a lookup', () => {
    const r = runStep({ event: 'schedule' });
    expect(r.status).toBe(0);
    expect(r.calls).toEqual(['sync --all']);
  });

  test('a dispatch runs the full pass without a lookup', () => {
    const r = runStep({ event: 'workflow_dispatch', dryRun: 'true' });
    expect(r.status).toBe(0);
    expect(r.calls).toEqual(['sync --all --dry-run --verbose']);
  });
});
