/**
 * What the roadmap page's smoke and its iPhone copy share (shyden-labs/ShyTalk#321 AC3): the words they expect,
 * worded from the page's own lines, and the signed GitHub delivery that asks the roadmap to read the board afresh.
 */
import { createHmac } from 'node:crypto';
import { t, type Locale } from '../../apps/web/src/i18n/t.ts';

/** ShyTalk Stories, whose card events start a read (workers/web/src/roadmap/hook-route.ts). */
export const BOARD_ID = 'PVT_kwDOEOcG584BpkXr';

/** The approved map has one bubble per milestone: eleven (shyden-labs/ShyTalk#319). */
export const MILESTONES = 11;

const escaped = (text: string): string => text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

/** A page line with its `{placeholders}` matching anything, as a whole-text pattern. */
export function linePattern(locale: Locale, key: string): RegExp {
  return new RegExp(`^${escaped(t(locale, key)).replaceAll(/\\\{\w+\\\}/gu, '.+')}$`, 'u');
}

/** The three ways a milestone's button ends its name, in the page's language. */
export const stateEndings = (locale: Locale): string[] =>
  ['roadmap.labelDone', 'roadmap.labelStarted', 'roadmap.labelNotStarted'].map((key) => `, ${t(locale, key)}`);

/** A `projects_v2_item` delivery for ShyTalk's board, signed as GitHub signs it, with its headers. */
export function boardDelivery(secret: string): { body: string; headers: Record<string, string> } {
  const body = JSON.stringify({ action: 'edited', projects_v2_item: { project_node_id: BOARD_ID } });
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'projects_v2_item',
      'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    },
  };
}

/** What the iPhone copy reads in the page, where Playwright's locators read it on the other browsers. */
export interface RoadmapFacts {
  labels: string[];
  readAt: string;
  /** The browser's own time zone, which the page words the read time in. */
  zone: string;
  fits: boolean;
  version: number;
  socket: string | null;
  /** Set by MARK_PAGE: still true means the page was not reloaded since. */
  marked: boolean;
}

export const ROADMAP_FACTS = `() => {
  const live = document.querySelector('#roadmap-live');
  const updated = document.querySelector('#roadmap-updated');
  return {
    labels: [...document.querySelectorAll('.map button.spot')].map((button) => button.getAttribute('aria-label') ?? ''),
    readAt: updated === null ? '' : (updated.getAttribute('data-read-at') ?? ''),
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    fits: document.documentElement.scrollWidth <= window.innerWidth,
    version: live === null ? -1 : Number(live.getAttribute('data-version')),
    socket: live === null ? null : live.getAttribute('data-socket'),
    marked: window.roadmapMarked === true,
  };
}`;

export const MARK_PAGE = `() => { window.roadmapMarked = true; }`;
