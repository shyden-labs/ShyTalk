---
id: SHY-0706
status: Draft
owner: claude
created: 2026-10-23
priority: P2
effort: M
estimate: 5
type: chore
roadmap_ids: []
mvp: false
blocked_by: []
---

# SHY-0706: Every release cut after the first can merge into main

## User Story

As the operator, I want each frozen `release/*` cut to merge into `main`
without first being brought up to date with `main`, so that the second
release, and every one after it, ships exactly the tree that was tested
on `develop`.

## Why

Pull requests into `develop` squash (SHY-0664); the release cut lands on
`main` as a merge commit, which `develop` never holds. `main` requires a
branch to be up to date before it merges (strict). So once one release has
landed, every later cut lacks that merge commit, reads as out of date, and
can only merge after `main` is merged into the frozen cut: a commit the
cut was never tested with.

Measured 2026-10-23 (read with the ShyTalk App's token):
`GET /repos/shyden-labs/ShyTalk/rules/branches/main` gives
`required_status_checks` with
`strict_required_status_checks_policy: true`, from ruleset `main-branch` (24965924, `refs/heads/main`). Ruleset
`main` (12613584) targets `~DEFAULT_BRANCH`, which is `develop`, and is
strict too, as is ruleset `develop` (19719048). Classic protection on
`main` cannot be read by the App (403).
`git rev-list --count origin/develop..origin/main` is 0: every commit on
`main` is on `develop`, so no release cut has landed as a merge commit
yet. The first cut is not blocked; the second would be.

Raised by repo-template#86 (2026-10-23) for every project. The fix below
is Shyden's as relayed by the shyden.co.uk session, not yet confirmed by
him in this project: confirm before building.

## Acceptance Criteria

### Happy path

- [ ] Shyden confirms the fix for ShyTalk: `main` drops strict, `develop`
      keeps it, and a required `release-cut` check guards `main`.
- [ ] A `release-cut` job runs on every pull request into `main` and fails
      unless: (a) the head branch is `release/*`; (b) the head commit is an
      ancestor of `origin/develop`; (c) the merge ref's tree equals the
      head commit's tree; (d) every commit in `origin/develop..origin/main`
      is a two-parent merge whose second parent is on `develop`.
- [ ] Ruleset `main-branch` reads
      `strict_required_status_checks_policy: false` and lists
      `release-cut` in its required checks; read back from the API after
      Shyden's click.
- [ ] `develop`'s effective rules still read strict `true`.

### Error paths

- [ ] Each of (a) to (d) planted red against a fixture repository: a head
      not named `release/*`; a head with a commit not on `develop`; a
      merge ref whose tree differs; a single-parent commit on `main`
      outside `develop`. Each failure names the check and the commit.
- [ ] A git read that fails (shallow clone, missing ref) fails the job
      naming the ref; it never passes on an empty range.

### Edge cases

- [ ] The first cut (`develop..main` empty) passes (d) with the range
      printed as empty and its count as 0.
- [ ] A hotfix path, if one exists by then, is decided with Shyden, not
      carved out silently.

### Performance

- [x] Not applicable: a handful of git reads on one job.

### Security

- [ ] No App gains `administration: write`; the ruleset change is
      Shyden's click; the job uses the read-only job token.

### UX

- [x] Not applicable: no user surface.

### i18n

- [x] Not applicable: no copy.

### Observability

- [ ] The job summary prints each check's verdict, the head, the range
      and its commit count.

### Runtime proof

- [ ] The second release cut after this lands merges into `main` with
      `release-cut` green by step name and no update commit on the cut.

## Announce

Not announced: an internal workflow change.

## BDD Scenarios

**Scenario: the second release cut merges as it was tested**

- **Given** one release has landed on `main` as a merge commit
- **And** a new `release/*` cut is taken from `develop`
- **When** its pull request into `main` is opened
- **Then** `release-cut` passes and the pull request can merge without
  updating the cut

**Scenario: a branch that is not a release cut is refused**

- **Given** a pull request into `main` from a feature branch
- **When** CI runs
- **Then** `release-cut` fails naming check (a)

## Test Plan

- Workflow test pinning the job, its trigger and its four checks.
- Each check planted red against a scratch fixture repository in CI.

## Out of Scope

- Other repos and repo-template: their own sessions (repo-template#86).
- The merge methods: SHY-0664.

## Dependencies

- Shyden's confirmation of the fix, then his ruleset click.
- Related, not blocking: SHY-0664 makes the merge methods a setting;
  pull requests already squash by habit, so this job can be built first.

## Risks & Mitigations

- Dropping strict on `main` alone lets a stale branch merge: checks (a) to
  (c) refuse any head that is not exactly a tested `develop` tree.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged.

## Notes

- 2026-10-23: estimate 5 against SHY-0664 (3: two API reads and one
  step); this job adds four git checks, each with a planted-red fixture.
  The rulesets were read by id and the branch's effective rules by
  `rules/branches/main`; the strict flag came back the same both ways.
