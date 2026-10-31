import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { RELEASE_CUT } from '../../scripts/branch-rules-setup.ts';
import { withoutPinnedShas, withoutYamlComments, yamlBlock } from './source-text.ts';
import { auditReleaseCut, gatherFacts, main, MERGE_REF, parseParents, statusFor, type ReleaseCutFacts } from '../../scripts/release-cut.ts';

// git is stood in: a unit test starts no process. Each test answers git by its arguments.
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
const git = vi.mocked(execFileSync);

/**
 * A pull request into main merges only a release cut (issue shyden-labs/repo-template#86): main is not
 * strict, because each release merge lands on main and never on squash-only
 * develop, so release-cut proves what strict did. These cases plant each way
 * a merge into main could land something CI never tested.
 */

const HEAD = 'a'.repeat(40);
const MERGE = 'b'.repeat(40);
const OLD_MAIN = 'c'.repeat(40);
const OLD_CUT = 'd'.repeat(40);
const STRAY = 'e'.repeat(40);
const TREE = 'f'.repeat(40);
/** The pull request's merge ref, GitHub's merge of HEAD into main's tip. */
const PR_MERGE = '9'.repeat(40);
/** origin's develop, which every answer from origin must name. */
const DEVELOP_TIP = '8'.repeat(40);

/** A second cut after one release merge: every fact as it should be. */
const good: ReleaseCutFacts = {
  headRef: 'release/2026-10-23',
  headSha: HEAD,
  originHeadSha: HEAD,
  headOnDevelop: true,
  mergeParents: [MERGE, HEAD],
  mergeTree: TREE,
  headTree: TREE,
  mainCommits: [{ sha: MERGE, parents: [OLD_MAIN, OLD_CUT], secondParentOnDevelop: true }],
};

describe('auditReleaseCut', () => {
  it('passes the first cut, when main holds nothing develop lacks', () => {
    expect(auditReleaseCut({ ...good, mainCommits: [] })).toEqual([]);
  });

  it('passes a second cut after one release merge', () => {
    expect(auditReleaseCut(good)).toEqual([]);
  });

  it.each(['feature/x', 'releases/2026-10-23', 'release', 'release/', 'xrelease/2026-10-23'])('refuses the head branch %s', (headRef) => {
    expect(auditReleaseCut({ ...good, headRef })).toEqual([`the head branch is ${headRef}, not a release/ branch`]);
  });

  // The head ref is only a name the pull request gives: origin must hold that branch, at this head (issue shyden-labs/repo-template#103).
  it('refuses a head branch origin does not hold', () => {
    expect(auditReleaseCut({ ...good, originHeadSha: null })).toEqual(['origin holds no branch release/2026-10-23']);
  });

  it('refuses a head branch origin holds at another commit', () => {
    expect(auditReleaseCut({ ...good, originHeadSha: STRAY })).toEqual([
      `origin's release/2026-10-23 is at ${STRAY}, not the head ${HEAD}`,
    ]);
  });

  it('refuses a head that is not on develop', () => {
    expect(auditReleaseCut({ ...good, headOnDevelop: false })).toEqual([`the head ${HEAD} is not on origin/develop`]);
  });

  // The tree check means nothing unless the checked-out commit is the merge of this head.
  it.each([
    ['an older head', [MERGE, STRAY]],
    ['no merge at all', [MERGE]],
    ['an octopus', [MERGE, HEAD, STRAY]],
  ])('refuses a checked-out commit that is the merge of %s', (_name, mergeParents) => {
    expect(auditReleaseCut({ ...good, mergeParents })).toEqual([
      `the checked-out commit is not GitHub's merge of the head ${HEAD} into main (its parents: ${mergeParents.join(' ')})`,
    ]);
  });

  it('refuses a merge whose tree is not the head’s', () => {
    expect(auditReleaseCut({ ...good, mergeTree: STRAY })).toEqual([`the merge would land tree ${STRAY}, not the head's tree ${TREE}`]);
  });

  it('refuses a main holding a direct commit', () => {
    const commits = [{ sha: STRAY, parents: [MERGE], secondParentOnDevelop: null }, ...good.mainCommits];
    expect(auditReleaseCut({ ...good, mainCommits: commits })).toEqual([
      `main holds ${STRAY}, which has 1 parent, not a merge of a release cut`,
    ]);
  });

  it('refuses a main holding a squash of a release', () => {
    expect(auditReleaseCut({ ...good, mainCommits: [{ sha: STRAY, parents: [OLD_MAIN], secondParentOnDevelop: null }] })).toEqual([
      `main holds ${STRAY}, which has 1 parent, not a merge of a release cut`,
    ]);
  });

  it('refuses a main holding an octopus merge', () => {
    const octopus = { sha: STRAY, parents: [OLD_MAIN, OLD_CUT, HEAD], secondParentOnDevelop: null };
    expect(auditReleaseCut({ ...good, mainCommits: [octopus] })).toEqual([
      `main holds ${STRAY}, which has 3 parents, not a merge of a release cut`,
    ]);
  });

  it('refuses a main holding a merge whose second parent is not on develop', () => {
    const merge = { sha: MERGE, parents: [OLD_MAIN, STRAY], secondParentOnDevelop: false };
    expect(auditReleaseCut({ ...good, mainCommits: [merge] })).toEqual([
      `main holds the merge ${MERGE}, whose second parent ${STRAY} is not on origin/develop`,
    ]);
  });

  it('names every failure, in the order it judges them', () => {
    const facts: ReleaseCutFacts = {
      headRef: 'feature/x',
      headSha: HEAD,
      originHeadSha: STRAY,
      headOnDevelop: false,
      mergeParents: [MERGE],
      mergeTree: STRAY,
      headTree: TREE,
      mainCommits: [{ sha: STRAY, parents: [OLD_MAIN], secondParentOnDevelop: null }],
    };
    expect(auditReleaseCut(facts)).toEqual([
      'the head branch is feature/x, not a release/ branch',
      `origin's feature/x is at ${STRAY}, not the head ${HEAD}`,
      `the head ${HEAD} is not on origin/develop`,
      `the checked-out commit is not GitHub's merge of the head ${HEAD} into main (its parents: ${MERGE})`,
      `the merge would land tree ${STRAY}, not the head's tree ${TREE}`,
      `main holds ${STRAY}, which has 1 parent, not a merge of a release cut`,
    ]);
  });
});

