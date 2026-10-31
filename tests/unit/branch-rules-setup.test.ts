import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  desiredRuleset,
  main,
  planRulesets,
  planDevPolicies,
  auditBranchRules,
  auditDevEnvironment,
  auditRepoSettings,
  type ExistingRuleset,
  type Rule,
} from '../../scripts/branch-rules-setup.ts';

// `gh` is stood in: a unit test starts no process. Each test queues gh's replies in call order.
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
const gh = vi.mocked(execFileSync);

/**
 * Every repository requires pull requests to be up to date with their base
 * ("strict" required checks) on `develop` and `main`, each by a ruleset that
 * names its branch (issue shyden-labs/repo-template#8). Measured 2026-10-13 in ShyTalk: develop was not
 * strict, and a ruleset named "main" targeted ~DEFAULT_BRANCH, so when develop
 * became the default branch the real `main` kept only no-force-push.
 */

const CHECKS = ['unit', 'PR Gate'];

function ruleTypes(body: { rules: { type: string }[] }): string[] {
  return body.rules.map((r) => r.type).sort();
}

function checksRule(body: { rules: { type: string; parameters?: unknown }[] }) {
  return body.rules.find((r) => r.type === 'required_status_checks')?.parameters as
    { strict_required_status_checks_policy: boolean; required_status_checks: { context: string }[] } | undefined;
}

describe('desiredRuleset', () => {
  it('targets develop by name only', () => {
    expect(desiredRuleset('develop', CHECKS).conditions).toEqual({
      ref_name: { include: ['refs/heads/develop'], exclude: [] },
    });
  });

  it('targets main by name only', () => {
    expect(desiredRuleset('main', CHECKS).conditions).toEqual({
      ref_name: { include: ['refs/heads/main'], exclude: [] },
    });
  });

  it('requires develop’s checks to be run on an up-to-date branch (strict)', () => {
    expect(checksRule(desiredRuleset('develop', CHECKS))?.strict_required_status_checks_policy).toBe(true);
  });

  it('requires exactly the named checks on develop, in order', () => {
    expect(checksRule(desiredRuleset('develop', CHECKS))?.required_status_checks).toEqual([{ context: 'unit' }, { context: 'PR Gate' }]);
  });

  // Each release merge lands on main and never on squash-only develop, so a
  // strict main would refuse every cut after the first (shyden-labs/repo-template#86).
  it('does not require main’s checks to be run on an up-to-date branch', () => {
    expect(checksRule(desiredRuleset('main', CHECKS))?.strict_required_status_checks_policy).toBe(false);
  });

  it('requires the named checks on main, in order, then release-cut', () => {
    expect(checksRule(desiredRuleset('main', CHECKS))?.required_status_checks).toEqual([
      { context: 'unit' },
      { context: 'PR Gate' },
      { context: 'release-cut' },
    ]);
  });

  it('refuses release-cut among the named checks, since develop would wait on it forever', () => {
    expect(() => desiredRuleset('develop', ['unit', 'release-cut'])).toThrow(
      'release-cut runs only on pull requests into main: leave it out, and main gets it alone',
    );
  });

  it('also forbids deletion and force pushes and requires pull requests and signed commits', () => {
    expect(ruleTypes(desiredRuleset('develop', CHECKS))).toEqual([
      'deletion',
      'non_fast_forward',
      'pull_request',
      'required_signatures',
      'required_status_checks',
    ]);
  });

  it('is active, on branches, under the branch name', () => {
    const body = desiredRuleset('main', CHECKS);
    expect([body.name, body.target, body.enforcement]).toEqual(['main', 'branch', 'active']);
  });

  it('refuses an empty check list by name', () => {
    expect(() => desiredRuleset('develop', [])).toThrow('name at least one required check: a strict rule with no checks tests nothing');
  });
});

/** The ruleset as desired, or with its strict setting flipped to `strict`. */
function existing(id: number, name: string, include: string[], strict?: boolean): ExistingRuleset {
  const body = desiredRuleset(name === 'main' ? 'main' : 'develop', CHECKS);
  const rules = body.rules.map((r) =>
    r.type === 'required_status_checks' && strict !== undefined
      ? { ...r, parameters: { ...(r.parameters as object), strict_required_status_checks_policy: strict } }
      : r,
  );
  return { ...body, id, name, conditions: { ref_name: { include, exclude: [] } }, rules };
}

