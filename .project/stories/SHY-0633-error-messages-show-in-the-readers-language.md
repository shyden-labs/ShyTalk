---
id: SHY-0633
status: Draft
owner: claude
created: 2026-10-18
priority: P0
effort: L
estimate: 8
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0001
blocked_by: [SHY-0632]
---

# SHY-0633: Error messages in the app show in the reader's language

## User Story

As a learner using ShyTalk in my own language, I want every error the app
shows me (a failed edit, a failed recall, a failed send) in my language, so
that I understand what went wrong in an app built to teach languages.

## Why

Found on 2026-10-18 while planning SHY-0614, read at `bc77f9b`: the shared
view models set user-facing errors as hard-coded English strings, for
example `PrivateChatViewModel` `error = "Failed to edit message"` and
`error = "Failed to recall message"`. A search for the narrowest form,
`error = "` followed by a capital letter, finds 34 sites in
`shared/src/commonMain/.../feature`: 25 in `messaging/PrivateChatViewModel.kt`
and 9 in `room/RoomViewModel.kt`. Other forms (other field names, snackbar
text, lower-case starts) are not counted yet.

SHY-0390 (#1913) covers report reasons only.

## Acceptance Criteria

### Happy path

- [ ] First, every hard-coded user-facing string in the shared view models
      and screens is listed per site in Notes, found by a parser over the
      Kotlin source, not a text search alone.
- [ ] Each one becomes a string resource with an English source.
- [ ] Each is written in every shipped app locale and read back by Google
      Cloud Translation (SHY-0632) before commit, with the per-line table in
      the PR.

### Error paths

- [ ] A guard fails CI when a shared view model or screen sets a
      user-facing string literal, with a planted literal seen red.

### Edge cases

- [ ] Strings with placeholders keep them in every locale.
- [ ] A string that a test asserts by its English text is asserted by its
      resource instead.

### Performance

- [ ] Not applicable: string lookups only.

### Security

- [ ] Not applicable: no data path changes.

### UX

- [ ] Each error reads naturally in every locale, checked on a real Android
      phone and a real iPhone in two locales.

### i18n

- [ ] Every new string exists in every shipped locale, read back by Google.

### Observability

- [ ] Logs keep their English text (logs are for us, not the reader).

## BDD Scenarios

**Scenario: a failed edit in Indonesian**

- **Given** the app is set to Indonesian
- **When** editing a message fails
- **Then** the error shows in Indonesian

## Test Plan

- Unit tests of the view models assert the resource, not the English.
- The guard, with a planted literal.
- Journey: one failure path in two locales on both phones.

## Out of Scope

- Report reasons (SHY-0390).
- Server error strings (the apps do not show them today).

## Dependencies

- Blocked by SHY-0632: every new string needs its Google read-back.

## Risks & Mitigations

- The inventory misses a form: the guard is written over the parser's
  findings, so a form it misses is found by the planted mutation set.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; checked on both phones.

## Notes

- **2026-10-18**: Found planning SHY-0614. P0 by the standing rule that any
  defect is P0. MVP: launch users meet these errors. Scored 8: an
  inventory, at least 34 strings in every locale with read-back, a guard,
  view-model test updates and a journey; the same size as SHY-0614.
