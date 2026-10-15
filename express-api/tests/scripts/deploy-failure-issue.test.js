'use strict';

/**
 * deploy-failure-issue.test.js — SHY-0534.
 *
 * An automatic dev deploy (a push to develop, or the daily catch-up) has nobody
 * watching it, so a failure must reach someone on its own: one tracking issue,
 * assigned to Shyden, commented on while it stays open, closed by the next
 * automatic run that succeeds. `scripts/deploy-failure-issue.js` decides which;
 * the workflow carries it out with gh. Loaded in-process: no gh, no network.
 */

const { TITLE, ASSIGNEE, failedJobs, decide } = require('../../../scripts/deploy-failure-issue.js');

const run = {
  url: 'https://github.com/shyden-labs/ShyTalk/actions/runs/42',
  sha: '661f0ae57223b5026f0bab14dcc335c00ea95016',
  trigger: 'push',
};

const GREEN = {
  'detect-deploy-scope': 'success',
  'deploy-backend-dev': 'success',
  'deploy-web-dev': 'skipped',
  'distribute-android': 'success',
};

describe('failedJobs', () => {
  test('names each job that failed or was cancelled, in the order given', () => {
    expect(
      failedJobs({
        'deploy-backend-dev': 'success',
        'distribute-ios': 'failure',
        'sanity-check': 'skipped',
        'smoke-tests': 'cancelled',
      }),
    ).toEqual(['distribute-ios (failure)', 'smoke-tests (cancelled)']);
  });

  test('success and skipped are not failures', () => {
    expect(failedJobs(GREEN)).toEqual([]);
  });

  test('refuses a result it does not know, rather than calling it green', () => {
    expect(() => failedJobs({ 'deploy-web-dev': '' })).toThrow(/deploy-web-dev/);
  });

  test('refuses an empty result set, which would read as green', () => {
    expect(() => failedJobs({})).toThrow(/no job results/);
  });
});

describe('decide', () => {
  test('a failure with no open issue opens one, assigned to Shyden, naming run, sha and jobs', () => {
    const action = decide({ results: { ...GREEN, 'distribute-ios': 'failure' }, open: [], run });
    expect(action).toMatchObject({ kind: 'open', title: TITLE, assignee: 'ShydenMcM' });
    expect(action.body).toContain(run.url);
    expect(action.body).toContain(run.sha);
    expect(action.body).toContain('distribute-ios (failure)');
    expect(action.body).toContain('push');
  });

  test('a failure with the issue already open comments on it instead of opening another', () => {
    const action = decide({
      results: { ...GREEN, 'smoke-tests': 'failure' },
      open: [{ number: 77, title: TITLE }],
      run,
    });
    expect(action).toMatchObject({ kind: 'comment', number: 77 });
    expect(action.body).toContain('smoke-tests (failure)');
  });

  test('a green run closes the open issue, saying which run fixed it', () => {
    const action = decide({ results: GREEN, open: [{ number: 77, title: TITLE }], run });
    expect(action).toMatchObject({ kind: 'close', number: 77 });
    expect(action.body).toContain(run.url);
  });

  test('a green run with no open issue does nothing', () => {
    expect(decide({ results: GREEN, open: [], run })).toEqual({ kind: 'none' });
  });

  test('an open issue with a different title is not this one', () => {
    expect(decide({ results: GREEN, open: [{ number: 5, title: `${TITLE} (old)` }], run })).toEqual(
      { kind: 'none' },
    );
  });

  test('two open issues with this title is a fault, not a guess', () => {
    expect(() =>
      decide({
        results: GREEN,
        open: [
          { number: 5, title: TITLE },
          { number: 6, title: TITLE },
        ],
        run,
      }),
    ).toThrow(/2 open issues/);
  });

  test("the assignee is Shyden's account", () => {
    expect(ASSIGNEE).toBe('ShydenMcM');
  });
});
