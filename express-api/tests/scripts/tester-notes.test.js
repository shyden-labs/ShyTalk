'use strict';

/**
 * tester-notes.test.js — SHY-0361.
 *
 * Operator, 2026-08-20: "in the app tester app build notes, it should have the
 * information about the last ticket, even if it's a deploy from develop (but
 * still says it's a deploy from develop)."
 *
 * `scripts/tester-notes.js` turns the commits a dev deploy carries into the
 * note a tester reads in Firebase App Distribution and TestFlight. These tests
 * load it in-process and call its pure functions: no git, no network, no child
 * process.
 */

const {
  NOTES_LIMIT,
  LINE_LIMIT,
  parseChanges,
  ticketIds,
  summarise,
  storyTitle,
  buildNotes,
} = require('../../../scripts/tester-notes.js');

/** One line of the change list the workflow's list-build-changes job writes. */
const line = (sha, areas, subject) => `${sha}\t${areas}\t${subject}`;

const resolved = (...lines) => parseChanges(['#baseline 1111111', ...lines].join('\n'));

const base = {
  platform: 'android',
  ref: 'develop',
  sha: '56651692a793b83f66c6ff856e1bb2603b803d01',
  trigger: 'workflow_dispatch',
  titles: new Map([
    ['SHY-0583', 'An orphaned In Progress story returns to the backlog'],
    ['SHY-0518', 'A Draft story can be maintained without leaving Draft'],
  ]),
  override: '',
};

describe('parseChanges', () => {
  test('reads each commit as sha, areas and subject, newest first as given', () => {
    expect(
      resolved(line('aaa', 'backend,android', 'SHY-0583: x (#1)'), line('bbb', '-', 'docs: y')),
    ).toEqual({
      resolved: true,
      changes: [
        { sha: 'aaa', areas: ['backend', 'android'], subject: 'SHY-0583: x (#1)' },
        { sha: 'bbb', areas: [], subject: 'docs: y' },
      ],
    });
  });

  test('a subject that itself contains a tab keeps everything after the second tab', () => {
    expect(resolved(line('aaa', 'ios', 'a\tb')).changes[0].subject).toBe('a\tb');
  });

  test('reads the unresolved marker as "could not work out what changed"', () => {
    expect(parseChanges('#unresolved')).toEqual({ resolved: false, changes: [] });
  });

  test('a baseline with no commits after it is resolved and empty', () => {
    expect(parseChanges('#baseline 1111111')).toEqual({ resolved: true, changes: [] });
  });

  test('refuses text with no header line, quoting what it got', () => {
    expect(() => parseChanges(line('aaa', 'ios', 'x'))).toThrow(/header.*aaa/);
  });

  test('refuses empty text', () => {
    expect(() => parseChanges('')).toThrow(/header/);
  });

  test('refuses a commit line with too few fields, quoting it', () => {
    expect(() => parseChanges('#baseline 1\naaa\tios')).toThrow(/malformed.*aaa/);
  });

  test('refuses an area the classifier never writes', () => {
    expect(() => resolved(line('aaa', 'android,desktop', 'x'))).toThrow(/area.*desktop/);
  });
});

describe('ticketIds', () => {
  test('a subject that opens with the id', () => {
    expect(ticketIds('SHY-0583: the orphan check runs in the gate (#2326)')).toEqual(['SHY-0583']);
  });

  test('an id in a trailing bracket', () => {
    expect(ticketIds('fix(ui): give every image a failure state (SHY-0444) (#2122)')).toEqual([
      'SHY-0444',
    ]);
  });

  test('two ids, in the order written', () => {
    expect(ticketIds('SHY-0461 + SHY-0463: a suspended person is told (#2017)')).toEqual([
      'SHY-0461',
      'SHY-0463',
    ]);
  });

  test('the same id twice is named once', () => {
    expect(ticketIds('SHY-0444: SHY-0444 again')).toEqual(['SHY-0444']);
  });

  test('a subject with no id names none', () => {
    expect(ticketIds('build(deps): bump firebase-bom from 34.1.0 to 34.2.0 (#2301)')).toEqual([]);
  });

  test('a five-digit number is not an id', () => {
    expect(ticketIds('SHY-05830: x')).toEqual([]);
  });
});

