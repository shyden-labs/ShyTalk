---
id: SHY-0582
status: Draft
owner: claude
created: 2026-10-12
priority: P1
effort: L
estimate: 8
type: chore
roadmap_ids: []
mvp: true
epic: EPIC-0002
---

# SHY-0582: Roadmap batch: the 22 "Website & Presence" entries become tracked stories

## User Story

As **Shyden, the operator**, I want every hand-written entry in the public
roadmap's "Website & Presence" phase turned into a tracked story, so that the public page
and the backlog are one system and cannot drift apart.

## Why

SHY-0062 tracked the whole migration of the legacy `phases[].features[]`
entries as one story, far over the 13-point ceiling. On 2026-10-12 Shyden chose
to split it into one story per phase ("Split into 8", AskUserQuestion), so each
batch carries its own score and the "by effort" progress line can be computed.

Measured on `origin/develop` `public/roadmap-data.json`, 2026-10-12: the phase
holds **22** entries (2 done, 20 planned):

Shared header component · Homepage redesign · Slogan rebrand · Website About section · Website support section · Khmer New Year event page i18n cleanup · Portal CSS/i18n unification · Roadmap page redesign · Roadmap page features · Web personal profile · Shyden Ltd company website · Website interactive demo · Admin role-based access control · Admin auth-management UI · MC Host dedicated panel · MC Host Team Leader panel · MC Singer dedicated panel · MC Singer Team Leader panel · Teacher dedicated panel · Unified web portal · Website public roadmap · Web page i18n completion

Slogan (SHY-0364), locale routing (SHY-0285 to SHY-0289), the portal move (SHY-0505 to SHY-0511) and the roadmap pages (SHY-0360) overlap; absorb them.

## Acceptance Criteria

### Happy path

- [ ] Every one of the 22 entries exists as a story with `public: true` and its
      `phase:` set, written to the full template (all ten sections, all eight AC
      dimensions), or is absorbed into an existing story that gains those fields.
- [ ] The conversion conventions in SHY-0062 hold: `done` becomes `Done` with
      `released_in: pre-rule` and the "migrated historic feature" Notes line;
      `in-progress` becomes `In Progress`; `planned` becomes `Draft`.
- [ ] Every new or absorbed story carries an `estimate:` from 1, 2, 3, 5, 8, 13.
- [ ] The phase's `features[]` array is empty after the sync regenerates
      `roadmap-data.json`, and its entries render as story-derived items.
- [ ] EPIC-0002's `child_shys` lists every story this batch files.
- [ ] "Shyden Ltd company website" is not migrated under that name: Shyden Ltd is
      dissolved and the company site is another project (shyden.co.uk). The entry is
      either dropped from the ShyTalk roadmap or renamed for Shyden Labs, and Shyden
      decides which.

### Error paths

- [ ] An entry whose meaning cannot be recovered from its name and description
      is not guessed at: it is listed in Notes and raised with Shyden.
- [ ] A sync that fails on a new story fails the PR, naming the file.

### Edge cases

- [ ] An entry that duplicates an existing story is absorbed, never filed twice;
      Notes record each absorption.
- [ ] An entry that no longer fits the mission (dating-adjacent, or overtaken by a
      later decision) is raised with Shyden rather than migrated as written.

### Performance

- [ ] No change to page weight beyond the items themselves: the parity test's
      entry count is unchanged across the merge.

### Security

- [ ] Stories are English-only and carry no personal data or secrets.

### UX

- [ ] A visitor sees the same number of roadmap entries before and after the
      merge, now with story badges and links.

### i18n

- [ ] Item titles reach other languages through the lazy translation service
      (SHY-0072, SHY-0073); no story text is hand-translated here.

### Observability

- [ ] Notes record, per entry: new story id or absorbing story id, and status.

## BDD Scenarios

**Scenario: the batch lands in one merge**

- **Given** the "Website & Presence" phase holds 22 hand-written entries
- **When** this batch's PR merges and the sync regenerates the roadmap data
- **Then** the phase shows 22 story-derived items and no hand-written entry
- **And** the page's total visible entry count is unchanged

**Scenario: a duplicate is absorbed**

- **Given** an entry matches a story that already exists
- **When** the batch is written
- **Then** the existing story gains the public and phase fields and no new file is added

## Test Plan

- `scripts/check-story-frontmatter.sh --scan` and `scripts/check-epic-frontmatter.sh --scan` green.
- The entry-count parity Playwright check against the real rendered page (SHY-0062 Test Plan).
- A one-off count recorded in Notes: entries in the phase before, stories after, absorptions.

## Out of Scope

- Building any of the features: this batch writes their stories only.
- Retiring the `features[]` schema (after all eight batches, per SHY-0062).

## Dependencies

- SHY-0072 and SHY-0073 (Done).
- SHY-0575 first: it ships the parity check every later batch runs.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Twenty-two stories is the largest batch | Split in two if review quality demands, telling Shyden first (SHY-0062 rule) |
| A fully written story drifts before anyone picks it up | The pickup-fitness review re-proves each story at pickup |

## Definition of Done

- [ ] Every AC above is met; the scans and the parity check are green in CI.
- [ ] Merged into `develop`; the dev roadmap shows the batch as story items.

## Notes

- **2026-10-12**: Filed by the SHY-0062 split (Shyden, "Split into 8"). Scored
  8 from the phase's size and status mix: 2 done, 20 planned. Score set during the
  SHY-0536 scoring pass, not against a merged batch: none exists yet.
