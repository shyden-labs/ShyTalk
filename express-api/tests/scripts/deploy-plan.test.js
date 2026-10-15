'use strict';

/**
 * deploy-plan.test.js — SHY-0534.
 *
 * Shyden, 2026-10-14: a merge into `develop` deploys to dev on its own, and only
 * the areas the merge changed ("be sensible and only deploy what's got changes
 * to it"). `scripts/deploy-plan.js` is the one place deploy-dev.yml decides
 * what a run deploys:
 *
 *   area deploys  =  requested  AND  changed
 *
 * where "changed" is scripts/deploy-scope.sh's verdict (SHY-0347) and
 * "requested" is the dispatch form's checkbox on a hand-started run, and
 * everything on a push or the daily catch-up (nobody is there to tick boxes).
 * Loaded in-process: no git, no network, no child process.
 */

const { plan, parseScope, asOutputs } = require('../../../scripts/deploy-plan.js');

const ALL_CHANGED = 'backend=true\nweb=true\nandroid=true\nios=true\nreason=derived-from-diff\n';
const ONLY_WEB = 'backend=false\nweb=true\nandroid=false\nios=false\nreason=derived-from-diff\n';
const NOTHING = 'backend=false\nweb=false\nandroid=false\nios=false\nreason=derived-from-diff\n';
const FAIL_SAFE =
  'backend=true\nweb=true\nandroid=true\nios=true\nreason=no-diff-available-failing-safe\n';

/** Every dispatch checkbox ticked, as GitHub renders booleans into env. */
const TICKED = {
  backend: 'true',
  web: 'true',
  'android-testers': 'true',
  'ios-testers': 'true',
  'seed-personas': 'true',
  playwright: 'true',
};

const base = { baseline: 'aaa1111', head: 'bbb2222', inputs: {} };

describe('parseScope', () => {
  test('reads each area and the reason', () => {
    expect(parseScope(ONLY_WEB)).toEqual({
      changed: { backend: false, web: true, android: false, ios: false },
      reason: 'derived-from-diff',
    });
  });

  test('refuses output with an area missing, naming it', () => {
    expect(() => parseScope('backend=true\nweb=true\nandroid=true\nreason=x\n')).toThrow(/ios/);
  });

  test('refuses an area that is neither true nor false', () => {
    expect(() => parseScope('backend=yes\nweb=true\nandroid=true\nios=true\nreason=x\n')).toThrow(
      /backend/,
    );
  });

  test('refuses output with no reason', () => {
    expect(() => parseScope('backend=true\nweb=true\nandroid=true\nios=true\n')).toThrow(/reason/);
  });
});

describe('a push to develop', () => {
  test('deploys every area the merge changed, with nobody ticking boxes', () => {
    expect(plan({ ...base, event: 'push', scope: ALL_CHANGED })).toMatchObject({
      backend: true,
      web: true,
      android: true,
      ios: true,
      seed: true,
      checks: true,
    });
  });

  test('deploys only the area the merge changed', () => {
    expect(plan({ ...base, event: 'push', scope: ONLY_WEB })).toMatchObject({
      backend: false,
      web: true,
      android: false,
      ios: false,
    });
  });

  test('a merge that changes nothing deployable deploys nothing', () => {
    expect(plan({ ...base, event: 'push', scope: NOTHING })).toMatchObject({
      backend: false,
      web: false,
      android: false,
      ios: false,
    });
  });

  test('ignores dispatch inputs, which a push does not have', () => {
    expect(
      plan({ ...base, event: 'push', scope: ALL_CHANGED, inputs: { backend: 'false' } }).backend,
    ).toBe(true);
  });

  test('when the scope could not be worked out, fails safe to every area', () => {
    expect(plan({ ...base, event: 'push', scope: FAIL_SAFE })).toMatchObject({
      backend: true,
      web: true,
      android: true,
      ios: true,
      reason: 'no-diff-available-failing-safe',
    });
  });
});

describe('a hand-started dispatch', () => {
  test('deploys a changed area only when its box is ticked', () => {
    const p = plan({
      ...base,
      event: 'workflow_dispatch',
      scope: ALL_CHANGED,
      inputs: { ...TICKED, web: 'false', 'ios-testers': 'false' },
    });
    expect(p).toMatchObject({ backend: true, web: false, android: true, ios: false });
  });

  test('a ticked box does not deploy an area the change did not touch', () => {
    expect(
      plan({ ...base, event: 'workflow_dispatch', scope: ONLY_WEB, inputs: TICKED }).backend,
    ).toBe(false);
  });

  test('the persona seed follows its box', () => {
    expect(
      plan({
        ...base,
        event: 'workflow_dispatch',
        scope: ALL_CHANGED,
        inputs: { ...TICKED, 'seed-personas': 'false' },
      }).seed,
    ).toBe(false);
  });

  test('the sanity checks follow the playwright box', () => {
    expect(
      plan({
        ...base,
        event: 'workflow_dispatch',
        scope: ALL_CHANGED,
        inputs: { ...TICKED, playwright: 'false' },
      }).checks,
    ).toBe(false);
  });

  test('refuses a box that is neither true nor false, naming it', () => {
    expect(() =>
      plan({
        ...base,
        event: 'workflow_dispatch',
        scope: ALL_CHANGED,
        inputs: { ...TICKED, web: '' },
      }),
    ).toThrow(/web/);
  });
});

describe('the daily catch-up', () => {
  test("when dev already holds develop's head, deploys nothing and says so", () => {
    expect(
      plan({ event: 'schedule', baseline: 'ccc3333', head: 'ccc3333', scope: NOTHING, inputs: {} }),
    ).toMatchObject({
      backend: false,
      web: false,
      android: false,
      ios: false,
      seed: false,
      checks: false,
      reason: 'dev-current',
    });
  });

  test('even a fail-safe scope does not deploy when dev is current', () => {
    expect(
      plan({
        event: 'schedule',
        baseline: 'ccc3333',
        head: 'ccc3333',
        scope: FAIL_SAFE,
        inputs: {},
      }).backend,
    ).toBe(false);
  });

  test('when develop has moved, deploys what changed since the last dev deploy', () => {
    expect(plan({ ...base, event: 'schedule', scope: ONLY_WEB })).toMatchObject({
      web: true,
      backend: false,
      reason: 'derived-from-diff',
    });
  });

  test('with no baseline, fails safe and deploys', () => {
    expect(
      plan({
        event: 'schedule',
        baseline: 'unresolved',
        head: 'ccc3333',
        scope: FAIL_SAFE,
        inputs: {},
      }).backend,
    ).toBe(true);
  });
});

describe('only these three triggers', () => {
  test('refuses any other event, naming it', () => {
    expect(() => plan({ ...base, event: 'pull_request', scope: ALL_CHANGED })).toThrow(
      /pull_request/,
    );
  });
});

describe('asOutputs', () => {
  test('writes every decision and what changed, for the jobs and the summary', () => {
    const out = asOutputs(plan({ ...base, event: 'push', scope: ONLY_WEB }), 'push');
    expect(out.split('\n')).toEqual([
      'backend=false',
      'web=true',
      'android=false',
      'ios=false',
      'seed=true',
      'checks=true',
      'changed_backend=false',
      'changed_web=true',
      'changed_android=false',
      'changed_ios=false',
      'reason=derived-from-diff',
      'trigger=push',
      '',
    ]);
  });
});
