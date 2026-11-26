import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

/*
 * The real steps of the phone run (tests/phones/devices.ts realDeps, shyden-labs/ShyTalk#211), with every process,
 * file, socket and HTTP call stood in: nothing reaches adb, Appium, the Keychain or a phone.
 */

/** What each stood-in command prints, by its name; a missing name fails the command. */
let printed: Record<string, string>;
const ran: string[][] = [];
vi.mock('node:child_process', () => ({
  execFile: (command: string, args: string[], done: (error: Error | null, out?: { stdout: string }) => void) => {
    ran.push([command, ...args]);
    const stdout = printed[command];
    if (stdout === undefined) done(new Error(`${command} failed`));
    else done(null, { stdout });
  },
  spawn: vi.fn(),
}));
vi.mock('node:fs/promises', () => ({ mkdir: vi.fn(), readFile: vi.fn(), rm: vi.fn() }));
/** Whether something answers on a probed port, by port. */
let answering: Set<number>;
/** Every probe socket opened, to see each is closed. */
const probes: { destroy: () => void }[] = [];
vi.mock('node:net', () => ({
  connect: (port: number) => {
    const probe = Object.assign(new EventEmitter(), { destroy: vi.fn() });
    probes.push(probe);
    queueMicrotask(() => probe.emit(answering.has(port) ? 'connect' : 'error', new Error('refused')));
    return probe;
  },
}));
vi.mock('../phones/safari.ts', () => ({ safariPage: vi.fn(() => 'the page') }));

const { spawn } = await import('node:child_process');
const { mkdir, readFile, rm } = await import('node:fs/promises');
const { safariPage } = await import('../phones/safari.ts');
const { realDeps, ONEPLUS_REPORT, ONEPLUS_COUNTS, appiumArgs } = await import('../phones/devices.ts');
const { APPIUM_LOG, capabilities } = await import('../phones/run.ts');
const { IPHONE_CASES } = await import('../phones/iphone-cases.ts');

/** A stood-in child process: it exits or fails when the test says. */
class Child extends EventEmitter {
  exitCode: number | null = null;
  kill = vi.fn();
  exit(code: number | null): void {
    this.exitCode = code ?? 1;
    this.emit('exit', code);
  }
}
let child: Child;

/** The stood-in Appium server: each request is logged, and answered by `answer`. */
const requests: { url: string; method: string | undefined; body: unknown; headers: unknown; hasBody: boolean }[] = [];
let answer: (url: string) => unknown;
const fetchStandIn = vi.fn((url: string, init?: { method?: string; headers?: unknown; body?: string }) => {
  requests.push({
    url,
    method: init?.method,
    headers: init?.headers,
    hasBody: init !== undefined && 'body' in init,
    body: init?.body === undefined ? undefined : (JSON.parse(init.body) as unknown),
  });
  const value = answer(url);
  if (value instanceof Error) return Promise.reject(value);
  return Promise.resolve({ json: () => Promise.resolve(value) });
});

