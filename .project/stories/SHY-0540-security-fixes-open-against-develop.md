---
id: SHY-0540
status: Draft
owner: claude
created: 2026-10-07
priority: P0
effort: M
estimate: 5
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0540: Security fixes open against develop, and the nightly live jobs run released code only

## User Story

As **Shyden, the operator**, I want Dependabot's security fixes to open
against `develop` like every other change, so that they pass the develop gate
and reach production through a release; and I want the nightly jobs that act
on live accounts to keep running released code after `develop` becomes the
default branch.

## Why

**Operator decision (2026-10-07):** *"they should be opened against develop,
not main. make this a global rule and added to the repo template"*, then,
asked how, chose **"Develop default + guard live jobs"**.

GitHub: *"Dependabot raises pull requests for security updates against the
default branch only"*; `target-branch` *"will only apply to version
updates"*. ShyTalk's default branch is `main`, so #2183 (an npm security
group) has sat open against `main` since 2026-09-07, while the 17 version PRs
correctly target `develop`.

GitHub also runs every **scheduled** workflow from the default branch's file
and code. ShyTalk has six. Two act on the live system every night:
`cron-account-deletion.yml` (03:00) and `cron-support-retention.yml` (03:30)
POST to `https://api.shytalk.shyden.co.uk` with `SYSTEM_SHARED_SECRET`.
After the switch, as written, they would run whatever is on `develop`.

**P0 found while measuring (2026-10-07):** neither job names an
`environment:`, and their setup comments say *"Add `SYSTEM_SHARED_SECRET` to
repo secrets"*, so the credential that authorises live account deletion is a
repository secret, readable by a workflow on any branch. The global rule puts
every production credential in an environment with Shyden as a required
reviewer. (The App cannot list secrets, HTTP 403; this is read from the
workflows. Shyden confirms where the secret lives.)

## Acceptance Criteria

### Happy path

- [ ] The two live jobs are split: a scheduled trigger whose only step is
      `gh workflow run <job>.yml --ref main`, and the real job on
      `workflow_dispatch` only, so the code and workflow that touch live are
      always `main`'s.
- [ ] `SYSTEM_SHARED_SECRET` lives only in a dedicated environment
      (`prod-cron`) whose deployment branch policy allows `main` alone, with
      no required reviewer (operator decision, see Notes), and is deleted from
      repository secrets by Shyden. The real jobs name that environment.
- [ ] A test pins that each real job names `prod-cron` and that no other
      workflow names it.
- [ ] A backend test refuses any workflow with `on: schedule` whose text
      names a production host or a production secret, unless its only job is
      the `--ref main` dispatch above. It counts the scheduled workflows it
      read (6 today) against a recorded floor.
- [ ] `pr-checks.yml` gains a first step failing unless
      `github.event.repository.default_branch` is `develop` (the global rule's
      CI check, as in `repo-template`). It lands AFTER the switch, or it is
      red on every PR.
- [ ] Shyden switches the default branch to `develop`; the switch is read
      back with `gh api repos/shyden-labs/ShyTalk --jq .default_branch`.
- [ ] #2183 is brought onto `develop`, and what re-raised it (recreate,
      close, or a manual PR) is recorded in Notes and in the global rule.

### Error paths

- [ ] If the dispatch fails, the trigger run fails by name (no retry).

### Edge cases

- [ ] Every workflow, script and test that assumed the default branch is
      `main` (for example `deploy-dev.yml`'s note on default-branch cache
      fallback, `deploy-prod.yml`'s note on `github.sha`) is re-read, and any
      behaviour change is fixed or recorded.
- [ ] Closing keywords now close issues on the `develop` merge; the
      `inject-pr-closes.yml` workflow and the story sync are checked for any
      assumption that closure means "released".

### Performance

- [ ] Not applicable.

### Security

- [ ] The live credential is unreadable from any branch but `main`.

### UX

- [ ] Not applicable.

### i18n

- [ ] Not applicable.

### Observability

- [ ] The first nightly run after the change is read by step name: the
      trigger dispatched, the real job ran at `main`'s SHA and returned 2xx.

## BDD Scenarios

**Scenario: A security fix opens against develop**

- **Given** the default branch is `develop`
- **When** Dependabot raises a security update
- **Then** its pull request targets `develop`

**Scenario: The nightly live job runs released code only**

- **Given** the 03:00 UTC schedule fires on `develop`
- **When** the trigger runs
- **Then** it only dispatches the real job with `--ref main`
- **And** the real job reads `SYSTEM_SHARED_SECRET` from `prod-cron`

**Scenario: A scheduled workflow that touches live without the dispatch is refused**

- **Given** a scheduled workflow naming a production host in a `run:` step
- **When** the backend tests run
- **Then** the test fails naming that workflow

## Test Plan

- The scheduled-workflow test with a planted violation per form (a host in a
  `run:`, a secret in `env:`), each RED, plus floor growth and loss.
- A dry dispatch of each real job from `main` before the switch.

## Out of Scope

- Moving the sweeps into the API server (a prior decision keeps
  server-wide crons out).

## Dependencies

- Shyden: where the secret lives, and the default-branch switch.

## Risks & Mitigations

- **A night with no sweep during the change.** Mitigation: the new trigger
  lands and is proven by a manual dispatch before the old schedule is removed.

## Definition of Done

- [ ] Every AC above is met; CI green by step name; the first nightly run read.

## Notes

- **2026-10-07**: Filed from the operator's decision the same day.
- **2026-10-07**: Asked where the live key should live, Shyden chose **"Own space, main only"**: an environment only `main` can deploy to, with no approval click, because a nightly job cannot wait for one. A recorded exception to the rule that every production credential sits behind his approval; `main` itself only changes through an approved release.
- Scored 5, like SHY-0535: two workflow splits, one guard test with floors,
  one CI step, and operator-side settings.
- **2026-10-07**: Shyden created `prod-cron` and switched the default branch to
  `develop` before this story's workflow split (read back: default `develop`;
  `prod-cron` had NO deployment branch policy, sent him the commands to set
  `main` only). Both cron workflows are identical on `main` and `develop`, so
  the scheduled runs are unchanged until one of them is edited on `develop`.
  He chose to ROTATE the secret (new value on the server, in `prod-cron` and,
  until this story lands, the repo secret). Also fix here: both cron
  workflows' setup comments say the server value lives in
  `ecosystem.config.js`, but that file is tracked and shipped by every deploy;
  the server reads `~/shytalk-api/.env` through dotenv (`src/index.js:1`).
- **2026-10-07, add to scope**: `.husky/pre-push:46` sets
  `CHANGED=$(git diff --name-only origin/main...HEAD)`, so every unreleased
  `develop` change reads as the pushed branch's own. Measured on SHY-0535's
  push: "Web changes detected" on a branch whose diff against
  `origin/develop` holds no `public/` or `tests/web/` file. The base must be
  `origin/develop`, with a test pinning it and a planted `main` going red.
