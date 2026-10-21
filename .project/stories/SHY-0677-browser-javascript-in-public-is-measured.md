---
id: SHY-0677
status: Draft
owner: claude
created: 2026-10-21
priority: P0
effort: M
estimate: 5
type: chore
roadmap_ids: []
mvp: true
epic: EPIC-0016
blocked_by: [SHY-0674]
---

# SHY-0677: browser JavaScript in public/ is measured

## User Story

As the operator, I want every line of browser JavaScript in public/ measured by a coverage tool
in CI, so that SHY-0674's gate can judge it and ShyTalk's coverage only rises,
to 100%.

## Why

Shyden, 2026-10-21, global ruling "Ratchet to 100%, unmeasured fails now":
every changed code line must be run by a test, and a changed line in a file
no suite measures fails the pull request (no exemption list); coverage tops
every project's queue, ahead of release work. For ShyTalk the same day: the
gate (SHY-0674) judges the whole repo ("Whole repo (Recommended)"), and the
group-roles hotfix waits behind this epic ("Waits behind coverage"). Until
this story lands, any PR changing browser JavaScript in public/ fails SHY-0674's gate.

Measured 2026-10-21: public/ holds 48 JavaScript files (public/js 14 and core 5, admin 24, portal 5) that run in the browser; the Playwright suites drive them, and Jest loads public/js/core through a transform.

## Acceptance Criteria

### Happy path

- [ ] The Playwright suites collect Chromium's JavaScript coverage for every page (`page.coverage.startJSCoverage`), converted with ast-v8-to-istanbul against the served source to lcov and joined into SHY-0674's report.
- [ ] Code Jest already loads in-process (public/js/core) is joined with the browser runs, one entry per file.
- [ ] SHY-0674's classification moves these files to "measured" and the
      their untested counts join the record, written in the same PR.

### Error paths

- [ ] A run whose report is missing, empty or measured none of these files
      fails CI, naming the suite (fails closed).

### Edge cases

- [ ] Inline scripts in HTML pages are measured or moved into files, never silently left out (planted: an inline script line reported).

### Performance

- [ ] Coverage runs as its own CI command, never in the 1 s unit step; its
      measured time is its limit at that step.

### Security

- [ ] Nothing is counted as run that did not run: a planted unrun line and an
      unrun branch arm are reported unrun, and a planted file outside every
      suite stays classed unmeasured and fails a PR that changes it.

### UX

- [x] Not applicable: developer tooling.

### i18n

- [x] Not applicable: no copy.

### Observability

- [ ] CI prints this kind's measured file count, its untested counts and every file
      still classed unmeasured.

## Announce

None: internal quality tooling with no change users can see.

## BDD Scenarios

**Scenario: a run line is reported run**

- **Given** a page script run by a Playwright test
- **When** the suite runs with coverage on
- **Then** the script's run lines are reported run

## Test Plan

- Unit tests of the conversion; planted unrun lines, branch arms and an
  unmeasured file, each seen in CI by step name.
- The no-holes rule applies: before/after lists, coverage of the changed
  code, mutations of every new control.

## Out of Scope

- The gate itself (SHY-0674) and the other kinds (EPIC-0016).

## Dependencies

- SHY-0674

## Risks & Mitigations

- Each converter can over-report; the Security AC's planted unrun lines keep
  it honest.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-21**: filed from the global ruling "Ratchet to 100%, unmeasured
  fails now" and Shyden's "Whole repo" choice for ShyTalk. P0: coverage tops
  the queue, and the group-roles hotfix waits on this epic. Scored 5
  from the measured counts above.
