---
id: SHY-0569
status: Draft
owner: claude
created: 2026-10-12
priority: P0
effort: M
estimate: 5
type: bug
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0569: Dependabot auto-merge checks the real update, not only Dependabot's metadata

## User Story

As the operator who lets Dependabot merge patch and minor updates alone, I
want auto-merge to check the versions a PR really moves, and to switch
itself off whenever it cannot be sure, so that a major update never merges
without a person.

## Why

Measured 2026-10-12 on PR #2190: its head commit `b0cf68179` says "Bump
firebase from 12.18.0 to 13.0.0" in its title and body, and its diff moves
`"firebase": "^12.18.0"` to `"^13.0.0"`, but the commit's metadata block
still says `dependency-version: 12.19.0`, `update-type:
version-update:semver-minor`. `dependabot/fetch-metadata` reads that block,
so `dependabot-auto-merge.yml` judged a major update to be minor (run
38212640523), approved it and armed `gh pr merge --auto`; it merged at
06:36Z and broke the root install (SHY-0568). The workflow also never turns
auto-merge off: a push judged unsafe leaves an earlier arming in place. At
the time of filing 9 open Dependabot PRs were armed, all minor by title.

## Acceptance Criteria

### Happy path

- [ ] Auto-merge is armed only when every "from A to B" version pair in the
      PR title and body is a patch or minor change AND the metadata's
      update type is patch or minor (GitHub Actions keep their SHA-pinned
      exception).
- [ ] On every other outcome the workflow switches auto-merge off for that
      PR and prints why.

### Error paths

- [ ] Metadata that cannot be read, a PR naming no version pair, or a
      version it cannot parse leaves auto-merge off.

### Edge cases

- [ ] #2190's exact title, body and metadata are refused.
- [ ] A 0.x change in the second number counts as major.
- [ ] A grouped PR is judged on every pair it lists.

### Performance

- [ ] Not applicable.

### Security

- [ ] The judging script runs from the base branch, never from the PR's own
      code; permissions do not grow.

### UX

- [ ] Not applicable.

### i18n

- [ ] Not applicable.

### Observability

- [ ] Each decision prints the pairs it read, the metadata type and the
      verdict.

## BDD Scenarios

**Scenario: metadata says minor, the PR says major**

- **Given** a Dependabot PR whose metadata says semver-minor
- **When** its title says "from 12.18.0 to 13.0.0"
- **Then** auto-merge is switched off and the PR waits for a person

## Test Plan

- Unit tests of the judging script, one per case; a pin of the workflow
  steps; the open armed PRs re-judged after merge.

## Out of Scope

- A PR job that installs the root packages (SHY-0571).

## Dependencies

- None.

## Risks & Mitigations

- **Safe updates stop merging alone.** Patch and minor still merge when the
  title, body and metadata agree; only a disagreement or an unreadable PR
  waits for a person.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-12**: Shyden: "this needs to be fixed". Scored 5: a script with
  its tests, the workflow change and its pin, and the re-judging of the
  armed PRs.
