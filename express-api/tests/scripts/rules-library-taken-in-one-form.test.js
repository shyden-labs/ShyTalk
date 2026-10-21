'use strict';

/**
 * rules-library-taken-in-one-form.test.js — SHY-0657.
 *
 * The rules-test guards and the red-first CI step find a rules test file, and
 * what each test asserts, by reading `const { assertFails, ... } =
 * require('@firebase/rules-unit-testing')` and bare calls to those names.
 * Any other way of taking the library would hide a refusal from them: a
 * namespace require (`rut.assertFails(...)`) leaves the file outside the
 * rules test population, a renamed key (`{ assertFails: deny }`) hides the
 * assertion, and an `import` or a non-literal require is not read at all.
 * So every test file takes the library in that one form, which is the only
 * form the tree uses today (grepped 2026-10-21). NO HOLES, 2026-10-21.
 *
 * Population: every test file whose comment-free text names the library,
 * cross-checked against the string literals the parser finds naming it.
 */

const fs = require('fs');
const path = require('path');
const {
  RULES_LIB,
  parseTestFile,
  walk,
  literalText,
  testFilesUnder,
} = require('../firestore-rules/_helpers/rules-test-names.js');

const TESTS_DIR = path.resolve(__dirname, '..');
const LIBRARY_NAMES = new Set(['assertFails', 'assertSucceeds', 'initializeTestEnvironment']);

// Every way `source` takes the rules library other than the one form; empty when it holds.
function formFindings(source, file) {
  const ast = parseTestFile(source, file);
  const out = [];
  const at = (n) => `line ${n.loc.start.line}`;
  walk(ast, (n) => {
    if (n.type === 'ImportDeclaration' && n.source.value === RULES_LIB) {
      out.push(`${at(n)}: imports ${RULES_LIB}; require it with destructuring`);
    }
    if (
      n.type === 'CallExpression' &&
      n.callee.type === 'Identifier' &&
      n.callee.name === 'require'
    ) {
      const arg = n.arguments[0];
      if (!arg || literalText(arg) === null)
        out.push(`${at(n)}: a require whose module cannot be read`);
    }
    if (
      n.type === 'VariableDeclarator' &&
      n.init &&
      n.init.type === 'CallExpression' &&
      n.init.callee.type === 'Identifier' &&
      n.init.callee.name === 'require' &&
      n.init.arguments[0] &&
      literalText(n.init.arguments[0]) === RULES_LIB
    ) {
      if (n.id.type !== 'ObjectPattern') {
        out.push(`${at(n)}: requires ${RULES_LIB} without destructuring`);
      } else {
        for (const p of n.id.properties) {
          const key = p.key && p.key.name;
          if (
            p.type !== 'ObjectProperty' ||
            p.value.type !== 'Identifier' ||
            p.value.name !== key
          ) {
            out.push(`${at(n)}: takes ${key ?? 'a rest element'} under another name`);
          }
        }
      }
    }
    if (
      n.type === 'MemberExpression' &&
      !n.computed &&
      n.property.type === 'Identifier' &&
      LIBRARY_NAMES.has(n.property.name)
    ) {
      out.push(`${at(n)}: calls ${n.property.name} as a member`);
    }
  });
  // The library may be named only as the module of a declared require: a
  // jest.mock, a requireActual, a require inside an expression is refused,
  // since each could hand a test something other than the real assertions.
  const allowed = new Set();
  walk(ast, (n) => {
    if (
      n.type === 'VariableDeclarator' &&
      n.init &&
      n.init.type === 'CallExpression' &&
      n.init.callee.type === 'Identifier' &&
      n.init.callee.name === 'require' &&
      n.init.arguments[0]
    ) {
      allowed.add(n.init.arguments[0]);
    }
  });
  walk(ast, (n) => {
    const text = n.type === 'StringLiteral' || n.type === 'TemplateLiteral' ? literalText(n) : null;
    if (text === RULES_LIB && !allowed.has(n)) {
      out.push(`${at(n)}: names ${RULES_LIB} outside a destructuring require`);
    }
  });
  return out;
}

// String literals naming the library, as the parser sees them.
function literalMentions(source, file) {
  let count = 0;
  walk(parseTestFile(source, file), (n) => {
    if (n.type === 'StringLiteral' && n.value === RULES_LIB) count += 1;
  });
  return count;
}

