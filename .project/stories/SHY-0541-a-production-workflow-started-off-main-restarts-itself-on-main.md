---
id: SHY-0541
status: Draft
owner: claude
created: 2026-10-07
priority: P0
effort: M
estimate: 5
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0541: A production workflow started off main restarts itself on main

## User Story

As the operator, when I start a production workflow by hand and leave the
branch picker on its default, I want the run to restart itself on `main`, so
that only released workflow steps and tooling ever act on production.

## Why

`develop` became the default branch on 2026-10-07 (SHY-0540). A hand-started
run (the Run workflow button, or `gh workflow run` without `--ref`) uses the
workflow file of the branch picked, and the picker starts on the default
branch. Three hand-started workflows act on production:

- `deploy-prod.yml`: its steps, and on purpose its smoke tooling (line 785:
  "the default checkout ref = the dispatched branch, main"), come from the
  dispatched branch. The app it ships is still the validated release ref.
- `rollback.yml`: re-promotes a live Cloudflare Pages deployment.
- `release.yml`: writes the release commit straight to `main` through the
  Release App, which bypasses main's pull-request rule (ruleset 12613584).

Started on `develop`, each runs unreleased steps against production. GitHub
has no per-workflow default branch, so the workflow has to correct it.
Operator decision (2026-10-07, AskUserQuestion): **restart itself on main**
rather than refuse. A side agent raised the gap.

## Acceptance Criteria

### Happy path

- [ ] Each of the three workflows gains a first job that, when `github.ref` is
      not `refs/heads/main`, starts the same workflow on `main` with every
      input forwarded unchanged (`gh workflow run <file> --ref main -f …`,
      using the run's `GITHUB_TOKEN` with `actions: write` on that job only),
      writes the new run's link to the step summary, and does nothing else.
- [ ] Every other job in those workflows runs only when `github.ref` is
      `refs/heads/main` (directly or through `needs:` on the first job), so a
      run started off `main` performs no other step.
- [ ] Started from `main`, each workflow behaves exactly as today (the first
      job is a no-op that succeeds).
- [ ] Shyden sets the `production` environment's deployment branches to
      `main` only; read back, with its required reviewer still present.

### Error paths

- [ ] If the restart cannot be started (no permission, API error), the run
      fails red naming the cause, and starts nothing else. No retry.

### Edge cases

- [ ] A workflow input added later is forwarded too: the test derives the
      inputs from each file's `workflow_dispatch.inputs` block, never from a
      list in the test.
- [ ] Boolean and choice inputs arrive on the new run with the same values
      (proved live, see Test Plan).
- [ ] The restarted run on `main` does not restart again (no loop).

### Performance

- [ ] The restart adds under 30 s before the real run starts (measured).

### Security

- [ ] `actions: write` is granted to the restart job alone; the workflow's
      other permissions are unchanged.
- [ ] A backend test, reading each workflow with comments stripped, refuses
      any of the three without the restart job or with any other job not
      gated to `main`. It records how many workflows and jobs it read against
      ratcheted floors, and a planted violation per form goes red (job not
      gated, an input not forwarded, the restart job removed, the restart job
      commented out, `--ref develop`, the gate written for `develop`).
- [ ] The test also refuses a NEW hand-startable workflow that names a
      production host or production secret without the restart job, counted
      against its own floor.

### UX

- [ ] The develop-started run's summary reads, in one line, that it restarted
      on `main` and links the new run.

### i18n

- [ ] Not applicable: CI tooling, English only.

### Observability

- [ ] The new run on `main` shows who started the original (the triggering
      actor is the bot; the summary names the original actor).

## BDD Scenarios

**Scenario: A deploy started on develop restarts on main**

- **Given** Deploy To Prod is started on `develop` with web only
- **When** its first job runs
- **Then** the same workflow starts on `main` with web only
- **And** no other job of the develop run executes

**Scenario: A deploy started on main runs as today**

- **Given** Deploy To Prod is started on `main`
- **When** it runs
- **Then** the first job does nothing and the deploy proceeds to approval

**Scenario: A copy without the restart job is refused**

- **Given** `rollback.yml` with its restart job removed
- **When** the backend tests run
- **Then** the test fails naming `rollback.yml`

## Test Plan

- Unit: the workflow test above, with each planted form predicted and run.
- Live: start each workflow on `develop` with non-default inputs, using a
  harmless path (deploy-prod with every platform off and an approval left
  waiting then rejected; rollback and release in a dry form agreed with
  Shyden before running), and read the new run's inputs back.

## Out of Scope

- Moving production credentials into gated environments (SHY-0542).
- The nightly jobs (SHY-0540).

## Dependencies

- SHY-0540 (the default-branch switch, already done by Shyden).
- Shyden: the `production` environment's branch policy.

## Risks & Mitigations

- **GitHub's built-in token may not start the run.** GitHub's docs exempt
  `workflow_dispatch` from the rule that the token's events start no runs;
  proved live before anything relies on it. If it fails, ask Shyden before
  choosing another route.
- **A live release by accident during the proof.** Mitigation: the live
  proofs are agreed with Shyden step by step first.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; the three files reach `main` at the next release, and one
      live develop-start is read after that.

## Notes

- **2026-10-07**: Filed from a side agent's note, which Shyden asked to be
  guarded, with the workflow choosing main itself. Shyden chose "Restart
  itself on main" over "Refuse within seconds".
- Scored 5 against SHY-0540 (5): the same shape (workflow edits, one guard
  test with floors, one operator setting), over three workflows.
