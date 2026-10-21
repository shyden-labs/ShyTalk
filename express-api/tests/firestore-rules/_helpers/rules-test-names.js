'use strict';

/**
 * Reads a rules test file as an AST (SHY-0657), for the rules-test guards and
 * the red-first CI step (`express-api/scripts/rules-red-first.js`). Comments
 * are not nodes, so nothing written in a comment can count as code.
 */

const { parse } = require('@babel/parser');

function parseTestFile(source, file) {
  try {
    return parse(source, { sourceType: 'unambiguous', errorRecovery: false });
  } catch (err) {
    const where = err.loc ? `${err.loc.line}:${err.loc.column}` : '?';
    throw new Error(`${file}:${where} does not parse: ${err.message}`, { cause: err });
  }
}

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'comments' || key.endsWith('Comments')) continue;
    const value = node[key];
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value && typeof value.type === 'string') walk(value, visit);
  }
}

// The text of a string literal, or of a template literal with no `${}`; else null.
function literalText(node) {
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

function calls(ast, name) {
  const found = [];
  walk(ast, (n) => {
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === name) {
      found.push(n);
    }
  });
  return found;
}

function requires(ast) {
  return calls(ast, 'require')
    .map((c) => (c.arguments.length === 1 ? literalText(c.arguments[0]) : null))
    .filter((spec) => spec !== null);
}

const ASSERTS = { fails: 'assertFails', succeeds: 'assertSucceeds' };
const TEST_FNS = new Set(['test', 'it']);
const READ_MODIFIERS = new Set(['skip', 'only', 'concurrent']);

function calledNames(node) {
  const names = new Set();
  walk(node, (n) => {
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier') names.add(n.callee.name);
  });
  return names;
}

// Every file-local function (declaration, or a const bound to a function), by name.
function localFunctions(ast) {
  const fns = new Map();
  walk(ast, (n) => {
    if (n.type === 'FunctionDeclaration' && n.id) fns.set(n.id.name, n.body);
    if (
      n.type === 'VariableDeclarator' &&
      n.id.type === 'Identifier' &&
      n.init &&
      (n.init.type === 'ArrowFunctionExpression' || n.init.type === 'FunctionExpression')
    ) {
      fns.set(n.id.name, n.init.body);
    }
  });
  return fns;
}

// The names whose call reaches `root`, through local functions, to a fixed point.
function reaching(root, fns) {
  const reach = new Set([root]);
  const called = new Map([...fns].map(([name, body]) => [name, calledNames(body)]));
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, names] of called) {
      if (!reach.has(name) && [...names].some((c) => reach.has(c))) {
        reach.add(name);
        grew = true;
      }
    }
  }
  return reach;
}

// `test(...)`, `it.skip(...)`, `test.each(t)(...)`: { kind, family } or null when not a test call.
function testCall(call) {
  const c = call.callee;
  if (c.type === 'Identifier' && TEST_FNS.has(c.name)) return { family: false };
  if (
    c.type === 'MemberExpression' &&
    c.object.type === 'Identifier' &&
    TEST_FNS.has(c.object.name)
  ) {
    if (READ_MODIFIERS.has(c.property.name)) return { family: false };
    throw new Error(`${c.object.name}.${c.property.name}`);
  }
  if (
    c.type === 'CallExpression' &&
    c.callee.type === 'MemberExpression' &&
    c.callee.object.type === 'Identifier' &&
    TEST_FNS.has(c.callee.object.name) &&
    c.callee.property.name === 'each'
  ) {
    return { family: true };
  }
  return null;
}

const isDescribe = (call) =>
  (call.callee.type === 'Identifier' && call.callee.name === 'describe') ||
  (call.callee.type === 'MemberExpression' &&
    call.callee.object.type === 'Identifier' &&
    call.callee.object.name === 'describe' &&
    READ_MODIFIERS.has(call.callee.property.name));

/**
 * Every test in a jest file: its jest full name, title, describe path, body
 * source and whether it reaches assertFails / assertSucceeds. A `test.each`
 * family is one entry whose title is its template (`family: true`). Throws
 * naming file and line on anything whose name cannot be read from source.
 */
function extractTests(source, file) {
  const ast = parseTestFile(source, file);
  const fns = localFunctions(ast);
  const reach = { fails: reaching(ASSERTS.fails, fns), succeeds: reaching(ASSERTS.succeeds, fns) };
  const tests = [];
  const visit = (node, describePath) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'CallExpression') {
      const line = node.loc.start.line;
      if (isDescribe(node)) {
        const title = node.arguments[0] && literalText(node.arguments[0]);
        if (title === null || title === undefined) {
          throw new Error(`${file}:${line} describe title is not a plain string`);
        }
        node.arguments.slice(1).forEach((arg) => visit(arg, [...describePath, title]));
        return;
      }
      let kind;
      try {
        kind = testCall(node);
      } catch (err) {
        throw new Error(`${file}:${line} ${err.message} is not read`, { cause: err });
      }
      if (kind) {
        const title = node.arguments[0] && literalText(node.arguments[0]);
        if (title === null || title === undefined) {
          throw new Error(`${file}:${line} test title is not a plain string`);
        }
        const fn = node.arguments[1];
        const names = fn ? calledNames(fn) : new Set();
        tests.push({
          file,
          line,
          title,
          describePath,
          fullName: [...describePath, title].join(' '),
          family: kind.family,
          body: fn ? source.slice(fn.start, fn.end) : '',
          asserts: {
            fails: [...names].some((n) => reach.fails.has(n)),
            succeeds: [...names].some((n) => reach.succeeds.has(n)),
          },
        });
        return;
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'comments' || key.endsWith('Comments')) continue;
      const value = node[key];
      if (Array.isArray(value)) value.forEach((child) => visit(child, describePath));
      else if (value && typeof value.type === 'string') visit(value, describePath);
    }
  };
  visit(ast, []);
  return tests;
}

// A regex matching every row name jest prints for a `test.each` family's full name.
function familyRegex(template) {
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = template
    .split('%%')
    .map((piece) =>
      piece
        .split(/%[sdipjo#]/)
        .map(escape)
        .join('.+'),
    )
    .join('%');
  return new RegExp(`^${pattern}$`);
}

module.exports = { parseTestFile, walk, literalText, calls, requires, extractTests, familyRegex };
