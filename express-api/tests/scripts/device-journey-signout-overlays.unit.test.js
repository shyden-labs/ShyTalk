/**
 * device-journey-signout-overlays.unit.test.js — SHY-0702
 *
 * The daily-reward sheet is presented a moment AFTER Home renders (SHY-0527).
 * `settle` clears overlays before it calls Home reached, but signOutFlow then
 * tapped straight through: the profile tab was tapped, the sheet slid up, and
 * the next tap landed on the sheet. Measured on both phones after J08
 * (2026-10-23): on Android the gear never opened settings; on the iPhone the
 * covered tab went inaccessible mid-click. signOutFlow now waits for each
 * target clearing overlays on every poll.
 *
 * The runner sleeps between polls and after a dismissal, so these tests run
 * on Jest's fake clock: a unit test never waits out real time.
 */

const { tapUntilArrived, signOutFlow, overlays } = require('../../scripts/device-journey-runner');

const nodeXml = (attrs) =>
  `<node ${Object.entries(attrs)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ')} />`;
const node = (id, text, bounds) =>
  nodeXml({ 'resource-id': id, text, bounds, enabled: 'true', clickable: 'true' });
const screen = (...nodes) => `<hierarchy>${nodes.join('')}</hierarchy>`;

const TABS = ['main_roomsTab', 'main_messagesTab', 'main_profileTab'].map((id, i) =>
  node(id, '', `[${i * 300},2600][${i * 300 + 280},2700]`),
);
const HOME = screen(...TABS);
const SHEET = screen(
  node('dailyReward_dialog', '', '[100,700][1160,2100]'),
  node('dailyReward_claimButton', 'Claim Today', '[600,1900][1100,2000]'),
  node('dailyReward_dismissButton', 'Later', '[300,1900][500,2000]'),
);
const PROFILE = screen(...TABS, node('main_settingsButton', '', '[1258,188][1426,356]'));
const SETTINGS = screen(node('settings_signOutButton', 'Sign Out', '[0,2200][1440,2300]'));
const CONFIRM = screen(
  node('', 'Are you sure you want to sign out?', '[100,1200][1300,1300]'),
  node('', 'Sign Out', '[800,1500][1200,1600]'),
);
const SIGN_IN = screen(
  node('persona_picker_open', 'Sign in as test persona', '[0,1900][1440,2030]'),
);
const OTHER = screen(node('privateChat_messageInput', '', '[364,2804][1230,3000]'));

const PROFILE_TAB = { x: 740, y: 2650 };
const DISMISS = { x: 400, y: 1950 };
const GEAR = { x: 1342, y: 272 };
const SIGN_OUT = { x: 720, y: 2250 };
const CONFIRM_BUTTON = { x: 1000, y: 1550 };

/** A phone showing `frames` in order, advancing only when tapped. */
function deviceServing(frames) {
  const queue = [...frames];
  const taps = [];
  return {
    kind: 'android',
    taps,
    async dumpXml() {
      return queue[0];
    },
    async tap(x, y) {
      taps.push({ x, y });
      if (queue.length > 1) queue.shift();
    },
  };
}

/** Settle a promise while the fake clock runs, so sleeps cost no real time. */
async function onFakeClock(promise) {
  let settled = false;
  let value;
  let error;
  promise.then(
    (v) => {
      settled = true;
      value = v;
    },
    (e) => {
      settled = true;
      error = e;
    },
  );
  while (!settled) await jest.advanceTimersByTimeAsync(100);
  if (error) throw error;
  return value;
}

beforeEach(() => {
  jest.useFakeTimers({ now: Date.parse('2026-10-23T00:00:00Z') });
  overlays.cleared.length = 0;
});
afterEach(() => jest.useRealTimers());

/**
 * The iPhone race, measured 2026-10-23: Home is drawn and the reward sheet is
 * mid-presentation, so the first tap lands as the sheet arrives and does
 * nothing. Dismissing the sheet leaves Home, and only a second tap moves on.
 */
function sheetSwallowsFirstTap() {
  let state = 'home-sheet-coming';
  const frameOf = {
    'home-sheet-coming': HOME,
    sheet: SHEET,
    home: HOME,
    profile: PROFILE,
    settings: SETTINGS,
    confirm: CONFIRM,
    signIn: SIGN_IN,
  };
  const at = (p, q) => p.x === q.x && p.y === q.y;
  const taps = [];
  return {
    kind: 'android',
    taps,
    async dumpXml() {
      return frameOf[state];
    },
    async tap(x, y) {
      const p = { x, y };
      taps.push(p);
      if (state === 'home-sheet-coming') state = 'sheet';
      else if (state === 'sheet' && at(p, DISMISS)) state = 'home';
      else if (state === 'home' && at(p, PROFILE_TAB)) state = 'profile';
      else if (state === 'profile' && at(p, GEAR)) state = 'settings';
      else if (state === 'settings' && at(p, SIGN_OUT)) state = 'confirm';
      else if (state === 'confirm' && at(p, CONFIRM_BUTTON)) state = 'signIn';
    },
  };
}

