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

/** One bubble's place: its centre on the 1000 by 440 field, and the hello it says. */
export interface Spot {
  x: number;
  y: number;
  hello: string;
}

/** Each bubble's place, the top row left to right, the bottom row right to left, its hello in the approved order. */
export const SPOTS: readonly Spot[] = [
  { x: 95, y: 120, hello: 'hello' },
  { x: 255, y: 95, hello: 'halo' },
  { x: 415, y: 125, hello: 'สวัสดี' },
  { x: 575, y: 95, hello: 'xin chào' },
  { x: 735, y: 125, hello: '你好' },
  { x: 900, y: 110, hello: 'hola' },
  { x: 880, y: 320, hello: 'bonjour' },
  { x: 705, y: 345, hello: 'こんにちは' },
  { x: 530, y: 315, hello: '안녕하세요' },
  { x: 355, y: 345, hello: 'merhaba' },
  { x: 175, y: 320, hello: 'olá' },
];

/** Where the conversation starts, on the left edge. */
const START: readonly [number, number] = [20, 200];

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

export const escapeHtml = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

/** A line in the visitor's language: its own when the table has one, else the English marked as English. */
export function lineHtml(english: string, lines: Lines): string {
  if (lines === null) return escapeHtml(english);
  const own = lines[english];
  return own === undefined ? `<span lang="en">${escapeHtml(english)}</span>` : escapeHtml(own);
}

/** A line as plain text, for an attribute: the language's own, else the English. */
const lineText = (english: string, lines: Lines): string => lines?.[english] ?? english;

/** A template's `{key}` places filled from `values`; a place it has no value for stays as written. */
export const fill = (template: string, values: Record<string, string | number>): string =>
  template.replaceAll(/\{(\w+)\}/gu, (whole, key: string) => (key in values ? String(values[key]) : whole));

/** A milestone's name, or its number in the page's words when it has none yet. */
const nameOf = (milestone: Milestone, index: number, words: Words): string => milestone.name ?? fill(words.unnamed, { number: index + 1 });

/** Every milestone's stories counted together, rounded down: the one bar. */
export function overallPercent(milestones: readonly Milestone[]): number {
  const closed = milestones.reduce((sum, { closed: each }) => sum + each, 0);
  const total = milestones.reduce((sum, { total: each }) => sum + each, 0);
  return total === 0 ? 0 : Math.floor((closed * 100) / total);
}

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

/** A milestone with a spot on the field, and where the line into it starts: the left edge, or the bubble before. */
interface Stop {
  milestone: Milestone;
  index: number;
  spot: Spot;
  from: readonly [number, number];
}

/** The milestones that have a spot, each with its line's start; any past the last spot are not drawn. */
function stops(milestones: readonly Milestone[]): Stop[] {
  return milestones.flatMap((milestone, index) => {
    const spot = SPOTS[index];
    if (spot === undefined) return [];
    const before = SPOTS[index - 1];
    return [{ milestone, index, spot, from: before === undefined ? START : ([before.x, before.y] as const) }];
  });
}

function bubble({ milestone, index, spot }: Stop, words: Words, lines: Lines): string {
  const { x, y } = spot;
  const kind = milestone.state === 'not started' ? 'not-started' : milestone.state;
  const by = y - HEIGHT / 2 - 6;
  let drawn = `<path class="bubble ${kind}" d="${bubblePath(x, y, index % 2 === 0)}"/>`;
  drawn += `<text class="hello ${kind}" x="${String(x)}" y="${String(by + HEIGHT / 2 + 6)}" text-anchor="middle">${spot.hello}</text>`;
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
  const label = labelOf(milestone, index, words, lines);
  const labelWidth = labelWidthOf(label);
  drawn += `<rect class="label" x="${(x - labelWidth / 2).toFixed(1)}" y="${String(y + 42)}" width="${labelWidth.toFixed(1)}" height="22" rx="11"/>`;
  drawn += `<text class="label" x="${String(x)}" y="${String(y + 57)}" text-anchor="middle">${escapeHtml(label)}</text>`;
  return drawn;
}

/** A bubble's label: its name, a tick when done, its percent under way. */
function labelOf(milestone: Milestone, index: number, words: Words, lines: Lines): string {
  const name = lineText(nameOf(milestone, index, words), lines);
  if (milestone.state === 'done') return `${name} ✓`;
  if (milestone.state === 'started') return `${name} · ${String(milestone.percent)}%`;
  return name;
}

