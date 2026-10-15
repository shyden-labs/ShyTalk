---
id: SHY-0595
status: Draft
owner: unassigned
created: 2026-10-15
priority: P1
effort: S
estimate: 3
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0595: Every package install script is approved or refused on purpose

## User Story

As **Shyden, the operator**, I want every dependency's install script either
approved or refused by a recorded decision, so that `npm ci` installs exactly
what we chose to run and prints no warning, on Node 24 today and Node 26 next.

## Why

Found 2026-10-15 setting up a docs worktree.

- On the Mac's default Node 26.11.1 (npm 11.20.0), `npm ci --prefer-offline`
  held back install scripts it had no approval for, and warned:
  - root: `@firebase/util@1.15.3` (postinstall), `protobufjs@7.6.6`
    (postinstall);
  - `express-api/`: `@firebase/util@1.15.1`, `bcrypt@6.0.0`
    (install: `node-gyp-build`), `fsevents@2.3.3`, `protobufjs@7.6.5`,
    `unrs-resolver@1.12.2` (postinstall).
- Nothing broke that day: `bcrypt` hashed and compared, and `unrs-resolver`
  loaded, both from prebuilt binaries. That is luck of the prebuilds, not a
  decision.
- Neither `package.json` nor any `.npmrc` records a choice today.
- Warnings are build failures (global rule). CI runs `.nvmrc` 24 now; SHY-0566
  moves ShyTalk to Node 26, where every `npm ci` in CI would print these.

## Acceptance Criteria

### Happy path

- [ ] Each of the 5 packages is either approved or refused through npm's
      install-scripts mechanism, at the root and in `express-api/`, with the
      reason beside it (what the script does, read from the package).
- [ ] `npm ci` at the root and in `express-api/` prints no `npm warn` line on
      Node 24 and on Node 26.

### Error paths

- [ ] A new dependency with an undecided install script fails CI, naming the
      package, rather than installing with a warning.

### Edge cases

- [ ] `fsevents` (macOS only) is decided too, though CI's Linux never installs it.
- [ ] A refused native package still loads where the app needs it (measured:
      `bcrypt` hash and compare, in the API's unit and integration suites).

### Performance

- [ ] N/A: install time is unchanged within noise; recorded in Notes.

### Security

- [ ] The decision list is pinned by a test that reads both `package.json`
      files (stripped of comments) and fails when an entry is dropped.
- [ ] Approval is per package, never a blanket "run all scripts".

### UX

- [ ] N/A: no user-facing surface.

### i18n

- [ ] N/A.

### Observability

- [ ] The CI install step prints how many install scripts ran and how many
      were refused.

## BDD Scenarios

**Scenario: an undecided install script stops the build**

- **Given** a dependency whose install script has no recorded decision
- **When** CI runs `npm ci`
- **Then** the step fails and names the package

## Test Plan

1. RED first: the pin test fails before the decisions are recorded.
2. Plant an undecided package in a scratch branch; CI's install step fails
   naming it.
3. Mutation: drop one decision; the pin test goes red.
4. `npm ci` on Node 24 and Node 26 in a clean worktree: zero `npm warn` lines.

## Out of Scope

- Moving to Node 26 itself: SHY-0566.

## Dependencies

- None blocking. Blocks SHY-0566.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Refusing a script breaks a native module on some platform | Load each refused native package in the suites that use it, on both Node lines, before merging. |
| npm's install-scripts config differs between npm 10 and 11 | Read the npm docs for both lines first; record the spelling each one accepts. |

## Definition of Done

- [ ] CI's install steps read by name on a real PR, with zero `npm warn` lines.
- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-15**: Filed from the docs worktree setup (`../ShyTalk-wt-docs-1015`,
  `origin/develop` 0cdfac0ecb1). Priority P1 inherited from SHY-0566, which it
  blocks.
