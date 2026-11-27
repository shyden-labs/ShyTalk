import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { MAC_DEV_SECRETS } from '../../scripts/dev-secrets.ts';
import { checkDevSecrets, main, realDeps, setDevSecret, spawnRun, type DevSecretDeps, type Run } from '../../scripts/dev-secret.ts';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn(() => 'out') }));
vi.mock('../../scripts/command-path.ts', () => ({ commandPath: (name: string) => `/resolved/${name}` }));
import { DEV_SECRETS } from '../../tests/phones/run.ts';

/**
 * One script sets each DEV secret this Mac also needs, in GitHub's `dev` environment and the Keychain together
 * (shyden-labs/ShyTalk#386): #379's webhook secret was set in GitHub alone and the phone run found it missing.
 * GitHub and the Keychain are stood in; no value is ever printed.
 */

interface Stand {
  deps: DevSecretDeps;
  github: Map<string, string>;
  keychain: Map<string, string>;
  printed: string[];
}

function stand(options: { stdin?: string; githubFails?: boolean; keychainFails?: boolean; keychain?: Record<string, string> } = {}): Stand {
  const github = new Map<string, string>();
  const keychain = new Map<string, string>(Object.entries(options.keychain ?? {}));
  const printed: string[] = [];
  const deps: DevSecretDeps = {
    stdin: () => Promise.resolve(options.stdin ?? ''),
    random: () => 'a'.repeat(64),
    githubSet: (name, value) => {
      if (options.githubFails) return Promise.reject(new Error('gh: HTTP 403'));
      github.set(name, value);
      return Promise.resolve();
    },
    githubNames: () => Promise.resolve([...github.keys()]),
    keychainSet: (service, value) => {
      if (options.keychainFails) return Promise.reject(new Error('security: write refused'));
      keychain.set(service, value);
      return Promise.resolve();
    },
    keychainGet: (service) => {
      const value = keychain.get(service);
      return value === undefined ? Promise.reject(new Error('security: item not found')) : Promise.resolve(value);
    },
    print: (line) => printed.push(line),
  };
  return { deps, github, keychain, printed };
}

describe('the list of DEV secrets this Mac needs', () => {
  it('names each secret with its Keychain service', () => {
    expect(MAC_DEV_SECRETS).toEqual([
      { name: 'ROADMAP_WEBHOOK_SECRET', keychain: 'shytalk-dev-roadmap-webhook-secret', smoke: 'SMOKE_ROADMAP_WEBHOOK_SECRET' },
      { name: 'SHYDESK_CALLBACK_SECRET', keychain: 'shytalk-dev-shydesk-callback-secret', smoke: 'SMOKE_SHYDESK_CALLBACK_SECRET' },
      { name: 'DEV_ACCESS_CLIENT_ID', keychain: 'shytalk-ci-dev-access-client-id' },
      { name: 'DEV_ACCESS_CLIENT_SECRET', keychain: 'shytalk-ci-dev-access-client-secret' },
    ]);
  });

  it('is the list the phone run gives its smoke variables from', () => {
    expect(DEV_SECRETS).toBe(MAC_DEV_SECRETS);
  });
});

