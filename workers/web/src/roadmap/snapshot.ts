import { formatLines, progress, type BoardItem } from '../../../../scripts/board-progress.ts';
import { BRINGS } from './brings.ts';

/**
 * What the public roadmap shows (shyden-labs/ShyTalk#38, #321), copying Yawelo Idle's model (yawelo-idle#840, #844,
 * #846, #1068; Shyden 2026-11-23): every epic as one milestone in Priority order, by its `Public title` and `Public
 * summary`, its stories counted but never named, what it brings from brings.ts, and the two progress lines from the
 * same module as the close-out's. Nothing private leaves here: no internal title, label, issue number or estimate.
 */

/** A board item as the roadmap reads it: the close-out's fields plus Priority, parent epic and the public words. */
export type RoadmapItem = BoardItem & {
  priority: string | null;
  parent: number | null;
  publicTitle: string | null;
  publicSummary: string | null;
};

export type MilestoneState = 'done' | 'started' | 'not started';

/** One milestone of the map: an epic by its public words, its stories counted but never named. */
export interface PublicMilestone {
  /** The epic's `Public title` and `Public summary`; null when it has none, and the page then words it itself. */
  name: string | null;
  summary: string | null;
  /** The approved lines saying what it brings (brings.ts); none for an epic the file does not name. */
  brings: string[];
  closed: number;
  total: number;
  /** Closed of total, rounded down; 0 when it has no stories yet. */
  percent: number;
  state: MilestoneState;
}

export interface PublicSnapshot {
  milestones: PublicMilestone[];
  /** By tickets, then by effort, worded as the close-out words them. */
  progress: [string, string];
}

const isEpic = (item: RoadmapItem): boolean => item.title.startsWith('Epic:');
/** A story closed as not planned or a duplicate was never built: the roadmap leaves it out. */
const dropped = (item: RoadmapItem): boolean => item.stateReason === 'NOT_PLANNED' || item.stateReason === 'DUPLICATE';
/** P0 first; no Priority after every prioritised item. */
const rank = (item: RoadmapItem): number => (item.priority === null ? Number.POSITIVE_INFINITY : Number(item.priority.slice(1)));
const byPriority = (a: RoadmapItem, b: RoadmapItem): number => rank(a) - rank(b) || Number(a.number) - Number(b.number);

function milestoneOf(epic: RoadmapItem, items: readonly RoadmapItem[]): PublicMilestone {
  const stories = items.filter((item) => item.parent === epic.number && !isEpic(item) && !dropped(item));
  const closed = stories.filter((story) => story.state === 'CLOSED').length;
  const total = stories.length;
  let state: MilestoneState = 'not started';
  if (epic.state === 'CLOSED') state = 'done';
  else if (closed > 0) state = 'started';
  return {
    name: epic.publicTitle,
    summary: epic.publicSummary,
    brings: BRINGS.en[Number(epic.number)] ?? [],
    closed,
    total,
    percent: total === 0 ? 0 : Math.floor((closed * 100) / total),
    state,
  };
}

/** The public roadmap of a whole board read, on `today` (a UTC date, for the progress lines' pace). */
export function publicSnapshot(items: RoadmapItem[], today: string): PublicSnapshot {
  // A draft card has no issue and is never public (Yawelo Idle's model: only the repository's own issues).
  const issues = items.filter((item) => item.number !== null);
  const milestones = issues
    .filter(isEpic)
    .toSorted(byPriority)
    .map((epic) => milestoneOf(epic, issues));
  return { milestones, progress: formatLines(progress(items, today), today) };
}
