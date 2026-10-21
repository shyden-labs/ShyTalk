'use strict';

/**
 * rules-red-first.unit.test.js — SHY-0657.
 *
 * `express-api/scripts/rules-red-first.js` is the CI step that shows every
 * DENY rules test a PR adds fails on the base branch's rules, for the
 * assertFails reason, and re-proves the recorded fixture cases (SHY-0653's
 * pre-fix rules). Loaded in-process: git, jest and the file system are stood
 * in, so no process starts and nothing connects.
 */

const path = require('path');
const {
  REASON,
  NEVER,
  listed,
  attachBodies,
  addedDenyTests,
  namePattern,
  verdict,
  inScope,
  summary,
  main,
} = require('../../scripts/rules-red-first.js');

const ROOT = '/w';
const HEAD_API = path.join(ROOT, 'express-api');
const TMP = '/runner/tmp';
const BASE = path.join(TMP, 'rules-red-first-base');
const BASE_API = path.join(BASE, 'express-api');
const SHA = 'b'.repeat(40);
const CONV = 'tests/firestore-rules/conversations-rules.test.js';
const ROOM = 'tests/firestore-rules/room-rules.test.js';

const suite = (cwd, file, rows, message = '') => ({
  name: path.join(cwd, file),
  message,
  assertionResults: rows.map(([fullName, status, failureMessages = []]) => ({
    fullName,
    status,
    failureMessages,
  })),
});
const jestJson = (...suites) => ({ testResults: suites });
const red = `Error: ${REASON}\n    at assertFails (node_modules/...)`;
const t = (file, fullName, body = `body of ${fullName}`, title = fullName) => ({
  file,
  fullName,
  title,
  body,
});

describe('constants', () => {
  test('the red reason is the exact text assertFails throws when a request succeeds', () => {
    expect(REASON).toBe('Expected request to fail, but it succeeded.');
  });

  test('the listing pattern matches no name at all', () => {
    const re = new RegExp(NEVER);
    expect(['', 'DENY: a', 'x'].some((n) => re.test(n))).toBe(false);
  });
});

describe('listed', () => {
  test('gives each listed test as { file, fullName } relative to the jest cwd', () => {
    const json = jestJson(suite(HEAD_API, CONV, [['d DENY: a', 'pending']]));
    expect(listed(json, HEAD_API, [CONV])).toEqual([{ file: CONV, fullName: 'd DENY: a' }]);
  });

  test('fails closed naming the file when a suite did not load', () => {
    const json = jestJson(suite(HEAD_API, CONV, [], 'Cannot find module x'));
    expect(() => listed(json, HEAD_API, [CONV])).toThrow(
      `${CONV} did not load: Cannot find module x`,
    );
  });

  test('fails closed naming the file when an asked-for file is absent from the results', () => {
    const json = jestJson(suite(HEAD_API, CONV, [['DENY: a', 'pending']]));
    expect(() => listed(json, HEAD_API, [CONV, ROOM])).toThrow(`${ROOM} is not in jest's results`);
  });

  test('fails closed when a listing ran a test', () => {
    const json = jestJson(suite(HEAD_API, CONV, [['DENY: a', 'passed']]));
    expect(() => listed(json, HEAD_API, [CONV])).toThrow(`${CONV}: "DENY: a" ran while listing`);
  });
});

describe('attachBodies', () => {
  const extracted = {
    [CONV]: [
      { fullName: 'd DENY: a', title: 'DENY: a', body: 'A', family: false },
      { fullName: 'd DENY: (banned) %s', title: 'DENY: (banned) %s', body: 'F', family: true },
    ],
  };

  test('matches a listed name exactly, else by its family template', () => {
    const got = attachBodies(
      [
        { file: CONV, fullName: 'd DENY: a' },
        { file: CONV, fullName: 'd DENY: (banned) users write' },
      ],
      extracted,
    );
    expect(got.map((g) => [g.fullName, g.title, g.body])).toEqual([
      ['d DENY: a', 'DENY: a', 'A'],
      ['d DENY: (banned) users write', 'DENY: (banned) %s', 'F'],
    ]);
  });

  test('fails closed naming a listed test it cannot match to source', () => {
    expect(() => attachBodies([{ file: CONV, fullName: 'd DENY: zzz' }], extracted)).toThrow(
      `${CONV}: jest lists "d DENY: zzz", which no test in the source names`,
    );
  });
});

