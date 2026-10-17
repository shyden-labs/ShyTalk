---
id: SHY-0623
status: Draft
owner: claude
created: 2026-10-17
priority: P0
effort: S
estimate: 3
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0623: express-api declares every package it loads

## User Story

As the operator shipping the API, I want every package the server and its
tests load to be named in `express-api/package.json`, so that a dependency
update that stops pulling one in cannot take the server down at start-up.

## Why

Measured 2026-10-17 on the SHY-0605 branch (from `origin/develop`
`8f20691fc33`): every bare `require`, `jest.mock`, `jest.requireActual`,
`import()` and `from` specifier in `express-api/src`, `tests` and `scripts`
(764 files), compared with `dependencies` plus `devDependencies` (29 names).
Seven packages are loaded but never declared; npm installs them only because
a declared package depends on them:

- Shipped code: `@otplib/plugin-crypto-noble` and
  `@otplib/plugin-base32-scure` (`src/routes/portal.js`),
  `google-auth-library` (`src/utils/playStore.js`),
  `@smithy/node-http-handler` (`src/utils/r2.js`).
- Tests only: `@babel/traverse` and `glob`
  (`tests/scripts/admin-click-handler-reentrancy.test.js`), `firebase`
  (3 files, to be read: some may name it in a string only).

If a declared package drops or moves one of them, `npm ci` stops installing
it and `require` throws when the module loads: for the four shipped ones,
the API fails to start. Nothing checks this today. Found while writing
SHY-0605's guard, which uses `@babel/parser` (declared) and not
`@babel/traverse` for this reason.

## Acceptance Criteria

### Happy path

- [ ] Each of the seven is declared (shipped ones under `dependencies`,
      test-only ones under `devDependencies`) at the version now installed,
      or the code stops loading it.
- [ ] A guard reads every JavaScript file under `src`, `tests` and
      `scripts` (walked from the filesystem) and fails naming each bare
      specifier that is not a Node built-in and not declared.
- [ ] A package used by `src` must be under `dependencies`, not only
      `devDependencies` (the production install omits dev ones).

### Error paths

- [ ] A specifier the guard cannot read (computed, template) is refused
      by name, not skipped.

### Edge cases

- [ ] Forms planted and red: `require('x')`, `require('x/sub')`,
      `require('@scope/x/sub')`, `jest.mock('x')`, `jest.requireActual`,
      `import('x')`, `import y from 'x'`, `node:`-prefixed built-ins green.
- [ ] A specifier inside a string or comment is not read as an import.

### Performance

- [ ] The guard's run time is measured and sits in the guards suite
      (SHY-0563), not unit.

### Security

- [ ] Each newly declared package passes the licence and audit checks
      already in CI.

### UX

- [ ] None: no user-facing change.

### i18n

- [ ] None: no copy.

### Observability

- [ ] The guard's verdict carries the number of files and specifiers read,
      with a floor (SHY-0556's record once it lands).

## BDD Scenarios

**Scenario: a shipped module loads a package nobody declared**

- **Given** `src/utils/r2.js` requires `@smithy/node-http-handler`
- **And** `express-api/package.json` does not declare it
- **When** the guard runs
- **Then** it fails naming `@smithy/node-http-handler` and `src/utils/r2.js`

**Scenario: a shipped module loads a dev-only package**

- **Given** `src/routes/portal.js` requires a package declared only under
  `devDependencies`
- **When** the guard runs
- **Then** it fails naming the package as missing from `dependencies`

**Scenario: a test loads a declared dev package**

- **Given** a test requires `@babel/parser`, declared under `devDependencies`
- **When** the guard runs
- **Then** that specifier is not reported

## Test Plan

- Unit: the specifier reader, one test per planted form.
- Guards suite: the whole-tree check with its floor.

## Out of Scope

- Other packages in the monorepo (the root, `tests/`, the KMP app): one
  ticket each if the same check finds gaps there.

## Dependencies

- None blocking. SHY-0563 (guards suite) and SHY-0556 (floors record) are
  where the guard and its floor end up.

## Risks & Mitigations

- Declaring a version different from the installed one changes the
  lockfile: declare the installed version and diff `package-lock.json`.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      develop; the guard planted red per form.

## Notes

- Measuring script and output from 2026-10-17 are in the SHY-0605 session;
  re-measure at the start of the work.
