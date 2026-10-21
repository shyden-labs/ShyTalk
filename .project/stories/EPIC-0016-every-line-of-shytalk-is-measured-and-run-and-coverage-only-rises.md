---
id: EPIC-0016
status: Draft
owner: claude
created: 2026-10-21
priority: P0
title: every line of ShyTalk is measured and run, and coverage only rises
child_shys: [SHY-0674, SHY-0676, SHY-0677, SHY-0678, SHY-0679, SHY-0680, SHY-0681, SHY-0682, SHY-0683, SHY-0684]
---

# EPIC-0016: every line of ShyTalk is measured and run, and coverage only rises

## Vision

Every kind of code in ShyTalk is measured by a coverage tool, every changed
line and branch is run by a test, and the whole-repo figure only rises, to
100% (Shyden, 2026-10-21, global ruling "Ratchet to 100%, unmeasured fails
now": *"the percentage i pick is 100%"*; *"we are not moving forward until
every project is fixed"*).

## Scope

For ShyTalk, Shyden chose the whole repo (2026-10-21, "Whole repo
(Recommended)") and that the group-roles hotfix waits behind this epic
("Waits behind coverage"). Measured that day: only express-api (Jest lcov)
and Android's app (JaCoCo) are measured.

Order: SHY-0674 (the gate, on today's tools) first; then each kind's story,
each blocked only by SHY-0674. A PR that changes an unmeasured kind fails the
gate until that kind's story lands.

## Child SHYs

- SHY-0674: a pull request fails on any changed line or branch that no test runs (P0, 8)
- SHY-0676: express-api and Node code run in child processes is measured (P0, 5)
- SHY-0677: browser JavaScript in public/ is measured (P0, 5)
- SHY-0678: Cloudflare Pages Functions are measured in workerd (P0, 3)
- SHY-0679: the shared Kotlin module is measured with JaCoCo (P0, 5)
- SHY-0680: Kotlin/Native iOS code is measured, or Shyden decides with the evidence (P0, 8)
- SHY-0681: Swift in iosApp is measured with Xcode coverage (P0, 5)
- SHY-0682: shell scripts are measured (P0, 5)
- SHY-0683: the Firestore and Realtime Database rules are measured (P0, 5)
- SHY-0684: the Python estimate tools are measured (P0, 3)

52 points.

## DoD at Epic Level

- [ ] Every child SHY Done.
- [ ] SHY-0674's classification lists no code file as unmeasured, or Shyden
      has decided each one left (Kotlin/Native).
- [ ] The whole-repo figure file is recorded and the gate is required.

## Notes

- **2026-10-21**: filed from the global ruling; SHY-0674 moved here from
  EPIC-0015. The hotfix stories (SHY-0647, 0648, 0652, 0653, 0656) are
  blocked by every story here.