describe('addedDenyTests', () => {
  test('a DENY name new to the head is added', () => {
    const got = addedDenyTests([t(CONV, 'DENY: a')], [t(CONV, 'DENY: a'), t(CONV, 'DENY: b')]);
    expect(got).toEqual({ added: [t(CONV, 'DENY: b')], renamed: [] });
  });

  test('a test keeping its name with a new body is not added', () => {
    const got = addedDenyTests([t(CONV, 'DENY: a', 'old')], [t(CONV, 'DENY: a', 'new')]);
    expect(got).toEqual({ added: [], renamed: [] });
  });

  test('an ALLOW test new to the head is not added', () => {
    expect(addedDenyTests([], [t(CONV, 'ALLOW: a')]).added).toEqual([]);
  });

  test('a DENY test renamed in place is a rename, not an addition', () => {
    const got = addedDenyTests(
      [t(CONV, 'DENY: old', 'same  body')],
      [t(CONV, 'DENY: new', 'same body')],
    );
    expect(got).toEqual({
      added: [],
      renamed: [{ from: `${CONV}: DENY: old`, to: `${CONV}: DENY: new` }],
    });
  });

  test('a DENY test moved into another describe or file is a rename', () => {
    const got = addedDenyTests(
      [t(CONV, 'x DENY: a', 'B', 'DENY: a')],
      [t(ROOM, 'y DENY: a', 'B', 'DENY: a')],
    );
    expect(got.renamed).toEqual([{ from: `${CONV}: x DENY: a`, to: `${ROOM}: y DENY: a` }]);
    expect(got.added).toEqual([]);
  });

  test('a new row in a test.each family shares its body but is added: no base name vanished', () => {
    const base = [t(CONV, 'DENY: (banned) a', 'F', 'DENY: (banned) %s')];
    const head = [...base, t(CONV, 'DENY: (banned) b', 'F', 'DENY: (banned) %s')];
    expect(addedDenyTests(base, head)).toEqual({ added: [head[1]], renamed: [] });
  });

  test('every DENY test of a file absent at base is added', () => {
    const head = [t(ROOM, 'DENY: a'), t(ROOM, 'DENY: b')];
    expect(addedDenyTests([], head).added).toEqual(head);
  });
});

describe('namePattern', () => {
  test('matches each name exactly, metacharacters included, and nothing longer', () => {
    const re = new RegExp(namePattern(['d DENY: a (b)? c.', 'DENY: [x]']));
    expect(['d DENY: a (b)? c.', 'DENY: [x]'].every((n) => re.test(n))).toBe(true);
    expect(['d DENY: a (b)? c. longer', 'd DENY: a b c.', 'DENY: x'].some((n) => re.test(n))).toBe(
      false,
    );
  });
});