const labelWidthOf = (label: string): number => Math.max(60, label.length * 7.6 + 16);

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** What the typing bubble and the faint hellos keep clear of: each bubble with its tail, and each label, with a gap (#362, #364). */
/** The clear space kept around each bubble and label: Firefox's boxes take in half of each outline (shyden-labs/ShyTalk#364). */
const GAP = 4;

function taken(shown: readonly Stop[], words: Words, lines: Lines): Box[] {
  return shown.flatMap(({ milestone, index, spot: { x, y } }) => {
    const top = y - HEIGHT / 2 - 6;
    // An under-way label at its widest (100%), so the clear space is the same at every stage and the typing bubble
    // never steps back along its line as the label grows.
    const widest = milestone.state === 'started' ? { ...milestone, percent: 100 } : milestone;
    const half = labelWidthOf(labelOf(widest, index, words, lines)) / 2;
    return [
      { left: x - WIDTH / 2 - GAP, top: top - GAP, right: x + WIDTH / 2 + GAP, bottom: top + HEIGHT + 14 + GAP },
      { left: x - half - GAP, top: y + 42 - GAP, right: x + half + GAP, bottom: y + 64 + GAP },
    ];
  });
}

const PILL_HALF_WIDTH = 26;
const PILL_HALF_HEIGHT = 14;
/** How far beside the line the typing bubble may sit, nearest first: just below it, on it, then further off. */
const BELOW = 20;
const BESIDE = [BELOW, 0, -BELOW, 2 * BELOW, -2 * BELOW, 3 * BELOW, -3 * BELOW];
const STEPS = 50;

const clear = (x: number, y: number, boxes: readonly Box[]): boolean =>
  x - PILL_HALF_WIDTH >= 0 &&
  x + PILL_HALF_WIDTH <= 1000 &&
  y - PILL_HALF_HEIGHT >= 0 &&
  y + PILL_HALF_HEIGHT <= 440 &&
  boxes.every(
    (box) =>
      x + PILL_HALF_WIDTH <= box.left ||
      x - PILL_HALF_WIDTH >= box.right ||
      y + PILL_HALF_HEIGHT <= box.top ||
      y - PILL_HALF_HEIGHT >= box.bottom,
  );

/**
 * The "typing…" bubble: on or beside the line into the first unfinished milestone, as far along it as that milestone
 * is done; past the last bubble when every milestone is done. It takes the clear place nearest that point, never
 * covering a bubble or a label (shyden-labs/ShyTalk#362, Shyden saw it over "Groundwork · 77%").
 */
/**
 * Where the typing bubble sits on or beside the line from `from` to `to`: the clear place nearest `wanted` of the way
 * along; just below that point if nothing is clear.
 */
export function typingPlace(
  from: readonly [number, number],
  to: readonly [number, number],
  wanted: number,
  boxes: readonly Box[],
): readonly [number, number] {
  const [fx, fy] = from;
  const [tx, ty] = to;
  // Beside means across the line: the unit normal, turned to point down the field (right, on a line that runs
  // straight up or down), so a positive step is below a level line and never along a steep one.
  const length = Math.hypot(tx - fx, ty - fy);
  let [nx, ny] = [-(ty - fy) / length, (tx - fx) / length];
  if (ny < 0 || (ny === 0 && nx < 0)) [nx, ny] = [-nx, -ny];
  let best: { x: number; y: number; cost: number } | undefined;
  for (let step = 0; step <= STEPS; step += 1) {
    const along = step / STEPS;
    BESIDE.forEach((beside, rank) => {
      const x = fx + (tx - fx) * along + nx * beside;
      const y = fy + (ty - fy) * along + ny * beside;
      const cost = Math.abs(along - wanted) + rank / 1000;
      if (clear(x, y, boxes) && (best === undefined || cost < best.cost)) best = { x, y, cost };
    });
  }
  return best === undefined ? [fx + (tx - fx) * wanted + nx * BELOW, fy + (ty - fy) * wanted + ny * BELOW] : [best.x, best.y];
}

function typing({ milestone, spot, from }: Stop, finished: boolean, boxes: readonly Box[]): string {
  const [x, y] = finished
    ? typingPlace([spot.x, spot.y], [spot.x + 200, spot.y], 0.5, boxes)
    : typingPlace(from, [spot.x, spot.y], milestone.closed / Math.max(1, milestone.total), boxes);
  const dots = [-11, 0, 11].map((dx, n) => `<circle class="dot dot-${String(n)}" cx="${String(dx)}" cy="0" r="4"/>`).join('');
  return `<g class="typing" transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><rect x="-26" y="-14" width="52" height="28" rx="14"/>${dots}</g>`;
}

const FAINT_TRIES = 40;
const segmenter = new Intl.Segmenter();

/**
 * A faint hello, drawn at the first of its steady random spots whose box touches no bubble and no label
 * (shyden-labs/ShyTalk#364: "hallo" sat inside 你好) and no faint word already drawn, whose box it then adds to `boxes`
 * (#371); left out, as nothing, when no spot is clear. Its box is as large
 * as Firefox draws it, the largest of the three engines, rounded as it is drawn.
 */
export function faintText(word: string, random: () => number, boxes: Box[]): string {
  const letters = [...segmenter.segment(word)].length;
  for (let tries = 0; tries < FAINT_TRIES; tries += 1) {
    const x = Math.round(random() * 940 + 30);
    const y = Math.round(random() * 400 + 25);
    const size = Math.round(11 + random() * 6);
    // Measured 2026-11-26 in the drawing with the site's font (#371): Firefox draws a faint word up to 1.28 sizes above
    // its baseline and 0.50 below, and up to 0.54 of a size wider than a size per letter; Chromium and WebKit draw
    // smaller. This box holds all three.
    const half = ((letters + 0.6) * size) / 2;
    const box = { left: x - half, top: y - size * 1.3, right: x + half, bottom: y + size * 0.55 };
    if (boxes.every((other) => box.right <= other.left || box.left >= other.right || box.bottom <= other.top || box.top >= other.bottom)) {
      // Taken from here on, with the same gap, so the next faint word never piles on this one (shyden-labs/ShyTalk#371).
      boxes.push({ left: box.left - GAP, top: box.top - GAP, right: box.right + GAP, bottom: box.bottom + GAP });
      return `<text class="faint" x="${String(x)}" y="${String(y)}" font-size="${String(size)}" text-anchor="middle">${word}</text>`;
    }
  }
  return '';
}

/** The conversation, hidden from screen readers: the buttons over it carry its words. */
export function mapSvg(milestones: readonly Milestone[], words: Words, lines: Lines): string {
  const shown = stops(milestones);
  let svg = '<svg viewBox="0 0 1000 440" aria-hidden="true" focusable="false">';
  svg += '<rect class="field" width="1000" height="440"/>';
  const boxes = taken(shown, words, lines);
  const random = steady(7);
  const faintClear = [...boxes];
  for (const word of [...FAINT, ...FAINT].slice(0, 30)) svg += faintText(word, random, faintClear);
  const next = shown.find(({ milestone }) => milestone.state !== 'done');
  const openAt = next?.index ?? shown.length;
  for (const { index, spot, from } of shown) {
    const [ax, ay] = from;
    const said = index < openAt;
    const bend = (ay + spot.y) / 2 + (index % 2 === 0 ? 26 : -26);
    svg += `<path class="${said ? 'line said' : 'line'}" d="M${String(ax)},${String(ay)} Q${String((ax + spot.x) / 2)},${String(bend)} ${String(spot.x)},${String(spot.y)}"/>`;
  }
  svg += shown.map((stop) => bubble(stop, words, lines)).join('');
  const last = shown.at(-1);
  if (last !== undefined) svg += typing(next ?? last, next === undefined, boxes);
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
  let html = `<h2>${lineHtml(nameOf(milestone, index, words), milestone.name === null ? null : lines)}</h2>`;
  html += `<p class="state">${escapeHtml(stateLabel(milestone, words))}</p>`;
  if (milestone.summary !== null) html += `<p>${lineHtml(milestone.summary, lines)}</p>`;
  if (milestone.brings.length > 0) {
    const items = milestone.brings.map((line) => `<li>${lineHtml(line, lines)}</li>`).join('');
    html += `<h3>${escapeHtml(words.brings)}</h3><ul>${items}</ul>`;
  }
  return `${html}<button type="button" class="close">${escapeHtml(words.close)}</button>`;
}

/** The locales whose short zone names are tried, in order, before an offset (measured in Node, 25 Nov 2026). */
const ZONE_LOCALES = ['en-ID', 'en-US', 'en-AU', 'en-IN', 'en-GB'];

const shortZone = (locale: string, at: Date, zone: string | undefined): string =>
  new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' })
    .formatToParts(at)
    .filter(({ type }) => type === 'timeZoneName')
    .map(({ value }) => value)
    .join('');

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
