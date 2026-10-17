/**
 * suspension-ends-in-one-place.test.js — SHY-0605.
 *
 * Five routes end a suspension, and each used to write its own end: none put
 * everything back, and only one lifted the auto-applied bans. They now all end
 * through `endSuspension` (utils/end-suspension.js), which writes the fields
 * `suspensionEndedFields` (utils/suspension.js) states once. This guard keeps
 * it that way: a sixth route writing `isSuspended: false` itself, or calling
 * `suspensionEndedFields` around the ending, turns it red.
 *
 * It parses every `src/**` JavaScript file (walked from the filesystem) and
 * finds every object literal with an `isSuspended` / `is_suspended` key,
 * however the key is spelled. Each is followed to its use, inline or through
 * ONE `const` binding:
 *   - a response body (`res.json`, `res.send`): allowed;
 *   - `.set(x)` with no options after it (creating a document): allowed;
 *   - `.update(...)` or `.set(x, { merge })`, on a ref, a batch or a
 *     transaction: an ending, allowed only in utils/suspension.js;
 *   - anything else (returned, passed to a helper, spread, held in `let`):
 *     red for a literal `false`, fail-closed.
 * One exception, for a `const` that a merge-less `.set` creates: that object
 * IS a new document, so a spread copy of it (`{ ...doc }`) is judged by the
 * copy's own use, and is red only when the copy reaches an ending write.
 * Passing the document itself anywhere else stays red.
 * A value that is not a literal (`isSuspended: someFlag`) is red only when it
 * reaches an ending write; reads such as the suspension cache stay green. A
 * literal `true` begins a suspension and is not judged here (SHY-0608).
 *
 * Moves to the guards suite with SHY-0563. Its file floor moves to the floors
 * record with SHY-0556.
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');

const SRC = path.resolve(__dirname, '../../src');
const HOME = path.join('utils', 'suspension.js');
const ENDING = path.join('utils', 'end-suspension.js');
const SUSPENDED_KEYS = new Set(['isSuspended', 'is_suspended']);

// Measured 2026-10-17: JavaScript files under express-api/src. Equality, so a
// file added or lost is seen and this figure re-measured.
const FILES_READ_FLOOR = 149;

// ─── A small walker: @babel/parser is declared, @babel/traverse is not ───

function children(node) {
  const out = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key.endsWith('Comments')) continue;
    if (Array.isArray(value)) {
      for (const v of value) if (v && typeof v.type === 'string') out.push(v);
    } else if (value && typeof value.type === 'string') {
      out.push(value);
    }
  }
  return out;
}

/** Every node with its parent chain, depth first. */
function walk(root) {
  const nodes = [];
  const parents = new Map();
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    nodes.push(node);
    for (const child of children(node)) {
      parents.set(child, node);
      stack.push(child);
    }
  }
  return { nodes, parents };
}

function keyName(prop) {
  if (prop.key.type === 'Identifier' && !prop.computed) return prop.key.name;
  if (prop.key.type === 'StringLiteral') return prop.key.value;
  return null;
}

function memberName(node) {
  if (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression') return null;
  if (node.property.type === 'Identifier' && !node.computed) return node.property.name;
  if (node.property.type === 'StringLiteral') return node.property.value;
  return null;
}

/**
 * How the value at `node` is used, by its parent: 'response', 'creation',
 * 'ending', 'const' (a binding to follow), or 'other'.
 */
function useOf(node, parents) {
  const parent = parents.get(node);
  if (parent.type === 'VariableDeclarator' && parent.init === node) {
    const declaration = parents.get(parent);
    return parent.id.type === 'Identifier' && declaration.kind === 'const' ? 'const' : 'other';
  }
  if (
    (parent.type === 'CallExpression' || parent.type === 'OptionalCallExpression') &&
    parent.arguments.includes(node)
  ) {
    const method = memberName(parent.callee);
    if (method === 'json' || method === 'send') return 'response';
    if (method === 'update') return 'ending';
    if (method === 'set') {
      return parent.arguments.indexOf(node) === parent.arguments.length - 1 ? 'creation' : 'ending';
    }
  }
  return 'other';
}

const FUNCTIONS = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ObjectMethod',
  'ClassMethod',
]);

