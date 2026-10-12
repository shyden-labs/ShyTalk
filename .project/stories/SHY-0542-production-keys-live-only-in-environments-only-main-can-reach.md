---
id: SHY-0542
status: Draft
owner: claude
created: 2026-10-07
priority: P0
effort: L
estimate: 8
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0542: Production keys live only in environments that only main can reach

## User Story

As the operator, I want every secret that can change production held in a
GitHub environment restricted to `main`, so that no workflow on any other
branch, and no edit that has not been released, can read one.

## Why

Measured 2026-10-07 from the workflow files on `origin/develop`. In
`deploy-prod.yml` only `approve-prod` names an environment (`production`),
and it reads no secret. Every deploy job after it reads its secrets as
REPOSITORY secrets: `SINGAPORE_SSH_KEY` (the prod API server),
`FIREBASE_SERVICE_ACCOUNT_PROD`, `PROD_FIREBASE_API_KEY`,
`PLAY_SERVICE_ACCOUNT_JSON`, `APP_STORE_CONNECT_KEY`/`_KEY_ID`/`_ISSUER_ID`,
the iOS certificate and profile, the Android keystore, and
`CLOUDFLARE_API_TOKEN`. `rollback.yml` changes the live web site with no
environment at all (built that way on purpose by SHY-0233, before the
operator's 2026-10-02 rule that every route to production needs his
approval). `release.yml` holds `RELEASE_APP_PRIVATE_KEY`, the key of the App
that may write to `main` without a pull request (ruleset 12613584), also as a
repository secret. A repository secret is readable by a workflow on ANY
branch. The global rule: production secrets live only in environments with
Shyden as required reviewer, never as repository secrets; the one exception
is an unattended scheduled job (SHY-0540's `prod-cron`).

## Acceptance Criteria

### Happy path

- [ ] A census, produced by a script and kept in the PR, lists every secret
      every workflow reads, by job, with whether that job names an
      environment. The figures in Why are re-measured by it, not copied.
- [ ] Every secret that can change production (server, Firebase prod, stores,
      signing, Cloudflare prod, the Release App key) is read only by jobs
      that name an environment whose deployment branches are `main` alone.
- [ ] Shyden decides, by AskUserQuestion at design, how the deploy jobs reach
      their secrets without four approval clicks returning (SHY-0084 removed
      them): for example one approval job in `production` plus deploy jobs in
      a `prod-deploy` environment restricted to `main` with no reviewer, as
      `prod-cron` does. The choice is recorded here.
- [ ] `rollback.yml`'s secret moves into an environment with Shyden as
      required reviewer, or Shyden records an explicit decision to keep a
      reviewer-free emergency path (its own main-only environment), with the
      reason.
- [ ] Shyden moves each value into its environment and deletes the
      repository copy; every move is read back by name (the App cannot list
      secrets, so Shyden runs the read).
- [ ] A backend test refuses any workflow job that reads a production secret
      (the census list, kept in one file) without naming an environment from
      the allowed set, with floors on workflows, jobs and secret reads, and a
      planted violation per form going red (secret in `env:`, in `with:`, in
      a `run:` expression; a job dropping its `environment:`).

### Error paths

- [ ] A deploy run that cannot reach a secret fails red at that step, naming
      the secret and the environment; no retry, no fallback secret.

### Edge cases

- [ ] `.github/known-secrets.yml` matches the new layout (environment
      secrets listed by environment), and its own check still passes.
- [ ] Dev deploy keeps working: it reads no production secret afterwards.

### Performance

- [ ] A full prod deploy needs no more approval clicks than today (one).

### Security

- [ ] After the move, no repository secret can change production: proved by
      Shyden's read of the repository secret list against the census.
- [ ] The release-path App key cannot be read off `main`.

### UX

- [ ] The release protocol doc says which environment each secret lives in
      and how to rotate it.

### i18n

- [ ] Not applicable: CI configuration, English only.

### Observability

- [ ] The census script is rerunnable and its output is committed with the
      PR, so a later secret added at repository level shows as a diff.

## BDD Scenarios

**Scenario: A production key is not readable off main**

- **Given** a workflow on a feature branch that reads `SINGAPORE_SSH_KEY`
- **When** it runs
- **Then** the secret is empty, because it lives only in an environment restricted to `main`

**Scenario: A job reading a production secret without an environment is refused**

- **Given** a deploy job that reads `PLAY_SERVICE_ACCOUNT_JSON` and names no environment
- **When** the backend tests run
- **Then** the test fails naming the job and the secret

**Scenario: A release still needs one approval**

- **Given** a release started on `main`
- **When** it reaches the approval step
- **Then** one approval unlocks every platform's deploy

## Test Plan

- Unit: the census-backed test, each planted form predicted and run.
- Live: one full release through the new layout, every job read by name.

## Out of Scope

- Separate Cloudflare accounts for dev and prod (SHY-0543).
- The nightly jobs' secret (SHY-0540).

## Dependencies

- SHY-0541 (prod workflows run only from `main`), so a restricted
  environment never meets a develop-started run.
- Shyden: every environment setting and every secret move.

## Risks & Mitigations

- **A release blocked mid-change.** Mitigation: each secret moves with its
  job in one PR, and a release is not cut until the live run is read.
- **Over 13 points once the census lands.** Mitigation: split by platform
  before starting if the census shows more than the jobs named here.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; the next release
      read job by job.

## Notes

- **2026-10-07**: Found while checking a side agent's note about
  hand-started prod deploys (SHY-0541). Reported to Shyden as P0 the same
  turn.
- Scored 8 against SHY-0540 (5) and SHY-0541 (5): the same kind of
  workflow and guard work over about ten jobs in three workflows, plus a
  census script.
