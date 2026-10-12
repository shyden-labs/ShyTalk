---
id: SHY-0565
status: Done
owner: claude
created: 2026-10-12
priority: P0
effort: S
estimate: 3
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0565: The secret scan allows the local persona password by exact value, and nothing else

## User Story

As the operator merging develop into a branch, I want the commit-time
secret scan to accept the local emulator persona password where the
offline stack uses it, and refuse every real credential as before, so
that a merge is not blocked by a value that only works on my laptop.

## Why

SHY-0544 (PR #2250) rewrote two lines of `local/seed.js` from a bare
`"localdev123",` argument to the object form with a `password:` key. The
pre-commit scan's pattern matches that form, so every branch that merged
develop afterwards was refused (found merging develop into #2222,
2026-10-12). The lines reached develop unscanned because the worktree they
were committed from had no git hooks at all (SHY-0564). Measured: the
scan's own pattern over every line added to develop in the last 30 days
(21 commits) hits these two lines and nothing else.

Shyden chose (2026-10-12, AskUserQuestion): allow that exact value, only
in files under `local/`, pinned by a test that also proves a real-looking
password is still blocked.

## Acceptance Criteria

### Happy path

- [x] The value is allowed in `local/` files, in object and assignment
      form. Proof: `scan-secrets.test.js`, first two cases; the real hook,
      run in a scratch repo on develop's `local/seed.js`, passes the
      secret section (no banner, no scan failure).
- [x] Every key shape the hook refused before is still refused (Google,
      OpenAI-style, GitHub, AWS, private key, any-case password). Proof:
      the six `test.each` cases.

### Error paths

- [x] The value outside `local/`, through a path climbing out of it, as a
      longer value, or any other password under `local/` is refused.
      Proof: four cases; the real hook blocks the line under
      `express-api/src` with the banner.
- [x] A scan that cannot read its input blocks the commit (exit 2 and any
      other non-zero), never passes. Proof: the header case and the hook
      pin.

### Edge cases

- [x] Removed lines and `+++` headers are not read as added lines; added
      lines are counted across files. Proof: two cases.
- [x] The scanner and its test file pass their own scan, so both can be
      committed where hooks run. Proof: two cases (red on the first
      constant name, found by the scratch-repo hook run).

### Performance

- [x] The 20 tests run in 0.1 s together, in-process, starting no
      process.

### Security

- [x] Exactly one value, compared whole, under one normalised root.
      Proof: 12 mutations each red (any path, no normalise, prefix match,
      any password, a key shape dropped, case-sensitive, lines not
      counted, header not required, removed lines read, hook never runs
      the scan, hook ignores a failed scan, block without exit).

### UX

- [x] Not applicable.

### i18n

- [x] Not applicable.

### Observability

- [x] A clean scan prints how many added lines it read; each finding names
      its file.

## BDD Scenarios

**Scenario: develop is merged into a branch**

- **Given** develop holds the persona password in `local/seed.js`
- **When** a branch merges develop and commits with hooks running
- **Then** the secret scan passes, and the same line under
  `express-api/src` would be refused

## Test Plan

- `express-api/tests/scripts/scan-secrets.test.js` (20 cases); the real
  hook run in a scratch repo for both directions; the mutation table.

## Out of Scope

- Making hooks run in every worktree, and a CI secret scan (SHY-0564).

## Dependencies

- None.

## Risks & Mitigations

- **An allow-list widening over time.** One value, one root, compared
  whole, each pinned by a test and a mutation.

## Definition of Done

- [x] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.
      _Proof: PR #2272 run 38218178774 on `c1d145d4dc7` green by job name; merged as `b7c0d708dc4`. Live: #2222's develop merge commit (`d3636a1d262`) carried `local/seed.js`'s persona lines through the real husky hook and passed; the same merge was refused at 06:11Z before this change._

## Notes

- **2026-10-12**: Found merging develop into #2222. Scored 3: one script,
  one hook block, 20 tests.
