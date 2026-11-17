import { runInNewContext } from 'node:vm';
import { describe, it, expect, vi } from 'vitest';
import { safariPage, type WebDriverCall } from '../phones/safari.ts';
import { PREVIEW_FACTS, PREVIEW_TAGS } from '../support/link-preview.ts';

/**
 * Safari on the iPhone Air, driven through Appium's WebDriver API
 * (shyden-labs/ShyTalk#112). Measured 2026-11-06: Safari reports no
 * `responseStatus`, so a page's status comes from Appium's `safariNetwork`
 * log (`Network.responseReceived`, `event.type` "Document"), and CSP refusals
 * from its `safariConsole` log. Appium is stood in here.
 */

const BASE = 'https://site.example';

/** One `safariNetwork` entry, as Appium returns it: the event JSON in `message`. */
const network = (url: string, status: number, type = 'Document') => ({
  message: JSON.stringify({ method: 'Network.responseReceived', event: { type, response: { url, status } } }),
});
/** One `safariConsole` entry. */
const consoleLine = (source: string, text: string) => ({ message: JSON.stringify({ source, level: 'error', text }) });

interface Fake {
  call: WebDriverCall;
  calls: [string, string, unknown][];
}

/** Stands for the token of the visit opened last, in a faked log entry: Safari's documents carry it. */
const VISIT = '{visit}';

/** Appium with queued log answers: each log read takes the next answer for its type, else nothing; `VISIT` in an entry reads as the last opened visit's token. */
function appium(logs: Record<string, unknown[][]> = {}, executes: unknown[] = []): Fake {
  const calls: [string, string, unknown][] = [];
  let visit = '';
  const call: WebDriverCall = (method, path, body) => {
    calls.push([method, path, body]);
    if (path.endsWith('/url')) visit = new URL((body as { url: string }).url).searchParams.get('phone-smoke') ?? '';
    if (path.endsWith('/se/log'))
      return Promise.resolve(
        (logs[(body as { type: string }).type]?.shift() ?? []).map((entry) =>
          typeof entry === 'object' && entry !== null && 'message' in entry
            ? { message: String(entry.message).replaceAll(VISIT, visit) }
            : entry,
        ),
      );
    if (path.includes('/execute/')) return Promise.resolve(executes.shift() ?? null);
    return Promise.resolve(null);
  };
  return { call, calls };
}

describe('safariPage: freshStart', () => {
  it('opens the site, deletes its cookies and clears both storages: the sign-in, sign-up and recovery state a run left (#190)', async () => {
    const fake = appium({ safariNetwork: [[], [network(`${BASE}/?phone-smoke=${VISIT}`, 200)]] });
    await safariPage(fake.call, 's1', BASE, undefined, () => 'v1').freshStart();
    const after = fake.calls.slice(2).map(([method, path, body]) => [method, path, body]);
    expect(after[0]).toEqual(['POST', '/session/s1/url', { url: `${BASE}/?phone-smoke=v1` }]);
    expect(after.slice(-2)).toEqual([
      ['DELETE', '/session/s1/cookie', undefined],
      ['POST', '/session/s1/execute/sync', { script: 'localStorage.clear(); sessionStorage.clear(); return true;', args: [] }],
    ]);
  });
});

