---
id: SHY-0603
status: Draft
owner: unassigned
created: 2026-10-15
priority: P1
effort: L
estimate: 8
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
blocked_by: [SHY-0599, SHY-0600, SHY-0601, SHY-0602]
---

# SHY-0603: ShyTalk stops using story files; the issues are the tickets

## User Story

As **Shyden, the operator**, I want ShyTalk's tickets to live only as GitHub
issues, so that the board is the one source of truth, the roadmap is live and
no bot commits to develop.

## Why

Shyden ruled 2026-10-15: every project uses issues instead of story files,
and new tickets are plain issue numbers while old ones keep their SHY ID.

Measured 2026-10-15 on `origin/develop`:

- The files-first chain: `sync-stories-to-issues.sh` 1,773 lines, its
  workflow 259, `sync-shy-to-roadmap-data.mjs` 362, its workflow 171,
  `check-story-frontmatter.sh` 534, `reconcile-story-index.sh` 103,
  `check-orphaned-stories.js` 157, `story-progress.js` 232, `SHY-INDEX.md`
  590 lines, 35 related test files.
- The sync's id-map bot committed to develop 15 times since 2026-10-01; each
  put every open PR behind (a code PR's CI is 16.8-17.9 min). SHY-0584 was
  filed for that; this removes its cause.

## Acceptance Criteria

### Happy path

- [ ] SHY-0601's compare runs again first and reports every issue equal.
- [ ] The sync, its id-map and the roadmap-data workflow are deleted; nothing
      commits to develop or main on a bot's behalf.
- [ ] `.project/stories/` becomes read-only history: a check refuses any new
      or changed story file, and the README there says tickets are issues.
- [ ] Every script, hook and CI step that reads story files reads the board
      instead (the progress figures, the pre-merge gate, the release notes),
      each listed in Notes with its replacement.
- [ ] New tickets are plain issue numbers, filed through SHY-0600's form
      and filer (the template's); old ones keep `SHY-NNNN` in the title and
      the `SHY ID` field.
- [ ] The project CLAUDE.md, the handover template and the ShyTalk memories
      that tell a session to write story files are updated in the same PR.
- [ ] Each open story below is closed as superseded, with a comment naming
      what replaced it, or kept with a reason in Notes: SHY-0071, SHY-0175,
      SHY-0353, SHY-0360, SHY-0394, SHY-0477, SHY-0486, SHY-0513, SHY-0519,
      SHY-0533, SHY-0535, SHY-0539, SHY-0545, SHY-0552, SHY-0560, SHY-0567,
      SHY-0573, SHY-0584, SHY-0594, SHY-0596.

### Error paths

- [ ] A PR that adds a story file fails CI, naming the file and pointing to
      the issue form.

### Edge cases

- [ ] Links to story files in old issues and docs still resolve (the files
      stay in git).

### Performance

- [ ] CI time of a docs-only PR is measured before and after.

### Security

- [ ] The removed workflows' secrets (the board PAT, if unused) are deleted
      from their environments, and the read-back is quoted.

### UX

- [ ] N/A: no learner-facing change beyond SHY-0602.

### i18n

- [ ] N/A.

### Observability

- [ ] The two progress estimates come from `board-progress.ts` only, and
      match the roadmap's.

## BDD Scenarios

**Scenario: a merge no longer moves develop under open PRs**

- **Given** two open PRs that are up to date with develop
- **When** one of them merges and files no ticket
- **Then** develop gains exactly that merge commit and no bot commit

## Test Plan

1. A guard test that `.project/stories/` gains no file (floored on today's
   522).
2. Grep-based sweep, derived from the filesystem, for every reader of
   `.project/stories` or `SHY-INDEX`; each reader converted or removed.
3. After merge: read develop's next merges for bot commits (none).

## Out of Scope

- Other projects' moves: each project's own session files its own ticket.

## Dependencies

- Blocked by SHY-0599 (fields), SHY-0600 (form and check), SHY-0601
  (bodies verified) and SHY-0602 (live roadmap).

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A session keeps writing story files from habit | The CI refusal and the updated memories; the global note says so in every session. |
| A superseded story still held something needed | Each is read before closing; anything still needed becomes an issue. |

## Definition of Done

- [ ] A week of develop merges with no bot commit, quoted in Notes.
- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-15**: Filed from Shyden's ruling. Estimate 8: deletion and
  rewiring across scripts, hooks and docs, sized against the size of the
  chain above.
