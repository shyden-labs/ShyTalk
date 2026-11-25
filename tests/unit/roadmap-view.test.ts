import { describe, it, expect } from 'vitest';
import {
  SPOTS,
  buttonsHtml,
  escapeHtml,
  isNewer,
  lineHtml,
  mapSvg,
  overallPercent,
  panelHtml,
  reconnectDelay,
  stateLabel,
  typingPlace,
  updatedLine,
  zoneName,
  type Milestone,
  type Words,
} from '../../apps/web/src/roadmap/view.ts';

/**
 * The roadmap page's drawing and words (shyden-labs/ShyTalk#321 AC3), as Shyden approved them on #319: a conversation
 * of hello bubbles, done filled with a tick, under way outlined with a % ring, not started dashed, a "typing…" bubble
 * on the line into the first unfinished milestone, one bar, and "Last updated {date}, {time} {zone}". Pure, so the
 * Worker draws the page with it and the browser redraws a newer board with it.
 */

const WORDS: Words = {
  done: 'Done',
  started: 'Under way, {percent}% done',
  notStarted: 'Not started yet',
  labelDone: 'done',
  labelStarted: 'under way',
  labelNotStarted: 'not started',
  brings: 'What this brings',
  close: 'Close',
  bar: '{percent}% of the work to launch is done',
  barLabel: '{percent} percent done',
  mapLabel: "ShyTalk's road to launch drawn as a conversation of {count} speech bubbles",
  unnamed: 'Milestone {number}',
  updated: 'Last updated {date}, {time} {zone}',
};

const milestone = (over: Partial<Milestone> = {}): Milestone => ({
  name: 'Groundwork',
  summary: 'The workshop and safety checks everything is built with.',
  brings: ['Behind the scenes: the tools everything else is built on'],
  closed: 16,
  total: 18,
  percent: 88,
  state: 'started',
  ...over,
});

const done = milestone({ name: 'The website', closed: 20, total: 20, percent: 100, state: 'done' });
const notStarted = milestone({ name: 'Voice rooms', closed: 0, total: 1, percent: 0, state: 'not started' });

describe('escapeHtml', () => {
  it('escapes the five characters that could open markup or end an attribute', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });
});

describe('lineHtml', () => {
  it('writes an English page’s line as it is, escaped', () => {
    expect(lineHtml('Chat & talk', null)).toBe('Chat &amp; talk');
  });

  it('writes the language’s own line when the table has one', () => {
    expect(lineHtml('Live voice rooms', { 'Live voice rooms': 'Ruang suara langsung' })).toBe('Ruang suara langsung');
  });

  it('marks an English line the table lacks as English, so a screen reader says it in English', () => {
    expect(lineHtml('New <line>', { 'Live voice rooms': 'Ruang suara langsung' })).toBe('<span lang="en">New &lt;line&gt;</span>');
  });
});

describe('overallPercent', () => {
  it('counts every milestone’s stories together, rounded down', () => {
    expect(overallPercent([milestone({ closed: 1, total: 3 }), milestone({ closed: 1, total: 3 })])).toBe(33);
  });

  it('is 0 with no stories at all', () => {
    expect(overallPercent([milestone({ closed: 0, total: 0 })])).toBe(0);
    expect(overallPercent([])).toBe(0);
  });
});

describe('stateLabel', () => {
  it('names each state in the page’s words, with the percent under way', () => {
    expect(stateLabel(done, WORDS)).toBe('Done');
    expect(stateLabel(milestone(), WORDS)).toBe('Under way, 88% done');
    expect(stateLabel(notStarted, WORDS)).toBe('Not started yet');
  });
});

