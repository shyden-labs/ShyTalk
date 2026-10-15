---
id: SHY-0607
status: Draft
owner: unassigned
created: 2026-10-16
priority: P0
effort: S
estimate: 2
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0607: Two admin validation tests pass whatever happens

## User Story

As **Shyden, the operator**, I want the admin panel's validation tests to
fail when the panel shows no error, so that a broken error message is
caught before an admin meets it.

## Why

Found 2026-10-16 while working SHY-0597, reading
`tests/web/admin-validation.spec.ts`:

- **Test 1**, "empty display name triggers validation feedback or toast
  error": waits a fixed 2 s, then passes if either inline feedback or a
  toast exists (`expect(hasFeedback || hasToast).toBe(true)`). It never
  says which one the panel shows, so losing one of them goes unseen.
- **Test 5**, "non-URL value in profile photo field is accepted or rejected
  gracefully": waits a fixed 2 s, then passes on `wasSaved || wasError`.
  `wasError` looks for `.field-feedback.error`, a class the panel never
  renders (`showFieldFeedback` in `public/admin/js/tabs/users.js` renders
  `saving`, `saved` or `failed`). So the error branch can never be true:
  the test passes only when the save succeeds, and says nothing about a
  rejected URL. Its clean-up also ends on a fixed 2 s wait.
- Fixed waits are in the repo's no-test-sleeps baseline
  (`scripts/no-test-sleeps-baseline.json`), so removing them shrinks it.

## Acceptance Criteria

### Happy path

- [ ] Test 1 asserts the exact feedback the panel shows for an empty
      display name (inline `failed` feedback and the toast, each with
      `toBeVisible()` plus `toHaveText()`), and the name is unchanged.
- [ ] Test 5 asserts the one outcome the product defines for a non-URL
      photo value (saved, or refused with the `failed` feedback); if no
      rule is written, the rule is Shyden's to set first.

### Error paths

- [ ] Each test goes red when its feedback is removed from the panel (a
      mutant per test, recorded in Notes).

### Edge cases

- [ ] No assertion names a class the panel never renders.

### Performance

- [ ] The fixed 2 s waits are replaced by waits on the outcome; the
      no-test-sleeps baseline shrinks by the number removed.

### Security

- [ ] N/A.

### UX

- [ ] N/A: tests only.

### i18n

- [ ] N/A.

### Observability

- [ ] N/A.

## BDD Scenarios

**Scenario: an admin empties a display name**

- **Given** an admin on a user's profile subtab
- **When** they clear the display name and leave the field
- **Then** the field shows "✗ Save failed", the toast names the problem, and the name is unchanged

## Test Plan

1. Rewrite both tests; run them on chromium against the local stack.
2. Mutants: remove each feedback from the panel; each test goes red.
3. CI runs the spec on every browser.

## Out of Scope

- The date-of-birth auto-save fix (SHY-0597).

## Dependencies

- None blocking.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| No rule says whether a non-URL photo value is allowed | Ask Shyden before writing test 5's assertion. |

## Definition of Done

- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-16**: Filed from SHY-0597.
