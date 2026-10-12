/* eslint-disable sonarjs/no-os-command-from-path
   -- the end-to-end case runs `git` and `node` in a temporary repository it
   creates itself. Not security-sensitive. */
/**
 * SHY-0535: scripts/story-progress.js reports progress twice (by tickets and
 * by story points), each with its measured pace and the ETA that pace gives,
 * over the whole backlog, then the MVP subset (worked first).
 *
 * Spec: .project/stories/SHY-0535-every-story-carries-a-points-estimate-and-progress-reads-it.md
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'story-progress.js');
const {
  parseStory,
  doneDatesFromLog,
  progress,
  formatLines,
} = require('../../../scripts/story-progress.js');

const TODAY = '2026-10-07';

function storyText({ id = 'SHY-0001', status = 'Draft', estimate = null, mvp = null } = {}) {
  return [
    '---',
    `id: ${id}`,
    `status: ${status}`,
    'owner: claude',
    'priority: P1',
    'effort: M',
    ...(estimate === null ? [] : [`estimate: ${estimate}`]),
    ...(mvp === null ? [] : [`mvp: ${mvp}`]),
    '---',
    '',
    `# ${id}: Fixture`,
    '',
  ].join('\n');
}

/** A parsed story, with the file name the Done-date map is keyed by. */
function story(id, status, { estimate = null, mvp = false } = {}) {
  return { file: `${id}-fixture.md`, id, status, estimate, mvp };
}

// ============================================================== parseStory

describe('parseStory', () => {
  test('reads id, status, estimate and mvp from the frontmatter', () => {
    expect(
      parseStory(
        storyText({ id: 'SHY-0042', status: 'In Review', estimate: 8, mvp: true }),
        'SHY-0042-x.md',
      ),
    ).toEqual({
      file: 'SHY-0042-x.md',
      id: 'SHY-0042',
      status: 'In Review',
      estimate: 8,
      mvp: true,
    });
  });

  test('an absent estimate is null, an absent mvp is false', () => {
    expect(parseStory(storyText({ id: 'SHY-0043' }), 'SHY-0043-x.md')).toEqual({
      file: 'SHY-0043-x.md',
      id: 'SHY-0043',
      status: 'Draft',
      estimate: null,
      mvp: false,
    });
  });

  test('tolerates padding around values', () => {
    const text = storyText({ id: 'SHY-0044' }).replace('status: Draft', 'status:   Done  ');
    expect(parseStory(text, 'SHY-0044-x.md').status).toBe('Done');
  });

  test('refuses a file with no frontmatter, naming it', () => {
    expect(() => parseStory('# SHY-0045: no frontmatter\n', 'SHY-0045-x.md')).toThrow(
      'SHY-0045-x.md: no frontmatter',
    );
  });

  test('refuses frontmatter with no status, naming the file', () => {
    const text = storyText({ id: 'SHY-0046' }).replace('status: Draft\n', '');
    expect(() => parseStory(text, 'SHY-0046-x.md')).toThrow('SHY-0046-x.md: no status');
  });

  test('refuses an estimate that is not a whole number, naming the file', () => {
    const text = storyText({ id: 'SHY-0047', estimate: 'M' });
    expect(() => parseStory(text, 'SHY-0047-x.md')).toThrow('SHY-0047-x.md: estimate "M"');
  });
});

// ============================================================== doneDatesFromLog

describe('doneDatesFromLog', () => {
  const LOG = [
    '@2026-10-05',
    '',
    '.project/stories/SHY-0002-b.md',
    '.project/stories/SHY-INDEX.md',
    '@2026-10-01',
    '',
    '.project/stories/SHY-0001-a.md',
    '.project/stories/SHY-0002-b.md',
    '',
  ].join('\n');

  test('keys each story file by base name with the date of its NEWEST matching commit', () => {
    const dates = doneDatesFromLog(LOG);
    expect(dates.get('SHY-0002-b.md')).toBe('2026-10-05');
    expect(dates.get('SHY-0001-a.md')).toBe('2026-10-01');
  });

  test('counts every story file the log names, and only story files', () => {
    expect([...doneDatesFromLog(LOG).keys()].sort()).toEqual(['SHY-0001-a.md', 'SHY-0002-b.md']);
  });

  test('refuses a file line before any date line, rather than guessing its date', () => {
    expect(() => doneDatesFromLog('.project/stories/SHY-0003-c.md\n')).toThrow(
      'git log line before any date: .project/stories/SHY-0003-c.md',
    );
  });
});

