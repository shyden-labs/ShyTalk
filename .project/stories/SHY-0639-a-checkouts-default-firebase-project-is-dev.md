---
id: SHY-0639
status: Draft
owner: claude
created: 2026-10-18
priority: P0
effort: XS
estimate: 1
type: bug
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0639: A checkout's default Firebase project is dev, never production

## User Story

As the operator typing a Firebase command in a ShyTalk checkout, I want a
command that names no project to reach dev, so that a slip never changes
production.

## Why

Found on 2026-10-18 while gating the Firebase tools (Shyden: *"you shouldn't
have prod access without my explicit approval"*): `.firebaserc` sets
`"default": "shytalk-7ba69"`, the production project, so a bare
`firebase deploy` or `firebase firestore:delete` from any checkout targets
production. Agents are now refused by the global hook
`~/.claude/hooks/firebase-needs-consent.py`; a person is not. Measured: no CI
workflow or script on `develop` runs a non-emulator firebase CLI command (3
calls, all `emulators:*`), so nothing automated relies on the default.

## Acceptance Criteria

### Happy path

- [ ] `.firebaserc` sets `default` to `shytalk-dev` and names production only
      under an explicit alias (`prod`), so reaching it takes `-P prod`.

### Error paths

- [ ] A test pins `.firebaserc`: the default is `shytalk-dev`, and fails on a
      planted production default.

### Edge cases

- [ ] The emulator scripts (`local/`) still start with the new default.

### Performance

- [ ] Not applicable.

### Security

- [ ] The pin above is the control; mutation-verified.

### UX

- [ ] Not applicable: no app changes.

### i18n

- [ ] Not applicable.

### Observability

- [ ] Not applicable: nothing scheduled changes.

## Announce

Nothing: developer tooling with no learner-facing change.

## BDD Scenarios

**Scenario: a bare command reaches dev**

- **Given** a fresh ShyTalk checkout
- **When** someone runs a firebase command naming no project
- **Then** it acts on `shytalk-dev`

## Test Plan

- Unit pin of `.firebaserc` with a planted mutant.

## Out of Scope

- The agent-side gate (global hook, done 2026-10-18).

## Dependencies

- None.

## Risks & Mitigations

- Shyden may run production commands by hand that relied on the default:
  they now need `-P prod`, which is the point.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-18**: P0 by the standing rule (a path to production without
  approval); not MVP (tooling). Scored 1: one config line and one pin.
