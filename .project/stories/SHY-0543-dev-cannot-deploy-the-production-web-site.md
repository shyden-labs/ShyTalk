---
id: SHY-0543
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

# SHY-0543: Dev cannot deploy the production web site

## User Story

As the operator, I want the dev web deploy and the prod web deploy to hold
tokens that each reach only their own Cloudflare account, so that nothing
running for dev can change the live site.

## Why

Measured 2026-10-07: `deploy-dev.yml` (project `shytalk-site-dev`),
`deploy-prod.yml` (project `shytalk-site`) and `rollback.yml` all read the
same repository secret `CLOUDFLARE_API_TOKEN`, and prod and rollback name
account `9315582c39b627dca58dfa83602db385`. A Cloudflare Pages token narrows
to an ACCOUNT, never one project (global rule, checked 2026-10-02 for
shyden.co.uk #415), so the dev token can deploy prod. Global rule: dev and
prod live in separate Cloudflare accounts, each token including only its
own account.

## Acceptance Criteria

### Happy path

- [ ] Which account each Pages project, domain and DNS zone sits in today is
      read and recorded (by Shyden in the dashboard where the App cannot).
- [ ] `shytalk-site-dev` lives in a dev-only Cloudflare account, and
      `shytalk-site` in the prod account; the dev site's domain keeps
      serving (read back with an HTTP check).
- [ ] Dev deploy reads a dev token (dev account only) from the `dev`
      environment; prod and rollback read a prod token (prod account only)
      from their environments (SHY-0542).
- [ ] Each token's account scope is read back by Shyden and recorded, never
      "All accounts".
- [ ] A backend test refuses a workflow that names the prod account id or
      the prod Pages project while reading the dev token, and the reverse,
      each planted form going red, with floors on what it read.

### Error paths

- [ ] A dev deploy given the prod project name fails at Cloudflare with an
      authorisation error (proved once, live, against a harmless call).

### Edge cases

- [ ] Preview deployments and the rollback's "previous production
      deployment" lookup still work in the new layout.

### Performance

- [ ] Not applicable beyond today's deploy times (read, not changed).

### Security

- [ ] The old shared token is revoked after both new ones are proved.

### UX

- [ ] The release protocol doc names both accounts and tokens.

### i18n

- [ ] Not applicable.

### Observability

- [ ] Each deploy's log names the account it deployed to (id only).

## BDD Scenarios

**Scenario: The dev token cannot deploy the live site**

- **Given** the dev deploy's Cloudflare token
- **When** it is used against the prod Pages project
- **Then** Cloudflare refuses it as unauthorised

**Scenario: A workflow mixing dev token and prod project is refused**

- **Given** a workflow reading the dev token while naming `shytalk-site`
- **When** the backend tests run
- **Then** the test fails naming that workflow

## Test Plan

- Unit: the account-separation test, planted forms predicted and run.
- Live: one dev deploy and one prod deploy read by name; the old token's
  revocation read back.

## Out of Scope

- Non-web surfaces (SHY-0542 covers their secrets).

## Dependencies

- SHY-0542 (environments for the prod token).
- Shyden: account creation, project moves, token creation and revocation.

## Risks & Mitigations

- **The dev site goes dark during the move.** Mitigation: build the dev
  project in the new account first, switch its domain, then delete the old.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; both deploys
      read live.

## Notes

- **2026-10-07**: Found with SHY-0542, reported to Shyden as P0.
- Scored 5 against shyden.co.uk #415 in shape (the same split for that
  site), with less test surface here.