// ============================================================== progress: tickets

describe('progress: tickets over the whole backlog', () => {
  const stories = [
    story('SHY-0001', 'Done'),
    story('SHY-0002', 'Done'),
    story('SHY-0003', 'Draft'),
    story('SHY-0004', 'In Review'),
    story('SHY-0005', 'Cancelled'),
  ];
  const dates = new Map([
    ['SHY-0001-fixture.md', '2026-10-07'],
    ['SHY-0002-fixture.md', '2026-10-01'],
  ]);

  test('closed counts Done stories; Cancelled is left out of the total', () => {
    const t = progress(stories, dates, TODAY).tickets;
    expect(t.closed).toBe(2);
    expect(t.total).toBe(4);
    expect(t.cancelled).toBe(1);
  });

  test('the 7-day pace is one entry per day ending today, oldest first', () => {
    expect(progress(stories, dates, TODAY).tickets.pace7).toEqual([1, 0, 0, 0, 0, 0, 1]);
  });

  test('the 30-day pace has 30 entries and the same closures', () => {
    const { pace30 } = progress(stories, dates, TODAY).tickets;
    expect(pace30).toHaveLength(30);
    expect(pace30.reduce((a, b) => a + b, 0)).toBe(2);
  });

  test('a Done story with no known Done date still counts as closed but adds no pace', () => {
    const t = progress(
      [story('SHY-0009', 'Done'), story('SHY-0010', 'Draft')],
      new Map(),
      TODAY,
    ).tickets;
    expect(t.closed).toBe(1);
    expect(t.pace30.reduce((a, b) => a + b, 0)).toBe(0);
  });
});

// ============================================================== progress: effort

describe('progress: effort in story points', () => {
  test('unavailable until every open story is scored, saying how many are', () => {
    const e = progress(
      [story('SHY-0001', 'Draft', { estimate: 3 }), story('SHY-0002', 'Draft')],
      new Map(),
      TODAY,
    ).effort;
    expect(e).toEqual({ available: false, scored: 1, open: 2 });
  });

  test('closed and open points summed once every open story is scored', () => {
    const e = progress(
      [
        story('SHY-0001', 'Done', { estimate: 5 }),
        story('SHY-0002', 'Draft', { estimate: 3 }),
        story('SHY-0003', 'In Progress', { estimate: 8 }),
      ],
      new Map([['SHY-0001-fixture.md', TODAY]]),
      TODAY,
    ).effort;
    expect(e.available).toBe(true);
    expect(e.closedPoints).toBe(5);
    expect(e.openPoints).toBe(11);
    expect(e.assumedClosed).toBe(0);
    expect(e.pace7).toEqual([0, 0, 0, 0, 0, 0, 5]);
  });

  test('unscored Done stories count at the mean of the scored Done stories, and are counted as assumed', () => {
    const e = progress(
      [
        story('SHY-0001', 'Done', { estimate: 2 }),
        story('SHY-0002', 'Done', { estimate: 8 }),
        story('SHY-0003', 'Done'),
        story('SHY-0004', 'Draft', { estimate: 1 }),
      ],
      new Map(),
      TODAY,
    ).effort;
    expect(e.scoredMean).toBe(5);
    expect(e.closedPoints).toBe(15);
    expect(e.assumedClosed).toBe(1);
  });

  test('Cancelled stories add no points either way', () => {
    const e = progress(
      [
        story('SHY-0001', 'Cancelled', { estimate: 13 }),
        story('SHY-0002', 'Draft', { estimate: 2 }),
      ],
      new Map(),
      TODAY,
    ).effort;
    expect(e.openPoints).toBe(2);
    expect(e.closedPoints).toBe(0);
  });
});

