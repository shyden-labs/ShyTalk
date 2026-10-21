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
// Calls that replace or hand over a module, read on any object (an alias of jest too).
const MODULE_MOCKS = new Set([
  'mock',
  'doMock',
  'setMock',
  'requireMock',
  'requireActual',
  'unstable_mockModule',
]);

// A module mock whose module is computed could replace the rules library under a
// name no literal shows; every module mock must name its module literally.
function mockFindings(ast) {
  const out = [];
  const at = (n) => `line ${n.loc.start.line}`;
  // jest and every name bound to it (const j = jest; const k = j), to a fixed point.
  const jestNames = new Set(['jest']);
  let grew = true;
  while (grew) {
    grew = false;
    walk(ast, (n) => {
      if (
        n.type === 'VariableDeclarator' &&
        n.id.type === 'Identifier' &&
        n.init &&
        n.init.type === 'Identifier' &&
        jestNames.has(n.init.name) &&
        !jestNames.has(n.id.name)
      ) {
        jestNames.add(n.id.name);
        grew = true;
      }
    });
  }
  walk(ast, (n) => {
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression') {
      const { object, property, computed } = n.callee;
      const name = computed
        ? literalText(property)
        : property.type === 'Identifier'
          ? property.name
          : null;
      if (
        name !== null &&
        MODULE_MOCKS.has(name) &&
        (!n.arguments[0] || literalText(n.arguments[0]) === null)
      ) {
        out.push(`${at(n)}: a module mock (${name}) whose module cannot be read`);
      }
      if (computed && name === null && object.type === 'Identifier' && jestNames.has(object.name)) {
        out.push(`${at(n)}: a jest call the guard cannot read`);
      }
    }
    if (
      n.type === 'VariableDeclarator' &&
      n.id.type === 'ObjectPattern' &&
      n.init &&
      n.init.type === 'Identifier' &&
      jestNames.has(n.init.name)
    ) {
      out.push(`${at(n)}: takes jest apart`);
    }
    if (
      (n.type === 'CallExpression' || n.type === 'NewExpression') &&
      n.callee.type === 'Identifier' &&
      (n.callee.name === 'eval' || n.callee.name === 'Function')
    ) {
      out.push(`${at(n)}: runs code from a string (${n.callee.name})`);
    }
  });
  return out;
}

