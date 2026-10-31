import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { withoutTsComments } from './source-text.ts';
import {
  assertTitle,
  assertWholeRead,
  emptyBoardNote,
  formatLeftOut,
  formatLines,
  inScope,
  main,
  parseItems,
  progress,
  QUERY,
  type BoardItem,
} from '../../scripts/board-progress.ts';

// `gh` is stood in: a unit test starts no process.
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
const gh = vi.mocked(execFileSync);

/**
 * Progress from the board, never from feel: every session close-out states
 * the project's progress and an ETA twice: by tickets, as a % complete, and by
 * story points (the `Estimate` field), as the points remaining. These tests pin
 * how both are counted.
 */

const TODAY = '2026-10-04';

function item(over: Partial<BoardItem> & { number: number | null }): BoardItem {
  return {
    title: `Story ${String(over.number)}`,
    state: 'OPEN',
    createdAt: '2026-09-01T00:00:00Z',
    closedAt: null,
    estimate: 3,
    labels: [],
    ...over,
  };
}

const closedOn = (number: number, day: string, estimate: number | null = 3) =>
  item({
    number,
    state: 'CLOSED',
    closedAt: `${day}T12:00:00Z`,
    estimate,
  });

describe('inScope', () => {
  it('leaves out an epic, which is the sum of its stories', () => {
    expect(inScope(item({ number: 1, title: 'Epic M1: Core' }))).toBe(false);
  });

  it('leaves out a post-launch story', () => {
    expect(inScope(item({ number: 2, labels: ['post-launch'] }))).toBe(false);
  });

  it('keeps an ordinary story', () => {
    expect(inScope(item({ number: 3 }))).toBe(true);
  });
});

