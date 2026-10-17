---
id: SHY-0624
status: Draft
owner: claude
created: 2026-10-18
priority: P2
effort: S
estimate: 3
type: chore
roadmap_ids: []
mvp: false
---

# SHY-0624: The web tests are format-checked

## User Story

As the operator keeping the codebase readable for a team, I want the
Playwright web tests held to the same Prettier format as the rest of the
JavaScript, so that a test diff shows only what changed and a reviewer is
not reading reflowed lines.

## Why

Measured 2026-10-18 on the SHY-0605 branch: Prettier, with the repo's own
root `.prettierrc`, would change 109 of the 118 tracked `.ts` files under
`tests/web`. Nothing checks them: CI's Prettier step reads only
`public/**/*.js` (`.github/workflows/lint.yml:163`), lint-staged covers
`express-api/**/*.js` only, and the root `.prettierignore` does not name
`tests/web` (so the gap is not a decision anyone recorded). Found when a
one-line change to `tests/web/admin-appeals.spec.ts` (SHY-0605) failed a
Prettier check that the file had already failed before the change.

## Acceptance Criteria

### Happy path

- [ ] Every tracked file under `tests/web` passes `prettier --check` with
      the root config, reformatted in one commit that changes nothing else.
- [ ] CI's Prettier step checks `tests/web/**/*.ts` beside `public/**/*.js`,
      and fails on a file out of format.
- [ ] lint-staged checks staged `tests/web` files the same way.

### Error paths

- [ ] A file out of format is named in the CI failure, not only counted.

### Edge cases

- [ ] Files that must keep their shape are listed in `.prettierignore`
      with a reason beside each, as the file already does for others.
- [ ] The reformat commit is proven to change formatting only: the web
      suite passes on it with the same test count as before.

### Performance

- [ ] None: a format check of ~118 files adds seconds to the lint job.

### Security

- [ ] None.

### UX

- [ ] None: no user-facing change.

### i18n

- [ ] None: no copy.

### Observability

- [ ] The CI step prints how many files it checked.

## BDD Scenarios

**Scenario: a web test out of format**

- **Given** `tests/web/admin-appeals.spec.ts` is not in Prettier's format
- **When** CI's lint job runs
- **Then** it fails naming that file

**Scenario: a web test in format**

- **Given** every file under `tests/web` is in format
- **When** CI's lint job runs
- **Then** the Prettier step passes and prints the number of files checked

## Test Plan

- Lint job: the widened Prettier step, planted red with one unformatted
  file and watched fail, then green.
- Web suite: the full run on the reformat commit, count compared.

## Out of Scope

- ESLint for the web tests: a separate ticket if wanted (SHY-0448 covers
  the admin dashboard's JavaScript).
- Other unchecked folders: one ticket each if the same measurement finds
  them.

## Dependencies

- None blocking.

## Risks & Mitigations

- A reformat of 109 files conflicts with open branches touching them:
  land it when few web-test branches are open, as one commit.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      develop; the check planted red once.

## Notes

- **2026-10-18**: Filed from SHY-0605 (found in passing).
