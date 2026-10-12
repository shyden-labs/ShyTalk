---
id: SHY-0573
status: Draft
owner: claude
created: 2026-10-12
priority: P0
effort: L
estimate: 8
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0573: Every blocker is recorded in the story file and shown as a GitHub "Blocked by" link

## User Story

As the operator, I want each story to list the stories it is blocked by, and
the board to show those links, so that I can see which tickets must be done to
unblock the next one.

## Why

Operator, 2026-10-12, verbatim: *"go through all the open tickets and
prioritise them. any tickets blocking others needs to be marked as a
dependency so we know which tickets must be done to unblock the next
ticket."* Asked where the links should live, he chose a story-file field
synced to GitHub's built-in links: *"1. and i feel like this should be in the
template and global rules"* (now the global rule "every blocker is linked").

Measured 2026-10-12 on develop `7a03c84`:

- 305 open stories (Draft, In Review, In Progress). 204 of them name a SHY id
  in their Dependencies section, and 134 name one that is still open.
- Those mentions mix real blockers ("must land first", "hard prerequisite")
  with relations ("pairs with", "ideally", "either order"). Read one by one,
  they give **120 blocker links across 74 stories**, with no cycle. The list,
  with the rule used and the soft cases left out, is in
  `.superpowers/sdd/prioritisation/edges.py` on the filing session's checkout,
  and is copied into Notes when this story starts.
- No issue uses GitHub's "Blocked by" relationship today
  (`issues/2227` reports `blocked_by: 0, blocking: 0`). The REST API
  `repos/shyden-labs/ShyTalk/issues/<n>/dependencies/blocked_by` answers.
- The sync (`scripts/sync-stories-to-issues.sh`) already writes Priority,
  Type and Estimate from the story file to the board, so the story file is
  the source of truth and a link set only on GitHub would drift.

## Acceptance Criteria

### Happy path

- [ ] A story's frontmatter may carry `blocked_by: [SHY-XXXX, ...]`. The
      frontmatter checker accepts it: an array of existing story ids, none
      repeated, never the story itself.
- [ ] The story sync makes each issue's GitHub "Blocked by" links equal the
      file's list: it adds missing links and removes links the file no longer
      names. A blocker that is Done or Cancelled is still linked (GitHub shows
      it as closed).
- [ ] The 120 links measured in Why are written into their 74 story files,
      each re-read against its Dependencies text when written. The sync then
      shows them on the board.

### Error paths

- [ ] A `blocked_by` naming a story that does not exist, or the story itself,
      fails the checker with the file and the bad id.
- [ ] A cycle (A blocked by B, B blocked by A, at any depth) fails the
      checker's scan, naming the whole loop.
- [ ] A link the API refuses fails the sync run by name and is counted in
      its summary, never skipped silently.

### Edge cases

- [ ] An empty list `blocked_by: []` and a missing field both mean no
      blockers, and the sync removes any links the issue has.
- [ ] A story whose issue does not exist yet gets its links on the run that
      creates the issue.

### Performance

- [ ] The sync's API calls for links are counted, and a no-change run makes
      no write calls.

### Security

- [ ] The sync acts as the ShyTalk App; no new secret.

### UX

- [ ] Not applicable: no app surface. The board's blocked badge is GitHub's.

### i18n

- [ ] Not applicable.

### Observability

- [ ] The sync summary prints links added, removed and refused.

## BDD Scenarios

**Scenario: A blocker appears on the board**

- **Given** SHY-0563 lists `blocked_by: [SHY-0556]`
- **When** the story sync runs
- **Then** issue SHY-0563 shows "Blocked by" SHY-0556 on GitHub

**Scenario: A removed blocker disappears**

- **Given** an issue linked as blocked by another
- **When** the story file's list no longer names it and the sync runs
- **Then** the link is removed

**Scenario: A loop is refused**

- **Given** two stories that each list the other
- **When** the frontmatter checker scans the stories
- **Then** it fails, naming both

## Test Plan

- Checker cases for each accepted and refused form, each refusal planted and
  seen red.
- Sync cases against recorded API responses for add, remove, refuse and the
  no-change run; one real run on the board, read back by issue.

## Out of Scope

- Deciding priorities. The prioritisation proposal is applied in its own PR
  once SHY-0518 lets Draft stories be edited.
- `repo-template`, which its own session changes
  (`~/.claude/global-rules/pending-blocked-by-in-repo-template.md`).

## Risks & Mitigations

- **A link written from a misread Dependencies text.** Each of the 120 is
  re-read against its story when written, and soft wording is never linked.

## Dependencies

- SHY-0518: writing the 74 Draft story files fails the pre-merge gate until
  Draft stories can be edited. Once this story lands, it lists that in its
  own `blocked_by`.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; the board shows the links.

## Notes

- **2026-10-12**: Filed from the operator's prioritisation request. Scored
  8: one checker field with three refusals and a cycle scan, a sync step that
  adds and removes links, and 74 story files to write.
