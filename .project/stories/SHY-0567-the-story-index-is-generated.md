---
id: SHY-0567
status: Cancelled
owner: claude
created: 2026-10-12
priority: P1
effort: M
estimate: 5
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0567: The story index is generated from the story files, so two PRs never conflict in it

## CANCELLED — superseded by SHY-0603

SHY-0603 retires the story files and this tooling with them; this story
fixes no live defect (only speed or index tidiness).

Closed in the 2026-10-18 backlog sweep, on Shyden's decision ("Close the cosmetic ones only").

## User Story

As the operator with several stories in flight, I want `SHY-INDEX.md`
generated from the story files rather than edited by hand, so that two open
pull requests that each add a story never conflict in it.

## Why

Measured 2026-10-12: every PR that files or moves a story appends its row
at the end of the Active table, so any two such PRs conflict. It happened
three times that day (#2285 after #2272; #2222 twice), each costing a merge
and a full CI run, and #2285 had to be replaced to keep a docs PR at one
commit. SHY-0513 puts "the index generated entirely by CI" out of its
scope; SHY-0533 and SHY-0560 check rows, not generate them.

## Acceptance Criteria

### Happy path

- [ ] One command regenerates `SHY-INDEX.md` from every story file's
      frontmatter, in a stable order, with the legend and sections kept.
- [ ] CI fails a PR whose index differs from the regenerated one, naming the
      first differing row.

### Error paths

- [ ] A story file the generator cannot read fails the command by name.

### Edge cases

- [ ] Two branches that each add a story merge without an index conflict
      (rows not hand-placed, or a merge driver regenerates).

### Performance

- [ ] Not applicable.

### Security

- [ ] Not applicable.

### UX

- [ ] Not applicable.

### i18n

- [ ] Not applicable.

### Observability

- [ ] The command prints how many story files it read.

## BDD Scenarios

**Scenario: two PRs each file a story**

- **Given** two branches from the same develop, each adding a story file
- **When** the second merges after the first
- **Then** the index needs no hand resolution and lists both stories

## Test Plan

- Unit tests of the generator; a planted two-branch merge.

## Out of Scope

- Changing the story file format.

## Dependencies

- Relates to SHY-0513, SHY-0533, SHY-0560 (fold where they overlap).

## Risks & Mitigations

- **Losing the hand-curated row order.** The order rule is written into the
  generator and shown on today's index before the switch.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-12**: Filed after the third index conflict that day. Scored 5.
