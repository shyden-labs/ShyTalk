---
id: SHY-0569
status: Done
owner: claude
created: 2026-10-12
priority: P0
effort: M
estimate: 5
type: bug
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0569: Dependabot auto-merge checks the real update, not only Dependabot's metadata

## User Story

As the operator who lets Dependabot merge patch and minor updates alone, I
want auto-merge to check the versions a PR really moves, and to switch
itself off whenever it cannot be sure, so that a major update never merges
without a person.

## Why

Measured 2026-10-12 on PR #2190: its head commit `b0cf68179` says "Bump
firebase from 12.18.0 to 13.0.0" in its title and body, and its diff moves
`"firebase": "^12.18.0"` to `"^13.0.0"`, but the commit's metadata block
still says `dependency-version: 12.19.0`, `update-type:
version-update:semver-minor`. `dependabot/fetch-metadata` reads that block,
so `dependabot-auto-merge.yml` judged a major update to be minor (run
38212640523), approved it and armed `gh pr merge --auto`; it merged at
06:36Z and broke the root install (SHY-0568). The workflow also never turns
auto-merge off: a push judged unsafe leaves an earlier arming in place. At
the time of filing 9 open Dependabot PRs were armed, all minor by title.

## Acceptance Criteria

### Happy path

- [x] Auto-merge is armed only when every "from A to B" version pair in the
      PR title and body is a patch or minor change AND the metadata's
      update type is patch or minor (GitHub Actions keep their SHA-pinned
      exception).
      _Proof: `scripts/dependabot-update-type.js`; `dependabot-update-type.test.js` (19) cases for minor, patch, grouped, date-shaped, v-prefixed and the Actions exception; mutations "pairs never judged" (3 red) and "metadata type not checked" (2 red)._
- [x] On every other outcome the workflow switches auto-merge off for that
      PR and prints why.
      _Proof: step "Switch auto-merge off" (`always() && merge != 'true'`, `gh pr merge --disable-auto` when armed), pinned; mutation "disarm step removed" red. The judge prints its pairs, the metadata and the verdict._

### Error paths

- [x] Metadata that cannot be read, a PR naming no version pair, or a
      version it cannot parse leaves auto-merge off.
      _Proof: three cases; metadata step `continue-on-error` (pinned; mutation red); mutations "no pair allowed" and "unreadable version skipped" each red._

### Edge cases

- [x] #2190's exact title, body and metadata are refused.
      _Proof: a case with its title and body and `semver-minor`; on the real PR the judge says "firebase 12.18.0 -> 13.0.0 is a major change"._
- [x] A 0.x change in the second number counts as major.
      _Proof: case `0.35.4 -> 0.36.0`; mutation "0.x minor not major" red._
- [x] A grouped PR is judged on every pair it lists.
      _Proof: grouped allow and grouped refuse cases._

### Performance

- [x] Not applicable.

### Security

- [x] The judging script runs from the base branch, never from the PR's own
      code; permissions do not grow.
      _Proof: checkout `ref: base.sha`, `persist-credentials: false`, pinned (mutation "judge reads PR code" red); `permissions` unchanged (`contents: write`, `pull-requests: write`); title and body reach the script through `env` only. actionlint clean._

### UX

- [x] Not applicable.

### i18n

- [x] Not applicable.

### Observability

- [x] Each decision prints the pairs it read, the metadata type and the
      verdict.
      _Proof: `main()` prints `metadata:`, each `pair:` and `auto-merge: yes|no (reason)`. On the 9 PRs armed at filing, the judge reads all as minor and allows them (one showed no metadata line in its local commit message; in CI the type comes from fetch-metadata)._

## BDD Scenarios

**Scenario: metadata says minor, the PR says major**

- **Given** a Dependabot PR whose metadata says semver-minor
- **When** its title says "from 12.18.0 to 13.0.0"
- **Then** auto-merge is switched off and the PR waits for a person

## Test Plan

- Unit tests of the judging script, one per case; a pin of the workflow
  steps; the open armed PRs re-judged after merge.

## Out of Scope

- A PR job that installs the root packages (SHY-0571).

## Dependencies

- None.

## Risks & Mitigations

- **Safe updates stop merging alone.** Patch and minor still merge when the
  title, body and metadata agree; only a disagreement or an unreadable PR
  waits for a person.

## Definition of Done

- [x] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.
      _Proof: PR #2305 run 38236638623 on `38c4c811ae2` green by job name (an earlier run went red on a retired test; fixed and re-run); merged as `21cc257e759`._

## Notes

- **2026-10-12**: Shyden: "this needs to be fixed". Scored 5: a script with
  its tests, the workflow change and its pin, and the re-judging of the
  armed PRs.
