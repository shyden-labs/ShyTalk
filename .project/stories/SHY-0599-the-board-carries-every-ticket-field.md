---
id: SHY-0599
status: Draft
owner: unassigned
created: 2026-10-15
priority: P1
effort: M
estimate: 5
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0599: The board carries every field a story file carries

## User Story

As **Shyden, the operator**, I want every fact a ShyTalk story file holds to
live on its GitHub issue and the ShyTalk Stories board, so that the issue can
become the ticket and the story files can stop.

## Why

Shyden ruled 2026-10-15 (AskUserQuestion, after the side-by-side
https://claude.ai/artifact/129tZi4DPFKL7BHv2HFnnC): tickets become GitHub
issues in every project, as in Yawelo, with this field mapping. Global note:
`~/.claude/global-rules/pending-tickets-are-issues.md`.

Measured 2026-10-15 on the board (526 items, 325 open issues) against the 325
open story files on `origin/develop`:

- Already on every open issue: the full story body (every section and AC),
  `Pri` 325/325, `Estimate` 325/325, `Effort` 325/325, `Status` 325/325,
  `SHY ID` 325/325, issue type 325/325 (Bug 110, Feature 48, Task 167),
  `Roadmap IDs` 37/37.
- Missing: **MVP** (`mvp: true` on 185 open stories; no board field),
  **Epic** (144 open stories; 0 cards set, the options are 3-digit
  `EPIC-001` against the files' `EPIC-0001`), **blocked by** (8 stories;
  0 GitHub links), **Draft** (the board shows `Todo`), **owner** (0 issues
  assigned), **released in** (165 stories; no field).
- The field is named `Pri` (P0-P3); the shared `board-next.ts` reads
  `Priority` (P0-P5). SHY-0596 measured that, and is folded in here.

## Acceptance Criteria

### Happy path

- [ ] `Pri` is renamed `Priority`, keeping every card's value; options P4 and
      P5 are added.
- [ ] `Status` gains a `Draft` option; every card whose story is Draft shows
      it.
- [ ] A single-select `MVP` field (Yes / No) is set on every open card from
      `mvp:`.
- [ ] Each epic is a parent issue; each story with `epic:` is its sub-issue
      (144 open measured).
- [ ] Each `blocked_by:` entry is a GitHub "Blocked by" link (8 measured);
      this replaces SHY-0573's file-to-link sync.
- [ ] Each Done story's `released_in:` is its issue's milestone, one
      milestone per release.
- [ ] `board-next.ts` names ShyTalk's next ticket; its output is quoted in
      Notes.

### Error paths

- [ ] The backfill script fails, naming the story and the field, on any value
      it cannot place; it writes nothing partial for that card.

### Edge cases

- [ ] Running the backfill twice changes nothing the second time (it compares
      before writing), and says so.

### Performance

- [ ] The backfill reads the board once per run, not once per card.

### Security

- [ ] It acts as the ShyTalk App; no personal token.

### UX

- [ ] The board's default view shows Priority, Estimate, Status and MVP.

### i18n

- [ ] N/A: operator tooling.

### Observability

- [ ] The script prints, per field, cards set, unchanged and failed, with a
      total that equals the open count.

## BDD Scenarios

**Scenario: a story's facts reach its card**

- **Given** an open story with `mvp: true`, `epic: EPIC-0001` and a blocker
- **When** the backfill runs
- **Then** its card shows MVP Yes, it is a sub-issue of the epic's issue, and
  it has a Blocked-by link to the blocker's issue

## Test Plan

1. Unit: the mapping from frontmatter to field writes, with the GitHub client
   mocked; one test per field and per failure.
2. Dry run against the real board, printed in Notes before the write run.
3. After the write run: the coverage counts above read again, each field at
   its story count.

## Out of Scope

- The issue form (SHY-0600) and the cut-over (SHY-0603).

## Dependencies

- None blocking.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The sync overwrites the new fields on its next run | Change the sync in the same PR to leave fields it does not own alone, with a test. |

## Definition of Done

- [ ] Coverage counts read back on the board, quoted in Notes.
- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-15**: Filed from Shyden's ruling. Estimate 5: one script plus a
  sync change, sized against SHY-0534 (5).
