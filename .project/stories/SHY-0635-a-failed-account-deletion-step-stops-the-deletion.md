---
id: SHY-0635
status: Draft
owner: claude
created: 2026-10-18
priority: P0
effort: M
estimate: 5
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0001
blocked_by: [SHY-0631]
---

# SHY-0635: A failed account deletion step stops the deletion and is tried again

## User Story

As someone who deletes their ShyTalk account, I want the deletion to finish
completely or be tried again, so that no part of my data is left behind
because one step failed once.

## Why

Found on 2026-10-18 while designing SHY-0631, read at `6ff7a90e4ca`:
`hardDeleteAccount` in `express-api/src/cron/accountDeletion.js` runs twelve
steps, and every step except the audit entry catches its own error, logs it
and carries on. Step 8 then deletes the `users/{id}` document, which is the
only thing that puts the account in the next run's query
(`deletionExecuteAt <= now`). So a step that fails once (rooms, followers,
reports, suggestions, auth data, identity map, device bindings, the Firebase
Auth user) is never tried again, and the sweep still answers 200, so the
nightly workflow is green.

The deletion email is also sent first (step 1), before anything is deleted,
so a deletion that later fails has already told the person it is complete.

SHY-0631 makes the conversation step fail loudly and resumably; this story
does the same for every other step.

## Acceptance Criteria

### Happy path

- [ ] Every step of `hardDeleteAccount` lets its error reach the caller; the
      `users/{id}` document is deleted only after every other data step
      succeeded, so a failed account stays in the next run's query.
- [ ] The "deletion complete" email is sent after the deletion succeeded,
      never before.
- [ ] Every step is safe to run twice (a second run after a partial one
      deletes what is left and changes nothing else).
- [ ] The `account_deleted` audit entry is written only after every step
      succeeded, and its `dataDeleted` lists what was actually deleted. Today
      it is a fixed list of all 14 kinds (`accountDeletion.js:505-520`, read at
      b61253c764f), written whatever the steps before it did.

### Error paths

- [ ] A run in which any account failed still processes the other accounts,
      then ends as a failure (the sweep answers 500, the workflow is red),
      naming how many failed (counts only).
- [ ] A Firebase Auth user already gone (`auth/user-not-found`) counts as
      deleted, not as a failure.

### Edge cases

- [ ] An account whose deletion was cancelled while a run was in progress is
      left alone (today's re-read stays).

### Performance

- [ ] No extra Firestore reads on a clean run.

### Security

- [ ] An integration test makes each step fail once in turn and shows the
      next run finishes the deletion, seen RED against today's code first.

### UX

- [ ] Not applicable: no screen changes.

### i18n

- [ ] Not applicable: the email text is unchanged.

### Observability

- [ ] Each failed step is logged with the step name and the account's hashed
      id, never the raw id or email.

## BDD Scenarios

**Scenario: a failed step is tried again on the next run**

- **Given** an account due for deletion, and the rooms step fails once
- **When** the nightly run ends
- **Then** the run is red, the account's `users` document is still there
- **And** the next run deletes everything and the run is green

**Scenario: the email comes last**

- **Given** an account due for deletion, and a step fails
- **When** the run ends
- **Then** no "deletion complete" email was sent

## Test Plan

- Integration tests (emulator, CI): one per step, failing it once, RED first
  against today's code.
- Unit tests of the ordering with every step stood in.

## Out of Scope

- Conversation clean-up (SHY-0631).
- Sweep counts in the response body (SHY-0070; its "errors increments, sweep
  continues" AC must end red, not 200, after this story).

## Dependencies

- SHY-0631 first: both change `accountDeletion.js`.

## Risks & Mitigations

- A step that fails every night blocks that account forever (assumed rare):
  the red run names it each night, so it is seen, not hidden.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; one dev run of the deletion green.

## Notes

- **2026-10-18**: Filed while designing SHY-0631. P0 by the standing rule
  that any defect is P0; MVP because launch users delete accounts. Scored 5:
  twelve steps, their order and one failure test each; larger than SHY-0631
  (3).
