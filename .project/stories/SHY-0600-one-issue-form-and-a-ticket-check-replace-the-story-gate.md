---
id: SHY-0600
status: Draft
owner: unassigned
created: 2026-10-15
priority: P1
effort: M
estimate: 5
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0600: One issue form and a ticket check replace the story gate

## User Story

As **Shyden, the operator**, I want a new ticket to be filed through one
issue form with every section a story has, and checked the way the story gate
checks a story file, so that no ticket is born half-written once story files
stop.

## Why

Shyden ruled 2026-10-15: one shared issue form, the same in every project and
in repo-template (global note `pending-tickets-are-issues.md`).

- Today `scripts/check-story-frontmatter.sh` (534 lines) refuses a story file
  missing a field or section; it runs on story files only.
- Yawelo's form `.github/ISSUE_TEMPLATE/story.yml` has Story, Context,
  Acceptance criteria, Website and Definition of done: lighter than a ShyTalk
  story, which also has Why, AC sub-sections, BDD Scenarios, Test Plan, Out of
  Scope, Dependencies, Risks & Mitigations and Notes.

## Acceptance Criteria

### Happy path

- [ ] `.github/ISSUE_TEMPLATE/ticket.yml` has every section of a ShyTalk
      story (User Story, Why, AC with Happy path, Error paths, Edge cases,
      Performance, Security, UX, i18n, Observability, BDD Scenarios, Test
      Plan, Out of Scope, Dependencies, Risks & Mitigations, Definition of
      Done, Notes), required where the gate requires them today.
- [ ] Blank issues are turned off (`config.yml`), so every ticket uses it.
- [ ] A ticket check reads every open issue on the board and fails, naming
      the issue and what is missing, when a section, `Priority` or `Estimate`
      is absent; it runs in CI on a schedule and on demand.
- [ ] The form's text is handed to the repo-template session for the shared
      standard (a note in the global file, not a change in that repo).

### Error paths

- [ ] An issue missing a section turns the check red with its number and the
      section name.

### Edge cases

- [ ] Issues that are not tickets (user bug reports without the `story`
      label) are left out and counted as left out.

### Performance

- [ ] One paged board read per run.

### Security

- [ ] The check reads with the App's read permissions only.

### UX

- [ ] The form's field hints say what each section is for, in one line each.

### i18n

- [ ] N/A: operator tooling.

### Observability

- [ ] A failing scheduled check opens or updates one issue assigned to
      ShydenMcM, per the "nothing stops silently" rule.

## BDD Scenarios

**Scenario: a ticket is filed without ACs**

- **Given** an open issue on the board with no Acceptance Criteria section
- **When** the ticket check runs
- **Then** it fails, naming that issue and the missing section

## Test Plan

1. Unit: the section and field parser over fixture issue bodies, one test per
   section; the GitHub client mocked.
2. Floor: the count of issues checked is recorded and asserted, so an empty
   read cannot pass.
3. Plant a missing section in a fixture and watch the check go red.

## Out of Scope

- Retiring the story gate (SHY-0603).

## Dependencies

- None blocking.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Old issues fail the new check | The check runs over SHY-0601's verified bodies; any gap found is fixed on the issue, not waived. |

## Definition of Done

- [ ] A real ticket filed through the form passes the check; its number in
      Notes.
- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-15**: Filed from Shyden's ruling. Estimate 5: a form plus a
  checker with a floor, sized against the story gate it replaces.