describe('verdict', () => {
  const planned = [t(CONV, 'DENY: a')];
  const one = (status, failureMessages) =>
    verdict(
      jestJson(suite(HEAD_API, CONV, [['DENY: a', status, failureMessages]])),
      planned,
      HEAD_API,
    );

  test('a test failing with the assertFails reason is red, and the verdict ok', () => {
    expect(one('failed', [red])).toEqual({
      ok: true,
      rows: [{ test: `${CONV}: DENY: a`, result: 'red', detail: '' }],
    });
  });

  test('a test passing on the base rules tests nothing, and fails the verdict', () => {
    expect(one('passed', [])).toEqual({
      ok: false,
      rows: [
        {
          test: `${CONV}: DENY: a`,
          result: 'passed',
          detail: 'passes on these rules: it tests nothing the change made',
        },
      ],
    });
  });

  test('a test failing for another reason is red for the wrong reason', () => {
    const got = one('failed', ['Error: connect ECONNREFUSED 127.0.0.1:8080\n    at x']);
    expect(got.ok).toBe(false);
    expect(got.rows[0]).toEqual({
      test: `${CONV}: DENY: a`,
      result: 'wrong-reason',
      detail: 'Error: connect ECONNREFUSED 127.0.0.1:8080',
    });
  });

  test('a retried test is red only when every attempt failed for the reason', () => {
    expect(one('failed', [red, 'Error: socket hang up']).rows[0].result).toBe('wrong-reason');
    expect(one('failed', [red, red]).rows[0].result).toBe('red');
  });

  test('a test failing with no message is red for the wrong reason', () => {
    expect(one('failed', []).rows[0].result).toBe('wrong-reason');
  });

  test('a skipped test fails the verdict', () => {
    expect(one('pending', []).rows[0]).toEqual({
      test: `${CONV}: DENY: a`,
      result: 'skipped',
      detail: 'did not run',
    });
  });

  test('a planned test missing from the results fails the verdict', () => {
    const got = verdict(jestJson(suite(HEAD_API, CONV, [])), planned, HEAD_API);
    expect(got).toEqual({
      ok: false,
      rows: [{ test: `${CONV}: DENY: a`, result: 'missing', detail: "not in jest's results" }],
    });
  });

  test('a planned test whose suite did not load is missing, with the suite message', () => {
    const got = verdict(
      jestJson(suite(HEAD_API, CONV, [], 'rules did not parse\nline 2')),
      planned,
      HEAD_API,
    );
    expect(got.rows[0]).toEqual({
      test: `${CONV}: DENY: a`,
      result: 'missing',
      detail: 'suite did not load: rules did not parse',
    });
  });

  test('results jest returned that were not planned are ignored', () => {
    const json = jestJson(
      suite(HEAD_API, CONV, [
        ['DENY: a', 'failed', [red]],
        ['DENY: other', 'passed'],
      ]),
    );
    expect(verdict(json, planned, HEAD_API).ok).toBe(true);
  });
});

describe('inScope', () => {
  const rulesFiles = [CONV, ROOM];

  test('names firestore.rules, a rules test, the helpers, the fixtures and the script', () => {
    const changed = [
      'firestore.rules',
      `express-api/${CONV}`,
      'express-api/tests/firestore-rules/_helpers/rules-source.js',
      'express-api/tests/firestore-rules/fixtures/firestore.rules.pre-shy-0653',
      'express-api/tests/firestore-rules/red-first-fixtures.json',
      'express-api/scripts/rules-red-first.js',
    ];
    expect(inScope([...changed, 'README.md', 'express-api/src/app.js'], rulesFiles)).toEqual(
      changed,
    );
  });

  test('is empty when nothing it covers changed', () => {
    expect(
      inScope(['README.md', 'firestore.rules.bak', 'express-api/tests/x.test.js'], rulesFiles),
    ).toEqual([]);
  });
});

describe('summary', () => {
  test('prints the base SHA, the count, every row, the renames and the fixture runs', () => {
    const md = summary({
      baseSha: SHA,
      rulesChanged: true,
      added: [t(CONV, 'DENY: a')],
      renamed: [{ from: `${CONV}: DENY: old`, to: `${CONV}: DENY: new` }],
      rows: [{ test: `${CONV}: DENY: a`, result: 'red', detail: '' }],
      fixtureRuns: [
        {
          story: 'SHY-0653',
          rules: 'tests/firestore-rules/fixtures/f',
          rows: [{ test: `${CONV}: DENY: z`, result: 'red', detail: '' }],
        },
      ],
    });
    for (const want of [
      SHA,
      '1 added DENY test',
      `| ${CONV}: DENY: a | red |`,
      `${CONV}: DENY: old → ${CONV}: DENY: new`,
      'SHY-0653',
      `| ${CONV}: DENY: z | red |`,
    ]) {
      expect(md).toContain(want);
    }
  });

  test('says 0 added DENY tests out loud when the rules changed and none were added', () => {
    const md = summary({
      baseSha: SHA,
      rulesChanged: true,
      added: [],
      renamed: [],
      rows: [],
      fixtureRuns: [],
    });
    expect(md).toContain('0 added DENY tests');
  });

  test('says the rules are unchanged when they are', () => {
    const md = summary({
      baseSha: SHA,
      rulesChanged: false,
      added: [],
      renamed: [],
      rows: [],
      fixtureRuns: [],
    });
    expect(md).toContain('firestore.rules is unchanged');
  });
});

