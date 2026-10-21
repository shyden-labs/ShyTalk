---
id: SHY-0302
status: Draft
owner: claude
created: 2026-08-16
priority: P0
effort: XS
estimate: 3
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0302: Every gauntlet command refuses to run inside a git worktree

## User Story

As a **developer running the gauntlet from a worktree**, I want the scripts to
recognise the repository, so that **I can test a branch without disturbing the
main checkout** instead of being told the repo does not exist.

## Why

`express-api/scripts/gauntlet/lib.sh:61`:

```sh
require_repo() { [ -d "$REPO/.git" ] || die "repo not found at $REPO (set SHYTALK_REPO)"; }
```

In a **linked worktree**, `.git` is a **file** containing `gitdir: <path>`, not
a directory. The test is false, and every command that calls `require_repo`
dies with `FAIL repo not found at <path> (set SHYTALK_REPO)` — a message that
names the correct path and then denies it exists.

Measured 2026-08-16 while running the Express suite from a worktree during
SHY-0298:

| checkout                  | `.git`               | `tests/scripts/50-matrix-cmd-stop.test.js` |
| ------------------------- | -------------------- | ------------------------------------------ |
| `Developer/Repos/ShyTalk` | directory, 608 bytes | **9 passed**                               |
| a linked worktree         | file, 69 bytes       | **4 failed**, 5 passed                     |

Same code, same tests; the only variable is the git layout.

This matters more than a developer inconvenience. The repo's own conventions
push work INTO worktrees — parallel branches, reviewer isolation
([[feedback-reviewer-branch-isolation]]) — and a suite that fails there
produces exactly the noise that trains people to ignore red. During SHY-0298
these four failures had to be individually proven environmental before the real
failures in the same run could be trusted.

The guard's INTENT is right: fail early with a clear message rather than let
git commands fail confusingly later. Only its test is wrong.

## Acceptance Criteria

### Happy path

- [x] `require_repo` succeeds in an ordinary checkout, exactly as today.
- [x] `require_repo` succeeds in a linked worktree.
- [x] `tests/scripts/50-matrix-cmd-stop.test.js` passes from both.
- [x] `tests/scripts/runner-process-identity.test.js` passes from both
      (from SHY-0557).
- [x] The process-reaping suites SHY-0326 listed give the same verdict in
      the main checkout and a linked worktree, and their mutation table
      kills in both (from SHY-0326).

### Error paths

- [x] A path that is genuinely not a repository still fails, with the same
      message and the same non-zero exit — the guard must not be weakened into
      always passing, which is the obvious wrong fix.
- [x] A path that does not exist at all fails the same way.
- [x] A **bare** repository is rejected: the gauntlet needs a working tree, so
      accepting one would move the failure to a later, more confusing point.

### Edge cases

- [x] A worktree whose `.git` file points at a `gitdir` that no longer exists
      (the main checkout was deleted) is rejected, not silently accepted.
- [x] A subdirectory of the repo is **refused**, naming the path (amended
      2026-10-22 from "accepted"): every consumer uses `$REPO/express-api`
      or `$REPO/scripts`, so a subfolder would pass the check and fail later
      at an obscure `cd`. `require_repo` compares git's top level with the
      physical path.
- [x] `$SHYTALK_REPO` still overrides, and the override is validated the same
      way.

### Performance

- [x] The check runs once per command invocation and costs a single `git`
      call — negligible against a gauntlet measured in minutes.

### Security

- [x] `$REPO` is passed to `git -C` as a single argument, never interpolated
      into a shell string, so a path containing spaces or metacharacters cannot
      alter the command.

### UX

- [x] The failure message still names the path and the `SHYTALK_REPO` override,
      because that part was already good.

### i18n

- [ ] N/A — developer tooling output, English-only by design.

### Observability

- [ ] N/A — a pass is silent and a failure already prints one clear line;
      nothing here needs a new signal.

## BDD Scenarios

**Scenario: the gauntlet runs from a worktree**

- **Given** a linked git worktree of the repository
- **When** a gauntlet command runs there
- **Then** it proceeds instead of reporting "repo not found"

**Scenario: a real non-repository is still rejected**

- **Given** a directory that is not inside any git repository
- **When** a gauntlet command runs there
- **Then** it exits non-zero and names the path and the SHYTALK_REPO override

**Scenario: an ordinary checkout is unaffected**

- **Given** the main checkout
- **When** a gauntlet command runs there
- **Then** it behaves exactly as it did before this change

## Test Plan

**CI-config-only classification:** confined to a developer-tooling shell helper
and its tests — no app, backend or website runtime surface — so the
device/browser gauntlet is exempt under the protocol's exemption 2.

**RED first**, in `express-api/tests/scripts/gauntlet-require-repo.test.js`
(new). Each case builds a REAL git layout on disk and runs the REAL
`require_repo`; no fixture describes a worktree in the abstract, because the
whole defect is the difference between a real `.git` file and a real `.git`
directory:

- `accepts a linked worktree` — `git worktree add` a real worktree, run,
  expect exit 0. RED today.
- `accepts an ordinary checkout` — the regression guard.
- `refuses a subdirectory of the repo` (amended 2026-10-22, see the Edge
  cases AC).