describe('summarise', () => {
  test('drops the ticket prefix and the pull request number', () => {
    expect(summarise('SHY-0583: the orphan check runs in the required gate (#2326)')).toBe(
      'the orphan check runs in the required gate',
    );
  });

  test('drops a priority tag after the id', () => {
    expect(summarise('SHY-0371 (P0): dev crash-looped (#1883)')).toBe('dev crash-looped');
  });

  test('drops two joined ids', () => {
    expect(summarise('SHY-0461 + SHY-0463: a suspended person is told (#2017)')).toBe(
      'a suspended person is told',
    );
  });

  test('drops a conventional-commit type and a trailing ticket bracket', () => {
    expect(summarise('fix(ui): give every remote image a failure state (SHY-0444) (#2122)')).toBe(
      'give every remote image a failure state',
    );
  });

  test('keeps a dependency bump readable', () => {
    expect(summarise('build(deps): bump firebase-bom from 34.1.0 to 34.2.0 (#2301)')).toBe(
      'bump firebase-bom from 34.1.0 to 34.2.0',
    );
  });

  test('withholds a subject naming a file path', () => {
    expect(summarise('SHY-0347: scope gating in .github/workflows/x (#1)')).toBeNull();
  });

  test('withholds a subject naming a source file', () => {
    expect(summarise('SHY-0347: classify deploy-dev.yml changes (#1)')).toBeNull();
  });

  test('withholds a subject carrying a link', () => {
    expect(summarise('SHY-0001: see https://example.com')).toBeNull();
  });

  test('withholds a subject still naming a pull request mid-sentence', () => {
    expect(summarise('SHY-0001: follow-up to #2290 (#2291)')).toBeNull();
  });

  test('a subject that was only an id gives no summary', () => {
    expect(summarise('SHY-0001 (#5)')).toBeNull();
  });
});

describe('storyTitle', () => {
  test('reads the title from the story heading', () => {
    expect(
      storyTitle('---\nid: SHY-0583\n---\n\n# SHY-0583: An orphan returns\n', 'SHY-0583'),
    ).toBe('An orphan returns');
  });

  test("a heading for a different id is not this story's title", () => {
    expect(storyTitle('# SHY-0584: Another\n', 'SHY-0583')).toBeNull();
  });

  test('a story with no heading has no title', () => {
    expect(storyTitle('---\nid: SHY-0583\n---\nbody\n', 'SHY-0583')).toBeNull();
  });
});

describe('buildNotes — the first line answers "what do I test?"', () => {
  test('one ticket: its id and title', () => {
    const notes = buildNotes({
      ...base,
      ...resolved(line('a', 'android', 'SHY-0583: the orphan check runs (#2326)')),
    });
    expect(notes.split('\n')[0]).toBe(
      'What to test: SHY-0583 An orphaned In Progress story returns to the backlog',
    );
  });

  test('several tickets: the newest first, and how many more follow', () => {
    const notes = buildNotes({
      ...base,
      ...resolved(
        line('a', 'android', 'SHY-0583: the orphan check runs (#2326)'),
        line('b', 'backend', 'SHY-0518: a Draft story can be edited (#2311)'),
      ),
    });
    expect(notes.split('\n')[0]).toBe(
      'What to test: SHY-0583 An orphaned In Progress story returns to the backlog (+1 more below)',
    );
  });

  test('no ticket, other app changes: says so instead of naming an old ticket', () => {
    const notes = buildNotes({
      ...base,
      ...resolved(line('a', 'android,ios', 'build(deps): bump agp from 9.1 to 9.2 (#2300)')),
    });
    expect(notes.split('\n')[0]).toBe(
      'What to test: no ticket in this build; 1 other change below',
    );
  });

  test('nothing for this app: says so', () => {
    const notes = buildNotes({
      ...base,
      ...resolved(line('a', 'web', 'SHY-0583: the roadmap page (#1)')),
    });
    expect(notes.split('\n')[0]).toBe(
      'What to test: nothing new for this app since the last dev build',
    );
  });

  test('baseline unresolved: says plainly the tickets are unknown', () => {
    const notes = buildNotes({ ...base, ...parseChanges('#unresolved') });
    expect(notes.split('\n')[0]).toBe(
      'What to test: unknown, because the last dev build could not be found to compare against',
    );
  });
});

