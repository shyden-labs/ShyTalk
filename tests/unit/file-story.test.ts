import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boardFields, main, parseStory, type Story } from '../../scripts/file-story.ts';

/**
 * Filing a story the way every project does (issue shyden-labs/repo-template#20): the story is checked
 * before anything is written, the board is resolved by node id with its title
 * asserted, a title already open is refused, and every field set is read back.
 * `gh` is stood in: no process starts and nothing reaches the network.
 */

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
const gh = vi.mocked(execFileSync);

const BODY = ['## Story', 'x', '## Context', 'x', '## Acceptance criteria', '1. x', '## Announce', 'x', '## Definition of done', 'x'].join(
  '\n\n',
);
const STORY: Story = {
  repo: 'shyden-labs/app',
  title: 'A new story',
  body: BODY,
  estimate: 3,
  priority: 'P2',
  status: 'Todo',
  blockedBy: [12],
  parent: 7,
};

describe('parseStory', () => {
  it('reads a complete story', () => {
    expect(parseStory(JSON.stringify(STORY))).toEqual(STORY);
  });

  it('defaults the status to Todo and the links to none', () => {
    const { status: _s, blockedBy: _b, parent: _p, ...bare } = STORY;
    expect(parseStory(JSON.stringify(bare))).toEqual({ ...bare, status: 'Todo', blockedBy: [], parent: null });
  });

  it.each([
    ['not JSON', '{', 'file-story: the story is not JSON'],
    ['not an object', '[]', 'file-story: the story is not a JSON object'],
    ['no repository', JSON.stringify({ ...STORY, repo: 'app' }), 'file-story: repo must be <owner>/<name>'],
    ['an empty title', JSON.stringify({ ...STORY, title: ' ' }), 'file-story: the title is empty'],
    [
      'an estimate off the scale',
      JSON.stringify({ ...STORY, estimate: 4 }),
      'file-story: estimate 4 is not 1, 2, 3, 5, 8 or 13 (larger is an epic: split it)',
    ],
    ['an unknown priority', JSON.stringify({ ...STORY, priority: 'P9' }), 'file-story: priority P9 is not P0 to P5'],
    [
      'a blocker that is not an issue number',
      JSON.stringify({ ...STORY, blockedBy: ['12'] }),
      'file-story: blockedBy must list issue numbers',
    ],
    ['a parent that is not an issue number', JSON.stringify({ ...STORY, parent: 0 }), 'file-story: parent must be an issue number'],
    ['a status that is not text', JSON.stringify({ ...STORY, status: 3 }), 'file-story: status must be the name of a Status option'],
    ['a body that is not text', JSON.stringify({ ...STORY, body: { text: 'x' } }), 'file-story: body must be text'],
    [
      'a body with no Announce',
      JSON.stringify({ ...STORY, body: BODY.replace('## Announce', '## Notes') }),
      'file-story: the body has no "## Announce" section',
    ],
    ['a story with no body', JSON.stringify({ ...STORY, body: undefined }), 'file-story: the body has no "## Story" section'],
    [
      'a closing keyword',
      JSON.stringify({ ...STORY, body: `${BODY}\n\nFixes #4` }),
      'file-story: the body would close #4 on merge ("Fixes #4"); write "Refs #4"',
    ],
  ])('refuses %s', (_kind, text, message) => {
    expect(() => parseStory(text)).toThrow(message);
  });
});

const field = (id: string, name: string, dataType: string, options?: string[]) => ({
  id,
  name,
  dataType,
  ...(options === undefined ? {} : { options: options.map((o) => ({ id: `${id}-${o}`, name: o })) }),
});
const FIELDS = [
  field('F_title', 'Title', 'TITLE'),
  field('F_est', 'Estimate', 'NUMBER'),
  field('F_pri', 'Priority', 'SINGLE_SELECT', ['P0', 'P1', 'P2', 'P3', 'P4', 'P5']),
  field('F_sta', 'Status', 'SINGLE_SELECT', ['Todo', 'In Progress', 'Done']),
];

describe('boardFields', () => {
  it('finds the three fields and the options the story names', () => {
    expect(boardFields(FIELDS, STORY)).toEqual({
      estimate: 'F_est',
      priority: { field: 'F_pri', option: 'F_pri-P2' },
      status: { field: 'F_sta', option: 'F_sta-Todo' },
    });
  });

  it.each([
    [
      'Estimate',
      FIELDS.filter((f) => f.name !== 'Estimate'),
      'file-story: the board has no Number field "Estimate"; run scripts/board-setup.ts',
    ],
    [
      'Priority',
      FIELDS.filter((f) => f.name !== 'Priority'),
      'file-story: the board has no single-select field "Priority"; run scripts/board-setup.ts',
    ],
    ['Status', FIELDS.filter((f) => f.name !== 'Status'), 'file-story: the board has no single-select field "Status"'],
  ])('refuses a board with no %s field', (_name, fields, message) => {
    expect(() => boardFields(fields, STORY)).toThrow(message);
  });

  it('refuses an Estimate field of another type', () => {
    expect(() => boardFields([...FIELDS.filter((f) => f.name !== 'Estimate'), field('F_x', 'Estimate', 'TEXT')], STORY)).toThrow(
      'file-story: the board has no Number field "Estimate"',
    );
  });

  it('refuses a Status field that came back with no options', () => {
    expect(() => boardFields([...FIELDS.filter((f) => f.name !== 'Status'), field('F_sta', 'Status', 'SINGLE_SELECT')], STORY)).toThrow(
      'file-story: the board\'s Status has no option "Todo" (it has )',
    );
  });

  it('refuses a status the board does not offer, naming the ones it does', () => {
    expect(() => boardFields(FIELDS, { ...STORY, status: 'Backlog' })).toThrow(
      'file-story: the board\'s Status has no option "Backlog" (it has Todo, In Progress, Done)',
    );
  });
});

