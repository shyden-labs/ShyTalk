---
id: SHY-0602
status: Draft
owner: unassigned
created: 2026-10-15
priority: P1
effort: L
estimate: 8
type: feature
roadmap_ids: []
mvp: false
epic: EPIC-0001
blocked_by: [SHY-0599]
---

# SHY-0602: The roadmap reads the board live, on dev and live

## User Story

As **a learner or supporter reading ShyTalk's roadmap**, I want it to show
what the team is working on now, so that it is a true picture of where
ShyTalk is going.

## Why

- Shyden's rule (global CLAUDE.md): in ShyTalk, board changes reflect on the
  dev and live roadmaps immediately and automatically. The design standard is
  `~/.claude/global-rules/reference-live-roadmap.md` (decided 2026-10-15).
- Measured 2026-10-15: `public/roadmap-data.json` is rebuilt by
  `sync-roadmap-data.yml` only on a push to `main`; the last promotion was
  2026-08-27, so the public roadmap is seven weeks old. Board edits never
  reach it (SHY-0360); the dev page lags develop (SHY-0519).
- Yawelo built the design (`apps/site/worker/roadmap.ts` 329 lines,
  `webhook.ts` 78, `github.ts` 230, a shared progress package 461), live on
  its dev site since 2026-10-15. ShyTalk's site is on Cloudflare Pages too
  (`wrangler pages deploy public`).

## Acceptance Criteria

### Happy path

- [ ] A Worker with a Durable Object holds the board snapshot; signed org
      webhooks (`issues`, `projects_v2_item`) trigger a re-read; a full read
      every 10 minutes catches anything missed; open roadmap pages get each
      new version over WebSockets and show "updated N seconds ago".
- [ ] It reads with a separate read-only GitHub App (Projects, Issues,
      Metadata: read).
- [ ] Only issues from ShyTalk's own public repo on the ShyTalk Stories board
      are shown; drafts, PRs and other repos are counted, never named.
- [ ] The roadmap's progress figures come from the same module as the
      operator's close-out.
- [ ] The time from a board edit to the page is measured on dev and written
      into the reference file.
- [ ] Works on dev and, after release, live; `roadmap-data.json` and its
      workflow are retired by SHY-0603.

### Error paths

- [ ] A failed read keeps the last snapshot and the page says since when it
      has not refreshed.
- [ ] `/api/roadmap/health` reports the last event time and drift; the dev
      check goes red on drift or a stale event time.

### Edge cases

- [ ] A burst of webhook events costs at most two reads.
- [ ] An unsigned or wrongly signed webhook is refused with 401.

### Performance

- [ ] Idle pages cost nothing (hibernating sockets).

### Security

- [ ] The webhook secret and App key are Worker secrets; constant-time
      signature compare; the App cannot write.

### UX

- [ ] The current roadmap page's look and filters are kept; only its data
      source changes.

### i18n

- [ ] Labels keep using the roadmap's translation path; every new string goes
      through Google Cloud Translation read-back.

### Observability

- [ ] Health is checked daily end-to-end with a planted failure, per the
      "nothing stops silently" rule.

## BDD Scenarios

**Scenario: a board change shows on the roadmap**

- **Given** a reader has the roadmap open
- **When** a ticket's status changes on the board
- **Then** the page shows the new status without a reload

## Test Plan

1. Port Yawelo's worker tests (webhook signature, coalescing, drift, failed
   read) and run them in wrangler's harness.
2. Dev: a real board edit, timed to the page; the drift check proven by a
   planted miss.
3. Playwright on the roadmap page against the dev snapshot.

## Out of Scope

- Retiring the old pipeline (SHY-0603).

## Dependencies

- Blocked by SHY-0599: the roadmap shows its fields (Priority, Status, MVP).

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Project webhooks are a GitHub public preview | The 10-minute full read is independent of them and makes a dead webhook loud. |
| Org webhooks are Shyden's to add | The story says exactly what to add and where; nothing else waits on him. |

## Definition of Done

- [ ] Board-edit-to-page time measured on dev, in Notes and the reference.
- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-15**: Filed from Shyden's ruling. Supersedes SHY-0360 and
  SHY-0519 (closed by SHY-0603). Estimate 8: a port of a proven design, sized
  against Yawelo's #341.