const arrivedAt = (id) => (nodes) => nodes.some((n) => n.id === id);

describe('tapUntilArrived drives a tap until the next screen is there', () => {
  test('a sheet over the screen is dismissed by tag before the target is tapped', async () => {
    const device = deviceServing([SHEET, HOME, PROFILE]);
    await onFakeClock(
      tapUntilArrived(
        device,
        'main_profileTab',
        arrivedAt('main_settingsButton'),
        'the profile',
        6000,
      ),
    );
    expect({ taps: device.taps, cleared: overlays.cleared }).toEqual({
      taps: [DISMISS, PROFILE_TAB],
      cleared: ['the daily-reward sheet via dailyReward_dismissButton'],
    });
  });
  test('already arrived: not a single tap', async () => {
    const device = deviceServing([PROFILE]);
    await onFakeClock(
      tapUntilArrived(
        device,
        'main_profileTab',
        arrivedAt('main_settingsButton'),
        'the profile',
        6000,
      ),
    );
    expect(device.taps).toEqual([]);
  });
  test('a tap swallowed by an arriving sheet is made again once the sheet is gone', async () => {
    const device = sheetSwallowsFirstTap();
    await onFakeClock(
      tapUntilArrived(
        device,
        'main_profileTab',
        arrivedAt('main_settingsButton'),
        'the profile',
        6000,
      ),
    );
    expect(device.taps).toEqual([PROFILE_TAB, DISMISS, PROFILE_TAB]);
  });
  test('a target that is still on screen is not tapped again within 3 s (a slow screen is not double-tapped)', async () => {
    const slow = deviceServing([HOME]); // the tap changes nothing: a screen still loading
    await expect(
      onFakeClock(
        tapUntilArrived(
          slow,
          'main_profileTab',
          arrivedAt('main_settingsButton'),
          'the profile',
          5000,
        ),
      ),
    ).rejects.toThrow('the profile not reached within 5000ms after 2 taps on #main_profileTab');
  });
  test('an empty screen at the deadline says so', async () => {
    const device = deviceServing([screen()]);
    await expect(
      onFakeClock(
        tapUntilArrived(
          device,
          'main_profileTab',
          arrivedAt('main_settingsButton'),
          'the profile',
          2000,
        ),
      ),
    ).rejects.toThrow(
      'the profile not reached within 2000ms after 0 taps on #main_profileTab; screen showed: (none)',
    );
  });
  test('a tap that throws (the element went away) is followed by a fresh read, not a failure', async () => {
    const device = deviceServing([HOME, PROFILE]);
    const realTap = device.tap;
    let first = true;
    device.tap = async (x, y) => {
      if (first) {
        first = false;
        throw new Error('element gone');
      }
      return realTap(x, y);
    };
    await onFakeClock(
      tapUntilArrived(
        device,
        'main_profileTab',
        arrivedAt('main_settingsButton'),
        'the profile',
        6000,
      ),
    );
    expect(device.taps).toEqual([PROFILE_TAB]);
  });
  test('a tap that keeps throwing fails at the deadline, naming the last tap error', async () => {
    const device = deviceServing([HOME]);
    device.tap = async () => {
      throw new Error('element gone');
    };
    await expect(
      onFakeClock(
        tapUntilArrived(
          device,
          'main_profileTab',
          arrivedAt('main_settingsButton'),
          'the profile',
          4000,
        ),
      ),
    ).rejects.toThrow(
      'the profile not reached within 4000ms after 2 taps on #main_profileTab; ' +
        'screen showed: main_roomsTab, main_messagesTab, main_profileTab; last tap failed: element gone',
    );
  });
  test('never arriving fails naming the target, the taps, the screen and what was dismissed', async () => {
    const device = deviceServing([SHEET, HOME, OTHER]);
    await expect(
      onFakeClock(
        tapUntilArrived(
          device,
          'main_profileTab',
          arrivedAt('main_settingsButton'),
          'the profile',
          3000,
        ),
      ),
    ).rejects.toThrow(
      'the profile not reached within 3000ms after 1 tap on #main_profileTab; ' +
        'screen showed: privateChat_messageInput; ' +
        'dismissed first: the daily-reward sheet via dailyReward_dismissButton',
    );
  });
});