describe('progress by tickets', () => {
  it('counts closed of all in-scope stories', () => {
    const p = progress([closedOn(1, '2026-10-03'), item({ number: 2 }), item({ number: 3 }), item({ number: 4, title: 'Epic M2' })], TODAY);
    expect(p.tickets).toMatchObject({ closed: 1, total: 3 });
  });

  it('counts closures per UTC day over the 7 days ending today, oldest first', () => {
    const p = progress([closedOn(1, '2026-09-28'), closedOn(2, '2026-10-03'), closedOn(3, '2026-10-03'), closedOn(4, '2026-10-04')], TODAY);
    expect(p.tickets.pace).toEqual([1, 0, 0, 0, 0, 2, 1]);
  });

  it('starts the window at the board’s oldest story when that is younger than 7 days', () => {
    const p = progress(
      [
        { ...closedOn(1, '2026-10-03'), createdAt: '2026-10-02T08:00:00Z' },
        item({ number: 2, createdAt: '2026-10-02T09:00:00Z' }),
        item({ number: 3, createdAt: '2026-10-03T09:00:00Z' }),
      ],
      TODAY,
    );
    expect(p.tickets.pace).toEqual([0, 1, 0]);
  });

  it('leaves a closure 7 days before today out of the window', () => {
    const p = progress([closedOn(1, '2026-09-27')], TODAY);
    expect(p.tickets.pace).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('a draft card', () => {
  const draft = (estimate: number | null = 3) => item({ number: null, title: 'Idea', estimate });

  it('counts as an open in-scope story', () => {
    expect(progress([closedOn(1, '2026-10-03'), draft()], TODAY).tickets).toMatchObject({
      closed: 1,
      total: 2,
      drafts: 1,
    });
  });

  it('holds effort unavailable while it has no estimate', () => {
    expect(progress([closedOn(1, '2026-10-03'), draft(null)], TODAY).effort).toEqual({
      available: false,
      scored: 0,
      open: 1,
    });
  });

  it('is named in the tickets line', () => {
    expect(formatLines(progress([closedOn(1, '2026-10-03'), draft()], TODAY), TODAY)[0]).toContain(
      '(1 of 2 in-scope stories closed, counting 1 open draft; ',
    );
  });
});

describe('progress by effort', () => {
  it('is unavailable while an open in-scope story has no estimate', () => {
    const p = progress([item({ number: 1 }), item({ number: 2, estimate: null })], TODAY);
    expect(p.effort).toEqual({ available: false, scored: 1, open: 2 });
  });

  it('counts closed points of all points', () => {
    const p = progress([closedOn(1, '2026-10-03', 5), item({ number: 2, estimate: 8 })], TODAY);
    expect(p.effort).toMatchObject({
      available: true,
      closedPoints: 5,
      openPoints: 8,
      open: 1,
      assumedClosed: 0,
    });
  });

  it('counts an unscored closed story at the scored closed mean, as assumed', () => {
    const p = progress(
      [closedOn(1, '2026-10-03', 2), closedOn(2, '2026-10-03', 4), closedOn(3, '2026-09-01', null), item({ number: 4, estimate: 5 })],
      TODAY,
    );
    expect(p.effort).toMatchObject({ closedPoints: 9, assumedClosed: 1 });
  });

  it('ignores an epic’s own estimate', () => {
    const p = progress([item({ number: 1, estimate: 5 }), item({ number: 2, title: 'Epic X', estimate: 40 })], TODAY);
    expect(p.effort).toMatchObject({ openPoints: 5 });
  });

  it('counts points closed per day over the same window', () => {
    const p = progress([closedOn(1, '2026-10-03', 5), closedOn(2, '2026-10-04', 8)], TODAY);
    expect(p.effort).toMatchObject({ pace: [0, 0, 0, 0, 0, 5, 8] });
  });
});

describe('formatLines', () => {
  const sample = (): BoardItem[] => [
    closedOn(1, '2026-10-03', 5),
    closedOn(2, '2026-10-04', 2),
    item({ number: 3, estimate: 8 }),
    item({ number: 4, estimate: 13 }),
    item({ number: 5, title: 'Epic M1' }),
    item({ number: 6, labels: ['post-launch'] }),
  ];

  it('states tickets complete, the measured pace and the ETA at that pace', () => {
    expect(formatLines(progress(sample(), TODAY), TODAY)[0]).toBe(
      'By tickets: 50% complete (2 of 4 in-scope stories closed; 1 epic and 1 post-launch left out). ' +
        'Measured pace 0.29 a day over the last 7 days (0, 0, 0, 0, 0, 1, 1). ' +
        'ETA at that pace: 2026-10-11, before outside waits.',
    );
  });

  // Shyden, 2026-10-12: effort is the points left on open tickets, never a percentage.
  it('states the points remaining, the measured pace and the ETA at that pace', () => {
    expect(formatLines(progress(sample(), TODAY), TODAY)[1]).toBe(
      'By effort: 21 points remaining across 2 open tickets (7 points closed). ' +
        'Measured pace 1.00 points a day over the last 7 days (0, 0, 0, 0, 0, 5, 2). ' +
        'ETA at that pace: 2026-10-25, before outside waits.',
    );
  });

  it('names one point and one ticket in the singular', () => {
    expect(formatLines(progress([closedOn(1, '2026-10-03', 1), item({ number: 2, estimate: 1 })], TODAY), TODAY)[1]).toMatch(
      /^By effort: 1 point remaining across 1 open ticket \(1 point closed\)\. /,
    );
  });

  it('names the assumed points of unscored closed stories', () => {
    const lines = formatLines(
      progress([closedOn(1, '2026-10-03', 4), closedOn(2, '2026-08-01', null), item({ number: 3, estimate: 8 })], TODAY),
      TODAY,
    );
    expect(lines[1]).toContain('1 closed story unscored, counted at the scored mean of 4.0 points (assumed)');
  });

  it('names several unscored closed stories in the plural', () => {
    const lines = formatLines(
      progress(
        [closedOn(1, '2026-10-03', 4), closedOn(2, '2026-08-01', null), closedOn(3, '2026-08-02', null), item({ number: 4, estimate: 8 })],
        TODAY,
      ),
      TODAY,
    );
    expect(lines[1]).toContain('2 closed stories unscored');
  });

  // Issue shyden-labs/repo-template#75: a board holding only epics and post-launch stories has nothing in scope, and no percentage of nothing.
  it('says both lines are unavailable when nothing on the board is in scope', () => {
    const lines = formatLines(
      progress([item({ number: 1, title: 'Epic: a' }), item({ number: 2, labels: ['post-launch'] })], TODAY),
      TODAY,
    );
    expect(lines).toEqual([
      'By tickets: unavailable, 0 in-scope stories on the board (1 epic and 1 post-launch left out)',
      'By effort: unavailable, 0 in-scope stories on the board',
    ]);
  });

  it('says effort is unavailable, with the count scored, before the backfill', () => {
    expect(formatLines(progress([item({ number: 1, estimate: null }), item({ number: 2 })], TODAY), TODAY)[1]).toBe(
      'By effort: unavailable, 1 of 2 open tickets scored',
    );
  });

  it('gives no date when nothing closed in the window', () => {
    expect(formatLines(progress([item({ number: 1 })], TODAY), TODAY)[0]).toContain(
      'ETA at that pace: none, nothing closed in the last 7 days.',
    );
  });
});

describe('parseItems', () => {
  const page = (nodes: unknown[]) => ({
    data: {
      node: {
        title: 'Example Stories',
        items: { nodes },
      },
    },
  });

  const issue = (number: number) => ({
    estimate: null,
    content: {
      __typename: 'Issue',
      number,
      title: 'S',
      state: 'OPEN',
      createdAt: '2026-10-01T00:00:00Z',
      closedAt: null,
      labels: { nodes: [] },
    },
  });
  const pullRequest = (number: number) => ({
    estimate: null,
    content: { __typename: 'PullRequest', number, title: `PR ${String(number)}` },
  });

  it('reads an issue with its Estimate, state, close time and labels', () => {
    expect(
      parseItems([
        page([
          {
            estimate: { number: 5 },
            content: {
              __typename: 'Issue',
              number: 7,
              title: 'Story',
              state: 'CLOSED',
              createdAt: '2026-10-01T00:00:00Z',
              closedAt: '2026-10-03T01:02:03Z',
              labels: { nodes: [{ name: 'post-launch' }] },
            },
          },
        ]),
      ]).items,
    ).toEqual([
      {
        number: 7,
        title: 'Story',
        state: 'CLOSED',
        createdAt: '2026-10-01T00:00:00Z',
        closedAt: '2026-10-03T01:02:03Z',
        estimate: 5,
        labels: ['post-launch'],
      },
    ]);
  });

  it('reads an unset Estimate as null', () => {
    const [read] = parseItems([
      page([
        {
          estimate: null,
          content: {
            __typename: 'Issue',
            number: 8,
            title: 'Story',
            state: 'OPEN',
            createdAt: '2026-10-01T00:00:00Z',
            closedAt: null,
            labels: { nodes: [] },
          },
        },
      ]),
    ]).items;
    expect(read?.estimate).toBeNull();
  });

  it('leaves a pull request out of the count, by number', () => {
    expect(parseItems([page([issue(1), pullRequest(100)])])).toEqual({
      items: [expect.objectContaining({ number: 1 })],
      pullRequests: [100],
    });
  });

  it('reads a draft card as an open story with no number, keeping its Estimate', () => {
    expect(
      parseItems([
        page([
          {
            estimate: { number: 5 },
            content: { __typename: 'DraftIssue', title: 'Idea', createdAt: '2026-10-02T00:00:00Z' },
          },
        ]),
      ]),
    ).toEqual({
      items: [
        {
          number: null,
          title: 'Idea',
          state: 'OPEN',
          createdAt: '2026-10-02T00:00:00Z',
          closedAt: null,
          estimate: 5,
          labels: [],
        },
      ],
      pullRequests: [],
    });
  });

  it('reads a draft card with no Estimate as unscored', () => {
    expect(
      parseItems([page([{ estimate: null, content: { __typename: 'DraftIssue', title: 'Idea', createdAt: '2026-10-02T00:00:00Z' } }])])
        .items[0]?.estimate,
    ).toBeNull();
  });

  it('reads an issue that came back with no labels as having none', () => {
    const { content } = issue(4);
    const { labels: _labels, ...withoutLabels } = content;
    expect(parseItems([page([{ estimate: null, content: withoutLabels }])]).items[0]?.labels).toEqual([]);
  });

  it('refuses a draft card that came back without its creation time', () => {
    expect(() => parseItems([page([{ estimate: null, content: { __typename: 'DraftIssue', title: 'Idea' } }])])).toThrow(
      'a draft card on the board came back without its title or creation time',
    );
  });

  it('refuses a card it cannot read, which could be open work', () => {
    expect(() => parseItems([page([{ estimate: null, content: null }])])).toThrow(
      'a card on the board came back with no content (this token cannot read it): nothing read, as the count would not be exact',
    );
  });

  it('refuses a kind of card it does not know, by name', () => {
    expect(() => parseItems([page([{ estimate: null, content: { __typename: 'Mystery', title: 'X' } }])])).toThrow(
      'a "Mystery" card is not one this script knows how to count: nothing read',
    );
  });

  it('refuses an issue that came back without its number', () => {
    const { number: _number, ...rest } = issue(1).content;
    expect(() => parseItems([page([{ estimate: null, content: rest }])])).toThrow(
      'an issue on the board came back without its number, title, state or creation time',
    );
  });

  it('refuses a pull request that came back without its number', () => {
    expect(() => parseItems([page([{ estimate: null, content: { __typename: 'PullRequest', title: 'PR' } }])])).toThrow(
      'a pull request on the board came back without its number',
    );
  });

  it('reads every page', () => {
    expect(parseItems([page([issue(1)]), page([issue(2), issue(3)])]).items.map((i) => i.number)).toEqual([1, 2, 3]);
  });

  it('collects what it left out from every page', () => {
    expect(parseItems([page([pullRequest(100)]), page([pullRequest(101)])]).pullRequests).toEqual([100, 101]);
  });

  it('asks the board for each pull request card by number', () => {
    expect(QUERY).toMatch(/\.\.\. on PullRequest \{ number title \}/);
  });

  it('asks the board for each draft card’s creation time', () => {
    expect(QUERY).toMatch(/\.\.\. on DraftIssue \{ title createdAt \}/);
  });
});

describe('formatLeftOut', () => {
  it('prints nothing when no pull request is on the board', () => {
    expect(formatLeftOut([])).toBeNull();
  });

  it('counts and names every pull request left out', () => {
    expect(formatLeftOut([100, 101])).toBe('Left out, not issues: 2 pull requests (#100, #101).');
  });

  it('names a single pull request in the singular', () => {
    expect(formatLeftOut([100])).toBe('Left out, not issues: 1 pull request (#100).');
  });
});

describe('assertTitle', () => {
  it('passes the board it was asked for', () => {
    expect(() => {
      assertTitle('Example Stories', 'Example Stories');
    }).not.toThrow();
  });

  it('refuses any other board by name', () => {
    expect(() => {
      assertTitle('ShyTalk Stories', 'Example Stories');
    }).toThrow('the board is "ShyTalk Stories", not "Example Stories": nothing read');
  });
});

describe('main', () => {
  const card = (number: number, typename = 'Issue') => ({
    estimate: { number: 3 },
    content: {
      __typename: typename,
      number,
      title: `S${String(number)}`,
      state: 'OPEN',
      createdAt: '2026-10-01T00:00:00Z',
      closedAt: null,
      labels: { nodes: [] },
    },
  });
  const boardPage = (title: string, nodes: unknown[], totalCount = nodes.length) => ({
    data: { node: { title, items: { totalCount, nodes } } },
  });
  let out: string[];
  beforeEach(() => {
    gh.mockReset();
    out = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((t) => (out.push(String(t)), true));
    vi.useFakeTimers({ now: new Date(`${TODAY}T12:00:00Z`) });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([[[]], [['PVT_1']]])('refuses the arguments %j', (args) => {
    expect(() => main(args)).toThrow('usage: node scripts/board-progress.ts <board-node-id> "<board title>"');
  });

  it('reads the board by its node id', () => {
    gh.mockReturnValueOnce(JSON.stringify([boardPage('Example Stories', [card(1)])]));
    main(['PVT_1', 'Example Stories']);
    expect(gh).toHaveBeenCalledWith('gh', ['api', 'graphql', '--paginate', '--slurp', '-f', `query=${QUERY}`, '-f', 'id=PVT_1'], {
      encoding: 'utf8',
    });
  });

  it('refuses when any page names another board', () => {
    gh.mockReturnValueOnce(JSON.stringify([boardPage('Example Stories', [card(1)], 2), boardPage('ShyTalk Stories', [card(2)], 2)]));
    expect(() => main(['PVT_1', 'Example Stories'])).toThrow('the board is "ShyTalk Stories", not "Example Stories": nothing read');
  });

  it('refuses a short read rather than reporting progress on part of the board', () => {
    gh.mockReturnValueOnce(JSON.stringify([boardPage('Example Stories', [card(1)], 466)]));
    expect(() => main(['PVT_1', 'Example Stories'])).toThrow(
      'the board "Example Stories" holds 466 items and 1 were read: a short read, nothing judged',
    );
    expect(out).toEqual([]);
  });

  // Issue shyden-labs/repo-template#75: a new board, or one whose items are all archived, is expected; it is named, never failed.
  it('says a board of 0 items has no progress to report, and exits 0', () => {
    gh.mockReturnValueOnce(JSON.stringify([boardPage('Example Stories', [])]));
    expect(main(['PVT_1', 'Example Stories'])).toBe(0);
    expect(out).toEqual([`${emptyBoardNote('Example Stories')}: no progress to report.\n`]);
  });

  it("asks for each page's board size", () => {
    expect(QUERY).toContain('items(first: 100, after: $endCursor) { totalCount pageInfo { hasNextPage endCursor }');
  });

  it('prints both progress lines, dated today, and exits 0', () => {
    const pages = [boardPage('Example Stories', [card(1)])];
    gh.mockReturnValueOnce(JSON.stringify(pages));
    expect(main(['PVT_1', 'Example Stories'])).toBe(0);
    const { items } = parseItems(pages);
    expect(out).toEqual(formatLines(progress(items, TODAY), TODAY).map((line) => `${line}\n`));
  });

  it('adds the line naming each pull request it left out', () => {
    const pages = [boardPage('Example Stories', [card(1), card(9, 'PullRequest')])];
    gh.mockReturnValueOnce(JSON.stringify(pages));
    main(['PVT_1', 'Example Stories']);
    expect(out.at(-1)).toBe('Left out, not issues: 1 pull request (#9).\n');
  });
});

/**
 * A board read is judged only when it is whole (issue shyden-labs/repo-template#72). On 2026-10-22
 * GitHub's Projects API served short and empty pages for a 466-item board,
 * and board-next printed "nothing is open". Every page states the board's
 * size; what was collected must equal it, on a board holding something.
 */
describe('assertWholeRead', () => {
  const sized = (title: string, total: unknown, count: number) => ({
    data: { node: { title, items: { totalCount: total, nodes: Array.from({ length: count }, (_, i) => ({ i })) } } },
  });

  it.each([
    ['one page holding the whole board', [sized('Board', 3, 3)], 3],
    ['two pages summing to the whole board', [sized('Board', 150, 100), sized('Board', 150, 50)], 150],
    ['a board of 0 items, new or all archived (issue #75)', [sized('Board', 0, 0)], 0],
  ])('accepts %s, returning its size', (_, pages, size) => {
    expect(assertWholeRead(pages, 'Board')).toBe(size);
  });

  it('names an empty board as new, archived or a GitHub empty page', () => {
    expect(emptyBoardNote('Board')).toBe(
      'the board "Board" reads 0 items: a new board, every item archived, or GitHub served an empty page',
    );
  });

  it.each([
    ['no pages', [], 'the board "Board" read no pages: nothing judged'],
    ['a page of another board', [sized('Board', 2, 1), sized('Other', 2, 1)], 'the board is "Other", not "Board": nothing read'],
    ['a short page', [sized('Board', 466, 100)], 'the board "Board" holds 466 items and 100 were read: a short read, nothing judged'],
    ['a short second page', [sized('Board', 150, 100), sized('Board', 150, 49)], 'the board "Board" holds 150 items and 149 were read'],
    ['more items than the board holds', [sized('Board', 1, 2)], 'the board "Board" holds 1 items and 2 were read'],
    [
      'pages disagreeing on its size',
      [sized('Board', 5, 3), sized('Board', 3, 2)],
      'the board "Board" changed size while it was read (5, 3): nothing judged',
    ],
    ['an empty page of a board that holds items', [sized('Board', 5, 0)], 'the board "Board" holds 5 items and 0 were read: a short read'],
    ['a page with no size', [sized('Board', undefined, 1)], 'the board "Board" read a page with no items.totalCount: nothing judged'],
    ['a size that is not a count', [sized('Board', '1', 1)], 'the board "Board" read a page with no items.totalCount: nothing judged'],
  ])('refuses %s, naming it', (_, pages, message) => {
    expect(() => {
      assertWholeRead(pages, 'Board');
    }).toThrow(message);
  });
});

/**
 * Each script reading a board's items asks for the board's size and checks
 * the read against it (issue shyden-labs/repo-template#72), so a new script cannot leave it out. A
 * script reads items when its code (comments stripped) holds `items(first:`.
 */
const unguardedReaders = (files: { name: string; text: string }[]) =>
  files
    .filter(({ text }) => /items\(first:/.test(text))
    .map(({ name, text }) => ({
      name,
      missing: [
        ...(/items\(first: \d+, after: \$endCursor\) \{ totalCount pageInfo/.test(text) ? [] : ['totalCount']),
        ...(/assertWholeRead\(pages, title\)/.test(text) ? [] : ['assertWholeRead']),
      ],
    }));

describe('every board reader checks its read is whole', () => {
  const scripts = readdirSync('scripts')
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ name: f, text: withoutTsComments(readFileSync(`scripts/${f}`, 'utf8')) }));

  it('judged over every script that reads board items', () => {
    const readers = unguardedReaders(scripts);
    expect({ readers: readers.map(({ name }) => name), missing: readers.filter(({ missing }) => missing.length > 0) }).toEqual({
      readers: ['board-next.ts', 'board-orphans.ts', 'board-progress.ts'],
      missing: [],
    });
  });

  const reader =
    'const QUERY = `items(first: 100, after: $endCursor) { totalCount pageInfo { hasNextPage } }`;\nassertWholeRead(pages, title);';

  it.each([
    ['asks for no size', reader.replace(' totalCount', ''), ['totalCount']],
    ['never checks the read', reader.replace('assertWholeRead(pages, title);', 'assertTitle(pages, title);'), ['assertWholeRead']],
    [
      'checks only in a comment',
      reader.replace('assertWholeRead(pages, title);', '// assertWholeRead(pages, title);'),
      ['assertWholeRead'],
    ],
  ])('names a reader that %s', (_, text, missing) => {
    expect(unguardedReaders([{ name: 'x.ts', text: withoutTsComments(text) }])).toEqual([{ name: 'x.ts', missing }]);
  });

  it('accepts a reader that asks for the size and checks the read', () => {
    expect(unguardedReaders([{ name: 'x.ts', text: withoutTsComments(reader) }])).toEqual([{ name: 'x.ts', missing: [] }]);
  });
});
