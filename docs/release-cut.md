# Release cuts into `main` (issue shyden-labs/repo-template#86)

`develop` takes every ticket's branch by squash merge. `main` takes only a
frozen `release/*` cut, by merge commit. That merge commit lands on `main` and
never on `develop`, since `develop` is squash-only. So after the first
release, `main` always holds one commit that `develop` and every later cut
lack.

## Why `main` is not strict

A strict rule ("require branches to be up to date before merging") passes a
pull request only when the base branch's tip is in the head's history. From
the second release on, `main`'s tip is the last release's merge commit, which
no `release/*` cut holds, so a strict `main` would refuse every cut after the first.
Merging `main` back into `develop` each release would fix that, but `develop`
would then hold merge commits, breaking its squash-only rule.

So `scripts/branch-rules-setup.ts` makes `develop` strict and `main` not, and
`main` requires the `release-cut` status in strict's place. Its read-back fails
when `main` is strict, when `main` does not require `release-cut`, when
`develop` is not strict, or when `develop` requires `release-cut` (it is never
posted on pull requests into `develop`, so every merge would wait on it).

## What `release-cut` checks

`.github/workflows/check-release-cut.yml` runs `scripts/release-cut.ts` on
every pull request into `main`. It fetches the pull request's merge ref
(`refs/pull/<n>/merge`) and fails, naming each reason, unless:

- **(a)** the head branch starts with `release/` and names something after
  it, and `origin` holds that branch at the head now (`git ls-remote`, asked
  for `develop` too, so an answer without `develop` fails rather than reading
  as the branch's absence);
- **(b)** the head is an ancestor of `origin/develop`, so CI tested it there;
- **(c)** the merge ref is GitHub's merge of this head into `main` (two
  parents, the second the head), and its tree equals the head's tree, so the
  merge lands exactly what was tested;
- **(d)** every commit in `origin/develop..origin/main` is a two-parent merge
  whose second parent is on `develop`, so `main` never took a direct commit,
  a squash or anything from off `develop`.

The first cut passes with nothing in `origin/develop..origin/main`; each
later cut passes with one release merge per earlier release. The job prints
how many commits it judged. git failing to answer fails the check rather
than reading as a pass: no merge ref (GitHub builds none for a pull request
that conflicts with `main`), or a missing branch.

## Which pull requests it judges (issue shyden-labs/repo-template#103)

It judges only pull requests whose head branch is in this repository. A
fork's pull request posts no status at all: its job fails, naming the fork,
before git or GitHub is asked anything. A commit status belongs to a SHA, not
a pull request, and the latest post wins. A fork can open a pull request whose
head is a commit already on `develop`, the same SHA as a real release's, so
any verdict it posted, a failure as much as a success, would overwrite the
release's. A fork whose repository was deleted has no name and is refused the
same way.

A `release-cut` result can stay green while `main` moves, because `main` is
not strict. That is still safe: `develop` is linear, so (b) puts any two cuts
in order on it, and `main` takes nothing but merges this check passed. A
later cut merged after an earlier one lands its own tree, and an earlier cut
merged after a later one has nothing left to bring.

## Whose code runs (Shyden's rulings of 2026-10-23)

- **Never the pull request's.** The workflow runs on `pull_request_target`,
  which always takes the workflow and the checkout from the repository's
  default branch (GitHub, since 2025-12-08): `main` while it is the default,
  `develop` once it is. Both are protected. The job reads the pull request
  only as git data and runs none of its code. A `pull_request` job would run
  the pull request's own copy, which a pull request could edit to pass.
- **It posts its own status.** The verdict is the `release-cut` commit status
  on the pull request's head: `success`, `failure` naming the first reason,
  or `error` when git could not answer. GitHub's docs do not say whether a
  `pull_request_target` check run counts on the head; a commit status on the
  head does. The job's own check run is named `judge-release-cut`, so it is
  never taken for the status. Its token can write statuses and nothing else.
- **What it cannot stop.** A required check is matched by name unless its
  source app is pinned, so a pull request (a fork's included) can add a job
  named `release-cut` and satisfy it, as it can `build-and-test` and `coverage`
  today. Nothing lands without the operator merging, and the
  operator merges only release pull requests they cut from `release/*`.
  Pinning every required check's source is issue shyden-labs/repo-template#90.

## Applying it

The check runs from the default branch, so it must be there before `main`
requires it, or no status is ever posted and every release waits. In a new
repository the default branch holds it from the start. In repo-template,
while `main` is still the default (until issue shyden-labs/repo-template#46), require `release-cut`
only after the first release carrying shyden-labs/repo-template#86 has reached `main`.

The rules are set by the operator (rulesets need admin rights):

    node scripts/branch-rules-setup.ts <owner/repo> build-and-test coverage

Then read back `rules/branches/develop` (the four checks, strict) and
`rules/branches/main` (the four checks and `release-cut`, not strict).