describe('buildNotes — the body', () => {
  const two = () =>
    buildNotes({
      ...base,
      ...resolved(
        line('a', 'android', 'SHY-0583: the orphan check runs in the gate (#2326)'),
        line('b', 'backend', 'build(deps): bump express from 5.1.0 to 5.2.0 (#2302)'),
        line('c', 'backend', 'SHY-0518: a Draft story can be edited (#2311)'),
        line('d', 'android', 'SHY-0583: an abandoned story can go back (#2324)'),
      ),
    });

  test('lists every ticket newest first, each with its title and newest summary', () => {
    expect(two()).toContain(
      'Tickets, newest first:\n' +
        '- SHY-0583 An orphaned In Progress story returns to the backlog: the orphan check runs in the gate\n' +
        '- SHY-0518 A Draft story can be maintained without leaving Draft: a Draft story can be edited\n',
    );
  });

  test('lists changes without a ticket under their own heading', () => {
    expect(two()).toContain('Other changes:\n- bump express from 5.1.0 to 5.2.0\n');
  });

  test('a commit naming two tickets lists both', () => {
    const notes = buildNotes({
      ...base,
      titles: new Map(),
      ...resolved(line('a', 'android', 'SHY-0461 + SHY-0463: a suspended person is told (#2017)')),
    });
    expect(notes).toContain(
      '- SHY-0461: a suspended person is told\n- SHY-0463: a suspended person is told\n',
    );
  });

  test('a ticket with no story file still shows its id and summary', () => {
    const notes = buildNotes({
      ...base,
      titles: new Map(),
      ...resolved(line('a', 'android', 'SHY-0999: something changed (#1)')),
    });
    expect(notes.split('\n')[0]).toBe('What to test: SHY-0999 something changed');
  });

  test('a ticket with neither title nor usable summary shows its id alone', () => {
    const notes = buildNotes({
      ...base,
      titles: new Map(),
      ...resolved(line('a', 'android', 'SHY-0999: edit deploy-dev.yml (#1)')),
    });
    expect(notes).toContain('Tickets, newest first:\n- SHY-0999\n');
  });

  test('a summary that repeats the title is not repeated', () => {
    const notes = buildNotes({
      ...base,
      ...resolved(
        line('a', 'android', 'SHY-0583: An orphaned In Progress story returns to the backlog (#1)'),
      ),
    });
    expect(notes).toContain('- SHY-0583 An orphaned In Progress story returns to the backlog\n');
  });

  test('the Android note leaves out an iOS-only commit', () => {
    const notes = buildNotes({
      ...base,
      ...resolved(line('a', 'ios', 'SHY-0583: x (#1)'), line('b', 'android', 'SHY-0518: y (#2)')),
    });
    expect(notes).not.toContain('SHY-0583');
  });

  test('the iOS note leaves out an Android-only commit', () => {
    const notes = buildNotes({
      ...base,
      platform: 'ios',
      ...resolved(line('a', 'ios', 'SHY-0583: x (#1)'), line('b', 'android', 'SHY-0518: y (#2)')),
    });
    expect(notes).not.toContain('SHY-0518');
  });

  test("a backend change reaches both apps' notes", () => {
    const notes = buildNotes({
      ...base,
      platform: 'ios',
      ...resolved(line('a', 'backend', 'SHY-0518: y (#2)')),
    });
    expect(notes).toContain('SHY-0518');
  });

  test('refuses a platform it does not know', () => {
    expect(() => buildNotes({ ...base, platform: 'web', ...resolved() })).toThrow(/platform.*web/);
  });
});

