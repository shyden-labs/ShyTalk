/**
 * Sets a DEV secret this Mac also needs in GitHub's `dev` environment and the Keychain together, or checks that the
 * Keychain holds every one (shyden-labs/ShyTalk#386: #379's webhook secret was set in GitHub alone):
 *
 *   printf %s "$value" | node scripts/dev-secret.ts set <NAME>
 *   node scripts/dev-secret.ts set <NAME> --random
 *   node scripts/dev-secret.ts check
 *
 * Values travel on stdin only, never in a command's arguments, and are never printed. GitHub is written first, as
 * the ShyTalk App (gh_route), then the Keychain, then both are read back.
 */
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { runIfEntry } from './cli.ts';
import { commandPath } from './command-path.ts';
import { MAC_DEV_SECRETS } from './dev-secrets.ts';

const REPO = 'shyden-labs/ShyTalk';
const ACCOUNT = 'shytalk';
const USAGE = 'usage: node scripts/dev-secret.ts set <NAME> [--random] | check';

/** Runs `command` with `args`, `input` on its stdin, answering its stdout. */
export type Run = (command: string, args: string[], input?: string) => Promise<string>;

export interface DevSecretDeps {
  stdin(): Promise<string>;
  random(): string;
  githubSet(name: string, value: string): Promise<void>;
  githubNames(): Promise<string[]>;
  keychainSet(service: string, value: string): Promise<void>;
  keychainGet(service: string): Promise<string>;
  print(line: string): void;
}

export const spawnRun: Run = (command, args, input) =>
  Promise.resolve(execFileSync(commandPath(command), args, { input, encoding: 'utf8' }));

export function realDeps(run: Run, input: AsyncIterable<unknown> = process.stdin): DevSecretDeps {
  return {
    stdin: async () => {
      let text = '';
      for await (const chunk of input) text += String(chunk);
      return text;
    },
    random: () => randomBytes(32).toString('hex'),
    githubSet: async (name, value) => {
      await run('gh', ['secret', 'set', name, '--env', 'dev', '-R', REPO], value);
    },
    githubNames: async () =>
      (await run('gh', ['secret', 'list', '--env', 'dev', '-R', REPO, '--json', 'name', '--jq', '.[].name'])).split('\n').filter(Boolean),
    keychainSet: async (service, value) => {
      // security -i reads one command line; a quote, backslash or line break would break the quoted word.
      if (/["\\\n\r]/.test(value)) throw new Error('dev-secret: a value holding a quote, backslash or line break cannot be saved');
      await run('security', ['-i'], `add-generic-password -U -s ${service} -a ${ACCOUNT} -w "${value}"\n`);
    },
    keychainGet: async (service) =>
      (await run('security', ['find-generic-password', '-s', service, '-a', ACCOUNT, '-w'])).replace(/\n$/, ''),
    print: (line) => {
      console.log(line);
    },
  };
}

export async function setDevSecret(name: string, random: boolean, deps: DevSecretDeps): Promise<number> {
  const entry = MAC_DEV_SECRETS.find((secret) => secret.name === name);
  if (entry === undefined) throw new Error(`dev-secret: ${name} is not a DEV secret this Mac needs (scripts/dev-secrets.ts)`);
  const value = random ? deps.random() : (await deps.stdin()).trim();
  if (value === '') throw new Error(`dev-secret: no value on stdin for ${name}`);

  try {
    await deps.githubSet(name, value);
  } catch {
    throw new Error(`dev-secret: GitHub refused ${name}`);
  }
  if (!(await deps.githubNames()).includes(name))
    throw new Error(`dev-secret: ${name} is not listed in the dev environment after setting it`);
  deps.print(`dev-secret: ${name} set in the dev environment`);

  try {
    await deps.keychainSet(entry.keychain, value);
    if ((await deps.keychainGet(entry.keychain)) !== value) throw new Error('read-back differs');
  } catch {
    throw new Error(`dev-secret: ${name} is set in GitHub but the Keychain refused ${entry.keychain}: run again`);
  }
  deps.print(`dev-secret: ${name} saved in the Keychain as ${entry.keychain}`);
  return 0;
}

export async function checkDevSecrets(deps: DevSecretDeps): Promise<number> {
  const missing: string[] = [];
  for (const { name, keychain } of MAC_DEV_SECRETS) {
    try {
      await deps.keychainGet(keychain);
    } catch {
      missing.push(`${keychain} (${name})`);
    }
  }
  if (missing.length === 0) {
    deps.print(`dev-secret: all ${String(MAC_DEV_SECRETS.length)} DEV secrets are in this Mac's Keychain`);
    return 0;
  }
  deps.print(`dev-secret: missing from this Mac's Keychain: ${missing.join(', ')}`);
  return 1;
}

export async function main(args: string[], deps: DevSecretDeps = realDeps(spawnRun)): Promise<number> {
  const [command, name, flag, ...rest] = args;
  if (command === 'check' && name === undefined) return checkDevSecrets(deps);
  if (command === 'set' && name !== undefined && (flag === undefined || flag === '--random') && rest.length === 0)
    return setDevSecret(name, flag === '--random', deps);
  deps.print(USAGE);
  return 2;
}

await runIfEntry(import.meta.url, main);
