---
id: SHY-0612
status: Draft
owner: claude
created: 2026-10-16
priority: P1
effort: S
estimate: 3
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0612: Alert issues stay off the ShyTalk Stories board

## User Story

As the operator, I want automatic alert issues kept off the ShyTalk Stories
board, so that progress and its ETA count real stories only, while every alert
still reaches me as an issue assigned to me.

## Why

Shyden ruled on 2026-10-16 ("Keep alerts off the board"): automatic alert
issues are still opened and assigned to ShydenMcM, but are never added to the
ShyTalk Stories board, and #2369 is removed from it.

Progress counts every board item. An open alert has no `Estimate`, so the
by-effort figure goes blank. A closed one counts as a finished story: closing
#2369 ("Story sync to the board is failing", opened by `github-actions`)
moved closed 201 to 202 and the 7-day pace with it.

Measured 2026-10-16 on `2700e783604`:

- #2369 is still on the board (item `PVTI_lADOEOcG584BZ_lNzhBHYkg`).
- Two workflows open alert issues: `sync-stories-to-issues.yml` (`alert`
  job, no label) and `deploy-prod.yml` (labels `critical,prod-desync`).
  SHY-0551 will add more (one per scheduled job).
- The story sync adds issues to the board only by story (`addProjectV2ItemById`
  with the story's own issue), so it did not add #2369.
- The board has 7 built-in workflows, all enabled, among them
  "Auto-add to project" (number 7) and "Auto-add sub-issues to project"
  (number 4). The API lists them but not their filters.

Assumed, not yet proven: #2369 arrived through "Auto-add to project"; its
timeline holds no `AddedToProjectV2Event` to name the actor. Also assumed:
the API has no mutation that edits a workflow's filter (a schema query was not
run: it names no repository, so the router refuses it as the App).

## Acceptance Criteria

### Happy path

- [ ] First, the cause is proven and written in Notes: the GraphQL schema is
      read for a mutation that edits a project workflow's filter, and a
      scratch issue (no `story` label, closed and deleted afterwards) shows
      whether the board's auto-add picks it up, with timings.
- [ ] Every workflow that opens an alert issue gives it one shared `alert`
      label (created if missing), alongside any labels it has today.
- [ ] Alert issues are never added to the board. The mechanism follows from
      the first AC: either the auto-add filter excludes `label:alert` (if
      only the web UI can set it, that is Shyden's step, given to him as an
      exact filter string to paste), or auto-add is limited to issues that
      are stories. Whichever is chosen, Notes says why.
- [ ] #2369 is removed from the board (`deleteProjectV2Item`, board title
      asserted first), and the closed count reads 201 again from
      `board-progress.ts`.

### Error paths

- [ ] A check fails, naming the issue, when any board item's issue carries
      the `alert` label. It runs daily and after each alert job, and opens an
      `alert` issue (assigned to ShydenMcM, kept off the board) when red.
- [ ] A workflow that opens an issue without the `alert` label is refused by
      a guard over `.github/workflows/`, which reads the stripped text and
      counts the `gh issue create` sites it judged against a recorded floor.

### Edge cases

- [ ] An alert job that comments on an existing open alert (the sync's
      `gh issue comment` path) adds the label if the issue lacks it.
- [ ] An alert issue later turned into real work is re-filed as a story, not
      moved onto the board with its `alert` label.

### Performance

- [ ] Not applicable: one label and one board query per run.

### Security

- [ ] The check reads the board as the ShyTalk App, never as the operator.

### UX

- [ ] The check's failure names the issue number, its title and the board
      item id, and says how to remove it.

### i18n

- [ ] Not applicable: operator tooling, English only.

### Observability

- [ ] A planted alert-labelled issue on the board turns the check red, seen
      once in CI and recorded in Notes with its run id.

## BDD Scenarios

**Scenario: a failing sync alerts without touching the board**

- **Given** the story sync fails
- **When** its `alert` job opens an issue
- **Then** the issue carries the `alert` label and is assigned to ShydenMcM
- **And** it never appears on ShyTalk Stories

**Scenario: an alert that reaches the board is caught**

- **Given** an issue with the `alert` label is on the board
- **When** the check runs
- **Then** it fails naming that issue and opens an alert of its own

## Test Plan

- Guard over `.github/workflows/`: every `gh issue create` site carries
  `alert`; floor at the measured count (2 today); mutations: drop the label
  from each site, add a new unlabelled site, and watch each go RED.
- The board check is tested with a mocked board response (unit) and run
  once against the real board (CI).

## Out of Scope

- Changing what alerts say or who they are assigned to.
- SHY-0551's new scheduled-job alerts, which adopt the label when they land.

## Dependencies

- None blocking. SHY-0551 and the cut-over from story files to issues must
  keep alert issues labelled.

## Risks & Mitigations

- Limiting auto-add could stop real tickets reaching the board after the
  cut-over to issues: the filter is checked against a scratch story issue as
  well as a scratch alert.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-16**: Filed on Shyden's ruling above, from the SHY-0597 close-out.
- Scored 3, like SHY-0551 (one workflow pattern, a guard and a check): two
  workflows labelled, one guard, one board check, one board item removed, and
  a possible UI step for Shyden.
- **2026-10-20**: A second alert, #2474 ("Story sync to the board is
  failing", opened by `github-actions` 2026-10-19 17:21 UTC, closed 20:31
  UTC, no labels), was recorded on the ShyTalk Stories board by the
  2026-10-19 session. Read 2026-10-20: it is closed and on no project;
  what took it off is not recorded. A second alert reaching the board is
  more evidence for this story.
