---
id: SHY-0597
status: Draft
owner: unassigned
created: 2026-10-15
priority: P0
effort: M
estimate: 5
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0597: Two admin Users tests are red in the nightly on every browser

## User Story

As **Shyden, the operator**, I want an admin's date-of-birth edit to show
"Saved" and a searched user to show their own profile, on every browser, so
that the admin Users tab can be trusted and the nightly browser run can go
green.

## Why

Found 2026-10-15 while reading develop's runs. Shyden ruled it a real bug
(AskUserQuestion, 2026-10-15), not a known-broken test.

- `Playwright Nightly (all browsers)` has had no success since 2026-09-11
  (SHY-0551). Until 2026-10-12 it failed in set-up (`start-local-services`,
  then `Install dependencies`), so no test ran. On 2026-10-13
  (38371063072), 2026-10-14 (38524881531) and 2026-10-15 (38694041358) the
  tests ran and these failed:
- **Red, chromium and mobile-chrome, every one of the three nights:**
  `tests/web/admin-users-extra.spec.ts:58` "date of birth edit persists after
  reload". It fills `[data-field="dateOfBirth"]` with `2000-06-15T00:00`,
  blurs, and waits for `.field-feedback.saved` beside it:
  `expect(locator).toBeVisible() failed ... element(s) not found`, timeout
  5000 ms; 6.0 s and 5.9 s (retry) on 2026-10-15. Totals that night:
  chromium 1 failed, 37 skipped, 1410 passed; mobile-chrome 1 failed, 61
  skipped, 1386 passed. Firefox, webkit and mobile-safari pass it.
- **Flaky (red, then green on retry), firefox, webkit and mobile-safari,
  2026-10-15:** `tests/web/admin-users-profile.spec.ts:36` "search shows
  correct seeded user data". Firefox: `toHaveValue` on
  `[data-field="displayName"]` expected `"e2e-firefox-w1-u"`, received
  `"Suspended Account"`, timeout 15000 ms, 16.4 s. Each of the three jobs
  reports `1 flaky`; only `retries: 1` (SHY-0598) made them green.
- So all five browsers had a red admin Users test on 2026-10-15.
- `git log -S dateOfBirth` finds no change outside `.project/` since
  2026-09-15 (60 such commits in all history, so the search works). The
  cause is not yet known; SHY-0414 (what DOB an admin may change) is Draft,
  so nothing from it has shipped.

## Acceptance Criteria

### Happy path

- [ ] The cause of each failure is found and written in Notes, with the
      evidence (trace, network log or reproduction) that shows it.
- [ ] An admin who edits a user's date of birth sees "Saved", and the value
      survives a reload, on chromium, mobile-chrome, firefox, webkit and
      mobile-safari.
- [ ] Searching a seeded user shows that user's own display name on every
      browser, whatever an earlier test did to another account.

### Error paths

- [ ] If the save fails, the field shows the error feedback, never nothing:
      a test forces a failed save and asserts the error is visible.

### Edge cases

- [ ] If the cause is state leaking between tests (for example a suspension
      left on a shared account), each test owns its account or restores it,
      and a test proves the order no longer matters (run the two specs in
      both orders).

### Performance

- [ ] N/A: no new waits; no timeout is raised.

### Security

- [ ] N/A unless the cause lies in the admin write path; if it does, the
      fix keeps the endpoint's existing auth checks, with a test.

### UX

- [ ] The "Saved" feedback is visible (`toBeVisible()` plus `toHaveText()`)
      after a date-of-birth edit.

### i18n

- [ ] N/A: no new copy.

### Observability

- [ ] N/A: SHY-0551 covers the nightly's failure alert.

## BDD Scenarios

**Scenario: an admin edits a date of birth**

- **Given** an admin on a user's profile subtab
- **When** they set the date of birth and leave the field
- **Then** "Saved" shows beside it and the value is there after a reload

**Scenario: a search shows the searched user**

- **Given** an earlier test suspended a different account
- **When** the admin searches a seeded user
- **Then** that user's display name is shown

## Test Plan

1. Reproduce on the local stack in chromium (the laptop runs a single spec
   only for reproduction; the suites run in CI): run
   `admin-users-extra.spec.ts:58` and keep its trace.
2. Run `admin-users-profile.spec.ts` after the suspension specs, then alone,
   to show whether order matters.
3. RED first for whichever cause is found; fix; the nightly is the proof on
   all five browsers with no flaky line (after SHY-0598 removes retries).

## Out of Scope

- The nightly's failure alert (SHY-0551).
- Removing `retries: 1` (SHY-0598, which waits on this story).

## Dependencies

- None blocking.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The two failures have different causes | Each AC is per test; Notes records each cause separately. |
| A test is changed to pass instead of the product fixed | The story is a real bug by Shyden's ruling: change a test only where the cause is proven to be in the test, and say so in Notes. |

## Definition of Done

- [ ] A nightly with both tests green on all five browsers and `0 flaky`,
      quoted in Notes.
- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-15**: Filed from nightly runs 38371063072, 38524881531 and
  38694041358 on develop. Shyden ruled it a real bug.
