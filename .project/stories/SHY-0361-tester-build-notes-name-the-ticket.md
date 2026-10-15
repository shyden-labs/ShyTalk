---
id: SHY-0361
status: In Review
owner: claude
created: 2026-08-20
priority: P1
effort: S
estimate: 3
type: infra
roadmap_ids: []
mvp: false
---

# SHY-0361: Tester build notes do not say what changed

## User Story

As **a tester picking up a new ShyTalk build**, I want the build notes to tell me
which ticket the build contains, so that I know what to test without asking
anyone or reading the commit history.

## Why

**Operator, 2026-08-20:** *"in the app tester app build notes, it should have the
information about the last ticket, even if it's a deploy from develop (but still
says it's a deploy from develop)."*

Today `deploy-dev.yml:556` builds the Firebase App Distribution notes as:

```
releaseNotes: ${{ inputs.release-notes != '' && inputs.release-notes
  || format('Dev build from {0} ({1})', ref, sha) }}
```

So the default note is literally **`Dev build from develop (432626879b7)`**. It
gets the provenance half right — it does say it is a deploy from `develop` — and
carries **no ticket information at all**. A tester receives a build and a commit
hash, and has no way to know what to look at.

The `release-notes` input exists, so a human who remembers can pass good notes by
hand. That is the defect: it depends on remembering. This story makes the default
carry the ticket.

## Acceptance Criteria

### Happy path

- [ ] A dev build's notes name the most recent ticket: its id, its title, and a
      one-line summary of what changed.
- [ ] The notes **still state** that the build is a deploy from `develop`.
- [ ] This happens with no `release-notes` input supplied.

### Error paths

- [ ] If the last ticket cannot be determined, the notes say so plainly and still
      give branch and sha — never a blank or misleading note.
- [ ] A malformed story file does not fail the deploy; the notes degrade.

### Edge cases

- [ ] A deploy carrying **several** merged tickets lists them, newest first,
      rather than naming only one and implying it is the whole build.
- [ ] A deploy with no ticket-bearing commits (a config-only deploy) says that,
      rather than naming a stale earlier ticket.
- [ ] **Every** ticket named by any commit since the last dev build is listed in
      both apps' notes, whatever it touched, each with its story title, what
      changed (the merge's summary) and what to test (the story's BDD scenario
      titles) (Shyden, 2026-10-14).
- [ ] A ticket whose story is still Draft is listed as filed, with nothing to
      test.
- [ ] A ticket named only by commits that touch story paperwork (`.project/`)
      is listed as updated with nothing new to test, and "what changed" always
      comes from the newest commit that changed code.
- [ ] The first line names the newest ticket with something to test (named by a
      code commit, story not Draft); with none it says nothing is new for that
      app, or counts that app's other changes.
- [ ] An explicit `release-notes` input still wins — the hand-written path is not
      removed.
- [ ] Notes stay within Firebase App Distribution's length limit; long titles are
      truncated with the id intact, since the id is the useful half.

### Performance

- [ ] Note generation adds no meaningful time to a deploy.

### Security

- [ ] Nothing internal leaks to testers — no PR-internal links, no file paths, no
      personal data.

### UX

- [ ] Read on a real device in the tester app, the note answers "what do I test?"
      in its first line. Verified by looking at it, not by asserting the string.
- [ ] The same treatment applies to the iOS TestFlight "what to test" text, so a
      tester gets the same information on both platforms.

### i18n

- [ ] N/A — tester-facing English, consistent with existing tester tooling.

### Observability

- [ ] The generated note is echoed in the deploy log, so a failed distribution
      can still be diagnosed from the run.

## BDD Scenarios

**Scenario: A tester can see what a new build contains**

- **Given** a new build has been shared with testers
- **When** the tester reads the build notes
- **Then** they see which ticket it contains and where it was built from

**Scenario: A build with nothing to report still explains itself**

- **Given** a build contains no ticket changes
- **When** the tester reads the build notes
- **Then** the notes say so rather than naming an unrelated ticket

**Scenario: A tester sees every ticket since the last build and what to test in each**

- **Given** several tickets were merged since the last dev build
- **When** the tester reads the build notes
- **Then** each ticket is listed, newest first, with its title, what changed and what to test

**Scenario: A story only marked done is not presented as new work**

- **Given** a ticket's only change in this build is its story being updated
- **When** the tester reads the build notes
- **Then** that ticket says there is nothing new to test, and the first line names a ticket that has something to test

