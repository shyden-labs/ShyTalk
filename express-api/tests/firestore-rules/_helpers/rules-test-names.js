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

module.exports = { parseTestFile, walk, literalText, calls, requires };