/** Whether `n` names a binding (a declaration, a parameter) rather than using one. */
function isBinding(n, parent, parents) {
  if (parent.type === 'VariableDeclarator') return parent.id === n;
  if (FUNCTIONS.has(parent.type)) return parent.id === n || parent.params.includes(n);
  if (parent.type === 'ClassDeclaration' || parent.type === 'ClassExpression') {
    return parent.id === n;
  }
  if (parent.type === 'CatchClause') return parent.param === n;
  if (parent.type === 'AssignmentPattern') return parent.left === n;
  if (parent.type === 'RestElement' || parent.type === 'ArrayPattern') return true;
  if (parent.type.startsWith('Import') && parent.type.endsWith('Specifier')) {
    return parent.local === n;
  }
  if (parent.type === 'ObjectProperty' && parent.value === n) {
    return parents.get(parent).type === 'ObjectPattern';
  }
  return false;
}

/**
 * The references to a const named `name` in this file, or null when the name
 * is bound anywhere else in it (another declaration, a parameter, a function
 * or class name, a catch or import binding): a reader that follows a name
 * cannot tell two bindings apart, so it fails closed.
 */
function referencesTo(name, declarator, nodes, parents) {
  const named = nodes.filter((n) => n.type === 'Identifier' && n.name === name);
  const bindings = named.filter((n) => isBinding(n, parents.get(n), parents));
  if (bindings.length !== 1 || bindings[0] !== declarator.id) return null;
  return named.filter((n) => {
    const parent = parents.get(n);
    if (isBinding(n, parent, parents)) return false; // a binding is not a use
    const member = parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression';
    if (member && parent.property === n && !parent.computed) return false;
    // `f.uid` reads one field out; it carries no part of the object anywhere.
    if (member && parent.object === n) return false;
    if (
      parent.type === 'ObjectProperty' &&
      parent.key === n &&
      !parent.computed &&
      !parent.shorthand
    ) {
      return false;
    }
    return true;
  });
}

/**
 * Judge one file. `rel` is its path under src; `code` its text.
 *
 * @returns {{ sites: Array<{ at: string, kind: string }>, findings: string[],
 *   endingCalls: Array<{ at: string, node: object }> }}
 */
