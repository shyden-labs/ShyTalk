---
id: SHY-0638
status: Draft
owner: claude
created: 2026-10-18
priority: P0
effort: S
estimate: 2
type: bug
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0638: The real ffmpeg recorder tests run in CI and never skip

## User Story

As a developer trusting a green backend run, I want the four tests that drive
a real ffmpeg to run in CI every time, so that a green result means the
journey recorder's frame wait was actually checked.

## Why

Found on 2026-10-18 reading the totals of #2420 and #2426 (Test Backend:
`4 skipped`, both runs). `express-api/tests/scripts/drivers/journey-screen-recorder.test.js`
line 365: `const itFfmpeg = haveFfmpeg ? test : test.skip;`, where `haveFfmpeg`
is `fs.existsSync('/opt/homebrew/bin/ffmpeg')`, a macOS Homebrew path. Test
Backend runs on `ubuntu-24.04` and DOES install ffmpeg
(`.github/actions/install-ffmpeg`, apt, `test-backend.yml:106`), but into
`/usr/bin`, which the check never looks at; so the four `waitForFfmpegFrames`
tests (lines 412, 424, 439, 454) have never run in CI, the install is wasted
for them, and the suite reports green.
On the laptop they start a real ffmpeg inside the unit suite, which the unit
rules forbid (SHY-0574 moves process-starting tests; it does not cover a test
that skips itself).

## Acceptance Criteria

### Happy path

- [ ] The four real-ffmpeg tests move to a non-unit suite with its own CI step
      and one measured limit, where ffmpeg is installed (pinned) and found on
      `PATH`, not at a fixed path.
- [ ] The unit suite keeps a stand-in for `waitForFfmpegFrames`'s logic with
      the process stood in (no process started).

### Error paths

- [ ] When ffmpeg is missing, the new suite fails at once naming the binary
      and the install command; nothing in it can skip.

### Edge cases

- [ ] Test Backend's totals show 0 skipped after the move, read from the CI
      log.

### Performance

- [ ] The new step's duration is measured on its first run and becomes its
      limit.

### Security

- [ ] Not applicable: test tooling.

### UX

- [ ] Not applicable: no app changes.

### i18n

- [ ] Not applicable: no user-facing text.

### Observability

- [ ] A guard refuses an environment-conditional skip (`? test : test.skip`,
      `describe.skip` behind a condition, `skipIf`) anywhere under
      `express-api/tests`, floored at the files it read, red on a planted one.

## Announce

Nothing: test tooling with no learner-facing change.

## BDD Scenarios

**Scenario: the frame wait is checked on every run**

- **Given** a pull request's CI
- **When** the new suite runs on Linux
- **Then** all four real-ffmpeg tests run and pass, and the totals show none
  skipped

**Scenario: a missing ffmpeg is a failure, not a skip**

- **Given** a runner without ffmpeg
- **When** the suite starts
- **Then** it fails naming ffmpeg and how to install it

## Test Plan

- The new suite's first CI run, read by step name with its totals.
- The guard and its planted mutant, locally.

## Out of Scope

- The other process-starting unit tests (SHY-0574).

## Dependencies

- None. SHY-0574 can take this suite as its first home if it lands first.

## Risks & Mitigations

- The tests may be red once they run (they were never run on Linux): each red
  is a defect, filed with its error text and duration.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name with 0 skipped;
      merged to `develop`.

## Notes

- **2026-10-18**: Filed while merging #2426. P0 by the standing rule that a
  check is green only if it ran; not MVP (test tooling). Scored 2: four tests,
  one CI step, one guard; smaller than SHY-0636 (3, eight loops plus a guard).
