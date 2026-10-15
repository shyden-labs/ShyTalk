---
id: SHY-0610
status: Draft
owner: unassigned
created: 2026-10-16
priority: P0
effort: M
estimate: 8
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0610: Forty-five backend tests have only a comment for a body

## User Story

As **Shyden, the operator**, I want every backend test to be able to fail, so
that a green run means the behaviour it names was checked.

## Why

Found 2026-10-16 while working SHY-0606. A jest test fails only when it
throws, so a test whose body is a comment passes whatever the code does:

```js
test('suggestions-only: can still access app, cannot use suggestions', async () => {
  // Suggestions routes return 403, other routes work
});
```

Measured on develop `5c43f8761cd`: of 14,258 tests in 560 files under
`express-api/tests`, 45 have a body of only comments and blank lines.

| File | Tests |
| --- | --- |
| `routes/suggestions-notifications.test.js` | 20 |
| `routes/admin-audit-log-suggestions.test.js` | 12 |
| `routes/identity-graph-write-lifecycle.test.js` | 6 |
| `routes/identity-graph-write-admin.test.js` | 6 |
| `routes/subscriptions.test.js` | 1 |

The scan matched `test(`/`it(` lines ending in `{` and read to the matching
`});`; a wider net (no `expect`, `assert` or `toThrow` anywhere in the body)
found 66, and the 21 extra were read and assert by throwing or further down.
SHY-0174 fixed the same defect in the web specs; the backend never got the
guard.

## Acceptance Criteria

### Happy path

- [ ] Each of the 45 tests either checks what its name says, RED first
      against a planted defect, or is deleted with the case it named
      written up in Notes as covered elsewhere (test named) or filed.
- [ ] A guard in the guards suite refuses any backend test whose body holds
      no statement, reporting how many tests it read (floored) beside its
      findings.

### Error paths

- [ ] The guard fails closed on a file it cannot parse.

### Edge cases

- [ ] The guard plants each form a test is written in (`test`, `it`,
      `test.each`, async and not, arrow and function) and goes RED on each.

### Performance

- [ ] The guard runs in the guards suite under its measured limit.

### Security

- [ ] N/A.

### UX

- [ ] N/A.

### i18n

- [ ] N/A.

### Observability

- [ ] N/A.

## BDD Scenarios

**Scenario: someone adds a placeholder test**

- **Given** a backend test whose body is only a comment
- **When** the guards suite runs
- **Then** it fails naming the file and line

## Test Plan

1. Rewrite or delete each test; mutate the code each one covers.
2. Plant every test form in a scratch file and watch the guard go RED.

## Out of Scope

- Web specs (SHY-0174, Done).
- Tests that run but assert too little (SHY-0607 and its kin).

## Dependencies

- None blocking.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A rewritten test finds a real bug | File it P0 the same turn; the test stays RED-proven. |

## Definition of Done

- [ ] Every AC ticked; the per-test outcome listed in Notes.
- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-16**: Filed from SHY-0606. Not MVP: test tooling (MVP rule 2026-10-12). Scored 8: 45 tests in 5 files plus one guard.