describe('setDevSecret', () => {
  it('writes the value from stdin to GitHub and the Keychain, reads both back, and prints no value', async () => {
    const s = stand({ stdin: 'the-value\n' });
    expect(await setDevSecret('ROADMAP_WEBHOOK_SECRET', false, s.deps)).toBe(0);
    expect(s.github.get('ROADMAP_WEBHOOK_SECRET')).toBe('the-value');
    expect(s.keychain.get('shytalk-dev-roadmap-webhook-secret')).toBe('the-value');
    expect(s.printed.join('\n')).not.toContain('the-value');
    expect(s.printed).toEqual([
      'dev-secret: ROADMAP_WEBHOOK_SECRET set in the dev environment',
      'dev-secret: ROADMAP_WEBHOOK_SECRET saved in the Keychain as shytalk-dev-roadmap-webhook-secret',
    ]);
  });

  it('makes a random value with --random, ignoring stdin', async () => {
    const s = stand({ stdin: 'ignored' });
    expect(await setDevSecret('DEV_ACCESS_CLIENT_SECRET', true, s.deps)).toBe(0);
    expect(s.github.get('DEV_ACCESS_CLIENT_SECRET')).toBe('a'.repeat(64));
    expect(s.keychain.get('shytalk-ci-dev-access-client-secret')).toBe('a'.repeat(64));
  });

  it('refuses a name not on the list, writing nothing', async () => {
    const s = stand({ stdin: 'v' });
    await expect(setDevSecret('SOMETHING_ELSE', false, s.deps)).rejects.toThrow(
      'dev-secret: SOMETHING_ELSE is not a DEV secret this Mac needs (scripts/dev-secrets.ts)',
    );
    expect(s.github.size + s.keychain.size).toBe(0);
  });

  it('refuses an empty value, writing nothing', async () => {
    const s = stand({ stdin: '  \n' });
    await expect(setDevSecret('ROADMAP_WEBHOOK_SECRET', false, s.deps)).rejects.toThrow(
      'dev-secret: no value on stdin for ROADMAP_WEBHOOK_SECRET',
    );
    expect(s.github.size + s.keychain.size).toBe(0);
  });

  it('writes no Keychain copy when GitHub refuses, naming GitHub', async () => {
    const s = stand({ stdin: 'v', githubFails: true });
    await expect(setDevSecret('ROADMAP_WEBHOOK_SECRET', false, s.deps)).rejects.toThrow(
      'dev-secret: GitHub refused ROADMAP_WEBHOOK_SECRET',
    );
    expect(s.keychain.size).toBe(0);
  });

  it('fails naming GitHub when the secret is not listed after setting it, writing no Keychain copy', async () => {
    const s = stand({ stdin: 'v' });
    s.deps.githubNames = () => Promise.resolve([]);
    await expect(setDevSecret('ROADMAP_WEBHOOK_SECRET', false, s.deps)).rejects.toThrow(
      'dev-secret: ROADMAP_WEBHOOK_SECRET is not listed in the dev environment after setting it',
    );
    expect(s.keychain.size).toBe(0);
  });

  it('fails naming the Keychain when its write is refused after GitHub took the value', async () => {
    const s = stand({ stdin: 'v', keychainFails: true });
    await expect(setDevSecret('ROADMAP_WEBHOOK_SECRET', false, s.deps)).rejects.toThrow(
      'dev-secret: ROADMAP_WEBHOOK_SECRET is set in GitHub but the Keychain refused shytalk-dev-roadmap-webhook-secret: run again',
    );
  });
});

describe('setDevSecret read-back', () => {
  it('fails naming the Keychain when it reads back another value', async () => {
    const s = stand({ stdin: 'v' });
    s.deps.keychainGet = () => Promise.resolve('other');
    await expect(setDevSecret('ROADMAP_WEBHOOK_SECRET', false, s.deps)).rejects.toThrow(
      'dev-secret: ROADMAP_WEBHOOK_SECRET is set in GitHub but the Keychain refused shytalk-dev-roadmap-webhook-secret: run again',
    );
  });
});

describe('checkDevSecrets', () => {
  it('exits 0 and says so when every listed secret is in the Keychain', async () => {
    const all = Object.fromEntries(MAC_DEV_SECRETS.map(({ keychain }) => [keychain, 'v']));
    const s = stand({ keychain: all });
    expect(await checkDevSecrets(s.deps)).toBe(0);
    expect(s.printed).toEqual([`dev-secret: all ${String(MAC_DEV_SECRETS.length)} DEV secrets are in this Mac's Keychain`]);
  });

  it('exits 1 naming each one missing, never a value', async () => {
    const s = stand({ keychain: { 'shytalk-dev-shydesk-callback-secret': 'secret-v' } });
    expect(await checkDevSecrets(s.deps)).toBe(1);
    expect(s.printed).toEqual([
      "dev-secret: missing from this Mac's Keychain: shytalk-dev-roadmap-webhook-secret (ROADMAP_WEBHOOK_SECRET), shytalk-ci-dev-access-client-id (DEV_ACCESS_CLIENT_ID), shytalk-ci-dev-access-client-secret (DEV_ACCESS_CLIENT_SECRET)",
    ]);
    expect(s.printed.join('')).not.toContain('secret-v');
  });
});

