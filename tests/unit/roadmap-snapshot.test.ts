import { describe, it, expect } from 'vitest';
import { publicSnapshot, type RoadmapItem } from '../../workers/web/src/roadmap/snapshot.ts';

/**
 * What the public roadmap shows (shyden-labs/ShyTalk#38 AC1, #321 AC4; Yawelo
 * Idle's lessons yawelo-idle#840, #844, #846): the board's open epics in
 * Priority order, each story by its plain public title, every story without
 * one counted as behind-the-scenes work, and nothing private: no internal
 * title, label, number or estimate.
 */

const TODAY = '2026-11-23';
let next = 1;
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

describe('the public snapshot', () => {
  const app = item({ number: 11, title: 'Epic: plan 6, the app shell', priority: 'P1', publicSummary: 'The new app.' });
  const site = item({ number: 8, title: 'Epic: plan 3, the website', priority: 'P0', publicSummary: 'The website.' });
  const done = item({
    parent: 11,
    state: 'CLOSED',
    closedAt: '2026-11-20T00:00:00Z',
    stateReason: 'COMPLETED',
    publicTitle: 'A home screen',
  });
  const open = item({ parent: 11, priority: 'P1', publicTitle: 'Live changes' });
  const later = item({ parent: 11, priority: 'P3', publicTitle: 'Update to continue' });
  const hidden = item({ parent: 11, title: 'Move the CI runner' });
  const hiddenDone = item({ parent: 11, state: 'CLOSED', closedAt: '2026-11-21T00:00:00Z', stateReason: 'COMPLETED' });
  const support = item({ parent: 8, priority: 'P0', publicTitle: 'A support page' });
  const closedEpic = item({ title: 'Epic: plan 1, set-up', state: 'CLOSED', closedAt: '2026-11-02T00:00:00Z', publicSummary: 'Set-up.' });
  const snapshot = publicSnapshot([app, site, done, open, later, hidden, hiddenDone, support, closedEpic], TODAY);

  it('shows the open epics in Priority order, each by its public summary', () => {
    expect(snapshot.epics.map((epic) => epic.summary)).toEqual(['The website.', 'The new app.']);
  });

  it('lists each epic’s titled stories, open ones by Priority first, then the done ones', () => {
    expect(snapshot.epics[1]?.stories).toEqual([
      { title: 'Live changes', done: false },
      { title: 'Update to continue', done: false },
      { title: 'A home screen', done: true },
    ]);
  });

  it('counts the stories with no public title as behind-the-scenes work, open and done', () => {
    expect(snapshot.epics[1]?.behindTheScenes).toEqual({ open: 1, done: 1 });
    expect(snapshot.epics[0]?.behindTheScenes).toEqual({ open: 0, done: 0 });
  });

  it('carries no internal title, label, issue number or estimate anywhere', () => {
    const text = JSON.stringify(snapshot);
    for (const leak of ['Internal title', 'Epic:', 'secret-label', 'Move the CI runner', '"number"', '"estimate"', '"labels"']) {
      expect(text).not.toContain(leak);
    }
  });

  it('carries the same two progress lines the close-out prints, from the same module', () => {
    expect(snapshot.progress).toHaveLength(2);
    expect(snapshot.progress[0]).toMatch(/^By tickets: /u);
    expect(snapshot.progress[1]).toMatch(/^By effort: /u);
  });

  it('names an epic with no public summary as behind-the-scenes work, never by its board title', () => {
    const plain = item({ title: 'Epic: plan 9, internal', priority: 'P0' });
    const story = item({ parent: plain.number, publicTitle: 'Age checks' });
    const shown = publicSnapshot([plain, story], TODAY);
    expect(shown.epics).toEqual([
      { summary: null, stories: [{ title: 'Age checks', done: false }], behindTheScenes: { open: 0, done: 0 } },
    ]);
  });

  it('leaves out a story closed as not planned or a duplicate', () => {
    const epic = item({ title: 'Epic: x', publicSummary: 'X.' });
    const dropped = item({
      parent: epic.number,
      state: 'CLOSED',
      closedAt: '2026-11-20T00:00:00Z',
      stateReason: 'NOT_PLANNED',
      publicTitle: 'Dropped',
    });
    const twin = item({ parent: epic.number, state: 'CLOSED', closedAt: '2026-11-20T00:00:00Z', stateReason: 'DUPLICATE' });
    expect(publicSnapshot([epic, dropped, twin], TODAY).epics[0]).toEqual({
      summary: 'X.',
      stories: [],
      behindTheScenes: { open: 0, done: 0 },
    });
  });

  it('leaves out draft cards, which are not public: neither an epic nor a story', () => {
    const epic = item({ title: 'Epic: d', publicSummary: 'D.' });
    const draftStory = item({ number: null, parent: epic.number, publicTitle: 'A draft idea' });
    const draftEpic = item({ number: null, title: 'Epic: draft', publicSummary: 'Draft epic.' });
    const shown = publicSnapshot([epic, draftStory, draftEpic], TODAY);
    expect(shown.epics).toEqual([{ summary: 'D.', stories: [], behindTheScenes: { open: 0, done: 0 } }]);
  });

  it('puts an epic with no Priority after every prioritised one', () => {
    const unranked = item({ title: 'Epic: y', priority: null, publicSummary: 'Unranked.' });
    const ranked = item({ title: 'Epic: z', priority: 'P5', publicSummary: 'Ranked.' });
    expect(publicSnapshot([unranked, ranked], TODAY).epics.map((epic) => epic.summary)).toEqual(['Ranked.', 'Unranked.']);
  });
});
