import { describe, it, expect } from 'vitest';
import { publicSnapshot, type RoadmapItem } from '../../workers/web/src/roadmap/snapshot.ts';
import { BRINGS } from '../../workers/web/src/roadmap/brings.ts';

/**
 * What the public roadmap shows (shyden-labs/ShyTalk#38 AC1, #321 AC3 and AC4), copying Yawelo Idle's model
 * (yawelo-idle#840, #844, #846, #1068; Shyden 2026-11-23, every roadmap copies Yawelo's): one milestone per epic, by
 * its board `Public title` and `Public summary`, its stories counted (closed, total, a percent rounded down) but never
 * named, and the lines saying what it brings from a file in the repo (approved on #319). Nothing private: no internal
 * title, label, issue number or estimate.
 */

const TODAY = '2026-11-23';
let next = 100;
function item(more: Partial<RoadmapItem>): RoadmapItem {
  next += 1;
  return {
    number: next,
    title: `Internal title ${String(next)}`,
    state: 'OPEN',
    createdAt: '2026-11-01T00:00:00Z',
    closedAt: null,
    stateReason: null,
    estimate: 3,
    labels: ['secret-label'],
    priority: 'P2',
    parent: null,
    publicTitle: null,
    publicSummary: null,
    ...more,
  };
}
const closed = { state: 'CLOSED', closedAt: '2026-11-20T00:00:00Z', stateReason: 'COMPLETED' } as const;

describe('the public snapshot', () => {
  const app = item({
    number: 11,
    title: 'Epic: plan 6, the app shell',
    priority: 'P1',
    publicTitle: 'The app',
    publicSummary: 'The new app.',
  });
  const site = item({
    number: 8,
    title: 'Epic: plan 3, the website',
    priority: 'P0',
    publicTitle: 'The website',
    publicSummary: 'The website.',
  });
  const groundwork = item({
    number: 7,
    title: 'Epic: plan 1, set-up',
    priority: 'P0',
    ...closed,
    publicTitle: 'Groundwork',
    publicSummary: 'Set-up.',
  });
  const stories = [
    item({ parent: 11, ...closed, publicTitle: 'A story public title' }),
    item({ parent: 11, title: 'Move the CI runner' }),
    item({ parent: 11 }),
    item({ parent: 8, ...closed }),
    item({ parent: 8, ...closed }),
    item({ parent: 8 }),
    item({ parent: 7, ...closed }),
  ];
  const snapshot = publicSnapshot([app, site, groundwork, ...stories], TODAY);

  it('shows every epic, open and done, in Priority order, each by its public title and summary', () => {
    expect(snapshot.milestones.map(({ name, summary }) => [name, summary])).toEqual([
      ['Groundwork', 'Set-up.'],
      ['The website', 'The website.'],
      ['The app', 'The new app.'],
    ]);
  });

  it('counts each epic’s stories, closed and in all, with a percent rounded down, and names none', () => {
    expect(snapshot.milestones.map(({ closed: done, total, percent }) => [done, total, percent])).toEqual([
      [1, 1, 100],
      [2, 3, 66],
      [1, 3, 33],
    ]);
  });

  it('marks a milestone done once its epic is closed, started once a story is closed, and not started otherwise', () => {
    const fresh = item({ title: 'Epic: fresh', priority: 'P4', publicTitle: 'Fresh' });
    const shown = publicSnapshot([app, groundwork, fresh, ...stories, item({ parent: fresh.number })], TODAY);
    expect(shown.milestones.map(({ name, state }) => [name, state])).toEqual([
      ['Groundwork', 'done'],
      ['The app', 'started'],
      ['Fresh', 'not started'],
    ]);
  });

  it('gives each milestone the approved lines saying what it brings, and none for an epic the file does not name', () => {
    expect(snapshot.milestones[0]?.brings).toEqual(BRINGS.en[7]);
    expect(snapshot.milestones[2]?.brings).toEqual(BRINGS.en[11]);
    const unnamed = item({ number: 999, title: 'Epic: new', publicTitle: 'New' });
    expect(publicSnapshot([unnamed], TODAY).milestones[0]?.brings).toEqual([]);
  });

  it('holds the approved words for each of the 11 epics on #319', () => {
    expect(Object.keys(BRINGS.en).map(Number)).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(BRINGS.en[8]).toEqual([
      'ShyTalk explained in five languages',
      'Apply to try ShyTalk before launch',
      'A help page whenever you need it',
    ]);
    expect(BRINGS.en[17]).toEqual(['Download ShyTalk on iPhone and Android']);
  });

  it('carries no internal title, label, issue number, estimate or story title anywhere', () => {
    const text = JSON.stringify(snapshot);
    for (const leak of [
      'Internal title',
      'Epic:',
      'secret-label',
      'Move the CI runner',
      'A story public title',
      '"number"',
      '"estimate"',
      '"labels"',
      '"epic"',
    ]) {
      expect(text).not.toContain(leak);
    }
  });

  it('carries the same two progress lines the close-out prints, from the same module', () => {
    expect(snapshot.progress).toHaveLength(2);
    expect(snapshot.progress[0]).toMatch(/^By tickets: /u);
    expect(snapshot.progress[1]).toMatch(/^By effort: /u);
  });

  it('gives an epic with no public words null for each, never its board title', () => {
    const plain = item({ title: 'Epic: plan 9, internal', priority: 'P0' });
    expect(publicSnapshot([plain], TODAY).milestones).toEqual([
      { name: null, summary: null, brings: [], closed: 0, total: 0, percent: 0, state: 'not started' },
    ]);
  });

  it('leaves out a story closed as not planned or a duplicate, and draft cards', () => {
    const epic = item({ title: 'Epic: x', publicTitle: 'X' });
    const shown = publicSnapshot(
      [
        epic,
        item({ parent: epic.number, ...closed, stateReason: 'NOT_PLANNED' }),
        item({ parent: epic.number, ...closed, stateReason: 'DUPLICATE' }),
        item({ number: null, parent: epic.number }),
        item({ number: null, title: 'Epic: draft', publicTitle: 'Draft' }),
        item({ parent: epic.number }),
      ],
      TODAY,
    );
    expect(shown.milestones.map(({ name, closed: done, total }) => [name, done, total])).toEqual([['X', 0, 1]]);
  });

  it('puts an epic with no Priority after every prioritised one, and ties by issue order', () => {
    const unranked = item({ title: 'Epic: y', priority: null, publicTitle: 'Unranked' });
    const tie = item({ title: 'Epic: w', priority: 'P5', publicTitle: 'Tie' });
    const ranked = item({ title: 'Epic: z', priority: 'P5', publicTitle: 'Ranked' });
    expect(publicSnapshot([unranked, ranked, tie], TODAY).milestones.map(({ name }) => name)).toEqual(['Tie', 'Ranked', 'Unranked']);
  });
});
