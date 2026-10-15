---
id: SHY-0596
status: Draft
owner: unassigned
created: 2026-10-15
priority: P1
effort: S
estimate: 3
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0596: The board names its priority field Priority, so the next ticket can be picked from it

## User Story

As **Shyden, the operator**, I want the ShyTalk Stories board to keep each
story's priority in a field called `Priority`, and the story sync to fail
loudly when a field it writes is missing, so that the shared `board-next.ts`
can name the next ticket and no story field is ever dropped without a word.

## Why

Found 2026-10-15 at the start of session shytalk-5e's second half.

- Shyden's global rule: the board's `Priority`, never a handover, picks the
  next ticket, through `board-next.ts`.
- `node repo-template-6/scripts/board-next.ts PVT_kwDOEOcG584BZ_lN "ShyTalk Stories"`
  (repo-template branch `6-priority-field`, the only copy of the script) refused:
  `324 open tickets have no Priority`, naming all 324.
- The cause is the field's name, not missing data. The board's fields, read the
  same day: `Pri` (single select: P0, P1, P2, P3), `Effort`, `Estimate`,
  `Status`, `SHY ID`, `Roadmap IDs`, `Epic`. The script reads
  `fieldValueByName(name: "Priority")` and accepts P0 to P5.
- `scripts/sync-stories-to-issues.sh:917` and `:929` look the field up as
  `"Pri"`; `express-api/tests/scripts/sync-stories-to-issues-board-fields.test.js`
  lines 189, 1130 and 1581 pin that name.
- The sync skips a field it cannot find without failing
  (`if [ -n "$pri" ] && [ -n "$pri_field" ]`). Renaming the board field alone
  would silently stop every Priority write.
- The same silent skip is live today: the sync writes a `Type` field
  (`get_field_id "Type"`, line 919), and the board has no `Type` field, so no
  story's type has ever reached the board. The story files hold seven values:
  bug 194, infra 144, feature 65, chore 64, refactor 43, docs 6, spike 3.
- Story files on `origin/develop` 481e2f2144c: 150 P0, 252 P1, 117 P2, 14 P3
  (every story, all statuses).

## Acceptance Criteria

### Happy path

- [ ] The board's `Pri` field is renamed `Priority`, keeping its options, so
      every card keeps its value; options `P4` and `P5` are added so the field
      matches the shared P0 to P5 scale.
- [ ] The sync writes `Priority` from each story's `priority:`.
- [ ] `board-next.ts` run against the board names a ticket instead of refusing;
      its output is quoted in Notes.
- [ ] The board has a `Type` field whose options cover every `type:` value in
      the story files, and the sync fills it.

### Error paths

- [ ] When a field the sync writes (Priority, Effort, Estimate, Type, SHY ID,
      Roadmap IDs, Status) is missing from the board, the sync fails and names
      the missing field. It does not skip it.
- [ ] When a story's value has no matching option on the board (for example
      `priority: P7`), the sync fails, naming the story and the value.

### Edge cases

- [ ] A story with no `priority:` still fails the story gate as today; the sync
      does not invent a value.
- [ ] A rename in progress (board has neither `Pri` nor `Priority`) fails the
      sync naming `Priority`.

### Performance

- [ ] N/A: one field lookup per run, as today.

### Security

- [ ] N/A: the sync keeps acting as the ShyTalk App with its current
      permissions; renaming a field needs no new grant.

### UX

- [ ] The failure text names the field and the board, and says how to fix it
      (add or rename the field), in one line.

### i18n

- [ ] N/A: operator-facing English.

### Observability

- [ ] A failed field write counts in the sync's failure total and turns the
      run red, so the daily outcome check sees it.

## BDD Scenarios

**Scenario: the next ticket is picked from the board**

- **Given** every open card carries a `Priority`
- **When** `board-next.ts` runs against ShyTalk Stories
- **Then** it names one open ticket, the highest Priority first

**Scenario: a missing field fails the sync**

- **Given** the board has no `Type` field
- **When** the story sync runs
- **Then** it fails, naming `Type` and the board, and writes no partial success

## Test Plan

1. RED first: change the three `'Pri'` references in
   `sync-stories-to-issues-board-fields.test.js` to `'Priority'`; add a test
   with a board fixture lacking each written field in turn (one test per field,
   `test.each`), expecting a failure naming it; watch every one fail.
2. Add a test for an unknown option value, expecting a failure naming the
   story and the value.
3. Mutation: restore the `[ -n "$pri_field" ]` skip; the missing-field test
   for Priority goes red.
4. After merge: rename the board field and add `Type`, run the sync on
   `develop`, read a sample of cards back by `project{title}`, and run
   `board-next.ts`.

## Out of Scope

- The `Epic` field's 3-digit options (tracked separately, per the sync's
  comment at line 911).
- Merging `board-next.ts` into repo-template's `main`: that repo's own work.

## Dependencies

- None blocking. The board edits (rename, `Type` field) are made as the
  ShyTalk App; if the App cannot edit project fields, they are Shyden's.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Something else reads the field by the name `Pri` | `git grep` for the name across the repo before the rename (on 481e2f2144c only the sync and its test name it); the progress scripts read `Estimate`. |
| The rename runs before the code change lands, so the sync fails | Land the code first; its missing-field failure names `Priority`, which tells whoever sees it to make the rename. |

## Definition of Done

- [ ] `board-next.ts` output quoted in Notes after the rename.
- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-15**: Filed when `board-next.ts` refused to pick ShyTalk's next
  ticket. Board fields and story priorities measured on `origin/develop`
  481e2f2144c.