function scanSource(rel, code) {
  const ast = parse(code, { sourceType: 'unambiguous', errorRecovery: false });
  const { nodes, parents } = walk(ast);
  const sites = [];
  const findings = [];
  const at = (node) => `${rel}:${node.loc.start.line}`;
  const inHome = rel === HOME;

  for (const prop of nodes) {
    if (prop.type !== 'ObjectProperty' || !SUSPENDED_KEYS.has(keyName(prop))) continue;
    const literal = prop.value.type === 'BooleanLiteral';
    if (literal && prop.value.value === true) continue; // a start, not an end
    const object = parents.get(prop);

    let uses = [useOf(object, parents)];
    if (uses[0] === 'const') {
      const declarator = parents.get(object);
      const refs = referencesTo(declarator.id.name, declarator, nodes, parents);
      // A name bound twice, or bound again, cannot be followed: red for every
      // value, computed ones included.
      uses = refs === null ? ['unfollowed'] : refs.map((ref) => useOf(ref, parents));
      if (uses.includes('const')) uses = ['unfollowed'];
      // A created document's spread copies are judged by the copy's own use.
      if (uses.includes('creation')) {
        uses = refs.map((ref, i) => {
          const spread = parents.get(ref);
          if (spread.type !== 'SpreadElement' || spread.argument !== ref) return uses[i];
          const copyUse = useOf(parents.get(spread), parents);
          return copyUse === 'ending' ? 'ending' : 'copy';
        });
      }
    }

    for (const use of uses) {
      const kind = inHome ? 'home' : use;
      sites.push({ at: at(prop), kind: literal ? kind : `${kind} (computed)` });
      if (inHome) continue;
      if (use === 'ending' || use === 'unfollowed' || (literal && use === 'other')) {
        findings.push(`${at(prop)}: isSuspended ${literal ? 'false' : 'computed'} reaches ${use}`);
      }
    }
  }

  // suspensionEndedFields belongs to the ending: called, imported or reached
  // by name anywhere else, it is a second ending.
  if (rel !== HOME && rel !== ENDING) {
    for (const node of nodes) {
      const named =
        (node.type === 'Identifier' && node.name === 'suspensionEndedFields') ||
        memberName(node) === 'suspensionEndedFields' ||
        (node.type === 'ObjectProperty' && keyName(node) === 'suspensionEndedFields');
      const parent = parents.get(node);
      // An Identifier inside a member or a property is reported through that node.
      const counted =
        node.type !== 'Identifier' ||
        !parent ||
        !(
          (parent.type === 'MemberExpression' && parent.property === node) ||
          (parent.type === 'ObjectProperty' && parent.key === node)
        );
      if (named && counted) findings.push(`${at(node)}: suspensionEndedFields outside the ending`);
    }
  }

  const endingCalls = nodes
    .filter(
      (n) =>
        n.type === 'CallExpression' &&
        ((n.callee.type === 'Identifier' && n.callee.name === 'endSuspension') ||
          memberName(n.callee) === 'endSuspension'),
    )
    .map((node) => ({ at: at(node), node }));

  return { sites, findings, endingCalls, nodes, parents };
}

/** The value of `restoreGcs` in an endSuspension call: true, false, or 'computed'. */
function restoreGcsOf(call) {
  const options = call.arguments[1];
  if (!options) return false;
  if (options.type !== 'ObjectExpression') return 'computed';
  const prop = options.properties.find(
    (p) => p.type === 'ObjectProperty' && keyName(p) === 'restoreGcs',
  );
  if (options.properties.some((p) => p.type === 'SpreadElement')) return 'computed';
  if (!prop) return false;
  return prop.value.type === 'BooleanLiteral' ? prop.value.value : 'computed';
}

/** The route (`METHOD path`) whose handler holds `node`, or null. */
function routeOf(node, parents) {
  for (let cur = parents.get(node); cur; cur = parents.get(cur)) {
    if (cur.type !== 'CallExpression') continue;
    const method = memberName(cur.callee);
    const first = cur.arguments[0];
    if (
      ['get', 'post', 'put', 'patch', 'delete'].includes(method) &&
      first?.type === 'StringLiteral'
    ) {
      return `${method.toUpperCase()} ${first.value}`;
    }
  }
  return null;
}

function scanTree(root) {
  const files = fs
    .readdirSync(root, { recursive: true })
    .filter((rel) => !rel.split(path.sep).includes('node_modules'))
    .filter((rel) => rel.endsWith('.js') && fs.statSync(path.join(root, rel)).isFile())
    .sort();
  const sites = [];
  const findings = [];
  const endings = [];
  for (const rel of files) {
    const scan = scanSource(rel, fs.readFileSync(path.join(root, rel), 'utf8'));
    sites.push(...scan.sites);
    findings.push(...scan.findings);
    for (const { at, node } of scan.endingCalls) {
      endings.push({ at, route: routeOf(node, scan.parents), restoreGcs: restoreGcsOf(node) });
    }
  }
  return { files, sites, findings, endings };
}

