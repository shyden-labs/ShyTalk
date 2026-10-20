---
id: SHY-0658
status: Draft
owner: claude
created: 2026-10-20
priority: P0
effort: L
estimate: 8
type: chore
roadmap_ids: []
mvp: true
epic: EPIC-0003
---

# SHY-0658: Every phone test runs on the two linked phones, unlinking a phone only when a test needs someone else

## User Story

As the operator, I want every phone test written for the phones we have,
so that each test can actually run on a real Android phone and a real
iPhone before a release.

## Why

Found on the 2026-10-20 dev phone walk (SHY-0647). ShyTalk links a device
to one account: after Alice signed in on the Android phone, Selma was
refused with "Account Restricted: This device is already linked to another
account" (`device_locked_description`). The Android OnePlus is now linked
to Alice (P-02, 50000010) and the iPhone Air to Theo (P-10, 50000060).

Every phone test was written assuming any persona can sign in on any
phone. Measured on `develop` the same day: all 39 journey files in
`journey-tests/` name personas other than Alice and Theo, and 9 open
stories have phone steps that do (SHY-0101, SHY-0241, SHY-0654, SHY-0653,
SHY-0647, SHY-0645, SHY-0636, SHY-0614, SHY-0401), plus the SHY-0656 draft.
Many need someone two adults cannot play: an under-18 (Marcus, Mia), an
adult and a minor side by side, a harasser and a victim.

An admin can unlink a device on dev: `DELETE /api/admin/devices/:deviceId`
(`express-api/src/routes/admin-devices.js:212`), which writes an
`UNBIND_DEVICE` admin audit entry.

Shyden, 2026-10-20, from written options: **"Alice/Theo first, unlink when
needed"**, over Alice/Theo only (minor journeys would never run on a real
phone) and over exempting seeded personas on dev (tests would stop
exercising the device-link rule).

## Acceptance Criteria

### Happy path

- [ ] Every phone step in every journey file and every open story uses
      Alice on the Android phone and Theo on the iPhone, wherever the test
      allows it.
- [ ] A test that needs another persona on a phone starts with a written
      step: "unlink this phone as Greta (P-12), then sign in as X", and
      ends by unlinking and signing the phone's own persona back in.
- [ ] The device journey runner performs that step itself (admin unlink
      through the API, then the persona sign-in) and records it in the
      report.

### Error paths

- [ ] An unlink that fails stops the test, naming the phone and the
      refusal; it never carries on as the wrong persona.
- [ ] A phone found linked to a persona the test did not expect stops the
      test before its first step, naming both.

### Edge cases

- [ ] A third participant who needs no phone (Selma in a group, say) takes
      part through the database as that persona, read and written over
      Firestore REST with the persona's own sign-in, never as Shyden.
- [ ] Off-phone personas (Greta in the admin panel) are unchanged.

### Performance

- [ ] Each unlink-and-swap is timed in the runner report; a journey's
      measured time is its limit.

### Security

- [ ] The unlink step runs only against dev (the runner refuses any other
      target), and every swap leaves its `UNBIND_DEVICE` audit entry.
- [ ] The device-link rule itself is unchanged and still exercised (a
      journey step proves a second persona is refused on a linked phone).

### UX

- [x] Not applicable: tests only.

### i18n

- [x] Not applicable: no copy.

### Observability

- [ ] The runner report names, per phone, which persona held it at each
      step.

## Announce

None: internal test work with no change users can see.

## BDD Scenarios

**Scenario: a minor journey on the iPhone**

- **Given** the iPhone is linked to Theo
- **When** j02 needs Marcus on the iPhone
- **Then** the runner unlinks the iPhone as Greta, signs Marcus in, runs
  the journey, then unlinks it and signs Theo back in

**Scenario: a second persona is still refused**

- **Given** the Android phone is linked to Alice
- **When** Selma tries to sign in on it without an unlink
- **Then** she is refused with the device-link message

## Test Plan

- Runner unit tests of the swap step (stand-in API), one per case above.
- One dev run of a journey that swaps on each phone, report read by step.
- A sweep test listing every phone step's persona per journey file, so a
  new journey that picks another persona without the swap step fails.

## Out of Scope

- Changing the device-link rule.
- More test phones.

## Dependencies

- None to start. SHY-0653 and SHY-0656's walks are rewritten in their own
  stories (Alice mutes Theo) and do not wait on this.

## Risks & Mitigations

- Audit-log noise on dev from swaps: each entry names the runner, and
  swaps happen only when a test needs them.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; one swapping journey green on both phones on dev.

## Notes

- **2026-10-20**: Filed from the SHY-0647 dev phone walk. P0: every phone
  test before release depends on it. MVP: the release's device sign-off
  needs runnable phone tests. Scored 8: 39 journey files and 10 stories to
  rewrite, a runner swap step with its failure paths, and a sweep test;
  above SHY-0656's 5 (one screen) and SHY-0654's 8 is comparable in size.
