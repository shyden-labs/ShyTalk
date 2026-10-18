---
id: SHY-0640
status: Draft
owner: claude
created: 2026-10-18
priority: P0
effort: XS
estimate: 2
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0001
---

# SHY-0640: A deletion audit hash never uses a public key

## User Story

As a learner whose account was deleted, I want the audit record of that
deletion to be impossible to link back to me, so that deleting my account
really separates me from what is left.

## Why

Found on 2026-10-18, read at `origin/develop` b61253c764f:
`express-api/src/cron/accountDeletion.js` hashes the deleted account's
`uniqueId` for the `account_deleted` audit entry with
`createHmac('sha256', AUDIT_HASH_SECRET || 'dev-audit-secret')` (line 495).
When the secret is missing, the key is the string in this public repository,
and unique ids are sequential numbers (from 100000000), so every hash can be
reversed by hashing each id in turn. In production a missing secret only logs
an error at load (line 23) and the deletion carries on.

Measured: nothing in the repository sets `AUDIT_HASH_SECRET` (the only
references are the cron and its test). Not measured: whether the production
service has it set in its hosting configuration; checking that needs
production access, which is Shyden's (2026-10-18).

## Acceptance Criteria

### Happy path

- [ ] Outside tests and the emulators, the deletion refuses to write an audit
      entry (and so fails the account, leaving it for the next run) when
      `AUDIT_HASH_SECRET` is missing; no code path hashes with a literal key.

### Error paths

- [ ] The failure names the missing variable, never a value.

### Edge cases

- [ ] Tests and the emulators set their own key explicitly; the literal
      `'dev-audit-secret'` is gone from `src`.

### Performance

- [ ] Not applicable.

### Security

- [ ] A unit test with the secret unset (production mode) proves no entry is
      written; seen RED against today's code first.
- [ ] Shyden confirms the production service has `AUDIT_HASH_SECRET` set (his
      check); if it was missing, the entries written since are listed as
      reversible in Notes.

### UX

- [ ] Not applicable: no screen changes.

### i18n

- [ ] Not applicable.

### Observability

- [ ] The startup check fails loudly in production instead of only logging.

## Announce

Nothing: no learner-facing change.

## BDD Scenarios

**Scenario: no secret, no reversible record**

- **Given** the production deletion cron with `AUDIT_HASH_SECRET` unset
- **When** an account's deletion reaches the audit step
- **Then** no audit entry is written and the run reports the missing variable

## Test Plan

- Unit test with the environment stood in; mutation of the guard.

## Out of Scope

- Which data kinds the entry lists (SHY-0635).

## Dependencies

- Shyden's production check for the second Security AC.

## Risks & Mitigations

- If production lacks the secret, deletions start failing once this lands:
  intended; set the secret first (his step), then deploy.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-18**: Filed while checking the `account_deleted` entry for
  SHY-0635. P0 (a privacy defect); MVP (deletion is a launch path). Scored 2:
  one guard, one test, one config check.