describe('realDeps', () => {
  /** A stand-in for running a command: records each call; `answers` gives stdout by command name. */
  function runner(answers: Record<string, string> = {}, fails = false) {
    const calls: { command: string; args: string[]; input: string | undefined }[] = [];
    const run: Run = (command, args, input) => {
      calls.push({ command, args, input });
      return fails ? Promise.reject(new Error(`${command} failed`)) : Promise.resolve(answers[command] ?? '');
    };
    return { run, calls };
  }

  it('sets a GitHub secret as the App, the value on stdin and never in the arguments', async () => {
    const r = runner();
    await realDeps(r.run).githubSet('ROADMAP_WEBHOOK_SECRET', 'v-1');
    expect(r.calls).toEqual([
      { command: 'gh', args: ['secret', 'set', 'ROADMAP_WEBHOOK_SECRET', '--env', 'dev', '-R', 'shyden-labs/ShyTalk'], input: 'v-1' },
    ]);
  });

  it("lists the dev environment's secret names", async () => {
    const r = runner({ gh: 'A\nB\n' });
    expect(await realDeps(r.run).githubNames()).toEqual(['A', 'B']);
    expect(r.calls[0]?.args).toEqual(['secret', 'list', '--env', 'dev', '-R', 'shyden-labs/ShyTalk', '--json', 'name', '--jq', '.[].name']);
  });

  it('saves to the Keychain through security -i, the value on stdin and never in the arguments', async () => {
    const r = runner();
    await realDeps(r.run).keychainSet('svc', 'v-2');
    expect(r.calls).toEqual([{ command: 'security', args: ['-i'], input: 'add-generic-password -U -s svc -a shytalk -w "v-2"\n' }]);
  });

  it('refuses a value security -i could not hold as one quoted word', async () => {
    const r = runner();
    await expect(realDeps(r.run).keychainSet('svc', 'a"b')).rejects.toThrow(
      'dev-secret: a value holding a quote, backslash or line break cannot be saved',
    );
    expect(r.calls).toEqual([]);
  });

  it('reads a Keychain value without its line break', async () => {
    const r = runner({ security: 'the-value\n' });
    expect(await realDeps(r.run).keychainGet('svc')).toBe('the-value');
    expect(r.calls[0]?.args).toEqual(['find-generic-password', '-s', 'svc', '-a', 'shytalk', '-w']);
  });

  it('reads the whole of stdin', async () => {
    async function* chunks() {
      yield await Promise.resolve('part-1 ');
      yield Buffer.from('part-2');
    }
    expect(await realDeps(runner().run, chunks()).stdin()).toBe('part-1 part-2');
  });

  it('prints each line to the console', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    realDeps(runner().run).print('a line');
    expect(log).toHaveBeenCalledWith('a line');
    log.mockRestore();
  });

  it('makes a 64-character hex value', () => {
    expect(realDeps(runner().run).random()).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('main', () => {
  it('runs set NAME with the value from stdin', async () => {
    const s = stand({ stdin: 'v' });
    expect(await main(['set', 'ROADMAP_WEBHOOK_SECRET'], s.deps)).toBe(0);
    expect(s.github.get('ROADMAP_WEBHOOK_SECRET')).toBe('v');
  });

  it('runs set NAME --random', async () => {
    const s = stand();
    expect(await main(['set', 'ROADMAP_WEBHOOK_SECRET', '--random'], s.deps)).toBe(0);
    expect(s.github.get('ROADMAP_WEBHOOK_SECRET')).toBe('a'.repeat(64));
  });

  it('runs with the real commands when given no deps', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(await main([])).toBe(2);
    expect(log).toHaveBeenCalledWith('usage: node scripts/dev-secret.ts set <NAME> [--random] | check');
    log.mockRestore();
  });

  it('runs check', async () => {
    const s = stand();
    expect(await main(['check'], s.deps)).toBe(1);
  });

  it.each([[[]], [['set']], [['other']], [['set', 'A', '--other']]])('prints the usage and answers 2 for %j', async (args) => {
    const s = stand();
    expect(await main(args, s.deps)).toBe(2);
    expect(s.printed).toEqual(['usage: node scripts/dev-secret.ts set <NAME> [--random] | check']);
  });
});

describe('spawnRun', () => {
  it('runs the resolved command with the input on stdin, answering its stdout', async () => {
    expect(await spawnRun('gh', ['secret', 'list'], 'in')).toBe('out');
    expect(vi.mocked(execFileSync)).toHaveBeenCalledWith('/resolved/gh', ['secret', 'list'], { input: 'in', encoding: 'utf8' });
  });
});
