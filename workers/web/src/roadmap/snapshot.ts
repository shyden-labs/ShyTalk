import { formatLines, progress, type BoardItem } from '../../../../scripts/board-progress.ts';

/**
 * What the public roadmap shows (shyden-labs/ShyTalk#38, #321; after Yawelo Idle's lessons yawelo-idle#840, #844,
 * #846): the board's open epics in Priority order, each story by its plain `Public title`, every story without one
 * counted as behind-the-scenes work, and the two progress lines from the same module as the close-out's. Nothing
 * private leaves here: no internal title, label, issue number or estimate.
 */

/** A board item as the roadmap reads it: the close-out's fields plus Priority, parent epic and the public words. */
export type RoadmapItem = BoardItem & {
  priority: string | null;
  parent: number | null;
  publicTitle: string | null;
  publicSummary: string | null;
};

export interface PublicStory {
  title: string;
  done: boolean;
}

export interface PublicEpic {
  /** The epic's `Public summary`; null when it has none, and the page then calls it behind-the-scenes work. */
  summary: string | null;
  stories: PublicStory[];
  behindTheScenes: { open: number; done: number };
}

export interface PublicSnapshot {
  epics: PublicEpic[];
  /** By tickets, then by effort, worded as the close-out words them. */
  progress: [string, string];
}

const isEpic = (item: RoadmapItem): boolean => item.title.startsWith('Epic:');
/** A story closed as not planned or a duplicate was never built: the roadmap leaves it out. */
const dropped = (item: RoadmapItem): boolean => item.stateReason === 'NOT_PLANNED' || item.stateReason === 'DUPLICATE';
/** P0 first; no Priority after every prioritised item. */
const rank = (item: RoadmapItem): number => (item.priority === null ? Number.POSITIVE_INFINITY : Number(item.priority.slice(1)));
const byPriority = (a: RoadmapItem, b: RoadmapItem): number => rank(a) - rank(b) || Number(a.number) - Number(b.number);

function epicOf(epic: RoadmapItem, items: readonly RoadmapItem[]): PublicEpic {
  const stories = items.filter((item) => item.parent === epic.number && !isEpic(item) && !dropped(item));
  const open = stories.filter((story) => story.state === 'OPEN').toSorted(byPriority);
  const done = stories.filter((story) => story.state === 'CLOSED').toSorted(byPriority);
  const titled = (list: RoadmapItem[], isDone: boolean): PublicStory[] =>
    list.flatMap((story) => (story.publicTitle === null ? [] : [{ title: story.publicTitle, done: isDone }]));
  return {
    summary: epic.publicSummary,
    stories: [...titled(open, false), ...titled(done, true)],
    behindTheScenes: {
      open: open.filter((story) => story.publicTitle === null).length,
      done: done.filter((story) => story.publicTitle === null).length,
    },
  };
}

/** The public roadmap of a whole board read, on `today` (a UTC date, for the progress lines' pace). */
export function publicSnapshot(items: RoadmapItem[], today: string): PublicSnapshot {
  // A draft card has no issue and is never public (Yawelo Idle's model: only the repository's own issues).
  const issues = items.filter((item) => item.number !== null);
  const epics = issues
    .filter((item) => isEpic(item) && item.state === 'OPEN')
    .toSorted(byPriority)
    .map((epic) => epicOf(epic, issues));
  return { epics, progress: formatLines(progress(items, today), today) };
}
