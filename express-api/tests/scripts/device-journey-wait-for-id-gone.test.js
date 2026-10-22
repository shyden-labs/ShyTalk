/**
 * device-journey-wait-for-id-gone.test.js
 *
 * SHY-0645: "gone" is judged only on a dump that still shows the element that
 * stays, so an empty tree or the wrong screen can never read as a pass.
 */

const { waitForIdGone } = require('../../scripts/device-journey-runner');

const nodeXml = (id) =>
  `<node resource-id="${id}" text="" bounds="[0,0][100,100]" enabled="true" />`;
const screen = (...ids) => `<hierarchy>${ids.map(nodeXml).join('')}</hierarchy>`;
const deviceServing = (frames) => {
  let i = 0;
  return {
    kind: 'android',
    async dumpXml() {
      return frames[Math.min(i++, frames.length - 1)];
    },
  };
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('returns at once when the id is gone and the one that stays is there', async () => {
  const d = deviceServing([screen('badge_0')]);
  const nodes = await waitForIdGone(d, 'badge_2', { stays: 'badge_0', timeoutMs: 5000 });
  expect(nodes.map((n) => n.id)).toEqual(['badge_0']);
});

test('waits while the id is still there', async () => {
  const d = deviceServing([screen('badge_0', 'badge_2'), screen('badge_0')]);
  const p = waitForIdGone(d, 'badge_2', { stays: 'badge_0', timeoutMs: 5000 });
  await jest.advanceTimersByTimeAsync(1000);
  await expect(p).resolves.toHaveLength(1);
});

test('an empty screen is not "gone": it times out naming the missing anchor', async () => {
  const d = deviceServing([screen()]);
  const p = waitForIdGone(d, 'badge_2', { stays: 'badge_0', timeoutMs: 3000 });
  const assertion = expect(p).rejects.toThrow(
    'timed out (3000ms) waiting for #badge_2 to leave while #badge_0 stays; last screen had #badge_0: no, #badge_2: no',
  );
  await jest.advanceTimersByTimeAsync(4000);
  await assertion;
});

test('refuses a call with no anchor', async () => {
  await expect(waitForIdGone(deviceServing([screen()]), 'badge_2', {})).rejects.toThrow(
    'waitForIdGone needs a `stays` id',
  );
});
