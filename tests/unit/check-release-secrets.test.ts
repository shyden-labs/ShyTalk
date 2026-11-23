import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { main, RELEASE_SECRETS_FILE } from '../../scripts/check-release-secrets.ts';
import { withoutYamlComments, withoutYamlQuotes, yamlBlock as topLevel } from './source-text.ts';

/**
 * A release finds a missing secret before anything deploys (shyden-labs/ShyTalk#330; Shyden 2026-11-23: check at
 * job start, no new credential). One list names every secret deploy-release reads, per environment; the job's first
 * step after Node is set up checks each is set, by name only, and fails naming each one missing.
 */

const WORKFLOW = '.github/workflows/deploy-release.yml';
const workflow = () => withoutYamlQuotes(withoutYamlComments(readFileSync(WORKFLOW, 'utf8')));
const list = JSON.parse(readFileSync(RELEASE_SECRETS_FILE, 'utf8')) as Record<string, string[]>;
const read = (path: string): string => {
  if (path !== RELEASE_SECRETS_FILE) throw new Error(`read an unexpected file: ${path}`);
  return JSON.stringify({ test: ['CLOUDFLARE_API_TOKEN', 'SITE_PASSWORD'], production: ['CLOUDFLARE_API_TOKEN', 'TOTP_KEY', 'OCI_USER'] });
};

const run = async (env: Record<string, string | undefined>) => {
  const lines: string[] = [];
  const code = await main([], env, read, (line) => lines.push(line));
  return { code, lines };
};

describe('check-release-secrets', () => {
  it('passes and says so when the environment holds every listed secret', async () => {
    expect(await run({ RELEASE_ENVIRONMENT: 'production', CLOUDFLARE_API_TOKEN: 'a', TOTP_KEY: 'b', OCI_USER: 'c' })).toEqual({
      code: 0,
      lines: ['check-release-secrets: production holds all 3 secrets this release reads'],
    });
  });

  it('fails naming each missing or empty secret, and never a value', async () => {
    const failing = run({ RELEASE_ENVIRONMENT: 'production', CLOUDFLARE_API_TOKEN: 'the-token-value', TOTP_KEY: '' });
    await expect(failing).rejects.toThrow(
      'check-release-secrets: production is missing TOTP_KEY, OCI_USER; set each in the production environment before releasing',
    );
    await expect(failing).rejects.not.toThrow('the-token-value');
  });

  it('checks the test environment against its own list', async () => {
    await expect(run({ RELEASE_ENVIRONMENT: 'test', CLOUDFLARE_API_TOKEN: 'a', TOTP_KEY: 'b' })).rejects.toThrow(
      'check-release-secrets: test is missing SITE_PASSWORD; set each in the test environment before releasing',
    );
  });

  it.each([
    [{ CLOUDFLARE_API_TOKEN: 'a' }, 'check-release-secrets: missing RELEASE_ENVIRONMENT'],
    [{ RELEASE_ENVIRONMENT: 'dev' }, `check-release-secrets: ${RELEASE_SECRETS_FILE} lists no secrets for dev`],
  ])('refuses %j', async (env, message) => {
    await expect(run(env)).rejects.toThrow(message);
  });

  it('reads the real list and prints to standard output when nothing is stood in', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const secrets = Object.fromEntries((list['production'] ?? []).map((name) => [name, 'set']));
    expect(await main([], { RELEASE_ENVIRONMENT: 'production', ...secrets })).toBe(0);
    expect(write).toHaveBeenCalledWith('check-release-secrets: production holds all 9 secrets this release reads\n');
    write.mockRestore();
  });

  it('takes no arguments', async () => {
    await expect(main(['extra'], {}, read, () => undefined)).rejects.toThrow('usage: node scripts/check-release-secrets.ts');
  });

  it('lists every secret deploy-release reads, and only those, for test and for production', () => {
    const reads = [...new Set([...workflow().matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1]))].sort();
    expect([...new Set([...(list['test'] ?? []), ...(list['production'] ?? [])])].sort()).toEqual(reads);
    expect(Object.keys(list).sort()).toEqual(['production', 'test']);
  });

  it('lists for production every secret it reads but those only TEST takes', () => {
    expect([...(list['production'] ?? [])].sort()).toEqual([
      'BETTER_AUTH_SECRET',
      'CLOUDFLARE_API_TOKEN',
      'OCI_COMPARTMENT',
      'OCI_FINGERPRINT',
      'OCI_PRIVATE_KEY',
      'OCI_TENANCY',
      'OCI_USER',
      'ROADMAP_APP_KEY',
      'TOTP_KEY',
    ]);
    expect([...(list['test'] ?? [])].sort()).toEqual([...(list['production'] ?? []), 'DOOR_SECRET', 'SITE_PASSWORD'].sort());
  });

  it('runs the check right after Node is set up, before any install or deploy, on a real release only', () => {
    const steps = topLevel(workflow(), 'jobs').split('\n');
    const check = steps.indexOf('      - name: Every secret this release reads is set');
    const setupNode = steps.findIndex((line) => line.includes('uses: actions/setup-node@'));
    const install = steps.indexOf('      - run: node scripts/npm-ci.ts');
    expect(check).toBeGreaterThan(setupNode);
    expect(setupNode).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(check);
    expect(steps.slice(check, install)).toEqual([
      '      - name: Every secret this release reads is set',
      '        if: ${{ github.event_name != pull_request }}',
      '        env:',
      '          RELEASE_ENVIRONMENT: ${{ github.ref == refs/heads/main && production || test }}',
      // Each listed secret by name, and no other (SonarCloud githubactions:S7634): test's list holds production's.
      ...(list['test'] ?? []).map((name) => `          ${name}: \${{ secrets.${name} }}`),
      '        run: node scripts/check-release-secrets.ts',
    ]);
  });
});
