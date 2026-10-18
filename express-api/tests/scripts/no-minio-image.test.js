/**
 * no-minio-image.test.js — SHY-0544.
 *
 * MinIO deleted `minio/minio` and `minio/mc` from Docker Hub on 2026-09-11,
 * and every backend run then failed at "pull access denied" before a test
 * ran. The local and CI stacks now start versitygw as the S3 stand-in. This
 * guard refuses the dead image names and MinIO's health path in every
 * workflow, action, compose and script file, so a snippet copied from an
 * old branch or an old README cannot bring the dead pull back.
 *
 * The file set is walked from the filesystem, never listed by hand, and the
 * verdict carries the number of files read beside the findings, so a walk
 * that silently reads nothing cannot pass.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '../../..');
// express-api/tests is left out: it holds this guard, whose plants name the
// dead image on purpose. Every other tree that starts, waits on or calls
// the stand-in is read.
const ROOTS = ['.github', 'local', 'scripts', 'express-api/scripts', 'express-api/src', 'tests'];
const KINDS = /\.(ya?ml|sh|ps1|js|mjs|cjs|ts|json)$/;
// Registries treat repository paths case-insensitively, so every spelling
// is matched without regard to case.
const DEAD_NAMES = [/minio\/minio\b/gi, /minio\/mc\b/gi, /\/minio\/health\b/gi];
// Measured 2026-10-12: files under ROOTS with a KINDS extension. Equality,
// so a file added or lost under ROOTS is seen and this figure re-measured.
// 460 -> 461: local/seed-steps.js (01d13590). 461 -> 462:
// scripts/scan-secrets.js (SHY-0565). 462 -> 463: scripts/story-progress.js
// (SHY-0535). 463 -> 464: scripts/dependabot-update-type.js (SHY-0569).
// 464 -> 465: scripts/check-orphaned-stories.js (SHY-0583). 465 -> 469:
// scripts/tester-notes.js, list-build-changes.js, app-store-connect.js and
// set-testflight-whats-new.js (SHY-0361). 469 -> 471: scripts/deploy-plan.js
// and deploy-failure-issue.js (SHY-0534). 471 -> 472:
// tests/web/helpers/admin-autosave.ts (SHY-0597). 472 -> 475:
// express-api/src/utils/auto-bans.js, end-suspension.js and warnings.js
// (SHY-0605). 475 -> 476: scripts/sonar-verdict.js (SHY-0625).
// SHY-0556 moves this figure to the floors record.
const FILES_READ_FLOOR = 476;

function findDeadNames(text) {
  return DEAD_NAMES.flatMap((re) => text.match(re) ?? []);
}

function scan(repoRoot, roots) {
  const files = roots.flatMap((root) =>
    fs
      .readdirSync(path.join(repoRoot, root), { recursive: true })
      .map((rel) => path.join(root, rel))
      .filter((rel) => !rel.split(path.sep).includes('node_modules'))
      .filter((rel) => KINDS.test(rel) && fs.statSync(path.join(repoRoot, rel)).isFile()),
  );
  const findings = files.flatMap((rel) =>
    findDeadNames(fs.readFileSync(path.join(repoRoot, rel), 'utf8')).map(
      (name) => `${rel}: ${name}`,
    ),
  );
  return { files, findings };
}

describe('SHY-0544 — no file pulls or probes the withdrawn MinIO image', () => {
  const { files, findings } = scan(REPO, ROOTS);

  test('no workflow, action, compose or script file names the MinIO image or health path', () => {
    expect({ filesRead: files.length, findings }).toEqual({
      filesRead: FILES_READ_FLOOR,
      findings: [],
    });
  });

  test.each(ROOTS)('the walk reads at least one file under %s', (root) => {
    expect(files.filter((rel) => rel.startsWith(root + path.sep)).length).toBeGreaterThan(0);
  });

  test.each([
    'local/docker-compose.yml',
    '.github/actions/start-local-services/action.yml',
    '.github/workflows/test-backend.yml',
    '.github/workflows/sonarcloud.yml',
    'local/start.sh',
    'local/start.ps1',
  ])('the walk reads %s, a file that starts or waits on the stand-in', (rel) => {
    expect(files).toContain(rel);
  });
});

describe('SHY-0544 — findDeadNames recognises every form the stack wrote', () => {
  test.each([
    ['a compose image line', '    image: minio/minio:RELEASE.2025-09-07T16-13-09Z', 'minio/minio'],
    [
      'a docker run argument',
      '  minio/minio:RELEASE.2025-09-07T16-13-09Z server /data',
      'minio/minio',
    ],
    ['the client image', 'docker run --rm minio/mc:latest alias set', 'minio/mc'],
    ['the curl health probe', 'curl -sf http://localhost:9002/minio/health/live', '/minio/health'],
    [
      'the PowerShell readiness probe',
      '-Uri "http://localhost:9002/minio/health/ready"',
      '/minio/health',
    ],
    ['an upper-case image name', 'image: MINIO/MINIO:latest', 'MINIO/MINIO'],
    ['an image with a registry host', 'image: quay.io/minio/minio:latest', 'minio/minio'],
  ])('finds %s', (_form, line, expected) => {
    expect(findDeadNames(line)).toEqual([expected]);
  });

  test.each([
    ['the stand-in image', 'image: versity/versitygw:v1.8.0@sha256:30292f'],
    ['the stand-in health path', 'curl -sf http://localhost:9002/health'],
    ['prose naming the old tool', '# MinIO was the local stand-in until SHY-0544'],
  ])('passes %s', (_form, line) => {
    expect(findDeadNames(line)).toEqual([]);
  });
});

describe('SHY-0544 — a planted name in a scanned file turns the verdict red', () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'shy0544-'));
    fs.mkdirSync(path.join(root, 'local', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(root, 'local', 'clean.yml'), 'image: versity/versitygw:v1.8.0\n');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test.each([
    ['local/docker-compose.yml', 'image: minio/minio:RELEASE.2025-09-07T16-13-09Z\n'],
    ['local/nested/start.sh', 'curl -sf http://localhost:9002/minio/health/live\n'],
    ['local/start.ps1', 'Invoke-WebRequest -Uri "http://localhost:9002/minio/health/live"\n'],
  ])('a planted %s is reported by path', (rel, body) => {
    fs.writeFileSync(path.join(root, rel), body);
    const { files, findings } = scan(root, ['local']);
    expect({ filesRead: files.length, findings: findings.map((f) => f.split(':')[0]) }).toEqual({
      filesRead: 2,
      findings: [path.join(...rel.split('/'))],
    });
  });

  test('a file outside the scanned kinds is not read', () => {
    fs.writeFileSync(path.join(root, 'local', 'notes.md'), 'minio/minio\n');
    expect(scan(root, ['local'])).toEqual({
      files: [path.join('local', 'clean.yml')],
      findings: [],
    });
  });

  test('a file under node_modules is not read', () => {
    fs.mkdirSync(path.join(root, 'local', 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(root, 'local', 'node_modules', 'pkg', 'index.js'), 'minio/minio\n');
    expect(scan(root, ['local'])).toEqual({
      files: [path.join('local', 'clean.yml')],
      findings: [],
    });
  });
});