describe('main', () => {
  let dir: string;
  let out: string[];
  beforeEach(() => {
    gh.mockReset();
    dir = mkdtempSync(join(tmpdir(), 'file-story-'));
    out = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((t) => (out.push(String(t)), true));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (story: object) => {
    const path = join(dir, 'story.json');
    writeFileSync(path, JSON.stringify(story));
    return path;
  };
  const reply = (...values: unknown[]) => {
    for (const value of values) gh.mockReturnValueOnce(JSON.stringify(value));
  };
  const board = (title = 'App Stories') => ({ data: { node: { title, fields: { nodes: FIELDS } } } });
  /** The issue's cards as GitHub lists them: one on another board first, then this board's. */
  const readBack = (over: object = {}, cards?: object[]) => ({
    data: {
      repository: {
        issue: {
          projectItems: {
            nodes: cards ?? [
              { project: { id: 'PVT_9', title: 'Other' }, estimate: null, priority: null, status: null },
              {
                project: { id: 'PVT_1', title: 'App Stories' },
                estimate: { number: 3 },
                priority: { name: 'P2' },
                status: { name: 'Todo' },
                ...over,
              },
            ],
          },
        },
      },
    },
  });
  /** Every reply of a whole filing, in the order the filer asks. */
  const filing = (over: { readBack?: object; blockers?: unknown; parent?: unknown } = {}) => [
    board(),
    [],
    { number: 40, id: 4000, node_id: 'I_40' },
    { data: { addProjectV2ItemById: { item: { id: 'PVTI_40' } } } },
    {},
    {},
    {},
    { id: 1200 },
    {},
    {},
    readBack(over.readBack),
    over.blockers ?? [{ number: 12 }],
    over.parent ?? { number: 7 },
  ];

  it.each([[[]], [['PVT_1', 'App Stories']], [['PVT_1', 'App Stories', 'a.json', 'x']]])('refuses the arguments %j', (args) => {
    expect(() => main(args)).toThrow('usage: node scripts/file-story.ts <board-node-id> "<board title>" <story.json>');
  });

  it('refuses another board by name before writing anything', () => {
    reply(board('ShyTalk Stories'));
    expect(() => main(['PVT_1', 'App Stories', write(STORY)])).toThrow('the board is "ShyTalk Stories", not "App Stories": nothing read');
    expect(gh).toHaveBeenCalledTimes(1);
  });

  it('refuses a title already open, naming the issue, before writing anything', () => {
    reply(board(), [{ number: 9, title: 'a NEW story' }]);
    expect(() => main(['PVT_1', 'App Stories', write(STORY)])).toThrow('file-story: #9 "a NEW story" is already open; add to it instead');
    expect(gh).toHaveBeenCalledTimes(2);
  });

  it('files the story, sets every field, links it, reads it all back and exits 0', () => {
    reply(...filing());
    expect(main(['PVT_1', 'App Stories', write(STORY)])).toBe(0);
    const args = gh.mock.calls.map((c) => (c[1] as string[]).filter((a) => !a.startsWith('query=')));
    expect(args).toEqual([
      ['api', 'graphql', '-f', '-f', 'id=PVT_1'],
      [
        'issue',
        'list',
        '-R',
        'shyden-labs/app',
        '--state',
        'open',
        '--search',
        'A new story in:title',
        '--limit',
        '100',
        '--json',
        'number,title',
      ],
      ['api', '-X', 'POST', 'repos/shyden-labs/app/issues', '-f', 'title=A new story', '-f', `body=${BODY}`],
      ['api', 'graphql', '-f', '-f', 'project=PVT_1', '-f', 'content=I_40'],
      ['api', 'graphql', '-f', '-f', 'project=PVT_1', '-f', 'item=PVTI_40', '-f', 'field=F_est', '-F', 'number=3'],
      ['api', 'graphql', '-f', '-f', 'project=PVT_1', '-f', 'item=PVTI_40', '-f', 'field=F_pri', '-f', 'option=F_pri-P2'],
      ['api', 'graphql', '-f', '-f', 'project=PVT_1', '-f', 'item=PVTI_40', '-f', 'field=F_sta', '-f', 'option=F_sta-Todo'],
      ['api', 'repos/shyden-labs/app/issues/12'],
      ['api', '-X', 'POST', 'repos/shyden-labs/app/issues/40/dependencies/blocked_by', '-F', 'issue_id=1200'],
      ['api', '-X', 'POST', 'repos/shyden-labs/app/issues/7/sub_issues', '-F', 'sub_issue_id=4000'],
      ['api', 'graphql', '-f', '-f', 'owner=shyden-labs', '-f', 'name=app', '-F', 'number=40'],
      ['api', 'repos/shyden-labs/app/issues/40/dependencies/blocked_by'],
      ['api', 'repos/shyden-labs/app/issues/40/parent'],
    ]);
    expect(out).toEqual([
      'file-story: filed shyden-labs/app#40 "A new story"\n',
      'file-story: read back: board App Stories, Estimate 3, Priority P2, Status Todo, blocked by #12, parent #7\n',
    ]);
  });

  it.each([
    ['only on another board', [{ project: { id: 'PVT_9', title: 'App Stories' }, estimate: null, priority: null, status: null }]],
    ['on no board', []],
  ])('fails, naming the board, when the issue has a card %s', (_where, cards) => {
    reply(...filing().map((r, i) => (i === 10 ? readBack({}, cards) : r)));
    expect(() => main(['PVT_1', 'App Stories', write(STORY)])).toThrow(
      'file-story: shyden-labs/app#40 was filed, but it has no card on App Stories (PVT_1)',
    );
  });

  // The GitHub App router (~/.claude/scripts/github-app/gh_route.py) runs a call
  // as a project's App only when it names that project: a REST path or -R under
  // its repository, or a graphql body (every -f/-F value) naming its board's
  // node id, or its owner and name together. A call naming neither is refused,
  // so a filing that worked exited 1 (issue shyden-labs/repo-template#96: a bare PVTI_ item id).
  it('names the repository or the board in every call it makes, as the App router needs', () => {
    reply(...filing());
    // Soft, so a run that throws still reports which calls named nothing.
    expect.soft(() => main(['PVT_1', 'App Stories', write(STORY)])).not.toThrow();
    const unnamed = gh.mock.calls
      .map((c) => c[1] as string[])
      .filter((args) => {
        if (args[1] === 'graphql') {
          const body = args.filter((_a, i) => ['-f', '-F'].includes(args[i - 1] ?? '')).join('\n');
          return !(body.includes('PVT_1') || (body.includes('shyden-labs') && body.includes('app')));
        }
        return !(args.includes('shyden-labs/app') || args.some((a) => a.startsWith('repos/shyden-labs/app/')));
      });
    expect(unnamed).toEqual([]);
    expect(gh.mock.calls).toHaveLength(13);
  });

  it('reads back two blockers in whatever order GitHub lists them', () => {
    reply(
      board(),
      [],
      { number: 40, id: 4000, node_id: 'I_40' },
      { data: { addProjectV2ItemById: { item: { id: 'PVTI_40' } } } },
      {},
      {},
      {},
      { id: 1300 },
      {},
      { id: 1200 },
      {},
      {},
      readBack(),
      [{ number: 12 }, { number: 13 }],
      { number: 7 },
    );
    expect(main(['PVT_1', 'App Stories', write({ ...STORY, blockedBy: [13, 12] })])).toBe(0);
    expect(out.at(-1)).toBe(
      'file-story: read back: board App Stories, Estimate 3, Priority P2, Status Todo, blocked by #12, #13, parent #7\n',
    );
  });

  it('files a story with no blockers and no parent, linking nothing', () => {
    reply(
      board(),
      [],
      { number: 41, id: 4100, node_id: 'I_41' },
      { data: { addProjectV2ItemById: { item: { id: 'PVTI_41' } } } },
      {},
      {},
      {},
      readBack(),
      [],
    );
    expect(main(['PVT_1', 'App Stories', write({ ...STORY, blockedBy: [], parent: null })])).toBe(0);
    expect(out.at(-1)).toBe(
      'file-story: read back: board App Stories, Estimate 3, Priority P2, Status Todo, blocked by nothing, parent none\n',
    );
  });

  it.each([
    ['the Estimate', { readBack: { estimate: { number: 5 } } }, 'Estimate read back as 5, not 3'],
    ['an unset Estimate', { readBack: { estimate: null } }, 'Estimate read back as none, not 3'],
    ['the Priority', { readBack: { priority: { name: 'P3' } } }, 'Priority read back as P3, not P2'],
    ['an unset Priority', { readBack: { priority: null } }, 'Priority read back as none, not P2'],
    ['the Status', { readBack: { status: null } }, 'Status read back as none, not Todo'],
    ['the board', { readBack: { project: { id: 'PVT_1', title: 'Other' } } }, 'the item read back on Other, not App Stories'],
    ['a blocker', { blockers: [] }, 'blocked by read back as nothing, not #12'],
    ['the parent', { parent: { number: 8 } }, 'parent read back as #8, not #7'],
  ])('fails, naming it, when %s does not read back', (_what, over, problem) => {
    reply(...filing(over));
    expect(() => main(['PVT_1', 'App Stories', write(STORY)])).toThrow(`file-story: shyden-labs/app#40 was filed, but ${problem}`);
  });
});
