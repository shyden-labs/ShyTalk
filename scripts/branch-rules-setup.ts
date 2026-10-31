/**
 * Gives a repository one ruleset per long-lived branch, `develop` and `main`,
 * each naming its branch, requiring pull requests, the named checks, signed
 * commits, and no deletion or force push (issue shyden-labs/repo-template#8). `develop` requires the
 * checks run on an up-to-date branch ("strict"); `main` does not, because each
 * release merge lands on `main` and never on squash-only `develop`, so a strict
 * `main` would refuse every cut after the first. `main` requires `release-cut`
 * in its place (issue shyden-labs/repo-template#86, docs/release-cut.md). Run once per repository, by
 * the operator (rulesets need admin rights), after `develop` becomes the
 * default branch:
 *
 *   node scripts/branch-rules-setup.ts <owner/repo> <required check>...
 *
 * It refuses a ruleset that targets ~DEFAULT_BRANCH: that target moves when the
 * default branch changes, which is how ShyTalk's `main` lost its rules on
 * 2026-10-13. It creates what is missing, updates what differs, and reads both
 * branches' rules back, failing unless develop is strict and main is not and
 * requires release-cut. Then it gives the `dev` environment, which holds the
 * dev credential, a deployment branch policy naming `develop` alone, and reads
 * that back too (issue shyden-labs/repo-template#117).
 */
import { execFileSync } from 'node:child_process';
import { runIfEntry } from './cli.ts';

export interface Rule {
  type: string;
  parameters?: unknown;
}

export interface RulesetBody {
  name: string;
  target: string;
  enforcement: string;
  conditions: { ref_name: { include: string[]; exclude: string[] } };
  rules: Rule[];
}

export interface ExistingRuleset extends RulesetBody {
  id: number;
}

export type Branch = 'develop' | 'main';
const BRANCHES: Branch[] = ['develop', 'main'];

/** The commit status `.github/workflows/check-release-cut.yml` posts on each pull request into main's head. */
export const RELEASE_CUT = 'release-cut';

/** GitHub Actions' app id: every required check, release-cut included, is posted by a workflow, so no other app may satisfy it. */
export const GITHUB_ACTIONS_APP_ID = 15368;

/** The ruleset a branch must carry. */
export function desiredRuleset(branch: Branch, checks: string[]): RulesetBody {
  if (checks.length === 0) {
    throw new Error('name at least one required check: a strict rule with no checks tests nothing');
  }
  if (checks.includes(RELEASE_CUT)) {
    throw new Error(`${RELEASE_CUT} runs only on pull requests into main: leave it out, and main gets it alone`);
  }
  const contexts = branch === 'main' ? [...checks, RELEASE_CUT] : checks;
  return {
    name: branch,
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: [`refs/heads/${branch}`], exclude: [] } },
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      {
        type: 'pull_request',
        parameters: {
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: false,
        },
      },
      {
        type: 'required_status_checks',
        parameters: {
          strict_required_status_checks_policy: branch === 'develop',
          required_status_checks: contexts.map((context) => ({ context, integration_id: GITHUB_ACTIONS_APP_ID })),
        },
      },
      { type: 'required_signatures' },
    ],
  };
}

/** Objects with their keys sorted, so two rulesets compare by content alone. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

function shape(body: RulesetBody): string {
  const { name, target, enforcement, conditions, rules } = body;
  return canonical({ name, target, enforcement, conditions, rules });
}

/** One branch's ruleset: created, or updated or kept by its id. */
export type RulesetStep = { action: 'create'; body: RulesetBody } | { action: 'update' | 'keep'; id: number; body: RulesetBody };

/** What each branch's ruleset needs: created, updated by id, or kept. */
export function planRulesets(existing: ExistingRuleset[], checks: string[]): RulesetStep[] {
  for (const r of existing) {
    if (r.conditions.ref_name.include.includes('~DEFAULT_BRANCH')) {
      throw new Error(
        `ruleset ${r.id} "${r.name}" targets ~DEFAULT_BRANCH, which moves when the default branch changes: retarget it to refs/heads/<branch> or delete it first`,
      );
    }
  }
  return BRANCHES.map((branch) => {
    const body = desiredRuleset(branch, checks);
    const found = existing.find((r) => r.name === branch);
    if (found === undefined) return { action: 'create' as const, body };
    return { action: shape(found) === shape(body) ? ('keep' as const) : ('update' as const), id: found.id, body };
  });
}

interface ChecksParameters {
  strict_required_status_checks_policy?: boolean;
  required_status_checks?: { context: string; integration_id?: number }[];
}

