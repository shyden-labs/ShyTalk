---
id: SHY-0539
status: Draft
owner: claude
created: 2026-10-07
priority: P2
effort: M
estimate: 3
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0539: The board sync fails fast on a stale read instead of sleeping and retrying, and counts every setup failure

## User Story

As **Shyden, the operator**, I want the story-to-board sync to stop by name
when GitHub hands it a stale, empty board, rather than sleeping and trying
again; and I want a failure to create the board's `Type` field to fail the
run, so that a sync that went wrong is never reported as a clean one.

## Why

**Operator standing rule (2026-10-02, global):** *"retries are not
acceptable. if retries are required that means it's flaky, adding a retry is
NOT a fix"*. Existing retries are defects, each with its own ticket. Where the
cause is outside our control, fail fast and say so by name, with no second
attempt. The global rules also forbid `sleep`.

Found while building SHY-0535, at `aabe8e7`:

1. `load_items_map` (`scripts/sync-stories-to-issues.sh`, SHY-0078, #1243):
   when the Projects v2 items read returns 0 items it `sleep`s
   `ITEMS_MAP_RETRY_BACKOFF` (default 3 s) and reads again. The SHY-0079
   sidecar (`.project/board-items.json`) is laid over the read afterwards and
   is already called "the hard backstop" in the code's own comment.
2. `setup_pre_sync` runs `ensure_project_type_field || true`, so a failure to
   create the `Type` field is dropped without a count or a message. SHY-0535
   gave the `Estimate` field the counted form
   (`emit … ; N_FAILED=$((N_FAILED + 1))`); `Type` was left behind.
   **Measured 2026-10-16: the create can never succeed.** GitHub reserves
   the name `Type` for the native issue type (`Name cannot have a reserved
   value`), so it fails on every run, green ones included, and the
   per-item Type write never runs. Counting it the way `Estimate` is
   counted would turn every sync red. The fix is to retire the field;
   the story's type already reaches GitHub as the native issue type.
3. The test pinning the retry,
   `the SHY-0078 items-map empty-read retry is retained`
   (`sync-stories-to-issues-board-fields.test.js`), matches
   `ITEMS_MAP_RETRY_BACKOFF` in the RAW script text, so the comment
   `# SHY-0078: backoff (seconds) before the empty-read retry` alone would
   satisfy it. That is a source-text guard reading unstripped text.

## Acceptance Criteria

### Happy path

- [ ] Before changing anything, the board-sync workflow's logs for the last
      30 days are searched for the retry's message
      (`empty on first read; retrying`) and the count, with run ids, is
      recorded in Notes; if the runs do not log at that level, that is
      recorded instead.
- [ ] `load_items_map` reads the board once. The `sleep`, the second pass
      and `ITEMS_MAP_RETRY_BACKOFF` are removed from the script and from
      every test environment that sets it.
- [ ] When that read returns 0 items while the sidecar holds 1 or more, the
      run stops before any write with a named message
      (`board read returned 0 items while board-items.json holds <n>:
      the Projects v2 read is stale; nothing was written`) and a distinct
      exit code, documented in `--help`.
- [ ] When both the read and the sidecar are empty, the run goes on as a
      first sync of an empty board, as today.
- [ ] The board-level `Type` field is retired: `ensure_project_type_field`,
      its call in `setup_pre_sync`, the per-item Type write and their
      tests are removed. The story's type reaches GitHub only as the
      native issue type, which a test pins on the create and update paths.
- [ ] No setup step in `setup_pre_sync` ends in `|| true`
      (`load_project_cache || true` is the other one today); each failure
      is counted in `N_FAILED` or stops the run, by name.

### Error paths

- [ ] The stale-read stop is a failure of the run (non-zero exit), so the
      workflow is red and the next sync is a new run, never a loop inside
      this one.

### Edge cases

- [ ] `--dry-run` reports the stale read the same way and writes nothing.
- [ ] A read returning SOME items while the sidecar holds more keeps today's
      behaviour: the sidecar fills the gap (SHY-0079), with its fill count
      logged.

### Performance

- [ ] The happy path makes one items read instead of up to two, and never
      waits.

### Security

- [ ] Not applicable: no new token or permission.

### UX

- [ ] The stop message names the cause and says nothing was written, so the
      operator knows a re-run is safe.

### i18n

- [ ] Not applicable.

### Observability

- [ ] A green sync prints no `[gh-error]` line; the mock-gh happy path
      asserts it, and the first green develop run after merge is read
      for it.

## BDD Scenarios

**Scenario: a stale empty read stops the run**

- **Given** the board read returns 0 items
- **And** board-items.json holds 3 items
- **When** the sync runs
- **Then** it exits with the stale-read code before any mutation
- **And** it says the Projects v2 read is stale and nothing was written
- **And** it does not read the board a second time

**Scenario: a genuinely empty board syncs**

- **Given** the board read returns 0 items and board-items.json is empty
- **When** the sync runs
- **Then** every story takes the create path

**Scenario: the sync never asks for a Type field**

- **Given** the board has no Type field
- **When** the sync runs
- **Then** it makes no `createProjectV2Field` call for `Type`
- **And** it prints no `[gh-error]` line

## Test Plan

- Mock-gh suites in `express-api/tests/scripts/`, behavioural, in the style of
  SHY-0535's board-field tests: one read call counted on the stale path, no
  mutation recorded, the exit code and message checked.
- The raw-text retry test is replaced by these behavioural tests, not
  re-pointed at stripped text.
- Mutations, each predicted first and watched RED: restore the second read;
  turn the stop into a warning; restore the `Type` create call; restore `|| true` on
  `load_project_cache`.

## Out of Scope

- The sidecar's own design (SHY-0079).

## Dependencies

- SHY-0535 (it gave the `Estimate` field the counted form this story copies).

## Risks & Mitigations

- **Stale empty reads are common enough that sync runs go red often.**
  Mitigation: the measurement AC above comes first; if the count is high,
  the finding goes to Shyden with AskUserQuestion before the stop lands.

## Definition of Done

- [ ] Every AC checkbox above is met; every mutation went RED as predicted.
- [ ] CI green by step name on the PR head SHA; merged into `develop`; the
      next board-sync run read by step name.

## Notes

- **2026-10-07**: Filed from findings made while building SHY-0535.
- Scored 3: smaller than SHY-0535 (5), which added a field path and its tests;
  this removes a path, copies an existing counted form, and replaces one test.
- **2026-10-16**: The `Type` create fails on every run. Sync runs 38814639984
  (success), 38822560310 (failure, for another reason) and 38827074868
  (success) each print `[gh-error] createProjectV2Field Type (exit 1): gh:
  Name cannot have a reserved value`. The board's fields that day: Title,
  Assignees, Status, Labels, Linked pull requests, Milestone, Repository,
  Reviewers, Parent issue, Sub-issues progress, Created, Updated, Closed, Pri,
  Effort, Roadmap IDs, SHY ID, Epic, Estimate (no Type). The ACs now retire
  the field instead of counting its failure. The score stays 3: retiring
  removes a path, as counting would have copied one.
