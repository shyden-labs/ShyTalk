/**
 * The real steps of the phone run (tests/phones/run.ts, shyden-labs/ShyTalk#112):
 * adb for the OnePlus, devicectl and Appium for the iPhone Air. `pickIphone`
 * is unit-tested; the rest is proven by the phone run itself.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { IPHONE_CASES } from './iphone-cases.ts';
import { capabilities, type PhoneDeps } from './run.ts';
import { safariPage, type WebDriverCall } from './safari.ts';

const exec = promisify(execFile);

/** Where adb forwards Chrome's DevTools socket on the OnePlus. */
const DEVTOOLS_PORT = 9333;
const APPIUM_PORT = 4733;
const APPIUM = `http://127.0.0.1:${String(APPIUM_PORT)}`;
/** tests/smoke/oneplus.config.ts writes the OnePlus report here. */
export const ONEPLUS_REPORT = 'test-results/phone-oneplus.json';
const DEVICES_FILE = 'test-results/devicectl-devices.json';
/** How long Appium gets to answer /status, and to exit once asked. */
const APPIUM_START_MS = 60_000;
const APPIUM_STOP_MS = 30_000;

interface DeviceList {
  result: {
    devices: {
      hardwareProperties: { udid: string; reality: string; deviceType: string; marketingName?: string };
      connectionProperties: { transportType?: string };
    }[];
  };
}

/**
 * The one iPhone connected by cable, from `devicectl list devices --json-output`.
 * A cable means a real phone: simulators report `sameMachine` (measured 2026-11-06).
 */
export function pickIphone(list: DeviceList): string {
  const iphones = list.result.devices.filter(
    ({ hardwareProperties: h, connectionProperties: c }) => h.deviceType === 'iPhone' && c.transportType === 'wired',
  );
  if (iphones.length === 0) throw new Error('no iPhone is connected by cable');
  if (iphones.length > 1) {
    throw new Error(
      `more than one iPhone is connected by cable: ${iphones.map(({ hardwareProperties: h }) => h.marketingName ?? h.udid).join(', ')}`,
    );
  }
  const [only] = iphones;
  return only?.hardwareProperties.udid ?? '';
}

/** Resolves with the child's exit code; rejects naming it if it outlasts `ms`. */
function exited(child: ChildProcess, name: string, ms?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer =
      ms === undefined
        ? undefined
        : setTimeout(() => {
            reject(new Error(`${name} did not exit within ${String(ms / 1000)} s`));
          }, ms);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`${name} could not start: ${error.message}`));
    });
  });
}

const call: WebDriverCall = async (method, path, body) => {
  const response = await fetch(`${APPIUM}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const { value } = (await response.json()) as { value: { error?: string; message?: string } | null };
  if (value?.error !== undefined) throw new Error(`Appium ${method} ${path}: ${value.error}: ${String(value.message).slice(0, 500)}`);
  return value;
};

export function realDeps(): PhoneDeps {
  let appium: ChildProcess | undefined;
  return {
    async forward() {
      // Chrome opens its DevTools socket once it runs; about:blank starts it without a page of ours.
      await exec('adb', ['shell', 'am', 'start', '-n', 'com.android.chrome/com.google.android.apps.chrome.Main', '-d', 'about:blank']);
      await exec('adb', ['forward', `tcp:${String(DEVTOOLS_PORT)}`, 'localabstract:chrome_devtools_remote']);
      return `http://127.0.0.1:${String(DEVTOOLS_PORT)}`;
    },
    async unforward() {
      await exec('adb', ['forward', '--remove', `tcp:${String(DEVTOOLS_PORT)}`]);
    },
    playwright(address, endpoint) {
      const child = spawn('npx', ['playwright', 'test', '-c', 'tests/smoke/oneplus.config.ts'], {
        stdio: 'inherit',
        env: { ...process.env, SMOKE_CDP_ENDPOINT: endpoint, PHONE_BASE_URL: address },
      });
      return exited(child, 'Playwright');
    },
    async readOneplusReport() {
      return JSON.parse(await readFile(ONEPLUS_REPORT, 'utf8')) as Awaited<ReturnType<PhoneDeps['readOneplusReport']>>;
    },
    async iphoneUdid() {
      await mkdir('test-results', { recursive: true });
      await exec('xcrun', ['devicectl', 'list', 'devices', '--json-output', DEVICES_FILE]);
      return pickIphone(JSON.parse(await readFile(DEVICES_FILE, 'utf8')) as DeviceList);
    },
    async startAppium() {
      const child = spawn('appium', ['--port', String(APPIUM_PORT), '--log-level', 'warn'], { stdio: 'inherit' });
      appium = child;
      let gone: Error | undefined;
      exited(child, 'Appium').then(
        (code) => {
          gone = new Error(`Appium exited ${String(code)} before it was ready`);
        },
        (error: unknown) => {
          gone = error as Error;
        },
      );
      const deadline = Date.now() + APPIUM_START_MS;
      for (;;) {
        if (gone !== undefined) throw gone;
        const ready = await fetch(`${APPIUM}/status`).then(
          async (r) => ((await r.json()) as { value?: { ready?: boolean } }).value?.ready === true,
          () => false,
        );
        if (ready) return;
        if (Date.now() > deadline) throw new Error(`Appium did not answer ${APPIUM}/status within ${String(APPIUM_START_MS / 1000)} s`);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    },
    async openSession(udid) {
      const { sessionId } = (await call('POST', '/session', { capabilities: { alwaysMatch: capabilities(udid) } })) as {
        sessionId: string;
      };
      return sessionId;
    },
    page: (session, address) => safariPage(call, session, address),
    async closeSession(session) {
      await call('DELETE', `/session/${session}`);
    },
    async stopAppium() {
      if (appium === undefined || appium.exitCode !== null) return;
      const done = exited(appium, 'Appium', APPIUM_STOP_MS);
      appium.kill('SIGINT');
      await done;
      // Stopping Appium can leave WebDriverAgent's xcodebuild running on the iPhone (found 2026-11-06).
      const { stdout } = await exec('pgrep', ['-f', 'com.shyden.WebDriverAgentRunner']).catch(() => ({ stdout: '' }));
      for (const pid of stdout.split('\n').filter(Boolean)) process.kill(Number(pid), 'SIGTERM');
    },
    cases: IPHONE_CASES,
    print: (line) => {
      console.log(line);
    },
  };
}
