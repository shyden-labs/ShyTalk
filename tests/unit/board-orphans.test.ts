import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { emptyBoardNote } from '../../scripts/board-progress.ts';
import { inProgressIssues, findOrphanIssues, main, QUERY, type OpenPullRequest } from '../../scripts/board-orphans.ts';

// `gh` is stood in: a unit test starts no process. Each test queues gh's replies in call order.
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
const gh = vi.mocked(execFileSync);
const reply = (...values: unknown[]) => {
  for (const value of values) gh.mockReturnValueOnce(JSON.stringify(value));
};

/**
 * A ticket is In Progress only while a branch or an open pull request is working
 * it (operator 2026-10-13: "if a ticket is not in progress then it should not be
 * marked as in progress"; issue shyden-labs/repo-template#10). Branches here are named `<issue>-<slug>`.
 * An open pull request always counts; a branch counts only while it has no closed
 * pull request (operator 2026-10-13: "Branch counts until its PR closes").
 */

function page(items: { number: number; state: 'OPEN' | 'CLOSED'; status: string | null }[], totalCount = items.length) {
  return {
    data: {
      node: {
        title: 'Board',
        items: {
          totalCount,
          nodes: items.map((i) => ({
            status: i.status === null ? null : { name: i.status },
            content: { __typename: 'Issue', number: i.number, state: i.state },
          })),
        },
      },
    },
  };
}

const pr = (over: Partial<OpenPullRequest>): OpenPullRequest => ({
  title: 'x',
  body: '',
  headRefName: 'feature',
  closes: [],
  ...over,
});

describe('inProgressIssues', () => {
  it('keeps open issues whose Status is In Progress, across pages', () => {
    expect(
      inProgressIssues([
        page([
          { number: 1, state: 'OPEN', status: 'In Progress' },
          { number: 2, state: 'OPEN', status: 'Todo' },
        ]),
        page([{ number: 3, state: 'OPEN', status: 'In Progress' }]),
      ]),
    ).toEqual([1, 3]);
  });

  it('ignores a closed issue still marked In Progress', () => {
    expect(inProgressIssues([page([{ number: 4, state: 'CLOSED', status: 'In Progress' }])])).toEqual([]);
  });

  it('ignores an issue with no Status', () => {
    expect(inProgressIssues([page([{ number: 5, state: 'OPEN', status: null }])])).toEqual([]);
  });
});

describe('findOrphanIssues', () => {
  it('names an In Progress issue nothing is working', () => {
    expect(findOrphanIssues([7], [pr({})], ['main', 'develop'], [])).toEqual([7]);
  });

  it('a pull request naming #7 in its title claims it', () => {
    expect(findOrphanIssues([7], [pr({ title: 'Fix the board (#7)' })], [], [])).toEqual([]);
  });

  it('a pull request naming #7 in its body claims it', () => {
    expect(findOrphanIssues([7], [pr({ body: 'Refs #7.' })], [], [])).toEqual([]);
  });

  it('a pull request that closes #7 claims it', () => {
    expect(findOrphanIssues([7], [pr({ closes: [7] })], [], [])).toEqual([]);
  });

  it('a pull request whose head branch starts 7- claims it', () => {
    expect(findOrphanIssues([7], [pr({ headRefName: '7-board' })], [], [])).toEqual([]);
  });

  it('a remote branch starting 7- claims it', () => {
    expect(findOrphanIssues([7], [], ['7-board'], [])).toEqual([]);
  });

  it('#17 and #70 do not claim issue 7', () => {
    expect(findOrphanIssues([7], [pr({ title: 'Fix #17', body: 'see #70' })], [], [])).toEqual([7]);
  });

  it('a remote branch whose pull request was closed unmerged does not claim it', () => {
    expect(findOrphanIssues([7], [], ['7-board'], ['7-board'])).toEqual([7]);
  });

  it('an open pull request still claims it when an older branch of the issue had its pull request closed', () => {
    expect(findOrphanIssues([7], [pr({ headRefName: '7-board-take-2' })], ['7-board'], ['7-board'])).toEqual([]);
  });

  it('branches 17-x and 70-x do not claim issue 7', () => {
    expect(findOrphanIssues([7], [pr({ headRefName: '17-x' })], ['70-x'], [])).toEqual([7]);
  });
});

