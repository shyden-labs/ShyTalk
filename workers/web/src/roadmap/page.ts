/**
 * The roadmap page (shyden-labs/ShyTalk#321 AC3), as Yawelo Idle serves its own but with the board already in it:
 * `/roadmap` and `/{locale}/roadmap` answer the built page with the Durable Object's latest snapshot drawn into the
 * places Roadmap.astro marks, so a visitor sees the board at once and never a loading line. A visit finding the last
 * read over 10 minutes old has the object start one background read (object.ts); the page's own script then swaps in
 * each newer read live. With no snapshot to give, or one that cannot be read, the page answers as built: its heading
 * and words, no map and no error, as a failed read is never shown to visitors (Shyden 2026-11-23). Done as plain string
 * work, not HTMLRewriter, so the unit tests run it in Node.
 */
import {
  buttonsHtml,
  escapeHtml,
  fill,
  mapSvg,
  overallPercent,
  updatedLine,
  type Lines,
  type Milestone,
  type Words,
} from '../../../../apps/web/src/roadmap/view.ts';
import { milestoneLines, pageWords } from '../../../../apps/web/src/roadmap/words.ts';
import type { Locale } from '../../../../apps/web/src/i18n/t.ts';
import type { RoadmapNamespace } from './hook-route.ts';

/** The places Roadmap.astro leaves for the board. */
export const MARKS = {
  map: '<!--roadmap:map-->',
  bar: '<!--roadmap:bar-->',
  updated: '<!--roadmap:updated-->',
  snapshot: '<!--roadmap:snapshot-->',
} as const;

const ROADMAP_PATH = /^(?:\/(id|th|vi|zh))?\/roadmap\/?$/u;

/** The language whose roadmap page `pathname` asks for, or null when it is not one. */
export function roadmapLocale(pathname: string): Locale | null {
  const match = ROADMAP_PATH.exec(pathname);
  if (match === null) return null;
  return (match[1] ?? 'en') as Locale;
}

/** What the page draws, and hands its script: the milestones, the read's version and when it was read. */
export interface ShownBoard {
  milestones: Milestone[];
  version: number;
  readAt: string;
}

/** JSON safe inside a script element: no `<` can close it. */
const scriptJson = (value: unknown): string => JSON.stringify(value).replaceAll('<', String.raw`\u003c`);

/** The built page with `board` drawn into its marks; the marks simply removed when there is no board. */
export function fillPage(html: string, board: ShownBoard | null, locale: string, words: Words, lines: Lines): string {
  if (board === null) return Object.values(MARKS).reduce((page, mark) => page.replace(mark, ''), html);
  const { milestones, version, readAt } = board;
  const percent = overallPercent(milestones);
  const map =
    `<div id="roadmap-live" data-version="${String(version)}" role="group" aria-label="${escapeHtml(fill(words.mapLabel, { count: milestones.length }))}"><div class="map">${mapSvg(milestones, words, lines)}${buttonsHtml(milestones, words, lines)}</div>` +
    '<div id="roadmap-panel" class="panel" hidden></div></div>';
  const bar =
    `<svg class="bar" viewBox="0 0 100 4" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(fill(words.barLabel, { percent }))}">` +
    `<rect class="bar-track" width="100" height="4"/><rect class="bar-done" width="${String(percent)}" height="4"/></svg>` +
    `<p class="bar-words">${escapeHtml(fill(words.bar, { percent }))}</p>`;
  // Worded in UTC here; the page's script rewords it in the visitor's own zone as it loads.
  const updated = `<p id="roadmap-updated" class="updated" data-read-at="${escapeHtml(readAt)}">${escapeHtml(updatedLine(readAt, words, locale, 'UTC'))}</p>`;
  const snapshot = `<script type="application/json" id="roadmap-snapshot">${scriptJson({ milestones, version, readAt })}</script>`;
  return html.replace(MARKS.map, map).replace(MARKS.bar, bar).replace(MARKS.updated, updated).replace(MARKS.snapshot, snapshot);
}

/** The object's latest board, or null when it has none or answers what is not one. */
async function latestBoard(env: { ROADMAP?: RoadmapNamespace }): Promise<ShownBoard | null> {
  if (!env.ROADMAP) return null;
  try {
    const answer = await env.ROADMAP.get(env.ROADMAP.idFromName('roadmap') as never).fetch(new Request('https://roadmap/snapshot'));
    if (!answer.ok) return null;
    const read = (await answer.json()) as Partial<ShownBoard>;
    if (!Array.isArray(read.milestones) || typeof read.version !== 'number' || typeof read.readAt !== 'string') return null;
    return { milestones: read.milestones, version: read.version, readAt: read.readAt };
  } catch {
    // An object that cannot be reached, or answers what is not JSON: the page answers as built.
    return null;
  }
}

/** The roadmap page in `locale`: the built page, with the latest board drawn in, never cached. */
export async function serveRoadmapPage(
  request: Request,
  env: { ASSETS: { fetch(request: Request): Promise<Response> }; ROADMAP?: RoadmapNamespace },
  locale: Locale,
): Promise<Response> {
  const built = await env.ASSETS.fetch(request);
  if (!built.ok) return built;
  const page = fillPage(await built.text(), await latestBoard(env), locale, pageWords(locale), milestoneLines(locale));
  return new Response(page, {
    status: 200,
    headers: { 'content-type': built.headers.get('content-type') ?? 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
