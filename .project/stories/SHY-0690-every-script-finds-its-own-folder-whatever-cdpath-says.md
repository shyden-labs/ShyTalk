---
id: SHY-0690
status: Draft
owner: claude
created: 2026-10-22
priority: P0
effort: S
estimate: 3
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0690: every script finds its own folder, whatever CDPATH says

## User Story

As a **developer running the repo's scripts from any shell**, I want each
script to find its own folder the same way every time, so that an exported
`CDPATH` can never send it to another folder.

## Why

Found 2026-10-22 in SHY-0302's review. The idiom
`HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"` runs `cd` on a
relative path whenever a script is started by a relative path. `cd` searches
an exported `CDPATH` first, and when it finds the folder there it also
PRINTS it. Measured in `express-api/scripts/gauntlet/lib.sh` before its fix:
with a decoy folder on `CDPATH`, `REPO` came out as the decoy's path twice,
on two lines. Every later step would then run in, or write to, the wrong
place.

SHY-0302 fixed `lib.sh` (`CDPATH='' cd --`, and an absolute `REPO`). The
same idiom remains at 24 sites, one in each of 24 files, measured with
`git grep -F 'cd "$(dirname'` over `*.sh`, `.husky/*` and `.github/*` on
2026-10-22. Among them are `scripts/sync-stories-to-issues.sh`,
`scripts/backup-r2.sh`, `scripts/ios/build-debug-dev.sh` and `local/test.sh`.

## Acceptance Criteria

### Happy path

- [ ] Every script that finds its own folder does so without consulting
      `CDPATH` (`CDPATH='' cd --`, or an equivalent that never searches it),
      at all 24 sites and any added since.
- [ ] A runtime test starts a real script from this set by a relative path,
      with a decoy folder on an exported `CDPATH`, and shows it uses its own
      folder. It is red on today's code.

### Error paths

- [ ] A guard fails on any shell `cd` into a `dirname`-built path that does
      not clear `CDPATH`, naming the file and line.

### Edge cases

- [ ] The guard reads the comment-stripped text, so a commented-out old
      line neither passes nor fails a file.
- [ ] The guard sees every spelling the repo uses: `$(dirname "$0")`,
      `${BASH_SOURCE[0]}`, single and double quotes, and `cd` after `&&`.
      Each spelling is planted and watched go red.

### Performance

- [ ] The guard runs in the guards suite, within its measured limit.

### Security

- [ ] Not applicable beyond the defect itself: no new input is read.

### UX

- [x] Not applicable: developer tooling.

### i18n

- [x] Not applicable: no copy.

### Observability

- [ ] The guard's verdict carries the number of files it read, checked
      against a recorded floor, so a scope that silently shrinks fails.

## Announce

None: developer tooling.

## BDD Scenarios

**Scenario: a script started by a relative path under an exported CDPATH**

- **Given** a decoy folder of the same name on `CDPATH`
- **When** a script is started by a relative path
- **Then** it works in its own folder, and prints nothing extra

## Test Plan

RED first: the runtime test on one real script (the sync script is a good
choice: it already has a test harness). Then the guard, planted with each
spelling, its floor recorded, and each mutant watched red.

## Out of Scope

- `lib.sh`, fixed by SHY-0302.

## Dependencies

- None.

## Risks & Mitigations

- **Risk:** a guard written for one spelling misses another. **Mitigation:**
  the Edge-cases AC plants every spelling.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-22**: filed from SHY-0302's review. P0 because it is a defect.
  Scored 3: 24 one-line edits, one runtime test, and one floored guard with
  planted spellings.