describe('main', () => {
  const FIX = 'tests/firestore-rules/fixtures/firestore.rules.pre-shy-0653';
  const fixtures = [
    { story: 'SHY-0653', rules: FIX, tests: [{ file: CONV, fullName: 'DENY: z' }] },
  ];
  const headSource =
    "test('DENY: a', async () => { await assertFails(x()); });\ntest('DENY: b', async () => { await assertFails(y()); });";
  const baseSource = "test('DENY: a', async () => { await assertFails(x()); });";

  function deps({
    changed = ['firestore.rules'],
    files = {},
    runs = [],
    worktree = () => {},
  } = {}) {
    const calls = [];
    const out = [];
    const summaries = [];
    const disk = {
      [path.join(HEAD_API, CONV)]: headSource,
      [path.join(BASE_API, CONV)]: baseSource,
      [path.join(BASE, 'firestore.rules')]: 'rules_version = "2";',
      [path.join(HEAD_API, 'tests/firestore-rules/red-first-fixtures.json')]:
        JSON.stringify(fixtures),
      [path.join(HEAD_API, FIX)]: 'rules_version = "2"; // old',
      ...files,
    };
    const queue = [...runs];
    return {
      calls,
      out,
      summaries,
      d: {
        env: { BASE_SHA: SHA, RUNNER_TEMP: TMP },
        repoRoot: ROOT,
        git: {
          changedFiles: () => changed,
          addBaseWorktree: (sha, dir) => {
            calls.push(['worktree', sha, dir]);
            worktree();
          },
        },
        population: () => [CONV],
        exists: (p) => Object.hasOwn(disk, p),
        readFile: (p) => {
          if (!Object.hasOwn(disk, p)) throw new Error(`ENOENT ${p}`);
          return disk[p];
        },
        runJest: (args) => {
          calls.push(['jest', args]);
          const next = queue.shift();
          if (!next) throw new Error('unexpected jest run');
          return typeof next === 'function' ? next(args) : next;
        },
        write: (line) => out.push(line),
        appendSummary: (md) => summaries.push(md),
      },
    };
  }
  const listing = (cwd, names) =>
    jestJson(
      suite(
        cwd,
        CONV,
        names.map((n) => [n, 'pending']),
      ),
    );
  const fixtureRed = jestJson(suite(HEAD_API, CONV, [['DENY: z', 'failed', [red]]]));

  test('nothing in scope changed: exit 0, no worktree, no jest, and it says so', () => {
    const { d, calls, out, summaries } = deps({ changed: ['README.md'] });
    expect(main(d)).toBe(0);
    expect(calls).toEqual([]);
    expect(out.join('\n')).toContain('nothing to prove');
    expect(summaries).toEqual([expect.stringContaining(`base ${SHA}`)]);
  });

  test('rules changed: runs the added DENY test against the base rules, then the fixtures', () => {
    const { d, calls } = deps({
      runs: [
        listing(HEAD_API, ['DENY: a', 'DENY: b']),
        listing(BASE_API, ['DENY: a']),
        jestJson(suite(HEAD_API, CONV, [['DENY: b', 'failed', [red]]])),
        fixtureRed,
      ],
    });
    expect(main(d)).toBe(0);
    const jest = calls.filter((c) => c[0] === 'jest').map((c) => c[1]);
    expect(jest[0]).toEqual({ cwd: HEAD_API, files: [CONV], pattern: NEVER, env: {} });
    expect(jest[1]).toEqual({ cwd: BASE_API, files: [CONV], pattern: NEVER, env: {} });
    expect(jest[2]).toEqual({
      cwd: HEAD_API,
      files: [CONV],
      pattern: namePattern(['DENY: b']),
      env: { SHYTALK_RULES_UNDER_TEST: path.join(BASE, 'firestore.rules') },
    });
    expect(jest[3]).toEqual({
      cwd: HEAD_API,
      files: [CONV],
      pattern: namePattern(['DENY: z']),
      env: { SHYTALK_RULES_UNDER_TEST: path.join(HEAD_API, FIX) },
    });
    expect(calls[0]).toEqual(['worktree', SHA, BASE]);
  });

  test('an added DENY test passing on the base rules: exit 1, naming it', () => {
    const { d, out } = deps({
      runs: [
        listing(HEAD_API, ['DENY: a', 'DENY: b']),
        listing(BASE_API, ['DENY: a']),
        jestJson(suite(HEAD_API, CONV, [['DENY: b', 'passed']])),
        fixtureRed,
      ],
    });
    expect(main(d)).toBe(1);
    expect(out.join('\n')).toContain(`${CONV}: DENY: b`);
  });

  test('rules unchanged but a rules test changed: only the fixtures run', () => {
    const { d, calls } = deps({ changed: [`express-api/${CONV}`], runs: [fixtureRed] });
    expect(main(d)).toBe(0);
    expect(calls.filter((c) => c[0] === 'jest')).toHaveLength(1);
  });

  test('rules changed with no added DENY test: exit 0 with a notice saying 0', () => {
    const { d, out } = deps({
      files: { [path.join(HEAD_API, CONV)]: baseSource },
      runs: [listing(HEAD_API, ['DENY: a']), listing(BASE_API, ['DENY: a']), fixtureRed],
    });
    expect(main(d)).toBe(0);
    expect(out).toContain('::notice::firestore.rules changed and 0 added DENY tests were found');
  });

  test('a fixture case passing on its old rules: exit 1', () => {
    const { d } = deps({
      changed: [`express-api/${CONV}`],
      runs: [jestJson(suite(HEAD_API, CONV, [['DENY: z', 'passed']]))],
    });
    expect(main(d)).toBe(1);
  });

  test('the base worktree cannot be made: exit 1 naming the SHA', () => {
    const { d, out } = deps({
      worktree: () => {
        throw new Error('fatal: bad object');
      },
    });
    expect(main(d)).toBe(1);
    expect(out.join('\n')).toContain(`base ${SHA}`);
  });

  test('the base has no firestore.rules: exit 1', () => {
    const { d, out } = deps();
    const exists = d.exists;
    d.exists = (p) => p !== path.join(BASE, 'firestore.rules') && exists(p);
    expect(main(d)).toBe(1);
    expect(out.join('\n')).toContain('firestore.rules is absent at base');
  });

  test('a jest run that throws (no or unreadable --json output): exit 1 with its message', () => {
    const { d, out } = deps({
      runs: [
        () => {
          throw new Error('jest wrote no /runner/tmp/out.json');
        },
      ],
    });
    expect(main(d)).toBe(1);
    expect(out.join('\n')).toContain('jest wrote no /runner/tmp/out.json');
  });

  test('BASE_SHA unset: exit 1 before anything runs', () => {
    const { d, calls } = deps();
    d.env = { RUNNER_TEMP: TMP };
    expect(main(d)).toBe(1);
    expect(calls).toEqual([]);
  });

  test('the summary is appended on every exit path that ran', () => {
    const { d, summaries } = deps({ changed: [`express-api/${CONV}`], runs: [fixtureRed] });
    main(d);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toContain(SHA);
  });
});
