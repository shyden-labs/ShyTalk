/**
 * s3-stand-in-pin.test.js — SHY-0544.
 *
 * The local S3 stand-in (versitygw) is started in two places: the compose
 * file a developer runs and the composite action CI runs. Dependabot can
 * read the compose file but not a `docker run` line inside an action, so a
 * bump would move one pin and leave the other behind. These tests hold the
 * two to ONE image reference, pinned by digest, and require Dependabot to
 * watch the compose file. They also hold the health path every waiter
 * polls to the one the container is told to serve.
 */
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const REPO = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

const DIGEST_PINNED = /^versity\/versitygw:v\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/;

const compose = yaml.load(read('local/docker-compose.yml'));
const action = read('.github/actions/start-local-services/action.yml');
const dependabot = yaml.load(read('.github/dependabot.yml'));

describe('SHY-0544 — one digest-pinned image for the S3 stand-in', () => {
  const image = compose.services.s3.image;

  test('the compose s3 service is pinned by version AND digest', () => {
    expect(image).toMatch(DIGEST_PINNED);
  });

  test('the CI action starts the very same image reference', () => {
    const started = action.match(/versity\/versitygw[^\s\\]*/g);
    expect(started).toEqual([image]);
  });
});

describe('SHY-0544 — every waiter polls the path the stand-in serves', () => {
  const command = compose.services.s3.command;

  test('compose tells versitygw to serve /health', () => {
    expect(command).toMatch(/(^|\s)--health \/health(\s|$)/);
  });

  test('the CI action tells versitygw to serve /health', () => {
    expect(action).toMatch(/(^|\s)--health \/health(\s|$)/m);
  });

  test.each([
    '.github/workflows/test-backend.yml',
    '.github/workflows/sonarcloud.yml',
    'local/start.sh',
    'local/start.ps1',
    'tests/integration/global-setup.ts',
  ])('%s waits on http://localhost:9002/health', (rel) => {
    expect(read(rel)).toContain('http://localhost:9002/health');
  });
});

describe('SHY-0544 — Dependabot watches the stand-in image', () => {
  const entries = dependabot.updates.filter((u) => u['package-ecosystem'] === 'docker-compose');

  test('one docker-compose ecosystem entry covers /local, targeting develop', () => {
    expect(entries.map((u) => ({ directory: u.directory, target: u['target-branch'] }))).toEqual([
      { directory: '/local', target: 'develop' },
    ]);
  });
});
