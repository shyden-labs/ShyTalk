import { describe, it, expect } from 'vitest';
import { pickIphone } from '../phones/devices.ts';

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