// ============================================================== progress: MVP subset

describe('progress: the MVP subset', () => {
  test('counts only mvp: true stories, Cancelled left out', () => {
    const m = progress(
      [
        story('SHY-0001', 'Done', { mvp: true }),
        story('SHY-0002', 'Draft', { mvp: true }),
        story('SHY-0003', 'Draft', { mvp: false }),
        story('SHY-0004', 'Cancelled', { mvp: true }),
      ],
      new Map(),
      TODAY,
    ).mvp;
    expect(m.closed).toBe(1);
    expect(m.total).toBe(2);
  });
});

// ============================================================== formatLines

describe('formatLines', () => {
  /** n Done stories closed on each of the given days, plus open Drafts. */
  function backlog({ closedOn = [], open = 0, estimate = null, mvpOpen = 0 }) {
    const stories = [];
    const dates = new Map();
    closedOn.forEach((day, i) => {
      const s = story(`SHY-1${String(i).padStart(3, '0')}`, 'Done', { estimate });
      stories.push(s);
      dates.set(s.file, day);
    });
    for (let i = 0; i < open; i += 1) {
      stories.push(
        story(`SHY-2${String(i).padStart(3, '0')}`, 'Draft', { estimate, mvp: i < mvpOpen }),
      );
    }
    return { stories, dates };
  }

  test('tickets line: % complete, counts, 7-day pace and the ETA date it gives', () => {
    // 7 closed in the last 7 days -> 1/day; 14 open -> 14 days -> 2026-10-21.
    const days = [
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
    ];
    const { stories, dates } = backlog({ closedOn: days, open: 14 });
    const [tickets] = formatLines(progress(stories, dates, TODAY), TODAY);
    expect(tickets).toBe(
      'By tickets: 33% complete (7 of 21 stories Done; 0 cancelled left out). ' +
        'Measured pace 1.00 a day over the last 7 days (1, 1, 1, 1, 1, 1, 1). ' +
        'ETA at that pace: 2026-10-21, before outside waits.',
    );
  });

  test('with nothing closed in 7 days, the ETA uses the 30-day pace and says so', () => {
    // 3 closed in the window 8-30 days ago -> 0.1/day; 1 open -> 10 days.
    const { stories, dates } = backlog({
      closedOn: ['2026-09-10', '2026-09-15', '2026-09-20'],
      open: 1,
    });
    const [tickets] = formatLines(progress(stories, dates, TODAY), TODAY);
    expect(tickets).toContain('Measured pace 0.00 a day over the last 7 days');
    expect(tickets).toContain(
      'Nothing closed in the last 7 days; ETA at the 30-day pace of 0.10 a day: 2026-10-17, before outside waits.',
    );
  });

  test('with nothing closed in 30 days, the ETA is unavailable at the measured pace', () => {
    const { stories, dates } = backlog({ closedOn: ['2026-08-01'], open: 1 });
    const [tickets] = formatLines(progress(stories, dates, TODAY), TODAY);
    expect(tickets).toContain(
      'ETA unavailable at the measured pace: nothing closed in the last 30 days.',
    );
  });

  test('effort line before scoring is done reads exactly as the close-out rule requires', () => {
    const { stories, dates } = backlog({ closedOn: [TODAY], open: 3 });
    const [, effort] = formatLines(progress(stories, dates, TODAY), TODAY);
    expect(effort).toBe('By effort: unavailable, 0 of 3 open tickets scored');
  });

  test('effort line once scored: % of points, pace in points and its ETA date', () => {
    // 1 story of 5 points closed today -> 5/7 points a day; 4 open x 5 = 20 points -> 28 days.
    const { stories, dates } = backlog({ closedOn: [TODAY], open: 4, estimate: 5 });
    const [, effort] = formatLines(progress(stories, dates, TODAY), TODAY);
    expect(effort).toBe(
      'By effort: 20% complete (5 of 25 points Done). ' +
        'Measured pace 0.71 points a day over the last 7 days (0, 0, 0, 0, 0, 0, 5). ' +
        'ETA at that pace: 2026-11-04, before outside waits.',
    );
  });

  test('effort line names the assumed closed stories and the mean they were counted at', () => {
    const stories = [
      story('SHY-0001', 'Done', { estimate: 3 }),
      story('SHY-0002', 'Done'),
      story('SHY-0003', 'Draft', { estimate: 3 }),
    ];
    const [, effort] = formatLines(progress(stories, new Map(), TODAY), TODAY);
    expect(effort).toContain(
      '(6 of 9 points Done; 1 Done story unscored, counted at the scored mean of 3.0 points (assumed))',
    );
  });

  test('MVP line: the same tickets figures over mvp: true stories only', () => {
    const { stories, dates } = backlog({ closedOn: [], open: 4, mvpOpen: 2 });
    const [, , mvp] = formatLines(progress(stories, dates, TODAY), TODAY);
    expect(mvp).toMatch(/^MVP subset \(worked first\): 0% complete \(0 of 2 stories Done\)\. /);
  });

  test('an empty backlog is refused rather than reported as 0% or 100%', () => {
    expect(() => formatLines(progress([], new Map(), TODAY), TODAY)).toThrow('no stories in scope');
  });
});

