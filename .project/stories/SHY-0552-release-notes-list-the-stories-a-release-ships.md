---
id: SHY-0552
status: Draft
owner: claude
created: 2026-10-11
priority: P1
effort: S
estimate: 3
type: bug
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0552: Release notes list the stories a release ships

## User Story

As the operator approving a production deploy, I want each GitHub release's
notes to list the stories it ships, so that I can see what I am approving
without rebuilding the list from git.

## Why

Measured 2026-10-11: the bodies of `v0.97.15`, `v0.98.0` and `v0.99.0` are
each about 58 characters ("Internal release with no user-facing changes."),
although `v0.97.14..v0.99.0` carries 63 backend/rules/web commits across 41
tickets (SHY-0550's deploy had to rebuild the list by hand).

Two causes in `release.yml` "Generate release notes from PRs since last tag":

1. The allowlist keeps only subjects starting `feat|fix|perf`, but merges are
   titled `SHY-NNNN: ...`: of 119 first-parent subjects across the three
   ranges, 0 matched the allowlist and 43 were SHY-titled.
2. It walks `--first-parent` on main, where develop arrives as one promotion
   merge ("Promote develop to main: 333 commits (106 stories)"), so the
   stories inside a promotion are never seen.

## Acceptance Criteria

### Happy path

- [ ] The notes list every story (`SHY-NNNN` and `EPIC-NNNN`) merged between
      the previous tag and the new one, including those inside a promotion
      merge, one line each with its title, deduplicated.
- [ ] Run against `v0.97.14..v0.99.0` (a fixture of those subjects), the
      generator lists the 41 tickets measured on 2026-10-11.

### Error paths

- [ ] A range with no story lines still says so in words, and a `git log`
      failure still aborts the job (the existing `set -euo pipefail` contract).

### Edge cases

- [ ] Reverted stories are listed under "Reverted", not as shipped.
- [ ] Bracketed (`[SHY-0227] ...`) and em-dash (`SHY-0525 — ...`) title forms
      are recognised.

### Performance

- [ ] Generation stays a single `git log` walk; no per-commit API calls.

### Security

- [ ] Subjects are written as text only (no shell evaluation of commit
      subjects); a subject containing `$(...)` is planted in the unit test.

### UX

- [ ] The Play internal-track notes keep their current limit and wording;
      only the GitHub release body gains the story list.

### i18n

- [ ] Not applicable: operator-facing release text.

### Observability

- [ ] The job summary prints how many stories were found and the range used.

## BDD Scenarios

**Scenario: A promotion release lists its stories**

- **Given** develop was promoted to main in one merge carrying 106 stories
- **When** a release is cut
- **Then** the GitHub release body lists those stories by ID and title

**Scenario: Subjects without Conventional-Commit prefixes are kept**

- **Given** merges titled `SHY-0350: You cannot find anyone to message`
- **When** notes are generated
- **Then** the line appears in the notes

## Test Plan

- Unit: the generator extracted to a script, driven by a fixture of
  subjects (no git process in the unit test).
- CI: the release workflow's existing checks.

## Out of Scope

- Store-listing release notes (SHY-0361 covers tester notes).

## Dependencies

- None.

## Risks & Mitigations

- Very long bodies: group by epic if over GitHub's body limit.

## Definition of Done

- [ ] Every AC ticked with evidence; board item Done.

## Notes

- Found 2026-10-11 while preparing SHY-0550 (v0.99.0 production deploy).