/** Every way a branch's rules (as `rules/branches/<branch>` reports them) fall short; empty when none. */
export function auditBranchRules(branch: Branch, rules: Rule[]): string[] {
  const problems: string[] = [];
  // The repository deletes merged head branches (shyden-labs/repo-template#28), so a deletable
  // develop would go the first time a develop -> main pull request merges.
  if (!rules.some((r) => r.type === 'deletion')) {
    problems.push(`${branch}: no rule forbids deleting it`);
  }
  if (!rules.some((r) => r.type === 'pull_request')) {
    problems.push(`${branch}: no rule requires a pull request`);
  }
  const checks = rules.filter((r) => r.type === 'required_status_checks').map((r) => (r.parameters ?? {}) as ChecksParameters);
  const requiresReleaseCut = checks.some((c) => c.required_status_checks?.some((s) => s.context === RELEASE_CUT) === true);
  for (const status of checks.flatMap((c) => c.required_status_checks ?? [])) {
    if (status.integration_id !== GITHUB_ACTIONS_APP_ID) {
      problems.push(`${branch}: required check "${status.context}" is not pinned to GitHub Actions (app ${GITHUB_ACTIONS_APP_ID})`);
    }
  }
  if (checks.length === 0) {
    problems.push(`${branch}: no rule requires status checks`);
  } else if (branch === 'develop') {
    if (checks.some((c) => c.strict_required_status_checks_policy !== true)) {
      problems.push(`${branch}: a required-checks rule is not strict`);
    }
    if (requiresReleaseCut) {
      problems.push(`${branch}: a rule requires ${RELEASE_CUT}, which runs only on pull requests into main`);
    }
  } else {
    if (checks.some((c) => c.strict_required_status_checks_policy !== false)) {
      problems.push(`${branch}: a required-checks rule is strict, so a second release cut could never merge`);
    }
    if (!requiresReleaseCut) {
      problems.push(`${branch}: no rule requires ${RELEASE_CUT}`);
    }
  }
  return problems;
}

/** Every way the repository's own settings (as `repos/<owner>/<repo>` reports them) fall short; empty when none. */
export function auditRepoSettings(repo: { delete_branch_on_merge?: boolean }): string[] {
  return repo.delete_branch_on_merge === true
    ? []
    : [`merged head branches are not deleted (delete_branch_on_merge is ${String(repo.delete_branch_on_merge)})`];
}

/** The environment that holds the dev credential, and the one branch that may deploy to it (shyden-labs/repo-template#117). */
export const DEV_ENVIRONMENT = 'dev';
const DEV_BRANCH = 'develop';

/** One of an environment's deployment branch policies. */
export interface BranchPolicy {
  id: number;
  name: string;
  type?: string;
}

const isDevelopBranch = (p: BranchPolicy) => p.name === DEV_BRANCH && p.type === 'branch';

/** Which of `dev`'s branch policies to delete by id, and whether `develop` must be added. */
export function planDevPolicies(existing: BranchPolicy[]): { remove: number[]; add: boolean } {
  return { remove: existing.filter((p) => !isDevelopBranch(p)).map((p) => p.id), add: !existing.some(isDevelopBranch) };
}

interface DevEnvironment {
  deployment_branch_policy?: { protected_branches?: boolean; custom_branch_policies?: boolean } | null;
}

/**
 * Every way `dev` (as `environments/dev` and its branch policies report it)
 * lets more than `develop` deploy; empty when none (shyden-labs/repo-template#117). A pull_request run
 * uses the pull request's own workflows, so without this a same-repository
 * branch could name `environment: dev` and read its secrets.
 */
export function auditDevEnvironment(env: DevEnvironment | undefined, policies: BranchPolicy[]): string[] {
  if (env === undefined) return [`${DEV_ENVIRONMENT}: missing; deploy-dev.yml deploys there`];
  const policy = env.deployment_branch_policy;
  if (policy === null || policy === undefined) return [`${DEV_ENVIRONMENT}: no deployment branch policy, so any branch may deploy`];
  if (policy.protected_branches !== false)
    return [`${DEV_ENVIRONMENT}: lets every protected branch deploy (main included), not develop alone`];
  if (policy.custom_branch_policies !== true) return [`${DEV_ENVIRONMENT}: names no custom branches, so develop alone is not set`];
  if (policies.length === 1 && isDevelopBranch(policies[0] as BranchPolicy)) return [];
  const named = policies.length === 0 ? 'no branch' : policies.map((p) => `${p.name} (${String(p.type)})`).join(', ');
  return [`${DEV_ENVIRONMENT}: lets ${named} deploy, not develop alone`];
}

/** gh's JSON answer; an empty one (a DELETE's 204) reads as nothing. */
function gh(args: string[], input?: string): unknown {
  const answer = execFileSync('gh', args, { encoding: 'utf8', input });
  return answer.trim() === '' ? undefined : JSON.parse(answer);
}

