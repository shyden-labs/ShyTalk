---
id: SHY-0688
status: Draft
owner: claude
created: 2026-10-22
priority: P0
effort: L
estimate: 8
type: chore
roadmap_ids: []
mvp: true
epic: EPIC-0016
blocked_by: [SHY-0687]
---

# SHY-0688: workflow jobs that never run on a pull request run on its commit

## User Story

As the operator, I want every workflow job a pull request changes to run on
that pull request's commit, the deploys as rehearsals and the hand-started or
scheduled workflows on a scratch ref, so that a changed line in one of them is
measured before it merges, not first in production.

## Why

Shyden, 2026-10-22, global ruling "What counts as code, skipped lines, and
workflow code". On workflow code that never runs on a pull request (a deploy
job on push only, or a hand-started or scheduled workflow), he chose "Run
them on the PR commit". The deploy job also runs on PRs as a rehearsal, and
hand-started workflows that a PR changes are started on its scratch ref, with
the gate reading those runs.

Measured 2026-10-22: 24 of ShyTalk's 29 workflows run by hand or on a
schedule. Deploy To Dev runs on pushes to develop only, and Deploy To Prod by
hand under the `production` environment.

## Acceptance Criteria

### Happy path

- [ ] A PR that changes a deploy workflow runs that deploy as a rehearsal on
      its own commit: every step that does not touch a live system runs for
      real (build, package, checks), and each step that would change one runs
      against a stand-in, named in the step log.
- [ ] A PR that changes a hand-started or scheduled workflow starts that
      workflow on a scratch ref of the PR's commit (`--ref`), in the mode it
      uses without side effects (dry run), and SHY-0687 reads its trace.
- [ ] The gate (SHY-0674) waits for those runs and judges their lines.

### Error paths

- [ ] A rehearsal or scratch run that fails, or never starts, fails the gate
      naming the workflow (fails closed).

### Edge cases

- [ ] A workflow with no side-effect-free mode gets one in this story, with a
      test that its rehearsal changes nothing live.

### Performance

- [ ] Each rehearsal's measured time is its limit.

### Security

- [ ] No rehearsal can reach production: no production credential is in any
      environment a PR run can use (planted: a rehearsal step asking for one
      is refused), and the `production` environment keeps its required
      reviewer.
- [ ] Scratch refs are deleted after their run, and no scratch run can push
      to `develop` or `main`.

### UX

- [x] Not applicable: developer tooling.

### i18n

- [x] Not applicable: no copy.

### Observability

- [ ] The PR lists each rehearsal and scratch run with its link and verdict.

## Announce

None: internal quality tooling with no change users can see.

## BDD Scenarios

**Scenario: a changed deploy line is measured before merge**

- **Given** a PR changes a step in the dev deploy
- **When** the PR's checks run
- **Then** the deploy runs as a rehearsal on the PR's commit and the changed
  line is reported run or unrun

## Test Plan

- A planted change to each kind of workflow (push-only deploy, hand-started,
  scheduled), each seen rehearsed and judged; a planted production-credential
  request, refused.
- The no-holes rule applies: before/after lists, coverage of the changed
  code, mutations of every new control.

## Out of Scope

- Measuring the lines themselves (SHY-0687).

## Dependencies

- SHY-0687

## Risks & Mitigations

- **A rehearsal touches a live system.** Stand-ins for every live-changing
  step, the production environment's reviewer kept, and the planted refusal
  in the Security AC.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-22**: filed from the global ruling. Scored 8: 24 hand-started or
  scheduled workflows and two deploys, each needing a side-effect-free mode
  and a rehearsal, with a security check that no production credential is
  reachable.
