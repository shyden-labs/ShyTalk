import { QUERY, parseItems } from '../../../../scripts/board-progress.ts';
import type { RoadmapItem } from './snapshot.ts';

/**
 * The roadmap's board read (shyden-labs/ShyTalk#321): the close-out's own query and parser, so the page and the
 * close-out count the same board the same way (one home for the maths; yawelo-idle#838), plus each card's
 * Priority, parent epic and public words.
 */

const EXTRA_FIELDS = `priority: fieldValueByName(name: "Priority") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
        publicTitle: fieldValueByName(name: "Public title") { ... on ProjectV2ItemFieldTextValue { text } }
        publicSummary: fieldValueByName(name: "Public summary") { ... on ProjectV2ItemFieldTextValue { text } }
        `;

export const ROADMAP_QUERY = QUERY.replace('nodes {\n', `nodes {\n        ${EXTRA_FIELDS}`).replace(
  'labels(first: 20) { nodes { name } }',
  'labels(first: 20) { nodes { name } } parent { number }',
);

interface RoadmapNode {
  priority: { name?: string } | null;
  publicTitle: { text?: string } | null;
  publicSummary: { text?: string } | null;
  content: { __typename: string; parent?: { number: number } | null };
}

interface RoadmapPage {
  data: { node: { items: { nodes: RoadmapNode[] } } };
}

type Extras = Pick<RoadmapItem, 'priority' | 'parent' | 'publicTitle' | 'publicSummary'>;

/** Public words as written, or null when the field is empty or blank. */
function words(field: { text?: string } | null): string | null {
  const text = (field?.text ?? '').trim();
  return text === '' ? null : text;
}

/** An issue's extras; a draft card has none, as it is never public. */
function extrasOf(node: RoadmapNode): Extras {
  if (node.content.__typename !== 'Issue') return { priority: null, parent: null, publicTitle: null, publicSummary: null };
  return {
    priority: node.priority?.name ?? null,
    parent: node.content.parent?.number ?? null,
    publicTitle: words(node.publicTitle),
    publicSummary: words(node.publicSummary),
  };
}

/** Every issue and draft card on the board with its extras; pull-request cards are left out, as the close-out leaves them. */
export function parseRoadmapItems(pages: unknown[]): RoadmapItem[] {
  // The close-out's parser checks the read first: a card without content stops it by name.
  const { items } = parseItems(pages);
  // It gives one item per card that is not a pull request, in order, so the cards pair with the items one to one.
  const extras = (pages as RoadmapPage[])
    .flatMap((page) => page.data.node.items.nodes)
    .filter((node) => node.content.__typename !== 'PullRequest')
    .map(extrasOf);
  // Equal lengths, so each item has its card: the cast only drops the iterator's end-of-list undefined.
  const next = extras.values();
  return items.map((item) => ({ ...item, ...(next.next().value as Extras) }));
}