describe('main', () => {
  let out: string[];
  let err: string[];
  beforeEach(() => {
    gh.mockReset();
    out = [];
    err = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((t) => (out.push(String(t)), true));
    vi.spyOn(process.stderr, 'write').mockImplementation((t) => (err.push(String(t)), true));
  });
  afterEach(() => vi.restoreAllMocks());

  const ARGS = ['PVT_1', 'Board', 'shyden-labs/repo'];
  const board = page([{ number: 7, state: 'OPEN', status: 'In Progress' }]);
  const openPr = (over: object) => ({ title: 'x', body: '', headRefName: 'feature', closingIssuesReferences: [], ...over });

  it.each([[[]], [['PVT_1', 'Board']], [['PVT_1', 'Board', 'not-a-repo']]])('refuses the arguments %j', (args) => {
    expect(() => main(args)).toThrow('usage: node scripts/board-orphans.ts <board-node-id> "<board title>" <owner/repo>');
  });

  it('refuses a board whose title differs', () => {
    reply([board]);
    expect(() => main(['PVT_1', 'Other', 'shyden-labs/repo'])).toThrow('the board is "Board", not "Other": nothing read');
  });

  // Issue shyden-labs/repo-template#72: a short page could hide the one In Progress ticket nothing is working.
  it('refuses a short read, reading nothing else', () => {
    reply([page([{ number: 7, state: 'OPEN', status: 'Todo' }], 466)]);
    expect(() => main(ARGS)).toThrow('the board "Board" holds 466 items and 1 were read: a short read, nothing judged');
    expect(gh).toHaveBeenCalledTimes(1);
  });

  // Issue shyden-labs/repo-template#75: a new repository's empty board must not fail its pull requests.
  it('passes a board of 0 items, naming it, reading nothing else', () => {
    reply([page([])]);
    expect(main(ARGS)).toBe(0);
    expect(out).toEqual([`board-orphans: ${emptyBoardNote('Board')}; nothing is In Progress\n`]);
    expect(gh).toHaveBeenCalledTimes(1);
  });

  it("asks for each page's board size", () => {
    expect(QUERY).toContain('items(first: 100, after: $endCursor) { totalCount pageInfo { hasNextPage endCursor }');
  });

  it('passes when nothing is In Progress, reading nothing else', () => {
    reply([page([{ number: 7, state: 'OPEN', status: 'Todo' }])]);
    expect(main(ARGS)).toBe(0);
    expect(out).toEqual(['board-orphans: 0 open issue(s) In Progress on "Board"\n']);
    expect(gh).toHaveBeenCalledTimes(1);
  });

  it('reads the board by its node id, the open pull requests and the branches', () => {
    reply([board], [], [[{ name: 'main' }]]);
    main(ARGS);
    expect(gh.mock.calls.map((c) => [c[0], (c[1] as string[]).filter((a) => !a.startsWith('query='))])).toEqual([
      ['gh', ['api', 'graphql', '--paginate', '--slurp', '-f', '-f', 'id=PVT_1']],
      [
        'gh',
        [
          'pr',
          'list',
          '-R',
          'shyden-labs/repo',
          '--state',
          'open',
          '--limit',
          '500',
          '--json',
          'title,body,headRefName,closingIssuesReferences',
        ],
      ],
      ['gh', ['api', '--paginate', '--slurp', 'repos/shyden-labs/repo/branches?per_page=100']],
    ]);
  });

  it('fails when the pull request list may be cut short', () => {
    reply(
      [board],
      Array.from({ length: 500 }, () => openPr({})),
    );
    expect(() => main(ARGS)).toThrow('gh pr list hit its limit of 500; the list may be cut short');
  });

  it('fails closed when the repository lists no branches', () => {
    reply([board], [], [[]]);
    expect(() => main(ARGS)).toThrow('the repository listed no branches; refusing to judge orphans blind');
  });

  it('names an orphan and fails', () => {
    reply([board], [], [[{ name: 'main' }]]);
    expect(main(ARGS)).toBe(1);
    expect(err).toEqual([
      'board-orphans: #7 is In Progress, but no open pull request and no branch is working it. ' +
        'Set its Status back to the backlog, or push its branch (named <issue>-<slug>).\n',
    ]);
  });

  it('passes when an open pull request closes it', () => {
    reply([board], [openPr({ closingIssuesReferences: [{ number: 7 }] })], [[{ name: 'main' }]]);
    expect(main(ARGS)).toBe(0);
    expect(out).toContain(
      'board-orphans: 1 open pull request(s), 1 branch(es) searched; 0 of 0 candidate branch(es) have a closed pull request\n',
    );
    expect(err).toEqual([]);
  });

  it('passes while a branch named for it has no closed pull request', () => {
    reply([board], [], [[{ name: '7-work' }]], []);
    expect(main(ARGS)).toBe(0);
    expect(gh.mock.calls[3]?.[1]).toEqual([
      'pr',
      'list',
      '-R',
      'shyden-labs/repo',
      '--state',
      'closed',
      '--head',
      '7-work',
      '--limit',
      '1',
      '--json',
      'number',
    ]);
  });

  it('fails once that branch has a closed pull request', () => {
    reply([board], [], [[{ name: '7-work' }]], [{ number: 3 }]);
    expect(main(ARGS)).toBe(1);
    expect(out).toContain(
      'board-orphans: 0 open pull request(s), 1 branch(es) searched; 1 of 1 candidate branch(es) have a closed pull request\n',
    );
  });
});
