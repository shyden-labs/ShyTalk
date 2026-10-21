'use strict';

/**
 * rules-tests-named-by-assertion.test.js — SHY-0657.
 *
 * Every rules test is named by what it asserts (Shyden, 2026-10-21:
 * "consistency is important"): a test that reaches assertFails, directly or
 * through a file-local helper, is titled `DENY: …`; any other test that
 * reaches assertSucceeds is titled `ALLOW: …`; a rules test that reaches
 * neither is refused. The red-first CI step finds the refusals a PR adds by
 * the `DENY: ` prefix, so a refusal named any other way would never be shown
 * red on the base rules; this guard is what makes the prefix trustworthy.
 *
 * Rules test files: emulator test files (they call initializeTestEnvironment)
 * that take assertFails or assertSucceeds from @firebase/rules-unit-testing.
 * Derived from the filesystem. Each file is cross-checked by a text count of
 * its test openers and `DENY: ` titles, made without the parser.
 */

const path = require('path');
const fs = require('fs');
const {
  RULES_LIB,
  parseTestFile,
  walk,
  literalText,
  requires,
  extractTests,
  rulesTestFiles,
} = require('../firestore-rules/_helpers/rules-test-names.js');
const { REASON } = require('../../scripts/rules-red-first.js');
const { ALLOW_REFUSED } = require('../firestore-rules/_helpers/red-first-refusal.js');

const TESTS_DIR = path.resolve(__dirname, '..');

