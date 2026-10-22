'use strict';

/**
 * pr-checks-rules-red-first.test.js — SHY-0657.
 *
 * Pins the CI wiring of the rules red-first step. It runs in the
 * test-backend job, after the main jest run (the emulators are up there),
 * against the PR's base SHA, which pr-checks passes in; the job checks out
 * at depth 1, so the step fetches the base commit first. It is required
 * through PR Gate (Shyden, 2026-10-21): PR Gate fails when test-backend
 * fails, and also when firestore.rules changed but test-backend did not
 * succeed, so a skipped job cannot go green on a rules change.
 *
 * Read through js-yaml, so nothing in a comment counts.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const WORKFLOWS = path.resolve(__dirname, '..', '..', '..', '.github', 'workflows');
const load = (name) => yaml.load(fs.readFileSync(path.join(WORKFLOWS, name), 'utf8'));
const backend = load('test-backend.yml');
const prChecks = load('pr-checks.yml');
const STEP = 'Rules red-first: every rules change is proven on the base rules';
const lines = (run) =>
  String(run)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

describe('test-backend.yml', () => {
  const steps = backend.jobs['test-backend'].steps;
  const step = steps.find((s) => s.name === STEP);

  test('takes the base SHA as an optional string input', () => {
    expect(backend.on.workflow_call.inputs.base_sha).toEqual({
      description: expect.any(String),
      type: 'string',
      required: false,
      default: '',
    });
  });

  test('runs the step straight after the main jest run', () => {
    const names = steps.map((s) => s.name);
    expect(names.indexOf(STEP)).toBe(names.indexOf('Run Express API tests with coverage') + 1);
  });

  test('runs it whenever a base SHA is given, with no way to carry on past a failure', () => {
    expect({ if: step.if, continueOnError: step['continue-on-error'] }).toEqual({
      if: "inputs.base_sha != ''",
      continueOnError: undefined,
    });
  });

  test('hands the base SHA over by env, never inline in the script', () => {
    expect(step.env).toEqual({ BASE_SHA: '${{ inputs.base_sha }}' });
    expect(step.run).not.toContain('${{');
  });

  test('fetches the base commit, then runs the red-first script, and nothing else', () => {
    expect(lines(step.run)).toEqual([
      'git fetch --no-tags --depth=1 origin "$BASE_SHA"',
      'node express-api/scripts/rules-red-first.js',
    ]);
  });
});

describe('pr-checks.yml', () => {
  const detect = prChecks.jobs['detect-changes'];
  const detectRun = detect.steps.find((s) => s.id === 'changes').run;
  const gateRun = prChecks.jobs.gate.steps.find((s) => s.name === 'Evaluate results').run;

  test('passes the PR base SHA to test-backend', () => {
    expect(prChecks.jobs['test-backend'].with.base_sha).toBe(
      '${{ github.event.pull_request.base.sha }}',
    );
  });

  test('detect-changes outputs rules_changed', () => {
    expect(detect.outputs.rules_changed).toBe('${{ steps.changes.outputs.rules_changed }}');
  });

  test('rules_changed is set for firestore.rules alone, ahead of the first-match case', () => {
    const l = lines(detectRun);
    const init = l.findIndex((x) => /^ANDROID_APP=false .*\bRULES=false\b/.test(x));
    const set = l.indexOf('[ "$file" = "firestore.rules" ] && RULES=true');
    const caseAt = l.indexOf('case "$file" in');
    expect({ init: init >= 0, setBeforeCase: set >= 0 && set < caseAt && set > init }).toEqual({
      init: true,
      setBeforeCase: true,
    });
    expect(l.find((x) => x.startsWith('for v in '))).toContain(' rules_changed=$RULES ');
  });

  test('PR Gate fails when the rules changed and test-backend did not succeed', () => {
    const l = lines(gateRun);
    const check = l.indexOf(
      'if [ "${{ needs.detect-changes.outputs.rules_changed }}" = "true" ] && [ "${{ needs.test-backend.result }}" != "success" ]; then',
    );
    const passed = l.indexOf('echo "All checks passed or were correctly skipped"');
    expect({ check: check >= 0, before: check < passed }).toEqual({ check: true, before: true });
    expect(l.slice(check + 1, check + 3)).toEqual([
      'echo "firestore.rules changed, so test-backend (rules red-first) must succeed: ${{ needs.test-backend.result }}"',
      'exit 1',
    ]);
  });
});
