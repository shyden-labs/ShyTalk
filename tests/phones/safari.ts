/**
 * Safari on the iPhone Air as a SafariPage (tests/phones/iphone-cases.ts),
 * driven through Appium's WebDriver API (shyden-labs/ShyTalk#112). Measured
 * 2026-11-06 on the iPhone Air: Safari reports no `responseStatus`, so a
 * page's status comes from Appium's `safariNetwork` log, and CSP refusals from
 * its `safariConsole` log. The session needs `appium:showSafariNetworkLog` and
 * `appium:showSafariConsoleLog`.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { SafariPage } from './iphone-cases.ts';

/** One WebDriver request to Appium, answering the response's `value`. */
export type WebDriverCall = (method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) => Promise<unknown>;

interface LogEntry {
  message: string;
}

/** Playwright's `getByRole('link', { name })`: links whose trimmed, collapsed name is `name`. */
const LINKS = `const [name, visibleOnly] = arguments;
const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
return [...document.querySelectorAll('a[href], [role="link"]')]
  .filter((el) => (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\\s+/g, ' ').trim() === name)
  .filter((el) => !visibleOnly || shown(el)).length;`;

const VISIBLE = `const el = document.querySelector(arguments[0]);
if (!el) return false;
const r = el.getBoundingClientRect();
return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';`;

const TEXT = `const el = document.querySelector(arguments[0]);
return el ? (el.textContent ?? '').replace(/\\s+/g, ' ').trim() : null;`;

const AXE = `const done = arguments[arguments.length - 1];
axe.run(document).then((r) => done(r.violations.map((v) => ({ id: v.id, nodes: v.nodes.length }))));`;

/** How long a page may take to show what a tap leads to, and how often it is looked at meanwhile. */
const TEXT_CEILING_MS = 15_000;
const TEXT_LOOK_MS = 250;

/** The W3C WebDriver key of an element's id in a find answer. */
const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/** How long axe may take on a page before WebDriver gives up on it. */
const AXE_TIMEOUT_MS = 60_000;
const AXE_FILE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

/**
 * A token per visit, unique across runs: Safari kept pages cached across
 * sessions and answered 304 on revalidating them (measured 2026-11-07), which
 * hides the page's own status. A query no earlier visit used fetches it fresh.
 */
function visitTokens(): () => string {
  const run = Date.now().toString(36);
  let visit = 0;
  return () => `${run}${(visit++).toString(36)}`;
}

export function safariPage(
  call: WebDriverCall,
  session: string,
  base: string,
  read: (file: string) => string = (file) => readFileSync(file, 'utf8'),
  token: () => string = visitTokens(),
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): SafariPage {
  const at = `/session/${session}`;
  const log = async (type: 'safariNetwork' | 'safariConsole') =>
    ((await call('POST', `${at}/se/log`, { type })) as LogEntry[]).map(({ message }) => JSON.parse(message) as Record<string, unknown>);
  const run = (script: string, ...args: unknown[]) => call('POST', `${at}/execute/sync`, { script, args });
  const find = async (selector: string) =>
    String(((await call('POST', `${at}/element`, { using: 'css selector', value: selector })) as Record<string, string>)[ELEMENT]);
  let refusals: string[] = [];

  return {
    async goto(path) {
      await log('safariNetwork');
      await log('safariConsole');
      refusals = [];
      const url = `${base}${path}${path.includes('?') ? '&' : '?'}phone-smoke=${token()}`;
      await call('POST', `${at}/url`, { url });
      const documents = (await log('safariNetwork'))
        .filter((entry) => entry.method === 'Network.responseReceived')
        .map((entry) => entry.event as { type: string; response: { status: number } })
        .filter((event) => event.type === 'Document');
      const last = documents.at(-1);
      if (last === undefined) throw new Error(`Safari logged no document for ${url}`);
      return last.response.status;
    },
    async cspRefusals() {
      const texts = (await log('safariConsole')).map((entry) => String(entry.text));
      refusals.push(...texts.filter((text) => /Content Security Policy/i.test(text)));
      return [...refusals];
    },
    async attribute(selector, name) {
      return (await run(
        'const el = document.querySelector(arguments[0]); return el ? el.getAttribute(arguments[1]) : null;',
        selector,
        name,
      )) as string | null;
    },
    async isVisible(selector) {
      return (await run(VISIBLE, selector)) as boolean;
    },
    async text(selector) {
      const text = (await run(TEXT, selector)) as string | null;
      if (text === null) throw new Error(`nothing matches ${selector}`);
      return text;
    },
    async links(name) {
      return (await run(LINKS, name, false)) as number;
    },
    async visibleLinks(name) {
      return (await run(LINKS, name, true)) as number;
    },
    async axeViolations() {
      await run(read(AXE_FILE));
      // Appium's default script timeout cut axe off at 17-29 ms on the iPhone Air (measured 2026-11-07).
      await call('POST', `${at}/timeouts`, { script: AXE_TIMEOUT_MS });
      const violations = (await call('POST', `${at}/execute/async`, { script: AXE, args: [] })) as { id: string; nodes: number }[];
      return violations.map(({ id, nodes }) => `${id}: ${String(nodes)}`);
    },
    async tap(selector) {
      await call('POST', `${at}/element/${await find(selector)}/click`, {});
    },
    async type(selector, text) {
      await call('POST', `${at}/element/${await find(selector)}/value`, { text });
    },
    async waitForText(selector, text) {
      let seen: unknown = null;
      for (let waited = 0; waited <= TEXT_CEILING_MS; waited += TEXT_LOOK_MS) {
        seen = await run(TEXT, selector);
        if (seen === text) return;
        await wait(TEXT_LOOK_MS);
      }
      throw new Error(`${selector} held ${JSON.stringify(seen)}, not ${JSON.stringify(text)}, after ${String(TEXT_CEILING_MS)} ms`);
    },
  };
}