describe('mapSvg', () => {
  const svg = mapSvg([done, milestone(), notStarted], WORDS, null);

  it('is one hidden drawing on the approved 1000 by 440 field, its buttons carrying the words', () => {
    expect(svg.startsWith('<svg viewBox="0 0 1000 440" aria-hidden="true"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('draws a done bubble filled with its tick, an under-way one outlined with its ring, a not-started one dashed', () => {
    expect(svg.match(/class="bubble done"/g)).toHaveLength(1);
    expect(svg.match(/class="tick"/g)).toHaveLength(1);
    expect(svg.match(/class="bubble started"/g)).toHaveLength(1);
    expect(svg.match(/class="ring-done"/g)).toHaveLength(1);
    expect(svg.match(/class="bubble not-started"/g)).toHaveLength(1);
  });

  it('fills the under-way ring as far as the milestone is done', () => {
    const circumference = 2 * Math.PI * 10;
    expect(svg).toContain(`stroke-dasharray="${((circumference * 88) / 100).toFixed(1)} ${circumference.toFixed(1)}"`);
  });

  it('says hello in another language in each bubble, in the approved order', () => {
    expect(svg).toContain('>hello</text>');
    expect(svg).toContain('>halo</text>');
    expect(svg).toContain('>สวัสดี</text>');
  });

  it('labels each bubble with its name, a tick when done, and its percent under way', () => {
    expect(svg).toContain('>The website ✓</text>');
    expect(svg).toContain('>Groundwork · 88%</text>');
    expect(svg).toContain('>Voice rooms</text>');
  });

  it('puts the typing bubble on the line into the first unfinished milestone', () => {
    expect(svg.match(/class="typing"/g)).toHaveLength(1);
    expect(svg.match(/class="dot dot-\d"/g)).toHaveLength(3);
  });

  it('writes no style attribute, which the page’s policy would refuse', () => {
    expect(svg).toContain('<path');
    expect(svg).not.toMatch(/\sstyle=/);
  });

  it('escapes a name, and words an unnamed milestone by its number', () => {
    const drawn = mapSvg([milestone({ name: '<b>' }), milestone({ name: null })], WORDS, null);
    expect(drawn).toContain('&lt;b&gt; · 88%');
    expect(drawn).toContain('>Milestone 2 · 88%</text>');
  });

  it('labels a name in the visitor’s language from the table', () => {
    expect(mapSvg([notStarted], WORDS, { 'Voice rooms': 'Ruang suara' })).toContain('>Ruang suara</text>');
  });

  it('marks each line said up to the first unfinished milestone, and none after it', () => {
    expect(mapSvg([done, notStarted, done], WORDS, null).match(/class="line[^"]*"/g)).toEqual([
      'class="line said"',
      'class="line"',
      'class="line"',
    ]);
  });

  it('marks every line said and puts the typing bubble past the last bubble when every milestone is done', () => {
    const drawn = mapSvg([done, done], WORDS, null);
    expect(drawn.match(/class="line[^"]*"/g)).toEqual(['class="line said"', 'class="line said"']);
    // The second bubble sits at 255,95 and ends at 307: the typing bubble's pill (52 wide) starts past it, on or beside
    // its row (shyden-labs/ShyTalk#362: 70 past and 20 below had it over the bubble's edge).
    const at = /class="typing" transform="translate\((-?[\d.]+),(-?[\d.]+)\)"/.exec(drawn);
    expect(Number(at?.[1]) - 26).toBeGreaterThanOrEqual(307);
    expect(Math.abs(Number(at?.[2]) - 95)).toBeLessThanOrEqual(40);
  });

  it('draws an empty board as the field alone, with no bubble, line or typing bubble', () => {
    const drawn = mapSvg([], WORDS, null);
    expect(drawn).toContain('class="field"');
    expect(drawn).not.toMatch(/class="(bubble|line|typing)/);
  });

  it('leaves a placeholder its words do not know as written', () => {
    expect(mapSvg([milestone({ name: null })], { ...WORDS, unnamed: 'Milestone {number} of {all}' }, null)).toContain(
      '>Milestone 1 of {all} · 88%</text>',
    );
  });

  it('draws only as many bubbles as it has spots', () => {
    const many = Array.from({ length: SPOTS.length + 2 }, () => notStarted);
    expect(mapSvg(many, WORDS, null).match(/class="bubble /g)).toHaveLength(SPOTS.length);
  });
});

describe('buttonsHtml', () => {
  const html = buttonsHtml([done, notStarted], WORDS, null);

  it('gives each milestone a button placed on its bubble, named with its state, opening the one panel', () => {
    expect(html).toBe(
      '<button type="button" class="spot spot-0" data-index="0" aria-label="The website, done" aria-expanded="false" aria-controls="roadmap-panel"></button>' +
        '<button type="button" class="spot spot-1" data-index="1" aria-label="Voice rooms, not started" aria-expanded="false" aria-controls="roadmap-panel"></button>',
    );
  });

  it('names an under-way milestone so, and escapes the label', () => {
    expect(buttonsHtml([milestone({ name: '"Q"' })], WORDS, null)).toContain('aria-label="&quot;Q&quot;, under way"');
  });
});

describe('panelHtml', () => {
  it('shows the name, the state, the summary and what it brings, with a Close button', () => {
    expect(panelHtml(milestone(), 0, WORDS, null)).toBe(
      '<h2>Groundwork</h2><p class="state">Under way, 88% done</p><p>The workshop and safety checks everything is built with.</p>' +
        '<h3>What this brings</h3><ul><li>Behind the scenes: the tools everything else is built on</li></ul>' +
        '<button type="button" class="close">Close</button>',
    );
  });

  it('leaves out a summary and a list it does not have', () => {
    const html = panelHtml(milestone({ summary: null, brings: [] }), 3, WORDS, null);
    expect(html).not.toContain('What this brings');
    expect(html).toBe('<h2>Groundwork</h2><p class="state">Under way, 88% done</p><button type="button" class="close">Close</button>');
  });

  it('words every line in the visitor’s language, marking the ones it lacks as English', () => {
    const html = panelHtml(notStarted, 0, WORDS, { 'Voice rooms': 'Ruang suara' });
    expect(html).toContain('<h2>Ruang suara</h2>');
    expect(html).toContain('<li><span lang="en">Behind the scenes: the tools everything else is built on</span></li>');
  });

  it('names an unnamed milestone by its number', () => {
    expect(panelHtml(milestone({ name: null }), 4, WORDS, null)).toContain('<h2>Milestone 5</h2>');
  });
});

describe('zoneName', () => {
  const at = new Date('2026-11-25T06:49:00Z');

  it.each([
    ['Asia/Jakarta', 'WIB'],
    ['Asia/Makassar', 'WITA'],
    ['America/New_York', 'EST'],
    ['Australia/Sydney', 'AEDT'],
    ['Asia/Kolkata', 'IST'],
    ['Europe/London', 'GMT'],
    ['UTC', 'UTC'],
  ])('names %s by its short name, %s', (zone, name) => {
    expect(zoneName(at, zone)).toBe(name);
  });

  it('names a zone with no short name by its offset', () => {
    expect(zoneName(at, 'Asia/Bangkok')).toBe('GMT+7');
  });
});

describe('updatedLine', () => {
  it('words the read time in the visitor’s zone, naming it, in the page’s language', () => {
    expect(updatedLine('2026-11-24T23:49:00.000Z', WORDS, 'en', 'Asia/Jakarta')).toBe('Last updated 25 November 2026, 06:49 WIB');
  });

  it('writes the date in the page’s language', () => {
    const line = updatedLine('2026-11-24T23:49:00.000Z', { ...WORDS, updated: 'Diperbarui {date}, {time} {zone}' }, 'id', 'Asia/Jakarta');
    expect(line).toBe('Diperbarui 25 November 2026, 06.49 WIB');
  });

  it('writes midnight as 00, never 24', () => {
    expect(updatedLine('2026-11-24T17:00:00.000Z', WORDS, 'en', 'Asia/Jakarta')).toBe('Last updated 25 November 2026, 00:00 WIB');
  });
});

describe('isNewer', () => {
  it('swaps in only a later version', () => {
    expect(isNewer({ version: 3 }, { version: 4 })).toBe(true);
    expect(isNewer({ version: 4 }, { version: 4 })).toBe(false);
    expect(isNewer({ version: 5 }, { version: 4 })).toBe(false);
  });
});

describe('reconnectDelay', () => {
  it('waits a second, then doubles each time, up to a minute', () => {
    expect([0, 1, 2, 5, 6, 7, 20].map(reconnectDelay)).toEqual([1000, 2000, 4000, 32_000, 60_000, 60_000, 60_000]);
  });
});

/**
 * The typing bubble never covers a bubble or a label (shyden-labs/ShyTalk#362): Shyden saw its dots over
 * "Groundwork · 77%" on DEV. Boxes are read back from the drawing itself: each bubble's body and tail, each label, and
 * the typing bubble's pill.
 */
describe('the typing bubble keeps clear', () => {
  // The board's real public names, in its order (DEV, 2026-11-26).
  const NAMES = [
    'Groundwork',
    'The website',
    'The app',
    'Strong foundations',
    'Voice rooms',
    'Find a room',
    'Friends',
    'Safe spaces',
    'Kind and safe',
    'Clear rules',
    'Launch',
  ];
  type Box = { left: number; top: number; right: number; bottom: number };
  const n = (text: string | undefined): number => Number(text);

  function boxes(svg: string): { typing: Box; others: Box[] } {
    const others: Box[] = [];
    for (const [, x, y] of svg.matchAll(/<path class="bubble [^"]*" d="M(-?[\d.]+),(-?[\d.]+)/g)) {
      const left = n(x) - 16;
      const top = n(y);
      others.push({ left, top, right: left + 104, bottom: top + 58 + 14 });
    }
    for (const [, x, y, w, h] of svg.matchAll(/<rect class="label" x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
      others.push({ left: n(x), top: n(y), right: n(x) + n(w), bottom: n(y) + n(h) });
    }
    const at = /class="typing" transform="translate\((-?[\d.]+),(-?[\d.]+)\)"/.exec(svg);
    if (at === null) throw new Error('no typing bubble');
    const [x, y] = [n(at[1]), n(at[2])];
    return { typing: { left: x - 26, top: y - 14, right: x + 26, bottom: y + 14 }, others };
  }
  const touches = (a: Box, b: Box): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const typingAt = (svg: string): [number, number] => {
    const at = /class="typing" transform="translate\((-?[\d.]+),(-?[\d.]+)\)"/.exec(svg);
    return [n(at?.[1]), n(at?.[2])];
  };

  /** The board with the first `open` milestones done and the next `closed` of 20 done. */
  const board = (open: number, closed: number): Milestone[] =>
    NAMES.map((name, index) => {
      if (index < open) return milestone({ name, closed: 20, total: 20, percent: 100, state: 'done' });
      if (index === open) {
        const percent = Math.floor((closed / 20) * 100);
        return milestone({ name, closed, total: 20, percent, state: closed === 0 ? 'not started' : 'started' });
      }
      return milestone({ name, closed: 0, total: 5, percent: 0, state: 'not started' });
    });

  it.each(NAMES.map((name, index) => [name, index] as const))(
    'with %s the first unfinished milestone, at every share done from 0 to 95%%',
    (_name, open) => {
      for (let closed = 0; closed < 20; closed += 1) {
        const { typing, others } = boxes(mapSvg(board(open, closed), WORDS, null));
        const hit = others.find((box) => touches(typing, box));
        expect(hit, `${String(closed)} of 20 done`).toBeUndefined();
      }
    },
  );

  it('with every milestone done', () => {
    const { typing, others } = boxes(mapSvg(board(NAMES.length, 0), WORDS, null));
    expect(others.find((box) => touches(typing, box))).toBeUndefined();
  });

  it.each(NAMES.map((name, index) => [name, index] as const))(
    'moves no further back along the line into %s as more of it is done',
    (_name, open) => {
      const spot = SPOTS[open];
      if (spot === undefined) throw new Error('no spot');
      const distances = [1, 5, 10, 15, 19].map((closed) => {
        const [x, y] = typingAt(mapSvg(board(open, closed), WORDS, null));
        return Math.hypot(spot.x - x, spot.y - y);
      });
      for (let i = 1; i < distances.length; i += 1) expect(distances[i]).toBeLessThanOrEqual(distances[i - 1] ?? 0);
    },
  );

  it('sits just below its point on the line when no place is clear', () => {
    const everything = { left: 0, top: 0, right: 1000, bottom: 440 };
    expect(typingPlace([100, 100], [300, 200], 0.5, [everything])).toEqual([200, 170]);
  });

  it('keeps inside the field: as far along as fits, below the line where above would leave it', () => {
    // Along a line off the right edge, 74% is the furthest a 52-wide pill fits; 40 below would pass the bottom.
    const [rightX, rightY] = typingPlace([900, 400], [1000, 400], 1, []);
    expect(rightX).toBeCloseTo(974);
    expect(rightY).toBeCloseTo(420);
    // Along the top edge, on the line or above it would leave the field, so it sits 20 below.
    const [leftX, leftY] = typingPlace([100, 0], [0, 0], 1, []);
    expect(leftX).toBeCloseTo(26);
    expect(leftY).toBeCloseTo(20);
  });
});
