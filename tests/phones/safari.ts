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

const COUNT = `return document.querySelectorAll(arguments[0]).length;`;

const VISIBLE = `const el = document.querySelector(arguments[0]);
if (!el) return false;
const r = el.getBoundingClientRect();
return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';`;

const TEXT = `const el = document.querySelector(arguments[0]);
return el ? (el.textContent ?? '').replace(/\\s+/g, ' ').trim() : null;`;

const AXE = `const done = arguments[arguments.length - 1];
axe.run(document).then((r) => done(r.violations.map((v) => ({ id: v.id, nodes: v.nodes.length }))));`;

/**
 * Arms one inert calibration touch and answers the middle of the screen to aim it at. A native touch reaches Safari
 * as `mousedown` and `click` only, and only on a clickable element (measured on the iPhone Air 2026-11-14,
 * shyden-labs/ShyTalk#190), so a clickable layer covers the screen: it records where its `mousedown` arrived and
 * cancels the click, so the touch changes nothing on the page.
 */
const ARM = `const layer = document.createElement('div');
Object.assign(layer.style, { position: 'fixed', inset: '0px', zIndex: '2147483647', cursor: 'pointer' });
window.__calibration = null;
window.__calibrationLayer = layer;
layer.addEventListener('mousedown', (e) => { window.__calibration = { x: e.clientX, y: e.clientY }; });
layer.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
document.body.append(layer);
return { x: Math.round(innerWidth / 2), y: Math.round(innerHeight / 2) };`;

/** Where the calibration touch arrived, in page coordinates, or null if it never did; the layer goes either way. */
const RECEIVED = `window.__calibrationLayer.remove();
return window.__calibration;`;

/** Scrolls the element to the middle of the screen and answers its centre in page coordinates, or null. */
const CENTRE = `const el = document.querySelector(arguments[0]);
if (!el) return null;
el.scrollIntoView({ block: 'center', inline: 'center' });
const r = el.getBoundingClientRect();
return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };`;

/** A real finger: one touch at a point on the screen, through WebDriverAgent. */
const touchAt = (x: number, y: number) => ({
  actions: [
    {
      type: 'pointer',
      id: 'finger',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x, y },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 80 },
        { type: 'pointerUp', button: 0 },
      ],
    },
  ],
});

interface Point {
  x: number;
  y: number;
}

/** How long a page may take to load or to show what a tap leads to, and how often it is looked at meanwhile. */
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
  let offset: Point | undefined;
  /** One native touch at a screen point, returning to the web page however it ends. */
  const touch = async (x: number, y: number) => {
    const web = (await call('GET', `${at}/context`)) as string;
    await call('POST', `${at}/context`, { name: 'NATIVE_APP' });
    try {
      await call('POST', `${at}/actions`, touchAt(x, y));
    } finally {
      await call('POST', `${at}/context`, { name: web });
    }
  };
  /** Safari's offset between the screen and the page: aim one inert touch, read where the page received it. */
  const calibrate = async (): Promise<Point> => {
    const aim = (await run(ARM)) as Point;
    await touch(aim.x, aim.y);
    const received = (await run(RECEIVED)) as Point | null;
    if (received === null) throw new Error('the calibration touch never reached the page: Safari’s offset is unknown');
    return { x: aim.x - received.x, y: aim.y - received.y };
  };

  return {
    async goto(path) {
      await log('safariNetwork');
      await log('safariConsole');
      refusals = [];
      const url = `${base}${path}${path.includes('?') ? '&' : '?'}phone-smoke=${token()}`;
      await call('POST', `${at}/url`, { url });
      // Safari's address call returned before the page loaded 2 times in 5 (iPhone Air, 2026-11-14,
      // shyden-labs/ShyTalk#190): the document is waited for, as Playwright's goto waits for the load.
      for (let waited = 0; ; waited += TEXT_LOOK_MS) {
        const documents = (await log('safariNetwork'))
          .filter((entry) => entry.method === 'Network.responseReceived')
          .map((entry) => entry.event as { type: string; response: { status: number } })
          .filter((event) => event.type === 'Document');
        const last = documents.at(-1);
        if (last !== undefined) return last.response.status;
        if (waited >= TEXT_CEILING_MS) throw new Error(`Safari logged no document for ${url} within ${String(TEXT_CEILING_MS)} ms`);
        await wait(TEXT_LOOK_MS);
      }
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
    async count(selector) {
      return (await run(COUNT, selector)) as number;
    },
    async axeViolations() {
      await run(read(AXE_FILE));
      // Appium's default script timeout cut axe off at 17-29 ms on the iPhone Air (measured 2026-11-07).
      await call('POST', `${at}/timeouts`, { script: AXE_TIMEOUT_MS });
      const violations = (await call('POST', `${at}/execute/async`, { script: AXE, args: [] })) as { id: string; nodes: number }[];
      return violations.map(({ id, nodes }) => `${id}: ${String(nodes)}`);
    },
    // Appium's web click stalled in Safari's remote debugger and never reached the page; a native touch arrives as a
    // real touch, offset by Safari's content inset (measured on the iPhone Air 2026-11-14, shyden-labs/ShyTalk#190).
    async tap(selector) {
      offset ??= await calibrate();
      const centre = (await run(CENTRE, selector)) as Point | null;
      if (centre === null) throw new Error(`no element matches ${selector} to tap`);
      await touch(centre.x + offset.x, centre.y + offset.y);
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