/** `dev`'s branch policies, from one page; a longer list fails closed rather than being read in part. */
function devPolicies(repo: string): BranchPolicy[] {
  const path = `repos/${repo}/environments/${DEV_ENVIRONMENT}/deployment-branch-policies?per_page=100`;
  const page = gh(['api', path]) as { total_count: number; branch_policies: BranchPolicy[] };
  if (page.total_count > page.branch_policies.length) {
    throw new Error(`${path} lists ${page.total_count} branch policies; one page of 100 was read`);
  }
  return page.branch_policies;
}

type ListedEnvironment = DevEnvironment & { name: string; protection_rules?: { type: string }[] };

/** Gives `dev` a custom policy naming `develop` alone, then reads it back (shyden-labs/repo-template#117). Prints `dev: set` or `dev: keep`. */
function setDevEnvironment(repo: string): void {
  const env = `repos/${repo}/environments/${DEV_ENVIRONMENT}`;
  const listed = (gh(['api', `repos/${repo}/environments`]) as { environments: ListedEnvironment[] }).environments;
  const before = listed.find((e) => e.name === DEV_ENVIRONMENT);
  const policy = before?.deployment_branch_policy;
  let wrote = false;
  if (policy?.protected_branches !== false || policy.custom_branch_policies !== true) {
    // Unmeasured whether a PUT naming only the branch policy keeps reviewers
    // and wait timers, so it is never sent over them.
    const kept = (before?.protection_rules ?? []).map((r) => r.type).filter((type) => type !== 'branch_policy');
    if (kept.length > 0) {
      throw new Error(
        `${DEV_ENVIRONMENT} has protection rules (${kept.join(', ')}) that setting its branch policy could drop: set its deployment branches to develop alone by hand, then run this again`,
      );
    }
    gh(
      ['api', '-X', 'PUT', env, '--input', '-'],
      JSON.stringify({ deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } }),
    );
    wrote = true;
  }
  const { remove, add } = planDevPolicies(devPolicies(repo));
  for (const id of remove) gh(['api', '-X', 'DELETE', `${env}/deployment-branch-policies/${id}`]);
  if (add) gh(['api', '-X', 'POST', `${env}/deployment-branch-policies`, '-f', `name=${DEV_BRANCH}`, '-f', 'type=branch']);
  wrote ||= remove.length > 0 || add;
  const after = gh(['api', env]) as DevEnvironment;
  // GitHub answers 404 for the policies of an environment whose custom policy is off.
  const problems = auditDevEnvironment(after, after.deployment_branch_policy?.custom_branch_policies === true ? devPolicies(repo) : []);
  if (problems.length > 0) {
    throw new Error(`read back, the dev environment still falls short:\n  ${problems.join('\n  ')}`);
  }
  process.stdout.write(`${DEV_ENVIRONMENT}: ${wrote ? 'set' : 'keep'}\n`);
}

export function main(args: string[]): number {
  const [repo, ...checks] = args;
  if (repo === undefined || !/^[^/\s]+\/[^/\s]+$/.test(repo) || checks.length === 0) {
    throw new Error('usage: node scripts/branch-rules-setup.ts <owner/repo> <required check>...');
  }
  const summaries = gh(['api', `repos/${repo}/rulesets`]) as { id: number }[];
  const existing = summaries.map((s) => gh(['api', `repos/${repo}/rulesets/${s.id}`]) as ExistingRuleset);
  for (const step of planRulesets(existing, checks)) {
    if (step.action === 'create') {
      gh(['api', '-X', 'POST', `repos/${repo}/rulesets`, '--input', '-'], JSON.stringify(step.body));
    } else if (step.action === 'update') {
      gh(['api', '-X', 'PUT', `repos/${repo}/rulesets/${step.id}`, '--input', '-'], JSON.stringify(step.body));
    }
    process.stdout.write(`${step.body.name}: ${step.action}\n`);
  }
  const problems = BRANCHES.flatMap((b) => auditBranchRules(b, gh(['api', `repos/${repo}/rules/branches/${b}`]) as Rule[]));
  if (problems.length > 0) {
    throw new Error(`read back, the rules still fall short:\n  ${problems.join('\n  ')}`);
  }
  // Only now that neither branch can be deleted: a merged pull request's head
  // branch is deleted with it (shyden-labs/repo-template#28). A template copies files, not settings.
  gh(['api', '-X', 'PATCH', `repos/${repo}`, '-F', 'delete_branch_on_merge=true']);
  const settings = auditRepoSettings(gh(['api', `repos/${repo}`]) as { delete_branch_on_merge?: boolean });
  if (settings.length > 0) {
    throw new Error(`read back, the repository still falls short:\n  ${settings.join('\n  ')}`);
  }
  setDevEnvironment(repo);
  process.stdout.write(
    `${repo}: develop requires strict checks; main requires ${RELEASE_CUT} instead; both forbid deletion and require pull requests; merged head branches are deleted; ${DEV_ENVIRONMENT} deploys from ${DEV_BRANCH} alone.\n`,
  );
  return 0;
}

await runIfEntry(import.meta.url, main);
