/**
 * The roadmap page's drawing and words (shyden-labs/ShyTalk#321 AC3), as Shyden approved them on #319 (23 Nov 2026):
 * the road to launch as one long conversation, each milestone a speech bubble saying hello in another language,
 * filled with a tick once done, outlined with a ring showing how far along while under way, dashed before it starts,
 * and a "typing…" bubble on the line into the first unfinished milestone. Pure and shared: the Worker draws the page
 * with it and the browser redraws a newer board with it. The page's policy refuses style attributes, so the drawing
 * places and colours everything with attributes and classes (site.css).
 */

export type State = 'done' | 'started' | 'not started';

/** One milestone as the public snapshot carries it (workers/web/src/roadmap/snapshot.ts). */
export interface Milestone {
  name: string | null;
  summary: string | null;
  brings: string[];
  closed: number;
  total: number;
  percent: number;
  state: State;
}

/** The page's own lines in the visitor's language (the `roadmap.*` lines of apps/web/src/i18n). */
export interface Words {
  done: string;
  started: string;
  notStarted: string;
  labelDone: string;
  labelStarted: string;
  labelNotStarted: string;
  brings: string;
  close: string;
  bar: string;
  barLabel: string;
  mapLabel: string;
  unnamed: string;
  updated: string;
}

/** The milestones' own lines in the visitor's language, keyed by their English; null on an English page. */
export type Lines = Record<string, string> | null;

/** Each bubble's centre on the 1000 by 440 field: the top row left to right, the bottom row right to left. */
export const SPOTS: readonly (readonly [number, number])[] = [
  [95, 120],
  [255, 95],
  [415, 125],
  [575, 95],
  [735, 125],
  [900, 110],
  [880, 320],
  [705, 345],
  [530, 315],
  [355, 345],
  [175, 320],
];

/** Where the conversation starts, on the left edge. */
const START: readonly [number, number] = [20, 200];

/** The hello in each bubble, in the approved order. */
const HELLO = ['hello', 'halo', 'สวัสดี', 'xin chào', '你好', 'hola', 'bonjour', 'こんにちは', '안녕하세요', 'merhaba', 'olá'];

