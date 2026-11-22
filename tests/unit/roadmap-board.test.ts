import { describe, it, expect } from 'vitest';
import { QUERY } from '../../scripts/board-progress.ts';
import { ROADMAP_QUERY, parseRoadmapItems } from '../../workers/web/src/roadmap/board.ts';

/**
 * The roadmap's board read (shyden-labs/ShyTalk#321): the close-out's own query and parser (one home for the
 * maths), plus each card's Priority, parent epic and public words.
 */

type Field = { name: string } | { number: number } | { text: string } | null;
function issueCard(number: number, more: { priority?: string; parent?: number; publicTitle?: string; publicSummary?: string } = {}) {
  const text = (value: string | undefined): Field => (value === undefined ? null : { text: value });
  return {
    estimate: { number: 3 },
    priority: more.priority === undefined ? null : { name: more.priority },
    publicTitle: text(more.publicTitle),
    publicSummary: text(more.publicSummary),
    content: {
      __typename: 'Issue',
      number,
      title: `Internal ${String(number)}`,
      state: 'OPEN',
      stateReason: null,
      createdAt: '2026-11-01T00:00:00Z',
      closedAt: null,
      labels: { nodes: [] },
      parent: more.parent === undefined ? null : { number: more.parent },
    },
  };
}
const page = (nodes: unknown[]) => ({ data: { node: { title: 'ShyTalk Stories', items: { totalCount: nodes.length, nodes } } } });

describe('the roadmap query', () => {
  it('asks for everything the close-out asks for', () => {
    for (const piece of ['Estimate', 'stateReason', 'closedAt', 'labels(first: 20)', 'DraftIssue', 'PullRequest', 'pageInfo']) {
      expect(QUERY).toContain(piece);
      expect(ROADMAP_QUERY).toContain(piece);
    }
  });

  it('also asks for Priority, the parent epic and the public words', () => {
    for (const piece of [
      'fieldValueByName(name: "Priority")',
      'fieldValueByName(name: "Public title")',
      'fieldValueByName(name: "Public summary")',
      'parent { number }',
    ]) {
      expect(ROADMAP_QUERY).toContain(piece);
    }
  });
});

describe('reading the cards', () => {
  it('gives each issue its Priority, parent and public words', () => {
    const [item] = parseRoadmapItems([
      page([issueCard(12, { priority: 'P1', parent: 11, publicTitle: 'Live changes', publicSummary: 'Unused on a story.' })]),
    ]);
    expect(item).toMatchObject({
      number: 12,
      title: 'Internal 12',
      estimate: 3,
      priority: 'P1',
      parent: 11,
      publicTitle: 'Live changes',
      publicSummary: 'Unused on a story.',
    });
  });

  it('reads a field left empty as null', () => {
    const [item] = parseRoadmapItems([page([issueCard(13)])]);
    expect(item).toMatchObject({ number: 13, priority: null, parent: null, publicTitle: null, publicSummary: null });
  });

  it('reads blank public words as none', () => {
    const [item] = parseRoadmapItems([page([issueCard(14, { publicTitle: '  ', publicSummary: '' })])]);
    expect(item).toMatchObject({ publicTitle: null, publicSummary: null });
  });

  it('counts a draft card with no extras, and no pull request card at all', () => {
    const draft = {
      estimate: null,
      priority: { name: 'P0' },
      publicTitle: { text: 'Draft words' },
      publicSummary: null,
      content: { __typename: 'DraftIssue', title: 'An idea', createdAt: '2026-11-01T00:00:00Z' },
    };
    const pull = {
      estimate: null,
      priority: null,
      publicTitle: null,
      publicSummary: null,
      content: { __typename: 'PullRequest', number: 99, title: 'A PR' },
    };
    const items = parseRoadmapItems([page([issueCard(15), draft, pull])]);
    expect(items.map(({ number, publicTitle }) => [number, publicTitle])).toEqual([
      [15, null],
      [null, null],
    ]);
  });

  it('refuses the whole read when a card comes back without its content, as the close-out does', () => {
    const hidden = { estimate: null, priority: null, publicTitle: null, publicSummary: null, content: null };
    expect(() => parseRoadmapItems([page([hidden])])).toThrow('came back with no content');
  });
});
