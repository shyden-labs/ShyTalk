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
import { PREVIEW_FACTS, PREVIEW_TAGS, type PreviewFacts } from '../support/link-preview.ts';
import { BRAND_FONTS, HOLDING_FACTS, type HoldingFacts } from '../support/holding-facts.ts';
import { MENU_LIVE, type MenuLive } from '../support/language-menu.ts';

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

/** The element's centre in page coordinates and the screen's size, or null; it scrolls nothing (shyden-labs/ShyTalk#209). */
const PLACE = `const el = document.querySelector(arguments[0]);
if (!el) return null;
const r = el.getBoundingClientRect();
return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), width: innerWidth, height: innerHeight };`;

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

/**
 * A real finger swipe from one screen point to another, moving slowly and resting before it lifts, so the page moves by
 * the finger's travel and no flick carries it further (shyden-labs/ShyTalk#209).
 */
const swipe = (x: number, fromY: number, toY: number) => ({
  actions: [
    {
      type: 'pointer',
      id: 'finger',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x, y: fromY },
        { type: 'pointerDown', button: 0 },
        { type: 'pointerMove', duration: 500, x, y: toY },
        { type: 'pause', duration: 200 },
        { type: 'pointerUp', button: 0 },
      ],
    },
  ],
});

interface Point {
  x: number;
  y: number;
}

/** Where an element sits, and the screen it sits on. */
interface Place extends Point {
  width: number;
  height: number;
}

/**
 * A control is touched once its centre is in the middle 3/5 of the screen; a swipe travels 2/5 of it, less than that
 * band, so one swipe cannot carry a control past the band. Ten swipes cover several screens before the tap gives up.
 * At a page's end the band may be out of reach: a control a swipe leaves in place is touched where it is, if on screen.
 */
const BAND = { top: 0.2, bottom: 0.8 };
const SWIPE = { from: 0.7, to: 0.3 };
const MAX_SWIPES = 10;

/** How long a page may take to load or to show what a tap leads to, and how often it is looked at meanwhile. */
const TEXT_CEILING_MS = 15_000;
const TEXT_LOOK_MS = 250;

