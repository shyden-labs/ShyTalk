import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { main, planEstimateField, planPriorityField, PRIORITY_OPTIONS } from '../../scripts/board-setup.ts';

// `gh` is stood in: a unit test starts no process. Each test queues gh's replies in call order.
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
const gh = vi.mocked(execFileSync);

/**
 * Every project board carries a Number field named `Estimate`, so progress
 * can be counted in story points as well as tickets (docs/project-board.md).
 */

describe('planEstimateField', () => {
  it('creates the field on a board that has none', () => {
    expect(
      planEstimateField([
        { name: 'Title', dataType: 'TITLE' },
        { name: 'Status', dataType: 'SINGLE_SELECT' },
      ]),
    ).toBe('create');
  });

  it('keeps a Number field already named Estimate', () => {
    expect(planEstimateField([{ name: 'Estimate', dataType: 'NUMBER' }])).toBe('exists');
  });

  it('refuses an Estimate field of another type by name', () => {
    expect(() => planEstimateField([{ name: 'Estimate', dataType: 'TEXT' }])).toThrow(
      'the board has an "Estimate" field of type TEXT; it must be NUMBER: rename or delete it first',
    );
  });
});

/**
 * Every project board carries a single-select `Priority` field, P0 to P5,
 * so the board, not a handover file, says what is worked on next
 * (docs/project-board.md; operator 2026-10-12).
 */
const SIX = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5'];

describe('PRIORITY_OPTIONS', () => {
  it('holds the six levels in order, each with its definition', () => {
    expect(PRIORITY_OPTIONS.map((o) => o.name)).toEqual(SIX);
    expect(PRIORITY_OPTIONS[0].description).toBe('Now: a live defect, a vulnerability, broken CI or deploy, or a release blocker.');
    expect(PRIORITY_OPTIONS[1].description).toBe(
      'Next: something the operator asked for directly, or work already in flight. A blocker is not P1 by being one: it is raised to the level of what waits on it.',
    );
    expect(PRIORITY_OPTIONS[2].description).toBe(
      'Important: user-facing improvements and the standing quality rules (test limits, guards that cannot see what they judge).',
    );
    expect(PRIORITY_OPTIONS[3].description).toBe('Planned: ordinary backlog.');
    expect(PRIORITY_OPTIONS[4].description).toBe('Later: worth doing, no pressure.');
    expect(PRIORITY_OPTIONS[5].description).toBe('Someday: ideas and nice-to-haves.');
  });
});

describe('planPriorityField', () => {
  it('creates the field on a board that has none', () => {
    expect(planPriorityField([{ name: 'Status', dataType: 'SINGLE_SELECT' }])).toBe('create');
  });

  it('keeps a single-select Priority holding the six levels in order', () => {
    expect(
      planPriorityField([
        {
          name: 'Priority',
          dataType: 'SINGLE_SELECT',
          options: SIX.map((name) => ({ name })),
        },
      ]),
    ).toBe('exists');
  });

  it('refuses a Priority field of another type by name', () => {
    expect(() => planPriorityField([{ name: 'Priority', dataType: 'NUMBER' }])).toThrow(
      'the board has a "Priority" field of type NUMBER; it must be SINGLE_SELECT: rename or delete it first',
    );
  });

  it('refuses a Priority field whose options differ, naming both lists', () => {
    expect(() =>
      planPriorityField([
        {
          name: 'Priority',
          dataType: 'SINGLE_SELECT',
          options: ['High', 'Medium', 'Low'].map((name) => ({ name })),
        },
      ]),
    ).toThrow(
      'the board\'s "Priority" options are High, Medium, Low; they must be P0, P1, P2, P3, P4, P5 in that order: edit the field first',
    );
  });

  it('refuses the six levels out of order', () => {
    expect(() =>
      planPriorityField([
        {
          name: 'Priority',
          dataType: 'SINGLE_SELECT',
          options: ['P5', 'P4', 'P3', 'P2', 'P1', 'P0'].map((name) => ({ name })),
        },
      ]),
    ).toThrow('they must be P0, P1, P2, P3, P4, P5 in that order');
  });

  it('refuses a single-select Priority that came back with no options', () => {
    expect(() => planPriorityField([{ name: 'Priority', dataType: 'SINGLE_SELECT' }])).toThrow(
      `the board's "Priority" options are ; they must be P0, P1, P2, P3, P4, P5 in that order: edit the field first`,
    );
  });
});

describe('main', () => {
  const ESTIMATE = { name: 'Estimate', dataType: 'NUMBER' };
  const PRIORITY = { name: 'Priority', dataType: 'SINGLE_SELECT', options: PRIORITY_OPTIONS.map(({ name }) => ({ name })) };
  const board = (...fields: object[]) => ({ data: { node: { title: 'Board', fields: { nodes: fields } } } });
  const reply = (...values: unknown[]) => {
    for (const value of values) gh.mockReturnValueOnce(JSON.stringify(value));
  };
  /** Each call's GraphQL operation name (`query` or the mutation's field) and its variables. */
  const calls = () =>
    gh.mock.calls.map((c) => {
      const args = c[1] as string[];
      const query = args[args.indexOf('-f') + 1] as string;
      return [/^query=(query|mutation)/.exec(query)?.[1], /name: "(\w+)"/.exec(query)?.[1] ?? '', args.slice(4)];
    });
  let out: string[];
  beforeEach(() => {
    gh.mockReset();
    out = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((t) => (out.push(String(t)), true));
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([[[]], [['PVT_1']]])('refuses the arguments %j', (args) => {
    expect(() => main(args)).toThrow('usage: node scripts/board-setup.ts <board-node-id> "<board title>"');
  });

  it('refuses another board by name, before creating anything', () => {
    reply(board());
    expect(() => main(['PVT_1', 'Other'])).toThrow('the board is "Board", not "Other": nothing read');
    expect(gh).toHaveBeenCalledTimes(1);
  });

  it('creates both fields on a bare board, reads them back and exits 0', () => {
    reply(board(), {}, {}, board(ESTIMATE, PRIORITY));
    expect(main(['PVT_1', 'Board'])).toBe(0);
    expect(calls()).toEqual([
      ['query', '', ['-f', 'id=PVT_1']],
      ['mutation', 'Estimate', ['-f', 'id=PVT_1']],
      ['mutation', 'Priority', ['-f', 'id=PVT_1']],
      ['query', '', ['-f', 'id=PVT_1']],
    ]);
    expect(out).toEqual(['"Board" has a Number field "Estimate" and a single-select field "Priority" (P0-P5).\n']);
  });

  it('creates nothing on a board that has both', () => {
    reply(board(ESTIMATE, PRIORITY), board(ESTIMATE, PRIORITY));
    expect(main(['PVT_1', 'Board'])).toBe(0);
    expect(calls().map(([kind]) => kind)).toEqual(['query', 'query']);
  });

  it('fails when the Estimate field is not there on reading back', () => {
    reply(board(ESTIMATE, PRIORITY), board(PRIORITY));
    expect(() => main(['PVT_1', 'Board'])).toThrow('the Estimate field was not there on reading back');
  });

  it('fails when the Priority field is not there on reading back', () => {
    reply(board(ESTIMATE, PRIORITY), board(ESTIMATE));
    expect(() => main(['PVT_1', 'Board'])).toThrow('the Priority field was not there on reading back');
  });
});
