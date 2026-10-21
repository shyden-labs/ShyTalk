---
id: SHY-0600
status: Draft
owner: unassigned
created: 2026-10-15
priority: P1
effort: L
estimate: 13
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0600: One issue form and a ticket check replace the story gate

## User Story

As **Shyden, the operator**, I can file every new ShyTalk ticket through the
same issue form and filer as every other project, and have every open ticket
checked against that form, so that no ticket is born half-written and every
ticket reads the same once story files stop.

## Why

- Shyden ruled 2026-10-15: one shared issue form, the same in every project
  and in repo-template (global note `pending-tickets-are-issues.md`).
- Shyden ruled 2026-10-16 (global rule, `reference-identity-and-agile.md`):
  every project files tickets the same way as Yawelo Idle. The template's
  copy is shyden-labs/repo-template#20, with `scripts/file-story.ts`, a filer
  that adds the issue to the board (title asserted first), sets `Estimate`
  and `Priority`, links "Blocked by" and the parent epic, and reads every
  field back.
- Asked whether ShyTalk keeps its own richer form, Shyden chose the template
  form exactly: *"if we need to expand again, we will do so on the
  template."* The form has five required parts: Story ("As a <who>, I can
  <what>, so that <why>"), Context, numbered testable Acceptance criteria,
  Announce (what this lets us tell people once it closes, on the site,
  roadmap or release notes, or "nothing" and why) and Definition of done.
- repo-template#20 landed 2026-10-21 (PR #53, 2739cdc). Its
  `.github/ISSUE_TEMPLATE/story.yml` carries the five parts under a note
  with the filing steps. Its `docs/project-board.md` has a "Filing a
  ticket" section, and its filer is `node scripts/file-story.ts
  <board-node-id> "<board title>" <story.json>`.
- Asked whether the check accepts the old tickets' shape, Shyden chose,
  verbatim: *"add announce to all. consistency wins"*. No old ticket is
  exempt. Told that the story gate also checks Done and Cancelled stories,
  Shyden ruled, verbatim: *"they ALL get it"*: closed stories too.
- Measured 2026-10-16 on `origin/develop` `8f20691fc33`: 545 story files,
  346 open (276 Draft, 70 In Review), 199 closed (186 Done, 13 Cancelled),
  0 with an Announce section. The story gate
  `scripts/check-story-frontmatter.sh` requires its sections from one list
  (`REQ_SECTIONS`, line 65); Announce is not in it. It skips no status, and
  the sync's first step runs it with `--scan` over every story file
  (`sync-stories-to-issues.yml` line 97).

## Acceptance Criteria

### Happy path

- [ ] 1. `.github/ISSUE_TEMPLATE/story.yml` is the template's form, copied
      from repo-template#20's merged copy, with its five required parts and
      nothing ShyTalk-only; any change it needs is proposed on the template.
- [ ] 2. Blank issues are turned off (`config.yml`), so every ticket uses the
      form.
- [ ] 3. `scripts/file-story.ts` is the template's filer, pointed at the
      ShyTalk Stories board (node id from `app_manifest.py`, title asserted
      before any write), acting as the ShyTalk App. It runs as
      `node scripts/file-story.ts <board-node-id> "<board title>" <story.json>`
      and reads every field back.
- [ ] 3a. The form keeps the template's steps note unchanged:
      - search first;
      - add the issue to the board, checking the board's title;
      - Estimate 1/2/3/5/8/13;
      - Priority P0-P5, a blocker at least the level of what waits;
      - a Blocked-by link per blocker;
      - the epic as parent;
      - Refs, never a closing keyword.
- [ ] 3b. ShyTalk's board doc (under `.project/`, where ShyTalk keeps its
      docs) gains the template's "Filing a ticket" section, with the ShyTalk
      board's node id and title.
- [ ] 4. Every story file, open and closed (545 measured), gains an
      `## Announce` section: what closing it lets (or let) us tell people,
      or "nothing" and why. The sync carries each to its issue.
- [ ] 5. The story gate's `REQ_SECTIONS` gains `Announce` in the same commit
      as the last of AC 4's files, and `--scan .project/stories` is green on
      that commit, so the sync's validate step never meets a story without
      it.
- [ ] 6. A ticket check reads every open issue on the board and fails,
      naming the issue and the part, when one of the five parts, `Priority`
      or `Estimate` is missing. Old story-file headings count as the form's
      parts (User Story = Story, Why = Context, Acceptance Criteria,
      Definition of Done); Announce has no old name. It runs in CI on a
      schedule and on demand.

### Error paths

- [ ] 7. An issue missing a part turns the check red with its number and the
      part's name.

### Edge cases

- [ ] 8. Issues that are not tickets (user bug reports without the `story`
      label, alert issues) are left out and counted as left out, by number.

### Performance

- [ ] 9. One paged board read per run.

### Security

- [ ] 10. The check reads with the App's read permissions only; the filer
      writes as the App, never as Shyden.

### UX

- [ ] 11. The form's field hints are the template's, unchanged.

### i18n

- [ ] N/A: operator tooling.

### Observability

- [ ] 12. A failing scheduled check opens or updates one issue assigned to
      ShydenMcM, per the "nothing stops silently" rule.

## Announce

Nothing: operator tooling with no learner-facing change.

## BDD Scenarios

**Scenario: a ticket is filed without Announce**

- **Given** an open issue on the board with no Announce part
- **When** the ticket check runs
- **Then** it fails, naming that issue and the missing part

**Scenario: an old ticket's headings count**

- **Given** an open issue with User Story, Why, Acceptance Criteria,
  Announce and Definition of Done
- **When** the ticket check runs
- **Then** it passes that issue

## Test Plan

1. Unit: the part and field parser over fixture issue bodies, one test per
   part and per old heading; the GitHub client mocked.
2. Floor: the count of issues checked is recorded and asserted, so an empty
   read cannot pass; a planted missing part goes red.
3. Story gate: a fixture story file without Announce goes red.
4. After the backfill: story files with an Announce section equal the
   story file count, both read again from the filesystem.

## Out of Scope

- Retiring the story gate (SHY-0603).
- Any form part the template does not have.

## Dependencies

- repo-template#20's form and filer, merged there (read, not changed, from
  this repo).

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| An Announce line is written carelessly to finish the backfill | Each line is written from the story's ACs; any that would announce something not yet built says "nothing yet". |
| An issue-only edit is overwritten by the sync | The backfill edits story files; the sync carries them. |
| The gate requires Announce before every file has it, and the sync stops | AC 5: one commit, with a full `--scan` green on it. |

## Definition of Done

- [ ] A real ticket filed through the form and filer passes the check; its
      number in Notes.
- [ ] The check's first full run is green over every open ticket; its totals
      in Notes.
- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-15**: Filed from Shyden's ruling. Estimate 5: a form plus a
  checker with a floor, sized against the story gate it replaces.
- **2026-10-16**: Rewritten to the template's form and filer (Shyden:
  template form exactly) and to Announce on every open ticket (Shyden:
  "consistency wins"). Estimate 8, effort L: the 17-section form shrinks to
  a copy, the filer is a copy, and the 346-file Announce backfill is added.
- **2026-10-16**: The backfill covers all 545 story files, closed too
  (Shyden: "they ALL get it"), and the gate change is ordered with it.
  Estimate 8 -> 13: 199 more Announce sections, each written from a
  finished story's Notes and release.
- **2026-10-22**: repo-template#20 landed (PR #53). ACs 3, 3a and 3b quote
  its landed form, steps note, filing section and filer. Estimate unchanged
  at 13: the two new ACs copy the template.
