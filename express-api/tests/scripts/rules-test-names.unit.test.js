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
} = require('../firestore-rules/_helpers/rules-test-names.js');

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

describe('requires', () => {
  test('lists every require() literal, destructured or not', () => {
    const ast = parseTestFile(
      'const { a } = require(\'./x\');\nconst b = require("y");\nrequire(`z`);',
      'a.test.js',
    );
    expect(requires(ast)).toEqual(['./x', 'y', 'z']);
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
