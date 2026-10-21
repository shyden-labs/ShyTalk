---
id: SHY-0685
status: Draft
owner: claude
created: 2026-10-21
priority: P1
effort: M
estimate: 5
type: chore
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0685: ShyTalk runs the same tool and package versions as every other project

## User Story

As the operator, I want ShyTalk on the same version of every runner image,
tool and package it shares with my other projects, and on one version of each
inside ShyTalk itself, so that every project behaves the same way and none
falls behind on fixes.

## Why

Shyden, 2026-10-21, global rule: *"of course we should be running on the same
node as everywhere else. consistency. find the project running the latest and
tell all the other projects to make the upgrade to this version. do this for
other packages and languages and tools too."* The target for each item is the
newest version any project runs.

Measured 2026-10-21 by the census (skill `aligning-versions-across-projects`,
every project's default branch on GitHub). ShyTalk is behind on:

- runner `ubuntu-22.04` / `ubuntu-24.04` / `ubuntu-latest` -> `ubuntu-26.04`
  (newest in shyden.co.uk);
- eslint 10.9.1 -> 10.13.0 and prettier 3.9.6 -> 3.9.10 (steadyhand);
- globals 17.12.0 -> 17.13.0 (yawelo-idle).

Inside ShyTalk, one item has two versions:

- `sharp` is 0.35.4 in one lockfile and 0.35.5 in the other.
- `firebase-tools` is 15.15.0 in `start-firebase-emulators/action.yml:31`
  and 15.24.0 in `deploy-dev.yml:281` and `deploy-prod.yml:281`.

Pins that name no version:

- `npm install -g wrangler` in both deploy workflows;
- `macos-latest` and `ubuntu-latest` runners;
- `actions/setup-node`, `upload-artifact` and `download-artifact`, whose
  comments say only `v7` / `v8`.

Node itself is SHY-0566 (the repo) and SHY-0675 (the servers).

## Acceptance Criteria

### Happy path

- [ ] Every item above is on its target: each runner on `ubuntu-26.04`, or a
      named macOS image; eslint, prettier and globals on the versions above;
      `sharp` and `firebase-tools` on one version each; `wrangler` pinned
      to an exact version; each action's comment names its exact release.
- [ ] A census run after the merge lists ShyTalk behind on none of these.

### Runtime proof

- [ ] Every CI workflow runs green on the new runner image, read by step
      name, the deploy workflows included.
- [ ] `sharp` processes images on the live API: after the merge, Deploy To
      Dev's "Verify dev API health" serves the merge SHA, and "Dev Smoke —
      R2 image upload" (`tests/web/dev-smoke.spec.ts`, the
      `imageCompressor.js` pipeline) is green in "Dev Smoke Tests".
- [ ] The emulator suites (integration, rules) run green on the aligned
      `firebase-tools`.
- [ ] The pinned `wrangler` deploys the web to dev ("Deploy Web to Dev"
      green), and the dev site serves.

### Error paths

- [ ] A floating pin added later fails a guard naming the file:
      `npm install -g` without a version, a `-latest` runner, or an action
      comment without a full version.

### Edge cases

- [ ] The eslint and prettier upgrades change no code beyond what they
      reformat or newly flag: each one is fixed in this story, never
      suppressed.

### Performance

- [ ] CI durations on `ubuntu-26.04` are measured against the last green run
      on the old images; a job more than its measured spread slower is
      explained in the PR.

### Security

- [ ] Every newly pinned action keeps its 40-hex SHA with a `# vX.Y.Z`
      comment; every new package version passes the licence and audit
      checks.

### UX

- [ ] No change a user can see, proven by the Runtime proof ACs.

### i18n

- [x] Not applicable: no copy.

### Observability

- [ ] The guard prints each pin it checked and the count.

## Announce

None: no change users can see, once the Runtime proof runs are green.

## BDD Scenarios

**Scenario: a floating pin is refused**

- **Given** a workflow installs a global tool without a version
- **When** the guard runs
- **Then** it fails, naming the file and the tool

## Test Plan

- The guard's cases, with a planted floating pin of each form seen red.
- Every workflow green by step name on the new images; the dev deploy's
  health, sanity and smoke runs after the merge.
- The no-holes rule applies: before/after lists, mutations of the guard.

## Out of Scope

- Node (SHY-0566, SHY-0675); coverage (EPIC-0016).

## Dependencies

- None.

## Risks & Mitigations

- **`ubuntu-26.04` changes preinstalled tools** (JDK, Android SDK, Xcode on
  macOS): each job's toolchain is read by step name before the switch, and
  every job is pinned to what it needs.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; dev deploy
      green; merged to `develop`.

## Notes

- **2026-10-21**: filed from the global rule (skill
  `aligning-versions-across-projects`, census of all five projects). P1, the
  level of SHY-0566 (Node everywhere): consistency, not a live defect.
  Scored 5: about 60 runner lines across the workflows, three package bumps
  with their lint fixes, two in-project drifts, three floating pins with a
  guard, each proven on CI and on the dev deploy.