/** The W3C WebDriver key of an element's id in a find answer. */
const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/** How long axe may take on a page before WebDriver gives up on it. */
/** Runs the smoke's link-preview check with the page's path and tags, handing back its answer or its failure. */
const PREVIEW = `const done = arguments[arguments.length - 1];
(${PREVIEW_FACTS})(arguments[0], arguments[1]).then(done, (error) => done({ failed: String(error) }));`;
/** Runs the smoke's holding-page check with the brand fonts, handing back its answer or its failure (#273). */
const HOLDING = `const done = arguments[arguments.length - 1];
(${HOLDING_FACTS})(arguments[0]).then(done, (error) => done({ failed: String(error) }));`;
/** Each match's named attributes, then its trimmed text. */
const ROWS = `return Array.from(document.querySelectorAll(arguments[0]), (el) => [
  ...arguments[1].map((name) => el.getAttribute(name)),
  el.textContent.trim(),
]);`;
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
  /** One native gesture, returning to the web page however it ends. */
  const native = async (gesture: unknown) => {
    const web = (await call('GET', `${at}/context`)) as string;
    await call('POST', `${at}/context`, { name: 'NATIVE_APP' });
    try {
      await call('POST', `${at}/actions`, gesture);
    } finally {
      await call('POST', `${at}/context`, { name: web });
    }
  };
  const touch = (x: number, y: number) => native(touchAt(x, y));
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
      const visit = token();
      // The token goes before any fragment: a fragment never reaches the server, so its document would carry none.
      const [address = '', fragment] = path.split('#', 2);
      const url = `${base}${address}${address.includes('?') ? '&' : '?'}phone-smoke=${visit}${fragment === undefined ? '' : `#${fragment}`}`;
      await call('POST', `${at}/url`, { url });
      // Safari's address call returned before the page loaded 2 times in 5 (iPhone Air, 2026-11-14,
      // shyden-labs/ShyTalk#190): the document is waited for, as Playwright's goto waits for the load.
      for (let waited = 0; ; waited += TEXT_LOOK_MS) {
        const documents = (await log('safariNetwork'))
          .filter((entry) => entry.method === 'Network.responseReceived')
          .map((entry) => entry.event as { type: string; response: { status: number; url: string } })
          // Safari logged an earlier page's documents after that page showed (iPhone Air, 2026-11-14,
          // shyden-labs/ShyTalk#190): only a document carrying this visit's token is this visit's.
          .filter((event) => event.type === 'Document' && URL.parse(event.response.url)?.searchParams.get('phone-smoke') === visit);
        const last = documents.at(-1);
        if (last !== undefined) return last.response.status;
        if (waited >= TEXT_CEILING_MS) throw new Error(`Safari logged no document for ${url} within ${String(TEXT_CEILING_MS)} ms`);
        await wait(TEXT_LOOK_MS);
      }
    },
    // Safari kept the session cookie and stored tokens across cases and runs: run 8's join, failing before its
    // sign-out, left every later sign-up's setup acting for that account (iPhone Air, 2026-11-14, #190).
    async freshStart() {
      await this.goto('/');
      await call('DELETE', `${at}/cookie`);
      await run('localStorage.clear(); sessionStorage.clear(); return true;');
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
    async url() {
      return (await call('GET', `${at}/url`)) as string;
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
    async rows(selector, attributes) {
      return (await run(ROWS, selector, attributes)) as (string | null)[][];
    },
    async holdingFacts() {
      await call('POST', `${at}/timeouts`, { script: AXE_TIMEOUT_MS });
      const answer = (await call('POST', `${at}/execute/async`, { script: HOLDING, args: [BRAND_FONTS] })) as
        HoldingFacts | { failed: string };
      if ('failed' in answer) throw new Error(`the holding-page check failed: ${answer.failed}`);
      return answer;
    },
    async menuLive() {
      return (await run(`return (${MENU_LIVE})();`)) as MenuLive;
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
    // The smoke's own in-page check (shyden-labs/ShyTalk#198): it fetches each page and decodes its picture, so it gets
    // axe's minute too; a failure inside it comes back as `failed`, as WebDriver hands only the callback's value back.
    async previewFacts(path) {
      await call('POST', `${at}/timeouts`, { script: AXE_TIMEOUT_MS });
      const answer = (await call('POST', `${at}/execute/async`, {
        script: PREVIEW,
        args: [path, [...PREVIEW_TAGS]],
      })) as PreviewFacts | { failed: string };
      if ('failed' in answer) throw new Error(`the link-preview check on ${path} failed: ${answer.failed}`);
      return answer;
    },
    // Appium's web click stalled in Safari's remote debugger and never reached the page; a native touch arrives as a
    // real touch, offset by Safari's content inset (measured on the iPhone Air 2026-11-14, shyden-labs/ShyTalk#190).
    // A control off the screen is reached by real swipes, as a member reaches it, never a script scroll (#209).
    async tap(selector) {
      const shift = (offset ??= await calibrate());
      let before: number | undefined;
      for (let swipes = 0; ; swipes++) {
        const place = (await run(PLACE, selector)) as Place | null;
        if (place === null) throw new Error(`no element matches ${selector} to tap`);
        const below = place.y > place.height * BAND.bottom;
        if (!below && place.y >= place.height * BAND.top) return touch(place.x + shift.x, place.y + shift.y);
        // A swipe that left it where it was: the page is at its end, so the band cannot be reached (2026-11-16).
        if (place.y === before) {
          if (place.y >= 0 && place.y < place.height) return touch(place.x + shift.x, place.y + shift.y);
          throw new Error(`${selector} is off the screen and a swipe moves the page no further`);
        }
        if (swipes === MAX_SWIPES) throw new Error(`${selector} is still off the screen after ${String(MAX_SWIPES)} swipes`);
        before = place.y;
        const from = Math.round(place.height * SWIPE.from) + shift.y;
        const to = Math.round(place.height * SWIPE.to) + shift.y;
        await native(swipe(Math.round(place.width / 2) + shift.x, below ? from : to, below ? to : from));
      }
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
