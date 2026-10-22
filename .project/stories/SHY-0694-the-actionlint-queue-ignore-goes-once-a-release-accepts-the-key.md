---
id: SHY-0694
status: Draft
owner: claude
created: 2026-10-22
priority: P3
effort: XS
estimate: 1
type: chore
roadmap_ids: []
mvp: false
epic: EPIC-0001
blocked_by: [SHY-0558]
---

# SHY-0694: the actionlint `queue` ignore goes once a release accepts the key

## User Story

As the operator, I want no lint ignore to outlive its reason, so that
actionlint checks every line of the sync workflow again as soon as it can.

## Why

SHY-0691 gave the story sync `concurrency.queue: max`. actionlint 1.7.7 (CI)
and 1.7.12 (latest, 2026-03-30) reject the key: support is
rhysd/actionlint#654, open and unreleased (measured 2026-10-22). So
`.github/actionlint.yaml` ignores `^unexpected key "queue" for "concurrency"
section` in `.github/workflows/sync-stories-to-issues.yml` only, pinned by
`express-api/tests/scripts/sync-stories-queue.test.js`. SHY-0691's spec asks
for a ticket to drop it.

## Acceptance Criteria

### Happy path

- [ ] Once an actionlint release accepts `queue`: CI's pinned actionlint
      (SHY-0558) moves to it, the ignore and its `paths:` entry are removed,
      and the scope test becomes a test that `actionlint.yaml` holds no
      ignore for that file.
- [ ] actionlint over every workflow is clean on that release with no
      ignore, measured in CI by step name.

### Error paths

- [ ] If the release reports anything else in the file, it is fixed in the
      same PR, never re-ignored.

### Edge cases

- [x] Not applicable.

### Performance

- [x] Not applicable.

### Security

- [x] Not applicable: removes an exemption.

### UX

- [x] Not applicable: CI only.

### i18n

- [x] Not applicable: no copy.

### Observability

- [x] Not applicable.

## Announce

None: CI only.

## BDD Scenarios

**Scenario: the release lands**

- **Given** an actionlint release that accepts `concurrency.queue`
- **When** CI's pin moves to it and the ignore is removed
- **Then** actionlint over every workflow is clean, and a planted bad
  `queue` value is reported

## Test Plan

- Remove the ignore with the new release: actionlint clean. Plant
  `queue: bogus` and watch the release go red on the value.

## Out of Scope

- Pinning the install itself (SHY-0558).

## Dependencies

- An actionlint release containing rhysd/actionlint#654 (outside wait;
  check its releases page).
- SHY-0558 (the pinned install the version bump goes through).

## Risks & Mitigations

- **Risk:** upstream never releases #654. **Mitigation:** the ignore stays
  scoped and pinned; this ticket is re-read at each actionlint bump.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-22**: filed by SHY-0691, whose spec asks for it. P3: the ignore
  is one message in one file and pinned by a test. Scored 1: a version bump
  and a two-line removal once upstream releases.