/** The faint hellos behind the conversation. */
const FAINT = [
  'hello',
  'halo',
  'สวัสดี',
  'xin chào',
  '你好',
  'hola',
  'bonjour',
  'こんにちは',
  '안녕',
  'merhaba',
  'olá',
  'ciao',
  'hallo',
  'salam',
  'привет',
  'jambo',
];

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escapeHtml = (text: string): string => text.replaceAll(/[&<>"']/gu, (char) => ENTITIES[char] ?? char);

/** A line in the visitor's language: its own when the table has one, else the English marked as English. */
export function lineHtml(english: string, lines: Lines): string {
  if (lines === null) return escapeHtml(english);
  const own = lines[english];
  return own === undefined ? `<span lang="en">${escapeHtml(english)}</span>` : escapeHtml(own);
}

/** A line as plain text, for an attribute: the language's own, else the English. */
const lineText = (english: string, lines: Lines): string => lines?.[english] ?? english;

const fill = (template: string, values: Record<string, string | number>): string =>
  template.replaceAll(/\{(\w+)\}/gu, (whole, key: string) => (key in values ? String(values[key]) : whole));

/** A milestone's name, or its number in the page's words when it has none yet. */
const nameOf = (milestone: Milestone, index: number, words: Words): string => milestone.name ?? fill(words.unnamed, { number: index + 1 });

/** Every milestone's stories counted together, rounded down: the one bar. */
export function overallPercent(milestones: readonly Milestone[]): number {
  const closed = milestones.reduce((sum, { closed: each }) => sum + each, 0);
  const total = milestones.reduce((sum, { total: each }) => sum + each, 0);
  return total === 0 ? 0 : Math.floor((closed * 100) / total);
}

/** The first milestone not yet done; -1 when all are. */
export const firstOpen = (milestones: readonly Milestone[]): number => milestones.findIndex(({ state }) => state !== 'done');

/** The milestone's state as its panel says it. */
export function stateLabel(milestone: Milestone, words: Words): string {
  if (milestone.state === 'done') return words.done;
  if (milestone.state === 'started') return fill(words.started, { percent: milestone.percent });
  return words.notStarted;
}

/** The state's one word, as each button's name ends. */
function stateWord(milestone: Milestone, words: Words): string {
  if (milestone.state === 'done') return words.labelDone;
  if (milestone.state === 'started') return words.labelStarted;
  return words.labelNotStarted;
}

/** A tiny steady random sequence, so the faint hellos sit in the same places on every draw. */
function steady(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const RING = 10;
const CIRCUMFERENCE = 2 * Math.PI * RING;
const WIDTH = 104;
const HEIGHT = 58;

/** One bubble: its body and its tail, the tail on alternating sides like two people taking turns. */
function bubblePath(x: number, y: number, left: boolean): string {
  const bx = x - WIDTH / 2;
  const by = y - HEIGHT / 2 - 6;
  const body = `M${String(bx + 16)},${String(by)} h${String(WIDTH - 32)} a16,16 0 0 1 16,16 v${String(HEIGHT - 32)} a16,16 0 0 1 -16,16 h-${String(WIDTH - 32)} a16,16 0 0 1 -16,-16 v-${String(HEIGHT - 32)} a16,16 0 0 1 16,-16z`;
  const tail = left
    ? `M${String(bx + 18)},${String(by + HEIGHT)} l-8,14 l22,-14z`
    : `M${String(bx + WIDTH - 18)},${String(by + HEIGHT)} l8,14 l-22,-14z`;
  return `${body} ${tail}`;
}

function bubble(milestone: Milestone, index: number, words: Words, lines: Lines): string {
  const [x, y] = SPOTS[index] ?? [0, 0];
  const kind = milestone.state === 'not started' ? 'not-started' : milestone.state;
  const by = y - HEIGHT / 2 - 6;
  let drawn = `<path class="bubble ${kind}" d="${bubblePath(x, y, index % 2 === 0)}"/>`;
  drawn += `<text class="hello ${kind}" x="${String(x)}" y="${String(by + HEIGHT / 2 + 6)}" text-anchor="middle">${HELLO[index] ?? ''}</text>`;
  const cx = x + WIDTH / 2 - 4;
  const cy = by + 4;
  if (milestone.state === 'done') {
    drawn += `<circle class="tick-disc" cx="${String(cx)}" cy="${String(cy)}" r="10"/><path class="tick" d="M${String(cx - 5)},${String(cy)} l3.5,3.5 l6.5,-7"/>`;
  } else if (milestone.state === 'started') {
    const along = ((CIRCUMFERENCE * milestone.percent) / 100).toFixed(1);
    drawn += `<circle class="ring-back" cx="${String(cx)}" cy="${String(cy)}" r="${String(RING + 3)}"/>`;
    drawn += `<circle class="ring" cx="${String(cx)}" cy="${String(cy)}" r="${String(RING)}"/>`;
    drawn += `<circle class="ring-done" cx="${String(cx)}" cy="${String(cy)}" r="${String(RING)}" stroke-dasharray="${along} ${CIRCUMFERENCE.toFixed(1)}" transform="rotate(-90 ${String(cx)} ${String(cy)})"/>`;
  }
  const name = lineText(nameOf(milestone, index, words), lines);
  let label = name;
  if (milestone.state === 'done') label += ' ✓';
  else if (milestone.state === 'started') label += ` · ${String(milestone.percent)}%`;
  const labelWidth = Math.max(60, label.length * 7.6 + 16);
  drawn += `<rect class="label" x="${(x - labelWidth / 2).toFixed(1)}" y="${String(y + 42)}" width="${labelWidth.toFixed(1)}" height="22" rx="11"/>`;
  drawn += `<text class="label" x="${String(x)}" y="${String(y + 57)}" text-anchor="middle">${escapeHtml(label)}</text>`;
  return drawn;
}

/** The "typing…" bubble, on the line into the first unfinished milestone, as far along as that milestone is done. */
function typing(milestones: readonly Milestone[]): string {
  const open = firstOpen(milestones);
  const at = open === -1 ? milestones.length - 1 : open;
  const to = SPOTS[at] ?? START;
  const from = open === -1 ? to : at === 0 ? START : (SPOTS[at - 1] ?? START);
  const milestone = milestones[at];
  const along = open === -1 || milestone === undefined ? 1 : Math.min(0.8, Math.max(0.2, milestone.closed / Math.max(1, milestone.total)));
  const x = from[0] + (to[0] - from[0]) * along + (open === -1 ? 70 : 0);
  const y = from[1] + (to[1] - from[1]) * along + 20;
  const dots = [-11, 0, 11].map((dx, n) => `<circle class="dot dot-${String(n)}" cx="${String(dx)}" cy="0" r="4"/>`).join('');
  return `<g class="typing" transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><rect x="-26" y="-14" width="52" height="28" rx="14"/>${dots}</g>`;
}

/** The conversation, hidden from screen readers: the buttons over it carry its words. */
export function mapSvg(milestones: readonly Milestone[], words: Words, lines: Lines): string {
  const shown = milestones.slice(0, SPOTS.length);
  let svg = '<svg viewBox="0 0 1000 440" aria-hidden="true" focusable="false">';
  svg += '<rect class="field" width="1000" height="440"/>';
  const random = steady(7);
  for (let k = 0; k < 30; k += 1) {
    const x = random() * 940 + 30;
    const y = random() * 400 + 25;
    const size = 11 + random() * 6;
    svg += `<text class="faint" x="${x.toFixed(0)}" y="${y.toFixed(0)}" font-size="${size.toFixed(0)}" text-anchor="middle">${FAINT[k % FAINT.length] ?? ''}</text>`;
  }
  const open = firstOpen(shown);
  const legs = [START, ...SPOTS.slice(0, shown.length)];
  for (let k = 1; k < legs.length; k += 1) {
    const [ax, ay] = legs[k - 1] ?? START;
    const [bx, by] = legs[k] ?? START;
    const said = open === -1 || k - 1 < open;
    const bend = (ay + by) / 2 + (k % 2 === 1 ? 26 : -26);
    svg += `<path class="${said ? 'line said' : 'line'}" d="M${String(ax)},${String(ay)} Q${String((ax + bx) / 2)},${String(bend)} ${String(bx)},${String(by)}"/>`;
  }
  svg += shown.map((milestone, index) => bubble(milestone, index, words, lines)).join('');
  if (shown.length > 0) svg += typing(shown);
  return `${svg}</svg>`;
}

/** A button over each bubble, named with the milestone and its state, opening the one panel. */
export function buttonsHtml(milestones: readonly Milestone[], words: Words, lines: Lines): string {
  return milestones
    .slice(0, SPOTS.length)
    .map((milestone, index) => {
      const label = `${lineText(nameOf(milestone, index, words), lines)}, ${stateWord(milestone, words)}`;
      return `<button type="button" class="spot spot-${String(index)}" data-index="${String(index)}" aria-label="${escapeHtml(label)}" aria-expanded="false" aria-controls="roadmap-panel"></button>`;
    })
    .join('');
}

/** The panel a milestone's button opens: its name, state, summary and what it brings, with a Close button. */
export function panelHtml(milestone: Milestone, index: number, words: Words, lines: Lines): string {
  let html = `<h3>${lineHtml(nameOf(milestone, index, words), milestone.name === null ? null : lines)}</h3>`;
  html += `<p class="state">${escapeHtml(stateLabel(milestone, words))}</p>`;
  if (milestone.summary !== null) html += `<p>${lineHtml(milestone.summary, lines)}</p>`;
  if (milestone.brings.length > 0) {
    html += `<h4>${escapeHtml(words.brings)}</h4><ul>${milestone.brings.map((line) => `<li>${lineHtml(line, lines)}</li>`).join('')}</ul>`;
  }
  return `${html}<button type="button" class="close">${escapeHtml(words.close)}</button>`;
}

/** The locales whose short zone names are tried, in order, before an offset (measured in Node, 25 Nov 2026). */
const ZONE_LOCALES = ['en-ID', 'en-US', 'en-AU', 'en-IN', 'en-GB'];

const shortZone = (locale: string, at: Date, zone: string | undefined): string =>
  new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' }).formatToParts(at).find(({ type }) => type === 'timeZoneName')
    ?.value ?? '';

/** The zone's own short name (WIB, EST, AEDT, IST, GMT, UTC), else its offset (GMT+7). */
export function zoneName(at: Date, zone?: string): string {
  const named = ZONE_LOCALES.map((locale) => shortZone(locale, at, zone)).find((name) => name !== '' && !/^GMT[+-]/u.test(name));
  return named ?? shortZone('en-GB', at, zone);
}

/** The read time, "Last updated {date}, {time} {zone}", in the page's language and the given zone. */
export function updatedLine(readAt: string, words: Words, locale: string, zone?: string): string {
  const at = new Date(readAt);
  const tag = locale === 'en' ? 'en-GB' : locale;
  const date = new Intl.DateTimeFormat(tag, { timeZone: zone, day: 'numeric', month: 'long', year: 'numeric' }).format(at);
  const time = new Intl.DateTimeFormat(tag, { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
  return fill(words.updated, { date, time, zone: zoneName(at, zone) });
}

/** Only a later read replaces the one shown. */
export const isNewer = (shown: { version: number }, next: { version: number }): boolean => next.version > shown.version;

/** How long to wait before reconnecting: a second, doubling each try, never over a minute. */
export const reconnectDelay = (attempt: number): number => Math.min(1000 * 2 ** attempt, 60_000);
