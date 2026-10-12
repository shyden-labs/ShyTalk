---
id: SHY-0572
status: In Review
owner: claude
created: 2026-10-12
priority: P1
effort: XS
estimate: 1
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0572: GitHub Actions majors wait for a person, like every other major

## User Story

As the operator who lets Dependabot merge small updates alone, I want a
major GitHub Actions update to wait for me too, so that no major release of
anything changes CI without a person looking.

## Why

After SHY-0569 the auto-merge judge still allowed every GitHub Actions
update, majors included, on the reasoning that Actions are SHA-pinned so a
major "is just a tag bump". A pin fixes which code runs, not whether a major
release changes how CI behaves (firebase 13 showed what one unseen major
does). Measured 2026-10-12 over 90 days: 1 Actions major auto-merged
(`actions/setup-node` 6.4.0 -> 7.0.0, #1683) of 6 single Actions bumps.
Shyden chose (AskUserQuestion, 2026-10-12): "Hold Actions majors".

## Acceptance Criteria

### Happy path

- [x] An Actions patch or minor update still auto-merges.
      _Proof: case `actions/setup-node 7.0.0 -> 7.1.0`, allowed._
- [x] An Actions major waits: auto-merge is off.
      _Proof: case `7.1.0 -> 8.0.0` with major metadata, refused; red on the old judge (with the exception)._

### Error paths

- [x] An Actions major hidden under minor metadata is refused by its
      version pair.
      _Proof: case `6.4.0 -> 7.0.0` (#1683's bump) with minor metadata: "is a major change"; red on the old judge._

### Edge cases

- [x] Both ecosystem spellings (`github_actions`, `github-actions`) get no
      exception.
      _Proof: the hyphenated case refused; red on the old judge. The judge no longer reads the ecosystem at all._

### Performance

- [x] Not applicable.

### Security

- [x] Not applicable beyond the above.

### UX

- [x] Not applicable.

### i18n

- [x] Not applicable.

### Observability

- [x] The judge prints the same reasons for Actions as for packages.
      _Proof: the cases above assert the same reason strings packages get._

## BDD Scenarios

**Scenario: a major Action release**

- **Given** a Dependabot PR bumping `actions/setup-node` from 7.1.0 to 8.0.0
- **When** the auto-merge workflow judges it
- **Then** auto-merge is off and the PR waits for a person

## Test Plan

- Unit tests of the judge (both spellings, a hidden major, a minor that
  still merges); a mutation restoring the exception shown red.

## Out of Scope

- How Actions are pinned (unchanged: full SHAs).

## Dependencies

- SHY-0569 (merged as `21cc257e759`).

## Risks & Mitigations

- **More manual merges.** About one a quarter at the measured rate.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-12**: Raised by a side agent after SHY-0569 merged; Shyden
  chose to hold Actions majors. Scored 1.
