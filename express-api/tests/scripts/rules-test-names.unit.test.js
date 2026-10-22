'use strict';

/**
 * rules-test-names.unit.test.js — SHY-0657.
 *
 * `tests/firestore-rules/_helpers/rules-test-names.js` reads a rules test
 * file as an AST (comments are not nodes, so nothing in a comment can count)
 * for the rules-test guards and the red-first CI step. Inline sources only.
 */

const {
  parseTestFile,
  walk,
  requires,
  calls,
  extractTests,
  familyRegex,
  testFilesUnder,
} = require('../firestore-rules/_helpers/rules-test-names.js');

const F = 'x.test.js';
const one = (source) => {
  const tests = extractTests(source, F);
  expect(tests).toHaveLength(1);
  return tests[0];
};

describe('extractTests', () => {
  test('gives the jest full name: describe titles then the title, space-joined', () => {
    const t = one(
      "describe('a', () => { describe('b c', () => { test('DENY: d', () => {}); }); });",
    );
    expect([t.fullName, t.title, t.describePath, t.file]).toEqual([
      'a b c DENY: d',
      'DENY: d',
      ['a', 'b c'],
      F,
    ]);
  });

  test('reads it(), test.skip() and a template title with no ${}', () => {
    const names = extractTests('it(`ALLOW: a`, () => {});\ntest.skip("DENY: b", () => {});', F).map(
      (t) => t.fullName,
    );
    expect(names).toEqual(['ALLOW: a', 'DENY: b']);
  });

  test('throws naming file and line on a title with ${}', () => {
    expect(() => extractTests('\ntest(`DENY: ${x}`, () => {});', F)).toThrow(
      'x.test.js:2 test title is not a plain string',
    );
  });

  test('throws naming file and line on a describe title that is not a plain string', () => {
    expect(() => extractTests('describe(name, () => {});', F)).toThrow(
      'x.test.js:1 describe title is not a plain string',
    );
  });

  test('reads describe.skip like describe', () => {
    expect(one("describe.skip('d', () => { test('DENY: a', () => {}); });").fullName).toBe(
      'd DENY: a',
    );
  });

  test('a test with no callback has no body, no code and asserts nothing', () => {
    const t = one("test('DENY: a');");
    expect([t.body, t.code, t.asserts]).toEqual(['', '', { fails: false, succeeds: false }]);
  });

  test('throws on test.todo and other test forms it does not read', () => {
    expect(() => extractTests("test.todo('DENY: later');", F)).toThrow(
      'x.test.js:1 test.todo is not read',
    );
  });

  test('keeps the body source of the test callback', () => {
    expect(one("test('DENY: a', async () => {\n  await assertFails(op());\n});").body).toBe(
      'async () => {\n  await assertFails(op());\n}',
    );
  });

  test('gives the code: the callback as its tokens, comments dropped, one space apart', () => {
    const t = one(
      "test('DENY: a', async () => {\n  // why\n  await assertFails(/* the op */ op('a // b'));\n});",
    );
    expect(t.code).toBe("async ( ) => { await assertFails ( op ( 'a // b' ) ) ; }");
  });

  // NO HOLES (2026-10-21): collapsing whitespace in the raw text also collapsed it
  // inside string literals, so doc('a b') -> doc('a  b') read as no change.
  test('whitespace inside a string literal is part of the code', () => {
    const a = one("test('DENY: a', async () => { await assertFails(doc('a b')); });");
    const b = one("test('DENY: a', async () => { await assertFails(doc('a  b')); });");
    expect(b.code).not.toBe(a.code);
  });

  test('whitespace inside a template literal is part of the code', () => {
    const a = one("test('DENY: a', async () => { await assertFails(doc(`a ${x} b`)); });");
    const b = one("test('DENY: a', async () => { await assertFails(doc(`a ${x}  b`)); });");
    expect(b.code).not.toBe(a.code);
  });

  test('two callbacks differing only in comments and whitespace have the same code', () => {
    const a = one("test('DENY: a', async () => { await assertFails(op()); });");
    const b = one(
      "test('DENY: a', async () => {\n  // reworded note\n  await   assertFails(op());\n});",
    );
    expect(b.code).toBe(a.code);
  });

  test('sees assertFails and assertSucceeds called directly', () => {
    expect(
      one("test('DENY: a', async () => { await assertSucceeds(x()); await assertFails(y()); });")
        .asserts,
    ).toEqual({
      fails: true,
      succeeds: true,
    });
  });

  test('follows a local function declaration and a const arrow to a fixed point', () => {
    const source = [
      'async function denied(op) { await assertFails(op); }',
      'const deniedTwice = async (op) => { await denied(op); await denied(op); };',
      "test('DENY: a', async () => { await deniedTwice(x()); });",
    ].join('\n');
    expect(one(source).asserts).toEqual({ fails: true, succeeds: false });
  });

  test('a call to an unrelated helper asserts nothing', () => {
    expect(one("function seed() {}\ntest('x', async () => { await seed(); });").asserts).toEqual({
      fails: false,
      succeeds: false,
    });
  });

  test('reads test.each(table)(title, fn) as one family with its template', () => {
    const t = one(
      "describe('d', () => { test.each(ROWS)('DENY: banned %s', async (_l, e) => { await assertFails(e.op()); }); });",
    );
    expect([t.family, t.title, t.fullName, t.asserts.fails]).toEqual([
      true,
      'DENY: banned %s',
      'd DENY: banned %s',
      true,
    ]);
  });
});