## Test Plan

**RED first.** Today's default note contains no ticket id — a test asserting one
fails against the current workflow.

1. A workflow test on the notes expression: ticket present, ticket absent,
   multiple tickets, explicit input overrides.
2. A truncation test at the length limit that keeps the id.
3. A real dev deploy, read on a real device in the tester app and on TestFlight.

## Out of Scope

- Changing what is deployed, or when.
- Release notes for **production** store listings — different audience, different
  review path.
- Localising tester notes.

## Dependencies

- `.github/workflows/deploy-dev.yml` (Android App Distribution + iOS TestFlight
  legs).
- Benefits from SHY-0360's story/board plumbing but does not require it.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Notes generation breaks a deploy | A gap we can explain (no baseline, a ticket with no story file) gives a plain note and passes. A real fault (a bug in the note code, App Store Connect refusing the text, the build not listed within 15 min) fails that app's job red, naming the cause: Shyden, 2026-10-14, superseding "the deploy never fails on notes". |
| Internal detail leaks to testers | Notes are built from story title + summary only, never PR bodies or paths; asserted in test. |
| A stale ticket is named on a config-only deploy | The no-ticket case is an explicit tested branch. |

## Definition of Done

- [ ] Default dev-build notes name the ticket **and** the source branch, on both
      Android and iOS.
- [ ] Story `In Review` before merge.
- [ ] CI green by name; merged to develop; dev deploy dispatched and the note
      read on a real device.
- [ ] `released_in:` set on the next release cut.

## Notes (running log)

- **2026-08-20** — Filed from the operator's instruction. Confirmed against
  `deploy-dev.yml:556`: the default note is `Dev build from {ref} ({sha})` with
  no ticket. As an interim measure the SHY-0358 dev deploy (run 32289832760) was
  dispatched with hand-written notes naming the ticket, proving the shape the
  default should produce.
- **2026-10-14**: Raised to P1 and started, ahead of SHY-0556. Shyden ruled
  that a merge into `develop` deploys to dev on its own (SHY-0534), and chose
  "Now, both": this story first, since every automatic build would otherwise
  reach testers with no ticket in its notes. Two answers the same day
  (AskUserQuestion):
  - A real notes fault fails the app's deploy job red (see Risks); an
    explicable gap still gives a plain note.
  - The TestFlight build lookup checks every 30 s and fails at 15 min.
- **Design.** `list-build-changes` (its own job, so a fault cannot flip the
  fail-safe scope job) lists each first-parent commit since the scope job's
  baseline with the areas `scripts/deploy-scope.sh` says it touches.
  `scripts/tester-notes.js` builds each app's note from the commits touching
  the backend or that app, so a docs commit that files a ticket is never "what
  to test". `scripts/set-testflight-whats-new.js` writes the iOS note to
  "What to Test"; the App Store Connect client moved to
  `scripts/app-store-connect.js`, shared with
  `ensure-testflight-auto-distribution.js`.
- **Assumed, not documented:** neither Firebase App Distribution nor
  TestFlight publishes a tester-note length limit (searched 2026-10-14). Notes
  are capped at 4000, App Store's documented limit for its own "What's New".
- **Not classified as a deploy area:** the four new scripts change only what
  testers read, so `deploy-scope.sh` does not list them; their first real run
  is this story's own dev deploy (DoD).
- **2026-10-14, after the first real build (PR #2328, run 38507535828 on
  `661f0ae5722`, succeeded).** Android note: "What to test: no ticket in this
  build; 2 other changes below" (ktor, livekit). iOS note: "What to test:
  SHY-0361 Tester build notes do not say what changed". Both ended "Deploy from
  develop at 661f0ae5722, started by hand." TestFlight: "What to Test created
  on build 288 (0.99.0)", the build listed on the first look (0 waits). Shyden:
  *"it needs to name ALL tickets since the last build. not just the ticket name
  but it must include the summary name and what to test"*. This supersedes the
  design note above: every ticket is listed in both apps' notes, whatever it
  touched. A real-data check of that deploy's commits then showed a second
  defect: tickets named only by a docs merge got "What changed: Done; SHY-0535
  DoD ticked to release". `list-build-changes` now marks a commit touching only
  `.project/` as `docs`; such a ticket says "Story updated only in this build:
  nothing new to test", and the first line names the newest ticket with
  something to test (added 2026-10-15). Mutation-verified: 9 mutants, each run
  against both whole test files, all red.