// The five end paths (SHY-0605's inventory), by file and route. Only the
// upheld appeal gives the GCS back (Shyden, 2026-10-17).
const END_PATHS = [
  ['routes/admin-users.js', 'POST /user/:uniqueId/unsuspend', false],
  ['routes/reports.js', 'POST /admin/users/:uniqueId/unsuspend', false],
  ['routes/reports.js', 'PATCH /appeals/:id', true],
  ['routes/users.js', 'POST /users/:uniqueId/lift-suspension', false],
  ['routes/identity-graph.js', 'POST /admin/identity-graph/:id/unsuspend-all', false],
];

describe('SHY-0605 — a suspension ends in one place', () => {
  const { files, sites, findings, endings } = scanTree(SRC);

  test('no file but the ending writes isSuspended false or calls suspensionEndedFields', () => {
    const kinds = {};
    for (const { kind } of sites) kinds[kind] = (kinds[kind] ?? 0) + 1;
    expect({ filesRead: files.length, findings, kinds }).toEqual({
      filesRead: FILES_READ_FLOOR,
      findings: [],
      // Measured 2026-10-17: portal.js's response, test-helpers.js's two
      // created users and the copy of one it answers with, the home in
      // utils/suspension.js, the suspension cache's entry, and two report rows.
      kinds: {
        response: 1,
        creation: 2,
        copy: 1,
        home: 1,
        'creation (computed)': 1,
        'other (computed)': 2,
      },
    });
  });

  test.each(END_PATHS)('%s %s ends through endSuspension', (file, route, gcs) => {
    const here = endings.filter((e) => e.at.startsWith(path.join(...file.split('/')) + ':'));
    expect(here.filter((e) => e.route === route).map((e) => e.restoreGcs)).toEqual([gcs]);
  });

  test('only the upheld appeal gives the GCS back', () => {
    expect(
      endings.filter((e) => e.restoreGcs !== false).map((e) => `${e.route} ${e.restoreGcs}`),
    ).toEqual(['PATCH /appeals/:id true']);
  });
});

