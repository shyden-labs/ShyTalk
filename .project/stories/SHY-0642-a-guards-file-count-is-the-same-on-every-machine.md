---
id: SHY-0642
status: Draft
owner: claude
created: 2026-10-19
priority: P0
effort: S
estimate: 3
type: bug
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0642: A guard's file count is the same on every machine

## User Story

As the operator, I want every whole-repo guard with a files-read floor to count
the same files on my Mac as in CI, so that a local run tells the truth before a
push and never fails (or passes) only because of files git ignores.

## Why

Found on 2026-10-18 while fixing SHY-0614 PR 2 (#2437): the three guards with a
`FILES_READ_FLOOR` (`no-retired-org-name`, `no-minio-image`,
`suspension-ends-in-one-place`) walk the disk with `readdirSync`. Git-ignored
files under their roots are counted locally but do not exist in CI:

- In a worktree with a copied `app/src/dev/google-services.json`,
  `no-retired-org-name` read 2035 where CI read 2034 (counted from git at the
  same commit).
- In the main checkout, measured at `232fce2770b`, 44 git-ignored files sit
  under that guard's roots with a counted extension (the two
  `google-services.json`, `.claude/settings.local.json`, five `.claude/agents`
  files, `express-api/migration-snapshots/*.json`, ...), so a local run there
  reads about 2078 against CI's 2034.

The guard's own comment says untracked notes "must not move the count between
machines"; ignored files still do. The push check built the same day
(`~/.claude/hooks/shytalk-floors-before-push.py`) runs these guards locally, so
they must agree with CI.

## Acceptance Criteria

### Happy path

- [x] Each of the three guards counts only files git tracks or would track:
      a git-ignored file under any root is never read or counted. Proof: each
      guard keeps a walked file only when `gitVisibleFiles` (one helper,
      `express-api/tests/helpers/git-visible-files.js`, asking
      `git ls-files --cached --others --exclude-standard`) lists it; a real
      ignored `app/src/dev/google-services.json` copied into a worktree left
      `no-retired-org-name` at 2037 (the old walk read 2038).
- [ ] Run in the main checkout (44 ignored files today), each guard reads the
      same count as CI at the same commit.

### Error paths

- [x] If the guard cannot tell which files are ignored, it fails naming why;
      it never falls back to counting the disk. Proof: a root outside any
      repository throws `git ls-files failed in <folder>: ... not a git
      repository` in each guard's tests; a missing folder throws `no such
      folder`; mutating the throw into an empty answer turns 4 tests red.

### Edge cases

- [x] An untracked file that is NOT ignored is still counted (a new file not
      yet added must move the count, as today). Proof: each guard's
      "untracked file that is not ignored is read and counted" case; dropping
      `--others` turns 24 tests red.

### Performance

- [x] Each guard file is no more than 0.15 s slower than before (Shyden,
      2026-10-19, replacing "+10%", which no git call can meet: starting git
      costs about 6 ms, most of the MinIO guard's 10%). Proof: medians of 5
      runs, old against new on one machine: no-minio-image 79 -> 138 ms,
      no-retired-org-name 219 -> 324 ms, suspension-ends-in-one-place
      363 -> 453 ms. Jest prints no per-file time in CI, so CI's check is the
      Test Backend job's time on the PR against develop's.

### Security

- [x] Not applicable: test tooling only.

### UX

- [x] Not applicable: no screen changes.

### i18n

- [x] Not applicable: no user-facing text.

### Observability

- [x] A planted git-ignored file under each guard's roots leaves its count
      unchanged, and a planted untracked, not-ignored file moves it by one:
      both seen in the guard's own tests. Proof: the "SHY-0642 — git decides
      what is read" block in each guard; removing each guard's git filter
      turns its ignored case red (mutations 7-9).

## Announce

Nothing: operator tooling with no learner-facing change.

## BDD Scenarios

**Scenario: an ignored config file does not move the count**

- **Given** `app/src/dev/google-services.json` exists and is git-ignored
- **When** `no-retired-org-name` runs
- **Then** it reads the same count as CI at that commit

## Test Plan

- Guard tests in `express-api/tests/scripts`, each with a planted ignored file
  and a planted untracked file (mutation-verified).
- One run of `zsh ~/.claude/scripts/shytalk-floors.zsh` in the main checkout.

## Out of Scope

- Moving the floors into one recorded file (SHY-0556).
- Moving whole-repo guards to their own suite (SHY-0563).

## Dependencies

- None.

## Risks & Mitigations

- Reading the ignore rules wrongly hides a real file: the untracked,
  not-ignored plant proves new files still count.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-19**: Filed while fixing SHY-0614 PR 2. P0 by the standing rule
  (a defect: local guard runs disagree with CI, so the push check built that
  day cannot be trusted in the main checkout); not MVP (tooling). Scored 3:
  one shared change to how three guards list files, two plants each and their
  tests.
