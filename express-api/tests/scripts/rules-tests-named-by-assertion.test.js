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

const fs = require('fs');
const path = require('path');
const {
  parseTestFile,
  walk,
  calls,
  literalText,
  extractTests,
} = require('../firestore-rules/_helpers/rules-test-names.js');

const TESTS_DIR = path.resolve(__dirname, '..');
const RULES_LIB = '@firebase/rules-unit-testing';

function testFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : testFiles(full);
    return entry.name.endsWith('.test.js') ? [full] : [];
  });
}

// True when the file destructures assertFails or assertSucceeds from require(RULES_LIB).
function takesRulesAsserts(ast) {
  let found = false;
  walk(ast, (n) => {
    if (
      n.type === 'VariableDeclarator' &&
      n.id.type === 'ObjectPattern' &&
      n.init &&
      n.init.type === 'CallExpression' &&
      n.init.callee.type === 'Identifier' &&
      n.init.callee.name === 'require' &&
      n.init.arguments[0] &&
      literalText(n.init.arguments[0]) === RULES_LIB &&
      n.id.properties.some((p) => p.key && ['assertFails', 'assertSucceeds'].includes(p.key.name))
    ) {
      found = true;
    }
  });
  return found;
}

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

const rulesFiles = testFiles(TESTS_DIR)
  .map((file) => ({ file, source: fs.readFileSync(file, 'utf8') }))
  .filter(({ source }) => source.includes('initializeTestEnvironment'))
  .filter(({ file, source }) => {
    const ast = parseTestFile(source, file);
    return calls(ast, 'initializeTestEnvironment').length > 0 && takesRulesAsserts(ast);
  })
  .map((s) => ({ ...s, rel: path.relative(TESTS_DIR, s.file) }));

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
