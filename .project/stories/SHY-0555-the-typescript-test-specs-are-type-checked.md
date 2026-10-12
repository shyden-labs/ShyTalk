---
id: SHY-0555
status: Draft
owner: claude
created: 2026-10-12
priority: P1
effort: L
estimate: 8
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0555: The TypeScript test specs are type-checked

## User Story

As a developer changing a Playwright spec, I want a type error to fail the
build, so that a misspelt property or a wrong argument is caught before CI
spends a browser run finding it.

## Why

Measured 2026-10-12 while building SHY-0544: the repository has no
`tsconfig.json`, and no workflow or `package.json` script runs `tsc`.
Playwright transpiles `tests/web/**` and `tests/integration/**` without
checking types, so a type error in a spec surfaces only as a runtime failure,
or not at all on a branch the spec does not reach. Measured the same day:
130 tracked files under `tests/` with a code extension.

## Acceptance Criteria

### Happy path

- [ ] A `tsconfig.json` covers every `.ts` file under `tests/` and the
      Playwright configs, `strict: true`, `noEmit`.
- [ ] `tsc --noEmit` runs in CI as a required step and on the laptop before
      push (a type check is allowed locally).
- [ ] Every existing type error is fixed in the code, not suppressed; any
      `@ts-expect-error` left carries a reason and a test that it is still
      needed.

### Error paths

- [ ] A planted type error in a spec fails the step, naming the file and
      line.

### Edge cases

- [ ] Files that `require` express-api's CommonJS modules type-check (JSDoc
      or local declarations), without `any` leaking in unseen.

### Performance

- [ ] The step's time is measured and recorded.

### Security

- [ ] Not applicable.

### UX

- [ ] Not applicable.

### i18n

- [ ] Not applicable.

### Observability

- [ ] The step prints the number of files it checked.

## BDD Scenarios

**Scenario: A type error in a spec**

- **Given** a spec passing a number where a string is required
- **When** CI runs
- **Then** the type-check step fails naming that line

## Test Plan

- The new CI step, a planted error going red, then removed.

## Out of Scope

- Converting JavaScript tests to TypeScript.

## Dependencies

- None.

## Risks & Mitigations

- **Many existing errors.** Mitigation: measure first; if the count is large,
  split into one story per directory, each scored, before fixing.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-12**: Found while adding `tests/integration/11-s3-stand-in-operations.spec.ts`
  (SHY-0544), which nothing type-checks. Scored 8: config, CI step, and an
  unknown number of fixes across 130 files; split if the measured error
  count says so.
