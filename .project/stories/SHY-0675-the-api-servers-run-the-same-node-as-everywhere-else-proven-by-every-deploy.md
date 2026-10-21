---
id: SHY-0675
status: Draft
owner: claude
created: 2026-10-21
priority: P0
effort: M
estimate: 5
type: infra
roadmap_ids: []
mvp: true
epic: EPIC-0015
---

# SHY-0675: the API servers run the same Node as everywhere else, proven by every deploy

## User Story

As the operator, I want the dev and production API servers to run the same
Node version as every other place ShyTalk runs, checked by every deploy, so
that the live API gets Node's security fixes and the ES-module move cannot
break the server.

## Why

Shyden, 2026-10-21: "of course we should be running on the same node as
everywhere else. consistency." Measured that day: `ORACLE-CLOUD-SETUP.md` §6
(last changed 2026-03-16) installs Node 20 on the servers through NodeSource,
while express-api's `engines` says `>=24 <25`. Node 20 stopped getting
security fixes in April 2026. Nothing reports the servers' Node: `/api/health`
returns only status, timestamp and SHA, and the deploy (`deploy-dev.yml`
"Deploy Express API to London (dev)": tarball, `npm install --omit=dev`,
`pm2 restart shytalk-api`) never reads it, and npm only warns on an `engines`
mismatch. So which Node the servers run is unmeasured. EPIC-0015 runs moved
and unmoved areas side by side through Node's `require()` of ES modules,
which Node 20 has only from 20.19, so SHY-0668 and SHY-0669 wait on this.
SHY-0566 moves the repo's own pins to Node 26 but leaves the servers out.

## Acceptance Criteria

### Happy path

- [ ] Each deploy reads `node -v` on its server over the deploy's own SSH
      session, before `pm2 restart`, and prints it in the step log.
- [ ] The deploy fails, before restarting anything, unless the server's Node
      is the version the repo pins (the `.nvmrc` major and the `engines`
      range, read from the files, never a copied literal).
- [ ] Both servers are upgraded to that version: dev first through Deploy To
      Dev, production only through the `production` environment's approval.
- [ ] `ORACLE-CLOUD-SETUP.md` installs that version, and a test pins its
      install line to `.nvmrc`.

### Error paths

- [ ] A server on another major, or below the `engines` floor, fails the
      deploy naming the found and the wanted version. Planted on dev with a
      stand-in version string, the step red.
- [ ] Output from `node -v` that cannot be parsed fails the deploy (fails
      closed).

### Edge cases

- [ ] The pm2 daemon runs the upgraded Node, not the one it started under:
      the health check reads the serving process's version through the
      deploy's SSH session (`pm2 describe shytalk-api`, interpreter version),
      not only the shell's `node`.

### Performance

- [ ] The version check adds under 5 s to each deploy, measured.

### Security

- [ ] The servers' Node gets security fixes: the deploy also fails when the
      server's version is older than the newest patch release of its major
      by more than 30 days (the release list read from nodejs.org/dist/index.json
      at deploy time; unreadable fails the deploy).
- [ ] The version is never exposed on a public endpoint (`/api/health` stays
      as it is): it is read over SSH only.

### UX

- [ ] No change a user can see, proven by Deploy To Dev's "Verify dev API
      health", "Dev Sanity Check" and "Dev Smoke Tests" green on the upgraded
      server, and the production deploy's "Verify prod API health" and "Smoke
      Test (API)".

### i18n

- [x] Not applicable: no copy.

### Observability

- [ ] Each deploy's summary names the server's Node version and the version
      wanted.

## Announce

None: no change users can see, once the UX AC's runs show the upgraded
servers serving the same API.

## BDD Scenarios

**Scenario: a server on an old Node stops the deploy**

- **Given** the dev server runs a Node major other than the repo's pin
- **When** Deploy To Dev runs
- **Then** the deploy fails before `pm2 restart`, naming both versions, and
  the server keeps serving its previous release

**Scenario: the upgraded server deploys**

- **Given** the dev server runs the pinned Node
- **When** Deploy To Dev runs
- **Then** the version check passes and "Verify dev API health" sees the
  merge SHA serving

## Test Plan

- Unit tests of the version comparison (equal, other major, below floor,
  stale patch, unparsable). A planted wrong version on a dev deploy, seen
  red. The dev deploy after the upgrade, by step name; the production deploy
  under its approval.
- The no-holes rule applies: before/after lists, coverage of changed code,
  mutations of the check.

## Out of Scope

- The repo's own pins (SHY-0566).

## Dependencies

- None.

## Risks & Mitigations

- **Upgrading Node under a running pm2.** The upgrade runs as its own step
  with `pm2 update` so the daemon restarts on the new runtime; dev first, and
  the production upgrade waits for dev's health and smoke runs.
- **Native modules built for the old Node** (`bcrypt` among them): the deploy's
  `npm install --omit=dev` rebuilds them on the new runtime; the boot is proven
  by the health check.

## Definition of Done

- [ ] Every AC ticked with its proof; both servers on the pinned Node; CI and
      both deploys green by step name; merged to `develop`.

## Notes

- **2026-10-21**: filed when the runtime-proof check of EPIC-0015's ACs found
  the setup guide installs Node 20 and nothing reads the servers' version. P0:
  a possibly unsupported runtime on the live API, and SHY-0668 and SHY-0669
  (P0) wait on it. Scored 5: a version check in two deploy workflows with its
  tests, two server upgrades (dev, then production under approval) and the
  setup guide with its pin test.
