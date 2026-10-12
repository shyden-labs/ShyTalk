---
id: SHY-0558
status: Draft
owner: claude
created: 2026-10-12
priority: P0
effort: S
estimate: 2
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0558: actionlint is installed from a pinned, verified source

## User Story

As the operator, I want every tool CI downloads to be pinned and checked, so
that a change in someone else's repository cannot run code in our CI.

## Why

Read 2026-10-12 in `.github/workflows/lint.yml`, step "Install actionlint":
`bash <(curl -fsSL https://raw.githubusercontent.com/rhysd/actionlint/main/scripts/download-actionlint.bash) 1.7.7`.
The version argument pins the binary, but the installer script is fetched
from the `main` BRANCH and run as-is: whatever that file says on the day of
the run executes with the job's token. Every third-party action is pinned to
a 40-hex SHA (operator rule); this download is not.

Also measured the same day: actionlint 1.7.12 (the laptop's) reports
`SC2086` at `.github/workflows/sonarcloud.yml:184`
(`./gradlew sonar -Dsonar.token=$SONAR_TOKEN -x :app:sonar`), which CI's
1.7.7 does not, so local and CI lint disagree.

## Acceptance Criteria

### Happy path

- [ ] CI installs actionlint from a pinned release asset (or a pinned
      commit of the installer), checked against a recorded SHA-256 before
      it runs.
- [ ] The pinned version is the current release, the laptop and CI agree,
      and `sonarcloud.yml:184` is fixed (quoted), not suppressed.
- [ ] A test refuses any `curl … | bash` or `bash <(curl …)` in workflow
      and action files that names a branch rather than a commit or a
      checked asset.

### Error paths

- [ ] A checksum mismatch fails the step naming the expected and actual
      sums. No retry.

### Edge cases

- [ ] Dependabot or a recorded manual step covers the version bump.

### Performance

- [ ] Not applicable.

### Security

- [ ] No downloaded script runs unpinned anywhere in `.github/`.

### UX

- [ ] Not applicable.

### i18n

- [ ] Not applicable.

### Observability

- [ ] The step prints the installed version.

## BDD Scenarios

**Scenario: The installer changes upstream**

- **Given** the actionlint repository changes its installer on `main`
- **When** our lint workflow runs
- **Then** it still runs the pinned, checked binary

## Test Plan

- The new test with planted branch-pinned downloads going red; the lint
  workflow green on the PR, read by step name.

## Out of Scope

- Other tools' installers, unless the new test finds them (then fixed here).

## Dependencies

- None.

## Risks & Mitigations

- **Newer actionlint finds more issues.** Fix each in this story.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-12**: Found while running CI's lint checks locally for SHY-0544.
  Scored 2: one workflow step, one guard, one quoting fix.
