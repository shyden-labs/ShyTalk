# ShyTalk

Learn languages and cultures by talking.

# Shyden Labs repo template

A starter kit: a new Shyden Labs repository starts with CI and repository
settings already in place, and nothing it doesn't need on day one (shyden-labs/repo-template#149).

## What is here

| File | What it does |
| --- | --- |
| `.github/workflows/ci.yml` | On every pull request and every push to `develop`: install, `npm audit` (any known vulnerability fails), typecheck, lint, format check and unit tests (`build-and-test`), then coverage as one overall threshold over the TypeScript under `scripts/` (`coverage`). Its first step fails unless the default branch is `develop`. A pull request changing only Markdown or non-code files under `docs/` takes the docs-only fast path (`scripts/change-scope.ts`): both jobs still run and report, but skip typecheck, lint, unit tests and coverage. |
| `.github/dependabot.yml` | Version updates for npm, GitHub Actions and the Node pin, each targeting `develop`. |
| `.github/node/Dockerfile` | CI's one exact Node version (`FROM node:<major>.<minor>.<patch>`), bumped by Dependabot as a pull request of its own (shyden-labs/repo-template#143). |
| `scripts/npm-ci.ts` | Every workflow installs through it: `npm ci` that fails on any warning npm prints, naming each line (shyden-labs/repo-template#140). |
| `.github/workflows/sonarcloud.yml`, `scripts/sonar-verdict.ts`, `docs/sonarcloud.md` | A reusable SonarCloud scan whose quality gate blocks the pull request. |
| `.github/workflows/check-release-cut.yml`, `scripts/release-cut.ts`, `docs/release-cut.md` | Proves each pull request into `main` lands exactly a release cut CI tested. |
| `.github/workflows/deploy-dev.yml` | The dev deploy stub: every merge into `develop` deploys to dev; every pull request rehearses it. |
| `scripts/branch-rules-setup.ts` | Sets the `develop` and `main` rulesets, head-branch deletion and the `dev` environment's branch policy, and reads each back. |
| `scripts/board-*.ts`, `scripts/file-story.ts`, `.github/ISSUE_TEMPLATE/story.yml`, `docs/project-board.md` | The project board: filing stories, Estimate and Priority fields, the next ticket, progress, and orphaned In Progress tickets. |
| `tests/unit/supply-chain.test.ts` | Actions pinned to SHAs, Dependabot covering every ecosystem and targeting `develop`, Node read from the Dockerfile. |
| `tsconfig.json`, `eslint.config.js`, `.prettierrc.json`, `.githooks/pre-push`, `docs/static-checks.md` | Strict typecheck, lint and format, in CI and before every push. |
| `package.json` `overrides` | `minimatch` held at 11.0.3, past its ReDoS advisory GHSA-g3hv-75wg-m249, until eslint and typescript-eslint accept minimatch 11 themselves; then remove it (shyden-labs/repo-template#154). |
| `LICENSE` | Apache-2.0. |

## The rules

1. **Pin actions to full commit SHAs**, with a trailing `# vX.Y.Z` comment so a Dependabot bump is reviewable.
2. **Dependabot covers every ecosystem and `github-actions`, targeting `develop`.**
3. **`develop` is the default branch**, because GitHub opens Dependabot security fixes against the default branch only.
4. **Warnings are build failures**: a vite or node warning fails the unit run.
5. **A unit test runs in under 1 s and starts no process and opens no connection** (`tests/setup/unit-refusal.ts`).

## Using it

1. `gh repo create <name> --public --template shyden-labs/repo-template`. A repo carrying game, art or learning content adds its own content licence.
2. Create `develop` and make it the default branch before Dependabot first runs. CI fails until this is done.
3. As the operator, set the branch rules: `node scripts/branch-rules-setup.ts <owner/repo> build-and-test coverage`, and add any check the project adds later.
4. Add the ecosystems your repo uses to `.github/dependabot.yml`, and enable Dependabot alerts and security updates.
5. `npm ci && npm run test:unit`.
6. Set up the project board as `docs/project-board.md` describes.
7. Fill in `.github/workflows/deploy-dev.yml` with your own dev deploy, or delete it and `tests/unit/deploy-dev.test.ts` if the repo hosts nothing.
8. Turn on SonarCloud as `docs/sonarcloud.md` describes.