describe('safariPage: goto', () => {
  it('drains both logs, opens the address on the target, and answers the document’s status', async () => {
    const fake = appium({
      safariNetwork: [
        [network('old', 200)],
        [network(`${BASE}/id/?phone-smoke=${VISIT}`, 404), network(`${BASE}/s.css`, 200, 'StyleSheet')],
      ],
    });
    const page = safariPage(fake.call, 's1', BASE, undefined, () => 'v1');
    await expect(page.goto('/id/')).resolves.toBe(404);
    expect(fake.calls.slice(0, 3)).toEqual([
      ['POST', '/session/s1/se/log', { type: 'safariNetwork' }],
      ['POST', '/session/s1/se/log', { type: 'safariConsole' }],
      ['POST', '/session/s1/url', { url: `${BASE}/id/?phone-smoke=v1` }],
    ]);
  });

  it('adds its token after a query the path already has, so a confirm link keeps its own', async () => {
    const fake = appium({ safariNetwork: [[], [network(`${BASE}/closed-testing/confirm?t=abc&phone-smoke=${VISIT}`, 200)]] });
    const page = safariPage(fake.call, 's1', BASE, undefined, () => 'v1');
    await page.goto('/closed-testing/confirm?t=abc');
    expect(fake.calls[2]).toEqual(['POST', '/session/s1/url', { url: `${BASE}/closed-testing/confirm?t=abc&phone-smoke=v1` }]);
  });

  it('puts its token before a fragment the path has, where the server sees it: after it, the document carried none (iPhone Air run 9)', async () => {
    const fake = appium({ safariNetwork: [[], [network(`${BASE}/recover/cancel/?phone-smoke=v1`, 200)]] });
    const page = safariPage(fake.call, 's1', BASE, undefined, () => 'v1');
    await expect(page.goto('/recover/cancel/#not-a-real-token')).resolves.toBe(200);
    expect(fake.calls[2]).toEqual(['POST', '/session/s1/url', { url: `${BASE}/recover/cancel/?phone-smoke=v1#not-a-real-token` }]);
  });

  it('asks for each page fresh, with a token no earlier visit used: Safari answered 304 from its cache across sessions (2026-11-07)', async () => {
    const fake = appium({
      safariNetwork: [[], [network(`${BASE}/?phone-smoke=${VISIT}`, 200)], [], [network(`${BASE}/?phone-smoke=${VISIT}`, 200)]],
    });
    const page = safariPage(fake.call, 's1', BASE);
    await page.goto('/');
    await page.goto('/');
    const urls = fake.calls.filter(([, path]) => path.endsWith('/url')).map(([, , body]) => (body as { url: string }).url);
    expect(urls).toHaveLength(2);
    for (const url of urls) expect(url).toMatch(new RegExp(`^${BASE}/\\?phone-smoke=[0-9a-z]+$`));
    expect(new Set(urls).size).toBe(2);
  });

  it('answers the last document when the page loads more than one, and ignores other kinds', async () => {
    const fake = appium({
      safariNetwork: [
        [],
        [
          network(`${BASE}/?phone-smoke=${VISIT}`, 301),
          network(`${BASE}/en/?phone-smoke=${VISIT}`, 200),
          network(`${BASE}/x.js`, 500, 'Script'),
        ],
      ],
    });
    await expect(safariPage(fake.call, 's1', BASE).goto('/')).resolves.toBe(200);
  });

  it('reads only responses: a request for the document carries no status', async () => {
    const request = {
      message: JSON.stringify({ method: 'Network.requestWillBeSent', event: { type: 'Document', request: { url: `${BASE}/` } } }),
    };
    const fake = appium({ safariNetwork: [[], [network(`${BASE}/?phone-smoke=${VISIT}`, 200), request]] });
    await expect(safariPage(fake.call, 's1', BASE).goto('/')).resolves.toBe(200);
  });

  it('waits for the document when Safari logs it after the address call returns (measured 2 in 5 on the iPhone Air, 2026-11-14)', async () => {
    const fake = appium({
      safariNetwork: [[], [network(`${BASE}/s.css`, 200, 'StyleSheet')], [], [network(`${BASE}/zh/?phone-smoke=${VISIT}`, 200)]],
    });
    const waits: number[] = [];
    const wait = (ms: number) => {
      waits.push(ms);
      return Promise.resolve();
    };
    await expect(safariPage(fake.call, 's1', BASE, undefined, undefined, wait).goto('/zh/')).resolves.toBe(200);
    expect(waits).toEqual([250, 250]);
  });

  it('takes only a document carrying this visit’s token: Safari logged an earlier page’s documents late (iPhone Air, 2026-11-14, #190)', async () => {
    const fake = appium({
      safariNetwork: [
        [],
        [network(`${BASE}/vi/closed-testing/link-expired`, 200), network(`${BASE}/vi/closed-testing/confirm?t=x&phone-smoke=v0`, 200)],
        [network(`${BASE}/zh/?phone-smoke=v1`, 404)],
      ],
    });
    const waits: number[] = [];
    const wait = (ms: number) => {
      waits.push(ms);
      return Promise.resolve();
    };
    await expect(safariPage(fake.call, 's1', BASE, undefined, () => 'v1', wait).goto('/zh/')).resolves.toBe(404);
    expect(waits).toEqual([250]);
  });

  it('fails naming the address and the ceiling when Safari logs no document within 15 s', async () => {
    const fake = appium({ safariNetwork: [[], [network(`${BASE}/s.css`, 200, 'StyleSheet')]] });
    const waits: number[] = [];
    const wait = (ms: number) => {
      waits.push(ms);
      return Promise.resolve();
    };
    await expect(safariPage(fake.call, 's1', BASE, undefined, undefined, wait).goto('/th/')).rejects.toThrow(
      new RegExp(`^Safari logged no document for ${BASE}/th/\\?phone-smoke=\\w+ within 15000 ms$`),
    );
    expect(waits.reduce((sum, ms) => sum + ms, 0)).toBe(15_000);
  });
});

