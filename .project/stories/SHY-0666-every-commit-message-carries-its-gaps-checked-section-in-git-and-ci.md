---
id: SHY-0666
status: Draft
owner: claude
created: 2026-10-21
priority: P1
effort: M
estimate: 5
type: chore
roadmap_ids: []
mvp: true
---

# SHY-0666: Every commit message carries its gaps-checked section, in git and in CI

## User Story

As the operator, I want every commit that lands in ShyTalk to say what its
author checked before and after (the no-holes rule), checked by git and by
CI, so that a commit made inside a script or with hooks skipped cannot land
without it.

## Why

Shyden, 2026-10-21 (global, `~/.claude/global-rules/no-holes-check-before-and-after.md`,
standing task per repo): "Git hook in each repo", then "Git hook + CI check".
The Claude hook `gaps-checked-in-commits.py` cannot see a commit made inside a
script, and `git commit --no-verify` skips git hooks; only a git hook plus a
CI check reading every commit closes both. ShyTalk's husky setup has
`pre-commit` and `pre-push` and no `commit-msg` hook (read 2026-10-21).

## Acceptance Criteria

### Happy path

- [ ] A husky `commit-msg` hook refuses a commit whose message lacks the
      section: `Gaps checked:` then `- Before:` and `- After:`, each at least
      20 characters and 3 real words, and `- New passes:` not empty; a commit
      touching only `.md` files is exempt.
- [ ] A required PR check reads every commit's message in the PR and fails
      naming each one that lacks the section (a commit whose own file list is
      only `.md` files is exempt).

### Error paths

- [ ] A message the check cannot read, or a PR whose commits it cannot list,
      fails the check (fails closed).

### Edge cases

- [ ] A merge commit and a squash commit are judged like any other.
- [ ] Placeholder text (`TBD`, `n/a`, three repeated words) does not count as
      real words.

### Performance

- [ ] The CI check's measured time is its limit.

### Security

- [ ] The CI check is required (through PR Gate, as SHY-0657, unless Shyden
      chooses its own ruleset context, which needs his clicks) and read back.

### UX

- [x] Not applicable: developer tooling.

### i18n

- [x] Not applicable: no copy.

### Observability

- [ ] The CI check's summary lists every commit it read and its verdict.

## Announce

None: an internal check with no change users can see.

## BDD Scenarios

**Scenario: a commit without the section**

- **Given** a commit whose message has no `Gaps checked:` section
- **When** git runs the commit-msg hook, or CI reads the PR's commits
- **Then** the commit is refused, or the check fails naming it

## Test Plan

- One test per case for the shared message rule (each field missing, too
  short, placeholder words, .md-only exemption, merge commits); planted
  mutations of each rule seen red; the CI check run on a planted PR.

## Out of Scope

- The Claude-side hook (global, already live).

## Dependencies

- None to build. Requiring the check as its own ruleset context, if Shyden
  wants that, is his click.

## Risks & Mitigations

- Dependabot and bot commits: the check names them; whether they are exempt
  is Shyden's call, asked before building.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; the check required and read back.

## Notes

- **2026-10-21**: filed from the global standing task relayed by the
  steadyhand session and read at its source. Model: steadyhand #378 (not read
  from ShyTalk). P1: enforcement of a global rule, not a live defect. Scored
  5: a shared message rule with its cases, a husky hook, a CI job reading PR
  commits, required through PR Gate.