// The same count made from the text alone, comments excluded, without the parser.
function textMentions(source) {
  let count = 0;
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
    } else if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) throw new Error('unterminated block comment');
      i = end + 2;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < source.length && source[j] !== c) j += source[j] === '\\' ? 2 : 1;
      if (c !== '`' && source.slice(i + 1, j) === RULES_LIB) count += 1;
      i = j + 1;
    } else {
      i++;
    }
  }
  return count;
}

const files = testFilesUnder(TESTS_DIR)
  .map((file) => ({
    file,
    rel: path.relative(TESTS_DIR, file),
    source: fs.readFileSync(file, 'utf8'),
  }))
  .filter(({ source }) => source.includes(RULES_LIB));

describe('the files that name the rules library', () => {
  test('are every test file that names it today', () => {
    // The population rides inside the verdict, so a failure prints it whole.
    const rels = files.map((f) => f.rel);
    expect({ of: 'test files naming the library', count: rels.length, files: rels }).toEqual({
      of: 'test files naming the library',
      count: 15,
      files: rels,
    });
  });

  test.each(files.map((f) => [f.rel, f]))(
    '%s: text and parser count the same mentions',
    (_rel, f) => {
      expect({ file: f.rel, parser: literalMentions(f.source, f.file) }).toEqual({
        file: f.rel,
        parser: textMentions(f.source),
      });
    },
  );
});

describe('each file takes the library in the one form', () => {
  test.each(files.map((f) => [f.rel, f]))('%s', (_rel, f) => {
    expect({ file: f.rel, findings: formFindings(f.source, f.file) }).toEqual({
      file: f.rel,
      findings: [],
    });
  });
});

describe('planted forms turn the check red', () => {
  const lib = `'${RULES_LIB}'`;

  test('the one form has no findings', () => {
    const clean = `const { assertFails, initializeTestEnvironment } = require(${lib});\nassertFails(x());`;
    expect(formFindings(clean, 'p.test.js')).toEqual([]);
  });

  test('a namespace require and a member call are caught', () => {
    const planted = `const rut = require(${lib});\nrut.assertFails(x());`;
    expect(formFindings(planted, 'p.test.js')).toEqual([
      `line 1: requires ${RULES_LIB} without destructuring`,
      'line 2: calls assertFails as a member',
    ]);
  });

  test('a renamed key and a rest element are caught', () => {
    const planted = `const { assertFails: deny, ...rest } = require(${lib});`;
    expect(formFindings(planted, 'p.test.js')).toEqual([
      'line 1: takes assertFails under another name',
      'line 1: takes a rest element under another name',
    ]);
  });

  test('an import is caught', () => {
    expect(formFindings(`import { assertFails } from ${lib};`, 'p.test.js')).toEqual([
      `line 1: imports ${RULES_LIB}; require it with destructuring`,
      `line 1: names ${RULES_LIB} outside a destructuring require`,
    ]);
  });

  test('a require whose module is computed is caught', () => {
    expect(formFindings('const lib = require(name);', 'p.test.js')).toEqual([
      'line 1: a require whose module cannot be read',
    ]);
  });

  test('a require of the library outside a declaration is caught', () => {
    expect(formFindings(`use(require(${lib}).assertFails);`, 'p.test.js')).toEqual([
      'line 1: calls assertFails as a member',
      `line 1: names ${RULES_LIB} outside a destructuring require`,
    ]);
  });

  // H5b: a mock of the library could make assertFails pass whatever the rules do.
  test('jest.mock of the library is caught', () => {
    const planted = `jest.mock(${lib}, () => ({ assertFails: async () => {} }));\nconst { assertFails } = require(${lib});`;
    expect(formFindings(planted, 'p.test.js')).toEqual([
      `line 1: names ${RULES_LIB} outside a destructuring require`,
    ]);
  });

  test('jest.requireActual of the library is caught', () => {
    expect(formFindings(`const real = jest.requireActual(${lib});`, 'p.test.js')).toEqual([
      `line 1: names ${RULES_LIB} outside a destructuring require`,
    ]);
  });

  test('the text count sees a mention the parser does not, and skips a comment', () => {
    expect(textMentions(`// ${lib}\nconst s = ${lib};`)).toBe(1);
    expect(literalMentions(`// ${lib}\nconst s = ${lib};`, 'p.test.js')).toBe(1);
  });
});