describe('planRulesets', () => {
  it('creates both rulesets when the repository has none', () => {
    expect(planRulesets([], CHECKS).map((p) => [p.action, p.body.name])).toEqual([
      ['create', 'develop'],
      ['create', 'main'],
    ]);
  });

  it('updates a same-named ruleset that is not strict, by its id', () => {
    const plan = planRulesets([existing(11, 'develop', ['refs/heads/develop'], false)], CHECKS);
    expect(plan.map((p) => [p.action, p.body.name, 'id' in p ? p.id : undefined])).toEqual([
      ['update', 'develop', 11],
      ['create', 'main', undefined],
    ]);
  });

  it('updates a same-named main ruleset that is strict, by its id', () => {
    const plan = planRulesets([existing(11, 'develop', ['refs/heads/develop']), existing(12, 'main', ['refs/heads/main'], true)], CHECKS);
    expect(plan).toMatchObject([
      { action: 'keep', id: 11, body: { name: 'develop' } },
      { action: 'update', id: 12, body: { name: 'main' } },
    ]);
  });

  it('keeps a ruleset that already matches', () => {
    const plan = planRulesets([existing(11, 'develop', ['refs/heads/develop']), existing(12, 'main', ['refs/heads/main'])], CHECKS);
    expect(plan.map((p) => p.action)).toEqual(['keep', 'keep']);
  });

  it('refuses a ruleset that targets the default branch, naming it', () => {
    expect(() => planRulesets([existing(12613584, 'main', ['~DEFAULT_BRANCH'])], CHECKS)).toThrow(
      'ruleset 12613584 "main" targets ~DEFAULT_BRANCH, which moves when the default branch changes: retarget it to refs/heads/<branch> or delete it first',
    );
  });

  it('leaves unrelated rulesets alone', () => {
    const other: ExistingRuleset = {
      id: 3,
      name: 'no-force-push-anywhere',
      target: 'branch',
      enforcement: 'active',
      conditions: { ref_name: { include: ['~ALL'], exclude: [] } },
      rules: [{ type: 'non_fast_forward' }],
    };
    expect(planRulesets([other], CHECKS).map((p) => p.action)).toEqual(['create', 'create']);
  });
});

describe('auditBranchRules', () => {
  const good: [Rule, Rule, Rule] = [
    { type: 'deletion' },
    { type: 'pull_request' },
    { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true } },
  ];

  it('passes a branch that forbids deletion and requires pull requests and strict checks', () => {
    expect(auditBranchRules('develop', good)).toEqual([]);
  });

  it('names a branch whose required checks are not strict', () => {
    expect(
      auditBranchRules('develop', [
        { type: 'deletion' },
        { type: 'pull_request' },
        { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: false } },
      ]),
    ).toEqual(['develop: a required-checks rule is not strict']);
  });

  it('names a branch with no required checks at all', () => {
    expect(auditBranchRules('main', [{ type: 'deletion' }, { type: 'pull_request' }, { type: 'non_fast_forward' }])).toEqual([
      'main: no rule requires status checks',
    ]);
  });

  it('names a branch that does not require pull requests', () => {
    expect(auditBranchRules('develop', [good[0], good[2]])).toEqual(['develop: no rule requires a pull request']);
  });

  const mainChecks = (strict: boolean, contexts: string[]): Rule => ({
    type: 'required_status_checks',
    parameters: { strict_required_status_checks_policy: strict, required_status_checks: contexts.map((context) => ({ context })) },
  });

  it('passes a main that requires release-cut and is not strict', () => {
    expect(auditBranchRules('main', [good[0], good[1], mainChecks(false, ['unit', 'release-cut'])])).toEqual([]);
  });

  it('names a main whose required checks are strict', () => {
    expect(auditBranchRules('main', [good[0], good[1], mainChecks(true, ['unit', 'release-cut'])])).toEqual([
      'main: a required-checks rule is strict, so a second release cut could never merge',
    ]);
  });

  // An answer that leaves the parameters out proves nothing, so each branch reads it as short.
  it.each([
    ['develop' as const, ['develop: a required-checks rule is not strict']],
    [
      'main' as const,
      ['main: a required-checks rule is strict, so a second release cut could never merge', 'main: no rule requires release-cut'],
    ],
  ])('names a %s whose required-checks rule has no parameters', (branch, problems) => {
    expect(auditBranchRules(branch, [good[0], good[1], { type: 'required_status_checks' }])).toEqual(problems);
  });

  it('names a develop that requires release-cut, which never runs on its pull requests', () => {
    expect(auditBranchRules('develop', [good[0], good[1], mainChecks(true, ['unit', 'release-cut'])])).toEqual([
      'develop: a rule requires release-cut, which runs only on pull requests into main',
    ]);
  });

  it('names a main that does not require release-cut', () => {
    expect(auditBranchRules('main', [good[0], good[1], mainChecks(false, ['unit'])])).toEqual(['main: no rule requires release-cut']);
  });

  // With "Automatically delete head branches" on, merging a develop -> main
  // release pull request deletes develop unless a rule forbids it (shyden-labs/repo-template#28).
  it('names a branch that can be deleted', () => {
    expect(auditBranchRules('develop', [good[1], good[2]])).toEqual(['develop: no rule forbids deleting it']);
  });
});