describe('SHY-0605 — the reader sees every form an ending is written in', () => {
  const judge = (code, rel = 'routes/x.js') => scanSource(rel, code).findings.length;

  test.each([
    ['an inline literal in .update', `ref.update({ isSuspended: false });`],
    ['a const-bound literal then .update', `const f = { isSuspended: false }; ref.update(f);`],
    [
      'a const spread into .update',
      `const f = { isSuspended: false }; ref.update({ ...f, a: 1 });`,
    ],
    ['.set with merge', `ref.set({ isSuspended: false }, { merge: true });`],
    ['batch.update', `batch.update(ref, { isSuspended: false });`],
    [
      'a transaction update',
      `db.runTransaction(async (t) => { t.update(ref, { isSuspended: false }); });`,
    ],
    ['batch.set with merge', `batch.set(ref, { isSuspended: false }, { merge: true });`],
    ['snake case', `ref.update({ is_suspended: false });`],
    ['a string-quoted key', `ref.update({ 'isSuspended': false });`],
    ['a computed string key', `ref.update({ ['isSuspended']: false });`],
    ['a literal passed to a helper', `writeUser({ isSuspended: false });`],
    ['a literal returned by another helper', `function end() { return { isSuspended: false }; }`],
    ['a literal from an arrow', `const end = () => ({ isSuspended: false });`],
    ['a literal held in let', `let f = { isSuspended: false }; ref.update(f);`],
    [
      'a created document also written as an ending',
      `const u = { isSuspended: false }; ref.set(u); log(u.uid); other.update(u);`,
    ],
    [
      'a created document passed to a helper',
      `const u = { isSuspended: false }; ref.set(u); writeUser(u);`,
    ],
    [
      'a created document copied into an ending',
      `const u = { isSuspended: false }; ref.set(u); other.update({ ...u, a: 1 });`,
    ],
    [
      'a document never created, copied into a list',
      `const u = { isSuspended: false }; list.push({ ...u });`,
    ],
    ['a const declared twice', `const f = { isSuspended: false }; { const f = 1; } ref.set(f);`],
    [
      'a copy excused by a created document of the same name elsewhere',
      `const f = { isSuspended: false }; list.push({ ...f }); function g() { const f = { a: 1 }; ref.set(f); }`,
    ],
    [
      'a computed value under a name a parameter shadows',
      `const f = { isSuspended: flag }; res.json(f); function g(f) {}`,
    ],
    [
      'a computed value bound again',
      `const f = { isSuspended: flag }; const h = f; other.update(h);`,
    ],
    [
      'a copy excused by a parameter of the same name',
      `const f = { isSuspended: false }; list.push({ ...f }); function g(f) { ref.set(f); }`,
    ],
    ['a computed value reaching .update', `ref.update({ isSuspended: req.body.flag });`],
    ['a computed value reaching batch.update', `batch.update(ref, { isSuspended: flag });`],
    ['suspensionEndedFields called', `ref.update(suspensionEndedFields());`],
    ['suspensionEndedFields through the module', `ref.update(s.suspensionEndedFields());`],
    [
      'suspensionEndedFields imported under another name',
      `const { suspensionEndedFields: end } = require('../utils/suspension');`,
    ],
  ])('%s is red', (_form, code) => {
    expect(judge(code)).toBeGreaterThan(0);
  });

  test.each([
    ['a response body', `res.json({ isSuspended: false });`],
    ['a response body after a status', `res.status(200).send({ isSuspended: false });`],
    ['a merge-less .set inline', `ref.set({ isSuspended: false, name: 'a' });`],
    ['a merge-less .set const-bound', `const u = { isSuspended: false }; ref.set(u);`],
    [
      'a field read from the created document',
      `const u = { isSuspended: false }; ref.set(u); list.push({ uid: u.uid });`,
    ],
    [
      'a created document copied into a list',
      `const u = { isSuspended: false }; ref.set(u); list.push({ ...u });`,
    ],
    [
      'a created document copied into a response',
      `const u = { isSuspended: false }; ref.set(u); res.json({ ...u, id: 1 });`,
    ],
    ['a computed value in a cache', `cache.set(id, { isSuspended, at: 1 });`],
    ['a computed value in a mapped row', `rows.map((r) => ({ isSuspended: r.s ?? false }));`],
    ['a start', `ref.update({ isSuspended: true });`],
  ])('%s is green', (_form, code) => {
    expect(judge(code)).toBe(0);
  });

  test('the home may return the cleared fields', () => {
    expect(judge(`function f() { return { isSuspended: false }; }`, HOME)).toBe(0);
  });

  test('the ending may call suspensionEndedFields', () => {
    expect(judge(`batch.update(ref, suspensionEndedFields({}));`, ENDING)).toBe(0);
  });
});

describe('SHY-0605 — the route reader names each ending', () => {
  const endingsIn = (code) => scanSource('routes/x.js', code).endingCalls.map(({ node }) => node);

  test('an ending inside a route handler is named by its method and path', () => {
    const scan = scanSource(
      'routes/x.js',
      `router.patch('/appeals/:id', async (req, res) => { await endSuspension(id, { restoreGcs: true }); });`,
    );
    expect(scan.endingCalls.map(({ node }) => routeOf(node, scan.parents))).toEqual([
      'PATCH /appeals/:id',
    ]);
  });

  test.each([
    ['no options', `endSuspension(id);`, false],
    ['restoreGcs absent', `endSuspension(id, { actor });`, false],
    ['restoreGcs true', `endSuspension(id, { restoreGcs: true });`, true],
    ['restoreGcs from a variable', `endSuspension(id, { restoreGcs: wanted });`, 'computed'],
    ['options from a variable', `endSuspension(id, opts);`, 'computed'],
    ['options with a spread', `endSuspension(id, { ...opts });`, 'computed'],
  ])('reads %s', (_form, code, expected) => {
    expect(endingsIn(code).map(restoreGcsOf)).toEqual([expected]);
  });
});