describe('buildNotes — provenance on the last line', () => {
  const last = (over) =>
    buildNotes({ ...base, ...resolved(line('a', 'android', 'SHY-0583: x (#1)')), ...over })
      .split('\n')
      .at(-1);

  test('a hand-started deploy names the branch and the short sha', () => {
    expect(last({})).toBe('Deploy from develop at 56651692a79, started by hand.');
  });

  test('a merge-started deploy says it was automatic', () => {
    expect(last({ trigger: 'push' })).toBe(
      'Deploy from develop at 56651692a79, started automatically by a merge.',
    );
  });

  test('the daily catch-up says so', () => {
    expect(last({ trigger: 'schedule' })).toBe(
      'Deploy from develop at 56651692a79, the daily catch-up.',
    );
  });

  test('an unexpected trigger is named as it is', () => {
    expect(last({ trigger: 'repository_dispatch' })).toBe(
      'Deploy from develop at 56651692a79, started by repository_dispatch.',
    );
  });

  test('a deploy of another ref names that ref', () => {
    expect(last({ ref: 'v0.97.1' })).toBe('Deploy from v0.97.1 at 56651692a79, started by hand.');
  });

  test('the unresolved note still names branch and sha', () => {
    expect(buildNotes({ ...base, ...parseChanges('#unresolved') })).toMatch(
      /\nDeploy from develop at 56651692a79, started by hand\.$/,
    );
  });

  test('refuses a deploy with no sha', () => {
    expect(() => buildNotes({ ...base, sha: '', ...resolved() })).toThrow(/sha/);
  });
});

describe('buildNotes — hand-written notes and length', () => {
  test('hand-written notes win, unchanged', () => {
    expect(
      buildNotes({ ...base, override: 'Test the mute fix', ...parseChanges('#unresolved') }),
    ).toBe('Test the mute fix');
  });

  test('blank hand-written notes do not win', () => {
    expect(
      buildNotes({
        ...base,
        override: '  \n',
        ...resolved(line('a', 'android', 'SHY-0583: x (#1)')),
      }),
    ).toMatch(/^What to test: SHY-0583/);
  });

  test('hand-written notes past the limit are cut to it', () => {
    expect(
      buildNotes({ ...base, override: 'x'.repeat(NOTES_LIMIT + 50), ...resolved() }),
    ).toHaveLength(NOTES_LIMIT);
  });

  test('a long title is cut, keeping the id', () => {
    const notes = buildNotes({
      ...base,
      titles: new Map([['SHY-0583', 'w '.repeat(400)]]),
      ...resolved(line('a', 'android', 'SHY-0583: x (#1)')),
    });
    const entry = notes.split('\n').find((l) => l.startsWith('- SHY-0583'));
    expect(entry).toHaveLength(LINE_LIMIT);
    expect(entry.endsWith('…')).toBe(true);
  });

  test('more tickets than fit: the newest are kept, the rest counted, provenance kept', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      line(
        `s${i}`,
        'android',
        `SHY-${String(1000 + i).padStart(4, '0')}: ${'z'.repeat(60)} (#${i})`,
      ),
    );
    const notes = buildNotes({ ...base, titles: new Map(), ...resolved(...many) });
    expect(notes.length).toBeLessThanOrEqual(NOTES_LIMIT);
    expect(notes).toContain('- SHY-1000:');
    expect(notes).not.toContain('- SHY-1199:');
    expect(notes).toMatch(/\n- …and \d+ more\n/);
    expect(notes).toMatch(/\nDeploy from develop at 56651692a79, started by hand\.$/);
  });
});