beforeEach(() => {
  printed = {};
  ran.length = 0;
  requests.length = 0;
  answering = new Set();
  probes.length = 0;
  child = new Child();
  vi.mocked(spawn)
    .mockReset()
    .mockReturnValue(child as never);
  vi.stubGlobal('fetch', fetchStandIn);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the real phone steps', () => {
  it('read the test mailbox password from the Keychain, alone, without its line end', async () => {
    printed = { security: 'the-password\n' };
    expect(await realDeps().mailboxPassword()).toBe('the-password');
    expect(ran).toEqual([['security', 'find-generic-password', '-s', 'shytalk-test-mailbox', '-a', 'shytalk-tests@shyden.co.uk', '-w']]);
  });

  it('read an environment’s site password from the Keychain, alone, without its line end (shyden-labs/ShyTalk#262)', async () => {
    printed = { security: 'the-site-password\n' };
    expect(await realDeps().sitePassword('dev')).toBe('the-site-password');
    expect(ran).toEqual([['security', 'find-generic-password', '-s', 'shytalk-dev-site-password', '-a', 'shytalk', '-w']]);
  });

  it('read one of DEV’s secrets from the Keychain, alone, without its line end (shyden-labs/ShyTalk#379)', async () => {
    printed = { security: 'the-webhook-secret\n' };
    expect(await realDeps().devSecret('roadmap-webhook')).toBe('the-webhook-secret');
    expect(ran).toEqual([['security', 'find-generic-password', '-s', 'shytalk-dev-roadmap-webhook-secret', '-a', 'shytalk', '-w']]);
  });

  it('start a fresh Chrome on the OnePlus with no leftover command line, forward its DevTools socket to 9333, and later remove the forward', async () => {
    printed = { adb: '' };
    const deps = realDeps();
    expect(await deps.forward()).toBe('http://127.0.0.1:9333');
    await deps.unforward();
    expect(ran).toEqual([
      // An unfinished Playwright launch elsewhere leaves this file, which renames the socket (shyden-labs/ShyTalk#302).
      ['adb', 'shell', 'rm', '-f', '/data/local/tmp/chrome-command-line'],
      ['adb', 'shell', 'am', 'set-debug-app', '--persistent', 'com.android.chrome'],
      ['adb', 'shell', 'am', 'force-stop', 'com.android.chrome'],
      ['adb', 'shell', 'am', 'start', '-n', 'com.android.chrome/com.google.android.apps.chrome.Main', '-d', 'about:blank'],
      ['adb', 'forward', 'tcp:9333', 'localabstract:chrome_devtools_remote'],
      ['adb', 'forward', '--remove', 'tcp:9333'],
    ]);
  });

  it('run Playwright on the OnePlus config with the endpoint and address, ending with its exit code', async () => {
    const run = realDeps().playwright('https://test.example', 'http://127.0.0.1:9333');
    const [command, args, options] = vi.mocked(spawn).mock.calls[0] ?? [];
    expect([command, args]).toEqual(['npx', ['playwright', 'test', '-c', 'tests/smoke/oneplus.config.ts']]);
    expect(options).toMatchObject({
      stdio: 'inherit',
      env: { SMOKE_CDP_ENDPOINT: 'http://127.0.0.1:9333', PHONE_BASE_URL: 'https://test.example', PATH: process.env['PATH'] },
    });
    child.exit(4);
    expect(await run).toBe(4);
  });

  it('count a Playwright killed by a signal, with no exit code, as exit 1', async () => {
    const run = realDeps().playwright('a', 'b');
    child.exit(null);
    expect(await run).toBe(1);
  });

  it('name Playwright when it cannot start', async () => {
    const run = realDeps().playwright('a', 'b');
    child.emit('error', new Error('npx not found'));
    await expect(run).rejects.toThrow('Playwright could not start: npx not found');
  });

  it('read the OnePlus report and its checks per test from the files Playwright wrote', async () => {
    vi.mocked(readFile).mockImplementation((path) =>
      Promise.resolve(path === ONEPLUS_REPORT ? '{"stats":{"expected":3}}' : '{"oneplus":{"a test":7}}'),
    );
    const deps = realDeps();
    expect(await deps.readOneplusReport()).toEqual({ stats: { expected: 3 } });
    expect(await deps.readOneplusCounts()).toEqual({ 'a test': 7 });
    expect(vi.mocked(readFile).mock.calls).toEqual([
      [ONEPLUS_REPORT, 'utf8'],
      [ONEPLUS_COUNTS, 'utf8'],
    ]);
  });

  it('find the one iPhone on a cable through devicectl’s JSON file', async () => {
    printed = { xcrun: '' };
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        result: {
          devices: [
            {
              hardwareProperties: { udid: 'U1', reality: 'physical', deviceType: 'iPhone' },
              connectionProperties: { transportType: 'wired' },
            },
          ],
        },
      }),
    );
    expect(await realDeps().iphoneUdid()).toBe('U1');
    expect(vi.mocked(mkdir).mock.calls).toEqual([['test-results', { recursive: true }]]);
    expect(ran).toEqual([['xcrun', 'devicectl', 'list', 'devices', '--json-output', 'test-results/devicectl-devices.json']]);
    expect(vi.mocked(readFile).mock.calls).toEqual([['test-results/devicectl-devices.json', 'utf8']]);
  });

  it('start Appium with an empty log once the iPhone port is free, and wait, every 500 ms, until it is ready', async () => {
    vi.useFakeTimers();
    const statuses: unknown[] = [new Error('not listening yet'), { value: { ready: false } }, { value: {} }, { value: { ready: true } }];
    answer = () => statuses.shift();
    const started = realDeps().startAppium();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(rm).mock.calls).toEqual([[APPIUM_LOG, { force: true }]]);
    expect(vi.mocked(spawn).mock.calls).toEqual([['appium', appiumArgs(4733), { stdio: 'inherit' }]]);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(499);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_001);
    await started;
    expect(requests.map(({ url }) => url)).toEqual(Array(4).fill('http://127.0.0.1:4733/status'));
  });

  it('give up on Appium after 60 s without a ready answer, naming its status address', async () => {
    vi.useFakeTimers();
    answer = () => ({ value: { ready: false } });
    const started = realDeps().startAppium();
    const refused = expect(started).rejects.toThrow('Appium did not answer http://127.0.0.1:4733/status within 60 s');
    await vi.advanceTimersByTimeAsync(60_500);
    await refused;
  });

  it('stop waiting at once when Appium exits before it is ready, naming its exit code', async () => {
    vi.useFakeTimers();
    answer = () => ({ value: { ready: false } });
    const started = realDeps().startAppium();
    const refused = expect(started).rejects.toThrow('Appium exited 3 before it was ready');
    await vi.advanceTimersByTimeAsync(0);
    child.exit(3);
    await vi.advanceTimersByTimeAsync(500);
    await refused;
  });

  it('stop waiting at once when Appium cannot start, naming why', async () => {
    vi.useFakeTimers();
    answer = () => ({ value: { ready: false } });
    const started = realDeps().startAppium();
    const refused = expect(started).rejects.toThrow('Appium could not start: appium not found');
    await vi.advanceTimersByTimeAsync(0);
    child.emit('error', new Error('appium not found'));
    await vi.advanceTimersByTimeAsync(500);
    await refused;
  });

  it('wait for a held iPhone port and, after 30 s, name the listener lsof shows', async () => {
    vi.useFakeTimers();
    answering = new Set([8199]);
    printed = { lsof: 'COMMAND PID USER\nxcodebuild 42 shyden 5u IPv4 TCP *:8199 (LISTEN)\n' };
    const started = realDeps().startAppium();
    const refused = expect(started).rejects.toThrow('port 8199 is still held after 30 s, by xcodebuild (pid 42)');
    await vi.advanceTimersByTimeAsync(30_000);
    await refused;
    expect(ran).toEqual([['lsof', '-nP', '-iTCP:8199', '-sTCP:LISTEN']]);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('look at a held iPhone port again every 500 ms, closing each probe that found it held, and go on once it is free', async () => {
    vi.useFakeTimers();
    answering = new Set([8199]);
    answer = () => ({ value: { ready: true } });
    const started = realDeps().startAppium();
    await vi.advanceTimersByTimeAsync(400);
    answering = new Set();
    expect(spawn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    await started;
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(probes).toHaveLength(2);
    expect(vi.mocked(probes[0]?.destroy)).toHaveBeenCalledTimes(1);
  });

  it('say so when lsof cannot show the port’s holder', async () => {
    vi.useFakeTimers();
    answering = new Set([8199]);
    const started = realDeps().startAppium();
    const refused = expect(started).rejects.toThrow("by a process lsof does not show to this user (root's, perhaps)");
    await vi.advanceTimersByTimeAsync(30_000);
    await refused;
  });

  it('open a Safari session on the iPhone through Appium, hand its page over, and close it', async () => {
    answer = (url) => ({ value: url.endsWith('/session') ? { sessionId: 'S1' } : null });
    const deps = realDeps();
    expect(await deps.openSession('U1')).toBe('S1');
    expect(deps.page('S1', 'https://test.example')).toBe('the page');
    await deps.closeSession('S1');
    expect(requests).toEqual([
      {
        url: 'http://127.0.0.1:4733/session',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        hasBody: true,
        body: { capabilities: { alwaysMatch: capabilities('U1') } },
      },
      {
        url: 'http://127.0.0.1:4733/session/S1',
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        hasBody: false,
        body: undefined,
      },
    ]);
    const [call, session, address] = vi.mocked(safariPage).mock.calls[0] ?? [];
    expect([session, address]).toEqual(['S1', 'https://test.example']);
    answer = () => ({ value: { title: 'x' } });
    expect(await call?.('GET', '/session/S1/title')).toEqual({ title: 'x' });
  });

  it('name an Appium error with the method, path and the first 500 characters of its message', async () => {
    answer = () => ({ value: { error: 'invalid session id', message: 'm'.repeat(600) } });
    await expect(realDeps().openSession('U1')).rejects.toThrow(`Appium POST /session: invalid session id: ${'m'.repeat(500)}`);
    await expect(realDeps().openSession('U1')).rejects.not.toThrow('m'.repeat(501));
  });

  it('stop Appium with SIGINT, then end any WebDriverAgent it left on the Mac', async () => {
    vi.useFakeTimers();
    answer = () => ({ value: { ready: true } });
    const killed = vi.spyOn(process, 'kill').mockReturnValue(true);
    const deps = realDeps();
    await deps.startAppium();
    printed = { pgrep: '101\n202\n' };
    ran.length = 0;
    const stopped = deps.stopAppium();
    expect(child.kill.mock.calls).toEqual([['SIGINT']]);
    child.exit(0);
    await stopped;
    expect(ran).toEqual([['pgrep', '-f', 'com.shyden.WebDriverAgentRunner']]);
    expect(killed.mock.calls).toEqual([
      [101, 'SIGTERM'],
      [202, 'SIGTERM'],
    ]);
  });

  it('end nothing more when pgrep finds no WebDriverAgent', async () => {
    vi.useFakeTimers();
    answer = () => ({ value: { ready: true } });
    const killed = vi.spyOn(process, 'kill').mockReturnValue(true);
    const deps = realDeps();
    await deps.startAppium();
    const stopped = deps.stopAppium();
    child.exit(0);
    await stopped;
    expect(killed).not.toHaveBeenCalled();
  });

  it('name Appium when it outlasts 30 s after SIGINT', async () => {
    vi.useFakeTimers();
    answer = () => ({ value: { ready: true } });
    const deps = realDeps();
    await deps.startAppium();
    const stopped = deps.stopAppium();
    const refused = expect(stopped).rejects.toThrow('Appium did not exit within 30 s');
    await vi.advanceTimersByTimeAsync(30_000);
    await refused;
  });

  it('do nothing to stop an Appium never started, or one already gone', async () => {
    vi.useFakeTimers();
    await realDeps().stopAppium();
    answer = () => ({ value: { ready: true } });
    const deps = realDeps();
    await deps.startAppium();
    child.exit(0);
    await deps.stopAppium();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('carry the iPhone cases and print each line to the console', () => {
    const logged = vi.spyOn(console, 'log').mockReturnValue(undefined);
    const deps = realDeps();
    expect(deps.cases).toBe(IPHONE_CASES);
    deps.print('a line');
    expect(logged.mock.calls).toEqual([['a line']]);
  });
});
