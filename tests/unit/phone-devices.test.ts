import { describe, it, expect } from 'vitest';
import { appiumArgs, listenersIn, oneplusCounts, pickIphone, waitForFreePort, type PortWait } from '../phones/devices.ts';

/**
 * The phone run finds the iPhone on the cable from `xcrun devicectl list
 * devices --json-output` (shyden-labs/ShyTalk#112). Shape measured
 * 2026-11-06: the iPhone Air is `reality: physical`, `deviceType: iPhone`,
 * `transportType: wired`; simulators are `simulated`, `sameMachine`.
 */

const device = (udid: string, reality: string, deviceType: string, transportType: string) => ({
  hardwareProperties: { udid, reality, deviceType, marketingName: `${deviceType} ${udid}` },
  connectionProperties: { transportType },
});
const list = (...devices: ReturnType<typeof device>[]) => ({ result: { devices } });

describe('pickIphone', () => {
  it('answers the one physical iPhone on the cable, past simulators and iPads', () => {
    const devices = list(
      device('SIM-1', 'simulated', 'iPhone', 'sameMachine'),
      device('IPAD-1', 'physical', 'iPad', 'wired'),
      device('AIR-1', 'physical', 'iPhone', 'wired'),
    );
    expect(pickIphone(devices)).toBe('AIR-1');
  });

  it('fails naming the cable when no iPhone is plugged in, including one only on the network', () => {
    expect(() => pickIphone(list(device('AIR-1', 'physical', 'iPhone', 'localNetwork')))).toThrow('no iPhone is connected by cable');
  });

  it('fails naming each when more than one iPhone is on the cable', () => {
    expect(() => pickIphone(list(device('A', 'physical', 'iPhone', 'wired'), device('B', 'physical', 'iPhone', 'wired')))).toThrow(
      'more than one iPhone is connected by cable: iPhone A, iPhone B',
    );
  });
});

describe('oneplusCounts', () => {
  it('answers the OnePlus’s counts from the counter’s file, test by test (shyden-labs/ShyTalk#180 AC7)', () => {
    expect(oneplusCounts(JSON.stringify({ oneplus: { a: 3, b: 1 } }))).toEqual({ a: 3, b: 1 });
  });

  it('fails naming the file when it holds no counts for the OnePlus', () => {
    expect(() => oneplusCounts(JSON.stringify({ chromium: { a: 3 } }))).toThrow(
      'test-results/phone-oneplus-assertions.json holds no counts for the OnePlus',
    );
  });
});

describe('appiumArgs', () => {
  it('keeps the console at warnings and writes the full debug log to its file, so a failed iPhone start shows its cause (shyden-labs/ShyTalk#221)', () => {
    expect(appiumArgs(4733)).toEqual(['--port', '4733', '--log-level', 'warn:debug', '--log', 'test-results/appium.log']);
  });
});

/**
 * WebDriverAgent's local port must be free before Appium starts the iPhone's
 * session: run 5 (2026-11-16) found it still held 3 ms after Appium cleaned up
 * the last run's listener (shyden-labs/ShyTalk#224).
 */
describe('waitForFreePort', () => {
  /** A port that comes free after `heldFor` ms of fake time. */
  function port(heldFor: number, holder = 'node (pid 41)'): PortWait & { looks: number; clock: number } {
    const state = {
      looks: 0,
      clock: 0,
      free: () => (state.looks++, Promise.resolve(state.clock >= heldFor)),
      holder: () => Promise.resolve(holder),
      now: () => state.clock,
      pause: (ms: number) => ((state.clock += ms), Promise.resolve()),
    };
    return state;
  }

  it('goes on at once when the port is free', async () => {
    const p = port(0);
    await waitForFreePort(8100, p);
    expect(p.looks).toBe(1);
    expect(p.clock).toBe(0);
  });

  it('waits, looking every 500 ms, until the port comes free', async () => {
    const p = port(1_200);
    await waitForFreePort(8100, p);
    expect(p.looks).toBe(4);
    expect(p.clock).toBe(1_500);
  });

  it('fails after 30 s naming the port and its holder', async () => {
    const p = port(Infinity, 'iproxy (pid 77)');
    await expect(waitForFreePort(8100, p)).rejects.toThrow('port 8100 is still held after 30 s, by iproxy (pid 77)');
    expect(p.clock).toBe(30_000);
  });

  it('says so when no holder can be seen, as a root-owned listener would be', async () => {
    const p = port(Infinity, '');
    await expect(waitForFreePort(8100, p)).rejects.toThrow(
      "port 8100 is still held after 30 s, by a process lsof does not show to this user (root's, perhaps)",
    );
  });
});

describe('listenersIn', () => {
  it('answers each listening command and pid from lsof, once each', () => {
    const text = [
      'COMMAND   PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME',
      'node    41923 shyden   31u  IPv4 0x1234567890abcdef      0t0  TCP 127.0.0.1:8100 (LISTEN)',
      'node    41923 shyden   32u  IPv6 0x1234567890abcdee      0t0  TCP [::1]:8100 (LISTEN)',
      'iproxy    512 shyden    5u  IPv4 0x1234567890abcded      0t0  TCP *:8100 (LISTEN)',
    ].join('\n');
    expect(listenersIn(text)).toBe('node (pid 41923), iproxy (pid 512)');
  });

  it('answers nothing for an empty lsof answer', () => {
    expect(listenersIn('')).toBe('');
  });
});