// Every way `source` takes the rules library other than the one form; empty when it holds.
function formFindings(source, file) {
  const ast = parseTestFile(source, file);
  const out = mockFindings(ast);
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

// A file that builds the library's name never names it, so this reads every
// test file, not only the files above: a jest[m] call, an eval or a jest method
// taken apart need not contain `.mock(` at all, so no text filter comes first.
describe('no test file mocks a module it does not name', () => {
  const mocking = testFilesUnder(TESTS_DIR).map((file) => ({
    file,
    rel: path.relative(TESTS_DIR, file),
    source: fs.readFileSync(file, 'utf8'),
  }));

  test('reads all 588 test files', () => {
    // Measured 2026-10-21; SHY-0556 moves this figure to the floors record.
    const rels = mocking.map((m) => m.rel);
    expect({ of: 'test files', count: rels.length, files: rels }).toEqual({
      of: 'test files',
      count: 588,
      files: rels,
    });
  });

  test('none mocks a module whose name is computed', () => {
    const hits = mocking
      .map((m) => ({ file: m.rel, findings: mockFindings(parseTestFile(m.source, m.file)) }))
      .filter((h) => h.findings.length > 0);
    expect(hits).toEqual([]);
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

  // Claimed caught in 2a506c004c8's message without a test; tested here.
  test('a mock through an alias of jest still names the library, and is caught', () => {
    expect(formFindings(`const j = jest;\nj.mock(${lib}, () => ({}));`, 'p.test.js')).toEqual([
      `line 2: names ${RULES_LIB} outside a destructuring require`,
    ]);
  });

  test('a module mock whose module is computed is caught', () => {
    const planted =
      "jest.mock('@firebase/' + 'rules-unit-testing', () => ({}));\njest.doMock(name);";
    expect(formFindings(planted, 'p.test.js')).toEqual([
      'line 1: a module mock (mock) whose module cannot be read',
      'line 2: a module mock (doMock) whose module cannot be read',
    ]);
  });

  test('every module-replacing jest call is read: setMock, requireMock, unstable_mockModule', () => {
    const planted =
      'jest.setMock(a, {});\njest.requireMock(b);\njest.unstable_mockModule(c, () => ({}));';
    expect(formFindings(planted, 'p.test.js')).toEqual([
      'line 1: a module mock (setMock) whose module cannot be read',
      'line 2: a module mock (requireMock) whose module cannot be read',
      'line 3: a module mock (unstable_mockModule) whose module cannot be read',
    ]);
  });

  // The gap named in d5425a561b8's message, closed rather than left open.
  test('a module mock named by a literal property is read: jest["mock"](name)', () => {
    expect(formFindings("jest['mock'](name);", 'p.test.js')).toEqual([
      'line 1: a module mock (mock) whose module cannot be read',
    ]);
  });

  test('a computed call on jest or an alias of it is caught', () => {
    expect(formFindings('jest[m](name);\nconst j = jest;\nj[m](name);', 'p.test.js')).toEqual([
      'line 1: a jest call the guard cannot read',
      'line 3: a jest call the guard cannot read',
    ]);
  });

  test('taking jest apart is caught', () => {
    expect(formFindings('const { mock } = jest;\nmock(name);', 'p.test.js')).toEqual([
      'line 1: takes jest apart',
    ]);
  });

  test('eval and new Function are caught', () => {
    expect(formFindings("eval('x');\nconst f = new Function('x');", 'p.test.js')).toEqual([
      'line 1: runs code from a string (eval)',
      'line 2: runs code from a string (Function)',
    ]);
  });

  test("supertest's request(app)[verb](url) is not a jest call", () => {
    expect(formFindings('request(app)[verb](url);', 'p.test.js')).toEqual([]);
  });

  // Claimed in 8177e0c7d3e's message: a module mock is read on any object.
  test('a module mock with a computed module is caught on any object, jest held in a field too', () => {
    expect(formFindings('const o = { j: jest };\no.j.mock(name);', 'p.test.js')).toEqual([
      'line 2: a module mock (mock) whose module cannot be read',
    ]);
  });

  test('the text count sees a mention the parser does not, and skips a comment', () => {
    expect(textMentions(`// ${lib}\nconst s = ${lib};`)).toBe(1);
    expect(literalMentions(`// ${lib}\nconst s = ${lib};`, 'p.test.js')).toBe(1);
  });
});

// Config that could hand every test a stand-in for the library without touching
// a test file: a module map, extra resolution paths, a resolver, a setup file
// that mocks it, a Babel plugin rewriting test code, or a committed
// node_modules folder that Node would resolve first. Pinned to today's
// measured config (2026-10-21): any new key is a finding until reviewed.
const JEST_KEYS = [
  'testEnvironment',
  'maxWorkers',
  'workerIdleMemoryLimit',
  'testTimeout',
  'setupFiles',
  'globalSetup',
  'restoreMocks',
  'clearMocks',
  'resetMocks',
  'testMatch',
  'testPathIgnorePatterns',
  'coverageDirectory',
  'coverageReporters',
  'collectCoverageFrom',
  'transform',
];
const TRANSFORM = {
  'public[\\\\/]js[\\\\/]core[\\\\/].*\\.js$': '<rootDir>/tests/client-core/esm-transform.js',
  '\\.js$': 'babel-jest',
};
const BABEL_CONFIG = /(^|\/)(\.babelrc(\.\w+)?|babel\.config\.\w+)$/;

// Every way the jest setup could replace the library; empty when it holds.
function configFindings({ config, setupSources, tracked, pkg }) {
  const out = [];
  for (const k of Object.keys(config))
    if (!JEST_KEYS.includes(k)) out.push(`jest config key ${k} is not reviewed`);
  if (JSON.stringify(config.transform) !== JSON.stringify(TRANSFORM))
    out.push('jest transform changed');
  for (const [name, source] of Object.entries(setupSources)) {
    if (source.includes(RULES_LIB)) out.push(`${name} names ${RULES_LIB}`);
    for (const f of mockFindings(parseTestFile(source, name))) out.push(`${name}: ${f}`);
  }
  for (const p of tracked) {
    if (p.split('/').includes('node_modules')) out.push(`${p} is a committed node_modules file`);
    if (BABEL_CONFIG.test(p)) out.push(`${p} is a Babel config`);
  }
  if (pkg.babel !== undefined) out.push('package.json has a babel key');
  if (pkg.jest !== undefined) out.push('package.json has a jest key');
  return out;
}

describe('the jest setup cannot hand tests a stand-in for the library', () => {
  const API = path.resolve(__dirname, '..', '..');
  const { gitVisibleFiles } = require('../helpers/git-visible-files.js');
  const config = require('../../jest.config.js');
  const setupNames = [
    config.setupFiles,
    config.setupFilesAfterEnv,
    config.globalSetup,
    config.globalTeardown,
  ]
    .flat()
    .filter(Boolean);
  const setupSources = Object.fromEntries(
    setupNames.map((n) => [n, fs.readFileSync(path.resolve(API, n), 'utf8')]),
  );
  const tracked = [...gitVisibleFiles(API)].map((p) => p.split(path.sep).join('/'));

  test('reads the two setup files and every file git sees in express-api', () => {
    expect(setupNames).toEqual([
      './tests/_helpers/jest-retry-setup.js',
      './tests/_helpers/jest-git-env-isolation.js',
    ]);
    expect(tracked).toEqual(expect.arrayContaining(['jest.config.js', 'package.json']));
  });

  test('today it holds', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(API, 'package.json'), 'utf8'));
    expect(configFindings({ config, setupSources, tracked, pkg })).toEqual([]);
  });

  test('every planted form is caught', () => {
    const planted = {
      config: { ...config, moduleNameMapper: {}, transform: { '\\.js$': 'x' } },
      setupSources: {
        'a.js': `jest.mock('${RULES_LIB}', () => ({}));`,
        'b.js': 'jest.doMock(name);',
      },
      tracked: [
        'tests/node_modules/@firebase/rules-unit-testing/index.js',
        'babel.config.js',
        '.babelrc',
      ],
      pkg: { babel: {}, jest: {} },
    };
    expect(configFindings(planted)).toEqual([
      'jest config key moduleNameMapper is not reviewed',
      'jest transform changed',
      `a.js names ${RULES_LIB}`,
      'b.js: line 1: a module mock (doMock) whose module cannot be read',
      'tests/node_modules/@firebase/rules-unit-testing/index.js is a committed node_modules file',
      'babel.config.js is a Babel config',
      '.babelrc is a Babel config',
      'package.json has a babel key',
      'package.json has a jest key',
    ]);
  });
});
