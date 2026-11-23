import { describe, expect, it } from 'vitest';
import AssertionCounts, { type CountedStep, type CountedTest } from '../smoke/assertion-counts.ts';

/**
 * The smoke's assertion counter (shyden-labs/ShyTalk#180 AC4, AC7): from the
 * runner's own step events it counts, per target and test, every assertion
 * that ran, so a merge can show none was lost and each target ran the same.
 */

const test = (project: string, title: string): CountedTest => ({ title, parent: { project: () => ({ name: project }) } });
const step = (category: string, parent?: CountedStep): CountedStep => (parent === undefined ? { category } : { category, parent });

function run(events: [CountedTest, CountedStep][]) {
  const written: { path: string; text: string }[] = [];
  const reporter = new AssertionCounts({ outputFile: '/out/counts.json', write: (path, text) => written.push({ path, text }) });
  for (const [t, s] of events) reporter.onStepEnd(t, {}, s);
  reporter.onEnd();
  return written;
}

describe('AssertionCounts', () => {
  it('counts each expect step per target and test, in the file it is given', () => {
    const home = test('chromium', 'en: the home page');
    const homeFirefox = test('firefox', 'en: the home page');
    const written = run([
      [home, step('expect')],
      [home, step('pw:api')],
      [home, step('expect')],
      [homeFirefox, step('expect')],
    ]);
    expect(written).toEqual([
      {
        path: '/out/counts.json',
        text: JSON.stringify({ chromium: { 'en: the home page': 2 }, firefox: { 'en: the home page': 1 } }, null, 2),
      },
    ]);
  });

  it('counts an expect inside a test.step, but not the tries nested inside another expect', () => {
    const journey = test('webkit', 'joining');
    const poll = step('expect');
    const written = run([
      [journey, step('expect', step('test.step'))],
      [journey, step('expect', poll)],
      [journey, step('expect', step('pw:api', poll))],
      [journey, poll],
    ]);
    expect(JSON.parse(written[0]?.text ?? '')).toEqual({ webkit: { joining: 2 } });
  });

  it('writes an empty object when no expect ran', () => {
    expect(run([[test('chromium', 'quiet'), step('pw:api')]])[0]?.text).toBe('{}');
  });
});
