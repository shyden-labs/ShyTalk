---
id: SHY-0544
status: In Progress
owner: claude
created: 2026-10-07
priority: P0
effort: L
estimate: 8
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0544: Local and CI storage runs on a maintained S3 stand-in, not MinIO

## User Story

As a developer, I want the local stack and CI to start an S3 stand-in that
can still be pulled, so that backend tests run on every branch again and a
vendor withdrawing its image cannot stop all work.

## Why

Measured 2026-10-07: PR #2222 and the Dependabot PR before it failed at
`start-local-services` with `docker: pull access denied for minio/minio,
repository does not exist`, before any test ran. Docker Hub returns 404 for
`minio/minio` and `minio/mc` (MinIO deleted them on 2026-09-11); Quay, its
other home, returns 401 (accounts required since 2026-09-24). The source
repository is archived (AGPL-3.0). Every PR that runs `test-backend` or
`sonarcloud` is red, and `local/docker-compose.yml` cannot start either.
Shyden chose, by AskUserQuestion, to **switch to another tool** rather than
build our own MinIO image or log in to Quay.

Production storage is Cloudflare R2 (`express-api/src/utils/r2.js`); MinIO is
only its local stand-in. What the stand-in must do, from the code:
`CreateBucket` and `PutBucketPolicy` (`local/seed.js`: a public-read bucket,
so `CDN_URL` serves objects anonymously), `PutObject`, `GetObject`,
`HeadObject`, `DeleteObject`, `DeleteObjects`, and presigned URLs
(`getSignedUrl`, 3 uses), path-style, on port 9002, with a health URL the
start scripts can wait on.

## Acceptance Criteria

### Happy path

- [ ] A spike runs the CURRENT unit and integration suites, unchanged, against
      at least SeaweedFS and versitygw (both Apache-2.0, maintained, pullable
      without an account on 2026-10-07), recording per candidate: tests
      passed/failed, every failure's cause, idle memory, start time. The
      choice, made from those figures, is recorded here.
- [ ] CI (`.github/actions/start-local-services`, `test-backend.yml`,
      `sonarcloud.yml`, and every other workflow found by searching for the
      port, the health URL and the image) starts the chosen tool, pinned by
      image DIGEST with its version in a comment.
- [ ] `local/docker-compose.yml`, `local/start.sh`, `local/start.ps1` and
      `local/seed.js` use it; `bash local/start.sh` brings the stack up and
      the seed creates the public-read bucket.
- [ ] Every operation listed in Why works against it, each proved by an
      existing or new test, including an anonymous GET of a public object and
      a presigned PUT then GET.
- [ ] `test-backend` and `sonarcloud` are green on the PR, every step read by
      name.

### Error paths

- [ ] If the stand-in does not become healthy, the start step fails within a
      stated bound naming the container and printing its last log lines. No
      retry.

### Edge cases

- [ ] No file still names `minio/minio`, `minio/mc` or `/minio/health` except
      history and this story (a test refuses the image names in workflow,
      action, compose and script files, with a floor on files read and a
      planted name going red).
- [ ] Env var names that say MINIO (`MINIO_ENDPOINT`, credentials) are renamed
      to a tool-neutral name, or kept with one recorded reason.

### Performance

- [ ] CI's service start is no slower than MinIO's was (read from a green run
      before 2026-09-11, if one exists, or recorded as the new baseline).

### Security

- [ ] The image is pinned by digest; its licence is recorded; it runs only
      in local and CI, never against production data.
- [ ] Dependabot covers the new image (docker ecosystem entry, or the
      reason it cannot read the action file recorded).

### UX

- [ ] `local/README` (or the stack's doc) says what runs on 9002 and how to
      reach its console, if it has one.

### i18n

- [ ] Not applicable.

### Observability

- [ ] The start step prints the stand-in's version.

## BDD Scenarios

**Scenario: Backend tests start on any branch again**

- **Given** a pull request that runs `test-backend`
- **When** local services start
- **Then** the S3 stand-in becomes healthy and the tests run

**Scenario: A public object is served without credentials**

- **Given** the seeded public-read bucket holding an image
- **When** the image URL is fetched with no credentials
- **Then** it is returned

**Scenario: A presigned upload can be read back**

- **Given** a presigned PUT URL from the API
- **When** a file is uploaded to it and a presigned GET is fetched
- **Then** the same bytes come back

**Scenario: The old image cannot creep back**

- **Given** a workflow naming `minio/minio`
- **When** the backend tests run
- **Then** the test fails naming that file

## Test Plan

- The spike above, then the full backend and integration suites on the PR.
- A local `bash local/start.sh` and seed, read back by an anonymous GET.

## Out of Scope

- Changing production storage (Cloudflare R2 stays).

## Dependencies

- None. This blocks every other PR, so it goes first.

## Risks & Mitigations

- **The chosen tool lacks bucket policies.** Mitigation: the spike measures
  it; anonymous read can instead come from the tool's own config if the
  local seed's policy call is then proved harmless.
- **Other repos pin MinIO too.** Recorded for the operator; this story
  touches ShyTalk only.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; dev deploy unaffected (it uses R2).

## Notes

- **2026-10-07**: Found when PR #2222's CI failed. Shyden chose "Switch to
  another tool" over our own MinIO build (3 points) and a Quay login
  (Dependabot PRs cannot read normal secrets, so they would stay red).
- **2026-10-07 spike** (`s3-probe.js`, 14 checks of every operation in Why,
  same AWS SDK, path-style): versitygw v1.8.0 passed 14/14, idle 14.05 MiB;
  SeaweedFS 4.48 passed 13/14, idle 86.05 MiB, and FAILED the presigned PUT
  (400 `BadDigest`, "The Content-Md5 you specified did not match", with no
  Content-MD5 sent). Presigned uploads are how phones send attachments, so
  SeaweedFS cannot stand in. Both are Apache-2.0; both served a public-read
  bucket anonymously and refused a forged signature and a wrong secret.
- **2026-10-12 choice: versitygw v1.8.0**, pinned
  `versity/versitygw:v1.8.0@sha256:30292fc2eeacc67a36993b01f7a7a5e3361a19cced0e80c1d71cfa2a4b0a2499`
  (index digest read from Docker Hub the same day; image label
  `org.opencontainers.image.licenses: Apache-2.0`). Health: its global
  `--health /health` flag (`cmd/versitygw/main.go` at `fd04bc1`), answered
  without credentials. The full backend and integration suites run against
  it in this story's PR CI: since 2026-10-09 integration runs are CI's only,
  so the spike's laptop suite runs are replaced by that run.
- **2026-10-12 env names**: `MINIO_ENDPOINT`, `MINIO_ROOT_USER` and
  `MINIO_ROOT_PASSWORD` became `LOCAL_S3_ENDPOINT`, `LOCAL_S3_ACCESS_KEY`
  and `LOCAL_S3_SECRET_KEY`. A local `.env.local` still holding an old name
  would be ignored and fall back to localhost, which a phone cannot reach,
  so `r2.js` refuses to load in local mode while any old name is set, and
  says what to rename it to.
- Scored 8: two candidates measured against the whole suite, then edits to
  CI, four local stack files and a guard test; larger than SHY-0540 (5).