describe('safariPage: cspRefusals', () => {
  it('answers the console’s CSP refusals since the last goto, across reads, and nothing else', async () => {
    const refusal =
      'Refused to load https://x/beacon.js because it appears in neither the script-src directive nor the default-src directive of the Content Security Policy.';
    const fake = appium({
      safariNetwork: [[], [network(`${BASE}/?phone-smoke=${VISIT}`, 200)]],
      safariConsole: [
        [consoleLine('security', 'from before')],
        [consoleLine('network', 'Failed to load resource: 404'), consoleLine('security', refusal)],
        [consoleLine('security', 'Content Security Policy: later')],
      ],
    });
    const page = safariPage(fake.call, 's1', BASE);
    await page.goto('/');
    await expect(page.cspRefusals()).resolves.toEqual([refusal]);
    await expect(page.cspRefusals()).resolves.toEqual([refusal, 'Content Security Policy: later']);
  });

  it('starts again at each goto', async () => {
    const fake = appium({
      safariNetwork: [[], [network(`${BASE}/?phone-smoke=${VISIT}`, 200)], [], [network(`${BASE}/?phone-smoke=${VISIT}`, 200)]],
      safariConsole: [[], [consoleLine('security', 'Refused by the Content Security Policy')], []],
    });
    const page = safariPage(fake.call, 's1', BASE);
    await page.goto('/');
    await page.cspRefusals();
    await page.goto('/');
    await expect(page.cspRefusals()).resolves.toEqual([]);
  });
});

