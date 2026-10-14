---
id: SHY-0585
status: Draft
owner: unassigned
created: 2026-10-14
priority: P2
effort: S
estimate: 3
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0585: The deploy and tooling scripts are never linted

## User Story

As **Shyden, the operator**, I want the JavaScript in `scripts/` checked by
ESLint and Prettier like the API's, so that a defect in the scripts that deploy
dev, distribute tester builds and run the story gates is caught at commit time
rather than on a deploy.

## Why

Found 2026-10-14 while landing SHY-0361, which added four scripts there.

- `lint-staged` runs ESLint and Prettier on `express-api/**/*.js` only. There
  is no root ESLint config (`npx eslint scripts/x.js` at the root: *"ESLint
  couldn't find an eslint.config.* file"*), and no workflow lints `scripts/`.
- `origin/develop` 56651692a79 has **25** JavaScript files under `scripts/`
  (`git ls-tree -r --name-only origin/develop scripts`, `.js/.mjs/.cjs`).
  **16** of them fail `prettier --check` with the API's Prettier. **6** are ES
  modules (`import`/`export`), the rest CommonJS.
- These are not idle files. `ensure-testflight-auto-distribution.js` and
  SHY-0361's `tester-notes.js`, `list-build-changes.js`,
  `set-testflight-whats-new.js` and `app-store-connect.js` run inside every dev
  deploy; `check-orphaned-stories.js` and `check-pr-story-status.js` gate PRs.

The sibling story SHY-0448 found the same gap for the admin dashboard's
browser JavaScript. Its point stands here: pointing the API's config at these
files is not a one-line change, because six of them are ES modules and the
config describes CommonJS.

## Acceptance Criteria

### Happy path

- [ ] Every JavaScript file under `scripts/` is linted by ESLint and checked by
      Prettier at commit time (`lint-staged`) and in CI.
- [ ] The CommonJS and ES-module files each get a config block that matches
      them (`sourceType`, Node globals).
- [ ] Every finding the first run reports is fixed, not suppressed.

### Error paths

- [ ] A lint error in a `scripts/` file fails the commit hook and the CI job.

### Edge cases

- [ ] The CI job's file set comes from the filesystem (`scripts/**/*.{js,mjs,cjs}`),
      never a hand-written list, and reports how many files it checked.
- [ ] A new file under `scripts/` is covered with no config change.

### Performance

- [ ] The CI step's run time is measured and recorded in Notes.

### Security

- [ ] The same security rules the API's config applies
      (`sonarjs/no-os-command-from-path` among them) apply here.

### UX

- [ ] N/A: no user-facing surface.

### i18n

- [ ] N/A.

### Observability

- [ ] The CI job's summary names the count of files checked.

## BDD Scenarios

**Scenario: A defect in a deploy script is caught before it ships**

- **Given** a change to a file under `scripts/` with a lint error
- **When** it is committed, or its pull request runs CI
- **Then** the commit hook and the CI job fail, naming the file and line

## Test Plan

1. RED first: plant a lint error and a Prettier violation in one CommonJS and
   one ES-module file under `scripts/`; the hook and the CI step both fail.
2. The CI step's file count matches `git ls-files 'scripts/**/*.js' ...` at
   the time, read from the job log.
3. Mutation: remove the `scripts/` block from the config and watch the planted
   files pass, then restore.

## Out of Scope

- The admin dashboard's JavaScript: SHY-0448.
- Shell scripts under `scripts/` (actionlint and shellcheck already see the
  ones embedded in workflows).

## Dependencies

- None blocking. Shares its approach with SHY-0448 (related, not a blocker).

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The first run surfaces many findings | 25 files, measured; fix them in this story, file anything larger as its own ticket. |
| Reformatting churns files other branches edit | One Prettier commit, first, so later diffs stay readable. |

## Definition of Done

- [ ] Hook and CI job read by name on a real PR, failing on a planted error and
      passing clean.
- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-14**: Filed while landing SHY-0361. Measured on `origin/develop`
  56651692a79: 25 files, 16 failing Prettier, 6 ES modules, no ESLint at all.