// Source with comments removed and string contents kept; quote-aware, no parser.
function withoutComments(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
    } else if (c === '/' && source[i + 1] === '*') {
      i = source.indexOf('*/', i + 2);
      if (i === -1) throw new Error('unterminated block comment');
      i += 2;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < source.length && source[j] !== c) j += source[j] === '\\' ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const OPENER = /(?<![\w.$])(?:test|it)(?:\.(?:skip|only|concurrent|each))?\(/g;
const DENY_TITLE =
  /(?<![\w.$])(?:(?:test|it)(?:\.(?:skip|only|concurrent))?\(|\)\()\s*['"`]DENY: /g;

// Every way `source` breaks the naming rule; empty when it holds.
function namingFindings(source, file) {
  const out = [];
  const tests = extractTests(source, file);
  const seen = new Set();
  for (const t of tests) {
    const want = t.asserts.fails ? 'DENY' : t.asserts.succeeds ? 'ALLOW' : null;
    if (!want) out.push(`line ${t.line}: asserts neither assertFails nor assertSucceeds`);
    else if (!t.title.startsWith(`${want}: `))
      out.push(`line ${t.line}: must be titled "${want}: …"`);
    if (seen.has(t.fullName)) out.push(`line ${t.line}: duplicate full name "${t.fullName}"`);
    seen.add(t.fullName);
  }
  const text = withoutComments(source);
  const openers = (text.match(OPENER) || []).length;
  if (openers !== tests.length)
    out.push(`text shows ${openers} test openers, the parser read ${tests.length}`);
  const denyTitles = (text.match(DENY_TITLE) || []).length;
  const denyParsed = tests.filter((t) => t.title.startsWith('DENY: ')).length;
  if (denyTitles !== denyParsed)
    out.push(`text shows ${denyTitles} DENY titles, the parser read ${denyParsed}`);
  return out;
}

const rulesFiles = rulesTestFiles(TESTS_DIR).map((s) => ({
  ...s,
  rel: path.relative(TESTS_DIR, s.file),
}));

describe('the rules test population', () => {
  test('is six files holding 231 rules tests', () => {
    // The population rides inside the verdict, so a failure prints it whole.
    const files = rulesFiles.map((s) => s.rel);
    const tests = rulesFiles.reduce((n, s) => n + extractTests(s.source, s.file).length, 0);
    expect({ of: 'rules test files', count: files.length, tests, files }).toEqual({
      of: 'rules test files',
      count: 6,
      tests: 231,
      files,
    });
  });
});

describe('each rules test is named by what it asserts', () => {
  test.each(rulesFiles.map((s) => [s.rel, s]))('%s', (_name, s) => {
    expect({ file: s.rel, findings: namingFindings(s.source, s.file) }).toEqual({
      file: s.rel,
      findings: [],
    });
  });
});

// A rules test proves a change only through assertFails / assertSucceeds meeting
// the rules (NO HOLES, 2026-10-21). Throwing, building an Error, rejecting by
// hand, or reading which rules are loaded could fake the first line the
// red-first step reads, so none is allowed; nor is a module beyond the five
// they require today, whose local ones never hold either proof text.
const ALLOWED_REQUIRES = [
  '../helpers/firebase-emulator',
  './_helpers/rules-source',
  RULES_LIB,
  'firebase/compat/app',
  'firebase/compat/firestore',
];
const PROOF_TEXTS = [REASON, ALLOW_REFUSED];

function fakeFindings(source, file) {
  const ast = parseTestFile(source, file);
  const out = [];
  const at = (n) => `line ${n.loc.start.line}`;
  walk(ast, (n) => {
    if (n.type === 'ThrowStatement') out.push(`${at(n)}: throws`);
    if (
      (n.type === 'NewExpression' || n.type === 'CallExpression') &&
      n.callee.type === 'Identifier' &&
      /Error$/.test(n.callee.name)
    ) {
      out.push(`${at(n)}: builds a ${n.callee.name}`);
    }
    if (
      n.type === 'MemberExpression' &&
      !n.computed &&
      n.object.type === 'Identifier' &&
      n.object.name === 'Promise' &&
      n.property.name === 'reject'
    ) {
      out.push(`${at(n)}: rejects by hand`);
    }
    if (n.type === 'MemberExpression' && n.object.type === 'MemberExpression') {
      const o = n.object;
      const isEnv =
        o.object.type === 'Identifier' &&
        o.object.name === 'process' &&
        !o.computed &&
        o.property.name === 'env';
      const name = n.computed ? literalText(n.property) : n.property.name;
      if (isEnv && name !== 'JEST_WORKER_ID')
        out.push(`${at(n)}: reads process.env other than JEST_WORKER_ID`);
    }
  });
  walk(ast, (n) => {
    if (n.type === 'VariableDeclarator' && n.init && n.init.type === 'MemberExpression') {
      const m = n.init;
      if (
        m.object.type === 'Identifier' &&
        m.object.name === 'process' &&
        m.property.name === 'env'
      ) {
        out.push(`${at(n)}: takes process.env whole`);
      }
    }
  });
  for (const r of requires(ast)) {
    if (!ALLOWED_REQUIRES.includes(r)) out.push(`requires ${r}, beyond the five rules tests use`);
  }
  for (const text of PROOF_TEXTS)
    if (source.includes(text)) out.push(`holds the proof text "${text}"`);
  return out;
}

describe('a rules test cannot fake a proof', () => {
  test.each(rulesFiles.map((s) => [s.rel, s]))('%s', (_name, s) => {
    expect({ file: s.rel, findings: fakeFindings(s.source, s.file) }).toEqual({
      file: s.rel,
      findings: [],
    });
  });

  test('the local modules rules tests require hold neither proof text', () => {
    const local = [
      '../helpers/firebase-emulator.js',
      '../firestore-rules/_helpers/rules-source.js',
    ];
    const hits = local
      .map((m) => ({ m, text: fs.readFileSync(path.resolve(__dirname, m), 'utf8') }))
      .filter(({ text }) => PROOF_TEXTS.some((p) => text.includes(p)))
      .map(({ m }) => m);
    expect(hits).toEqual([]);
  });

  const lib = `'${RULES_LIB}'`;
  test('a clean rules test has no findings', () => {
    const clean = `const { assertFails } = require(${lib});\nconst ID = \`p-\${process.env.JEST_WORKER_ID}\`;\ntest('DENY: a', async () => { await assertFails(x()); });`;
    expect(fakeFindings(clean, 'p.test.js')).toEqual([]);
  });

  test('every way to fake a proof is caught', () => {
    const planted = [
      "test('DENY: a', async () => { throw new Error('x'); });",
      "test('DENY: b', async () => { await Promise.reject(TypeError('y')); });",
      "test('ALLOW: c', async () => { if (process.env.SHYTALK_RULES_UNDER_TEST) await z(); });",
      'const env = process.env;',
      "const other = require('./sneaky');",
    ].join('\n');
    expect(fakeFindings(planted, 'p.test.js')).toEqual([
      'line 1: throws',
      'line 1: builds a Error',
      'line 2: rejects by hand',
      'line 2: builds a TypeError',
      'line 3: reads process.env other than JEST_WORKER_ID',
      'line 4: takes process.env whole',
      'requires ./sneaky, beyond the five rules tests use',
    ]);
  });

  test('a proof text held in a rules test is caught', () => {
    expect(fakeFindings(`const s = '${REASON}';`, 'p.test.js')).toEqual([
      `holds the proof text "${REASON}"`,
    ]);
  });
});

describe('planted files turn the check red', () => {
  const head = "const { assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');\n";

  test('a clean file has no findings', () => {
    const clean = `${head}test('DENY: a', async () => { await assertFails(x()); });\nit("ALLOW: b", async () => { await assertSucceeds(y()); });`;
    expect(namingFindings(clean, 'p.test.js')).toEqual([]);
  });

  test('a refusal test with no prefix is caught', () => {
    const planted = `${head}test('a member cannot post', async () => { await assertFails(x()); });`;
    expect(namingFindings(planted, 'p.test.js')).toEqual(['line 2: must be titled "DENY: …"']);
  });

  test('an ALLOW title on a test that reaches assertFails through a helper is caught', () => {
    const planted = `${head}const denied = (op) => assertFails(op);\ntest('ALLOW: posts', async () => { await assertSucceeds(a()); await denied(b()); });`;
    expect(namingFindings(planted, 'p.test.js')).toEqual(['line 3: must be titled "DENY: …"']);
  });

  test('a rules test asserting neither is caught', () => {
    const planted = `${head}test('DENY: posts', async () => { expect(await x()).toBeNull(); });`;
    expect(namingFindings(planted, 'p.test.js')).toEqual([
      'line 2: asserts neither assertFails nor assertSucceeds',
    ]);
  });

  test('a duplicate full name is caught', () => {
    const t = "test('DENY: a', async () => { await assertFails(x()); });\n";
    expect(namingFindings(`${head}${t}${t}`, 'p.test.js')).toEqual([
      'line 3: duplicate full name "DENY: a"',
    ]);
  });

  test('the text count and the parser disagreeing is caught', () => {
    // The text pass keeps string contents, so a test call written inside a
    // string is seen by the text and not by the parser: the counts differ.
    const planted = `${head}test('DENY: a', async () => { await assertFails(x()); });\nconst s = "it('DENY: b'";`;
    expect(namingFindings(planted, 'p.test.js')).toEqual([
      'text shows 2 test openers, the parser read 1',
      'text shows 2 DENY titles, the parser read 1',
    ]);
  });

  test('a test title the parser cannot read fails closed', () => {
    const planted = `${head}it(\`ALLOW: \${n}\`, async () => { await assertSucceeds(y()); });`;
    expect(() => namingFindings(planted, 'p.test.js')).toThrow(
      'p.test.js:2 test title is not a plain string',
    );
  });

  test('a comment holding a DENY test counts for nothing', () => {
    const planted = `${head}// test('DENY: old', () => {})\ntest('DENY: a', async () => { await assertFails(x()); });`;
    expect(namingFindings(planted, 'p.test.js')).toEqual([]);
  });
});
