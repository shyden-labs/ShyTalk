---
id: SHY-0601
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

# SHY-0601: Every issue matches its story file before the switch

## User Story

As **Shyden, the operator**, I want proof that every story's GitHub issue
holds exactly what its file holds, so that switching to issues loses nothing.

## Why

- 522 story files on `origin/develop` (2026-10-15); the board holds 526
  items, 325 of them open issues.
- Each synced issue ends with a footer naming the commit and a `body-hash`
  (seen on #2346: `body-hash: c248269c...`), so a file and its issue can be
  compared without trusting the sync.

## Acceptance Criteria

### Happy path

- [ ] A script compares each story file with its issue (body text, title,
      state against status) and reports equal, different or missing, with
      totals that add up to 522.
- [ ] Every difference is fixed on the issue (by one sync run from develop,
      or by hand where the sync cannot), then the script reports 522 equal.

### Error paths

- [ ] A story with no issue, or two issues for one story, is named and fails
      the run.

### Edge cases

- [ ] Cancelled and Done stories are compared too (closed issues).

### Performance

- [ ] One paged read of the repo's issues per run.

### Security

- [ ] Read-only.

### UX

- [ ] The report lists each different story with its issue number.

### i18n

- [ ] N/A.

### Observability

- [ ] The final report is quoted in Notes.

## BDD Scenarios

**Scenario: an issue drifted from its file**

- **Given** a story file edited after its last sync
- **When** the compare runs
- **Then** that story is listed as different, with its issue number

## Test Plan

1. Unit: the compare over fixture pairs (equal, different, missing, double),
   GitHub client mocked.
2. Floor: the count of files compared equals the count of story files found.
3. Real run on develop; report in Notes.

## Out of Scope

- Changing any field (SHY-0599).

## Dependencies

- None blocking.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A late edit lands between the check and the cut-over | SHY-0603 runs this check again as its first step. |

## Definition of Done

- [ ] 522 of 522 equal, quoted in Notes.
- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-15**: Filed from Shyden's ruling.
