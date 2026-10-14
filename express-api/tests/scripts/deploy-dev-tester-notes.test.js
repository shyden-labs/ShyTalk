'use strict';

/**
 * deploy-dev-tester-notes.test.js — SHY-0361.
 *
 * Pins how deploy-dev.yml wires the tester notes: the change-list job, the
 * note each app job writes before it distributes, and the TestFlight "What to
 * Test" step. The scripts' behaviour is tested beside them (tester-notes,
 * list-build-changes, set-testflight-whats-new); this file pins only the
 * wiring, which no script test can see.
 */

const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const yaml = require('js-yaml');

const WORKFLOW = join(__dirname, '..', '..', '..', '.github', 'workflows', 'deploy-dev.yml');
const wf = yaml.load(readFileSync(WORKFLOW, 'utf8'));
const jobs = wf.jobs;

const stepNames = (job) => jobs[job].steps.map((s) => s.name ?? s.uses);
const step = (job, name) => {
  const found = jobs[job].steps.filter((s) => s.name === name);
  if (found.length !== 1) throw new Error(`${job} has ${found.length} steps named "${name}"`);
  return found[0];
};

describe('list-build-changes', () => {
  test('needs the scope job, whose baseline it lists from', () => {
    expect(jobs['list-build-changes'].needs).toBe('detect-deploy-scope');
  });

  test('lists from that baseline', () => {
    expect(step('list-build-changes', 'List the commits since the last dev deploy').env).toEqual({
      BASELINE: '${{ needs.detect-deploy-scope.outputs.baseline }}',
    });
  });

  test('runs the script and hands its output on as the job output', () => {
    expect(step('list-build-changes', 'List the commits since the last dev deploy').run).toBe(
      'node scripts/list-build-changes.js >> "$GITHUB_OUTPUT"',
    );
    expect(jobs['list-build-changes'].outputs.changes).toBe('${{ steps.list.outputs.changes }}');
  });

  test('checks out full history, so the baseline is reachable', () => {
    expect(jobs['list-build-changes'].steps[0].with['fetch-depth']).toBe(0);
  });

  test('neither backend nor web waits on it', () => {
    expect([jobs['deploy-backend-dev'].needs, jobs['deploy-web-dev'].needs].flat()).not.toContain(
      'list-build-changes',
    );
  });
});

describe.each([
  ['distribute-android', 'android', 'Upload to Firebase App Distribution'],
  ['distribute-ios', 'ios', 'Upload to TestFlight'],
])('%s', (job, platform, upload) => {
  test('needs the change list', () => {
    expect(jobs[job].needs).toContain('list-build-changes');
  });

  test('runs only when the change list succeeded', () => {
    expect(jobs[job].if).toContain("needs.list-build-changes.result == 'success'");
  });

  test(`writes the ${platform} note before it distributes`, () => {
    const names = stepNames(job);
    expect(names.indexOf('Write tester notes')).toBeGreaterThan(-1);
    expect(names.indexOf('Write tester notes')).toBeLessThan(names.indexOf(upload));
  });

  test(`the note is the ${platform} one`, () => {
    expect(step(job, 'Write tester notes').run).toContain(
      `node scripts/tester-notes.js ${platform} >`,
    );
  });

  test('the note is built from the change list, the ref, the trigger and the hand-written input', () => {
    expect(step(job, 'Write tester notes').env).toMatchObject({
      CHANGES: '${{ needs.list-build-changes.outputs.changes }}',
      DEPLOY_REF: "${{ inputs.ref != '' && inputs.ref || github.ref_name }}",
      DEPLOY_TRIGGER: '${{ github.event_name }}',
      RELEASE_NOTES_INPUT: '${{ inputs.release-notes }}',
    });
  });

  test('the note names the sha this job checked out', () => {
    const notes = step(job, 'Write tester notes');
    const fromStep = notes.env.DEPLOY_SHA === '${{ steps.deployed-sha.outputs.sha }}';
    const fromHead = notes.run.includes(
      'DEPLOY_SHA="$(git rev-parse HEAD)" node scripts/tester-notes.js',
    );
    // Android already resolves it in its `deployed-sha` step; iOS has no such step.
    expect([job, fromStep, fromHead]).toEqual(
      job === 'distribute-android' ? [job, true, false] : [job, false, true],
    );
  });

  test('the note step fails on a fault rather than carrying on', () => {
    const run = step(job, 'Write tester notes').run;
    expect(run.startsWith('set -euo pipefail\n')).toBe(true);
    expect(run).not.toMatch(/\|\| true|continue-on-error/);
    expect(step(job, 'Write tester notes')['continue-on-error']).toBeUndefined();
  });

  test('the note is echoed to the log', () => {
    expect(step(job, 'Write tester notes').run).toContain('cat "$notes_file"\n');
  });
});

describe('the notes reach testers', () => {
  test('Firebase App Distribution gets the written note', () => {
    expect(
      step('distribute-android', 'Upload to Firebase App Distribution').with.releaseNotes,
    ).toBe('${{ steps.notes.outputs.text }}');
  });

  test('TestFlight gets the same note, after the upload', () => {
    const names = stepNames('distribute-ios');
    expect(names.indexOf('Set TestFlight What to Test')).toBeGreaterThan(
      names.indexOf('Upload to TestFlight'),
    );
    expect(step('distribute-ios', 'Set TestFlight What to Test').run).toBe(
      'node scripts/set-testflight-whats-new.js',
    );
  });

  test('the TestFlight step finds the build by the number and version the archive used', () => {
    expect(step('distribute-ios', 'Set TestFlight What to Test').env).toMatchObject({
      TESTER_NOTES_FILE: '${{ steps.notes.outputs.file }}',
      BUILD_NUMBER: '${{ steps.archive.outputs.build_number }}',
      MARKETING_VERSION: '${{ steps.archive.outputs.marketing_version }}',
    });
    const archive = step('distribute-ios', 'Build, archive, and export iOS app');
    expect(archive.id).toBe('archive');
    expect(archive.run).toContain('echo "build_number=${BUILD_NUMBER}" >> "$GITHUB_OUTPUT"');
    expect(archive.run).toContain('echo "marketing_version=${VERSION_NAME}" >> "$GITHUB_OUTPUT"');
  });

  test('the TestFlight step is capped just above the 15-minute wait', () => {
    expect(step('distribute-ios', 'Set TestFlight What to Test')['timeout-minutes']).toBe(17);
  });

  test('signing material is still cleaned up last', () => {
    const names = stepNames('distribute-ios');
    expect(names.indexOf('Clean up signing material')).toBeGreaterThan(
      names.indexOf('Set TestFlight What to Test'),
    );
  });
});

describe('the hand-dispatch inputs stay', () => {
  test('release-notes is still an input', () => {
    expect(wf.on.workflow_dispatch.inputs['release-notes'].type).toBe('string');
  });
});
