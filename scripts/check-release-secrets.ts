/**
 * Checks, before anything deploys, that the release's GitHub environment holds every secret deploy-release reads
 * (shyden-labs/ShyTalk#330; Shyden 2026-11-23: check at job start, no new credential). The first step after Node is
 * set up runs it, with the environment's name and each listed secret by its own name, and no other (SonarCloud
 * githubactions:S7634):
 *
 *   RELEASE_ENVIRONMENT=production TOTP_KEY=… node scripts/check-release-secrets.ts
 *
 * The list is `.github/release-secrets.json`; a unit test fails if the workflow reads a secret it lacks. Only names are
 * printed, never a value. It imports nothing from npm, as it runs before the install.
 */
import { readFileSync } from 'node:fs';
import { runIfEntry } from './cli.ts';

export const RELEASE_SECRETS_FILE = '.github/release-secrets.json';

const NAME = 'check-release-secrets';

/** The line to print when every listed secret is held, or throws naming what is wrong. */
function check(args: string[], env: Record<string, string | undefined>, read: (path: string) => string): string {
  if (args.length > 0)
    throw new Error(
      `usage: node scripts/${NAME}.ts (no arguments; the workflow sets RELEASE_ENVIRONMENT and each secret in the environment)`,
    );
  const environment = env['RELEASE_ENVIRONMENT'];
  if (!environment) throw new Error(`${NAME}: missing RELEASE_ENVIRONMENT`);
  const wanted = (JSON.parse(read(RELEASE_SECRETS_FILE)) as Record<string, string[] | undefined>)[environment];
  if (wanted === undefined || wanted.length === 0) throw new Error(`${NAME}: ${RELEASE_SECRETS_FILE} lists no secrets for ${environment}`);
  const missing = wanted.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(
      `${NAME}: ${environment} is missing ${missing.join(', ')}; set each in the ${environment} environment before releasing`,
    );
  }
  return `${NAME}: ${environment} holds all ${String(wanted.length)} secrets this release reads`;
}

export async function main(
  args: string[] = [],
  env: Record<string, string | undefined> = process.env,
  read: (path: string) => string = (path) => readFileSync(path, 'utf8'),
  print: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): Promise<number> {
  await Promise.resolve(); // NOSONAR: async so that a refusal rejects, as every script's main does through runIfEntry
  print(check(args, env, read));
  return 0;
}

await runIfEntry(import.meta.url, main);
