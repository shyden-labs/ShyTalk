---
id: SHY-0632
status: Draft
owner: claude
created: 2026-10-18
priority: P0
effort: M
estimate: 5
type: infra
roadmap_ids: []
mvp: true
epic: EPIC-0001
---

# SHY-0632: Every translation is read back by Google Cloud Translation on the shared key, within its daily ledger

## User Story

As the operator shipping text in five languages to a community that
includes minors, I want every translated line read back into English by
Google Cloud Translation before it is shown or committed, on the one shared
key and inside its daily character budget, so that a wrong translation is
caught before a reader meets it and the free quota is never overrun.

## Why

Found on 2026-10-18 while planning SHY-0614's privacy line, read at
`3979758`:

- The global rule (Shyden, 2026-10-07 and 2026-10-14, _"EVERYTHING"_): every
  translation is read back by Google Cloud Translation before it is shown or
  committed, never by its writer.
- ShyTalk's only Google client, `scripts/lib/google-translate.js`, calls
  Google's unauthenticated web endpoint (its own comment: "no API key, no
  quota dashboard"), not Cloud Translation, and has no read-back mode.
- Every client of the shared key (`~/.config/shyden/google-translate.env`)
  must count the characters it sends per Google day (midnight Pacific) in
  `~/.config/shyden/google-translate-ledger.json` (`{"YYYY-MM-DD": chars}`,
  shared by every project), never send a request that would cross 16,000,
  and mark the day spent on a quota refusal (measured 2026-10-15: Google
  refuses only the request AFTER the one that crosses 16,000). ShyTalk has no
  such client.
- Measured elsewhere and recorded in the global rule: text with `{slots}`
  sent as plain text comes back with invented numbers in the holes; send
  HTML with each slot in `<span translate="no">` and decode the entities.

Without it, SHY-0614's privacy line (and every later translation) cannot
meet the rule.

## Acceptance Criteria

### Happy path

- [ ] One ShyTalk client calls Google Cloud Translation with the shared key,
      for writing (English to a locale) and for reading back (a locale to
      English).
- [ ] A read-back run prints, per line, the locale, the key, the writer, the
      reader, the English source and the English read-back, as the table a
      PR carries.
- [ ] Every character sent is counted in the shared ledger for its Google
      day before the request goes.

### Error paths

- [ ] A request that would take the day past 16,000 characters is not sent;
      the run stops naming the characters left and the day it resets.
- [ ] A quota refusal from Google marks the day spent in the ledger and
      stops the run, never retried.
- [ ] A missing or empty key file fails fast naming the file.
- [ ] A ledger file that cannot be parsed fails closed (nothing sent).

### Edge cases

- [ ] Placeholders (`{name}`, `%1$s`, `%d`) survive both directions intact,
      sent as `<span translate="no">`, and a changed placeholder fails the
      line.
- [ ] The Google day rolls at midnight Pacific, daylight saving included.

### Performance

- [ ] One request per batch of lines, not per line, within Google's request
      size limit.

### Security

- [ ] The key is read from the file and never printed, logged or committed;
      a test plants the key value and finds it in no output.

### UX

- [ ] Not applicable: an operator tool.

### i18n

- [ ] SHY-0614's privacy line is its first use, in id, th, vi and zh.

### Observability

- [ ] Each run prints the characters it sent and the day's total after it.

## BDD Scenarios

**Scenario: a line is read back before commit**

- **Given** the Indonesian privacy line written by Google
- **When** the read-back runs
- **Then** the table shows the English source beside Google's English
  reading of the Indonesian

**Scenario: the budget is never crossed**

- **Given** the ledger shows 15,900 characters for today
- **When** a run would send 200
- **Then** nothing is sent and the run says 100 characters are left

## Test Plan

- Unit tests in-process, with the HTTP call and the clock stood in (unit
  rules: no socket, no process): ledger arithmetic, day roll, placeholder
  protection, refusal handling, key never printed.
- One live run against Google for SHY-0614's line, recorded in that PR.

## Out of Scope

- Moving the existing writers (`translate-strings.js`,
  `translate-admin-strings.js`) off the web endpoint; this story adds the
  read-back every translation needs.
- The shared testing library that will hold one client for every project
  (global rule, built after the shyden.co.uk release).

## Dependencies

- None blocking.

## Risks & Mitigations

- Two projects spend the same day's budget at once: each re-reads the
  ledger immediately before every request and writes it straight after.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-18**: Found planning SHY-0614. P0: the read-back is a standing
  rule ShyTalk cannot meet today. MVP: launch text in five languages relies
  on it. Scored 5: one client with a ledger, two directions, placeholder
  protection and unit tests; larger than SHY-0631 (3).
