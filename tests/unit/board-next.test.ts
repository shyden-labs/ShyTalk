import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { emptyBoardNote } from '../../scripts/board-progress.ts';
import {
  main,
  nextTicket,
  offBoardBlockers,
  parseNextItems,
  PARKED,
  QUERY,
  type NextItem,
  type RawPage,
} from '../../scripts/board-next.ts';

// `gh` is stood in: a unit test starts no process.
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
const gh = vi.mocked(execFileSync);

/**
 * The board, not a handover file, names the next ticket (operator
 * 2026-10-12): the highest Priority among open issues; within a level, In
 * Progress first, then unblocked, then the oldest. A blocker inherits the
 * level of what waits on it, and an epic waits for its stories (operator
 * 2026-10-13, repo-template#6).
 */
const REPO = 'shyden-labs/app';
const ref = (number: number, repo = REPO) => ({ repo, number });
const item = (over: Partial<NextItem> & { number: number }): NextItem => ({
  repo: REPO,
  title: `ticket ${over.number}`,
  state: 'OPEN',
  createdAt: '2026-10-01T00:00:00Z',
  status: 'Todo',
  priority: 'P3',
  blockedBy: [],
  openSubIssues: 0,
  ...over,
});

describe('nextTicket', () => {
  it('takes the highest priority, however new it is', () => {
    const next = nextTicket([
      item({ number: 1, priority: 'P2', createdAt: '2026-01-01T00:00:00Z' }),
      item({ number: 2, priority: 'P0', createdAt: '2026-10-12T00:00:00Z' }),
    ]);
    expect(next?.number).toBe(2);
  });

  it('finishes what is In Progress before starting anything else at its level', () => {
    const next = nextTicket([
      item({ number: 1, createdAt: '2026-01-01T00:00:00Z' }),
      item({
        number: 2,
        status: 'In Progress',
        createdAt: '2026-10-12T00:00:00Z',
      }),
    ]);
    expect(next?.number).toBe(2);
  });

  it('skips a ticket whose blocker is still open for one that can start', () => {
    const next = nextTicket([
      item({
        number: 1,
        blockedBy: [ref(9)],
        createdAt: '2026-01-01T00:00:00Z',
      }),
      item({ number: 2, createdAt: '2026-10-12T00:00:00Z' }),
      item({ number: 9, createdAt: '2026-10-13T00:00:00Z' }),
    ]);
    expect(next?.number).toBe(2);
  });

  it('takes the oldest among equals', () => {
    const next = nextTicket([
      item({ number: 7, createdAt: '2026-10-05T00:00:00Z' }),
      item({ number: 3, createdAt: '2026-10-02T00:00:00Z' }),
      item({ number: 5, createdAt: '2026-10-09T00:00:00Z' }),
    ]);
    expect(next?.number).toBe(3);
  });

  it("keeps board order between two repositories' issues of one number, made at one moment", () => {
    const next = nextTicket([item({ number: 4, repo: 'shyden-labs/other' }), item({ number: 4 })]);
    expect(next?.repo).toBe('shyden-labs/other');
  });

  it('never names a closed ticket', () => {
    const next = nextTicket([item({ number: 1, state: 'CLOSED', priority: 'P0' }), item({ number: 2, priority: 'P4' })]);
    expect(next?.number).toBe(2);
  });

  it('answers nothing for a board with nothing open', () => {
    expect(nextTicket([item({ number: 1, state: 'CLOSED' })])).toBeNull();
  });

  it('refuses while an open ticket has no priority, naming every one', () => {
    expect(() =>
      nextTicket([item({ number: 4, priority: null }), item({ number: 2, priority: 'P1' }), item({ number: 8, priority: null })]),
    ).toThrow('2 open tickets have no Priority: #4, #8. Score them on the board first.');
  });

  it('refuses a priority that is not one of the six levels', () => {
    expect(() => nextTicket([item({ number: 4, priority: 'High' })])).toThrow(
      '#4 has Priority "High", which is not one of P0, P1, P2, P3, P4, P5',
    );
  });

  it('refuses while a blocker sits below what it blocks, naming every pair', () => {
    expect(() =>
      nextTicket([
        item({ number: 1, priority: 'P1', blockedBy: [ref(5)] }),
        item({ number: 2, priority: 'P2', blockedBy: [ref(5), ref(6)] }),
        item({ number: 5, priority: 'P3' }),
        item({ number: 6, priority: 'P2' }),
      ]),
    ).toThrow('Raise each blocker to at least the Priority of what waits on it: #5 (P3) blocks #1 (P1); #5 (P3) blocks #2 (P2).');
  });

  it('accepts a blocker at or above the level of what it blocks', () => {
    const next = nextTicket([
      item({ number: 1, priority: 'P1', blockedBy: [ref(5)] }),
      item({ number: 2, priority: 'P3', blockedBy: [ref(6)] }),
      item({ number: 5, priority: 'P1', createdAt: '2026-10-12T00:00:00Z' }),
      item({ number: 6, priority: 'P0' }),
    ]);
    expect(next?.number).toBe(6);
  });

  it('picks past an open blocker the board does not hold, rather than stopping', () => {
    const next = nextTicket([item({ number: 1, priority: 'P1', blockedBy: [ref(9)] }), item({ number: 2, priority: 'P2' })]);
    expect(next?.number).toBe(1);
  });

  it("reads a blocker in another repository as that repository's issue, not this one's namesake", () => {
    const next = nextTicket([
      item({
        number: 1,
        priority: 'P1',
        blockedBy: [ref(3, 'shyden-labs/other')],
      }),
      item({ number: 3, priority: 'P4' }),
    ]);
    expect(next?.number).toBe(1);
  });

  it('names each open blocker the board does not hold, for a note beside the answer', () => {
    expect(
      offBoardBlockers([
        item({ number: 1, priority: 'P1', blockedBy: [ref(9)] }),
        item({
          number: 2,
          priority: 'P2',
          blockedBy: [ref(3, 'shyden-labs/other'), ref(4)],
        }),
        item({ number: 4 }),
      ]),
    ).toEqual([
      '#9 blocks #1 (P1) but is not on this board, so its Priority is not checked',
      'shyden-labs/other#3 blocks #2 (P2) but is not on this board, so its Priority is not checked',
    ]);
  });

  it("names an unscored ticket's off-board blocker without printing null", () => {
    expect(offBoardBlockers([item({ number: 1, priority: null, blockedBy: [ref(9)] })])).toEqual([
      '#9 blocks #1 (no Priority) but is not on this board, so its Priority is not checked',
    ]);
  });

  it('passes over an epic while it has open sub-issues', () => {
    const next = nextTicket([item({ number: 1, priority: 'P0', openSubIssues: 2 }), item({ number: 2, priority: 'P2' })]);
    expect(next?.number).toBe(2);
  });

  it('names an epic once its sub-issues are closed', () => {
    const next = nextTicket([item({ number: 1, priority: 'P0', openSubIssues: 0 }), item({ number: 2, priority: 'P2' })]);
    expect(next?.number).toBe(1);
  });

  it('refuses when only epics with open sub-issues remain, naming them, rather than calling the board empty', () => {
    expect(() => nextTicket([item({ number: 1, openSubIssues: 2 }), item({ number: 4, openSubIssues: 1 })])).toThrow(
      'Every open issue is an epic with open sub-issues: #1, #4. Put their stories on this board.',
    );
  });

  it('passes over a ticket parked After release, however high its priority', () => {
    const next = nextTicket([item({ number: 1, priority: 'P0', status: PARKED }), item({ number: 2, priority: 'P4' })]);
    expect(next?.number).toBe(2);
  });

  it('answers nothing while every open ticket is parked After release', () => {
    expect(nextTicket([item({ number: 1, priority: 'P1', status: PARKED })])).toBeNull();
  });

  it('still refuses a parked ticket nobody scored', () => {
    expect(() => nextTicket([item({ number: 3, priority: null, status: PARKED }), item({ number: 4 })])).toThrow(
      '1 open tickets have no Priority: #3. Score them on the board first.',
    );
  });

  it('names the parked column as the board shows it', () => {
    expect(PARKED).toBe('After release');
  });
});

