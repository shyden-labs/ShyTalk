---
id: SHY-0545
status: In Progress
owner: claude
created: 2026-10-12
priority: P0
effort: M
estimate: 5
type: bug
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0545: The story sync reaches the renamed organisation, and says so when it cannot

## User Story

As the operator reading the ShyTalk Stories board and its progress figures,
I want every story merged to `develop` to reach the board, and a failed sync
to tell me, so that the board, the roadmap and the progress estimates are
true and a broken mirror cannot go unnoticed for days.

## Why

Measured 2026-10-12. The GitHub organisation was renamed `Shyden-Ltd` ->
`shyden-labs` on 2026-10-01. GitHub redirects a renamed repository's URLs,
but not an organisation login in GraphQL, nor org pages, nor `github.io`:

- `scripts/sync-stories-to-issues.sh:115` defaults `PROJECT_OWNER` to
  `Shyden-Ltd`, and the workflow sets no override. Every story sync on
  `develop` since the rename has failed with `Could not resolve to an
  Organization with the login of 'Shyden-Ltd'` and aborted before any
  mutation: **7 of 7** runs (2026-10-07 to 2026-10-12, latest 38194360036),
  after 23 successes before it. Stories filed since then did not reach the
  board through the mirror.
- Nobody was told: the workflow failed on `develop` for five days with no
  issue opened (the global rule "nothing we rely on stops silently").
- The public roadmap's footer links to `github.com/orgs/Shyden-Ltd/projects/1`:
  **404**. The gh-pages action prints report links at
  `shyden-ltd.github.io/ShyTalk/`: **404** (reports now live at
  `reports.shytalk.shyden.co.uk`). Repository URLs answer 301 to
  `shyden-labs` and still work.
- A case-insensitive search of tracked files outside the history folders
  (`.project/stories`, `.project/handoff`, `.project/audit`) finds 42 lines in
  24 files still naming the old organisation (scripts, the gh-pages action,
  roadmap page, data and app script, 8 backend test files, 2 web specs, 5
  READMEs, 1 plan). The roadmap data's three PR links come from the `pr:`
  fields of SHY-0038, SHY-0061 and SHY-0073 (all Done).
- The Allure workflow fetched `<owner>.github.io/...` with `curl -sf` and no
  `-L`; since the Pages site moved to its custom domain that answers 301, so
  the "report already generated" check could never match. The Pages setting
  reads `cname=reports.shytalk.shyden.co.uk https_enforced=false`, so the
  redirect lands on plain http.

## Acceptance Criteria

### Happy path

- [ ] The sync's default project owner is `shyden-labs`, in the code, its
      help text and the issue-body source link.
- [ ] Every live reference (23 of the 24 files above; the 2026-03 plan in
      `.project/plans` stays as history) names `shyden-labs`, the three Done
      stories' `pr:` fields feeding the roadmap data included, and the two
      404 links point at the board (200) or the reports host.
- [ ] Report links and the Allure "already generated" fetch name
      `https://reports.shytalk.shyden.co.uk/` directly, not the Pages
      address that redirects over plain http.
- [ ] After merge, the sync on `develop` succeeds, and the stories filed
      since 2026-10-07 are on the board (checked by number on the board).

### Error paths

- [ ] A failed story sync on `develop` opens an issue assigned to
      `ShydenMcM` (or comments on the open one), from a separate job with
      its own `issues: write` permission, so the alert does not depend on
      the token the sync uses.
- [ ] A planted failure (a dispatch with an owner that cannot resolve)
      proves the alert opens the issue.

### Edge cases

- [ ] A guard refuses the retired organisation name in every spelling
      (`Shyden-Ltd`, `shyden-ltd`, `SHYDEN-LTD`, in a URL, a GraphQL login and
      a `github.io` host) in every live file, while the history folders keep
      their record unchanged.
- [ ] The guard's verdict carries the number of files it read, checked for
      equality against a measured figure, and each scanned root contributes
      at least one file.

### Performance

- [ ] The guard reads only the live roots; its run time is recorded in the PR.

### Security

- [ ] The alert job's token has `issues: write` and `actions: read` (to name
      the failed step) only; the sync job's permissions are unchanged.
- [ ] Operator action: Pages "Enforce HTTPS" is switched on (repository
      setting; read back as `https_enforced=true`).

### UX

- [ ] The roadmap footer's "GitHub project" link opens the board (200).

### i18n

- [ ] The five translated READMEs change only the URL; no translated text
      changes, so no read-back is needed.

### Observability

- [ ] The alert issue names the failed run's URL, the commit, and the failed
      job and step by name (read from the run's jobs API).

## BDD Scenarios

**Scenario: A story merged to develop reaches the board**

- **Given** the sync's project owner is `shyden-labs`
- **When** a new story file lands on `develop`
- **Then** the sync run succeeds and the story's issue is on the board

**Scenario: The sync cannot reach the board**

- **Given** the sync fails on `develop`
- **When** the alert job runs
- **Then** an issue assigned to `ShydenMcM` names the run and its error

**Scenario: A copied snippet brings back the old name**

- **Given** a live file gains `github.com/Shyden-Ltd/...` in any case
- **When** the backend tests run
- **Then** the retired-name guard fails naming the file

## Test Plan

- New `express-api/tests/scripts/no-retired-org-name.test.js` in the
  `no-minio-image.test.js` idiom: walk, findings with the files-read count,
  per-root liveness, a hand-written form table, planted files going RED.
  The plants build the name at runtime so the guard file holds no literal.
- The existing sync tests that pin the owner move to `shyden-labs`.
- Mutations, each watched RED then restored: restore the old default owner;
  drop one root from the walk; make the match case-sensitive; drop the
  alert job's `if: failure()`.
- After merge: the `develop` sync run read by step name, and the board
  checked for SHY-0546 to SHY-0559.

## Out of Scope

- Rewriting history: stories, handoffs and audits keep the old name as
  written.
- Scheduled-workflow alerts in general (SHY-0551); this alert is the sync's
  own, built so SHY-0551 can fold it in.
- The guards suite (the 1-second stories); this guard sits with its
  precedent in `express-api/tests/scripts/` until that suite exists.

## Dependencies

- None.

## Risks & Mitigations

- **The PAT behind `GH_PAT_PROJECT` lost access in the rename.** Read the
  first post-merge run by step name; a 401/403 there is a new finding.
- **The guard's file count differs between the laptop and CI** (a disk walk
  counts untracked files). Roots hold tracked files only; the count is
  measured on a clean checkout and re-measured in CI's log.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; the post-merge sync green and the board checked.

## Notes

- **2026-10-12**: Found while checking the mirror after PR #2251. The number
  SHY-0545 was reserved for "the sync fix" on 2026-10-08 but the story never
  landed (no file on any branch or worktree, no issue). Scored 5 from
  measurement: 24 live files (42 lines, mostly mechanical), one new guard in
  an existing idiom, one alert job, one post-merge board check.
- **2026-10-12** (building): the guard's per-root liveness went RED on
  `.husky` first run: git hooks have no extension, so every file under it is
  now read, with husky's untracked `.husky/_` pruned by exact path. Walk
  1,976 = git's 1,974 tracked + the 2 new test files.