describe('parseParents', () => {
  it('reads each commit with its parents, in order', () => {
    expect(parseParents(`${MERGE} ${OLD_MAIN} ${OLD_CUT}\n${STRAY} ${OLD_MAIN}\n`)).toEqual([
      { sha: MERGE, parents: [OLD_MAIN, OLD_CUT] },
      { sha: STRAY, parents: [OLD_MAIN] },
    ]);
  });

  it('reads no commits from an empty answer', () => {
    expect(parseParents('')).toEqual([]);
  });

  it.each(['', 'xyz', `${MERGE.slice(1)} ${OLD_MAIN}`, `${MERGE.toUpperCase()} ${OLD_MAIN}`, `${MERGE}  ${OLD_MAIN}`, ` ${MERGE}`])(
    'refuses the line %j by name',
    (line) => {
      expect(() => parseParents(`${line}\n`)).toThrow(`unreadable rev-list line: ${line}`);
    },
  );
});

/** An error like the one execFileSync throws when git exits with `status`. */
function exited(status: number, stderr = ''): Error {
  return Object.assign(new Error(`Command failed: git (status ${status})`), { status, stderr });
}

/** Answers git by its arguments, as a real repository would. */
function answer(replies: Record<string, string | Error>): void {
  git.mockImplementation(((_file: string, args: string[]) => {
    const reply = replies[args.join(' ')];
    if (reply === undefined) throw new Error(`unexpected git ${args.join(' ')}`);
    if (reply instanceof Error) throw reply;
    return reply;
  }) as unknown as typeof execFileSync);
}