describe('safariPage: reading the page', () => {
  /** The script and arguments of the last execute call. */
  const lastScript = (fake: Fake) =>
    fake.calls.filter(([, path]) => path.endsWith('/execute/sync')).at(-1)?.[2] as { script: string; args: unknown[] };
  const lastAsyncScript = (fake: Fake) =>
    fake.calls.filter(([, path]) => path.endsWith('/execute/async')).at(-1)?.[2] as { script: string; args: unknown[] };

  it('reads an attribute of the first match, passing the selector and name as arguments', async () => {
    const fake = appium({}, ['en']);
    await expect(safariPage(fake.call, 's1', BASE).attribute('html', 'lang')).resolves.toBe('en');
    expect(lastScript(fake).args).toEqual(['html', 'lang']);
    expect(lastScript(fake).script).toContain('getAttribute');
  });

  it('answers visibility, text and link counts from the page, as their types', async () => {
    const fake = appium({}, [true, 'Learn languages', 2, 1]);
    const page = safariPage(fake.call, 's1', BASE);
    await expect(page.isVisible('nav')).resolves.toBe(true);
    await expect(page.text('h1')).resolves.toBe('Learn languages');
    await expect(page.links('Apply')).resolves.toBe(2);
    expect(lastScript(fake).args).toEqual(['Apply', false]);
    await expect(page.visibleLinks('Apply')).resolves.toBe(1);
    expect(lastScript(fake).args).toEqual(['Apply', true]);
  });

  it('counts the elements a selector matches, as Playwright’s toHaveCount (shyden-labs/ShyTalk#180)', async () => {
    const fake = appium({}, [3]);
    await expect(safariPage(fake.call, 's1', BASE).count('[data-testid="devices"] li')).resolves.toBe(3);
    expect(lastScript(fake).args).toEqual(['[data-testid="devices"] li']);
    expect(lastScript(fake).script).toContain('querySelectorAll(arguments[0]).length');
  });

  it('fails naming the selector when nothing matches it', async () => {
    const page = safariPage(appium({}, [null]).call, 's1', BASE);
    await expect(page.text('h1')).rejects.toThrow('nothing matches h1');
  });

  it('runs axe from axe-core’s own file and answers its violations as id and node count', async () => {
    const read = vi.fn(() => 'window.axe = {};');
    const fake = appium({}, [null, [{ id: 'color-contrast', nodes: 3 }]]);
    await expect(safariPage(fake.call, 's1', BASE, read).axeViolations()).resolves.toEqual(['color-contrast: 3']);
    expect(read).toHaveBeenCalledWith(expect.stringMatching(/axe-core\/axe\.min\.js$/));
    const executes = fake.calls.filter(([, path]) => path.includes('/execute/'));
    expect(executes.map(([, path]) => path)).toEqual(['/session/s1/execute/sync', '/session/s1/execute/async']);
    expect((executes[0]?.[2] as { script: string }).script).toBe('window.axe = {};');
  });

  it('gives axe a minute before running it: Appium’s own script timeout cut it off at 17-29 ms on the iPhone Air (2026-11-07)', async () => {
    const fake = appium({}, [null, []]);
    await safariPage(fake.call, 's1', BASE, () => '').axeViolations();
    const steps = fake.calls.map(([, path]) => path);
    expect(fake.calls).toContainEqual(['POST', '/session/s1/timeouts', { script: 60_000 }]);
    expect(steps.indexOf('/session/s1/timeouts')).toBeLessThan(steps.indexOf('/session/s1/execute/async'));
  });

  it('reads a page’s link preview with the smoke’s own in-page check, given a minute, and answers what it found (shyden-labs/ShyTalk#198)', async () => {
    const facts = { lang: 'id', title: 'Masuk · ShyTalk', tags: { 'og:type': 'website' }, picture: { loaded: true } };
    const fake = appium({}, [facts]);
    await expect(safariPage(fake.call, 's1', BASE).previewFacts('/id/sign-in/')).resolves.toEqual(facts);
    const { script, args } = lastAsyncScript(fake);
    expect(script).toContain(PREVIEW_FACTS);
    expect(args).toEqual(['/id/sign-in/', [...PREVIEW_TAGS]]);
    const steps = fake.calls.map(([, path]) => path);
    expect(fake.calls).toContainEqual(['POST', '/session/s1/timeouts', { script: 60_000 }]);
    expect(steps.indexOf('/session/s1/timeouts')).toBeLessThan(steps.indexOf('/session/s1/execute/async'));
  });

  it('hands the in-page check its answer, or its failure, through WebDriver’s callback', async () => {
    const { script } = await (async () => {
      const fake = appium({}, [{}]);
      await safariPage(fake.call, 's1', BASE).previewFacts('/');
      return lastAsyncScript(fake);
    })();
    const answers: unknown[] = [];
    const run = (check: string) =>
      runInNewContext(`(function () { ${script.replace(PREVIEW_FACTS, check)} }).apply(null, args)`, {
        args: ['/', [], (answer: unknown) => answers.push(answer)],
      }) as unknown;
    run('async (path, keys) => ({ path, keys })');
    run('async () => { throw new Error("fetch refused"); }');
    await new Promise((resolve) => setImmediate(resolve));
    expect(answers).toEqual([{ path: '/', keys: [] }, { failed: 'Error: fetch refused' }]);
  });

  it('fails naming the in-page check’s failure', async () => {
    const page = safariPage(appium({}, [{ failed: 'TypeError: Load failed' }]).call, 's1', BASE);
    await expect(page.previewFacts('/sign-up/')).rejects.toThrow('the link-preview check on /sign-up/ failed: TypeError: Load failed');
  });
});

