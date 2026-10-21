'use strict';

/**
 * rules-tests-load-rules-from-one-place.test.js — SHY-0657.
 *
 * Every emulator rules test (a test file that calls initializeTestEnvironment)
 * must hand the emulator `loadRules()` from
 * `tests/firestore-rules/_helpers/rules-source.js`, and name `firestore.rules`
 * nowhere itself. That is what lets the red-first CI step run a test against
 * the base branch's rules by setting one env var, with the live file never
 * swapped out. A file that read the rules itself would silently run against
 * the live rules in that step and pass for the wrong reason.
 *
 * The population is derived from the filesystem and checked twice: files that
 * call initializeTestEnvironment must be exactly the files that require
 * @firebase/rules-unit-testing. Read as an AST, so a comment counts for nothing.
 */

const fs = require('fs');
const path = require('path');
const {
  parseTestFile,
  walk,
  calls,
  requires,
} = require('../firestore-rules/_helpers/rules-test-names.js');

const TESTS_DIR = path.resolve(__dirname, '..');
const LOADER = path.join(TESTS_DIR, 'firestore-rules', '_helpers', 'rules-source.js');

function testFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : testFiles(full);
    return entry.name.endsWith('.test.js') ? [full] : [];
  });
}

function rulesValue(options) {
  if (!options || options.type !== 'ObjectExpression') return null;
  const firestore = options.properties.find((p) => p.key && p.key.name === 'firestore');
  if (!firestore || firestore.value.type !== 'ObjectExpression') return null;
  const rules = firestore.value.properties.find((p) => p.key && p.key.name === 'rules');
  return rules ? rules.value : null;
}

// Every way `file` fails the rule; empty when it holds.
function findings(source, file) {
  const ast = parseTestFile(source, file);
  const out = [];
  const loaderRequired = requires(ast).some(
    (spec) =>
      spec.startsWith('.') &&
      path.resolve(path.dirname(file), spec).replace(/\.js$/, '') === LOADER.replace(/\.js$/, ''),
  );
  if (!loaderRequired) out.push('does not require rules-source');
  for (const call of calls(ast, 'initializeTestEnvironment')) {
    const value = rulesValue(call.arguments[0]);
    const viaLoader =
      value &&
      value.type === 'CallExpression' &&
      value.callee.type === 'Identifier' &&
      value.callee.name === 'loadRules' &&
      value.arguments.length === 0;
    if (!viaLoader) out.push(`line ${call.loc.start.line}: firestore.rules is not loadRules()`);
  }
  walk(ast, (n) => {
    // Every piece of literal text is a StringLiteral or a TemplateElement.
    const text =
      n.type === 'StringLiteral' ? n.value : n.type === 'TemplateElement' ? n.value.cooked : null;
    if (text !== null && text.includes('firestore.rules')) {
      out.push(`line ${n.loc.start.line}: names firestore.rules itself`);
    }
  });
  return out;
}

const scanned = testFiles(TESTS_DIR).map((file) => {
  const source = fs.readFileSync(file, 'utf8');
  if (!source.includes('initializeTestEnvironment') && !source.includes('rules-unit-testing')) {
    return { file, emulator: false, importer: false, source };
  }
  const ast = parseTestFile(source, file);
  return {
    file,
    source,
    emulator: calls(ast, 'initializeTestEnvironment').length > 0,
    importer: requires(ast).includes('@firebase/rules-unit-testing'),
  };
});
const rel = (file) => path.relative(TESTS_DIR, file);
const emulatorFiles = scanned.filter((s) => s.emulator);

describe('the emulator rules test population', () => {
  test('is the eight emulator rules test files', () => {
    // The population rides inside the verdict, so a failure prints every file.
    const files = emulatorFiles.map((s) => rel(s.file));
    expect({ of: 'emulator rules test files', count: files.length, files }).toEqual({
      of: 'emulator rules test files',
      count: 8,
      files,
    });
  });

  test('equals the files that require @firebase/rules-unit-testing', () => {
    const importers = scanned.filter((s) => s.importer).map((s) => rel(s.file));
    expect(emulatorFiles.map((s) => rel(s.file))).toEqual(importers);
  });
});

describe('each emulator rules test loads its rules through rules-source', () => {
  test.each(emulatorFiles.map((s) => [rel(s.file), s]))('%s', (_name, s) => {
    expect({ file: rel(s.file), findings: findings(s.source, s.file) }).toEqual({
      file: rel(s.file),
      findings: [],
    });
  });
});

describe('planted files turn the check red', () => {
  const at = path.join(TESTS_DIR, 'firestore-rules', 'planted.test.js');
  const clean = [
    "const { loadRules } = require('./_helpers/rules-source');",
    'initializeTestEnvironment({ projectId: "p", firestore: { host, port, rules: loadRules() } });',
  ].join('\n');

  test('a clean file has no findings', () => {
    expect(findings(clean, at)).toEqual([]);
  });

  test('a file reading firestore.rules itself is caught twice', () => {
    const planted = [
      "const { readFileSync } = require('fs');",
      "const { loadRules } = require('./_helpers/rules-source');",
      "const RULES_PATH = join(__dirname, '..', '..', '..', 'firestore.rules');",
      'initializeTestEnvironment({ firestore: { rules: readFileSync(RULES_PATH, "utf8") } });',
    ].join('\n');
    expect(findings(planted, at)).toEqual([
      'line 4: firestore.rules is not loadRules()',
      'line 3: names firestore.rules itself',
    ]);
  });

  test('a file that never requires the loader is caught', () => {
    const planted = clean.replace("require('./_helpers/rules-source')", "require('./other')");
    expect(findings(planted, at)).toEqual(['does not require rules-source']);
  });

  test('a template literal naming the live file is caught', () => {
    const planted = `${clean}\nconst p = \`\${root}/firestore.rules\`;`;
    expect(findings(planted, at)).toEqual(['line 3: names firestore.rules itself']);
  });

  test('a plain template literal naming the live file is caught once', () => {
    expect(findings(`${clean}\nconst p = \`firestore.rules\`;`, at)).toEqual([
      'line 3: names firestore.rules itself',
    ]);
  });

  test('a comment naming the live file counts for nothing', () => {
    expect(findings(`// reads firestore.rules\n${clean}`, at)).toEqual([]);
  });
});
