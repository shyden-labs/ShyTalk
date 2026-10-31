# ShyTalk

## Mission

- ShyTalk is Shyden Labs' flagship social platform: a friendly, welcoming place to learn languages and cultures by talking. It is strictly about educational and cultural exchange, never dating.
- Moderation and atmosphere: strict community rules keep it a wholesome, supportive and pleasant learning space.
- Never lose sight of the language and culture mission when writing tickets, designing the server, designing screens and flows, or setting moderation rules.

## Hard guardrail: ShyTalk is not a dating app

- Watch for anything that could make ShyTalk read, feel or work like a dating app: tickets, roadmap entries, server models, screens and flows, copy, translations, moderation rules, marketing and analytics.
- Never propose it under any name: no romantic-pairing features, including paid relationship tiers, partner or couple bonds, matchmaking, "CP" pairings, soulmate or marriage mechanics, and seat-pairing built around romance, even when renamed to sound neutral.
- Raise it, do not quietly build it: if a requested feature could be read as dating-adjacent, say so before building it and let Shyden decide.
- Why: members include minors, which is why age segregation exists. Dating framing contradicts the mission and creates moderation, safeguarding and compliance risk.
- Precedent: the old app's "Relationships" feature (paid friend, partner and family tiers) was removed for this reason (SHY-0359 in shyden-labs/ShyTalk-legacy, Shyden's decision 2026-08-19, reaffirmed 2026-08-20). "Language partner" is legitimate language-exchange vocabulary; romantic pairing is not.

## App identifiers (carried over from the store apps)

- Android application id and iOS bundle id: `com.shyden.shytalk`. The store listings already use these ids; never change them.
- Android `versionCode` must be above 178.

## Working here

- One branch per ticket, named `<type>/<issue>-<slug>` (for example `feat/12-sign-in`), from a fresh `origin/develop`, squash-merged once CI is green.
- Commit and pull request texts cite issues as `Refs #N`.
- This Mac runs unit tests, typecheck, lint and format only; every other suite runs in CI through a pull request.
- A pull request changing only Markdown, or non-code files under `docs/`, takes CI's docs-only fast path: keep docs changes in their own one-commit pull request.

## Board

To be filled in once the board exists.