describe('safariPage: tap and waitForText', () => {
  const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

  /**
   * Appium's web click stalled in Safari's remote debugger and no pointer event reached the page, while a
   * native touch arrived as a real touch, 68 pt above its aim (measured on the iPhone Air 2026-11-14,
   * shyden-labs/ShyTalk#190). So a tap is a native touch at the element's centre plus Safari's content
   * offset, measured once by an inert calibration touch.
   */
  const TOUCH_AT = (x: number, y: number) => ({
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
  const NATIVE = (x: number, y: number): [string, string, unknown][] => [
    ['GET', '/session/s1/context', undefined],
    ['POST', '/session/s1/context', { name: 'NATIVE_APP' }],
    ['POST', '/session/s1/actions', TOUCH_AT(x, y)],
    ['POST', '/session/s1/context', { name: 'WEBVIEW_7' }],
  ];

  /** Appium answering each execute from a queue, its web context named WEBVIEW_7, and touches failing on demand. */
  function phone(executes: unknown[], touchFails = false) {
    const calls: [string, string, unknown][] = [];
    const call: WebDriverCall = (method, path, body) => {
      calls.push([method, path, body]);
      if (path.includes('/execute/')) return Promise.resolve(executes.shift() ?? null);
      if (method === 'GET' && path.endsWith('/context')) return Promise.resolve('WEBVIEW_7');
      if (path.endsWith('/actions') && touchFails) return Promise.reject(new Error('touch refused'));
      return Promise.resolve(null);
    };
    return { call, calls, scripts: () => calls.filter(([, path]) => path.includes('/execute/')).map(([, , body]) => body) };
  }

  it('measures Safari’s offset with one inert touch, then touches the element’s centre natively', async () => {
    const fake = phone([
      { x: 210, y: 373 },
      { x: 210, y: 305 },
      { x: 26, y: 515, width: 420, height: 746 },
    ]);
    await safariPage(fake.call, 's1', BASE).tap('#apply-adult');
    const [arm, received, centre] = fake.scripts() as { script: string; args: unknown[] }[];
    expect(arm?.args).toEqual([]);
    expect(received?.args).toEqual([]);
    expect(centre?.args).toEqual(['#apply-adult']);
    expect(fake.calls.filter(([, path]) => !path.includes('/execute/'))).toEqual([...NATIVE(210, 373), ...NATIVE(26, 583)]);
  });

  it('measures the offset once per page, not per tap', async () => {
    const fake = phone([
      { x: 210, y: 373 },
      { x: 210, y: 305 },
      { x: 26, y: 515, width: 420, height: 746 },
      { x: 100, y: 200, width: 420, height: 746 },
    ]);
    const page = safariPage(fake.call, 's1', BASE);
    await page.tap('#apply-adult');
    await page.tap('#apply-submit');
    expect(fake.calls.filter(([, path]) => path.endsWith('/actions')).map(([, , body]) => body)).toEqual([
      TOUCH_AT(210, 373),
      TOUCH_AT(26, 583),
      TOUCH_AT(100, 268),
    ]);
  });

  /**
   * On the iPhone Air (measured 2026-11-14, shyden-labs/ShyTalk#190, `.superpowers/sdd/190/run5/`), a native
   * touch reached Safari as `mousedown` and `click` only, never `pointerdown` or `touchstart`, and only on a
   * clickable element: four touches on plain text delivered nothing, one on the checkbox delivered both. So
   * the calibration lays a clickable layer over the whole screen and reads the touch from its `mousedown`.
   */
  it('calibrates on a clickable layer over the screen, read from its mousedown, swallowing the click and removing the layer', async () => {
    const fake = phone([
      { x: 210, y: 373 },
      { x: 210, y: 305 },
      { x: 26, y: 515, width: 420, height: 746 },
    ]);
    await safariPage(fake.call, 's1', BASE).tap('#apply-adult');
    const [arm, received] = fake.scripts() as { script: string }[];

    type Listener = (event: Record<string, unknown>) => void;
    const listeners: Record<string, Listener[]> = {};
    const appended: unknown[] = [];
    const layer = {
      style: {} as Record<string, string>,
      addEventListener: (type: string, listener: Listener) => (listeners[type] ??= []).push(listener),
      remove: vi.fn(),
    };
    const document = { createElement: vi.fn(() => layer), body: { append: (el: unknown) => appended.push(el) } };
    const window: Record<string, unknown> = {};
    const page = (script: string): unknown =>
      runInNewContext(`(() => {${script}})()`, { window, document, innerWidth: 420, innerHeight: 746, addEventListener: () => undefined });

    expect(page(String(arm?.script))).toEqual({ x: 210, y: 373 });
    expect(document.createElement).toHaveBeenCalledWith('div');
    expect(appended).toEqual([layer]);
    expect(layer.style).toMatchObject({ position: 'fixed', inset: '0px', zIndex: '2147483647', cursor: 'pointer' });

    for (const listener of listeners.mousedown ?? []) listener({ clientX: 210, clientY: 305 });
    const click = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    for (const listener of listeners.click ?? []) listener(click);
    expect(click.preventDefault).toHaveBeenCalled();
    expect(click.stopPropagation).toHaveBeenCalled();

    expect(page(String(received?.script))).toEqual({ x: 210, y: 305 });
    expect(layer.remove).toHaveBeenCalled();
  });

  it('fails, naming why, when the calibration touch never reaches the page', async () => {
    const fake = phone([{ x: 210, y: 373 }, null]);
    await expect(safariPage(fake.call, 's1', BASE).tap('#apply-adult')).rejects.toThrow(/calibration touch never reached the page/);
  });

  it('fails, naming the selector, when no element matches, touching nothing more', async () => {
    const fake = phone([{ x: 210, y: 373 }, { x: 210, y: 305 }, null]);
    await expect(safariPage(fake.call, 's1', BASE).tap('#gone')).rejects.toThrow(/#gone/);
    expect(fake.calls.filter(([, path]) => path.endsWith('/actions'))).toHaveLength(1);
  });

  it('returns to the web page even when a touch fails', async () => {
    const fake = phone([{ x: 210, y: 373 }], true);
    await expect(safariPage(fake.call, 's1', BASE).tap('#apply-adult')).rejects.toThrow(/touch refused/);
    expect(fake.calls.at(-1)).toEqual(['POST', '/session/s1/context', { name: 'WEBVIEW_7' }]);
  });

  /**
   * A member reaches a control off the screen by swiping, so the tests do too: a script scroll is not real input
   * (shyden-labs/ShyTalk#209). The finger moves slowly and stays down a moment before lifting, so the page moves by
   * the finger's travel and no flick carries it further. Its travel (2/5 of the screen) is shorter than the band a
   * control is touched in (the middle 3/5), so one swipe cannot carry a control from one side of the band past the other.
   */
  const SWIPE = (x: number, fromY: number, toY: number) => ({
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
  /** The calibration of the tests above: aimed at (210, 373), received at (210, 305), so the page sits 68 pt down. */
  const CALIBRATED = [
    { x: 210, y: 373 },
    { x: 210, y: 305 },
  ];
  const at = (y: number) => ({ x: 26, y, width: 420, height: 746 });
  const actions = (fake: ReturnType<typeof phone>) => fake.calls.filter(([, path]) => path.endsWith('/actions')).map(([, , body]) => body);

  it('swipes up with a real finger while the element is below the screen, then touches it', async () => {
    const fake = phone([...CALIBRATED, at(1400), at(1100), at(500)]);
    await safariPage(fake.call, 's1', BASE).tap('#apply-submit');
    expect(actions(fake)).toEqual([TOUCH_AT(210, 373), SWIPE(210, 590, 292), SWIPE(210, 590, 292), TOUCH_AT(26, 568)]);
  });

  it('swipes down while the element is above the screen, then touches it', async () => {
    const fake = phone([...CALIBRATED, at(-300), at(400)]);
    await safariPage(fake.call, 's1', BASE).tap('#back');
    expect(actions(fake)).toEqual([TOUCH_AT(210, 373), SWIPE(210, 292, 590), TOUCH_AT(26, 468)]);
  });

  it('touches an element on the edges of the middle 3/5 of the screen without swiping', async () => {
    const fake = phone([...CALIBRATED, at(150), at(596)]);
    const page = safariPage(fake.call, 's1', BASE);
    await page.tap('#top');
    await page.tap('#bottom');
    expect(actions(fake)).toEqual([TOUCH_AT(210, 373), TOUCH_AT(26, 218), TOUCH_AT(26, 664)]);
  });

  it('swipes when the element is just outside the middle 3/5, above or below', async () => {
    const fake = phone([...CALIBRATED, at(149), at(300), at(597), at(300)]);
    const page = safariPage(fake.call, 's1', BASE);
    await page.tap('#above');
    await page.tap('#below');
    expect(actions(fake)).toEqual([TOUCH_AT(210, 373), SWIPE(210, 292, 590), TOUCH_AT(26, 368), SWIPE(210, 590, 292), TOUCH_AT(26, 368)]);
  });

  it('touches an element exactly on the band’s edges: on a 750 pt screen, 150 and 600', async () => {
    const fake = phone([...CALIBRATED, { x: 26, y: 150, width: 420, height: 750 }, { x: 26, y: 600, width: 420, height: 750 }]);
    const page = safariPage(fake.call, 's1', BASE);
    await page.tap('#top');
    await page.tap('#bottom');
    expect(actions(fake)).toEqual([TOUCH_AT(210, 373), TOUCH_AT(26, 218), TOUCH_AT(26, 668)]);
  });

  it('swipes at the middle of the screen, shifted by Safari’s offset both ways', async () => {
    const fake = phone([{ x: 210, y: 373 }, { x: 200, y: 305 }, at(1400), at(500)]);
    await safariPage(fake.call, 's1', BASE).tap('#apply-submit');
    expect(actions(fake)).toEqual([TOUCH_AT(210, 373), SWIPE(220, 590, 292), TOUCH_AT(36, 568)]);
  });

  it('fails naming the element when 10 swipes leave it off the screen, touching nothing', async () => {
    // Each swipe moves it a little, so the page has not reached its end.
    const fake = phone([...CALIBRATED, ...Array.from({ length: 11 }, (_, n) => at(5000 - n * 10))]);
    await expect(safariPage(fake.call, 's1', BASE).tap('#far')).rejects.toThrow('#far is still off the screen after 10 swipes');
    expect(actions(fake)).toEqual([TOUCH_AT(210, 373), ...Array.from({ length: 10 }, () => SWIPE(210, 590, 292))]);
  });

  /**
   * A control at a page's end can never reach the band: fully scrolled, the footer's links and the codes step's
   * "saved" button still sit in the bottom fifth (both phones' run, 2026-11-16, shyden-labs/ShyTalk#209). A swipe that
   * leaves it where it was shows the page can move no further: it is touched where it is, if it is on the screen.
   */
  it('touches a control the page’s end keeps below the band, once a swipe leaves it where it was', async () => {
    const fake = phone([...CALIBRATED, at(700), at(700)]);
    await safariPage(fake.call, 's1', BASE).tap('#codes-saved');
    expect(actions(fake)).toEqual([TOUCH_AT(210, 373), SWIPE(210, 590, 292), TOUCH_AT(26, 768)]);
  });

  it('touches a control the page’s top keeps above the band, once a swipe leaves it where it was', async () => {
    const fake = phone([...CALIBRATED, at(100), at(100)]);
    await safariPage(fake.call, 's1', BASE).tap('#menu');
    expect(actions(fake)).toEqual([TOUCH_AT(210, 373), SWIPE(210, 292, 590), TOUCH_AT(26, 168)]);
  });

  it('fails naming the control when it is off the screen and a swipe moves the page no further, touching nothing', async () => {
    const fake = phone([...CALIBRATED, at(900), at(900)]);
    await expect(safariPage(fake.call, 's1', BASE).tap('#hidden')).rejects.toThrow(
      '#hidden is off the screen and a swipe moves the page no further',
    );
    expect(actions(fake)).toEqual([TOUCH_AT(210, 373), SWIPE(210, 590, 292)]);
  });

  it('fails naming the selector when the element goes away between swipes', async () => {
    const fake = phone([...CALIBRATED, at(1400), null]);
    await expect(safariPage(fake.call, 's1', BASE).tap('#gone')).rejects.toThrow(/no element matches #gone/);
    expect(actions(fake)).toHaveLength(2);
  });

  it('reads the element’s centre and the screen’s size from the page, scrolling nothing itself', async () => {
    const fake = phone([...CALIBRATED, at(500)]);
    await safariPage(fake.call, 's1', BASE).tap('#apply-adult');
    const place = (fake.scripts() as { script: string }[])[2];
    const el = { getBoundingClientRect: () => ({ left: 10, top: 1200, width: 30, height: 20 }), scrollIntoView: vi.fn() };
    const window = { scrollTo: vi.fn(), scrollBy: vi.fn(), scroll: vi.fn() };
    const run = (found: unknown): unknown =>
      runInNewContext(`(() => {${String(place?.script)}})()`, {
        arguments: ['#apply-adult'],
        document: { querySelector: () => found },
        window,
        scrollTo: window.scrollTo,
        scrollBy: window.scrollBy,
        scroll: window.scroll,
        innerWidth: 420,
        innerHeight: 746,
      });
    expect(run(el)).toEqual({ x: 25, y: 1210, width: 420, height: 746 });
    expect(run(null)).toBeNull();
    expect(el.scrollIntoView).not.toHaveBeenCalled();
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(window.scrollBy).not.toHaveBeenCalled();
    expect(window.scroll).not.toHaveBeenCalled();
  });

  it('types into the element key by key through WebDriver, as the iPhone’s keyboard does', async () => {
    const calls: [string, string, unknown][] = [];
    const call: WebDriverCall = (method, path, body) => {
      calls.push([method, path, body]);
      return Promise.resolve(path.endsWith('/element') ? { [ELEMENT]: 'e-2' } : null);
    };
    await safariPage(call, 's1', BASE).type('#apply-email', 'a+b@mail.test');
    expect(calls).toEqual([
      ['POST', '/session/s1/element', { using: 'css selector', value: '#apply-email' }],
      ['POST', '/session/s1/element/e-2/value', { text: 'a+b@mail.test' }],
    ]);
  });

  it('looks again until the text comes', async () => {
    const fake = appium({}, ['Old', 'New']);
    const waits: number[] = [];
    const page = safariPage(fake.call, 's1', BASE, undefined, undefined, (ms) => {
      waits.push(ms);
      return Promise.resolve();
    });
    await expect(page.waitForText('h1', 'New')).resolves.toBeUndefined();
    expect(waits).toEqual([250]);
  });

  it('fails at its ceiling, naming what it found', async () => {
    const stuck: WebDriverCall = () => Promise.resolve('Old');
    const page = safariPage(stuck, 's1', BASE, undefined, undefined, () => Promise.resolve());
    await expect(page.waitForText('h1', 'New')).rejects.toThrow('h1 held "Old", not "New", after 15000 ms');
  });

  it('waits by the real clock when nothing stands in', async () => {
    const fake = appium({}, ['Old', 'New']);
    await expect(safariPage(fake.call, 's1', BASE).waitForText('h1', 'New')).resolves.toBeUndefined();
  });
});
