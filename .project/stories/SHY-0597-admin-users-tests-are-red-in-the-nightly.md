---
id: SHY-0597
status: In Review
owner: claude
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

- [x] The cause of each failure is found and written in Notes, with the
      evidence (trace, network log or reproduction) that shows it.
- [ ] An admin who edits a user's date of birth sees "Saved", and the value
      survives a reload, on chromium, mobile-chrome, firefox, webkit and
      mobile-safari.
- [ ] Searching a seeded user shows that user's own display name on every
      browser, whatever an earlier test did to another account.

### Error paths

- [x] If the save fails, the field shows the error feedback, never nothing:
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

- [x] The "Saved" feedback is visible (`toBeVisible()` plus `toHaveText()`)
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
- **2026-10-16, the two failures have different causes.** Evidence: the
  2026-10-15 nightly's chromium failure traces and Allure results (run
  38694041358, artifacts `playwright-failures-chromium`,
  `allure-results-playwright-chromium`). Every chromium test ran on one
  worker, so every admin spec shared user 100000005.
- **Cause 1, "Suspended Account" (a product bug).** No suspend path checked
  for a user already suspended. A second suspension saved the mask
  "Suspended Account" as the real name, so unsuspend restored the mask for
  good. The order on 2026-10-15: `admin-appeals.spec.ts` beforeAll suspends
  (real name saved); test 3 approves (restored); test 4 suspends again (real
  name saved); test 5 denies (stays suspended); test 6's `reseedAppeal`
  suspends the suspended user (mask saved); afterAll unsuspends (mask
  restored). From 06:56:09 every read of the user returns
  `isSuspended: false`, `displayName: "Suspended Account"`,
  `preSuspensionDisplayName: null`. Chromium hid it because the DOB failure
  restarted the worker with a fresh user before `admin-users-profile.spec.ts`
  ran (07:03:45); firefox, webkit and mobile-safari did not restart there,
  so they read the mask. The cause is in the product, not the test.
- **Fix for cause 1 (Shyden ruled 2026-10-16: a second suspension updates
  the suspension and keeps the real name).** One helper,
  `suspensionStartedProfileFields` in `express-api/src/utils/suspension.js`,
  now writes the save-and-mask fields at all four masking sites
  (`admin-users.js` suspend; `reports.js` resolve, bulk resolve, admin
  suspend). 10 unit tests on the helper; one route test per site. RED
  proof: with the old route files restored, exactly the 4 new route tests
  fail (4 failed, 198 passed); 3 mutants of the helper's rules each killed.
- **Filed from cause 1:** SHY-0604 (P0, live accounts already hit; Shyden
  ruled a ticket), SHY-0605 (bio and avatar wiped for good), SHY-0606
  (identity-graph suspend/unsuspend skip the lifecycle and never restore the
  profile).
- **Cause 2, DOB "Saved" missing on chromium and mobile-chrome (in the
  test).** Not leaked state: the retry ran on a fresh user (100000007, DOB
  `null`) and failed the same way, with no PATCH and no feedback.
  Reproduced 2026-10-16 on the local stack (Playwright 1.64.0, Chromium
  156.0.8078.4), `admin-users-extra.spec.ts:58`, first run. A probe on the
  real admin page showed that after `fill()` the input has focus, and the
  test's `el.blur()` leaves it focused (`:focus` still true) with no `blur`
  or `focusout` event, so the panel's blur listener never runs. A bare page
  isolates it: `blur()` on a focused `datetime-local` fires with
  `hasTouch: false` and does nothing with `hasTouch: true`. The chromium
  project sets `hasTouch`, and mobile-chrome is a Pixel 5 (touch); firefox,
  webkit and mobile-safari are other engines. Leaving the field as a person
  does (tap, click elsewhere, Tab) fires `blur` every time, and on the admin
  page that saves and shows "✓ Saved". Real admins are not affected; the
  earlier "minimal page fires blur" result was without touch.
- **Fix for cause 2 (Shyden ruled 2026-10-16: the test leaves the field like
  a user, one shared helper).** `tests/web/helpers/admin-autosave.ts`
  leaves a field by clicking its group heading and asserts it lost focus;
  the three copied local helpers and the remaining direct `blur()` calls
  (admin-users-extra, admin-users-profile, admin-users-economy,
  admin-validation) use it, each keeping its existing wait. "Saved" is
  checked with `toBeVisible()` plus `toHaveText('✓ Saved')`. New test:
  a date-of-birth save the server refuses (the test's own user deleted
  mid-edit, no stub: `page.route` debt may only shrink) shows
  "✗ Save failed". Mutants, each killed on chromium: `blur()` back in the
  helper (DOB test red, the nightly's failure); the panel's failed feedback
  removed; the user not deleted; the helper clicking the field itself
  (`not.toBeFocused` red); the panel's tick text changed to "✓ Save"
  (`toHaveText` red).
- **Seen in passing:** `admin-validation.spec.ts` tests 1 and 5 pass on
  either of two outcomes after a fixed 2 s pause, and test 5 looks for
  `.field-feedback.error`, a class the panel never renders (it renders
  `failed`), so its error branch can never be true. Filed as SHY-0607.
- **Also seen:** the pre-push express-api run (no emulators, laptop) failed
  1,008 tests in 63 suites on emulator reachability alone, re-run three
  times each by `jest.retryTimes`; both already ticketed (SHY-0546,
  SHY-0547).