/**
 * One board page as `gh api graphql` returns it. The card's content is raw JSON
 * the parser must check for itself, so it is built untyped and cast here once.
 */
const page = (content: unknown): RawPage[] =>
  [
    {
      data: {
        node: {
          title: 'Board',
          items: {
            nodes: [{ status: { name: 'Todo' }, priority: { name: 'P2' }, content }],
          },
        },
      },
    },
  ] as RawPage[];
const issue = (over: Record<string, unknown> = {}) => ({
  __typename: 'Issue',
  number: 4,
  title: 'ticket 4',
  state: 'OPEN',
  createdAt: '2026-10-01T00:00:00Z',
  repository: { nameWithOwner: REPO },
  blockedBy: {
    totalCount: 2,
    nodes: [
      {
        number: 3,
        state: 'OPEN',
        repository: { nameWithOwner: 'shyden-labs/other' },
      },
      { number: 2, state: 'CLOSED', repository: { nameWithOwner: REPO } },
    ],
  },
  subIssues: {
    totalCount: 3,
    nodes: [{ state: 'OPEN' }, { state: 'CLOSED' }, { state: 'OPEN' }],
  },
  ...over,
});

describe('parseNextItems', () => {
  it('keeps each open blocker with its repository, and counts the open sub-issues', () => {
    expect(parseNextItems(page(issue()))).toEqual([
      {
        repo: REPO,
        number: 4,
        title: 'ticket 4',
        state: 'OPEN',
        createdAt: '2026-10-01T00:00:00Z',
        status: 'Todo',
        priority: 'P2',
        blockedBy: [ref(3, 'shyden-labs/other')],
        openSubIssues: 2,
      },
    ]);
  });

  it('refuses a blocker list longer than one page, rather than judging part of it', () => {
    expect(() => parseNextItems(page(issue({ blockedBy: { totalCount: 51, nodes: [] } })))).toThrow(
      '#4 has 51 blockers and one page read 0',
    );
  });

  it('refuses a sub-issue list longer than one page, rather than judging part of it', () => {
    expect(() => parseNextItems(page(issue({ subIssues: { totalCount: 101, nodes: [] } })))).toThrow(
      '#4 has 101 sub-issues and one page read 0',
    );
  });

  it.each([
    ['a pull request', { __typename: 'PullRequest' }, 'ticket 4'],
    ['no number', { number: undefined }, 'ticket 4'],
    ['no title', { title: undefined }, '(no content)'],
    ['no state', { state: undefined }, 'ticket 4'],
    ['no creation time', { createdAt: undefined }, 'ticket 4'],
    ['no repository', { repository: undefined }, 'ticket 4'],
    ['no blockers', { blockedBy: undefined }, 'ticket 4'],
    ['no sub-issues', { subIssues: undefined }, 'ticket 4'],
  ])('refuses a card with %s, naming it', (_name, over, named) => {
    expect(() => parseNextItems(page(issue(over)))).toThrow(`"${named}" is not an issue with a number`);
  });

  it('refuses a card whose content it cannot read', () => {
    expect(() => parseNextItems(page(null))).toThrow(
      '"(no content)" is not an issue with a number, title, state, creation time, repository, blockers and sub-issues: convert it, or remove it from the board',
    );
  });

  it('reads a card with no Status and no Priority as null for both', () => {
    const items = parseNextItems([{ data: { node: { title: 'Board', items: { nodes: [{ content: issue() }] } } } }] as never);
    expect([items[0]?.status, items[0]?.priority]).toEqual([null, null]);
  });
});

