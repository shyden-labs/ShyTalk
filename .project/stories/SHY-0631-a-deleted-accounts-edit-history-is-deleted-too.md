---
id: SHY-0631
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
---

# SHY-0631: A deleted account's edit history is deleted too

## User Story

As someone who deletes their ShyTalk account, I want every copy of what my
messages said deleted with it, including the earlier versions of messages I
edited, so that deleting my account really removes my words.

## Why

Found on 2026-10-18 while designing SHY-0614, read at `c9e7227`:
`deleteOneOnOneConversation` in `express-api/src/cron/accountDeletion.js`
says it deletes "a 1-on-1 conversation and all its subcollections", but it
lists only `messages`, `userSettings` and `mutes`. Firestore never deletes a
document's subcollections with it, so every `messages/{id}/edits/{id}` entry,
each holding a `previousText`, survives the account's deletion with no
parent document. Nothing reads those orphans in the apps (the rules read gate
needs the deleted conversation), but the words stay stored.

SHY-0219 (#1636) is the compliance suite whose erasure test would catch
this; it does not fix it.

## Acceptance Criteria

### Happy path

- [x] First, every server path that deletes conversation messages is listed
      in Notes, with the subcollections each leaves behind.
- [ ] Each of those paths deletes every subcollection under each message it
      deletes (`edits` today; SHY-0614's `recall` once it lands).
- [ ] A one-off clean-up removes the orphaned `edits` already in dev and
      production, counted before and after. **Dev done 2026-10-18**: runs
      39146266945 (dry) and 39146372134 (apply) on b61253c, both
      `scanned 0, orphaned 0`, before and after, each run having found its
      planted sentinel first (#2427). Production waits for a release with the
      script and Shyden's approval in the `production` environment.

### Error paths

- [x] A failure partway leaves the deletion resumable on the next cron run,
      and the run reports it rather than ending green. Proof:
      `accountDeletion-failure.unit.test.js` (the run fails naming the count;
      the account keeps its user document; the others still go),
      `delete-tree.unit.test.js:72`, `accountDeletion.test.js:191`.

### Edge cases

- [ ] A message with many edits is fully deleted (batch limits respected).
- [x] A group conversation the user only leaves keeps the other members'
      history (today's behaviour). Proof: `accountDeletion.test.js:376`.

### Performance

- [x] The deletion's run time is measured before and after on the CI
      emulator (Shyden, 2026-10-18), 200 messages x 2 edits: 212 ms before
      (the old code skipped the 400 edits), 412 ms after (#2426 Test Backend).

### Security

- [x] An integration test seeds a 1:1 conversation with edited messages,
      deletes the account, and finds no document left under it, seen RED
      against today's code first. Proof: `accountDeletion.test.js:364`, red
      on plant PR #2425 (runs 39126480802, 39128651729).

### UX

- [ ] Not applicable: no screen changes.

### i18n

- [ ] Not applicable: no user-facing text.

### Observability

- [x] The cron logs how many messages and subcollection documents it
      deleted per account (counts only). Proof: `accountDeletion-failure.unit.test.js`
      "accountDeletion logs what it deleted" (3 tests, 4 mutants killed, #2427).

## BDD Scenarios

**Scenario: a deleted account leaves no edit history behind**

- **Given** A and B's conversation, where B edited "hello" to "hi"
- **When** B's account deletion runs
- **Then** no document is left under that conversation, `edits` included

## Test Plan

- Integration test (emulator, CI) per path, RED first against today's code.
- Unit tests of the path-listing with Firestore stood in.
- Clean-up counts recorded in the PR for dev; production is Shyden's run.

## Out of Scope

- The recall record's own deletion (SHY-0614 deletes what it creates).
- Group messages of a deleted member (kept today; SHY-0219's policy AC).

## Dependencies

- None blocking. SHY-0635 (the other deletion steps) waits on this story.

## Risks & Mitigations

- The clean-up deletes the wrong documents: it deletes only `edits` whose
  parent message no longer exists, dry run first with counts.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; clean-up run on dev and its counts recorded.

## Notes

- **2026-10-18**: Filed while designing SHY-0614. P0 as a data-protection
  defect (erased words kept). MVP: launch users delete accounts. Scored 3:
  one cron path, a clean-up script and their tests; larger than SHY-0630 (2).
- **2026-10-18 (design, read at `6ff7a90e4ca`)**: every server path that
  deletes conversation messages, and what each leaves behind (rules list five
  conversation subcollections: `messages` with `edits` under it,
  `userSettings`, `settings`, `mutes`, `mod_log`):
  - `cron/accountDeletion.js` `deleteOneOnOneConversation`: lists
    `messages`, `userSettings`, `mutes`; leaves `edits`, `settings`,
    `mod_log`. Its caller catches every error, so a failure is never retried.
  - `routes/admin-cleanup.js` `deleteConversation` (system, all-system,
    all-private-messages, all-group-chats): the same three; leaves the same.
  - `cron/testDataCleanup.js` (not scheduled anywhere today): five lists, but
    one `limit(500)` read each, so a conversation over 500 messages keeps the
    rest; leaves `edits`.
  - `routes/test-helpers.js` `deleteTestData`: `messages` only, one batch
    (fails over 500); leaves `edits`, `userSettings`, `settings`, `mutes`,
    `mod_log`.
  - `routes/admin-migrate.js` (dev only, prod-to-dev copy): `messages`,
    `userSettings`, `mutes`; leaves `edits`, `settings`, `mod_log`.
  - `scripts/reset-data.mjs` (full wipe): the same three; leaves the same.
  - `scripts/device-journey-runner.js` (dev set-up, two steps): `messages`
    only; moved to SHY-0636 with its retry loops.
  - Not a delete path: `cron/orphanedStorage.js` and `data-export-builder.js`
    only read messages.
- **2026-10-18**: Re-scored 3 -> 5 on the list above (six call sites, the
  clean-up script, a test per path); same size as SHY-0635 (5). The error
  path AC covers the conversation step here; every other step of the
  deletion is SHY-0635.

- **2026-10-18 (after #2426, #2427)**: two ACs stay open beside the production
  clean-up. (1) Paths: `scripts/reset-data.mjs:175` now calls `deleteTree`, but no
  test pins that call (every other path is proven by
  `conversation-tree-paths.test.js:49-106`, `accountDeletion.test.js:364` and
  `testDataCleanup.test.js`; the seeded tree includes SHY-0614's `recall` since
  b57e578). (2) Many edits: proven per conversation (600 documents, and 501
  messages at `testDataCleanup.test.js:247`), not for one message holding over
  500 edits. Both are small tests for the next SHY-0631 PR.