describe('familyRegex', () => {
  test('matches each row name jest prints for a %s family, and no other', () => {
    const re = familyRegex('d DENY: banned %s (x)');
    expect(
      ['d DENY: banned users write (x)', 'd DENY: banned a.b (x)'].every((n) => re.test(n)),
    ).toBe(true);
    expect(
      ['d DENY: banned users write (y)', 'e DENY: banned a (x)', 'd DENY: banned  (x) more'].some(
        (n) => re.test(n),
      ),
    ).toBe(false);
  });

  test('reads %d %i %p %j %o %# as row values and %% as a literal percent', () => {
    const re = familyRegex('a %d %i %p %j %o %# 100%%');
    expect(re.test('a 1 2 "p" {} {} 0 100%')).toBe(true);
    expect(re.test('a 1 2 "p" {} {} 0 100%%')).toBe(false);
  });
});

describe('parseTestFile', () => {
  test('throws naming the file on a syntax error', () => {
    expect(() => parseTestFile('test(', 'broken.test.js')).toThrow('broken.test.js:');
  });
});

describe('walk', () => {
  test('visits every node once, comments excluded', () => {
    const ast = parseTestFile('// initializeTestEnvironment()\nfoo(bar);', 'a.test.js');
    const names = [];
    walk(ast, (n) => n.type === 'Identifier' && names.push(n.name));
    expect(names).toEqual(['foo', 'bar']);
  });
});

describe('testFilesUnder', () => {
  // A stand-in directory tree: no file system is touched.
  const tree = {
    '/t': [
      { name: 'a.test.js', isDirectory: () => false },
      { name: 'b.js', isDirectory: () => false },
      { name: 'sub', isDirectory: () => true },
      { name: 'node_modules', isDirectory: () => true },
    ],
    '/t/sub': [{ name: 'c.test.js', isDirectory: () => false }],
    '/t/node_modules': [{ name: 'd.test.js', isDirectory: () => false }],
  };
  const readdir = (dir) => tree[dir];

  test('lists every *.test.js below, and never descends into node_modules', () => {
    expect(testFilesUnder('/t', readdir)).toEqual(['/t/a.test.js', '/t/sub/c.test.js']);
  });
});

describe('requires', () => {
  test('lists every require() literal, destructured or not', () => {
    const ast = parseTestFile(
      'const { a } = require(\'./x\');\nconst b = require("y");\nrequire(`z`);',
      'a.test.js',
    );
    expect(requires(ast)).toEqual(['./x', 'y', 'z']);
  });

  test('ignores a require with no argument or more than one', () => {
    expect(requires(parseTestFile("require();\nrequire('a', 'b');", 'a.test.js'))).toEqual([]);
  });

  test('ignores a require named only in a string or comment', () => {
    const ast = parseTestFile("// require('./x')\nconst s = \"require('./y')\";", 'a.test.js');
    expect(requires(ast)).toEqual([]);
  });
});

describe('calls', () => {
  test('returns each call to a bare identifier with that name', () => {
    const ast = parseTestFile('init({ a: 1 });\nother();\nobj.init();\ninit();', 'a.test.js');
    expect(calls(ast, 'init').map((c) => c.arguments.length)).toEqual([1, 0]);
  });
});