describe('auditRepoSettings', () => {
  it('passes a repository that deletes merged head branches', () => {
    expect(auditRepoSettings({ delete_branch_on_merge: true })).toEqual([]);
  });

  it('names a repository that keeps merged head branches', () => {
    expect(auditRepoSettings({ delete_branch_on_merge: false })).toEqual([
      'merged head branches are not deleted (delete_branch_on_merge is false)',
    ]);
  });

  it('names a repository whose answer leaves the setting out', () => {
    expect(auditRepoSettings({})).toEqual(['merged head branches are not deleted (delete_branch_on_merge is undefined)']);
  });
});

// shyden-labs/repo-template#117: `dev` holds the dev credential, so only `develop` may deploy to it. A
// pull_request run uses the pull request's own workflows, so without the
// policy a same-repository branch could name `environment: dev`.
const DEVELOP = { id: 1, name: 'develop', type: 'branch' };
const CUSTOM = { deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } };

describe('planDevPolicies', () => {
  it('adds develop to an empty list', () => {
    expect(planDevPolicies([])).toEqual({ remove: [], add: true });
  });

  it('keeps develop alone as it is', () => {
    expect(planDevPolicies([DEVELOP])).toEqual({ remove: [], add: false });
  });

  it('removes every other branch, by id', () => {
    expect(planDevPolicies([DEVELOP, { id: 2, name: 'main', type: 'branch' }, { id: 3, name: 'develop*', type: 'branch' }])).toEqual({
      remove: [2, 3],
      add: false,
    });
  });

  it('removes a tag named develop and adds the branch', () => {
    expect(planDevPolicies([{ id: 4, name: 'develop', type: 'tag' }])).toEqual({ remove: [4], add: true });
  });
});

describe('auditDevEnvironment', () => {
  it('passes a custom policy naming the develop branch alone', () => {
    expect(auditDevEnvironment(CUSTOM, [DEVELOP])).toEqual([]);
  });

  it('names a missing dev', () => {
    expect(auditDevEnvironment(undefined, [])).toEqual(['dev: missing; deploy-dev.yml deploys there']);
  });

  it('names a dev with no branch policy', () => {
    expect(auditDevEnvironment({ deployment_branch_policy: null }, [])).toEqual([
      'dev: no deployment branch policy, so any branch may deploy',
    ]);
  });

  it('names a dev that lets every protected branch deploy', () => {
    expect(auditDevEnvironment({ deployment_branch_policy: { protected_branches: true, custom_branch_policies: false } }, [])).toEqual([
      'dev: lets every protected branch deploy (main included), not develop alone',
    ]);
  });

  it('names a dev whose policy names no custom branches', () => {
    expect(auditDevEnvironment({ deployment_branch_policy: { protected_branches: false, custom_branch_policies: false } }, [])).toEqual([
      'dev: names no custom branches, so develop alone is not set',
    ]);
  });

  it.each([
    [[], 'no branch'],
    [[DEVELOP, { id: 2, name: 'main', type: 'branch' }], 'develop (branch), main (branch)'],
    [[{ id: 3, name: 'develop*', type: 'branch' }], 'develop* (branch)'],
    [[{ id: 4, name: 'develop', type: 'tag' }], 'develop (tag)'],
  ])('names a custom list of %j', (policies, named) => {
    expect(auditDevEnvironment(CUSTOM, policies)).toEqual([`dev: lets ${named} deploy, not develop alone`]);
  });
});

