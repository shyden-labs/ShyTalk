# Supported browsers and phones

The website supports five targets (Shyden's ruling of 2026-11-05, shyden-labs/ShyTalk#109). The same smoke suite (`tests/smoke/`) runs on every one of them and must print the same total on each, with nothing skipped.

| Target | Where it runs | When |
| --- | --- | --- |
| Chrome (Chromium) on desktop | CI, `web-smoke` job | Every pull request and every push to `develop` |
| Firefox on desktop | CI, `web-smoke` job | Every pull request and every push to `develop` |
| Safari's engine (WebKit) on desktop | CI, `web-smoke` job | Every pull request and every push to `develop` |
| Chrome on the OnePlus CPH2653 | Over USB, on Shyden's Mac | Before each release |
| Safari on the iPhone Air | Over USB, on Shyden's Mac | Before each release |

## How the totals are checked

- The desktop browsers are listed in `tests/smoke/targets.ts`, one Playwright project each.
- After the smoke, CI's "Compare the totals" step (`scripts/smoke-totals.ts`) reads Playwright's JSON report and prints each target's total. It fails if a target ran nothing, an unlisted target ran, any two totals differ, or any test was skipped.

## The phones

The phone runs are shyden-labs/ShyTalk#112:

- The OnePlus runs the same Playwright suite unchanged, through Playwright's Android mode.
- Playwright cannot drive Safari on a USB-connected iPhone, so the iPhone Air runs an Appium copy of the suite. This copy is the one approved exception to "one suite, run unchanged". A unit test keeps its test names identical to the Playwright suite's.
