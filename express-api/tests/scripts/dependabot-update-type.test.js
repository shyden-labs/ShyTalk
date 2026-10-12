/**
 * dependabot-update-type.test.js — SHY-0569.
 *
 * PR #2190's head commit said "Bump firebase from 12.18.0 to 13.0.0" while
 * its metadata block said 12.19.0 / semver-minor; fetch-metadata trusted the
 * block and auto-merge armed a major update. judge() reads the version pairs
 * from Dependabot's own sentences in the title and body, and allows auto-merge
 * only when every pair AND the metadata agree it is a patch or minor update.
 * Everything here runs in-process; the workflow pins read the YAML file.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const REPO = path.resolve(__dirname, '../../..');
const { judge } = require(path.join(REPO, 'scripts/dependabot-update-type.js'));

const MINOR = 'version-update:semver-minor';
const PATCH = 'version-update:semver-patch';
const MAJOR = 'version-update:semver-major';

describe('SHY-0569 — the #2190 sequence is refused', () => {
  test('a title and body saying a major, with metadata saying minor, is refused', () => {
    const verdict = judge({
      title: 'chore(deps-dev): Bump firebase from 12.18.0 to 13.0.0',
      body: 'Bumps [firebase](https://github.com/firebase/firebase-js-sdk) from 12.18.0 to 13.0.0.\n- [Commits](https://github.com/firebase/firebase-js-sdk/compare/firebase@12.18.0...firebase@13.0.0)',
      updateType: MINOR,
      ecosystem: 'npm_and_yarn',
    });
    expect(verdict).toEqual({
      merge: false,
      reason: 'firebase 12.18.0 -> 13.0.0 is a major change',
      pairs: ['firebase 12.18.0 -> 13.0.0', 'firebase 12.18.0 -> 13.0.0'],
    });
  });
});

describe('SHY-0569 — patch and minor updates still merge', () => {
  test('a minor update whose title, body and metadata agree is allowed', () => {
    expect(
      judge({
        title: 'chore(deps): Bump okhttp from 5.4.0 to 5.5.0',
        body: 'Bumps [okhttp](https://example.test) from 5.4.0 to 5.5.0.',
        updateType: MINOR,
        ecosystem: 'gradle',
      }),
    ).toEqual({
      merge: true,
      reason: 'every pair is a patch or minor change',
      pairs: ['okhttp 5.4.0 -> 5.5.0', 'okhttp 5.4.0 -> 5.5.0'],
    });
  });

  test('a patch update is allowed', () => {
    expect(
      judge({
        title: 'Bump sharp from 0.35.4 to 0.35.5',
        body: '',
        updateType: PATCH,
        ecosystem: 'npm_and_yarn',
      }).merge,
    ).toBe(true);
  });

  test('a grouped update is judged on every pair it lists', () => {
    expect(
      judge({
        title: 'Bump the patch-updates group with 2 updates',
        body: 'Updates `sharp` from 0.35.4 to 0.35.5\nUpdates `undici` from 7.1.0 to 7.1.1',
        updateType: PATCH,
        ecosystem: 'npm_and_yarn',
      }),
    ).toEqual({
      merge: true,
      reason: 'every pair is a patch or minor change',
      pairs: ['sharp 0.35.4 -> 0.35.5', 'undici 7.1.0 -> 7.1.1'],
    });
  });

  test('a date-shaped version moving its second number is a minor change', () => {
    expect(
      judge({
        title: 'Bump androidx.compose:compose-bom from 2026.08.00 to 2026.09.00',
        body: '',
        updateType: MINOR,
        ecosystem: 'gradle',
      }).merge,
    ).toBe(true);
  });

  test('a v-prefixed version is read', () => {
    expect(
      judge({
        title: 'Bump github/codeql-action from v4.37.9 to v4.38.3',
        body: '',
        updateType: MINOR,
        ecosystem: 'npm_and_yarn',
      }).merge,
    ).toBe(true);
  });

  test('GitHub Actions updates keep their SHA-pinned exception, majors included', () => {
    expect(
      judge({
        title: 'Bump actions/setup-node from 7.1.0 to 8.0.0',
        body: '',
        updateType: MAJOR,
        ecosystem: 'github_actions',
      }),
    ).toEqual({
      merge: true,
      reason: 'GitHub Actions are SHA-pinned',
      pairs: ['actions/setup-node 7.1.0 -> 8.0.0'],
    });
  });
});

describe('SHY-0569 — anything doubtful stays off', () => {
  test('a major update named in the metadata is refused', () => {
    expect(
      judge({
        title: 'Bump nodemailer from 9.1.1 to 10.0.16',
        body: '',
        updateType: MAJOR,
        ecosystem: 'npm_and_yarn',
      }).reason,
    ).toBe('the metadata says version-update:semver-major');
  });

  test('a minor title with major metadata is refused', () => {
    expect(
      judge({
        title: 'Bump x from 1.2.0 to 1.3.0',
        body: '',
        updateType: MAJOR,
        ecosystem: 'npm_and_yarn',
      }).merge,
    ).toBe(false);
  });

  test('missing metadata is refused', () => {
    expect(
      judge({
        title: 'Bump x from 1.2.0 to 1.3.0',
        body: '',
        updateType: '',
        ecosystem: 'npm_and_yarn',
      }),
    ).toEqual({ merge: false, reason: 'the metadata says nothing', pairs: ['x 1.2.0 -> 1.3.0'] });
  });

  test('a PR naming no version pair is refused', () => {
    expect(
      judge({
        title: 'Bump the npm_and_yarn group across 2 directories with 9 updates',
        body: 'Release notes mention moving from webpack to vite.',
        updateType: MINOR,
        ecosystem: 'npm_and_yarn',
      }),
    ).toEqual({ merge: false, reason: 'no version pair in the title or body', pairs: [] });
  });

  test('a 0.x update moving its second number counts as major', () => {
    expect(
      judge({
        title: 'Bump x from 0.35.4 to 0.36.0',
        body: '',
        updateType: MINOR,
        ecosystem: 'npm_and_yarn',
      }).reason,
    ).toBe('x 0.35.4 -> 0.36.0 is a major change');
  });

  test('a version that cannot be read is refused', () => {
    expect(
      judge({
        title: 'Bump x from latest to 2.0.0',
        body: '',
        updateType: MINOR,
        ecosystem: 'npm_and_yarn',
      }),
    ).toEqual({
      merge: false,
      reason: 'cannot read the versions in "x from latest to 2.0.0"',
      pairs: [],
    });
  });

  test('one major pair in a group refuses the whole PR', () => {
    expect(
      judge({
        title: 'Bump the patch-updates group with 2 updates',
        body: 'Updates `sharp` from 0.35.4 to 0.35.5\nUpdates `react` from 18.3.1 to 19.0.0',
        updateType: MINOR,
        ecosystem: 'npm_and_yarn',
      }).reason,
    ).toBe('react 18.3.1 -> 19.0.0 is a major change');
  });
});

describe('SHY-0569 — the workflow uses the judge and switches auto-merge off', () => {
  const workflow = yaml.load(
    fs.readFileSync(path.join(REPO, '.github/workflows/dependabot-auto-merge.yml'), 'utf8'),
  );
  const steps = workflow.jobs['auto-merge'].steps;
  const named = (name) => steps.filter((s) => s.name === name);

  test('the judge runs from the base branch, without the PR token kept', () => {
    expect(named('Check out the base branch (never the PR code)')).toEqual([
      {
        name: 'Check out the base branch (never the PR code)',
        uses: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
        with: { ref: '${{ github.event.pull_request.base.sha }}', 'persist-credentials': false },
      },
    ]);
  });

  test('unreadable metadata does not stop the job before auto-merge is switched off', () => {
    expect(named('Fetch Dependabot metadata')[0]['continue-on-error']).toBe(true);
  });

  test('the decision comes from the judge, fed the PR title and body', () => {
    const check = named('Determine if auto-mergeable')[0];
    expect({ run: check.run.trim(), env: Object.keys(check.env).sort() }).toEqual({
      run: 'node scripts/dependabot-update-type.js',
      env: ['BODY', 'ECOSYSTEM', 'TITLE', 'UPDATE_TYPE'],
    });
  });

  test('approve and arm only on a yes', () => {
    expect([named('Auto-approve')[0].if, named('Auto-merge')[0].if]).toEqual([
      "steps.check.outputs.merge == 'true'",
      "steps.check.outputs.merge == 'true'",
    ]);
  });

  test('every other outcome switches auto-merge off', () => {
    const off = named('Switch auto-merge off')[0];
    expect({
      if: off.if,
      disables: off.run.includes('gh pr merge --disable-auto "$PR_URL"'),
    }).toEqual({
      if: "always() && steps.check.outputs.merge != 'true'",
      disables: true,
    });
  });
});