describe('main', () => {
  const REPO = 'shyden-labs/app';
  const CHECKS = ['build-and-test', 'coverage'];
  const strict = [
    { type: 'deletion' },
    { type: 'pull_request' },
    { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true } },
  ];
  const mainRules = [
    strict[0],
    strict[1],
    {
      type: 'required_status_checks',
      parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: 'release-cut' }] },
    },
  ];
  const deletes = { delete_branch_on_merge: true };
  const reply = (...values: unknown[]) => {
    for (const value of values) gh.mockReturnValueOnce(JSON.stringify(value));
  };
  /** Each gh call's arguments and the body it sent on stdin, if any. */
  const calls = () => gh.mock.calls.map((c) => [c[1], (c[2] as { input?: string }).input]);
  let out: string[];
  beforeEach(() => {
    gh.mockReset();
    out = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((t) => (out.push(String(t)), true));
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([[[]], [['not-a-repo', 'build-and-test']], [[REPO]]])('refuses the arguments %j', (args) => {
    expect(() => main(args)).toThrow('usage: node scripts/branch-rules-setup.ts <owner/repo> <required check>...');
  });

  const ENVS = `repos/${REPO}/environments`;
  const DEV = `${ENVS}/dev`;
  const POLICIES = `${DEV}/deployment-branch-policies`;
  const LIST = `${POLICIES}?per_page=100`;
  const SUMMARY = `${REPO}: develop requires strict checks; main requires release-cut instead; both forbid deletion and require pull requests; merged head branches are deleted; dev deploys from develop alone.\n`;
  /** `dev` already set: listed with its policy, develop alone, read back the same. */
  const devSet = [
    { total_count: 1, environments: [{ name: 'dev', ...CUSTOM, protection_rules: [{ type: 'branch_policy' }] }] },
    { total_count: 1, branch_policies: [DEVELOP] },
    CUSTOM,
    { total_count: 1, branch_policies: [DEVELOP] },
  ];
  /** The seven ruleset and repository calls every full run makes first, for the created path. */
  const RULE_REPLIES = [[], {}, {}, strict, mainRules, {}, deletes];

  it('creates both rulesets and dev where there are none, reads them all back and exits 0', () => {
    reply(...RULE_REPLIES, { total_count: 0, environments: [] }, {}, { total_count: 0, branch_policies: [] }, {}, CUSTOM, {
      total_count: 1,
      branch_policies: [DEVELOP],
    });
    expect(main([REPO, ...CHECKS])).toBe(0);
    expect(calls()).toEqual([
      [['api', `repos/${REPO}/rulesets`], undefined],
      [['api', '-X', 'POST', `repos/${REPO}/rulesets`, '--input', '-'], JSON.stringify(desiredRuleset('develop', CHECKS))],
      [['api', '-X', 'POST', `repos/${REPO}/rulesets`, '--input', '-'], JSON.stringify(desiredRuleset('main', CHECKS))],
      [['api', `repos/${REPO}/rules/branches/develop`], undefined],
      [['api', `repos/${REPO}/rules/branches/main`], undefined],
      [['api', '-X', 'PATCH', `repos/${REPO}`, '-F', 'delete_branch_on_merge=true'], undefined],
      [['api', `repos/${REPO}`], undefined],
      [['api', ENVS], undefined],
      [['api', '-X', 'PUT', DEV, '--input', '-'], JSON.stringify(CUSTOM)],
      [['api', LIST], undefined],
      [['api', '-X', 'POST', POLICIES, '-f', 'name=develop', '-f', 'type=branch'], undefined],
      [['api', DEV], undefined],
      [['api', LIST], undefined],
    ]);
    expect(out).toEqual(['develop: create\n', 'main: create\n', 'dev: set\n', SUMMARY]);
  });

  it('leaves a dev already set to develop alone as it is, writing nothing to it', () => {
    reply(...RULE_REPLIES, ...devSet);
    expect(main([REPO, ...CHECKS])).toBe(0);
    expect(calls().slice(7)).toEqual([
      [['api', ENVS], undefined],
      [['api', LIST], undefined],
      [['api', DEV], undefined],
      [['api', LIST], undefined],
    ]);
    expect(out.slice(2)).toEqual(['dev: keep\n', SUMMARY]);
  });

  it('removes every other branch from dev by id, with no PUT when its policy is already custom', () => {
    reply(...RULE_REPLIES, devSet[0], { total_count: 2, branch_policies: [DEVELOP, { id: 2, name: 'main', type: 'branch' }] });
    gh.mockReturnValueOnce('');
    reply(CUSTOM, { total_count: 1, branch_policies: [DEVELOP] });
    expect(main([REPO, ...CHECKS])).toBe(0);
    expect(calls().slice(8, 10)).toEqual([
      [['api', LIST], undefined],
      [['api', '-X', 'DELETE', `${POLICIES}/2`], undefined],
    ]);
    expect(out.slice(2)).toEqual(['dev: set\n', SUMMARY]);
  });

  it('refuses to set the policy over a dev holding other protection rules, writing nothing', () => {
    const guarded = {
      name: 'dev',
      deployment_branch_policy: null,
      protection_rules: [{ type: 'required_reviewers' }, { type: 'wait_timer' }],
    };
    reply(...RULE_REPLIES, { total_count: 1, environments: [guarded] });
    expect(() => main([REPO, ...CHECKS])).toThrow(
      'dev has protection rules (required_reviewers, wait_timer) that setting its branch policy could drop: set its deployment branches to develop alone by hand, then run this again',
    );
    expect(gh).toHaveBeenCalledTimes(8);
  });

  it('fails, naming it, when dev’s policy did not take, and lists no policies GitHub would 404', () => {
    reply(
      ...RULE_REPLIES,
      { total_count: 0, environments: [] },
      {},
      { total_count: 0, branch_policies: [] },
      {},
      {
        deployment_branch_policy: null,
      },
    );
    expect(() => main([REPO, ...CHECKS])).toThrow(
      'read back, the dev environment still falls short:\n  dev: no deployment branch policy, so any branch may deploy',
    );
    expect(gh).toHaveBeenCalledTimes(12);
  });

  it('fails, naming it, when dev reads back with custom branches off, and lists no policies GitHub would 404', () => {
    reply(
      ...RULE_REPLIES,
      { total_count: 0, environments: [] },
      {},
      { total_count: 0, branch_policies: [] },
      {},
      {
        deployment_branch_policy: { protected_branches: false, custom_branch_policies: false },
      },
    );
    expect(() => main([REPO, ...CHECKS])).toThrow(
      'read back, the dev environment still falls short:\n  dev: names no custom branches, so develop alone is not set',
    );
    expect(gh).toHaveBeenCalledTimes(12);
  });

  it('refuses a policies list longer than the page it read', () => {
    reply(...RULE_REPLIES, devSet[0], { total_count: 101, branch_policies: [DEVELOP] });
    expect(() => main([REPO, ...CHECKS])).toThrow(`${LIST} lists 101 branch policies; one page of 100 was read`);
  });

  it('keeps a ruleset that matches and updates one that differs, by id', () => {
    const developRuleset = { id: 1, ...desiredRuleset('develop', CHECKS) };
    const mainRuleset = { id: 2, ...desiredRuleset('main', ['build-and-test']) };
    reply([{ id: 1 }, { id: 2 }], developRuleset, mainRuleset, {}, strict, mainRules, {}, deletes, ...devSet);
    expect(main([REPO, ...CHECKS])).toBe(0);
    expect(calls().slice(1, 4)).toEqual([
      [['api', `repos/${REPO}/rulesets/1`], undefined],
      [['api', `repos/${REPO}/rulesets/2`], undefined],
      [['api', '-X', 'PUT', `repos/${REPO}/rulesets/2`, '--input', '-'], JSON.stringify(desiredRuleset('main', CHECKS))],
    ]);
    expect(out.slice(0, 2)).toEqual(['develop: keep\n', 'main: update\n']);
  });

  it('fails, naming each shortfall, when the rules read back fall short', () => {
    reply([], {}, {}, strict, [mainRules[0], mainRules[2]]);
    expect(() => main([REPO, ...CHECKS])).toThrow('read back, the rules still fall short:\n  main: no rule requires a pull request');
    expect(gh).toHaveBeenCalledTimes(5);
  });

  it('fails, naming the setting, when the repository still keeps merged head branches', () => {
    reply([], {}, {}, strict, mainRules, {}, { delete_branch_on_merge: false });
    expect(() => main([REPO, ...CHECKS])).toThrow(
      'read back, the repository still falls short:\n  merged head branches are not deleted (delete_branch_on_merge is false)',
    );
  });
});