describe('signOutFlow never taps through a sheet that comes up mid-flow (SHY-0702)', () => {
  test('the sheet presented after the profile tab is tapped is dismissed, and the sign-out completes', async () => {
    const device = deviceServing([HOME, SHEET, PROFILE, SETTINGS, CONFIRM, SIGN_IN]);
    await onFakeClock(signOutFlow(device));
    expect(device.taps).toEqual([PROFILE_TAB, DISMISS, GEAR, SIGN_OUT, CONFIRM_BUTTON]);
  });
  test('a sheet already up when the flow starts is dismissed before the profile tab is tapped', async () => {
    const device = deviceServing([SHEET, HOME, PROFILE, SETTINGS, CONFIRM, SIGN_IN]);
    await onFakeClock(signOutFlow(device));
    expect(device.taps).toEqual([DISMISS, PROFILE_TAB, GEAR, SIGN_OUT, CONFIRM_BUTTON]);
  });
  test('a sheet that comes up as the gear is tapped is dismissed before signing out', async () => {
    const device = deviceServing([HOME, PROFILE, SHEET, SETTINGS, CONFIRM, SIGN_IN]);
    await onFakeClock(signOutFlow(device));
    expect(device.taps).toEqual([PROFILE_TAB, GEAR, DISMISS, SIGN_OUT, CONFIRM_BUTTON]);
  });
  test('a profile-tab tap swallowed by the arriving sheet: dismissed, tapped again, signed out', async () => {
    const device = sheetSwallowsFirstTap();
    await onFakeClock(signOutFlow(device));
    expect(device.taps).toEqual([
      PROFILE_TAB,
      DISMISS,
      PROFILE_TAB,
      GEAR,
      SIGN_OUT,
      CONFIRM_BUTTON,
    ]);
  });
  test('with no sheet the flow is the four taps it always was', async () => {
    const device = deviceServing([HOME, PROFILE, SETTINGS, CONFIRM, SIGN_IN]);
    await onFakeClock(signOutFlow(device));
    expect(device.taps).toEqual([PROFILE_TAB, GEAR, SIGN_OUT, CONFIRM_BUTTON]);
  });
});

describe('ensureAtSignIn says which way it reached SignIn (SHY-0702)', () => {
  // Its first sign-out attempt used to fail silently: the restart rescued the
  // run and the reason was thrown away, so a fallback looked like a clean
  // sign-out in the report.
  const { ensureAtSignIn } = require('../../scripts/device-journey-runner');

  /** As deviceServing, plus an app restart that shows `afterRestart`. */
  function restartable(frames, afterRestart) {
    const device = deviceServing(frames);
    const queue = [...frames];
    device.dumpXml = async () => queue[0];
    device.tap = async (x, y) => {
      device.taps.push({ x, y });
      if (queue.length > 1) queue.shift();
    };
    device.forceStop = async () => {
      device.taps.push('forceStop');
      queue.splice(0, queue.length, ...afterRestart);
    };
    device.launch = async () => {
      device.taps.push('launch');
    };
    return device;
  }

  test('already at SignIn: says so, and touches nothing', async () => {
    const device = restartable([SIGN_IN], [SIGN_IN]);
    expect(await onFakeClock(ensureAtSignIn(device, 'pkg'))).toBe('already at SignIn');
    expect(device.taps).toEqual([]);
  });
  test('signed in on Home: signs out and says so', async () => {
    const device = restartable([HOME, PROFILE, SETTINGS, CONFIRM, SIGN_IN], [SIGN_IN]);
    expect(await onFakeClock(ensureAtSignIn(device, 'pkg'))).toBe('signed out from Home');
  });
  test('a sign-out that fails names its reason, then the restart path', async () => {
    const device = restartable([HOME, OTHER], [SIGN_IN]);
    expect(await onFakeClock(ensureAtSignIn(device, 'pkg'))).toBe(
      'sign-out from Home failed (the profile not reached within 20000ms after 1 tap on ' +
        '#main_profileTab; screen showed: privateChat_messageInput); restarted the app; already at SignIn',
    );
    expect(device.taps).toEqual([PROFILE_TAB, 'forceStop', 'launch']);
  });
  test('left on a screen with no tab bar (J08 ends on New Message): restart, then sign out, and say so', async () => {
    const device = restartable([OTHER], [HOME, PROFILE, SETTINGS, CONFIRM, SIGN_IN]);
    expect(await onFakeClock(ensureAtSignIn(device, 'pkg'))).toBe(
      'no SignIn or Home on screen (SignIn or Home not reached within 20000ms; ' +
        'screen showed: privateChat_messageInput); restarted the app; signed out from Home',
    );
    expect(device.taps).toEqual([
      'forceStop',
      'launch',
      PROFILE_TAB,
      GEAR,
      SIGN_OUT,
      CONFIRM_BUTTON,
    ]);
  });
  test('a sign-out that fails again after the restart keeps the first reason in its error', async () => {
    const device = restartable([HOME, OTHER], [HOME, OTHER]);
    await expect(onFakeClock(ensureAtSignIn(device, 'pkg'))).rejects.toThrow(
      /^sign-out from Home failed \(the profile not reached .*\); restarted the app; then the sign-out failed: the profile not reached/,
    );
  });
});
