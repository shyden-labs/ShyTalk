# Supported browsers and phones

The website supports six targets (Shyden's ruling of 2026-11-05, shyden-labs/ShyTalk#109; Edge added by shyden-labs/ShyTalk#239). The same smoke suite (`tests/smoke/`) runs on every one of them and must print the same total on each, with nothing skipped.

| Target | Where it runs | When |
| --- | --- | --- |
| Chrome (Chromium) on desktop | CI, `web-smoke` job | Every pull request and every push to `develop` |
| Firefox on desktop | CI, `web-smoke` job | Every pull request and every push to `develop` |
| Safari's engine (WebKit) on desktop | CI, `web-smoke` job | Every pull request and every push to `develop` |
| Microsoft Edge on desktop | CI, `web-smoke` job | Every pull request and every push to `develop` |
| Chrome on the OnePlus CPH2653 | Over USB, on Shyden's Mac | Before each release |
| Safari on the iPhone Air | Over USB, on Shyden's Mac | Before each release |

## How the totals are checked

- The desktop browsers are listed in `tests/smoke/targets.ts`. Their Playwright projects come from the shared package `@shyden-labs/playwright-devices` (`desktopProjects`), the same setup every Shyden Labs project uses. Each is a real desktop browser, with no phone emulation.
- After the smoke, CI's "One-suite checks over the desktop browsers" step runs the package's `one-suite` check on the test list, Playwright's JSON report and the package's assertion counts. It prints each browser's total. It fails if a browser ran nothing or differs from the others, a listed test did not run, a test was skipped, a test's assertion count differs between browsers, or a test that runs on one group only lacks its tag and reason.
- Edge is not in Microsoft's Playwright image, so the job installs it on each run. The job runs as root for that install, with `HOME=/root`, because Firefox refuses to run as root under another user's home folder.
- The phone run still uses ShyTalk's own totals check (`scripts/smoke-totals.ts`) until it moves to the shared device runner (shyden-labs/ShyTalk#238).

## The phones

Before each release, both phones run the smoke suite over USB against a deployed address. Run it from the repository root on Shyden's Mac:

```sh
npm run test:phones -- https://test.shytalk.app
```

Use TEST's address before a release. Until TEST serves pages, use DEV's (`https://dev.shytalk.app`). The command prints every test on each phone, then each phone's total. It fails if a test fails, a test is skipped, or a phone's total differs from the CI browsers' total.

How each phone runs (shyden-labs/ShyTalk#112, Shyden's choices of 2026-11-06):

- **OnePlus CPH2653:** the Playwright suite runs unchanged in the phone's own Chrome. adb forwards Chrome's DevTools socket to the Mac, and `tests/smoke/fixture.ts` connects to it. Each test gets a fresh browser context at the phone's own screen size. No setting is needed on the phone. Playwright's Android mode was not used: it stalls unless a Chrome flag is turned on by hand.
- **iPhone Air:** Playwright cannot drive Safari on a USB-connected iPhone, so the iPhone runs an Appium copy of the suite (`tests/phones/iphone-cases.ts`). This copy is the one approved exception to "one suite, run unchanged". A unit test keeps its test names identical to the Playwright suite's. Safari does not report a page's status to scripts, so the status is read from Appium's Safari network log. Each visit adds a query no earlier visit used (`?phone-smoke=...`), because Safari otherwise answers 304 from its cache.

### What the Mac needs

- Both phones on USB, unlocked and awake. Only one session uses the phones at a time: claim `~/.claude/locks/usb-devices` first.
- The OnePlus with USB debugging on, and Chrome installed.
- The iPhone Air paired with this Mac, Developer Mode on, and Web Inspector on (Settings > Apps > Safari > Advanced).
- Appium installed globally (`appium` 3.4.2) with the `xcuitest` driver. WebDriverAgent is signed with this Mac's Apple Development identity (team `2YV2Y2GFD3`).
