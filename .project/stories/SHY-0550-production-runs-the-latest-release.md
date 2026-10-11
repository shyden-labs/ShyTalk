---
id: SHY-0550
status: Draft
owner: claude
created: 2026-10-11
priority: P0
effort: M
estimate: 5
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0550: Production runs the latest release, so support data is deleted on schedule

## User Story

As the operator, I want the live API and web site to run the latest release,
so that what we have shipped (above all the support-data deletion people were
promised) is what people actually get.

## Why

Measured 2026-10-11:

- `https://api.shytalk.shyden.co.uk/api/health` reports sha `7e4653500d3`,
  tag `v0.97.14`. The last `deploy-prod.yml` run was 27417981599 on
  2026-06-12 (every job green by name).
- `v0.97.15`, `v0.98.0` and `v0.99.0` (`7080cf12dca`, 2026-08-27) were
  released by `release.yml` and never deployed: 533 commits on `main` since the
  live sha, 227 of them under `express-api/`.
- `cron-support-retention.yml` (03:30 UTC) has failed on all 45 runs since it
  was added on 2026-08-28: `POST /api/system/sweep-support-retention` answers
  401 `{"error":"Authentication failed"}`. The route (SHY-0435/SHY-0436,
  commit `6265bea6960`) is not in the live sha, so the request falls through
  to user-token auth. The body has no `code` field, which matches the
  pre-SHY-0308 middleware the live server runs. The secret is not the fault:
  `cron-account-deletion.yml` sends the same `SYSTEM_SHARED_SECRET` to the same
  host and gets 200 every night (run 38128534180, 2026-10-11).
- Consequence: closed support tickets and their attachments (screenshots of
  private conversations) have not been deleted seven days after closing,
  as SHY-0436 promises. Every other backend fix since June is also not live.

Operator decision 2026-10-11 (AskUserQuestion): prepare a deploy of
`v0.99.0`, approved by him in GitHub as usual.

## Acceptance Criteria

### Happy path

Before the deploy:

- [ ] Every environment variable, secret and config file that the backend reads
      at `v0.99.0` but not at `v0.97.14` is listed (from a diff of `process.env`
      reads and config loaders), and each is confirmed present on the
      production server or added there by Shyden before the deploy.
- [ ] Firestore rules, indexes and any data migration between the two tags
      are listed, each with how `deploy-prod.yml` applies it or the hand
      step it needs.
- [ ] The change list (v0.97.15 to v0.99.0 release notes plus anything the
      notes miss) is shown to Shyden before he approves.

Deploy:

- [ ] `deploy-prod.yml` dispatched with `ref=v0.99.0` (backend and web; android
      and ios per Shyden's standing choice), approved by Shyden in the
      `production` environment, every job green by name.
- [ ] `/api/health` reports `7080cf12dca...`, read the same hour.

After the deploy:

- [ ] `cron-support-retention.yml`, dispatched with `--ref main`, gets 200 and
      its server body is recorded; the next scheduled 03:30 run is read by name.
- [ ] `cron-account-deletion.yml`'s next run still gets 200.
- [ ] The backlog the sweep cleared on its first run (tickets and uploads
      deleted) is recorded from its response, so the gap's size is known.

### Error paths

- [ ] If the deploy or a smoke test fails, roll back to `v0.97.14` by the
      documented path and record why; retention stays this ticket's open item.

### Edge cases

- [ ] A sweep already in flight (409) on the first post-deploy run is read as
      success only after the following run returns 200.

### Performance

- [ ] The first retention sweep (two months of backlog) finishes inside the
      job's limit; its duration is recorded.

### Security

- [ ] No production credential is added as a repo secret; the deploy runs
      only through the `production` environment with Shyden as reviewer.

### UX

- [ ] The web and API smoke tests in `deploy-prod.yml` pass by name; the
      live site loads signed out and signed in.

### i18n

- [ ] No user-facing copy changes in this story (deploy only).

### Observability

- [ ] `/api/health` sha, both cron runs' server status lines and the
      sweep's counts are recorded in Notes.

## BDD Scenarios

**Scenario: The nightly retention sweep reaches its route**

- **Given** production runs v0.99.0
- **When** the 03:30 UTC support-retention job posts with the system secret
- **Then** the server answers 200
- **And** closed tickets older than seven days are deleted with their attachments

**Scenario: A failed deploy goes back to the last good release**

- **Given** the v0.99.0 deploy or a smoke test fails
- **When** the rollback path runs
- **Then** `/api/health` reports v0.97.14 again and the failure is recorded

## Test Plan

- CI: the release's own gates (already passed when `v0.99.0` was cut).
- Live: `/api/health` sha; both cron jobs' step results by name and their
  server status lines.

## Out of Scope

- A check that production never drifts behind a release again (SHY-0551 covers
  silent nightly failures; a live-sha-vs-latest-tag check belongs to the
  "nothing we rely on stops silently" work).

## Dependencies

- Shyden's approval in the `production` environment.

## Risks & Mitigations

- 227 backend commits land at once: the env/config diff and the change list
  come first, and the rollback path is confirmed before dispatch.

## Definition of Done

- [ ] Every AC ticked with its evidence (run ids, health sha, cron bodies).
- [ ] Board item Done; SHY-0435/SHY-0436 notes record when retention went live.

## Notes

- Found 2026-10-11 while checking whether the Oct 7 cron-secret rotation was
  finished (Shyden: "Rotated, both places").
