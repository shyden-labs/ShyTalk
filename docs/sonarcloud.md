# SonarCloud

Every repository runs SonarCloud on every pull request, and a failed quality
gate blocks it (issue shyden-labs/repo-template#27). Shyden, 2026-10-18: *"it needs to check. we
discussed this already before and i told you to make sure we check the results
and fail the workflow if it fails"*, after *"don't pass if it doesn't run"*.
Then, asked how: every project adopts SonarCloud, blocking.

## What the template gives you

- `.github/workflows/sonarcloud.yml`, a reusable workflow. It fails when
  `SONAR_TOKEN` is missing, and runs the coverage command (a failure there
  fails the job). It then scans and reads the quality gate of that scan's
  analysis, with `scripts/sonar-verdict.ts`. It is green only on `OK`; `ERROR`
  fails, naming each failed condition with its value and threshold.
- A verdict it cannot read fails closed, naming why:
  - a missing report (the scan did not run)
  - an API error
  - a task that failed
  - no analysis
  - a task for another pull request
  - still pending after the ceiling (`SONAR_CEILING_SECONDS`, 300 by default)
- The job summary says whether the scan ran, the verdict, and the SonarCloud
  link.
- `tests/unit/workflow-honesty.test.ts` refuses, in every workflow, a swallowed
  failure (`|| true`, `|| exit 0`, `|| :`, `continue-on-error: true`), a step
  gated on the token, and a scan with no verdict step after it.

## One-time setup for a new repository

1. On [sonarcloud.io](https://sonarcloud.io), sign in with GitHub, open the
   `shyden-labs` organisation, choose **Analyze new project**, and pick the
   repository. Note the project key (usually `shyden-labs_<repo>`).
2. In the project, open **Administration → Analysis Method** and turn
   **Automatic Analysis** off: CI runs the scan.
3. In **Administration → New Code**, set the new-code definition to
   **Previous version**, or to the branch your project diffs against.
4. Under **My Account → Security**, generate a token.
5. In the GitHub repository, open **Settings → Secrets and variables →
   Actions** and add it as `SONAR_TOKEN`. Then do the same under **Dependabot**
   secrets: Dependabot pull requests don't receive Actions secrets, and they
   are scanned too.
6. Call the workflow from the pull-request workflow, and make its job a
   required check on `develop` and `main`:

   ```yaml
   sonarcloud:
     uses: ./.github/workflows/sonarcloud.yml
     with:
       organization: shyden-labs
       project-key: shyden-labs_<repo>
     secrets: inherit
   ```

## Not yet confirmed

The first real scan confirms two things no document read on 2026-10-22
stated. Each fails closed, by name, if it is not so:

- The scan action writes `.scannerwork/report-task.txt` holding `ceTaskId`,
  `serverUrl` and `dashboardUrl`.
- A pull request's analysis task names its `pullRequest`.

SonarCloud's documentation also marks `api/qualitygates/project_status`
deprecated (since 2025-09-16). It answered for ShyTalk on 2026-10-18. Move to
its replacement when SonarCloud retires it.