describe('main', () => {
  const ARGS = ['PVT_1', 'Board'];
  const boardOf = (...nodes: unknown[]) => [{ data: { node: { title: 'Board', items: { totalCount: nodes.length, nodes } } } }];
  const node = (status: string | null, over: Record<string, unknown> = {}) => ({
    status: status === null ? null : { name: status },
    priority: { name: 'P2' },
    content: issue({ blockedBy: { totalCount: 0, nodes: [] }, subIssues: { totalCount: 0, nodes: [] }, ...over }),
  });
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
  const serve = (pages: unknown) => gh.mockReturnValueOnce(JSON.stringify(pages));

  it.each([[[]], [['PVT_1']]])('refuses the arguments %j', (args) => {
    expect(() => main(args)).toThrow('usage: node scripts/board-next.ts <board-node-id> "<board title>"');
  });

  it('reads the board by its node id', () => {
    serve(boardOf(node('Todo')));
    main(ARGS);
    expect(gh).toHaveBeenCalledWith('gh', ['api', 'graphql', '--paginate', '--slurp', '-f', `query=${QUERY}`, '-f', 'id=PVT_1'], {
      encoding: 'utf8',
    });
  });

  it('refuses an answer with no pages', () => {
    serve([]);
    expect(() => main(ARGS)).toThrow('the board "Board" read no pages: nothing judged');
  });

  // Issue shyden-labs/repo-template#72: GitHub served 0 of a 466-item board, and this printed "nothing is open".
  it('refuses a short read rather than saying nothing is open', () => {
    serve([{ data: { node: { title: 'Board', items: { totalCount: 466, nodes: [] } } } }]);
    expect(() => main(ARGS)).toThrow('the board "Board" holds 466 items and 0 were read: a short read, nothing judged');
    expect(out).toEqual([]);
  });

  // Issue shyden-labs/repo-template#75: an empty board is expected (new, or every item archived); it is named, never "nothing is open".
  it('names a board of 0 items rather than saying nothing is open, and exits 0', () => {
    serve(boardOf());
    expect(main(ARGS)).toBe(0);
    expect(out).toEqual([`Next: nothing to pick; ${emptyBoardNote('Board')}.\n`]);
  });

  it("asks for each page's board size", () => {
    expect(QUERY).toContain('items(first: 100, after: $endCursor) { totalCount pageInfo { hasNextPage endCursor }');
  });

  it('names the next ticket with its priority and status, and exits 0', () => {
    serve(boardOf(node('Todo')));
    expect(main(ARGS)).toBe(0);
    expect(out).toEqual(['Next: #4 ticket 4 (P2, Todo).\n']);
    expect(err).toEqual([]);
  });

  it('says a ticket with no status has none', () => {
    serve(boardOf(node(null)));
    main(ARGS);
    expect(out).toEqual(['Next: #4 ticket 4 (P2, no status).\n']);
  });

  it('names the blocker it picks past, with a note that it is off the board', () => {
    serve(
      boardOf(
        node('Todo', {
          blockedBy: {
            totalCount: 1,
            nodes: [{ number: 3, state: 'OPEN', repository: { nameWithOwner: 'shyden-labs/other' } }],
          },
        }),
      ),
    );
    main(ARGS);
    expect(out).toEqual(['Next: #4 ticket 4 (P2, Todo, blocked by shyden-labs/other#3).\n']);
    expect(err).toEqual(['Note: shyden-labs/other#3 blocks #4 (P2) but is not on this board, so its Priority is not checked.\n']);
  });

  it('says nothing is open on a board of closed tickets', () => {
    serve(boardOf(node('Done', { state: 'CLOSED' })));
    main(ARGS);
    expect(out).toEqual(['Next: nothing is open.\n']);
  });

  it(`says the rest is in "${PARKED}" when only parked tickets are open`, () => {
    serve(boardOf(node(PARKED)));
    main(ARGS);
    expect(out).toEqual([`Next: nothing before the release; the rest is in "${PARKED}".\n`]);
  });
});
