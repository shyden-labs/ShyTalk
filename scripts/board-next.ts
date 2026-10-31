/**
 * Names the next ticket from the project board, so the board, not a handover
 * file, decides what is worked on next (operator 2026-10-12):
 *
 *   node scripts/board-next.ts <board-node-id> "<board title>"
 *
 * The highest `Priority` (P0 first) among open issues; within a level, what
 * is In Progress first, then what no open issue blocks, then the oldest. It
 * refuses while any open issue has no Priority, naming them, because a
 * ticket nobody scored would never be chosen and never be noticed.
 *
 * A blocker inherits the level of what waits on it (operator 2026-10-13,
 * repo-template#6): it refuses while an open blocker sits below an open issue
 * it blocks, naming each pair. A blocker off the board, whose Priority cannot
 * be read, is named in a note and never stops the pick. An epic's work is its stories, so an issue with open sub-issues is
 * passed over until they close.
 *
 * A ticket in the `After release` column (operator 2026-10-14: website work
 * and the release first, infrastructure after) is never picked, but is still
 * scored and still counts as a blocker.
 */
import { execFileSync } from 'node:child_process';
import { assertWholeRead, emptyBoardNote } from './board-progress.ts';
import { PRIORITY_OPTIONS } from './board-setup.ts';
import { runIfEntry } from './cli.ts';

/** An issue, by repository, so another repository's #3 is not this one's. */
export interface IssueRef {
  /** `owner/name`. */
  repo: string;
  number: number;
}

export interface NextItem {
  /** `owner/name`. */
  repo: string;
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED';
  createdAt: string;
  /** The board's Status option, e.g. "Todo" or "In Progress". */
  status: string | null;
  priority: string | null;
  /** The OPEN issues this one is blocked by. */
  blockedBy: IssueRef[];
  /** How many of its sub-issues are open: an epic waits for them. */
  openSubIssues: number;
}

const key = (r: IssueRef): string => `${r.repo}#${r.number}`;

/** `#n` within `home`'s repository, `owner/name#n` outside it. */
export const label = (r: IssueRef, home: string): string => (r.repo === home ? `#${r.number}` : key(r));

const LEVELS: readonly string[] = PRIORITY_OPTIONS.map((o) => o.name);

/** The Status column whose tickets wait until the release ships. */
export const PARKED = 'After release';

/** An open ticket whose Priority is set. */
export type ScoredItem = NextItem & { priority: string };

/** The next ticket, or `null` when nothing is open. */
export function nextTicket(items: NextItem[]): ScoredItem | null {
  const open = items.filter((i) => i.state === 'OPEN');
  const scored = open.filter((i): i is ScoredItem => i.priority !== null);
  const unscored = open.filter((i) => i.priority === null);
  if (unscored.length > 0) {
    throw new Error(
      `${unscored.length} open tickets have no Priority: ${unscored.map((i) => `#${i.number}`).join(', ')}. Score them on the board first.`,
    );
  }
  for (const i of scored) {
    if (!LEVELS.includes(i.priority)) {
      throw new Error(`#${i.number} has Priority "${i.priority}", which is not one of ${LEVELS.join(', ')}`);
    }
  }
  const onBoard = new Map(scored.map((i) => [key(i), i]));
  const inversions = scored.flatMap((waiting) =>
    waiting.blockedBy.flatMap((b) => {
      const blocker = onBoard.get(key(b));
      // Off the board, its Priority cannot be read: a note, never a stop
      // (operator 2026-10-13). See offBoardBlockers.
      if (blocker === undefined) return [];
      return LEVELS.indexOf(blocker.priority) > LEVELS.indexOf(waiting.priority)
        ? [`${label(b, waiting.repo)} (${blocker.priority}) blocks #${waiting.number} (${waiting.priority})`]
        : [];
    }),
  );
  if (inversions.length > 0) {
    throw new Error(`Raise each blocker to at least the Priority of what waits on it: ${inversions.join('; ')}.`);
  }
  const candidates = scored.filter((i) => i.status !== PARKED);
  const workable = candidates.filter((i) => i.openSubIssues === 0);
  if (candidates.length > 0 && workable.length === 0) {
    throw new Error(
      `Every open issue is an epic with open sub-issues: ${candidates
        .map((i) => `#${i.number}`)
        .join(', ')}. Put their stories on this board.`,
    );
  }
  const rank = (i: ScoredItem): number[] => [
    LEVELS.indexOf(i.priority),
    i.status === 'In Progress' ? 0 : 1,
    i.blockedBy.length === 0 ? 0 : 1,
    Date.parse(i.createdAt),
    i.number,
  ];
  const sorted = [...workable].sort((a, b) => {
    const rb = rank(b);
    // Both ranks hold the same five entries, so rb[k] is always there.
    for (const [k, value] of rank(a).entries()) {
      const other = rb[k] as number;
      if (value !== other) return value - other;
    }
    return 0;
  });
  return sorted[0] ?? null;
}

/**
 * Each open blocker the board does not hold, for a note beside the answer:
 * its Priority cannot be read, so the inheritance check cannot judge it, and
 * it never stops the pick (operator 2026-10-13).
 */
export function offBoardBlockers(items: NextItem[]): string[] {
  const open = items.filter((i) => i.state === 'OPEN');
  const onBoard = new Set(open.map(key));
  return open.flatMap((waiting) =>
    waiting.blockedBy
      .filter((b) => !onBoard.has(key(b)))
      .map(
        (b) =>
          `${label(b, waiting.repo)} blocks #${waiting.number} (${waiting.priority ?? 'no Priority'}) but is not on this board, so its Priority is not checked`,
      ),
  );
}