- `rejects a plain directory` — expect exit non-zero and the existing message.
- `rejects a non-existent path`.
- `rejects a bare repository`.
- `rejects a worktree whose gitdir has been removed`.

**Mutation checks** — the fix must not be "always true". Replace the body with
`return 0` and the four rejection tests must go RED; that is the specific wrong
fix this bug invites ([[feedback-mutation-passed-means-investigate]]).

**Green** — the new suite plus `tests/scripts/50-matrix-cmd-stop.test.js` run
FROM a worktree, which is the failure that surfaced this;
`eslint --max-warnings=0`; prettier; shellcheck on the changed script.

## Out of Scope

- Any other behaviour of the gauntlet scripts.
- Auditing the rest of the repo for `[ -d .git ]`. If the sweep is cheap it
  should happen in this PR under the consistency rule
  ([[feedback-consistency-whole-project]]); it is listed here only so that
  finding NO other site is recorded as a measurement rather than assumed.
- The `50-matrix.sh` `cmd_stop` logic itself, which is correct — it never got
  the chance to run.

## Dependencies

- `express-api/scripts/gauntlet/lib.sh` — the single definition site.
- `git worktree`, which the tests use to build a real worktree rather than
  simulate one.

## Risks & Mitigations

- **Risk:** the fix is written as "always pass", removing a guard that catches a
  real misconfiguration. **Mitigation:** four rejection cases, and an explicit
  mutation check that `return 0` reddens them.
- **Risk:** `git rev-parse` succeeds from a path that is inside SOME repository
  but not this one, so the guard passes where it used to fail.
  **Mitigation:** the guard's contract has always been "is this a repo", not
  "is this the RIGHT repo"; the AC does not widen it, and a wrong-repo check
  would be a new requirement with its own evidence.

## Definition of Done

- [x] RED tests written and observed failing before the fix.
- [x] `require_repo` accepts a worktree and still rejects a non-repository.
- [x] The `return 0` mutant proven to redden the rejection cases.
- [x] `50-matrix-cmd-stop.test.js` passes from a worktree AND from the main
      checkout.
- [x] Whole-repo sweep for the same `[ -d .git ]` shape, with the result
      recorded either way.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded.
- [ ] Status → In Review → judgment-merge → deploy develop to dev.

## Notes (running log)

- **2026-08-16 — filed** during SHY-0298, where four tests failed in a worktree
  and passed in the main checkout. Confirmed pre-existing and unrelated to that
  diff before being filed rather than folded in, per the fix-pre-existing rule
  ([[feedback-fix-pre-existing-and-new-same]]): SHY-0298 was already In Review
  with a `Reviewed-up-to:` marker and an open PR.
- The diagnostic that settled it was comparing `ls -ld` on both `.git` paths —
  608-byte directory versus 69-byte file. Worth remembering as the fast check
  whenever a suite passes in one checkout and fails in another.
- **2026-10-18**: Backlog sweep. SHY-0557 (same defect, P0) and SHY-0326
  (the same cause behind the process-reaping suites) are closed as
  duplicates of this story; it takes SHY-0557's P0 and both stories'
  remaining criteria. Estimate 2 → 3 for the added suites.
- **2026-10-22 — fixed on SHY-0645's branch** (PR #2454), where merging
  develop ran the SHY-0304 tests from a worktree and six failed on the old
  check. `require_repo` now asks git for the top level and compares it with
  the physical path (`pwd -P`). The tests live in
  `runner-process-identity.test.js`, block `require_repo asks git…` (eight
  cases), not in a new file.
  - **require_repo mutants**, all killed: always accepts (5 refusal tests
    red, the story's `return 0`), top-level equality dropped, non-empty
    check dropped, the old `.git` directory check (7 red: the worktree case
    plus the six SHY-0304 tests), logical path (`pwd -L`), message without
    the path, message without the `SHYTALK_REPO` hint, `$REPO` unquoted for
    git, and the path evaluated by a shell with the exit still 0 (only the
    `pwned` absence check catches that one).
  - **SHY-0326's requirement**, run on 4b81a531dc4 in a clone (`.git` a
    directory) and this worktree (`.git` a file): both reaping suites 33/33
    in each, alone and at the same time, and every row below killed its
    named test in BOTH checkouts:

    | Mutation                         | Killed by                                                                                                |
    | -------------------------------- | -------------------------------------------------------------------------------------------------------- |
    | predicate's `node` half dropped  | `does not target a reader holding the runner script itself` (new)                                        |
    | bare-name match, like `pgrep -f` | `qa-cleanup-orphans.sh › does not target a process that only NAMES the runner`                           |
    | ancestor exclusion dropped       | `does not target its own ancestors`                                                                      |
    | tree never walked                | `the recorded pid's WHOLE process tree is killed`                                                        |
    | tree gate never opens            | the same                                                                                                 |
    | run-id scoping removed           | `a runner belonging to ANOTHER run does not fail this run's stop` (now checks the other runner is alive) |

    SHY-0326's own table named the wrong guard for three rows. Its first
    run found two real holes: the `node` mutant survived, since every decoy
    named `manual-qa-runner.test.js` and never the script itself; and the
    scope mutant passed its named test while stop killed the other run's
    runner. Both are now tested.

  - Sweep: no other `[ -d … .git ]` shape in the repo.
  - Left: `code-reviewer`, then In Review.