const ancestor = (sha: string) => `merge-base --is-ancestor ${sha} origin/develop`;
const FETCH = 'fetch --no-tags origin +refs/pull/7/merge:refs/remotes/pull/merge';
const LS_REMOTE = 'ls-remote origin refs/heads/develop refs/heads/release/2026-10-23';
const repoReplies = (overrides: Record<string, string | Error> = {}): Record<string, string | Error> => ({
  [FETCH]: '',
  [LS_REMOTE]: `${DEVELOP_TIP}\trefs/heads/develop\n${HEAD}\trefs/heads/release/2026-10-23\n`,
  [ancestor(HEAD)]: '',
  'rev-list --parents -n 1 refs/remotes/pull/merge': `${PR_MERGE} ${MERGE} ${HEAD}\n`,
  'rev-parse refs/remotes/pull/merge^{tree}': `${TREE}\n`,
  [`rev-parse ${HEAD}^{tree}`]: `${TREE}\n`,
  'rev-list --parents origin/develop..origin/main': `${MERGE} ${OLD_MAIN} ${OLD_CUT}\n`,
  [ancestor(OLD_CUT)]: '',
  ...overrides,
});

describe('gatherFacts', () => {
  // A braced body: a function returned from beforeEach is run as the test's teardown.
  beforeEach(() => {
    git.mockReset();
  });

  // The stand-in answers only what a case gives it, so a question the code should not ask fails.
  it('stands in a git that refuses a question no case answered', () => {
    answer(repoReplies());
    expect(() => execFileSync('git', ['status'])).toThrow('unexpected git status');
  });

  // The workflow runs the default branch's copy, so the pull request is fetched as data, never checked out.
  it('fetches the merge ref first, then asks git each question once, in order', () => {
    answer(repoReplies());
    expect(gatherFacts('release/2026-10-23', HEAD, 7)).toEqual(good);
    expect(git.mock.calls.map((c) => [c[0], (c[1] as string[]).join(' ')])).toEqual([
      ['git', FETCH],
      ['git', LS_REMOTE],
      ['git', ancestor(HEAD)],
      ['git', 'rev-list --parents -n 1 refs/remotes/pull/merge'],
      ['git', 'rev-parse refs/remotes/pull/merge^{tree}'],
      ['git', `rev-parse ${HEAD}^{tree}`],
      ['git', 'rev-list --parents origin/develop..origin/main'],
      ['git', ancestor(OLD_CUT)],
    ]);
  });

  it('names the merge ref it fetches into', () => {
    expect(MERGE_REF).toBe('refs/remotes/pull/merge');
  });

  // origin is asked live, beside develop, which it always holds: an answer without develop is unread, never an absence.
  it('reads the head branch as absent when origin names develop alone', () => {
    answer(repoReplies({ [LS_REMOTE]: `${DEVELOP_TIP}\trefs/heads/develop\n` }));
    expect(gatherFacts('release/2026-10-23', HEAD, 7).originHeadSha).toBeNull();
  });

  it('reads the commit origin holds the head branch at', () => {
    answer(repoReplies({ [LS_REMOTE]: `${DEVELOP_TIP}\trefs/heads/develop\n${STRAY}\trefs/heads/release/2026-10-23\n` }));
    expect(gatherFacts('release/2026-10-23', HEAD, 7).originHeadSha).toBe(STRAY);
  });

  // ls-remote matches a pattern by its tail, so it also names branches whose names only end in the head ref.
  it('takes no branch whose name only ends in the head ref for it', () => {
    const tail = `${DEVELOP_TIP}\trefs/heads/develop\n${HEAD}\trefs/heads/x/refs/heads/release/2026-10-23\n`;
    answer(repoReplies({ [LS_REMOTE]: tail }));
    expect(gatherFacts('release/2026-10-23', HEAD, 7).originHeadSha).toBeNull();
  });

  it.each(['', `${HEAD}\trefs/heads/release/2026-10-23\n`, `${DEVELOP_TIP}\trefs/heads/x/refs/heads/develop\n`])(
    'fails rather than read an answer from origin naming no develop: %j',
    (reply) => {
      answer(repoReplies({ [LS_REMOTE]: reply }));
      expect(() => gatherFacts('release/2026-10-23', HEAD, 7)).toThrow(
        `git ${LS_REMOTE} named no refs/heads/develop, so its answer cannot be read`,
      );
    },
  );

  it.each([
    `${DEVELOP_TIP} refs/heads/develop`,
    `${DEVELOP_TIP.slice(1)}\trefs/heads/develop`,
    `${OLD_CUT.toUpperCase()}\trefs/heads/develop`,
    `${DEVELOP_TIP}\t`,
    `${DEVELOP_TIP}\trefs/heads/develop\textra`,
    '',
  ])('refuses the ls-remote line %j by name', (line) => {
    answer(repoReplies({ [LS_REMOTE]: `${line}\n${DEVELOP_TIP}\trefs/heads/develop\n` }));
    expect(() => gatherFacts('release/2026-10-23', HEAD, 7)).toThrow(`unreadable ls-remote line: ${line}`);
  });

  it('fails, naming origin, when it holds the head branch twice', () => {
    const twice = `${DEVELOP_TIP}\trefs/heads/develop\n${HEAD}\trefs/heads/release/2026-10-23\n${STRAY}\trefs/heads/release/2026-10-23\n`;
    answer(repoReplies({ [LS_REMOTE]: twice }));
    expect(() => gatherFacts('release/2026-10-23', HEAD, 7)).toThrow(`git ${LS_REMOTE} named refs/heads/release/2026-10-23 twice`);
  });

  it('reads status 1 from --is-ancestor as not on develop', () => {
    answer(repoReplies({ [ancestor(HEAD)]: exited(1), [ancestor(OLD_CUT)]: exited(1) }));
    const facts = gatherFacts('release/2026-10-23', HEAD, 7);
    expect([facts.headOnDevelop, facts.mainCommits[0]?.secondParentOnDevelop]).toEqual([false, false]);
  });

  it('fails, naming the question, when --is-ancestor errors rather than answers', () => {
    const failure = exited(128, 'fatal: Not a valid commit name\n');
    answer(repoReplies({ [ancestor(HEAD)]: failure }));
    expect(() => gatherFacts('release/2026-10-23', HEAD, 7)).toThrow(
      expect.objectContaining({
        message: `git merge-base --is-ancestor ${HEAD} origin/develop failed: fatal: Not a valid commit name`,
        cause: failure,
      }),
    );
  });

  // GitHub builds no merge ref for a pull request that conflicts with main.
  it('fails when the merge ref cannot be fetched, asking nothing else', () => {
    answer(repoReplies({ [FETCH]: exited(128, "fatal: couldn't find remote ref refs/pull/7/merge") }));
    expect(() => gatherFacts('release/2026-10-23', HEAD, 7)).toThrow('Command failed: git (status 128)');
    expect(git).toHaveBeenCalledTimes(1);
  });

  it('asks about the second parent of two-parent commits only', () => {
    answer(repoReplies({ 'rev-list --parents origin/develop..origin/main': `${STRAY} ${OLD_MAIN}\n` }));
    expect(gatherFacts('release/2026-10-23', HEAD, 7).mainCommits).toEqual([
      { sha: STRAY, parents: [OLD_MAIN], secondParentOnDevelop: null },
    ]);
    expect(git).toHaveBeenCalledTimes(7);
  });

  it('reads no parents when git names no merge commit, so the merge check fails', () => {
    answer(repoReplies({ 'rev-list --parents -n 1 refs/remotes/pull/merge': '' }));
    expect(gatherFacts('release/2026-10-23', HEAD, 7).mergeParents).toEqual([]);
  });

  it('runs git with its output read as text and nothing on its input', () => {
    answer(repoReplies());
    gatherFacts('release/2026-10-23', HEAD, 7);
    expect(git.mock.calls.map((c) => c[2])).toEqual(Array(8).fill({ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  });
});

describe('statusFor', () => {
  it('passes a release cut', () => {
    expect(statusFor([])).toEqual({ state: 'success', description: "a tested release cut: the merge lands the head's tree" });
  });

  it('fails naming the one reason', () => {
    expect(statusFor(['the head branch is feature/x, not a release/ branch'])).toEqual({
      state: 'failure',
      description: 'the head branch is feature/x, not a release/ branch',
    });
  });

  it('fails naming the first reason and how many more the log holds', () => {
    expect(statusFor(['first', 'second', 'third'])).toEqual({ state: 'failure', description: 'first (and 2 more in the log)' });
  });

  // GitHub refuses a status description over 140 characters.
  it('keeps a reason of exactly 140 characters whole', () => {
    const reason = `main holds ${'x'.repeat(129)}`;
    expect([reason.length, statusFor([reason]).description]).toEqual([140, reason]);
  });

  it('cuts a long reason to 140 characters, ending in an ellipsis', () => {
    const { description } = statusFor([`main holds ${'x'.repeat(200)}`]);
    expect([description.length, description.endsWith('…'), description.startsWith('main holds xxx')]).toEqual([140, true, true]);
  });
});

describe('main', () => {
  const ENV = {
    GITHUB_TOKEN: 'token-1',
    GITHUB_REPOSITORY: 'shyden-labs/app',
    GITHUB_API_URL: 'https://api.github.com',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_RUN_ID: '42',
  };
  let out: string[];
  let posted: { url: string; method: string; headers: Record<string, string>; body: unknown }[];
  /** Stands in fetch: each POST is recorded and answered with `status`. */
  const answerPosts = (status = 201) => {
    vi.stubGlobal('fetch', (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
      posted.push({ url, method: init.method, headers: init.headers, body: JSON.parse(init.body) as unknown });
      return Promise.resolve({ ok: status < 300, status });
    });
  };
  const statusPost = (state: string, description: string) => ({
    url: `https://api.github.com/repos/shyden-labs/app/statuses/${HEAD}`,
    method: 'POST',
    headers: { Authorization: 'Bearer token-1', Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    body: { state, context: 'release-cut', description, target_url: 'https://github.com/shyden-labs/app/actions/runs/42' },
  });

  beforeEach(() => {
    git.mockReset();
    out = [];
    posted = [];
    for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
    vi.spyOn(process.stdout, 'write').mockImplementation((t) => (out.push(String(t)), true));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    [[]],
    [['release/x', HEAD, '7']],
    [['shyden-labs/app', 'release/x', HEAD, '7', 'extra']],
    [['shyden-labs/app', 'release/x', HEAD.slice(1), '7']],
    [['shyden-labs/app', 'release/x', `-${HEAD.slice(1)}`, '7']],
    [['shyden-labs/app', 'release/x', HEAD, '0']],
    [['shyden-labs/app', 'release/x', HEAD, '07']],
    [['shyden-labs/app', 'release/x', HEAD, '7x']],
  ])('refuses the arguments %j, asking git and GitHub nothing', async (args) => {
    answerPosts();
    await expect(main(args)).rejects.toThrow(
      'usage: node scripts/release-cut.ts <head repository> <head ref> <40-hex head sha> <pull request number>',
    );
    expect([git.mock.calls.length, posted.length]).toEqual([0, 0]);
  });

  // A status belongs to the head's SHA, which a fork's pull request can share with a release's: a fork's verdict, even a
  // failure, would overwrite the release's, so it posts none (issue shyden-labs/repo-template#103). Its own job still fails, naming why.
  it.each(['someone/app', 'shyden-labs/App', 'shyden-labs/app-fork', ''])(
    'refuses a pull request from %j by name, asking git and GitHub nothing',
    async (repository) => {
      answer(repoReplies());
      answerPosts();
      await expect(main([repository, 'release/2026-10-23', HEAD, '7'])).rejects.toThrow(
        `release-cut posts nothing for a pull request from ${JSON.stringify(repository)}: a release cut comes from this repository's own release/ branch, not a fork`,
      );
      expect([git.mock.calls.length, posted.length]).toEqual([0, 0]);
    },
  );

  it.each(Object.keys(ENV))('refuses to run without %s, asking git and GitHub nothing', async (name) => {
    answerPosts();
    vi.stubEnv(name, '');
    await expect(main(['shyden-labs/app', 'release/2026-10-23', HEAD, '7'])).rejects.toThrow(
      `release-cut needs ${name}, which GitHub Actions sets`,
    );
    expect([git.mock.calls.length, posted.length]).toEqual([0, 0]);
  });

  it('posts success on the head, says what it judged and exits 0 when the merge is a release cut', async () => {
    answer(repoReplies());
    answerPosts();
    await expect(main(['shyden-labs/app', 'release/2026-10-23', HEAD, '7'])).resolves.toBe(0);
    expect(posted).toEqual([statusPost('success', "a tested release cut: the merge lands the head's tree")]);
    expect(out).toEqual([
      `release-cut: release/2026-10-23 at ${HEAD}; judged 1 commit(s) in origin/develop..origin/main; the merge lands the head's tree.\n`,
    ]);
  });

  it('posts failure on the head and refuses the merge, naming each reason', async () => {
    const featureBranch = `${DEVELOP_TIP}\trefs/heads/develop\n${HEAD}\trefs/heads/feature/x\n`;
    answer(repoReplies({ 'ls-remote origin refs/heads/develop refs/heads/feature/x': featureBranch }));
    answerPosts();
    await expect(main(['shyden-labs/app', 'feature/x', HEAD, '7'])).rejects.toThrow(
      'release-cut refuses this merge:\n  the head branch is feature/x, not a release/ branch',
    );
    expect(posted).toEqual([statusPost('failure', 'the head branch is feature/x, not a release/ branch')]);
    expect(out).toEqual([]);
  });

  it('posts an error on the head when git cannot answer, then fails with git’s reason', async () => {
    answer(repoReplies({ [ancestor(HEAD)]: exited(128, 'fatal: bad object') }));
    answerPosts();
    await expect(main(['shyden-labs/app', 'release/2026-10-23', HEAD, '7'])).rejects.toThrow(
      `git merge-base --is-ancestor ${HEAD} origin/develop failed: fatal: bad object`,
    );
    expect(posted).toEqual([
      statusPost('error', `could not judge: git merge-base --is-ancestor ${HEAD} origin/develop failed: fatal: bad object`),
    ]);
  });

  it('fails, naming GitHub’s answer, when the status cannot be posted', async () => {
    answer(repoReplies());
    answerPosts(403);
    await expect(main(['shyden-labs/app', 'release/2026-10-23', HEAD, '7'])).rejects.toThrow(
      `POST https://api.github.com/repos/shyden-labs/app/statuses/${HEAD} answered 403; the pull request has no release-cut status`,
    );
  });
});

/** The workflow as comment-stripped text (trailing `# vX.Y.Z` comments too), every pinned SHA read as <sha>. */
const workflow = (file: string): string => withoutPinnedShas(withoutYamlComments(readFileSync(`.github/workflows/${file}`, 'utf8')));
const steps = () =>
  yamlBlock(yamlBlock(workflow('check-release-cut.yml'), 'jobs'), 'steps', '    ')
    .split(/\n(?= {6}- )/)
    .slice(1)
    .map((step) => step.replace(/^ {4}steps:\n/, ''));
/**
 * Every line the shell runs: a one-line `run:` value, and each line of a block
 * `run: |` or `run: >` body (the lines indented deeper than its key), so an
 * expression written into a block's body is judged too.
 */
const shellLines = (text: string): string[] => {
  const lines = text.split('\n');
  const indent = (line: string) => line.length - line.trimStart().length;
  return lines.flatMap((line, i) => {
    const run = /^(\s*)(?:- )?run: (.*)$/.exec(line);
    if (run === null) return [];
    const value = (run[2] as string).trim();
    if (!/^[|>][-+]?$/.test(value)) return [value];
    const body: string[] = [];
    for (let j = i + 1; j < lines.length && ((lines[j] as string).trim() === '' || indent(lines[j] as string) > indent(line)); j++) {
      if ((lines[j] as string).trim() !== '') body.push((lines[j] as string).trim());
    }
    return body;
  });
};
const usesLines = (text: string): string[] =>
  text
    .split('\n')
    .filter((line) => /^\s*-?\s*uses:/.test(line))
    .map((line) => line.trim().replace(/^-\s*/, ''));

describe('check-release-cut.yml', () => {
  // pull_request_target takes the workflow and checkout from the default branch, never the pull request (GitHub, since 2025-12-08).
  it('runs the default branch’s own copy on pull requests into main only', () => {
    expect(yamlBlock(workflow('check-release-cut.yml'), 'on')).toBe('on:\n  pull_request_target:\n    branches: [main]');
  });

  it('can read the repository and write commit statuses, nothing more', () => {
    expect(yamlBlock(workflow('check-release-cut.yml'), 'permissions')).toBe('permissions:\n  contents: read\n  statuses: write');
  });

  // main requires the release-cut status the job posts; the job's own check run carries another name, so it is never taken for it.
  it('runs one job, named apart from the status main requires', () => {
    const jobs = yamlBlock(workflow('check-release-cut.yml'), 'jobs');
    expect([
      RELEASE_CUT,
      jobs.split('\n').filter((line) => /^ {2}\S/.test(line)),
      jobs.split('\n').filter((line) => /^ {4}name:/.test(line)),
    ]).toEqual(['release-cut', ['  judge-release-cut:'], []]);
  });

  it('stops a job that hangs after five minutes', () => {
    expect(
      yamlBlock(workflow('check-release-cut.yml'), 'judge-release-cut', '  ')
        .split('\n')
        .filter((line) => /^ {4}timeout-minutes:/.test(line)),
    ).toEqual(['    timeout-minutes: 5']);
  });

  it('checks out the default branch’s own copy, never the pull request, with every branch’s history and no credential kept', () => {
    expect(steps()[0]).toBe(
      ['      - uses: actions/checkout@<sha>', '        with:', '          fetch-depth: 0', '          persist-credentials: false'].join(
        '\n',
      ),
    );
  });

  it('reads the exact Node from the one file Dependabot bumps (#143), then sets it up and installs nothing, since the check imports only node and its own scripts', () => {
    expect([steps()[1], steps()[2]]).toEqual([
      [
        '      - id: node',
        '        run: |',
        "          version=$(sed -nE 's/^FROM node:([0-9]+\\.[0-9]+\\.[0-9]+)$/\\1/p' .github/node/Dockerfile)",
        '          test -n "$version"',
        '          echo "version=$version" >> "$GITHUB_OUTPUT"',
      ].join('\n'),
      ['      - uses: actions/setup-node@<sha>', '        with:', '          node-version: ${{ steps.node.outputs.version }}'].join('\n'),
    ]);
  });

  // The head ref is text the pull request's author chose: it reaches the shell through env, never through an expression.
  it('hands the head repository, head ref, head SHA, pull request number and token to the check through env', () => {
    expect(steps()[3]).toBe(
      [
        '      - name: Judge the release cut and post its status',
        '        env:',
        '          HEAD_REPOSITORY: ${{ github.event.pull_request.head.repo.full_name }}',
        '          HEAD_REF: ${{ github.head_ref }}',
        '          HEAD_SHA: ${{ github.event.pull_request.head.sha }}',
        '          PR_NUMBER: ${{ github.event.pull_request.number }}',
        '          GITHUB_TOKEN: ${{ github.token }}',
        '        run: node scripts/release-cut.ts "$HEAD_REPOSITORY" "$HEAD_REF" "$HEAD_SHA" "$PR_NUMBER"',
      ].join('\n'),
    );
  });

  it("puts no expression inside any shell line, a block's body included", () => {
    const lines = shellLines(workflow('check-release-cut.yml'));
    expect({ lines: lines.length, withExpressions: lines.filter((line) => line.includes('${{')) }).toEqual({
      lines: 4,
      withExpressions: [],
    });
  });

  it('reads the body of a block run as shell lines, past a blank line inside it, so an expression there is seen', () => {
    expect(
      shellLines(
        [
          '      - run: |',
          '          echo "${{ github.head_ref }}"',
          '',
          '          true',
          '      - run: echo done',
          '      - uses: x',
        ].join('\n'),
      ),
    ).toEqual(['echo "${{ github.head_ref }}"', 'true', 'echo done']);
  });

  it('runs four steps: checkout, the Node read, node, then the check', () => {
    expect(steps().map((step) => step.split('\n')[0])).toEqual([
      '      - uses: actions/checkout@<sha>',
      '      - id: node',
      '      - uses: actions/setup-node@<sha>',
      '      - name: Judge the release cut and post its status',
    ]);
  });

  it('pins the same actions at the same SHAs as ci.yml', () => {
    const pins = (file: string) => usesLines(readFileSync(`.github/workflows/${file}`, 'utf8'));
    // ci.yml runs several jobs, each pinning the same actions: compare the distinct pins.
    expect(pins('check-release-cut.yml')).toEqual([...new Set(pins('ci.yml'))]);
  });
});