// ============================================================== end to end

describe('story-progress.js end to end (real git repository)', () => {
  function git(cwd, args, env = {}) {
    const r = spawnSync('git', args, {
      cwd,
      encoding: 'utf-8',
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        ...env,
      },
    });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout;
  }

  test('reads the corpus and dates closures from the commit that marked each story Done', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'progress535-'));
    try {
      const dir = path.join(repo, '.project', 'stories');
      fs.mkdirSync(dir, { recursive: true });
      git(repo, ['init', '-q', '-b', 'main']);
      const commit = (msg, date) =>
        git(repo, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-am', msg], {
          GIT_AUTHOR_DATE: `${date}T12:00:00Z`,
          GIT_COMMITTER_DATE: `${date}T12:00:00Z`,
        });
      fs.writeFileSync(path.join(dir, 'SHY-0001-a.md'), storyText({ id: 'SHY-0001', estimate: 3 }));
      fs.writeFileSync(path.join(dir, 'SHY-0002-b.md'), storyText({ id: 'SHY-0002', estimate: 5 }));
      fs.writeFileSync(path.join(dir, 'SHY-INDEX.md'), '# SHY Story Index\n');
      fs.writeFileSync(path.join(dir, 'EPIC-0001-x.md'), storyText({ id: 'EPIC-0001' }));
      git(repo, ['add', '.']);
      commit('file stories', '2026-09-01');
      fs.writeFileSync(
        path.join(dir, 'SHY-0001-a.md'),
        storyText({ id: 'SHY-0001', status: 'Done', estimate: 3 }),
      );
      commit('SHY-0001 done', '2026-10-06');

      const r = spawnSync('node', [SCRIPT, '--today', TODAY], { cwd: repo, encoding: 'utf-8' });
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
      const lines = r.stdout.trimEnd().split('\n');
      expect(lines).toHaveLength(3);
      expect(lines[0]).toMatch(
        /^By tickets: 50% complete \(1 of 2 stories Done; 0 cancelled left out\)\. /,
      );
      expect(lines[0]).toContain('(0, 0, 0, 0, 0, 1, 0)');
      expect(lines[1]).toMatch(/^By effort: 38% complete \(3 of 8 points Done\)\. /);
      expect(lines[2]).toMatch(/^MVP subset \(worked first\): /);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('a story file it cannot parse fails the run, naming the file', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'progress535b-'));
    try {
      const dir = path.join(repo, '.project', 'stories');
      fs.mkdirSync(dir, { recursive: true });
      git(repo, ['init', '-q', '-b', 'main']);
      fs.writeFileSync(path.join(dir, 'SHY-0001-a.md'), '# no frontmatter\n');
      const r = spawnSync('node', [SCRIPT, '--today', TODAY], { cwd: repo, encoding: 'utf-8' });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('SHY-0001-a.md: no frontmatter');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
