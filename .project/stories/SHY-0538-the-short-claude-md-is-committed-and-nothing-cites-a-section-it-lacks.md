---
id: SHY-0538
status: Draft
owner: claude
created: 2026-10-07
priority: P2
effort: S
estimate: 2
type: chore
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0538: The short CLAUDE.md is committed, and no comment cites a section it does not have

## User Story

As **Shyden, the operator**, I want ShyTalk's mission and its not-a-dating-app
guardrail committed in a short `CLAUDE.md`, so that every session, on any
machine or checkout, starts from them; and I want no code comment to send a
reader to a CLAUDE.md section that no longer exists.

## Why

**SHY-0358 (2026-08-20)** deleted the 466-line `CLAUDE.md` because it was
injected into every turn. **Operator reversal (2026-10-07):** told the
replacement is a short file holding the mission and the not-a-dating-app
guardrail, the operator said *"revert this decision"*. The file exists in the
working tree (12 lines, untracked, not ignored) and is not yet committed.

Measured with `git grep "CLAUDE\.md"` outside `.project/` at `aabe8e7`:
19 code files mention CLAUDE.md, and at least 13 cite a section the short
file does not have: `§ "Agile Way of Working"` (6), `§ No Stubs` (4),
`§ API-only backend access` (1), `"Translations — …"` (1),
`"KMP iOS Compatibility (commonMain)"` (1), `"Firestore quota awareness"` (1).
SHY-0358 left them pointing at a file that was gone. A reader following one
finds nothing.

## Acceptance Criteria

### Happy path

- [ ] `CLAUDE.md` at the repo root is committed with the short content
      (mission, moderation and atmosphere, the not-a-dating-app guardrail and
      its SHY-0359 precedent), under 30 lines.
- [ ] Every code or workflow comment that cites a CLAUDE.md section the
      committed file does not have is reworded to name where the rule now
      lives: the guard script that enforces it, or the story that set it.
      The list of sites is derived with `git grep`, not taken from this
      story, and the before and after counts are recorded in Notes.

### Error paths

- [ ] A cited rule that nothing enforces and no story records is reported in
      Notes by name, and a story is filed for it, rather than the citation
      being deleted silently.

### Edge cases

- [ ] Comments that mention CLAUDE.md without citing a section (for example
      `pr-checks.yml`'s history of SHY-0296 and SHY-0358) are left as they
      are, and SHY-0358's history is extended by one line naming this story.
- [ ] `.project/**` story files are history and are not rewritten.

### Performance

- [ ] Not applicable.

### Security

- [ ] Not applicable: no code path changes.

### UX

- [ ] Not applicable.

### i18n

- [ ] Not applicable.

### Observability

- [ ] Not applicable.

## BDD Scenarios

**Scenario: the guardrail is in the repository**

- **Given** a fresh clone of develop
- **Then** CLAUDE.md exists at the root
- **And** it states that ShyTalk is not a dating app

**Scenario: no comment cites a missing section**

- **Given** every comment that cites a CLAUDE.md section
- **Then** the section named exists in the committed CLAUDE.md, or the comment names the guard or story that holds the rule instead

## Test Plan

- `git grep` before and after, counts in Notes.
- The whole backend suite and lint run in CI (comment-only edits to test
  files must not change any test).

## Out of Scope

- A guard refusing future section citations. After this story no citation
  remains, so such a guard would search an empty population, which the
  global guard rules forbid; the rewording is the fix.

## Dependencies

- None.

## Risks & Mitigations

- **The file grows back to 466 lines.** Mitigation: the under-30-lines AC, and
  SHY-0358's reasoning (per-turn context cost) quoted in the file's PR.

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] CI green by step name on the PR head SHA; merged into `develop`.

## Notes

- **2026-10-07**: Filed from the operator's reversal of SHY-0358 the same day.
- Scored 2: one new file plus comment rewording across about 19 files,
  smaller than SHY-0535 (5).
