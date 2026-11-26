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

/** The roadmap's drawing as one colour mode shows it (shyden-labs/ShyTalk#362, #364). Each list is empty when all is well. */
export interface RoadmapDrawing {
  /** The colour mode the page is in: `light` or `dark`. */
  scheme: string;
  /** A faint word or the typing bubble over a bubble or a label, named as `<what> over <what>`. */
  covered: string[];
  /** A bubble whose fill lets what lies under it show through, named by its hello. */
  seeThrough: string[];
  /** A hello or label under 4.5:1 against its own bubble or pill, named with its ratio. */
  lowContrast: string[];
}

/**
 * Reads the drawing as drawn, in screen boxes and computed colours: what lies over a bubble or a label, what a bubble
 * lets show through, and each hello's and label's contrast against its own background (global rule, 2026-11-25:
 * every design change proven in light and dark mode).
 */
export const ROADMAP_DRAWING = `() => {
  const svg = document.querySelector('#roadmap-live svg');
  const all = (selector) => (svg === null ? [] : [...svg.querySelectorAll(selector)]);
  const box = (element) => element.getBoundingClientRect();
  const touches = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const words = (element) => (element === null ? '' : (element.textContent ?? '').trim());
  const name = (element) => {
    if (element.matches('path.bubble')) return 'bubble "' + words(element.nextElementSibling) + '"';
    if (element.matches('rect.label')) return 'label "' + words(element.nextElementSibling) + '"';
    if (element.matches('g.typing')) return 'typing bubble';
    return 'faint "' + words(element) + '"';
  };
  const held = all('path.bubble, rect.label');
  const faint = all('text.faint');
  const covered = [
    ...all('text.faint, g.typing').flatMap((over) =>
      held.filter((under) => touches(box(over), box(under))).map((under) => name(over) + ' over ' + name(under)),
    ),
    // No faint word piles on another (shyden-labs/ShyTalk#371).
    ...faint.flatMap((one, i) =>
      faint.slice(i + 1).filter((other) => touches(box(one), box(other))).map((other) => name(one) + ' over ' + name(other)),
    ),
  ];
  const seeThrough = all('path.bubble')
    .filter((bubble) => Number(getComputedStyle(bubble).fillOpacity) < 1)
    .map((bubble) => words(bubble.nextElementSibling));
  const channels = (colour) => (colour.match(/[\\d.]+/g) ?? []).slice(0, 3).map(Number);
  const luminance = (colour) => {
    const [r, g, b] = channels(colour).map((value) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  };
  const pairs = [
    ...all('path.bubble').map((bubble) => [bubble.nextElementSibling, bubble]),
    ...all('rect.label').map((pill) => [pill.nextElementSibling, pill]),
  ];
  const lowContrast = pairs.flatMap(([text, back]) => {
    if (text === null) return ['no text after ' + name(back)];
    const found = ratio(getComputedStyle(text).fill, getComputedStyle(back).fill);
    return found < 4.5 ? ['"' + words(text) + '" ' + found.toFixed(2) + ':1'] : [];
  });
  return {
    scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    covered,
    seeThrough,
    lowContrast,
  };
}`;

export const MARK_PAGE = `() => { window.roadmapMarked = true; }`;