export const QUERY = `query($id: ID!, $endCursor: String) {
  node(id: $id) { ... on ProjectV2 { title
    items(first: 100, after: $endCursor) { totalCount pageInfo { hasNextPage endCursor }
      nodes {
        status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
        priority: fieldValueByName(name: "Priority") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
        content { __typename
          ... on DraftIssue { title }
          ... on PullRequest { title }
          ... on Issue { number title state createdAt
            repository { nameWithOwner }
            blockedBy(first: 50) { totalCount
              nodes { number state repository { nameWithOwner } } }
            subIssues(first: 100) { totalCount nodes { state } } }
        } } } } } }`;

interface RawNode {
  status: { name?: string } | null;
  priority: { name?: string } | null;
  content: {
    __typename: string;
    title?: string;
    number?: number;
    state?: 'OPEN' | 'CLOSED';
    createdAt?: string;
    repository?: { nameWithOwner: string };
    blockedBy?: {
      totalCount: number;
      nodes: Array<{
        number: number;
        state: string;
        repository: { nameWithOwner: string };
      }>;
    };
    subIssues?: { totalCount: number; nodes: Array<{ state: string }> };
  } | null;
}

export interface RawPage {
  data: { node: { title: string; items: { nodes: RawNode[] } } };
}

/** The board's issues; anything that is not an issue is refused by name. */
export function parseNextItems(pages: RawPage[]): NextItem[] {
  return pages.flatMap((page) =>
    page.data.node.items.nodes.map((node): NextItem => {
      const c = node.content;
      if (
        c?.__typename !== 'Issue' ||
        c.number === undefined ||
        c.title === undefined ||
        c.state === undefined ||
        c.createdAt === undefined ||
        c.repository === undefined ||
        c.blockedBy === undefined ||
        c.subIssues === undefined
      ) {
        throw new Error(
          `"${c?.title ?? '(no content)'}" is not an issue with a number, title, state, creation time, repository, blockers and sub-issues: convert it, or remove it from the board`,
        );
      }
      // One page each: a list longer than that is refused, not judged in part.
      if (c.blockedBy.totalCount > c.blockedBy.nodes.length) {
        throw new Error(`#${c.number} has ${c.blockedBy.totalCount} blockers and one page read ${c.blockedBy.nodes.length}`);
      }
      if (c.subIssues.totalCount > c.subIssues.nodes.length) {
        throw new Error(`#${c.number} has ${c.subIssues.totalCount} sub-issues and one page read ${c.subIssues.nodes.length}`);
      }
      return {
        repo: c.repository.nameWithOwner,
        number: c.number,
        title: c.title,
        state: c.state,
        createdAt: c.createdAt,
        status: node.status?.name ?? null,
        priority: node.priority?.name ?? null,
        blockedBy: c.blockedBy.nodes.filter((b) => b.state === 'OPEN').map((b) => ({ repo: b.repository.nameWithOwner, number: b.number })),
        openSubIssues: c.subIssues.nodes.filter((n) => n.state === 'OPEN').length,
      };
    }),
  );
}

export function main(args: string[]): number {
  const [id, title] = args;
  if (id === undefined || title === undefined) {
    throw new Error('usage: node scripts/board-next.ts <board-node-id> "<board title>"');
  }
  const out = execFileSync('gh', ['api', 'graphql', '--paginate', '--slurp', '-f', `query=${QUERY}`, '-f', `id=${id}`], {
    encoding: 'utf8',
  });
  const pages = JSON.parse(out) as RawPage[];
  if (assertWholeRead(pages, title) === 0) {
    process.stdout.write(`Next: nothing to pick; ${emptyBoardNote(title)}.\n`);
    return 0;
  }
  const items = parseNextItems(pages);
  for (const note of offBoardBlockers(items)) {
    process.stderr.write(`Note: ${note}.\n`);
  }
  const next = nextTicket(items);
  process.stdout.write(
    next === null
      ? items.some((i) => i.state === 'OPEN' && i.status === PARKED)
        ? `Next: nothing before the release; the rest is in "${PARKED}".\n`
        : 'Next: nothing is open.\n'
      : `Next: #${next.number} ${next.title} (${next.priority}, ${next.status ?? 'no status'}${
          next.blockedBy.length > 0 ? `, blocked by ${next.blockedBy.map((b) => label(b, next.repo)).join(', ')}` : ''
        }).\n`,
  );
  return 0;
}

await runIfEntry(import.meta.url, main);
